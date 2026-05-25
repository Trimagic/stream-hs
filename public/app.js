const rootForm = document.querySelector("#rootForm");
const rootInput = document.querySelector("#rootInput");
const rootLabel = document.querySelector("#rootLabel");
const breadcrumbs = document.querySelector("#breadcrumbs");
const folderList = document.querySelector("#folderList");
const videoList = document.querySelector("#videoList");
const message = document.querySelector("#message");
const player = document.querySelector("#player");
const nowPlaying = document.querySelector("#nowPlaying");
const playToggle = document.querySelector("#playToggle");
const currentTimeLabel = document.querySelector("#currentTime");
const seekSlider = document.querySelector("#seekSlider");
const durationTimeLabel = document.querySelector("#durationTime");
const muteToggle = document.querySelector("#muteToggle");
const volumeSlider = document.querySelector("#volumeSlider");

let currentPath = "";
let activePlaybackToken = 0;
let isSeeking = false;
let expectedDuration = null;
let playbackMode = "idle";

player.volume = Number(volumeSlider.value);

rootForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const path = rootInput.value.trim();
  if (!path) return showMessage("Enter a folder path first.");

  try {
    const response = await fetch("/api/root", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path })
    });
    const payload = await readJson(response);
    rootLabel.textContent = payload.root;
    currentPath = "";
    player.removeAttribute("src");
    player.load();
    nowPlaying.textContent = "Select a video";
    expectedDuration = null;
    playbackMode = "idle";
    updateControls();
    await loadFolder("");
  } catch (error) {
    showMessage(error.message);
  }
});

playToggle.addEventListener("click", () => {
  if (!player.src) return;
  if (player.paused) {
    player.play().catch(() => showMessage("Browser blocked playback. Press play again."));
  } else {
    player.pause();
  }
});

player.addEventListener("click", () => {
  if (!player.src) return;
  if (player.paused) {
    player.play().catch(() => {});
  } else {
    player.pause();
  }
});

muteToggle.addEventListener("click", () => {
  player.muted = !player.muted;
  updateVolumeControls();
});

volumeSlider.addEventListener("input", () => {
  player.volume = Number(volumeSlider.value);
  player.muted = player.volume === 0;
  updateVolumeControls();
});

seekSlider.addEventListener("input", () => {
  isSeeking = true;
  currentTimeLabel.textContent = formatTime(sliderValueToTime());
});

seekSlider.addEventListener("change", () => {
  const targetTime = sliderValueToTime();
  if (canSeek()) {
    player.currentTime = targetTime;
  }
  isSeeking = false;
  updateControls();
});

player.addEventListener("play", updateControls);
player.addEventListener("pause", updateControls);
player.addEventListener("ended", updateControls);
player.addEventListener("loadedmetadata", updateControls);
player.addEventListener("durationchange", updateControls);
player.addEventListener("timeupdate", updateControls);
player.addEventListener("volumechange", updateVolumeControls);

async function init() {
  try {
    const response = await fetch("/api/config");
    const config = await readJson(response);

    if (config.configured) {
      rootLabel.textContent = config.root;
      rootInput.value = config.root;
      await loadFolder("");
    } else {
      showMessage("Set a media folder path to start browsing videos.");
      renderEmpty();
    }
  } catch (error) {
    showMessage(error.message);
  }
}

async function loadFolder(path) {
  try {
    clearMessage();
    const response = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
    const data = await readJson(response);
    currentPath = data.path;
    rootLabel.textContent = data.root;
    renderBreadcrumbs(data.breadcrumbs);
    renderFolders(data.folders);
    renderVideos(data.videos);

    if (!data.folders.length && !data.videos.length) {
      showMessage("This folder has no subfolders or supported video files.");
    }
  } catch (error) {
    showMessage(error.message);
    renderEmpty();
  }
}

function renderBreadcrumbs(items) {
  breadcrumbs.replaceChildren(
    ...items.map((item, index) => {
      const button = document.createElement("button");
      button.className = "crumb";
      button.type = "button";
      button.textContent = item.name;
      if (index === items.length - 1) {
        button.setAttribute("aria-current", "page");
      }
      button.addEventListener("click", () => loadFolder(item.path));
      return button;
    })
  );
}

function renderFolders(folders) {
  folderList.replaceChildren(
    ...folders.map((folder) => {
      const button = document.createElement("button");
      button.className = "folder-button";
      button.type = "button";
      button.addEventListener("click", () => loadFolder(folder.path));

      const icon = document.createElement("span");
      icon.className = "folder-icon";
      icon.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "folder-name";
      name.textContent = folder.name;

      button.append(icon, name);
      return button;
    })
  );
}

function renderVideos(videos) {
  videoList.replaceChildren(
    ...videos.map((video) => {
      const row = document.createElement("article");
      row.className = "video-row";

      const name = document.createElement("strong");
      name.className = "video-name";
      name.textContent = video.name;

      const meta = document.createElement("span");
      meta.className = "video-meta";
      meta.textContent = formatSize(video.size);

      const button = document.createElement("button");
      button.className = "video-button";
      button.type = "button";
      button.textContent = "Play";
      button.addEventListener("click", () => playVideo(video, button));

      row.append(name, meta, button);
      return row;
    })
  );
}

