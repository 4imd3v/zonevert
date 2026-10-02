// Pure video-conversion planning: (ffprobe summary x profile intent) -> tested
// ffmpeg argv. No DOM, no IPC. Phase 3 (atomic output) and Phase 4 (UI)
// consume this. Hardware encoders plug in as extra entries per profile;
// `selectVideoEncoder` picks one by preference + availability + validation.

import { dirname, extension, joinPath, stem } from "./conversion-plan";
import type { MediaProbeResult } from "$lib/bindings";

export type VideoProfile = "mp4-h264" | "webm-vp9" | "mp4-hevc" | "gif" | "webp-anim";
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

/** Which hardware encoders the local ffmpeg build actually lists, and which
 *  passed the 1-second validation encode. Either may be null (probe missing
 *  or not run yet) — the planner then stays on CPU without warning. */
export interface EncoderEnvironment {
  availableEncoders?: Iterable<string> | null;
  validatedEncoders?: Iterable<string> | null;
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
  /** Set when a hardware encoder was available but couldn't be used. */
  fallbackWarning?: string;
  /** Approximate output size in bytes (source bitrate scaled by pixel/fps
   *  ratio). Absent when the probe lacks duration or bitrate. */
  estimatedBytes?: number;
}

type Probe = MediaProbeResult | null | undefined;

export interface EncoderEntry {
  /** ffmpeg encoder name: libx264, h264_nvenc, ... */
  name: string;
  /** hardware-accelerated (needs availability + validation before use). */
  hw: boolean;
  crfDefault: number;
  /** Upper bound for the vendor quality value (51 for x264/x265 family,
   *  63 for libvpx-vp9). */
  crfMax: number;
  /** Quality args for a target value — vendor-specific on purpose:
   *  -crf (libx264/libx265/libvpx-vp9), -cq (nvenc), -global_quality (qsv),
   *  -rc cqp -qp_i/-qp_p (amf), -q:v (videotoolbox), -qp (vaapi). */
  qualityArgs: (crf: number) => string[];
  videoArgs: string[];
}

interface VideoCodecSpec {
  audioEncoder: string;
  audioArgs: string[];
  outputExt: string;
  muxArgs: string[];
  /** codec names that allow `-c copy` remux into this profile's container. */
  remux: { video: string[]; audio: string[] };
  /** Preference order: hardware first, CPU last (CPU is always present). */
  encoders: EncoderEntry[];
  /** false for animated-image outputs (GIF/WebP can't carry audio). */
  audio: boolean;
  /** true for GIF: needs the palettegen/paletteuse filter chain. */
  gif: boolean;
}

