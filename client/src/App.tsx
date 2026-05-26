import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getDeviceId } from "./api";
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
  const [deviceId] = useState(() => getDeviceId());
  const [fullscreenRequestId, setFullscreenRequestId] = useState<string | null>(null);
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

  function selectMedia(item: MediaManifest) {
    setSelected(item);
    setFullscreenRequestId(item.id);
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(".player-dock")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelector<HTMLElement>(".player-dock")?.focus();
    }, 0);
  }

  const selectedState = selected ? watchState[selected.id] : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <span className="eyebrow">Lime Glass Cinema</span>
          <h1>Stream HS</h1>
          <small className="device-label">Device {deviceId.slice(-8)}</small>
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

      <PlayerDock
        media={selected}
        playlist={media.filter((item) => item.ready)}
        watchState={selectedState}
        onClose={() => setSelected(null)}
        onSaved={refreshLibrary}
        onSelect={selectMedia}
        fullscreenRequestId={fullscreenRequestId}
        onFullscreenRequestHandled={() => setFullscreenRequestId(null)}
      />

      {view === "library" ? (
        <LibraryPage media={media} watchState={watchState} onSelect={selectMedia} />
      ) : (
        <StoragePage
          config={config}
          sourceRootInput={sourceRootInput}
          setSourceRootInput={setSourceRootInput}
          saveSourceRoot={saveSourceRoot}
          source={source}
          media={media}
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
  playlist,
  watchState,
  onClose,
  onSaved,
  onSelect,
  fullscreenRequestId,
  onFullscreenRequestHandled
}: {
  media: MediaManifest | null;
  playlist: MediaManifest[];
  watchState: WatchState | null;
  onClose: () => void;
  onSaved: () => void;
  onSelect: (media: MediaManifest) => void;
  fullscreenRequestId: string | null;
  onFullscreenRequestHandled: () => void;
}) {
  const dockRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const firstPlaylistRef = useRef<HTMLButtonElement | null>(null);
  const playlistButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const controlButtonRefs = useRef<Array<HTMLButtonElement | HTMLInputElement | null>>([]);
  const lastSavedRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [videoError, setVideoError] = useState("");
  const hideTimerRef = useRef<number | null>(null);

  function showControls() {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setControlsVisible(false);
    }, 2600);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !media) return;
    lastSavedRef.current = 0;
    setCurrentTime(0);
    setDuration(media.duration || 0);
    setPlaying(false);
    setBuffering(true);
    setPlaylistOpen(false);
    setVideoError("");
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

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === dockRef.current;
      if (active) {
        showControls();
        window.setTimeout(() => dockRef.current?.focus(), 60);
      } else {
        setPlaylistOpen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!media || fullscreenRequestId !== media.id || !dockRef.current) return;
    dockRef.current.focus();
    dockRef.current.requestFullscreen().catch(() => {});
    onFullscreenRequestHandled();
  }, [media?.id, fullscreenRequestId, onFullscreenRequestHandled]);

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
    showControls();
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
    handlePlayerKeyDown(event);
  };

  const handlePlayerKeyDown = (event: Pick<React.KeyboardEvent, "key" | "keyCode" | "which" | "preventDefault">) => {
    const keyCode = event.keyCode || event.which;
    const key = event.key;
    const active = document.activeElement as HTMLElement | null;
    const activePlaylistIndex = playlistButtonRefs.current.findIndex((button) => button === active);
    const activeControlIndex = controlButtonRefs.current.findIndex((button) => button === active);

    showControls();

    if (!playlistOpen && document.fullscreenElement === dockRef.current && (key === "ArrowDown" || keyCode === 40)) {
      event.preventDefault();
      setPlaylistOpen(true);
      window.setTimeout(() => firstPlaylistRef.current?.focus(), 120);
      return;
    }

    if (playlistOpen) {
      const currentPlaylistIndex = activePlaylistIndex >= 0 ? activePlaylistIndex : 0;
      if (key === "ArrowDown" || keyCode === 40) {
        event.preventDefault();
        playlistButtonRefs.current[Math.min(currentPlaylistIndex + 1, playlistButtonRefs.current.length - 1)]?.focus();
        return;
      }
      if (key === "ArrowUp" || keyCode === 38) {
        event.preventDefault();
        playlistButtonRefs.current[Math.max(currentPlaylistIndex - 1, 0)]?.focus();
        return;
      }
      if (key === "ArrowLeft" || keyCode === 37 || key === "Escape" || key === "BrowserBack" || keyCode === 10009 || keyCode === 461) {
        event.preventDefault();
        setPlaylistOpen(false);
        dockRef.current?.focus();
        return;
      }
      if (key === "Enter" || key === " " || keyCode === 13) {
        event.preventDefault();
        const target = activePlaylistIndex >= 0 ? active : playlistButtonRefs.current[0];
        target?.click();
        return;
      }
      return;
    }

    if (activeControlIndex >= 0) {
      if (key === "ArrowRight" || keyCode === 39) {
        event.preventDefault();
        controlButtonRefs.current[Math.min(activeControlIndex + 1, controlButtonRefs.current.length - 1)]?.focus();
        return;
      }
      if (key === "ArrowLeft" || keyCode === 37) {
        event.preventDefault();
        controlButtonRefs.current[Math.max(activeControlIndex - 1, 0)]?.focus();
        return;
      }
      if (key === "ArrowUp" || keyCode === 38) {
        event.preventDefault();
        dockRef.current?.focus();
        return;
      }
      if (key === "ArrowDown" || keyCode === 40) {
        event.preventDefault();
        setPlaylistOpen(true);
        window.setTimeout(() => firstPlaylistRef.current?.focus(), 120);
        return;
      }
      if (key === "Enter" || key === " " || keyCode === 13) {
        event.preventDefault();
        active?.click();
        return;
      }
    }

    if ([" ", "Enter", "MediaPlayPause", "Play", "Pause", "k"].includes(key) || keyCode === 13 || keyCode === 10252) {
      event.preventDefault();
      togglePlay();
      return;
    }
    if (key === "MediaPlay" || keyCode === 415) {
      event.preventDefault();
      videoRef.current?.play().catch(() => {});
      return;
    }
    if (key === "MediaPause" || keyCode === 19) {
      event.preventDefault();
      videoRef.current?.pause();
      return;
    }
    if (key === "ArrowLeft" || keyCode === 37) {
      event.preventDefault();
      seekTo(currentTime - 10);
    }
    if (key === "ArrowRight" || keyCode === 39) {
      event.preventDefault();
      seekTo(currentTime + 10);
    }
    if (key === "ArrowUp" || keyCode === 38) {
      event.preventDefault();
      controlButtonRefs.current[0]?.focus();
      return;
    }
    if (key === "ArrowDown" || keyCode === 40) {
      event.preventDefault();
      setVideoVolume(volume - 0.08);
    }
    if (key === "Escape" || key === "BrowserBack" || keyCode === 10009 || keyCode === 461) {
      event.preventDefault();
      if (playlistOpen) {
        setPlaylistOpen(false);
      } else {
        onClose();
      }
    }
  };

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (!media || document.fullscreenElement !== dockRef.current) return;
      handlePlayerKeyDown(event);
    };
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  });

  if (!media) return null;

  return (
    <section
      className={`player-dock ${controlsVisible || !playing ? "controls-visible" : "controls-hidden"} ${playing ? "is-playing" : "is-paused"}`}
      data-playlist-open={playlistOpen ? "true" : "false"}
      ref={dockRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={showControls}
      onFocus={showControls}
      aria-label="Video player"
    >
      <div className="player-stage">
        <video
          ref={videoRef}
          src={media.urls?.stream || ""}
          poster={media.urls?.poster || undefined}
          playsInline
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadStart={() => setBuffering(true)}
          onWaiting={() => setBuffering(true)}
          onSeeking={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onPlaying={() => setBuffering(false)}
          onSeeked={() => setBuffering(false)}
          onError={(event) => {
            const code = event.currentTarget.error?.code;
            setBuffering(false);
            setVideoError(code ? `Video error ${code}` : "Video failed to load");
          }}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : media.duration || 0)}
          onVolumeChange={(event) => {
            setVolume(event.currentTarget.volume);
            setMuted(event.currentTarget.muted);
          }}
        />
        <div className="player-topbar">
          <button className="icon-button ghost back-button" onClick={onClose} aria-label="Back">
            <Icon name="back" />
          </button>
          <div className="player-copy">
            <span>Now playing</span>
            <strong>{media.title}</strong>
          </div>
        </div>

        <button className="center-play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          <Icon name={playing ? "pause" : "play"} />
        </button>

        {buffering && (
          <div className="player-loader" aria-label="Loading video">
            <span />
            <span />
            <span />
          </div>
        )}

        {videoError && (
          <div className="player-error">
            <strong>{videoError}</strong>
            <small>{media.urls?.stream || "Missing stream URL"}</small>
          </div>
        )}

        <div className="player-controls">
          <div className="timeline-row">
            <span>{formatDuration(currentTime)}</span>
            <input
              className="timeline"
              type="range"
              min="0"
              max={Math.max(duration || 0, 1)}
              step="0.25"
              value={Math.min(currentTime, Math.max(duration || 0, 1))}
              style={{ "--range-fill": `${duration ? Math.min(100, (currentTime / duration) * 100) : 0}%` } as React.CSSProperties}
              onChange={(event) => seekTo(Number(event.target.value))}
              aria-label="Seek"
            />
            <span>{formatDuration(duration || media.duration)}</span>
          </div>

          <div className="control-row">
            <div className="control-left">
              <small>
                {media.video.width}x{media.video.height} - {media.video.copied ? "copy" : "transcoded"}
              </small>
            </div>
            <div className="control-center">
            <button ref={(element) => { controlButtonRefs.current[0] = element; }} className="icon-button ghost" onClick={() => seekTo(currentTime - 10)} aria-label="Back 10 seconds">
              <Icon name="rewind" />
            </button>
            <button ref={(element) => { controlButtonRefs.current[1] = element; }} className="icon-button primary-icon" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <button ref={(element) => { controlButtonRefs.current[2] = element; }} className="icon-button ghost" onClick={() => seekTo(currentTime + 10)} aria-label="Forward 10 seconds">
              <Icon name="forward" />
            </button>
            </div>
            <div className="control-right">
              <button ref={(element) => { controlButtonRefs.current[3] = element; }} className="icon-button ghost" onClick={toggleMute} aria-label={muted ? "Sound on" : "Mute"}>
                <Icon name={muted || volume === 0 ? "volumeOff" : "volume"} />
              </button>
              <input
                ref={(element) => { controlButtonRefs.current[4] = element; }}
                className="volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={muted ? 0 : volume}
                style={{ "--range-fill": `${muted ? 0 : volume * 100}%` } as React.CSSProperties}
                onChange={(event) => setVideoVolume(Number(event.target.value))}
                aria-label="Volume"
              />
              <button ref={(element) => { controlButtonRefs.current[5] = element; }} className="icon-button ghost" onClick={toggleFullscreen} aria-label="Fullscreen">
                <Icon name="fullscreen" />
              </button>
              <button
                ref={(element) => { controlButtonRefs.current[6] = element; }}
                className="icon-button ghost playlist-toggle"
                onClick={() => {
                  const next = !playlistOpen;
                  setPlaylistOpen(next);
                  showControls();
                  if (next) window.setTimeout(() => firstPlaylistRef.current?.focus(), 120);
                }}
                aria-label="Playlist"
              >
                <Icon name="playlist" />
              </button>
            </div>
          </div>
        </div>

        <aside className="player-playlist" aria-label="Playlist">
          <div className="playlist-head">
            <span className="eyebrow">Playlist</span>
            <strong>{playlist.length} videos</strong>
          </div>
          <div className="playlist-items">
            {playlist.map((item, index) => (
              <button
                ref={(element) => {
                  playlistButtonRefs.current[index] = element;
                  if (index === 0) firstPlaylistRef.current = element;
                }}
                className={item.id === media.id ? "playlist-item active" : "playlist-item"}
                key={item.id}
                onClick={() => {
                  showControls();
                  onSelect(item);
                }}
              >
                <span className="playlist-thumb">
                  {item.urls?.poster ? <img src={item.urls.poster} alt="" /> : <i />}
                  <b>{formatDuration(item.duration)}</b>
                  <span className="playlist-index">{String(index + 1).padStart(2, "0")}</span>
                </span>
                <span className="playlist-copy">
                  <strong>{item.title}</strong>
                  <small>{item.sourceRelativePath}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Icon({ name }: { name: "play" | "pause" | "back" | "rewind" | "forward" | "volume" | "volumeOff" | "fullscreen" | "playlist" }) {
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "play") return <svg {...common}><path d="M8 5v14l11-7z" fill="currentColor" stroke="none" /></svg>;
  if (name === "pause") return <svg {...common}><path d="M8 5v14" /><path d="M16 5v14" /></svg>;
  if (name === "back") return <svg {...common}><path d="M15 18l-6-6 6-6" /><path d="M9 12h11" /></svg>;
  if (name === "rewind") return <svg {...common}><path d="M11 19l-8-7 8-7v14z" /><path d="M21 19l-8-7 8-7v14z" /></svg>;
  if (name === "forward") return <svg {...common}><path d="M13 5l8 7-8 7V5z" /><path d="M3 5l8 7-8 7V5z" /></svg>;
  if (name === "volume") return <svg {...common}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 9a5 5 0 010 6" /><path d="M19.5 6.5a8.5 8.5 0 010 11" /></svg>;
  if (name === "volumeOff") return <svg {...common}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M18 9l4 4" /><path d="M22 9l-4 4" /></svg>;
  if (name === "playlist") return <svg {...common}><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></svg>;
  return <svg {...common}><path d="M8 3H5a2 2 0 00-2 2v3" /><path d="M16 3h3a2 2 0 012 2v3" /><path d="M8 21H5a2 2 0 01-2-2v-3" /><path d="M16 21h3a2 2 0 002-2v-3" /></svg>;
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
  const resumeRef = useRef<HTMLButtonElement | null>(null);
  const ready = useMemo(() => media.filter((item) => item.ready), [media]);
  const latest = useMemo(() => {
    return [...ready].sort((a, b) => {
      const aState = watchState[a.id]?.updatedAt || "";
      const bState = watchState[b.id]?.updatedAt || "";
      return bState.localeCompare(aState);
    })[0] || ready[0];
  }, [ready, watchState]);

  useEffect(() => {
    if (!latest || !resumeRef.current) return;
    const timer = window.setTimeout(() => resumeRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [latest?.id, media.length]);
  return (
    <main className="content-grid">
      {latest ? (
        <section className="library-hero">
          <div className="hero-art">
            {latest.urls?.poster ? <img src={latest.urls.poster} alt="" /> : <div className="poster-placeholder" />}
          </div>
          <div className="hero-copy">
            <span className="eyebrow">Featured stream</span>
            <h2>{latest.title}</h2>
            <p>{latest.sourceRelativePath}</p>
            <div className="hero-meta">
              <span>{formatDuration(latest.duration)}</span>
              <span>{latest.video.width ? `${latest.video.width}x${latest.video.height}` : latest.video.codec || "video"}</span>
              <span>{latest.audio.codec} {latest.audio.channels}ch</span>
            </div>
            <button ref={resumeRef} className="hero-action" onClick={() => onSelect(latest)}>
              Resume
            </button>
          </div>
        </section>
      ) : (
        <section className="library-hero empty-hero">
          <div className="hero-copy">
            <span className="eyebrow">Library</span>
            <h2>No streams yet</h2>
            <p>Open Storage and prepare a video file to build your library.</p>
          </div>
        </section>
      )}

      {media.length === 0 && <div className="empty panel">No prepared videos yet. Open Storage and prepare a source file.</div>}

      <MediaGrid title="All prepared" media={media} watchState={watchState} onSelect={onSelect} autoFocusFirst={!latest} />
    </main>
  );
}

function MediaGrid({
  title,
  media,
  watchState,
  onSelect,
  autoFocusFirst = false
}: {
  title: string;
  media: MediaManifest[];
  watchState: Record<string, WatchState>;
  onSelect: (media: MediaManifest) => void;
  autoFocusFirst?: boolean;
}) {
  const firstCardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!autoFocusFirst || !firstCardRef.current) return;
    const timer = window.setTimeout(() => firstCardRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [autoFocusFirst, media.length]);

  if (media.length === 0) return null;

  return (
    <section className="grid-section">
      <div className="grid-header">
        <h3>{title}</h3>
        <span>{media.length}</span>
      </div>
      <div className="media-grid" aria-label={title}>
        {media.map((item, index) => {
          const state = watchState[item.id];
          const percent = state?.duration ? Math.min(100, Math.round((state.position / state.duration) * 100)) : 0;
          return (
            <article
              className="media-card"
              key={item.id}
              ref={index === 0 ? firstCardRef : undefined}
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
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StoragePage({
  config,
  sourceRootInput,
  setSourceRootInput,
  saveSourceRoot,
  source,
  media,
  jobs,
  onNavigate,
  onPrepare
}: {
  config: Config | null;
  sourceRootInput: string;
  setSourceRootInput: (value: string) => void;
  saveSourceRoot: (event: React.FormEvent) => void;
  source: SourceBrowse | null;
  media: MediaManifest[];
  jobs: PrepareJob[];
  onNavigate: (path: string) => void;
  onPrepare: (path: string) => void;
}) {
  const jobByPath = new Map(jobs.map((job) => [job.media.sourceRelativePath, job]));
  const mediaByPath = new Map(media.map((item) => [item.sourceRelativePath, item]));

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
            const prepared = mediaByPath.get(video.path);
            const status = job ? job.status : prepared?.ready ? "ready" : "idle";
            const progress = job?.progress ?? prepared?.progress ?? 0;
            return (
              <article className={prepared?.ready ? "raw-row is-ready" : "raw-row"} key={video.path}>
                <div>
                  <strong>{video.name}</strong>
                  <small>{formatSize(video.size)}</small>
                </div>
                <span className={prepared?.ready ? "raw-status ready" : "raw-status"}>{prepared?.ready ? "ready" : video.directPlay ? "direct" : "prepare"}</span>
                <div className="progress-cell">
                  <div className="bar">
                    <i style={{ width: `${prepared?.ready ? 100 : progress}%` }} />
                  </div>
                  <small>{prepared?.ready ? "prepared in media" : job ? `${status} - ${progress}%` : "idle"}</small>
                </div>
                <button onClick={() => onPrepare(video.path)} disabled={job?.status === "processing" || prepared?.ready}>
                  {prepared?.ready ? "Ready" : job?.status === "processing" ? "Preparing" : "Prepare"}
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
