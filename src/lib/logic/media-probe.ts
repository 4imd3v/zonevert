// Pure media-probe classification. Rust (ffmpeg.rs::probe_media) already
// filters attached-pic (cover art) video streams, so `video.is_some()` means
// "real video" — an mp3 with album art classifies as audio, not video.

import type { MediaProbeResult, MediaStream } from "$lib/bindings";

export type MediaKind = "video" | "audio" | "unknown";

type Probe = Omit<MediaProbeResult, "video" | "audio"> & {
  video?: MediaStream | null;
  audio?: MediaStream | null;
};

/**
 * What kind of media a probe summary describes.
 * - video: probe succeeded and a real (non-cover-art) video stream exists
 * - audio: probe succeeded, audio stream(s) only
 * - unknown: probe failed, or a data-less/unreadable result
 */
export function classifyMedia(probe: Probe | null | undefined): MediaKind {
  if (!probe || !probe.ok) return "unknown";
  if (probe.video) return "video";
  if (probe.audio) return "audio";
  return "unknown";
}

/** Convertible video = probed real video stream with positive dimensions. */
export function isConvertibleVideo(probe: Probe | null | undefined): boolean {
  if (!probe || !probe.ok || !probe.video) return false;
  const { width, height } = probe.video;
  return (width ?? 0) > 0 && (height ?? 0) > 0;
}

/** "h264 · 1920×1080 · 30 fps · 12.3s · aac" — UI-ready one-liner. */
export function formatProbeSummary(probe: Probe | null | undefined): string {
  if (!probe || !probe.ok) return "unreadable";
  const parts: string[] = [];
  if (probe.video) {
    const v = probe.video;
    if (v.width && v.height) parts.push(`${v.width}×${v.height}`);
    if (v.codecName) parts.push(v.codecName);
    if (v.frameRate && v.frameRate > 0) parts.push(`${Math.round(v.frameRate)} fps`);
  }
  if (probe.duration && probe.duration > 0) parts.push(formatDuration(probe.duration));
  if (probe.audio) parts.push(probe.audio.codecName || "audio");
  return parts.join(" · ") || "unknown media";
}

/** Seconds → "12.3s" / "1:05" / "1:02:03". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "?";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}
