// Ported from src/progress-parser.js — UMD wrapper removed, ESM exports added,
// types added per migrate/07-svelte-frontend.md. Algorithms unchanged.

export interface ProgressFrame {
  frame: number | null;
  fps: number | null;
  time: string | null;
  sizeKb: number | null;
}

// FFmpeg stderr progress lines look like:
//   frame=  123 fps= 45 q=28.0 size=    1024kB time=00:00:05.12 bitrate=1638.4kbits/s
const frameRegex = /frame=\s*(\d+)/;
const fpsRegex = /fps=\s*(\d+\.?\d*)/;
const timeRegex = /time=\s*(\d{2}:\d{2}:\d{2}\.\d{2})/;
const sizeRegex = /size=\s*(\d+)kB/;

export function parseLine(line: unknown): ProgressFrame | null {
  const text = String(line || "");
  const frameMatch = text.match(frameRegex);
  const fpsMatch = text.match(fpsRegex);
  const timeMatch = text.match(timeRegex);
  const sizeMatch = text.match(sizeRegex);

  if (!frameMatch && !fpsMatch && !timeMatch && !sizeMatch) {
    return null;
  }

  return {
    frame: frameMatch ? Number.parseInt(frameMatch[1], 10) : null,
    fps: fpsMatch ? Number.parseFloat(fpsMatch[1]) : null,
    time: timeMatch ? timeMatch[1] : null,
    sizeKb: sizeMatch ? Number.parseInt(sizeMatch[1], 10) : null,
  };
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

