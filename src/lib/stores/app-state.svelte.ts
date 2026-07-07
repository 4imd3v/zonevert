import {
  getPlatform,
  onLog,
  probeFfmpeg as probeFfmpegBinding,
  selectImages,
  selectOutputDir,
  convert,
  cancel as cancelBinding,
  checkExists,
  getThumbnail,
  probeImage,
  saveFile,
  showNotification,
  type LogEntry,
  type SelectedImage,
} from "$lib/bindings";
import {
  createConversionIntent,
  planConversion,
  formatCommand,
  PRESET_DEFAULTS,
  type ConversionIntent,
} from "$lib/logic/conversion-plan";
import {
  createQueue,
  resolveCollisions,
  summarizeQueue,
  markRunning,
  markResult,
  markCanceled,
  markSkipped,
  resetFailed,
  type QueueItem,
  type QueueSummary,
} from "$lib/logic/queue-state";
import { parseStderr, type ProgressFrame } from "$lib/logic/progress-parser";

// ---- settings (persisted to localStorage) ----

export interface Settings {
  format: string;
  preset: string;
  quality: number;
  collisionMode: string;
  metadata: boolean;
  resizeMode: string;
  width: string;
  height: string;
  namePrefix: string;
  nameSuffix: string;
  sequential: boolean;
  padWidth: number;
  ffmpegPath: string;
  concurrency: number;
  globalArgs: string;
  inputArgs: string;
  filter: string;
  outputArgs: string;
}

const SETTINGS_KEY = "zonevert:settings";
const THEME_KEY = "zonevert:theme";

const DEFAULT_SETTINGS: Settings = {
  format: "webp",
  preset: "balanced",
  quality: 82,
  collisionMode: "overwrite",
  metadata: false,
  resizeMode: "none",
  width: "",
  height: "",
  namePrefix: "",
  nameSuffix: "",
  sequential: false,
  padWidth: 3,
  ffmpegPath: "",
  concurrency: 1,
  globalArgs: "",
  inputArgs: "",
  filter: "",
  outputArgs: "",
};

class AppState {
  // ---- source files ----
  files = $state<SelectedImage[]>([]);
  thumbnails = $state.raw<Map<string, string>>(new Map());
  imageMeta = $state.raw<Map<string, string>>(new Map());

  // ---- output settings ----
  outputDir = $state("");

