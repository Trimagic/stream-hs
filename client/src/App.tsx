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

  const loadSource = useCallback(
    async (path = sourcePath) => {
      const result = await api.browseSource(path);
      setSource(result);
      setSourcePath(result.path);
    },
    [sourcePath]
  );

  useEffect(() => {
    api
      .config()
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
          <span className="eyebrow">Amber Glass</span>
          <h1>Stream HS</h1>
        </div>
        <nav className="tabs" aria-label="Main navigation">
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            Library
          </button>
          <button className={view === "storage" ? "active" : ""} onClick={() => setView("storage")}>
            Storage
          </button>
        </nav>
      </header>

      {message && <div className="toast">{message}</div>}

      <PlayerDock media={selected} watchState={selectedState} onClose={() => setSelected(null)} onSaved={refreshLibrary} />

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
  const dockRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !media) return;
    lastSavedRef.current = 0;
    setCurrentTime(0);
    setDuration(media.duration || 0);
    setPlaying(false);
    const position = watchState?.position || 0;
    const setStart = () => {
      const nextDuration = Number.isFinite(video.duration) ? video.duration : media.duration || 0;
      setDuration(nextDuration);
      if (position > 5 && nextDuration > 0) {
        video.currentTime = Math.min(position, Math.max(nextDuration - 4, 0));
      }
      video.play().catch(() => setPlaying(false));
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

  const seekTo = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(value, duration || video.duration || 0));
    video.currentTime = target;
    setCurrentTime(target);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  };

  const setVideoVolume = (value: number) => {
    const video = videoRef.current;
    const next = Math.max(0, Math.min(value, 1));
    setVolume(next);
    setMuted(next === 0);
    if (video) {
      video.volume = next;
      video.muted = next === 0;
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setMuted(next);
  };

  const toggleFullscreen = () => {
    const target = dockRef.current;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      target.requestFullscreen().catch(() => {});
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      togglePlay();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekTo(currentTime - 10);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      seekTo(currentTime + 10);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setVideoVolume(volume + 0.08);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setVideoVolume(volume - 0.08);
    }
    if (event.key === "Escape") onClose();
  };

  return (
    <section className="player-dock" ref={dockRef} tabIndex={0} onKeyDown={handleKeyDown} aria-label="Video player">
      <div className="player-stage">
        <video
          ref={videoRef}
          src={media.urls?.stream || ""}
          poster={media.urls?.poster || undefined}
          playsInline
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : media.duration || 0)}
          onVolumeChange={(event) => {
            setVolume(event.currentTarget.volume);
            setMuted(event.currentTarget.muted);
          }}
        />
        <button className="center-play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "Pause" : "Play"}
        </button>
      </div>

      <div className="player-controls">
        <div className="player-copy">
          <span>Now playing</span>
          <strong>{media.title}</strong>
          <small>
            {formatDuration(duration || media.duration)} - {media.video.width}x{media.video.height} -{" "}
            {media.video.copied ? "video copy" : "transcoded"}
          </small>
        </div>

        <div className="timeline-row">
          <span>{formatDuration(currentTime)}</span>
          <input
            className="timeline"
            type="range"
            min="0"
            max={Math.max(duration || 0, 1)}
            step="0.25"
            value={Math.min(currentTime, Math.max(duration || 0, 1))}
            onChange={(event) => seekTo(Number(event.target.value))}
            aria-label="Seek"
          />
          <span>{formatDuration(duration || media.duration)}</span>
        </div>

        <div className="control-row">
          <button onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
          <button className="ghost" onClick={() => seekTo(currentTime - 10)}>
            -10s
          </button>
          <button className="ghost" onClick={() => seekTo(currentTime + 10)}>
            +10s
          </button>
          <button className="ghost" onClick={toggleMute}>
            {muted ? "Sound on" : "Mute"}
          </button>
          <input
            className="volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={muted ? 0 : volume}
            onChange={(event) => setVideoVolume(Number(event.target.value))}
            aria-label="Volume"
          />
          <button className="ghost" onClick={toggleFullscreen}>
            Fullscreen
          </button>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
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
  const latest = ready[0];

  return (
    <main className="content-grid">
      <section className="library-hero">
        <div>
          <span className="eyebrow">Marathon palette</span>
          <h2>{ready.length} streams online</h2>
          <p>Poster panels, big focus states, and remote-friendly controls for sofa playback.</p>
        </div>
        {latest && (
          <button className="hero-action" onClick={() => onSelect(latest)}>
            Resume latest
          </button>
        )}
      </section>

      {media.length === 0 && <div className="empty panel">No prepared videos yet. Open Storage and prepare a source file.</div>}

      <section className="media-grid" aria-label="Prepared videos">
        {media.map((item) => {
          const state = watchState[item.id];
          const percent = state?.duration ? Math.min(100, Math.round((state.position / state.duration) * 100)) : 0;
          return (
            <article
              className="media-card"
              key={item.id}
              tabIndex={0}
              onClick={() => item.ready && onSelect(item)}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && item.ready) {
                  event.preventDefault();
                  onSelect(item);
                }
              }}
            >
              <div className="poster-frame">
                {item.urls?.poster ? <img src={item.urls.poster} alt="" /> : <div className="poster-placeholder" />}
                <span className={item.ready ? "status ready" : "status"}>{item.ready ? "Ready" : `${item.progress}%`}</span>
                <div className="watch-bar">
                  <i style={{ width: `${percent}%` }} />
                </div>
              </div>
              <div className="media-meta">
                <strong>{item.title}</strong>
                <small>{item.sourceRelativePath}</small>
                <div className="meta-pills">
                  <span>{item.video.width ? `${item.video.width}p` : item.video.codec || "video"}</span>
                  <span>{item.audio.codec} {item.audio.channels}ch</span>
                  <span>{percent ? `${percent}%` : "new"}</span>
                </div>
              </div>
              <button disabled={!item.ready} onClick={(event) => {
                event.stopPropagation();
                onSelect(item);
              }}>
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
            <span className="eyebrow">Preparing</span>
            {jobs.map((job) => (
              <div className="job-card" key={job.id}>
                <div>
                  <strong>{job.media.title}</strong>
                  <small>{job.status === "error" ? job.error || "error" : `${job.progress}% ready`}</small>
                </div>
                <div className="bar">
                  <i style={{ width: `${job.progress}%` }} />
                </div>
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
                  <div className="bar">
                    <i style={{ width: `${job?.progress || 0}%` }} />
                  </div>
                  <small>{job ? `${job.status} - ${job.progress}%` : "idle"}</small>
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
  if (!seconds) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
