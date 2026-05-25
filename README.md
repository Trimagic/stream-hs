# Video Streamer

Small web client and Node.js backend for browsing a media folder and streaming video files from the backend to the browser.

## Requirements

- Node.js 20 or newer
- Windows or Ubuntu

No npm dependencies are required.

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

## API

- `GET /api/config` returns current root configuration.
- `POST /api/root` with `{ "path": "..." }` sets the root folder.
- `GET /api/browse?path=relative/path` returns folders and video files.
- `GET /api/video?path=relative/path/file.mp4` streams the selected video.

The backend resolves every media path against the configured root and rejects attempts to access files outside it.
