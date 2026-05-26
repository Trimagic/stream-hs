import { promises as fs } from "node:fs";
import path from "node:path";
import { config, setSourceRoot } from "./config.js";
import {
  directPlayExtensions,
  ensureMediaRoot,
  fileExists,
  isVideoFile,
  manifestPath,
  mediaDir,
  posterPath,
  resolveSourcePath,
  streamPath,
  toSourceRelative
} from "./paths.js";

export async function getConfig() {
  await ensureMediaRoot();
  return {
    sourceRoot: config.sourceRoot,
    mediaRoot: config.mediaRoot,
    hasSourceRoot: Boolean(config.sourceRoot)
  };
}

export async function updateSourceRoot(root) {
  if (!root || typeof root !== "string") {
    const error = new Error("Source root path is required");
    error.statusCode = 400;
    throw error;
  }

  const resolved = path.resolve(root);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    const error = new Error("Source root does not exist or is not a directory");
    error.statusCode = 400;
    throw error;
  }

  setSourceRoot(resolved);
  return getConfig();
}

export async function browseSource(relativePath = "") {
  const current = resolveSourcePath(relativePath);
  const stat = await fs.stat(current);
  if (!stat.isDirectory()) {
    const error = new Error("Path is not a directory");
    error.statusCode = 400;
    throw error;
  }

  const entries = await fs.readdir(current, { withFileTypes: true });
  const folders = [];
  const videos = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(current, entry.name);
    const itemPath = toSourceRelative(absolute);

    if (entry.isDirectory()) {
      folders.push({ name: entry.name, path: itemPath });
      continue;
    }

    if (entry.isFile() && isVideoFile(entry.name)) {
      const fileStat = await fs.stat(absolute);
      videos.push({
        name: entry.name,
        path: itemPath,
        size: fileStat.size,
        directPlay: directPlayExtensions.has(path.extname(entry.name).toLowerCase()),
        modifiedAt: fileStat.mtime.toISOString()
      });
    }
  }

  folders.sort(sortByName);
  videos.sort(sortByName);

  return {
    path: toSourceRelative(current),
    breadcrumbs: buildBreadcrumbs(toSourceRelative(current)),
    folders,
    videos
  };
}

export async function listMedia() {
  await ensureMediaRoot();
  const entries = await fs.readdir(config.mediaRoot, { withFileTypes: true }).catch(() => []);
  const manifests = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readManifest(entry.name).catch(() => null);
    if (manifest) manifests.push(await buildPublicManifest(manifest));
  }

  return manifests.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: "base" }));
}

export async function readManifest(id) {
  const raw = await fs.readFile(manifestPath(id), "utf8");
  return JSON.parse(raw);
}

export async function writeManifest(manifest) {
  await fs.mkdir(mediaDir(manifest.id), { recursive: true });
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  await fs.writeFile(manifestPath(manifest.id), body, "utf8");
  return manifest;
}

export async function buildPublicManifest(manifest) {
  const hasStream = await fileExists(streamPath(manifest.id));
  const hasPoster = await fileExists(posterPath(manifest.id));
  return {
    ...manifest,
    ready: manifest.status === "ready" && hasStream,
    urls: {
      stream: hasStream ? `/api/media/${encodeURIComponent(manifest.id)}/stream` : null,
      poster: hasPoster ? `/api/media/${encodeURIComponent(manifest.id)}/poster` : null
    }
  };
}

export async function getPublicManifest(id) {
  return buildPublicManifest(await readManifest(id));
}

function sortByName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
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
