import type { Config, MediaManifest, PrepareJob, SourceBrowse, WatchState } from "./types";

const apiBase = "";
const deviceStorageKey = "stream-hs-device-id";

function createDeviceId() {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `device-${random[0].toString(16)}${random[1].toString(16)}`;
}

export function getDeviceId() {
  const existing = localStorage.getItem(deviceStorageKey);
  if (existing) return existing;
  const next = createDeviceId();
  localStorage.setItem(deviceStorageKey, next);
  return next;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${url}`, {
    headers: options?.body ? { "content-type": "application/json", ...(options.headers || {}) } : options?.headers,
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload as T;
}

export const api = {
  config: () => request<Config>("/api/config"),
  setSourceRoot: (path: string) =>
    request<Config>("/api/config/source-root", {
      method: "POST",
      body: JSON.stringify({ path })
    }),
  browseSource: (path = "") => request<SourceBrowse>(`/api/source/browse?path=${encodeURIComponent(path)}`),
  media: () => request<{ media: MediaManifest[] }>("/api/media"),
  prepare: (path: string) =>
    request<PrepareJob | { status: "ready"; media: MediaManifest }>("/api/media/prepare", {
      method: "POST",
      body: JSON.stringify({ path })
    }),
  jobs: () => request<{ jobs: PrepareJob[] }>("/api/media/jobs"),
  watchState: () => request<{ items: Record<string, WatchState> }>(`/api/watch-state?deviceId=${encodeURIComponent(getDeviceId())}`),
  updateWatchState: (id: string, payload: { position: number; duration: number | null; completed?: boolean }) =>
    request<WatchState>(`/api/watch-state/${encodeURIComponent(id)}?deviceId=${encodeURIComponent(getDeviceId())}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    })
};
