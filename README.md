# Video Streamer

Small web client and Node.js backend for browsing a media folder and streaming video files from the backend to the browser.

## Requirements

- Node.js 20 or newer
- Windows or Ubuntu

No npm dependencies are required.

For `.mkv`, `.avi`, `.wmv`, and some `.mov` files, install `ffmpeg` so the server can transcode video and audio to a browser-friendly stream:

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

The web player uses custom controls for play/pause, time, seeking, mute, and volume. For MKV on native-HLS clients such as many TVs, seeking uses a stable progressive HLS playlist and generates missing segments on demand.

## Supported video files

The browser lists folders plus these video extensions:

```text
.mp4 .m4v .webm .ogv .ogg .mov .mkv .avi .wmv
```

Streaming supports HTTP byte ranges, so the browser can seek inside directly playable videos.
MKV playback starts immediately. TV browsers with native HLS support get a stable `.m3u8` VOD playlist from `.cache/hls/vod`; the server prepares the first few `.ts` segments before returning the playlist, then generates later segments with `ffmpeg` on demand and caches them. Browsers without native HLS fall back to live MP4 transcoding with stream restart on seek.

## API

- `GET /api/config` returns current root configuration.
- `POST /api/root` with `{ "path": "..." }` sets the root folder.
- `GET /api/browse?path=relative/path` returns folders and video files.
- `GET /api/video?path=relative/path/file.mp4` streams the selected video.
- `GET /api/metadata?path=relative/path/file.mkv` returns real video duration from `ffprobe`.
- `POST /api/hls/vod/start` with `{ "path": "relative/path/file.mkv" }` starts a progressive HLS VOD session for native-HLS clients.
- `POST /api/hls/start` with `{ "path": "relative/path/file.mkv", "start": 1200 }` starts an HLS stream from the selected second.
- `GET /api/transcode?path=relative/path/file.mkv&start=1200` live-transcodes to MP4/AAC from the selected second; kept as a fallback endpoint.

The backend resolves every media path against the configured root and rejects attempts to access files outside it.
