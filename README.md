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
MKV playback starts immediately. TV browsers with native HLS support get an `.m3u8` stream from `.cache/hls`, which is more reliable for televisions than fragmented MP4. Browsers without native HLS fall back to live MP4 transcoding. In parallel, the server prepares and caches a browser-friendly MP4 in `.cache/transcoded`; when it is ready, the client switches to the cached file so duration, seeking, and pause work normally.

## API

- `GET /api/config` returns current root configuration.
- `POST /api/root` with `{ "path": "..." }` sets the root folder.
- `GET /api/browse?path=relative/path` returns folders and video files.
- `GET /api/video?path=relative/path/file.mp4` streams the selected video.
- `POST /api/prepare` with `{ "path": "relative/path/file.mkv" }` prepares and caches a browser-compatible MP4.
- `POST /api/hls/start` with `{ "path": "relative/path/file.mkv" }` starts an HLS stream for native-HLS clients such as many TV browsers.
- `GET /api/cache?key=...` streams a prepared MP4 from cache.
- `GET /api/transcode?path=relative/path/file.mkv` live-transcodes to MP4/AAC while streaming; kept as a fallback endpoint.

The backend resolves every media path against the configured root and rejects attempts to access files outside it.
