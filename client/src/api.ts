import type { Config, MediaManifest, PrepareJob, SourceBrowse, WatchState } from "./types";

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:4000";

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
  watchState: () => request<{ items: Record<string, WatchState> }>("/api/watch-state"),
  updateWatchState: (id: string, payload: { position: number; duration: number | null; completed?: boolean }) =>
    request<WatchState>(`/api/watch-state/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    })
};
