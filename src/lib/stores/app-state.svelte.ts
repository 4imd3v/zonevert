import {
  getPlatform,
  hasVideoExtension,
  onLog,
  probeFfmpeg as probeFfmpegBinding,
  probeEncoders,
  probeMedia,
  selectImages,
  selectOutputDir,
  convert,
  cancel as cancelBinding,
  checkExists,
  getFileSize,
  getThumbnail,
  probeImage,
  saveFile,
  showNotification,
  type ConvertResult,
  type LogEntry,
  type MediaProbeResult,
  type SelectedImage,
} from "$lib/bindings";
import {
  basename,
  createConversionIntent,
  extension,
  formatCommand,
  missingEncoderWarning,
  planConversion,
  PRESET_DEFAULTS,
  type ConversionIntent,
  type ConversionPlan,
} from "$lib/logic/conversion-plan";
import {
  createVideoIntent,
  encoderTestArgs,
  hardwareEncoders,
  planVideoConversion,
  type EncoderEnvironment,
  type VideoIntent,
  type VideoPlanResult,
  type VideoProfile,
} from "$lib/logic/video-plan";
import { formatProbeSummary, formatBytes } from "$lib/logic/media-probe";
import {
  createQueue,
  itemEtaSeconds,
  summarizeQueue,
  markRunning,
  markResult,
  markCanceled,
  markSkipped,
  resetFailed,
  applyProgress,
  runPool,
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
  rotation: string;
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
  videoProfile: string;
  videoResolution: string;
  videoFps: string;
  videoCrf: number;
  videoEncoder: string;
}

export interface HistoryEntry {
  timestamp: number;
  fileCount: number;
  settings: Settings;
  summary: { done: number; failed: number; skipped: number };
}

const SETTINGS_KEY = "zonevert:settings";
const THEME_KEY = "zonevert:theme";
const HISTORY_KEY = "zonevert:history";

const DEFAULT_SETTINGS: Settings = {
  format: "webp",
  preset: "balanced",
  quality: 82,
  collisionMode: "overwrite",
  metadata: false,
  resizeMode: "none",
  width: "",
  height: "",
  rotation: "none",
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
  videoProfile: "mp4-h264",
  videoResolution: "source",
  videoFps: "source",
  videoCrf: 23,
  videoEncoder: "auto",
};

class AppState {
  // ---- source files ----
  files = $state<SelectedImage[]>([]);
  selectedFileIndex = $state(-1);
  thumbnails = $state.raw<Map<string, string>>(new Map());
  imageMeta = $state.raw<Map<string, string>>(new Map());
  // paths probeMedia classified as real video + their probe summaries
  videoFiles = $state.raw<Set<string>>(new Set());
  videoMeta = $state.raw<Map<string, MediaProbeResult>>(new Map());
  // hardware encoder -> passed the 1s validation encode? (name -> bool)
  videoEncoders = $state.raw<Map<string, boolean>>(new Map());

  // ---- output settings ----
  outputDir = $state("");

