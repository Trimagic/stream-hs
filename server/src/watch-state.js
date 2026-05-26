import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { ensureMediaRoot } from "./paths.js";

const statePath = () => path.join(config.mediaRoot, "watch-state.json");

export async function readWatchState() {
  await ensureMediaRoot();
  const raw = await fs.readFile(statePath(), "utf8").catch((error) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  return JSON.parse(raw);
}

export async function readDeviceWatchState(deviceId) {
  const state = await readWatchState();
  if (!deviceId) return state;
  return {
    ...state,
    ...(state.devices?.[deviceId] || {})
  };
}

export async function getWatchState(id, deviceId) {
  const state = await readDeviceWatchState(deviceId);
  return state[id] || null;
}

export async function updateWatchState(id, patch, deviceId) {
  if (!id) {
    const error = new Error("Media id is required");
    error.statusCode = 400;
    throw error;
  }

  const position = Number(patch?.position);
  const duration = Number(patch?.duration);
  if (!Number.isFinite(position) || position < 0) {
    const error = new Error("Valid position is required");
    error.statusCode = 400;
    throw error;
  }

  const state = await readWatchState();
  const target = deviceId ? state.devices?.[deviceId] || {} : state;
  const previous = target[id] || state[id] || {};
  const next = {
    ...previous,
    position,
    duration: Number.isFinite(duration) && duration > 0 ? duration : previous.duration || null,
    completed: Boolean(patch?.completed),
    updatedAt: new Date().toISOString()
  };

  if (deviceId) {
    state.devices = state.devices || {};
    state.devices[deviceId] = {
      ...(state.devices[deviceId] || {}),
      [id]: next
    };
  } else {
    state[id] = next;
  }

  await fs.writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return next;
}
