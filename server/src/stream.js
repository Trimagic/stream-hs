import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { posterPath, streamPath } from "./paths.js";

const mimeTypes = new Map([
  [".mp4", "video/mp4"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"]
]);

export async function streamPreparedVideo(req, reply, id) {
  const filePath = streamPath(id);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    return reply.code(404).send({ error: "Prepared stream not found" });
  }

  return sendFileWithRange(req, reply, filePath, stat);
}

export async function streamPoster(req, reply, id) {
  const filePath = posterPath(id);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    return reply.code(404).send({ error: "Poster not found" });
  }

  reply.header("content-type", "image/jpeg");
  reply.header("content-length", stat.size);
  return reply.send(createReadStream(filePath));
}

function sendFileWithRange(req, reply, filePath, stat) {
  const total = stat.size;
  const range = req.headers.range;
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";

  reply.header("accept-ranges", "bytes");
  reply.header("content-type", contentType);

  if (!range) {
    reply.header("content-length", total);
    return reply.send(createReadStream(filePath));
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    reply.header("content-range", `bytes */${total}`);
    return reply.code(416).send();
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : total - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
    reply.header("content-range", `bytes */${total}`);
    return reply.code(416).send();
  }

  const boundedEnd = Math.min(end, total - 1);
  const chunkSize = boundedEnd - start + 1;

  reply.code(206);
  reply.header("content-range", `bytes ${start}-${boundedEnd}/${total}`);
  reply.header("content-length", chunkSize);
  return reply.send(createReadStream(filePath, { start, end: boundedEnd }));
}