  // ---- form settings (persisted) ----
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });

  // ---- conversion state ----
  isConverting = $state(false);
  cancelRequested = $state(false);
  stopAfterCurrent = $state(false);
  queue = $state<QueueItem[]>([]);
  sizeSummary = $state("");
  history = $state<HistoryEntry[]>([]);
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
  encoders = $state.raw<Set<string>>(new Set());

  // ---- theme ----
  theme = $state<"light" | "dark">("light");

  // ---- command feedback ----
  commandSummary = $state("Waiting for source images");

  // ---- lifecycle ----

  async init() {
    if (this.platformReady) return;
    this.loadSettings();
    this.loadTheme();
    this.loadHistory();
    this.platform = await getPlatform();
    this.platformReady = true;

    this.logUnlisten = await onLog((entry) => this.handleLog(entry));

    await this.probeFfmpeg();
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
      rotation: s.rotation,
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

  get videoIntent(): VideoIntent {
    const s = this.settings;
    return createVideoIntent({
      profile: s.videoProfile,
      resolution: s.videoResolution,
      fps: s.videoFps,
      crf: s.videoCrf,
      encoder: s.videoEncoder,
      collisionMode: s.collisionMode,
      outputDir: this.outputDir,
    });
  }

  private videoPlanFor(file: SelectedImage): VideoPlanResult {
    return planVideoConversion(
      file,
      this.videoMeta.get(file.path),
      this.videoIntent,
      this.encoderEnv,
    );
  }

  /** Plan one file through the image or video planner by classification. */
  planForFile(file: SelectedImage, index: number): ConversionPlan {
    if (this.videoFiles.has(file.path)) {
      const probe = this.videoMeta.get(file.path);
      const plan = this.videoPlanFor(file);
      return {
        file,
        args: plan.args,
        outputPath: plan.outputPath,
        // drives percent progress + ETA in the queue UI
        duration: probe?.duration,
        // approximate output size shown in the queue
        estimatedBytes: plan.estimatedBytes,
      };
    }
    return planConversion(file, this.intent, index);
  }

  isVideo(path: string): boolean {
    return this.videoFiles.has(path);
  }

  videoSummary(path: string): string {
    const probe = this.videoMeta.get(path);
    return probe ? formatProbeSummary(probe) : "probing…";
  }

  /** Approximate output size for the first queued video (Video tab). */
  get videoEstimate(): string | null {
    const first = this.files.find((f) => this.videoFiles.has(f.path));
    if (!first) return null;
    const bytes = this.videoPlanFor(first).estimatedBytes;
    return bytes != null ? formatBytes(bytes) : null;
  }

  /** Warnings (or rejection) for the first queued video, for the Video tab. */
  get videoWarnings(): string[] {
    const first = this.files.find((f) => this.videoFiles.has(f.path));
    if (!first) return [];
    const plan = this.videoPlanFor(first);
    return plan.ok ? plan.warnings : [plan.rejection ?? "This file cannot be converted."];
  }

  /** Hardware encoders of the active profile, with detection/validation state. */
  get videoHardwareStatus(): { name: string; status: "ready" | "failed" | "pending" | "absent" }[] {
    const profile = this.settings.videoProfile as VideoProfile;
    return hardwareEncoders(profile).map((entry) => {
      if (!this.encoders.has(entry.name)) return { name: entry.name, status: "absent" as const };
      const seen = this.videoEncoders.get(entry.name);
      if (seen === undefined) return { name: entry.name, status: "pending" as const };
      return { name: entry.name, status: seen ? ("ready" as const) : ("failed" as const) };
    });
  }

  private get encoderEnv(): EncoderEnvironment {
    return {
      availableEncoders: this.encoders,
      validatedEncoders: new Set(
        [...this.videoEncoders].filter(([, ok]) => ok).map(([name]) => name),
      ),
    };
  }

  /**
   * Validate the active profile's hardware encoders with a 1-second lavfi
   * encode each (needs `ffmpeg -encoders` probed first). Cached per encoder
   * for the session; failures degrade to the CPU encoder at plan time.
   */
  async ensureVideoEncoders() {
    const profile = this.settings.videoProfile as VideoProfile;
    const candidates = hardwareEncoders(profile).filter(
      (entry) => this.encoders.has(entry.name) && !this.videoEncoders.has(entry.name),
    );
    if (!candidates.length) return;
    for (const entry of candidates) {
      this.videoEncoders = new Map(this.videoEncoders).set(entry.name, false);
    }
    await runPool(candidates, 2, async (entry) => {
      let ok = false;
      try {
        const result = await convert({
          jobId: `validate:${entry.name}`,
          ffmpegPath: this.settings.ffmpegPath,
          args: encoderTestArgs(entry),
        });
        ok = result.ok;
        if (!result.ok) {
          this.appendLog(
            `Encoder validation failed: ${entry.name} (${result.error || "unknown error"})\n`,
          );
        }
      } catch {
        // IPC failure — treat as validation failure, CPU fallback applies
      }
      this.videoEncoders = new Map(this.videoEncoders).set(entry.name, ok);
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

    const plan = this.planForFile(target, this.files.indexOf(target));
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
    const mediaExt = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|mpe?g|png|tiff?|webp|mp4|m4v|mov|mkv|avi|flv|wmv|ts|m2ts|3gp|ogv)$/i;
    const files: SelectedImage[] = paths
      .filter((p) => mediaExt.test(p))
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
      const videos = new Set(this.videoFiles);
      const videoMeta = new Map(this.videoMeta);
      thumbs.delete(removed.path);
      meta.delete(removed.path);
      videos.delete(removed.path);
      videoMeta.delete(removed.path);
      this.thumbnails = thumbs;
      this.imageMeta = meta;
      this.videoFiles = videos;
      this.videoMeta = videoMeta;
    }
    this.files = this.files.filter((_, i) => i !== index);
  }

  clearFiles() {
    this.files = [];
    this.queue = [];
    this.selectedFileIndex = -1;
    this.thumbnails = new Map();
    this.imageMeta = new Map();
    this.videoFiles = new Set();
    this.videoMeta = new Map();
  }

  private async loadThumbnailsAndMeta() {
    // One pass per file: video candidates (video/unknown extension) get a full
    // probeMedia — which also classifies them; images keep the dimension
    // probe. Thumbnails come from ffmpeg's first frame for both kinds.
    const worker = async (file: SelectedImage) => {
      const ext = extension(file.name || file.path);
      const isVideoCandidate = hasVideoExtension(file.name || file.path) || ext === "";
      const [thumb, probe] = await Promise.all([
        getThumbnail(file.path),
        isVideoCandidate
          ? probeMedia(file.path, this.settings.ffmpegPath)
          : Promise.resolve(null),
      ]);
      if (thumb.ok && thumb.dataUrl) {
        this.thumbnails = new Map(this.thumbnails).set(file.path, thumb.dataUrl);
      }
      if (probe) {
        if (probe.ok && probe.video) {
          this.videoFiles = new Set(this.videoFiles).add(file.path);
          this.videoMeta = new Map(this.videoMeta).set(file.path, probe);
        } else if (!probe.ok) {
          this.appendLog(
            `Could not read ${file.name || file.path}: ${probe.error || "unknown error"}\n`,
          );
        }
        // probe ok but no video stream: mislabeled image/audio file — stays
        // in the image flow (its ffmpeg run will surface a real error).
        return;
      }
      const dims = await probeImage(file.path, this.settings.ffmpegPath);
      if (dims.ok && dims.width && dims.height) {
        this.imageMeta = new Map(this.imageMeta).set(file.path, `${dims.width}×${dims.height}`);
      }
    };

    await runPool([...this.files], 4, worker);
  }

  // ---- output dir ----

  async pickOutputDir() {
    const directory = await selectOutputDir();
    if (directory) this.outputDir = directory;
  }

  // ---- ffmpeg probe ----

  get encoderWarning(): string | null {
    return missingEncoderWarning(this.settings.format, this.encoders);
  }

  async probeFfmpeg() {
    this.ffmpegStatus = "idle";
    const result = await probeFfmpegBinding(this.settings.ffmpegPath);
    if (result.ok) {
      this.ffmpegStatus = "ok";
      this.ffmpegVersion = result.version || "FFmpeg ready";
      this.encoders = new Set(await probeEncoders(this.settings.ffmpegPath));
    } else {
      this.ffmpegStatus = "warn";
      this.encoders = new Set();
      this.appendLog(`FFmpeg probe failed: ${result.error || "Unknown error"}\n`);
    }
  }

  // ---- conversion ----

  private getConcurrency(): number {
    const c = this.settings.concurrency;
    return Number.isFinite(c) ? Math.min(Math.max(c, 1), 8) : 1;
  }

  async convertSingleFile(index: number) {
    if (this.isConverting || !this.files[index]) return;
    const file = this.files[index];
    const plan = this.planForFile(file, index);

    this.queue = [{
      id: crypto.randomUUID(),
      file,
      args: plan.args,
      outputPath: plan.outputPath,
      status: "pending" as const,
      ...(plan.duration != null ? { duration: plan.duration } : {}),
      ...(plan.estimatedBytes != null ? { estimatedBytes: plan.estimatedBytes } : {}),
    }];
    await this.runConversion(true);
  }

  async runConversion(retry = false) {
    if (this.isConverting || !this.files.length) return;

    const intent = this.intent;

    // Hardware encoders must be validated before planning picks one.
    if (this.files.some((f) => this.videoFiles.has(f.path))) {
      await this.ensureVideoEncoders();
    }

    if (!retry) {
      // Video files whose plan rejects (probe cache gone, path collision)
      // are excluded up front with a log line instead of failing mid-queue.
      const runnable: SelectedImage[] = [];
      for (const file of this.files) {
        if (this.videoFiles.has(file.path)) {
          const plan = this.videoPlanFor(file);
          if (!plan.ok) {
            this.appendLog(`Skipped ${file.name || file.path}: ${plan.rejection}\n`);
            continue;
          }
        }
        runnable.push(file);
      }
      this.queue = createQueue(runnable, intent, (file, _intent, index) =>
        this.planForFile(file, index ?? 0),
      );
      this.sizeSummary = "";
    }
    this.isConverting = true;
    this.cancelRequested = false;
    this.stopAfterCurrent = false;
    this.logSummary = "Running";
    this.updateTitle();

    const runnable = retry
      ? this.queue.filter((item) => item.status === "pending")
      : this.queue;
    const concurrency = this.getConcurrency();
    this.appendLog(
      `Starting ${runnable.length} conversion${runnable.length === 1 ? "" : "s"}${concurrency > 1 ? ` (${concurrency} parallel)` : ""}.\n`,
    );

    // One pool for both sequential (concurrency=1) and parallel runs: on
    // cancel/stop-after-current, not-yet-started items are marked canceled.
    await runPool(
      runnable,
      concurrency,
      (item) => this.runConversionItem(item, intent),
      (item) => markCanceled(item),
      () => this.cancelRequested || this.stopAfterCurrent,
    );

    this.isConverting = false;
    const wasCanceled = this.cancelRequested;
    this.cancelRequested = false;
    this.stopAfterCurrent = false;
    this.logSummary = "Idle";
    this.updateTitle();
    this.appendLog(wasCanceled ? "\nQueue canceled.\n" : "\nQueue finished.\n");

    if (!wasCanceled) {
      this.notifyQueueComplete();
      this.computeSizeSummary();
      if (!retry) this.saveHistoryEntry();
    }
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
    let result: ConvertResult;
    try {
      result = await convert({
        jobId: item.id,
        ffmpegPath: intent.ffmpegPath,
        args: item.args,
      });
    } catch (error) {
      // An IPC-layer failure must fail this job, not strand the queue with
      // isConverting stuck true forever.
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (item.status !== "skipped") {
      const elapsed = Date.now() - startTime;
      this.conversionTimes.push(elapsed);
      if (this.conversionTimes.length > 50) this.conversionTimes.shift();
    }

    markResult(item, result, this.cancelRequested);

    this.updateTitle();

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

  stopAfterCurrentJob() {
    if (!this.isConverting) return;
    this.stopAfterCurrent = true;
    this.appendLog("\nStopping after current job.\n");
    this.logSummary = "Stopping";
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

  reorderFiles(from: number, to: number) {
    if (this.isConverting || from === to) return;
    const [moved] = this.files.splice(from, 1);
    this.files.splice(to, 0, moved);
    // Update selection
    if (this.selectedFileIndex === from) {
      this.selectedFileIndex = to;
    } else if (from < to && this.selectedFileIndex > from && this.selectedFileIndex <= to) {
      this.selectedFileIndex--;
    } else if (from > to && this.selectedFileIndex >= to && this.selectedFileIndex < from) {
      this.selectedFileIndex++;
    }
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

  private updateTitle() {
    if (this.isConverting) {
      const done = this.queue.filter((item) => item.status !== "pending").length;
      document.title = `Zonevert — Converting (${done}/${this.queue.length})`;
    } else {
      document.title = "Zonevert";
    }
  }

  private async computeSizeSummary() {
    const done = this.queue.filter((item) => item.status === "done");
    if (!done.length) return;

    let totalIn = 0;
    let totalOut = 0;
    const results = await Promise.all(
      done.map(async (item) => {
        const [inS, outS] = await Promise.all([
          getFileSize(item.file.path),
          getFileSize(item.outputPath),
        ]);
        if (inS.ok) totalIn += inS.size;
        if (outS.ok) totalOut += outS.size;
      }),
    );
    void results;

    if (totalIn === 0 && totalOut === 0) return;
    const inStr = formatBytes(totalIn);
    const outStr = formatBytes(totalOut);
    const ratio = totalIn ? ((totalOut / totalIn) * 100).toFixed(1) : "?";
    this.sizeSummary = `${inStr} → ${outStr} (${ratio}%)`;
    this.appendLog(`\nSize: ${this.sizeSummary}\n`);
  }

  // ---- log streaming ----

  private handleLog(entry: LogEntry) {
    if (entry.stream === "stderr") {
      const progress = parseStderr(entry.text);
      if (progress) {
        if (applyProgress(this.queue, entry.jobId, progress)) {
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
    const isWindows = this.platform === "win32";
    const lines = this.files.map((file, index) => {
      const plan = this.planForFile(file, index);
      return formatCommand([this.intent.ffmpegPath, ...plan.args], { platform: this.platform });
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

  // ---- history ----

  private loadHistory() {
    try {
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (Array.isArray(stored)) this.history = stored.slice(0, 20);
    } catch {
      // localStorage may be unavailable
    }
  }

  private saveHistoryEntry() {
    const summary = summarizeQueue(this.queue);
    const entry: HistoryEntry = {
      timestamp: Date.now(),
      fileCount: this.files.length,
      settings: { ...this.settings },
      summary: { done: summary.done, failed: summary.failed, skipped: summary.skipped },
    };
    this.history = [entry, ...this.history].slice(0, 20);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch {
      // localStorage may be unavailable
    }
  }

  restoreHistory(entry: HistoryEntry) {
    this.settings = { ...DEFAULT_SETTINGS, ...entry.settings };
    this.persistSettings();
  }

  clearHistory() {
    this.history = [];
    try {
      localStorage.removeItem(HISTORY_KEY);
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
