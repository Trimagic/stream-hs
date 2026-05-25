import { createReadStream, promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);

const videoExtensions = new Set([
  ".mp4",
  ".m4v",
  ".webm",
  ".ogv",
  ".ogg",
  ".mov",
  ".mkv",
  ".avi",
  ".wmv"
]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".webm", "video/webm"],
  [".ogv", "video/ogg"],
  [".ogg", "video/ogg"],
  [".mov", "video/quicktime"],
  [".mkv", "video/x-matroska"],
  [".avi", "video/x-msvideo"],
  [".wmv", "video/x-ms-wmv"]
]);

const directPlayExtensions = new Set([".mp4", ".m4v", ".webm", ".ogv", ".ogg"]);
const transcodeExtensions = new Set([".mkv", ".avi", ".wmv", ".mov"]);
let mediaRoot = normalizeStartupRoot(process.argv.slice(2), process.env.MEDIA_ROOT);

function normalizeStartupRoot(args, envRoot) {
  const rootArgIndex = args.findIndex((arg) => arg === "--root");
  const rootFromFlag = rootArgIndex >= 0 ? args[rootArgIndex + 1] : undefined;
  const rootFromPosition = args.find((arg) => !arg.startsWith("--"));
  const selected = rootFromFlag || envRoot || rootFromPosition;
  return selected ? path.resolve(selected) : "";
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, message) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveMediaPath(relativePath = "") {
  if (!mediaRoot) {
    const error = new Error("Media root is not configured");
    error.status = 409;
    throw error;
  }

  const decoded = String(relativePath || "");
  const target = path.resolve(mediaRoot, decoded);
  if (!isInsideRoot(mediaRoot, target)) {
    const error = new Error("Path is outside media root");
    error.status = 403;
    throw error;
  }

  return target;
}