const X264_ARGS = ["-preset", "medium", "-pix_fmt", "yuv420p"];
const X265_ARGS = ["-preset", "medium", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"];

const VIDEO_SPECS: Record<VideoProfile, VideoCodecSpec> = {
  "mp4-h264": {
    audioEncoder: "aac",
    audioArgs: ["-b:a", "128k"],
    outputExt: "mp4",
    muxArgs: ["-movflags", "+faststart"],
    remux: { video: ["h264"], audio: ["aac"] },
    audio: true,
    gif: false,
    encoders: [
      {
        name: "h264_nvenc",
        hw: true,
        crfDefault: 23,
        crfMax: 51,
        qualityArgs: (c) => ["-cq", String(c)],
        videoArgs: ["-preset", "p4", "-rc", "vbr", "-b:v", "0", "-pix_fmt", "yuv420p"],
      },
      {
        name: "h264_qsv",
        hw: true,
        crfDefault: 23,
        crfMax: 51,
        qualityArgs: (c) => ["-global_quality", String(c)],
        videoArgs: ["-preset", "medium", "-pix_fmt", "yuv420p"],
      },
      {
        name: "h264_amf",
        hw: true,
        crfDefault: 23,
        crfMax: 51,
        qualityArgs: (c) => ["-rc", "cqp", "-qp_i", String(c), "-qp_p", String(c)],
        videoArgs: ["-usage", "transcoding", "-pix_fmt", "yuv420p"],
      },
      {
        name: "h264_videotoolbox",
        hw: true,
        crfDefault: 23,
        crfMax: 51,
        qualityArgs: (c) => ["-q:v", String(c)],
        videoArgs: ["-pix_fmt", "yuv420p"],
      },
      {
        name: "h264_vaapi",
        hw: true,
        crfDefault: 23,
        crfMax: 51,
        qualityArgs: (c) => ["-qp", String(c)],
        videoArgs: ["-pix_fmt", "yuv420p"],
      },
      {
        name: "libx264",
        hw: false,
        crfDefault: 23,
        crfMax: 51,
        qualityArgs: (c) => ["-crf", String(c)],
        videoArgs: X264_ARGS,
      },
    ],
  },
  "webm-vp9": {
    audioEncoder: "libopus",
    outputExt: "webm",
    audioArgs: ["-b:a", "128k"],
    muxArgs: [],
    remux: { video: ["vp9"], audio: ["opus"] },
    audio: true,
    gif: false,
    // ponytail: no VP9 hardware entries in v1 — nvenc VP9 support is uneven
    // across GPU/driver/build combos; libvpx-vp9 covers every machine.
    // Upgrade path: add vp9_* entries once the validation probe can vouch.
    encoders: [
      {
        name: "libvpx-vp9",
        hw: false,
        crfDefault: 31,
        crfMax: 63,
        qualityArgs: (c) => ["-crf", String(c)],
        videoArgs: ["-b:v", "0", "-deadline", "good", "-cpu-used", "2"],
      },
    ],
  },
  "mp4-hevc": {
    audioEncoder: "aac",
    outputExt: "mp4",
    audioArgs: ["-b:a", "128k"],
    muxArgs: ["-movflags", "+faststart"],
    remux: { video: ["hevc"], audio: ["aac"] },
    audio: true,
    gif: false,
    encoders: [
      {
        name: "hevc_nvenc",
        hw: true,
        crfDefault: 28,
        crfMax: 51,
        qualityArgs: (c) => ["-cq", String(c)],
        videoArgs: ["-preset", "p4", "-rc", "vbr", "-b:v", "0", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"],
      },
      {
        name: "hevc_qsv",
        hw: true,
        crfDefault: 28,
        crfMax: 51,
        qualityArgs: (c) => ["-global_quality", String(c)],
        videoArgs: ["-preset", "medium", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"],
      },
      {
        name: "hevc_amf",
        hw: true,
        crfDefault: 28,
        crfMax: 51,
        qualityArgs: (c) => ["-rc", "cqp", "-qp_i", String(c), "-qp_p", String(c)],
        videoArgs: ["-usage", "transcoding", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"],
      },
      {
        name: "hevc_videotoolbox",
        hw: true,
        crfDefault: 28,
        crfMax: 51,
        qualityArgs: (c) => ["-q:v", String(c)],
        videoArgs: ["-pix_fmt", "yuv420p", "-tag:v", "hvc1"],
      },
      {
        name: "hevc_vaapi",
        hw: true,
        crfDefault: 28,
        crfMax: 51,
        qualityArgs: (c) => ["-qp", String(c)],
        videoArgs: ["-pix_fmt", "yuv420p", "-tag:v", "hvc1"],
      },
      {
        name: "libx265",
        hw: false,
        crfDefault: 28,
        crfMax: 51,
        qualityArgs: (c) => ["-crf", String(c)],
        videoArgs: X265_ARGS,
      },
    ],
  },
  "gif": {
    audioEncoder: "",
    outputExt: "gif",
    audioArgs: [],
    muxArgs: [],
    remux: { video: [], audio: [] },
    audio: false,
    gif: true,
    encoders: [
      {
        name: "gif",
        hw: false,
        crfDefault: 23,
        crfMax: 63,
        // qualityArgs unused: GIF quality is the palette dither, built into
        // the filter chain below (bayer_scale, lower = finer).
        qualityArgs: () => [],
        videoArgs: [],
      },
    ],
  },
  "webp-anim": {
    audioEncoder: "",
    outputExt: "webp",
    audioArgs: [],
    muxArgs: [],
    remux: { video: [], audio: [] },
    audio: false,
    gif: false,
    encoders: [
      {
        name: "libwebp_anim",
        hw: false,
        crfDefault: 23,
        crfMax: 63,
        // libwebp quality is 0-100 HIGHER=better; map the shared CRF slider
        // (0-63 lower=better) onto 40-100 so the default lands at ~78.
        qualityArgs: (c) => ["-q:v", String(40 + Math.round(((63 - c) * 60) / 63))],
        videoArgs: ["-loop", "0"],
      },
    ],
  },
};

const RESOLUTION_HEIGHT: Record<Exclude<VideoResolution, "source">, number> = {
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
};

// Re-encoding an already-efficient source at a loose quality target often
// produces a LARGER file than the source — the encoder re-derives detail the
// source already compressed away (observed: 1.1 Mbps H.264 -> VP9 CRF 31 came
// out 45% bigger; the same test with a legacy VP8 source shrank). Downscaling
// is exempt: fewer pixels dominate the size math.
const EFFICIENT_SOURCES = new Set(["h264", "hevc", "vp9", "av1"]);
const LOOSE_CRF = 25;

const DEFAULT_PROFILE: VideoProfile = "mp4-h264";

// ---- intent ----

export function createVideoIntent(options: {
  profile?: string;
  resolution?: string;
  fps?: number | string;
  crf?: number | string;
  encoder?: string;
  collisionMode?: string;
  outputDir?: string;
} = {}): VideoIntent {
  const profile = normalizeProfile(options.profile);
  // crf 0 is valid and falsy — `Number(x) || default` would swallow it.
  const crfRaw = options.crf;
  const crfParsed =
    crfRaw == null || crfRaw === "" ? Number.NaN : Number(crfRaw);
  return {
    profile,
    resolution: normalizeResolution(options.resolution),
    fps: normalizeFps(options.fps),
    crf: Number.isFinite(crfParsed)
      ? clamp(crfParsed, 0, 63)
      : cpuEncoder(specFor(profile)).crfDefault,
    encoder: options.encoder === "cpu" ? "cpu" : "auto",
    collisionMode: options.collisionMode === "skip" ? "skip" : "overwrite",
    outputDir: String(options.outputDir || ""),
  };
}

function normalizeProfile(value: unknown): VideoProfile {
  const v = String(value || "");
  return v === "webm-vp9" || v === "mp4-hevc" || v === "gif" || v === "webp-anim"
    ? v
    : DEFAULT_PROFILE;
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

// ---- encoder selection ----

/**
 * Pick the encoder to plan with. "cpu" always selects the CPU entry. "auto"
 * selects the first hardware entry that the ffmpeg build lists AND that passed
 * the 1-second validation encode; anything else falls back to CPU. A hardware
 * encoder that is listed but failed validation produces a fallbackWarning —
 * the app must never silently ship a broken combo.
 */
export function selectVideoEncoder(
  profile: VideoProfile,
  preference: EncoderPreference,
  env: EncoderEnvironment = {},
): { entry: EncoderEntry; fallbackWarning?: string } {
  const spec = specFor(profile);
  const cpu = cpuEncoder(spec);

  if (preference === "cpu") return { entry: cpu };

  const available = env.availableEncoders ? new Set(env.availableEncoders) : null;
  // No probe ran (or failed): stay quiet on CPU — the app-level ffmpeg
  // status already tells the user their install is broken.
  if (!available) return { entry: cpu };

  const validated = env.validatedEncoders ? new Set(env.validatedEncoders) : new Set<string>();
  const usable = spec.encoders.find((e) => e.hw && available.has(e.name) && validated.has(e.name));
  if (usable) return { entry: usable };

  const rejected = spec.encoders.find((e) => e.hw && available.has(e.name) && !validated.has(e.name));
  return {
    entry: cpu,
    fallbackWarning: rejected
      ? `${rejected.name} did not pass its validation encode — using ${cpu.name} instead.`
      : undefined,
  };
}

/**
 * A 1-second lavfi encode with the entry's real quality args, used by the app
 * to validate a hardware encoder before the first real job. `-f null -` means
 * no output file is written.
 */
export function encoderTestArgs(entry: EncoderEntry): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=256x144:r=5",
    "-map",
    "0:v:0",
    "-t",
    "1",
    "-c:v",
    entry.name,
    ...entry.qualityArgs(entry.crfDefault),
    ...entry.videoArgs,
    "-f",
    "null",
    "-",
  ];
}

// ---- planning ----

export function planVideoConversion(
  file: { path: string; name: string },
  probe: Probe,
  intent: VideoIntent,
  env: EncoderEnvironment = {},
): VideoPlanResult {
  const spec = specFor(intent.profile);
  const { entry, fallbackWarning } = selectVideoEncoder(intent.profile, intent.encoder, env);
  const reject = (rejection: string): VideoPlanResult => ({
    ok: false,
    rejection,
    warnings: [],
    args: [],
    outputPath: "",
    outputExt: spec.outputExt,
    remuxOnly: false,
    chosenVideoEncoder: entry.name,
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
  if (fallbackWarning) warnings.push(fallbackWarning);
  if (!probe.duration) {
    warnings.push("Duration unknown — progress will be indeterminate.");
  }

  const wantsTransform = intent.resolution !== "source" || intent.fps !== "source";
  const remuxOnly = !wantsTransform && canRemux(probe, spec);

  // A CPU encoder that this FFmpeg build doesn't ship (libwebp_anim in LGPL-only
  // builds) fails at the END of a long queue — warn at plan time instead.
  if (!remuxOnly && env.availableEncoders) {
    const available = new Set(env.availableEncoders);
    if (available.size > 0 && !available.has(entry.name)) {
      warnings.push(
        `Your FFmpeg build has no ${entry.name} encoder — ${spec.outputExt} output will fail.`,
      );
    }
  }
  const args = ["-hide_banner", intent.collisionMode === "skip" ? "-n" : "-y", "-i", file.path];
  // Animated-image outputs carry no audio: map video only, -an as insurance.
  if (spec.gif) {
    // No -map for GIF: the filter_complex graph is the video source (a
    // -map 0:v:0 here would starve the graph's unlabeled input pad).
    args.push("-an");
  } else if (spec.audio) {
    // 0:a:0? — optional audio map: video without an audio stream must still work.
    args.push("-map", "0:v:0", "-map", "0:a:0?");
  } else {
    args.push("-map", "0:v:0", "-an");
  }

  if (remuxOnly) {
    args.push("-c", "copy");
    args.push(...spec.muxArgs);
  } else {
    const targetH =
      intent.resolution !== "source" ? RESOLUTION_HEIGHT[intent.resolution] : null;
    const downscaling = targetH != null && targetH < video.height!;
    const crf = clamp(Math.round(intent.crf), 0, entry.crfMax);

    if (spec.gif) {
      // Palette pipeline (fps + scale + palettegen/paletteuse) in one graph.
      args.push("-filter_complex", gifFilterChain(intent, crf));
    } else {
      if (targetH != null) {
        args.push("-vf", `scale=-2:${targetH}`);
      }
      if (intent.fps !== "source") {
        args.push("-r", String(intent.fps));
        warnings.push(`Converting to ${intent.fps} fps re-times the whole video and slows encoding.`);
      }
    }

    args.push("-c:v", entry.name);
    args.push(...entry.qualityArgs(crf));
    args.push(...entry.videoArgs);
    if (spec.audio) {
      args.push("-c:a", spec.audioEncoder);
      args.push(...spec.audioArgs);
    }
    args.push(...spec.muxArgs);

    if (targetH != null && !downscaling) {
      warnings.push(`Upscaling from ${video.height}p to ${targetH}p will not improve quality.`);
    }
    if (targetH != null && entry.hw && !spec.gif) {
      warnings.push("Scaling runs on the CPU even with a hardware encoder — expect slower encodes.");
    }
    if (EFFICIENT_SOURCES.has(video.codecName)) {
      if (spec.gif) {
        warnings.push(
          `Animated GIF is far less efficient than ${video.codecName} — the output will usually be much larger. Raise the quality slider (lower quality) or pick a lower frame rate for smaller files.`,
        );
      } else if (crf >= LOOSE_CRF) {
        warnings.push(
          `Source is already ${video.codecName} — re-encoding at CRF ${crf} may produce a larger file than the source. Raise the CRF (lower quality) if you want a smaller file.`,
        );
      }
    }
  }

  args.push(outputPath);

  return {
    ok: true,
    warnings,
    args,
    outputPath,
    outputExt: spec.outputExt,
    remuxOnly,
    chosenVideoEncoder: remuxOnly ? "copy" : entry.name,
    fallbackWarning,
    estimatedBytes: estimateOutputBytes(probe, intent),
  };
}

/**
 * Approximate output bytes: source bitrate scaled by the pixel-count ratio
 * (resolution change) and fps ratio. At constant quality (what CRF targets)
 * bitrate scales with pixels x fps, so this is the honest baseline — codec
 * changes move it up or down, which the size warning covers. Null when the
 * probe lacks duration or bitrate.
 */
export function estimateOutputBytes(
  probe: Probe,
  intent: VideoIntent,
): number | undefined {
  if (!probe?.ok || !probe.duration || !probe.bitRate) return undefined;
  const video = probe.video;
  let ratio = 1;
  if (intent.resolution !== "source" && video && video.width && video.height) {
    const target = RESOLUTION_HEIGHT[intent.resolution];
    ratio *= (target / video.height) ** 2;
  }
  if (intent.fps !== "source" && video?.frameRate) {
    ratio *= intent.fps / video.frameRate;
  }
  if (!(ratio > 0) || !Number.isFinite(ratio)) return undefined;
  // duration (s) x bitrate (bits/s) = bits -> /8 for bytes.
  return Math.round((probe.duration * probe.bitRate * ratio) / 8);
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
  const spec = specFor(intent.profile);
  const name = file.name || file.path;
  // Same-extension output (mp4 -> mp4-h264) MUST suffix, or we'd overwrite
  // the source.
  const sameExt = extension(name) === spec.outputExt;
  const outName = `${stem(name)}${sameExt ? "-converted" : ""}.${spec.outputExt}`;
  return joinPath(intent.outputDir || dirname(file.path), outName);
}

/**
 * GIF profile: fps + scale + palettegen/paletteuse in one filter_complex.
 * Without the palette pair, ffmpeg's gif encoder dithers colors into
 * garbage. Source input caps at 12 fps / 480px wide (GIFs explode past
 * that); explicit resolution/fps choices from the intent win.
 */
function gifFilterChain(intent: VideoIntent, crf: number): string {
  const fps = intent.fps !== "source" ? String(intent.fps) : "12";
  const scale =
    intent.resolution === "source"
      ? "scale=480:-2:flags=lanczos"
      : `scale=-2:${RESOLUTION_HEIGHT[intent.resolution]}:flags=lanczos`;
  // bayer_scale 1 (finest) .. 5 (coarsest): CRF maps onto it directly.
  const bayer = clamp(1 + Math.round((crf * 4) / 63), 1, 5);
  return `fps=${fps},${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=${bayer}`;
}

function specFor(profile: VideoProfile): VideoCodecSpec {
  return VIDEO_SPECS[profile] ?? VIDEO_SPECS[DEFAULT_PROFILE];
}

function cpuEncoder(spec: VideoCodecSpec): EncoderEntry {
  return spec.encoders.find((e) => !e.hw)!;
}

/** Hardware encoder names for a profile, in preference order (UI listing). */
export function hardwareEncoders(profile: VideoProfile): EncoderEntry[] {
  return specFor(profile).encoders.filter((e) => e.hw);
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
