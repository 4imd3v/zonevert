// Pure video-conversion planning: (ffprobe summary x profile intent) -> tested
// ffmpeg argv. No DOM, no IPC. Phase 3 (atomic output) and Phase 4 (UI)
// consume this. Hardware encoder resolution is Phase 5 — until then every
// profile plans its CPU encoder, and `chosenVideoEncoder` says which.

import { dirname, extension, joinPath, stem } from "./conversion-plan";
import type { MediaProbeResult } from "$lib/bindings";

export type VideoProfile = "mp4-h264" | "webm-vp9" | "mp4-hevc";
export type VideoResolution = "source" | "1080p" | "720p" | "480p";
export type VideoFps = "source" | 24 | 30 | 60;
export type EncoderPreference = "auto" | "cpu";

export interface VideoIntent {
  profile: VideoProfile;
  resolution: VideoResolution;
  fps: VideoFps;
  /** 0-63; clamped to the selected encoder's range at plan time. */
  crf: number;
  encoder: EncoderPreference;
  collisionMode: "overwrite" | "skip";
  outputDir: string;
}

export interface VideoPlanResult {
  ok: boolean;
  /** Set when ok is false: why this input/profile combination can't run. */
  rejection?: string;
  warnings: string[];
  /** Complete argv (output path last) — Phase 3 swaps the last arg for the temp path. */
  args: string[];
  outputPath: string;
  outputExt: string;
  remuxOnly: boolean;
  chosenVideoEncoder: string;
}

type Probe = MediaProbeResult | null | undefined;

interface VideoCodecSpec {
  videoEncoder: string;
  audioEncoder: string;
  outputExt: string;
  /** quality flag for this encoder (-crf for libx264/libx265/libvpx-vp9). */
  qualityFlag: string;
  crfMin: number;
  crfMax: number;
  crfDefault: number;
  videoArgs: string[];
  audioArgs: string[];
  muxArgs: string[];
  /** codec names that allow `-c copy` remux into this profile's container. */
  remux: { video: string[]; audio: string[] };
}

