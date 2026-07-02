import { getPlatform, onLog, type LogEntry, type SelectedImage } from "$lib/bindings";

export interface QueueItem {
  jobId: string;
  file: SelectedImage;
  status: "pending" | "running" | "done" | "error" | "canceled";
  progress?: string; // formatted progress text
  error?: string;
}

class AppState {
  // ---- source files ----
  files = $state<SelectedImage[]>([]);
  thumbnails = $state.raw<Map<string, string>>(new Map()); // path -> dataUrl (raw: reassigned, not mutated)
  imageMeta = $state.raw<Map<string, string>>(new Map()); // path -> "W×H"

  // ---- output settings ----
  outputDir = $state("");

  // ---- conversion state ----
  isConverting = $state(false);
  activeJobId = $state("");
  cancelRequested = $state(false);
  queue = $state<QueueItem[]>([]);

  // ---- logs ----
  logs = $state<string[]>([]);
  private logUnlisten: (() => void) | null = null;

  // ---- platform (cached once) ----
  platform = $state("linux");
  private platformReady = false;

  // ---- ffmpeg status ----
  ffmpegStatus = $state<"idle" | "ok" | "error">("idle");
  ffmpegVersion = $state("");

  // ---- lifecycle ----

  async init() {
    if (this.platformReady) return;
    this.platform = await getPlatform();
    this.platformReady = true;

    // Subscribe to global ffmpeg:log events once.
    // await ensures teardown is safe (avoids the listen-before-resolve pitfall).
    this.logUnlisten = await onLog((entry) => this.appendLog(entry));
  }

  destroy() {
    this.logUnlisten?.();
    this.logUnlisten = null;
  }

  // ---- log streaming ----

  appendLog(entry: LogEntry) {
    const normalized = entry.text.replace(/\r/g, "\n");
    this.logs.push(normalized);
    if (this.logs.length > 500) {
      this.logs.splice(0, this.logs.length - 500);
    }
    // $state arrays are deeply reactive — push triggers UI update.
    // Auto-scroll is handled in LogPanel.svelte via an $effect.
  }

  clearLogs() {
    this.logs = [];
  }

  // ---- derived: can we convert? ----
  get canConvert(): boolean {
    return this.files.length > 0 && !this.isConverting;
  }
}

// Singleton — imported by every component.
// ponytail: module singleton; switch to Svelte context if multi-window added.
export const appState = new AppState();