  // ---- form settings (persisted) ----
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });

  // ---- conversion state ----
  isConverting = $state(false);
  cancelRequested = $state(false);
  queue = $state<QueueItem[]>([]);
  private conversionTimes: number[] = [];

  // ---- logs ----
  logs = $state<string[]>([]);
  logSummary = $state("Idle");
  private logUnlisten: (() => void) | null = null;

  // ---- platform (cached once) ----
  platform = $state("linux");
  private platformReady = false;

  // ---- ffmpeg status ----
  ffmpegStatus = $state<"idle" | "ok" | "warn">("idle");
  ffmpegVersion = $state("");

  // ---- theme ----
  theme = $state<"light" | "dark">("light");

  // ---- command feedback ----
  commandSummary = $state("Waiting for source images");

  // ---- lifecycle ----

  async init() {
    if (this.platformReady) return;
    this.loadSettings();
    this.loadTheme();
    this.platform = await getPlatform();
    this.platformReady = true;

    this.logUnlisten = await onLog((entry) => this.handleLog(entry));

    const probe = await probeFfmpegBinding(this.settings.ffmpegPath);
    if (probe.ok) {
      this.ffmpegStatus = "ok";
      this.ffmpegVersion = probe.version || "FFmpeg ready";
    } else {
      this.ffmpegStatus = "warn";
      this.appendLog(`FFmpeg probe failed: ${probe.error || "Unknown error"}\n`);
    }
  }

  destroy() {
    this.logUnlisten?.();
    this.logUnlisten = null;
  }

  // ---- derived intent + command ----

  get intent(): ConversionIntent {
    const s = this.settings;
    return createConversionIntent({
      format: s.format,
      preset: s.preset,
      quality: s.quality,
      collisionMode: s.collisionMode,
      keepMetadata: s.metadata,
      outputDir: this.outputDir,
      ffmpegPath: s.ffmpegPath,
      resizeMode: s.resizeMode,
      width: s.width ? Number(s.width) : undefined,
      height: s.height ? Number(s.height) : undefined,
      naming: {
        prefix: s.namePrefix,
        suffix: s.nameSuffix,
        sequential: s.sequential,
        padWidth: s.padWidth,
      },
      globalArgsText: s.globalArgs,
      inputArgsText: s.inputArgs,
      filterText: s.filter,
      outputArgsText: s.outputArgs,
    });
  }

  buildCommand(file?: SelectedImage): string {
    const intent = this.intent;
    const target = file ?? this.files[0];

    if (!target) {
      return formatCommand(
        [intent.ffmpegPath, "-hide_banner", "-i", "source.png", `output.${intent.format}`],
        { platform: this.platform },
      );
    }

    const plan = planConversion(target, intent);
    return formatCommand([intent.ffmpegPath, ...plan.args], { platform: this.platform });
  }

  get canConvert(): boolean {
    return this.files.length > 0 && !this.isConverting;
  }

  get hasFailed(): boolean {
    return this.queue.some((item) => item.status === "failed");
  }

  get queueSummary(): QueueSummary {
    return summarizeQueue(this.queue);
  }

  get etaText(): string {
    if (!this.isConverting || !this.conversionTimes.length) return "";
    const pending = this.queue.filter((item) => item.status === "pending").length;
    if (!pending) return "";
    const avgMs = this.conversionTimes.reduce((sum, t) => sum + t, 0) / this.conversionTimes.length;
    const etaSec = Math.round((avgMs * pending) / 1000);
    if (etaSec < 60) return `~${etaSec}s left`;
    const min = Math.floor(etaSec / 60);
    const sec = etaSec % 60;
    return `~${min}m ${sec}s left`;
  }

  // ---- files ----

  async addFiles() {
    const selected = await selectImages();
    if (!selected.length) return;
    this.files = [...this.files, ...this.dedupe(selected)];
    this.loadThumbnailsAndMeta();
  }

  addDroppedFiles(paths: string[]) {
    const imgExt = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;
    const files: SelectedImage[] = paths
      .filter((p) => imgExt.test(p))
      .map((p) => ({ path: p, name: p.split(/[/\\]/).pop()! }));
    if (files.length) {
      this.files = [...this.files, ...this.dedupe(files)];
      this.loadThumbnailsAndMeta();
    }
  }

  private dedupe(files: SelectedImage[]): SelectedImage[] {
    const existing = new Set(this.files.map((f) => f.path));
    const next: SelectedImage[] = [];
    for (const file of files) {
      if (!file.path || existing.has(file.path)) continue;
      existing.add(file.path);
      next.push(file);
    }
    return next;
  }

  removeFile(index: number) {
    const removed = this.files[index];
    if (removed) {
      const thumbs = new Map(this.thumbnails);
      const meta = new Map(this.imageMeta);
      thumbs.delete(removed.path);
      meta.delete(removed.path);
      this.thumbnails = thumbs;
      this.imageMeta = meta;
    }
    this.files = this.files.filter((_, i) => i !== index);
  }

  clearFiles() {
    this.files = [];
    this.queue = [];
    this.thumbnails = new Map();
    this.imageMeta = new Map();
  }

  private async loadThumbnailsAndMeta() {
    const thumbs = new Map(this.thumbnails);
    const meta = new Map(this.imageMeta);
    await Promise.all(
      this.files.map(async (file) => {
        const [thumb, dims] = await Promise.all([
          getThumbnail(file.path),
          probeImage(file.path, this.settings.ffmpegPath),
        ]);
        if (thumb.ok && thumb.dataUrl) thumbs.set(file.path, thumb.dataUrl);
        if (dims.ok && dims.width && dims.height) {
          meta.set(file.path, `${dims.width}×${dims.height}`);
        }
      }),
    );
    this.thumbnails = thumbs;
    this.imageMeta = meta;
  }

  // ---- output dir ----

  async pickOutputDir() {
    const directory = await selectOutputDir();
    if (directory) this.outputDir = directory;
  }

  // ---- ffmpeg probe ----

  async probeFfmpeg() {
    this.ffmpegStatus = "idle";
    const result = await probeFfmpegBinding(this.settings.ffmpegPath);
    if (result.ok) {
      this.ffmpegStatus = "ok";
      this.ffmpegVersion = result.version || "FFmpeg ready";
    } else {
      this.ffmpegStatus = "warn";
      this.appendLog(`FFmpeg probe failed: ${result.error || "Unknown error"}\n`);
    }
  }

  // ---- conversion ----

  private getConcurrency(): number {
    const c = this.settings.concurrency;
    return Number.isFinite(c) ? Math.min(Math.max(c, 1), 8) : 1;
  }

  async runConversion(retry = false) {
    if (this.isConverting || !this.files.length) return;

    const intent = this.intent;

    if (!retry) {
      this.queue = createQueue(this.files, intent, (file, intent, index) =>
        planConversion(file, intent, index),
      );
    }
    this.isConverting = true;
    this.cancelRequested = false;
    this.logSummary = "Running";

    const runnable = retry
      ? this.queue.filter((item) => item.status === "pending")
      : this.queue;
    const concurrency = this.getConcurrency();
    this.appendLog(
      `Starting ${runnable.length} conversion${runnable.length === 1 ? "" : "s"}${concurrency > 1 ? ` (${concurrency} parallel)` : ""}.\n`,
    );

    if (concurrency > 1) {
      await this.runConversionPool(runnable, intent, concurrency);
    } else {
      for (const item of runnable) {
        if (this.cancelRequested) {
          markCanceled(item);
          continue;
        }
        await this.runConversionItem(item, intent);
      }
    }

    this.isConverting = false;
    const wasCanceled = this.cancelRequested;
    this.cancelRequested = false;
    this.logSummary = "Idle";
    this.appendLog(wasCanceled ? "\nQueue canceled.\n" : "\nQueue finished.\n");

    if (!wasCanceled) this.notifyQueueComplete();
  }

  private async runConversionPool(
    items: QueueItem[],
    intent: ConversionIntent,
    concurrency: number,
  ) {
    const queue = [...items];
    const workers: Promise<void>[] = [];

    const worker = async () => {
      while (queue.length) {
        if (this.cancelRequested) {
          const skipped = queue.splice(0);
          for (const item of skipped) markCanceled(item);
          return;
        }
        const item = queue.shift();
        if (!item) return;
        await this.runConversionItem(item, intent);
      }
    };

    for (let i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);
  }

  private async runConversionItem(item: QueueItem, intent: ConversionIntent) {
    if (intent.collisionMode === "skip") {
      const exists = await checkExists(item.outputPath);
      if (exists.ok && exists.exists) {
        markSkipped(item);
        this.appendLog(`Skipped (already exists): ${item.outputPath}\n`);
        return;
      }
    }

    markRunning(item);
    this.appendLog(
      `\n$ ${formatCommand([intent.ffmpegPath, ...item.args], { platform: this.platform })}\n`,
    );

    const startTime = Date.now();
    const result = await convert({
      jobId: item.id,
      ffmpegPath: intent.ffmpegPath,
      args: item.args,
    });

    if (item.status !== "skipped") {
      const elapsed = Date.now() - startTime;
      this.conversionTimes.push(elapsed);
      if (this.conversionTimes.length > 50) this.conversionTimes.shift();
    }

    markResult(item, result, this.cancelRequested);

    if (item.status === "canceled") {
      this.appendLog(`Canceled: ${item.outputPath}\n`);
    } else if (item.status === "done") {
      this.appendLog(`Finished: ${item.outputPath}\n`);
    } else {
      this.appendLog(`Failed: ${result.error || "Unknown FFmpeg error"}\n`);
    }
  }

  async cancelCurrentJob() {
    const running = this.queue.filter((item) => item.status === "running");
    if (!running.length) return;
    for (const item of running) await cancelBinding(item.id);
    this.cancelRequested = true;
    this.appendLog("\nCancel requested.\n");
    this.logSummary = "Canceling";
  }

  async retryFailed() {
    if (this.isConverting) return;
    const reset = resetFailed(this.queue);
    if (!reset.length) return;
    this.appendLog(`Retrying ${reset.length} failed conversion${reset.length === 1 ? "" : "s"}.\n`);
    await this.runConversion(true);
  }

  reorderQueue(from: number, to: number) {
    if (this.isConverting || from === to) return;
    const [moved] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, moved);
  }

  private notifyQueueComplete() {
    const summary = summarizeQueue(this.queue);
    const parts: string[] = [];
    if (summary.done) parts.push(`${summary.done} done`);
    if (summary.failed) parts.push(`${summary.failed} failed`);
    if (summary.skipped) parts.push(`${summary.skipped} skipped`);
    const title = summary.failed > 0 ? "Conversion finished with errors" : "Conversion complete";
    const body = parts.join(", ") || "Queue finished";
    showNotification({ title, body });
  }

  // ---- log streaming ----

  private handleLog(entry: LogEntry) {
    const isRunning = this.queue.some(
      (item) => item.id === entry.jobId && item.status === "running",
    );
    if (!isRunning) return;

    if (entry.stream === "stderr") {
      const progress = parseStderr(entry.text);
      if (progress) {
        const item = this.queue.find((q) => q.id === entry.jobId);
        if (item) {
          item.progress = progress;
          // trigger reactivity — reassign queue entry
          this.queue = [...this.queue];
        }
        return;
      }
    }
    this.appendLog(entry.text);
  }

  appendLog(text: string) {
    const normalized = String(text || "").replace(/\r/g, "\n");
    this.logs.push(normalized);
    if (this.logs.length > 500) {
      this.logs.splice(0, this.logs.length - 500);
    }
  }

  clearLogs() {
    this.logs = [];
    this.logSummary = "Idle";
  }

  async saveLog() {
    const content = this.logs.join("");
    if (!content.trim()) {
      this.logSummary = "Log is empty";
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const result = await saveFile({
      title: "Save log",
      defaultPath: `zonevert-log-${date}.txt`,
      content,
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    this.logSummary = result.ok ? "Log saved" : result.canceled ? "Idle" : "Save failed";
  }

  // ---- command actions ----

  async copyCommand() {
    try {
      await navigator.clipboard.writeText(this.buildCommand());
      this.commandSummary = "Command copied";
    } catch {
      this.commandSummary = "Copy failed";
    }
  }

  async exportScript() {
    if (!this.files.length) {
      this.commandSummary = "Add files first";
      return;
    }
    const intent = this.intent;
    const isWindows = this.platform === "win32";
    const lines = this.files.map((file, index) => {
      const plan = planConversion(file, intent, index);
      return formatCommand([intent.ffmpegPath, ...plan.args], { platform: this.platform });
    });
    const shebang = isWindows ? "@echo off\r\n" : "#!/bin/sh\n";
    const content = shebang + lines.join("\n") + "\n";
    const ext = isWindows ? "bat" : "sh";
    const result = await saveFile({
      title: "Export conversion script",
      defaultPath: `zonevert-convert.${ext}`,
      content,
      filters: [{ name: isWindows ? "Batch" : "Shell", extensions: [ext] }],
    });
    this.commandSummary = result.ok
      ? "Script saved"
      : result.canceled
        ? "Export canceled"
        : "Export failed";
  }

  // ---- presets / reset ----

  applyPreset() {
    const preset = PRESET_DEFAULTS[this.settings.preset as keyof typeof PRESET_DEFAULTS];
    if (preset) this.settings.quality = preset.quality;
  }

  resetSettings() {
    this.settings = { ...DEFAULT_SETTINGS };
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {
      // localStorage may be unavailable
    }
    this.appendLog("Settings reset to defaults.\n");
  }

  // ---- settings persistence ----

  private loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      if (stored && typeof stored === "object") {
        this.settings = { ...DEFAULT_SETTINGS, ...stored };
      }
    } catch {
      // localStorage may be unavailable
    }
  }

  persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // localStorage may be unavailable
    }
  }

  // ---- theme ----

  private loadTheme() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      // localStorage may be unavailable
    }
    if (stored === "dark" || stored === "light") {
      this.theme = stored;
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      this.theme = "dark";
    }
  }

  toggleTheme() {
    this.theme = this.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, this.theme);
    } catch {
      // localStorage may be unavailable
    }
  }

  // ---- helpers exposed to components ----
}

// Singleton — imported by every component.
// ponytail: module singleton; switch to Svelte context if multi-window added.
export const appState = new AppState();
