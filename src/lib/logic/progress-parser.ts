// Ported from src/progress-parser.js — UMD wrapper removed, ESM exports added,
// types added per migrate/07-svelte-frontend.md. Algorithms unchanged.

export interface ProgressFrame {
  frame: number | null;
  fps: number | null;
  time: string | null;
  sizeKb: number | null;
  // wall-clock elapsed, only emitted by FFmpeg builds with the
  // 2025-04 print_report patch — null on older builds.
  elapsed: string | null;
  // encode speed multiplier ("1.5x"), present on most builds.
  speed: number | null;
}

// FFmpeg stderr progress lines look like:
//   frame=  123 fps= 45 q=28.0 size=    1024kB time=00:00:05.12 bitrate=1638.4kbits/s
const frameRegex = /frame=\s*(\d+)/;
const fpsRegex = /fps=\s*(\d+\.?\d*)/;
const timeRegex = /time=\s*(\d{2}:\d{2}:\d{2}\.\d{2})/;
const sizeRegex = /size=\s*(\d+)kB/;
const elapsedRegex = /elapsed=\s*(\d{2}:\d{2}:\d{2}\.\d{2})/;
const speedRegex = /speed=\s*(\d+\.?\d*)x?/;

export function parseLine(line: unknown): ProgressFrame | null {
  const text = String(line || "");
  const frameMatch = text.match(frameRegex);
  const fpsMatch = text.match(fpsRegex);
  const timeMatch = text.match(timeRegex);
  const sizeMatch = text.match(sizeRegex);
  const elapsedMatch = text.match(elapsedRegex);
  const speedMatch = text.match(speedRegex);

  if (!frameMatch && !fpsMatch && !timeMatch && !sizeMatch) {
    return null;
  }

  return {
    frame: frameMatch ? Number.parseInt(frameMatch[1], 10) : null,
    fps: fpsMatch ? Number.parseFloat(fpsMatch[1]) : null,
    time: timeMatch ? timeMatch[1] : null,
    sizeKb: sizeMatch ? Number.parseInt(sizeMatch[1], 10) : null,
    elapsed: elapsedMatch ? elapsedMatch[1] : null,
    speed: speedMatch ? Number.parseFloat(speedMatch[1]) : null,
  };
}

/** "00:01:02.34" -> 3722.34 seconds. Malformed/absent -> null. */
export function parseTimecodeSeconds(time: unknown): number | null {
  const m = String(time ?? "").match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const sec =
    Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100;
  return Number.isFinite(sec) ? sec : null;
}

/**
 * Percent (0-100) of `duration` covered by the frame's timecode. Null when
 * duration is unknown (video probes without container duration) — callers
 * must show indeterminate progress instead of a misleading bar.
 */
export function progressPercent(
  time: string | null,
  duration?: number,
): number | null {
  if (!time || !duration || duration <= 0) return null;
  const sec = parseTimecodeSeconds(time);
  if (sec == null) return null;
  return Math.min(100, Math.max(0, Math.round((sec / duration) * 100)));
}

/**
 * Remaining seconds from a frame's timecode + encode speed. Null without
 * duration, timecode, or a positive speed.
 */
export function etaSeconds(
  frame: { time: string | null; speed: number | null } | null | undefined,
  duration?: number,
): number | null {
  if (!frame || !duration || duration <= 0 || !frame.time) return null;
  if (!frame.speed || frame.speed <= 0) return null;
  const done = parseTimecodeSeconds(frame.time);
  if (done == null) return null;
  const remain = duration - done;
  return remain > 0 ? remain / frame.speed : null;
}

export function parseStderr(text: unknown): ProgressFrame | null {
  const lines = String(text || "").split(/\r?\n/);
  let last: ProgressFrame | null = null;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed) {
      last = parsed;
    }
  }

  return last;
}

