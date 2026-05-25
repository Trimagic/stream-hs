# Video Streamer

Small web client and Node.js backend for browsing a media folder and streaming video files from the backend to the browser.

## Requirements

- Node.js 20 or newer
- Windows or Ubuntu

No npm dependencies are required.

For `.mkv`, `.avi`, `.wmv`, and some `.mov` files, install `ffmpeg` so the server can prepare a browser-friendly MP4 copy with AAC audio:

```bash
sudo apt update
sudo apt install ffmpeg
```

## Run

Pass the media folder as an argument:

```bash
node server.js --root "C:\Videos"
```

or on Ubuntu:

```bash
node server.js --root "/home/user/videos"
```

You can also use an environment variable:

```bash
MEDIA_ROOT="/home/user/videos" node server.js
```

Open:

```text
http://localhost:3000
```

If you start the server without a root folder, enter the folder path in the web UI.

## Supported video files

The browser lists folders plus these video extensions:

```text
.mp4 .m4v .webm .ogv .ogg .mov .mkv .avi .wmv
```

Streaming supports HTTP byte ranges, so the browser can seek inside videos.
MKV playback is prepared through `ffmpeg` and cached in `.cache/transcoded`, because browsers often do not support the audio codecs commonly stored in MKV files. The first start can take a few minutes; after that the cached MP4 plays with duration, seeking, and pause support.

## API

- `GET /api/config` returns current root configuration.
- `POST /api/root` with `{ "path": "..." }` sets the root folder.
- `GET /api/browse?path=relative/path` returns folders and video files.
- `GET /api/video?path=relative/path/file.mp4` streams the selected video.
- `POST /api/prepare` with `{ "path": "relative/path/file.mkv" }` prepares and caches a browser-compatible MP4.
- `GET /api/cache?key=...` streams a prepared MP4 from cache.
- `GET /api/transcode?path=relative/path/file.mkv` live-transcodes to MP4/AAC while streaming; kept as a fallback endpoint.

The backend resolves every media path against the configured root and rejects attempts to access files outside it.
