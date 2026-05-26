export type Config = {
  sourceRoot: string;
  mediaRoot: string;
  hasSourceRoot: boolean;
};

export type SourceFolder = {
  name: string;
  path: string;
};

export type SourceVideo = {
  name: string;
  path: string;
  size: number;
  directPlay: boolean;
  modifiedAt: string;
};

export type SourceBrowse = {
  path: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  folders: SourceFolder[];
  videos: SourceVideo[];
};

export type MediaManifest = {
  id: string;
  title: string;
  sourceRelativePath: string;
  status: "processing" | "ready" | "error";
  progress: number;
  duration: number | null;
  video: {
    codec: string | null;
    profile: string | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    copied: boolean;
  };
  audio: {
    sourceCodec: string | null;
    codec: string;
    channels: number;
    bitrate: string;
  };
  error?: string;
  ready?: boolean;
  urls?: {
    stream: string | null;
    poster: string | null;
  };
};

export type PrepareJob = {
  id: string;
  status: string;
  progress: number;
  error: string | null;
  media: MediaManifest;
};

export type WatchState = {
  position: number;
  duration: number | null;
  completed: boolean;
  updatedAt: string;
};

