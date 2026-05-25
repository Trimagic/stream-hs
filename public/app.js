const rootForm = document.querySelector("#rootForm");
const rootInput = document.querySelector("#rootInput");
const rootLabel = document.querySelector("#rootLabel");
const breadcrumbs = document.querySelector("#breadcrumbs");
const folderList = document.querySelector("#folderList");
const videoList = document.querySelector("#videoList");
const message = document.querySelector("#message");
const player = document.querySelector("#player");
const nowPlaying = document.querySelector("#nowPlaying");

let currentPath = "";

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
    await loadFolder("");
  } catch (error) {
    showMessage(error.message);
  }
});

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
      button.addEventListener("click", () => playVideo(video));

      row.append(name, meta, button);
      return row;
    })
  );
}

function playVideo(video) {
  const source = `/api/video?path=${encodeURIComponent(video.path)}`;
  player.src = source;
  player.play().catch(() => {
    showMessage("Browser blocked autoplay. Press play in the video player.");
  });
  nowPlaying.textContent = video.name;
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