async function playVideo(video, button) {
  const playbackToken = ++activePlaybackToken;
  expectedDuration = null;
  playbackMode = video.directPlay ? "file" : "live";

  try {
    clearMessage();
    if (button) {
      button.disabled = true;
      button.textContent = "Opening";
    }

    const source = video.directPlay
      ? `/api/video?path=${encodeURIComponent(video.path)}`
      : await getLiveSource(video.path);

    loadVideoMetadata(video.path, playbackToken);
    player.src = source;
    updateControls();
    await player.play().catch(() => {
      showMessage("Browser blocked autoplay. Press play in the video player.");
    });
    nowPlaying.textContent = video.name;

    if (!video.directPlay) {
      prepareCachedVideo(video.path, playbackToken).catch((error) => {
        if (playbackToken === activePlaybackToken) showMessage(error.message);
      });
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Play";
    }
  }
}

async function prepareCachedVideo(path, playbackToken) {
  showMessage("Realtime playback started. Preparing seekable version in background.");

  for (;;) {
    const response = await fetch("/api/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path })
    });
    const payload = await readJson(response);

    if (payload.status === "ready") {
      if (playbackToken === activePlaybackToken) {
        await switchToPreparedVideo(payload.url);
      }
      return;
    }

    if (payload.status === "error") {
      throw new Error(payload.error || "Video conversion failed.");
    }

    await delay(2500);
  }
}

async function getLiveSource(path) {
  if (!canPlayHls()) {
    return `/api/transcode?path=${encodeURIComponent(path)}`;
  }

  for (;;) {
    const response = await fetch("/api/hls/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path })
    });
    const payload = await readJson(response);

    if (payload.status === "ready") {
      return payload.url;
    }

    if (payload.status === "error") {
      throw new Error(payload.error || "HLS conversion failed.");
    }

    showMessage("Starting TV-compatible stream.");
    await delay(800);
  }
}

function canPlayHls() {
  return Boolean(
    player.canPlayType("application/vnd.apple.mpegurl") ||
    player.canPlayType("application/x-mpegURL")
  );
}

async function switchToPreparedVideo(url) {
  const resumeAt = Number.isFinite(player.currentTime) ? player.currentTime : 0;
  const wasPaused = player.paused;
  playbackMode = "file";

  player.src = url;
  player.load();

  await new Promise((resolve) => {
    player.addEventListener("loadedmetadata", resolve, { once: true });
  });

  if (resumeAt > 0 && Number.isFinite(player.duration)) {
    player.currentTime = Math.min(resumeAt, Math.max(player.duration - 1, 0));
  }

  if (!wasPaused) {
    await player.play().catch(() => {});
  }

  showMessage("Prepared version is ready. Duration, pause, and seeking should now work normally.");
}

async function loadVideoMetadata(path, playbackToken) {
  try {
    const response = await fetch(`/api/metadata?path=${encodeURIComponent(path)}`);
    const metadata = await readJson(response);
    if (playbackToken !== activePlaybackToken) return;

    expectedDuration = Number.isFinite(metadata.duration) ? metadata.duration : null;
    updateControls();
  } catch {
    expectedDuration = null;
  }
}

function updateControls() {
  playToggle.textContent = player.paused ? "Play" : "Pause";
  const visibleDuration = getVisibleDuration();

  if (!canSeek()) {
    seekSlider.disabled = true;
    seekSlider.value = "0";
    currentTimeLabel.textContent = formatTime(player.currentTime || 0);
    durationTimeLabel.textContent = visibleDuration ? formatTime(visibleDuration) : player.src ? "Live" : "0:00";
    updateVolumeControls();
    return;
  }

  seekSlider.disabled = false;
  durationTimeLabel.textContent = formatTime(visibleDuration || player.duration);
  currentTimeLabel.textContent = formatTime(player.currentTime || 0);

  if (!isSeeking) {
    const progress = player.duration ? (player.currentTime / player.duration) * 1000 : 0;
    seekSlider.value = String(Math.max(0, Math.min(1000, progress)));
  }

  updateVolumeControls();
}

function updateVolumeControls() {
  muteToggle.textContent = player.muted || player.volume === 0 ? "Muted" : "Sound";
  if (Number(volumeSlider.value) !== player.volume) {
    volumeSlider.value = String(player.volume);
  }
}

function canSeek() {
  return playbackMode === "file" && Number.isFinite(player.duration) && player.duration > 0;
}

function getVisibleDuration() {
  if (playbackMode === "live" && expectedDuration) return expectedDuration;
  if (Number.isFinite(player.duration) && player.duration > 0) return player.duration;
  return expectedDuration;
}

function sliderValueToTime() {
  if (!canSeek()) return 0;
  return (Number(seekSlider.value) / 1000) * player.duration;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function renderEmpty() {
  breadcrumbs.replaceChildren();
  folderList.replaceChildren();
  videoList.replaceChildren();
}

function showMessage(text) {
  message.hidden = false;
  message.textContent = text;
}

function clearMessage() {
  message.hidden = true;
  message.textContent = "";
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

init();
updateControls();
