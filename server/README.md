# Stream HS Server

Fastify backend for preparing source videos into browser/TV-friendly MP4 files and streaming them with HTTP Range.

## Install

```bash
cd server
npm install
```

FFmpeg and FFprobe must be available in `PATH`.

## Run

```bash
SOURCE_ROOT="/path/to/source/videos" npm run dev
```

The backend listens on `http://localhost:4000` by default.

Prepared media is written to `../media` by default:

```text
media/
  <video-id>/
    manifest.json
    stream.mp4
    poster.jpg
```

## API

- `GET /health`
- `GET /api/config`
- `POST /api/config/source-root` with `{ "path": "..." }`
- `GET /api/source/browse?path=relative/path`
- `POST /api/media/prepare` with `{ "path": "relative/path/file.mkv" }`
- `GET /api/media/jobs`
- `GET /api/media`
- `GET /api/media/:id`
- `GET /api/media/:id/stream`
- `GET /api/media/:id/poster`

## Prepare Logic

If the source video codec is H.264/AVC, video is copied without quality loss:

```bash
ffmpeg -i input.mkv -c:v copy -c:a aac -b:a 384k -ac 2 -movflags +faststart stream.mp4
```

If the source video is not H.264/AVC, video is transcoded to H.264.