function toClientPath(absolutePath) {
  const relative = path.relative(mediaRoot, absolutePath);
  return relative === "" ? "" : relative.split(path.sep).join("/");
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 16) {
        reject(Object.assign(new Error("Request body is too large"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function setMediaRoot(candidate) {
  if (!candidate || typeof candidate !== "string") {
    const error = new Error("Folder path is required");
    error.status = 400;
    throw error;
  }

  const resolved = path.resolve(candidate);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    const error = new Error("Folder does not exist or is not a directory");
    error.status = 400;
    throw error;
  }

  mediaRoot = resolved;
  return mediaRoot;
}

async function browse(relativePath) {
  const currentPath = resolveMediaPath(relativePath);
  const stat = await fs.stat(currentPath);
  if (!stat.isDirectory()) {
    const error = new Error("Path is not a directory");
    error.status = 400;
    throw error;
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const folders = [];
  const videos = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const absolute = path.join(currentPath, entry.name);
    const itemPath = toClientPath(absolute);

    if (entry.isDirectory()) {
      folders.push({ name: entry.name, path: itemPath });
      continue;
    }

    if (entry.isFile() && videoExtensions.has(path.extname(entry.name).toLowerCase())) {
      const fileStat = await fs.stat(absolute);
      videos.push({
        name: entry.name,
        path: itemPath,
        directPlay: directPlayExtensions.has(path.extname(entry.name).toLowerCase()),
        canTranscode: transcodeExtensions.has(path.extname(entry.name).toLowerCase()),
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString()
      });
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  videos.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return {
    root: mediaRoot,
    path: toClientPath(currentPath),
    breadcrumbs: buildBreadcrumbs(toClientPath(currentPath)),
    folders,
    videos
  };
}

function buildBreadcrumbs(relativePath) {
  const parts = relativePath ? relativePath.split("/").filter(Boolean) : [];
  const crumbs = [{ name: "Root", path: "" }];
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    crumbs.push({ name: part, path: current });
  }

  return crumbs;
}

async function streamVideo(req, res, relativePath) {
  const filePath = resolveMediaPath(relativePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || !videoExtensions.has(path.extname(filePath).toLowerCase())) {
    return sendText(res, 404, "Video not found");
  }

  const total = stat.size;
  const range = req.headers.range;
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";

  if (!range) {
    res.writeHead(200, {
      "content-length": total,
      "content-type": contentType,
      "accept-ranges": "bytes"
    });
    if (req.method === "HEAD") return res.end();
    return createReadStream(filePath).pipe(res);
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { "content-range": `bytes */${total}` });
    return res.end();
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : total - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
    res.writeHead(416, { "content-range": `bytes */${total}` });
    return res.end();
  }

  const boundedEnd = Math.min(end, total - 1);
  const chunkSize = boundedEnd - start + 1;

  res.writeHead(206, {
    "content-range": `bytes ${start}-${boundedEnd}/${total}`,
    "accept-ranges": "bytes",
    "content-length": chunkSize,
    "content-type": contentType
  });

  if (req.method === "HEAD") return res.end();
  createReadStream(filePath, { start, end: boundedEnd }).pipe(res);
}

async function transcodeVideo(req, res, relativePath) {
  const filePath = resolveMediaPath(relativePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || !videoExtensions.has(path.extname(filePath).toLowerCase())) {
    return sendText(res, 404, "Video not found");
  }

  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    filePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-c:v",
    "libx264",
    "-preset",
    process.env.FFMPEG_PRESET || "veryfast",
    "-crf",
    process.env.FFMPEG_CRF || "23",
    "-c:a",
    "aac",
    "-b:a",
    process.env.FFMPEG_AUDIO_BITRATE || "160k",
    "-ac",
    "2",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "pipe:1"
  ];

  const ffmpeg = spawn(process.env.FFMPEG_PATH || "ffmpeg", ffmpegArgs, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  ffmpeg.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  ffmpeg.once("error", (error) => {
    if (!res.headersSent) {
      const message = error.code === "ENOENT"
        ? "ffmpeg is not installed or is not available in PATH"
        : error.message;
      sendJson(res, 500, { error: message });
    } else {
      res.destroy(error);
    }
  });

  ffmpeg.once("spawn", () => {
    res.writeHead(200, {
      "content-type": "video/mp4",
      "cache-control": "no-store"
    });
    if (req.method === "HEAD") {
      ffmpeg.kill("SIGKILL");
      return res.end();
    }
    ffmpeg.stdout.pipe(res);
  });

  ffmpeg.once("close", (code) => {
    if (code && code !== 255 && stderr.trim()) {
      console.error(`ffmpeg exited with code ${code}: ${stderr.trim()}`);
    }
  });

  req.on("close", () => {
    if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
  });
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(publicDir, `.${requested}`);

  if (!isInsideRoot(publicDir, target)) {
    return sendText(res, 403, "Forbidden");
  }

  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile()) {
    return sendText(res, 404, "Not found");
  }

  res.writeHead(200, {
    "content-length": stat.size,
    "content-type": mimeTypes.get(path.extname(target).toLowerCase()) || "application/octet-stream"
  });

  if (req.method === "HEAD") return res.end();
  createReadStream(target).pipe(res);
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/config" && req.method === "GET") {
    return sendJson(res, 200, { root: mediaRoot, configured: Boolean(mediaRoot) });
  }

  if (url.pathname === "/api/root" && req.method === "POST") {
    const body = await parseJsonBody(req);
    const root = await setMediaRoot(body.path);
    return sendJson(res, 200, { root, configured: true });
  }

  if (url.pathname === "/api/browse" && req.method === "GET") {
    const data = await browse(url.searchParams.get("path") || "");
    return sendJson(res, 200, data);
  }

  if (url.pathname === "/api/video" && (req.method === "GET" || req.method === "HEAD")) {
    return streamVideo(req, res, url.searchParams.get("path") || "");
  }

  if (url.pathname === "/api/transcode" && (req.method === "GET" || req.method === "HEAD")) {
    return transcodeVideo(req, res, url.searchParams.get("path") || "");
  }

  return sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, status, { error: error.message || "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`Video streamer is running at http://localhost:${port}`);
  console.log(mediaRoot ? `Media root: ${mediaRoot}` : "Media root is not configured yet.");
});
