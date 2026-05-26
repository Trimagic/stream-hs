import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { Config, MediaManifest, PrepareJob, SourceBrowse, WatchState } from "./types";

type View = "library" | "storage";

export function App() {
  const [view, setView] = useState<View>("library");
  const [config, setConfig] = useState<Config | null>(null);
  const [media, setMedia] = useState<MediaManifest[]>([]);
  const [watchState, setWatchState] = useState<Record<string, WatchState>>({});
  const [selected, setSelected] = useState<MediaManifest | null>(null);
  const [sourceRootInput, setSourceRootInput] = useState("");
  const [source, setSource] = useState<SourceBrowse | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [jobs, setJobs] = useState<PrepareJob[]>([]);
  const [message, setMessage] = useState("");
  const jobsSignatureRef = useRef("");

  const refreshLibrary = useCallback(async () => {
    const [mediaResult, stateResult] = await Promise.all([api.media(), api.watchState()]);
    setMedia(mediaResult.media);
    setWatchState(stateResult.items);
  }, []);

  const refreshJobs = useCallback(async () => {
    const result = await api.jobs();
    setJobs(result.jobs);
    const signature = result.jobs.map((job) => `${job.id}:${job.status}:${job.progress}`).join("|");
    const changed = signature !== jobsSignatureRef.current;
    jobsSignatureRef.current = signature;
    if (changed || result.jobs.some((job) => job.status === "processing")) {
      await refreshLibrary();
    }
  }, [refreshLibrary]);

  const loadSource = useCallback(async (path = sourcePath) => {
    const result = await api.browseSource(path);
    setSource(result);
    setSourcePath(result.path);
  }, [sourcePath]);

  useEffect(() => {
    api.config()
      .then((result) => {
        setConfig(result);
        setSourceRootInput(result.sourceRoot || "");
        return refreshLibrary();
      })
      .catch((error) => setMessage(error.message));
  }, [refreshLibrary]);

  useEffect(() => {
    if (!config?.hasSourceRoot) return;
    loadSource("").catch((error) => setMessage(error.message));
  }, [config?.hasSourceRoot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshJobs().catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [refreshJobs]);

  async function saveSourceRoot(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await api.setSourceRoot(sourceRootInput.trim());
      setConfig(result);
      setMessage("");
      await loadSource("");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function prepare(path: string) {
    try {
      const result = await api.prepare(path);
      setMessage("Preparation started.");
      await refreshJobs();
      await refreshLibrary();
      if ("media" in result && result.status === "ready") setSelected(result.media);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  const selectedState = selected ? watchState[selected.id] : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <span className="eyebrow">Stream HS</span>
          <h1>Night Library</h1>
        </div>
        <nav className="tabs">
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            Library
          </button>
          <button className={view === "storage" ? "active" : ""} onClick={() => setView("storage")}>
            Storage
          </button>
        </nav>
      </header>

      {message && <div className="toast">{message}</div>}

      <PlayerDock
        media={selected}
        watchState={selectedState}
        onClose={() => setSelected(null)}
        onSaved={refreshLibrary}
      />

      {view === "library" ? (
        <LibraryPage media={media} watchState={watchState} onSelect={setSelected} />
      ) : (
        <StoragePage
          config={config}
          sourceRootInput={sourceRootInput}
          setSourceRootInput={setSourceRootInput}
          saveSourceRoot={saveSourceRoot}
          source={source}
          jobs={jobs}
          onNavigate={(path) => loadSource(path).catch((error) => setMessage(error.message))}
          onPrepare={prepare}
        />
      )}
    </div>
  );
}

function PlayerDock({
  media,
  watchState,
  onClose,
  onSaved
}: {
  media: MediaManifest | null;
  watchState: WatchState | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !media) return;
    lastSavedRef.current = 0;
    const position = watchState?.position || 0;
    const setStart = () => {
      if (position > 5 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(position, Math.max(video.duration - 4, 0));
      }
    };
    video.addEventListener("loadedmetadata", setStart, { once: true });
    return () => video.removeEventListener("loadedmetadata", setStart);
  }, [media?.id]);

  useEffect(() => {
    if (!media) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || !Number.isFinite(video.currentTime)) return;
      if (Math.abs(video.currentTime - lastSavedRef.current) < 5) return;
      lastSavedRef.current = video.currentTime;
      api
        .updateWatchState(media.id, {
          position: video.currentTime,
          duration: Number.isFinite(video.duration) ? video.duration : media.duration,
          completed: Boolean(video.duration && video.currentTime / video.duration > 0.92)
        })
        .then(onSaved)
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [media?.id, onSaved]);

  if (!media) return null;

  return (
    <section className="player-dock">
      <div className="player-copy">
        <span>Now playing</span>
        <strong>{media.title}</strong>
        <small>
          {formatDuration(media.duration)} · {media.video.width}x{media.video.height} · {media.video.copied ? "video copy" : "transcoded"}
        </small>
      </div>
      <video ref={videoRef} src={media.urls?.stream || ""} poster={media.urls?.poster || undefined} controls autoPlay />
      <button className="ghost close" onClick={onClose}>
        Close
      </button>
    </section>
  );
}

function LibraryPage({
  media,
  watchState,
  onSelect
}: {
  media: MediaManifest[];
  watchState: Record<string, WatchState>;
  onSelect: (media: MediaManifest) => void;
}) {
  const ready = useMemo(() => media.filter((item) => item.ready), [media]);

  return (
    <main className="content-grid">
      <section className="panel hero-panel">
        <div>
          <span className="eyebrow">Prepared media</span>
          <h2>{ready.length} videos ready</h2>
        </div>
        <p>Prepared MP4 streams play with normal duration, seeking, pause, and TV-friendly audio.</p>
      </section>

      <section className="panel table-panel">
        <div className="table-head">
          <span>Title</span>
          <span>Video</span>
          <span>Audio</span>
          <span>Watched</span>
          <span></span>
        </div>
        {media.length === 0 && <div className="empty">No prepared videos yet. Open Storage and prepare a source file.</div>}
        {media.map((item) => {
          const state = watchState[item.id];
          const percent = state?.duration ? Math.min(100, Math.round((state.position / state.duration) * 100)) : 0;
          return (
            <article className="media-row" key={item.id}>
              <div className="title-cell">
                <strong>{item.title}</strong>
                <small>{item.sourceRelativePath}</small>
              </div>
              <span>
                {item.video.codec || "video"} {item.video.width ? `${item.video.width}p` : ""}
              </span>
              <span>
                {item.audio.codec} {item.audio.channels}ch
              </span>
              <div className="progress-cell">
                <div className="bar"><i style={{ width: `${percent}%` }} /></div>
                <small>{percent ? `${percent}% watched` : "Not started"}</small>
              </div>
              <button disabled={!item.ready} onClick={() => onSelect(item)}>
                Play
              </button>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function StoragePage({
  config,
  sourceRootInput,
  setSourceRootInput,
  saveSourceRoot,
  source,
  jobs,
  onNavigate,
  onPrepare
}: {
  config: Config | null;
  sourceRootInput: string;
  setSourceRootInput: (value: string) => void;
  saveSourceRoot: (event: React.FormEvent) => void;
  source: SourceBrowse | null;
  jobs: PrepareJob[];
  onNavigate: (path: string) => void;
  onPrepare: (path: string) => void;
}) {
  const jobByPath = new Map(jobs.map((job) => [job.media.sourceRelativePath, job]));

  return (
    <main className="content-grid">
      <section className="panel source-panel">
        <form onSubmit={saveSourceRoot} className="source-form">
          <label>
            <span>Source folder</span>
            <input value={sourceRootInput} onChange={(event) => setSourceRootInput(event.target.value)} placeholder="C:\Videos or /mnt/media" />
          </label>
          <button type="submit">Set</button>
        </form>
        <small className="muted">Media output: {config?.mediaRoot || "..."}</small>
      </section>

      <section className="panel browser-panel">
        {jobs.length > 0 && (
          <div className="jobs-strip">
            <span className="eyebrow">Active preparations</span>
            {jobs.map((job) => (
              <div className="job-card" key={job.id}>
                <div>
                  <strong>{job.media.title}</strong>
                  <small>{job.status === "error" ? job.error || "error" : `${job.progress}% ready`}</small>
                </div>
                <div className="bar"><i style={{ width: `${job.progress}%` }} /></div>
              </div>
            ))}
          </div>
        )}

        <div className="breadcrumbs">
          {(source?.breadcrumbs || [{ name: "Root", path: "" }]).map((crumb) => (
            <button key={crumb.path || "root"} onClick={() => onNavigate(crumb.path)}>
              {crumb.name}
            </button>
          ))}
        </div>

        {!source && <div className="empty">Set a source folder to browse raw videos.</div>}

        <div className="folder-grid">
          {source?.folders.map((folder) => (
            <button className="folder-tile" key={folder.path} onClick={() => onNavigate(folder.path)}>
              <span className="folder-mark" />
              {folder.name}
            </button>
          ))}
        </div>

        <div className="raw-list">
          {source?.videos.map((video) => {
            const job = jobByPath.get(video.path);
            return (
              <article className="raw-row" key={video.path}>
                <div>
                  <strong>{video.name}</strong>
                  <small>{formatSize(video.size)}</small>
                </div>
                <span>{video.directPlay ? "direct" : "prepare"}</span>
                <div className="progress-cell">
                  <div className="bar"><i style={{ width: `${job?.progress || 0}%` }} /></div>
                  <small>{job ? `${job.status} · ${job.progress}%` : "idle"}</small>
                </div>
                <button onClick={() => onPrepare(video.path)} disabled={job?.status === "processing"}>
                  {job?.status === "processing" ? "Preparing" : "Prepare"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function formatSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "unknown";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