const VIDEO_SPECS: Record<VideoProfile, VideoCodecSpec> = {
  "mp4-h264": {
    videoEncoder: "libx264",
    audioEncoder: "aac",
    outputExt: "mp4",
    qualityFlag: "-crf",
    crfMin: 0,
    crfMax: 51,
    crfDefault: 23,
    videoArgs: ["-preset", "medium", "-pix_fmt", "yuv420p"],
    audioArgs: ["-b:a", "128k"],
    muxArgs: ["-movflags", "+faststart"],
    remux: { video: ["h264"], audio: ["aac"] },
  },
  "webm-vp9": {
    videoEncoder: "libvpx-vp9",
    audioEncoder: "libopus",
    outputExt: "webm",
    qualityFlag: "-crf",
    crfMin: 0,
    crfMax: 63,
    crfDefault: 31,
    videoArgs: ["-b:v", "0", "-deadline", "good", "-cpu-used", "2"],
    audioArgs: ["-b:a", "128k"],
    muxArgs: [],
    remux: { video: ["vp9"], audio: ["opus"] },
  },
  "mp4-hevc": {
    videoEncoder: "libx265",
    audioEncoder: "aac",
    outputExt: "mp4",
    qualityFlag: "-crf",
    crfMin: 0,
    crfMax: 51,
    crfDefault: 28,
    // -tag:v hvc1: without it QuickTime/Safari refuse HEVC mp4 playback.
    videoArgs: ["-preset", "medium", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"],
    audioArgs: ["-b:a", "128k"],
    muxArgs: ["-movflags", "+faststart"],
    remux: { video: ["hevc"], audio: ["aac"] },
  },
};

const RESOLUTION_HEIGHT: Record<Exclude<VideoResolution, "source">, number> = {
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
};

const DEFAULT_PROFILE: VideoProfile = "mp4-h264";

// ---- intent ----

export function createVideoIntent(options: {
  profile?: string;
  resolution?: string;
  fps?: number | string;
  crf?: number;
  encoder?: string;
  collisionMode?: string;
  outputDir?: string;
} = {}): VideoIntent {
  return {
    profile: normalizeProfile(options.profile),
    resolution: normalizeResolution(options.resolution),
    fps: normalizeFps(options.fps),
    crf: clamp(Number(options.crf) || VIDEO_SPECS[normalizeProfile(options.profile)].crfDefault, 0, 63),
    encoder: options.encoder === "cpu" ? "cpu" : "auto",
    collisionMode: options.collisionMode === "skip" ? "skip" : "overwrite",
    outputDir: String(options.outputDir || ""),
  };
}

function normalizeProfile(value: unknown): VideoProfile {
  const v = String(value || "");
  return v === "webm-vp9" || v === "mp4-hevc" ? v : DEFAULT_PROFILE;
}

const RESOLUTIONS = new Set<string>(["source", "1080p", "720p", "480p"]);
const FPS_VALUES = new Set<string>(["24", "30", "60"]);

function normalizeResolution(value: unknown): VideoResolution {
  const v = String(value || "source");
  return (RESOLUTIONS.has(v) ? v : "source") as VideoResolution;
}

function normalizeFps(value: unknown): VideoFps {
  const v = String(value ?? "");
  return (FPS_VALUES.has(v) ? Number(v) : "source") as VideoFps;
}

// ---- planning ----

export function planVideoConversion(
  file: { path: string; name: string },
  probe: Probe,
  intent: VideoIntent,
): VideoPlanResult {
  const spec = VIDEO_SPECS[intent.profile] ?? VIDEO_SPECS[DEFAULT_PROFILE];
  const reject = (rejection: string): VideoPlanResult => ({
    ok: false,
    rejection,
    warnings: [],
    args: [],
    outputPath: "",
    outputExt: spec.outputExt,
    remuxOnly: false,
    chosenVideoEncoder: spec.videoEncoder,
  });

  if (!probe || !probe.ok) {
    return reject("ffprobe could not read this file.");
  }
  const video = probe.video;
  if (!video) {
    return reject("No video stream found (audio-only files can't be converted to video).");
  }
  if (!(video.width! > 0) || !(video.height! > 0)) {
    return reject("Could not read video dimensions.");
  }

  const outputPath = videoOutputPath(file, intent);
  if (samePath(file.path, outputPath)) {
    return reject("Output path would overwrite the input file.");
  }

  const warnings: string[] = [];
  if (!probe.duration) {
    warnings.push("Duration unknown — progress will be indeterminate.");
  }

  const wantsTransform = intent.resolution !== "source" || intent.fps !== "source";
  const remuxOnly = !wantsTransform && canRemux(probe, spec);

  const args = ["-hide_banner", intent.collisionMode === "skip" ? "-n" : "-y", "-i", file.path];
  // 0:a:0? — optional audio map: video without an audio stream must still work.
  args.push("-map", "0:v:0", "-map", "0:a:0?");

  if (remuxOnly) {
    args.push("-c", "copy");
    args.push(...spec.muxArgs);
  } else {
    if (intent.resolution !== "source") {
      const target = RESOLUTION_HEIGHT[intent.resolution];
      args.push("-vf", `scale=-2:${target}`);
      if (video.height! < target) {
        warnings.push(`Upscaling from ${video.height}p to ${target}p will not improve quality.`);
      }
    }
    if (intent.fps !== "source") {
      args.push("-r", String(intent.fps));
      warnings.push(`Converting to ${intent.fps} fps re-times the whole video and slows encoding.`);
    }
    const crf = clamp(Math.round(intent.crf), spec.crfMin, spec.crfMax);
    args.push("-c:v", spec.videoEncoder, spec.qualityFlag, String(crf));
    args.push(...spec.videoArgs);
    args.push("-c:a", spec.audioEncoder);
    args.push(...spec.audioArgs);
    args.push(...spec.muxArgs);
  }

  args.push(outputPath);

  return {
    ok: true,
    warnings,
    args,
    outputPath,
    outputExt: spec.outputExt,
    remuxOnly,
    chosenVideoEncoder: remuxOnly ? "copy" : spec.videoEncoder,
  };
}

/** Remux only when the profile's codecs already match and nothing is resized. */
function canRemux(probe: MediaProbeResult, spec: VideoCodecSpec): boolean {
  const video = probe.video!;
  if (!spec.remux.video.includes(video.codecName)) return false;
  if (probe.audio && !spec.remux.audio.includes(probe.audio.codecName)) return false;
  return true;
}

export function videoOutputPath(
  file: { path: string; name: string },
  intent: VideoIntent,
): string {
  const spec = VIDEO_SPECS[intent.profile] ?? VIDEO_SPECS[DEFAULT_PROFILE];
  const name = file.name || file.path;
  // Same-extension output (mp4 -> mp4-h264) MUST suffix, or we'd overwrite
  // the source.
  const sameExt = extension(name) === spec.outputExt;
  const outName = `${stem(name)}${sameExt ? "-converted" : ""}.${spec.outputExt}`;
  return joinPath(intent.outputDir || dirname(file.path), outName);
}

function samePath(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

function norm(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
