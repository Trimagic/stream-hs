import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDir = path.resolve(serverDir, "..");
const cliSourceRoot = parseSourceRootArg(process.argv.slice(2));

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 4000),
  sourceRoot: process.env.SOURCE_ROOT ? path.resolve(process.env.SOURCE_ROOT) : cliSourceRoot,
  mediaRoot: path.resolve(process.env.MEDIA_ROOT || path.join(workspaceDir, "media")),
  ffmpegPath: process.env.FFMPEG_PATH || findWingetTool("ffmpeg.exe") || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || findWingetTool("ffprobe.exe") || "ffprobe",
  audioBitrate: process.env.AUDIO_BITRATE || "384k",
  audioChannels: Number(process.env.AUDIO_CHANNELS || 2),
  videoCrf: process.env.VIDEO_CRF || "22",
  videoPreset: process.env.VIDEO_PRESET || "veryfast",
  posterAt: process.env.POSTER_AT || "00:00:05"
};

export function setSourceRoot(root) {
  config.sourceRoot = root ? path.resolve(root) : "";
}

function findWingetTool(toolName) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return "";

  const packageRoot = path.join(
    localAppData,
    "Microsoft",
    "WinGet",
    "Packages",
    "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
  );
  if (!existsSync(packageRoot)) return "";

  for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("ffmpeg-")) continue;
    const candidate = path.join(packageRoot, entry.name, "bin", toolName);
    if (existsSync(candidate)) return candidate;
  }

  return "";
}

function parseSourceRootArg(args) {
  const flagIndex = args.findIndex((arg) => arg === "--source" || arg === "--source-root");
  const fromFlag = flagIndex >= 0 ? args[flagIndex + 1] : "";
  const fromPosition = args.find((arg) => !arg.startsWith("--"));
  const value = fromFlag || fromPosition || "";
  return value ? path.resolve(value) : "";
}
