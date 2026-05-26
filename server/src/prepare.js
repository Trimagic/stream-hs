import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import {
  directPlayExtensions,
  makeMediaId,
  mediaDir,
  posterPath,
  resolveSourcePath,
  streamPath,
  toSourceRelative
} from "./paths.js";
import { buildPublicManifest, readManifest, writeManifest } from "./media-store.js";

const jobs = new Map();

export function listJobs() {
  return [...jobs.values()].map(publicJob);
}

export async function prepareMedia(relativePath) {
  const sourcePath = resolveSourcePath(relativePath);
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) {
    const error = new Error("Source path is not a file");
    error.statusCode = 400;
    throw error;
  }

  const id = makeMediaId(sourcePath, stat);
  const existingJob = jobs.get(id);
  if (existingJob) return publicJob(existingJob);

  const existingManifest = await readManifest(id).catch(() => null);
  if (existingManifest?.status === "ready") {
    return {
      status: "ready",
      media: await buildPublicManifest(existingManifest)
    };
  }

  const metadata = await probeMedia(sourcePath);
  const manifest = await createInitialManifest(id, sourcePath, stat, metadata);
  const job = {
    id,
    status: "processing",
    progress: 0,
    startedAt: new Date().toISOString(),
    manifest
  };
  jobs.set(id, job);

  runPrepareJob(job).finally(() => {
    if (job.status !== "processing") {
      windowlessDelayDelete(id);
    }
  });

  return publicJob(job);
}

async function createInitialManifest(id, sourcePath, stat, metadata) {
  const title = path.basename(sourcePath, path.extname(sourcePath));
  const video = metadata.video || {};
  const audio = metadata.audio || {};
  const videoCodec = String(video.codec || "").toLowerCase();
  const canCopyVideo = videoCodec === "h264" || videoCodec === "avc1";

  const manifest = {
    id,
    title,
    sourcePath,
    sourceRelativePath: toSourceRelative(sourcePath),
    status: "processing",
    progress: 0,
    duration: metadata.duration,
    container: metadata.container,
    source: {
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    },
    video: {
      codec: video.codec || null,
      profile: video.profile || null,
      width: video.width || null,
      height: video.height || null,
      fps: video.fps || null,
      copied: canCopyVideo
    },
    audio: {
      sourceCodec: audio.codec || null,
      sourceChannels: audio.channels || null,
      codec: "aac",
      channels: config.audioChannels,
      bitrate: config.audioBitrate
    },
    files: {
      stream: "stream.mp4",
      poster: "poster.jpg",
      manifest: "manifest.json"
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await writeManifest(manifest);
  return manifest;
}

async function runPrepareJob(job) {
  try {
    await fs.mkdir(mediaDir(job.id), { recursive: true });
    const outputPath = streamPath(job.id);
    const tempPath = path.join(mediaDir(job.id), "stream.tmp.mp4");

    await fs.rm(tempPath, { force: true }).catch(() => {});

    await runFfmpeg(buildPrepareArgs(job.manifest.sourcePath, tempPath, job.manifest.video.copied), {
      duration: job.manifest.duration,
      onProgress: async (progress) => {
        job.progress = progress;
        job.manifest.progress = progress;
        job.manifest.updatedAt = new Date().toISOString();
        await writeManifest(job.manifest);
      }
    });

    await fs.rename(tempPath, outputPath);
    await createPoster(job.manifest.sourcePath, posterPath(job.id)).catch(() => {});

    job.status = "ready";
    job.progress = 100;
    job.manifest.status = "ready";
    job.manifest.progress = 100;
    job.manifest.preparedAt = new Date().toISOString();
    job.manifest.updatedAt = new Date().toISOString();
    await writeManifest(job.manifest);
  } catch (error) {
    job.status = "error";
    job.error = error.message;
    job.manifest.status = "error";
    job.manifest.error = error.message;
    job.manifest.updatedAt = new Date().toISOString();
    await writeManifest(job.manifest).catch(() => {});
  }
}

function buildPrepareArgs(inputPath, outputPath, copyVideo) {
  const videoArgs = copyVideo
    ? ["-c:v", "copy"]
    : ["-c:v", "libx264", "-preset", config.videoPreset, "-crf", config.videoCrf, "-pix_fmt", "yuv420p"];

  return [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    ...videoArgs,
    "-c:a",
    "aac",
    "-b:a",
    config.audioBitrate,
    "-ac",
    String(config.audioChannels),
    "-movflags",
    "+faststart",
    outputPath
  ];
}

async function createPoster(inputPath, outputPath) {
  const args = [
    "-hide_banner",
    "-y",
    "-ss",
    config.posterAt,
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outputPath
  ];
  await runFfmpeg(args, {});
}

function runFfmpeg(args, options) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(config.ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const seconds = parseFfmpegTime(text);
      if (seconds != null && options.duration) {
        const progress = Math.max(0, Math.min(99, Math.round((seconds / options.duration) * 100)));
        options.onProgress?.(progress);
      }
    });
    ffmpeg.once("error", reject);
    ffmpeg.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

export function probeMedia(inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      inputPath
    ];
    const ffprobe = spawn(config.ffprobePath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    ffprobe.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    ffprobe.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    ffprobe.once("error", reject);
    ffprobe.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`));
        return;
      }

      const data = JSON.parse(stdout);
      const video = data.streams?.find((stream) => stream.codec_type === "video");
      const audio = data.streams?.find((stream) => stream.codec_type === "audio");
      resolve({
        duration: Number(data.format?.duration) || null,
        container: data.format?.format_name || null,
        video: video ? mapVideoStream(video) : null,
        audio: audio ? mapAudioStream(audio) : null
      });
    });
  });
}

function mapVideoStream(stream) {
  return {
    codec: stream.codec_name || null,
    profile: stream.profile || null,
    width: stream.width || null,
    height: stream.height || null,
    fps: parseFps(stream.avg_frame_rate || stream.r_frame_rate)
  };
}

function mapAudioStream(stream) {
  return {
    codec: stream.codec_name || null,
    channels: stream.channels || null
  };
}

function parseFps(value) {
  if (!value || value === "0/0") return null;
  const [top, bottom] = String(value).split("/").map(Number);
  if (!bottom) return top || null;
  return Math.round((top / bottom) * 1000) / 1000;
}

function parseFfmpegTime(text) {
  const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = matches.at(-1);
  if (!last) return null;
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error || null,
    startedAt: job.startedAt,
    media: job.manifest
  };
}

function windowlessDelayDelete(id) {
  setTimeout(() => jobs.delete(id), 1000 * 60 * 10);
}

