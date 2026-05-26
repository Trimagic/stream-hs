import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { config } from "./config.js";

export const videoExtensions = new Set([
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

export const directPlayExtensions = new Set([".mp4", ".m4v", ".webm", ".ogv", ".ogg"]);

export function isVideoFile(filePath) {
  return videoExtensions.has(path.extname(filePath).toLowerCase());
}

export function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function requireSourceRoot() {
  if (!config.sourceRoot) {
    const error = new Error("Source root is not configured");
    error.statusCode = 409;
    throw error;
  }
}

export function resolveSourcePath(relativePath = "") {
  requireSourceRoot();
  const target = path.resolve(config.sourceRoot, String(relativePath || ""));
  if (!isInside(config.sourceRoot, target)) {
    const error = new Error("Path is outside source root");
    error.statusCode = 403;
    throw error;
  }
  return target;
}

export function toSourceRelative(absolutePath) {
  const relative = path.relative(config.sourceRoot, absolutePath);
  return relative === "" ? "" : relative.split(path.sep).join("/");
}

export function makeMediaId(sourcePath, stat) {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const safeName = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "video";
  const hash = crypto
    .createHash("sha1")
    .update(`${sourcePath}:${stat.size}:${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 10);
  return `${safeName}-${hash}`;
}

export function mediaDir(id) {
  return path.join(config.mediaRoot, id);
}

export function manifestPath(id) {
  return path.join(mediaDir(id), "manifest.json");
}

export function streamPath(id) {
  return path.join(mediaDir(id), "stream.mp4");
}

export function posterPath(id) {
  return path.join(mediaDir(id), "poster.jpg");
}

export async function fileExists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

export async function ensureMediaRoot() {
  await fs.mkdir(config.mediaRoot, { recursive: true });
}

