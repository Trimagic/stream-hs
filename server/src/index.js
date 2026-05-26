import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  browseSource,
  getConfig,
  getPublicManifest,
  listMedia,
  updateSourceRoot
} from "./media-store.js";
import { config } from "./config.js";
import { listJobs, prepareMedia } from "./prepare.js";
import { streamPoster, streamPreparedVideo } from "./stream.js";
import { getWatchState, readDeviceWatchState, updateWatchState } from "./watch-state.js";

const app = Fastify({
  logger: true,
  bodyLimit: 1024 * 64
});

await app.register(cors, {
  origin: true
});

app.get("/health", async () => ({ ok: true }));

app.get("/api/config", async () => getConfig());

app.post("/api/config/source-root", async (request) => {
  return updateSourceRoot(request.body?.path);
});

app.get("/api/source/browse", async (request) => {
  return browseSource(request.query?.path || "");
});

app.get("/api/media", async () => {
  const media = await listMedia();
  return { media };
});

app.get("/api/media/jobs", async () => ({ jobs: listJobs() }));

app.post("/api/media/prepare", async (request) => {
  return prepareMedia(request.body?.path || "");
});

app.get("/api/media/:id", async (request) => {
  return getPublicManifest(request.params.id);
});

app.get("/api/media/:id/stream", async (request, reply) => {
  return streamPreparedVideo(request, reply, request.params.id);
});

app.get("/api/media/:id/poster", async (request, reply) => {
  return streamPoster(request, reply, request.params.id);
});

app.get("/api/watch-state", async (request) => {
  return { items: await readDeviceWatchState(request.query?.deviceId || "") };
});

app.get("/api/watch-state/:id", async (request) => {
  return { item: await getWatchState(request.params.id, request.query?.deviceId || "") };
});

app.put("/api/watch-state/:id", async (request) => {
  return updateWatchState(request.params.id, request.body || {}, request.query?.deviceId || "");
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const statusCode = error.statusCode || 500;
  reply.code(statusCode).send({
    error: error.message || "Internal server error"
  });
});

await app.listen({
  host: config.host,
  port: config.port
});
