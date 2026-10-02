import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appState } from "$lib/stores/app-state.svelte";
import type { MediaProbeResult } from "$lib/bindings";

// ---- Tauri API mock (hoisted so the factory can close over it) ----
const h = vi.hoisted(() => ({
  getPlatform: vi.fn(async () => "linux"),
  onLog: vi.fn(),
  probeFfmpeg: vi.fn(async () => ({ ok: true, version: "ffmpeg test" })),
  probeEncoders: vi.fn(async () => ["libwebp", "png", "mjpeg"] as string[]),
  selectImages: vi.fn(async () => []),
  selectOutputDir: vi.fn(async () => ""),
  convert: vi.fn(
    async (_payload: { jobId: string; ffmpegPath?: string; args: string[] }) => ({
      ok: true,
    }),
  ),
  cancel: vi.fn(async (_jobId: string) => ({ ok: true })),
  checkExists: vi.fn(async (_p: string) => ({ ok: true, exists: false })),
  getFileSize: vi.fn(async (_p: string) => ({ ok: true, size: 0 })),
  getThumbnail: vi.fn(async (_p: string) => ({ ok: true, dataUrl: "data:," })),
  probeImage: vi.fn(async (_p: string) => ({ ok: true, width: 10, height: 10 })),
  probeMedia: vi.fn(async (_p: string): Promise<MediaProbeResult> => ({ ok: false, error: "no ffprobe" })),
  // mirrors the real extension check for the mock module surface
  hasVideoExtension: (name: string) =>
    [".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".flv", ".wmv", ".ts", ".m2ts", ".mpeg", ".mpg", ".3gp", ".ogv"].some((e) =>
      name.toLowerCase().endsWith(e),
    ),
  saveFile: vi.fn(async (_payload: unknown) => ({
    ok: true,
    filePath: "/tmp/x",
  })),
  showNotification: vi.fn(async (_payload: unknown) => ({ ok: true })),
}));

vi.mock("$lib/bindings", () => h);

const deferred = new Map<string, (r: unknown) => void>();
let inflight = 0;
let peak = 0;
let logCallback: ((entry: unknown) => void) | undefined;

function files(...names: string[]) {
  appState.files = names.map((n) => ({ path: `/in/${n}`, name: n }));
  appState.outputDir = "/out";
}

async function waitFor(fn: () => boolean, ms = 2000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function statuses() {
  return appState.queue.map((i) => i.status);
}

beforeEach(async () => {
  localStorage.clear();
  // Drop init()'s idempotence gate so every test gets a fresh log-listener
  // capture and fresh loaders.
  (appState as unknown as { platformReady: boolean }).platformReady = false;
  appState.clearFiles();
  appState.logs = [];
  appState.queue = [];
  appState.cancelRequested = false;
  appState.stopAfterCurrent = false;
  appState.isConverting = false;
  (appState as unknown as { conversionTimes: number[] }).conversionTimes = [];
  appState.videoEncoders = new Map();
  appState.resetSettings();
  deferred.clear();
  inflight = 0;
  peak = 0;
  logCallback = undefined;
  h.onLog.mockImplementation(async (cb: (e: unknown) => void) => {
    logCallback = cb;
    return () => {};
  });
  // init() captures the log callback + probes ffmpeg.
  await appState.init();
});

afterEach(() => {
  // Resolve anything still pending so no store promise leaks between tests.
  for (const resolve of deferred.values()) resolve({ ok: false });
  deferred.clear();
});

describe("runConversion", () => {
  it("runs a queue sequentially, finishes items, updates title and history", async () => {
    h.getFileSize.mockImplementation(async (p: string) => ({
      ok: true,
      size: p.endsWith(".png") ? 1000 : 500,
    }));
    h.convert.mockImplementation(async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
      return { ok: true };
    });
    files("a.png", "b.png", "c.png");

    const titleDuringRun = await (async () => {
      const p = appState.runConversion();
      await waitFor(() => appState.queue[0]?.status === "running");
      const title = document.title;
      await p;
      return title;
    })();

    expect(statuses()).toEqual(["done", "done", "done"]);
    expect(peak).toBe(1);
    expect(titleDuringRun).toBe("Zonevert — Converting (0/3)");
    expect(document.title).toBe("Zonevert");
    expect(appState.isConverting).toBe(false);
    // size summary is computed fire-and-forget after the queue ends:
    // 3×1000 in -> 3×500 out = 50.0%
    await waitFor(() => appState.sizeSummary !== "");
    expect(appState.sizeSummary).toContain("50.0%");
    // history persisted
    const stored = JSON.parse(localStorage.getItem("zonevert:history") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].summary).toEqual({ done: 3, failed: 0, skipped: 0 });
    expect(h.showNotification).toHaveBeenCalled();
  });

  it("respects the concurrency setting (peak 3 for 6 files)", async () => {
    appState.settings.concurrency = 3;
    h.convert.mockImplementation(async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight -= 1;
      return { ok: true };
    });
    files("a.png", "b.png", "c.png", "d.png", "e.png", "f.png");

    await appState.runConversion();

    expect(peak).toBe(3);
    expect(statuses()).toEqual(Array(6).fill("done"));
  });

  it("fails the job (not the queue) when convert rejects", async () => {
    h.convert.mockImplementationOnce(async () => ({ ok: false, error: "boom" }));
    h.convert.mockImplementation(async () => ({ ok: true }));
    files("a.png", "b.png");

    await appState.runConversion();

    expect(statuses()).toEqual(["failed", "done"]);
    expect(appState.logs.join("")).toContain("boom");
  });

  it("skips existing outputs in skip collision mode", async () => {
    appState.settings.collisionMode = "skip";
    h.checkExists.mockImplementation(async (p: string) => ({
      ok: true,
      exists: p === "/out/a.webp",
    }));
    h.convert.mockImplementation(async () => ({ ok: true }));
    files("a.png", "b.png");

    await appState.runConversion();

    expect(statuses()).toEqual(["skipped", "done"]);
    expect(h.convert).toHaveBeenCalledTimes(1);
  });
});

describe("cancelCurrentJob", () => {
  it("cancels running jobs and drops the remaining queue", async () => {
    h.convert.mockImplementation(
      (payload: { jobId: string }) =>
        new Promise((resolve) => {
        deferred.set(payload.jobId, resolve as unknown as (r: unknown) => void);
      }),
    );
    files("a.png", "b.png", "c.png");

    const p = appState.runConversion();
    await waitFor(() => appState.queue[0]?.status === "running");
    await appState.cancelCurrentJob();
    // backend would resolve the killed job now
    deferred.get(appState.queue[0].id)?.(null);
    await p;

    expect(h.cancel).toHaveBeenCalledWith(appState.queue[0].id);
    expect(statuses()).toEqual(["canceled", "canceled", "canceled"]);
    expect(appState.logs.join("")).toContain("Cancel requested.");
    // canceled runs do not write history
    expect(localStorage.getItem("zonevert:history")).toBeNull();
  });
});

describe("stopAfterCurrentJob", () => {
  it("finishes the current job, cancels the rest", async () => {
    h.convert.mockImplementation(
      (payload: { jobId: string }) =>
        new Promise((resolve) => {
        deferred.set(payload.jobId, resolve as unknown as (r: unknown) => void);
      }),
    );
    files("a.png", "b.png", "c.png");

    const p = appState.runConversion();
    await waitFor(() => appState.queue[0]?.status === "running");
    appState.stopAfterCurrentJob();
    deferred.get(appState.queue[0].id)?.({ ok: true });
    await p;

    expect(statuses()).toEqual(["done", "canceled", "canceled"]);
  });
});

describe("retryFailed", () => {
  it("re-runs only previously failed items", async () => {
    h.convert.mockImplementation(async (payload: { args: string[] }) => {
      if (payload.args.includes("/in/b.png")) return { ok: false, error: "nope" };
      return { ok: true };
    });
    files("a.png", "b.png", "c.png");
    await appState.runConversion();
    expect(statuses()).toEqual(["done", "failed", "done"]);

    h.convert.mockClear();
    h.convert.mockImplementation(async () => ({ ok: true }));
    await appState.retryFailed();

    expect(h.convert).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(["done", "done", "done"]);
  });
});

describe("log streaming", () => {
  it("attaches progress frames to running items only", () => {
    appState.queue = [
      {
        id: "j1",
        file: { path: "/in/a.png", name: "a.png" },
        args: [],
        outputPath: "/out/a.webp",
        status: "running",
      },
    ];
    const progressLine = "frame=  10 fps= 30 q=28.0 size=  1024kB time=00:00:01.00";

    logCallback?.({ jobId: "j1", stream: "stderr", text: progressLine });
    expect(appState.queue[0].progress?.frame).toBe(10);

    // after the job terminates, further frames are dropped
    appState.queue[0].status = "done";
    logCallback?.({ jobId: "j1", stream: "stderr", text: progressLine });
    expect(logCallback).toBeTypeOf("function");

    // unknown job frames are dropped too
    logCallback?.({ jobId: "nope", stream: "stderr", text: progressLine });

    // non-progress stderr lands in the log
    logCallback?.({ jobId: "j1", stream: "stderr", text: "some random stderr" });
    expect(appState.logs.join("")).toContain("some random stderr");
  });
});

describe("ffmpeg encoder pre-flight", () => {
  it("populates encoders at init and warns for a missing encoder", async () => {
    expect(appState.encoders.has("libwebp")).toBe(true);
    // webp needs libwebp/libwebp_anim -> present, no warning
    expect(appState.encoderWarning).toBeNull();

    h.probeEncoders.mockImplementation(async () => ["png", "mjpeg"]);
    (appState as unknown as { platformReady: boolean }).platformReady = false;
    await appState.init();

    expect(appState.encoderWarning).toMatch(/no libwebp or libwebp_anim encoder/);
  });
});

describe("history", () => {
  it("caps restored history at 20 entries", async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      timestamp: i,
      fileCount: 1,
      settings: {},
      summary: { done: 1, failed: 0, skipped: 0 },
    }));
    localStorage.setItem("zonevert:history", JSON.stringify(entries));

    // init() is idempotent-gated by platformReady; drop the gate to re-run
    // the loaders against the seeded storage.
    (appState as unknown as { platformReady: boolean }).platformReady = false;
    await appState.init();

    expect(appState.history).toHaveLength(20);
  });

  it("restoring an entry merges settings over defaults", () => {
    appState.settings.quality = 10;
    appState.restoreHistory({
      timestamp: 0,
      fileCount: 1,
      settings: { quality: 77 } as never,
      summary: { done: 1, failed: 0, skipped: 0 },
    });
    expect(appState.settings.quality).toBe(77);
    expect(appState.settings.format).toBe("webp"); // default preserved
  });
});

describe("video intake + queue", () => {
  const videoProbe: MediaProbeResult = {
    ok: true,
    duration: 12.345,
    video: { codecType: "video", codecName: "h264", width: 1920, height: 1080, pixFmt: "yuv420p", frameRate: 30 },
    audio: { codecType: "audio", codecName: "aac", sampleRate: 44100, channels: 2 },
  };

  it("classifies dropped videos and summarizes them", async () => {
    h.probeMedia.mockImplementation(async () => videoProbe);
    appState.addDroppedFiles(["/in/clip.mp4"]);

    await waitFor(() => appState.isVideo("/in/clip.mp4"));
    expect(appState.videoSummary("/in/clip.mp4")).toContain("1920×1080");
    expect(appState.videoSummary("/in/clip.mp4")).toContain("h264");
  });

  it("plans a mixed image+video queue with each kind's intent", async () => {
    h.probeMedia.mockImplementation(async () => videoProbe);
    h.convert.mockImplementation(async () => ({ ok: true }));
    appState.files = [{ path: "/in/a.png", name: "a.png" }];
    appState.outputDir = "/out";
    appState.settings.videoProfile = "webm-vp9";
    appState.addDroppedFiles(["/in/clip.mp4"]);
    await waitFor(() => appState.isVideo("/in/clip.mp4"));

    await appState.runConversion();

    const videoItem = appState.queue.find((i) => i.file.path === "/in/clip.mp4")!;
    expect(videoItem.status).toBe("done");
    expect(videoItem.args).toContain("libvpx-vp9");
    expect(videoItem.duration).toBe(12.345);
    expect(videoItem.outputPath).toBe("/out/clip.webm");
    const imageItem = appState.queue.find((i) => i.file.path === "/in/a.png")!;
    expect(imageItem.args).toContain("libwebp");
    expect(imageItem.duration).toBeUndefined();
  });

  it("excludes unreadable videos from the queue instead of failing mid-run", async () => {
    h.probeMedia.mockImplementation(async () => videoProbe);
    appState.addDroppedFiles(["/in/clip.mp4"]);
    await waitFor(() => appState.isVideo("/in/clip.mp4"));
    // probe cache lost between ingest and run (e.g. re-probe race)
    (appState as unknown as { videoMeta: Map<string, unknown> }).videoMeta = new Map();

    await appState.runConversion();

    expect(appState.queue).toHaveLength(0);
    expect(appState.logs.join("")).toContain("Skipped");
  });

  it("computes percent progress and ETA for running video items", async () => {
    h.probeMedia.mockImplementation(async () => ({ ...videoProbe, duration: 120 }));
    let release!: (r: { ok: boolean }) => void;
    h.convert.mockImplementation(() => new Promise((r) => { release = r; }));
    appState.addDroppedFiles(["/in/clip.mp4"]);
    await waitFor(() => appState.isVideo("/in/clip.mp4"));

    const p = appState.runConversion();
    await waitFor(() => appState.queue[0]?.status === "running");
    logCallback!({
      jobId: appState.queue[0].id,
      stream: "stderr",
      text: "frame=  60 fps= 30 q=28.0 size=     256kB time=00:00:30.00 bitrate=1024.0kbits/s speed=2x",
    });

    expect(appState.queue[0].progressPercent).toBe(25);
    expect(appState.queue[0].progress?.speed).toBe(2);

    release({ ok: true });
    await p;
  });
});

describe("video hardware encoders", () => {
  const videoProbe: MediaProbeResult = {
    ok: true,
    duration: 12.345,
    video: { codecType: "video", codecName: "vp9", width: 1280, height: 720 },
    audio: { codecType: "audio", codecName: "opus", sampleRate: 48000, channels: 2 },
  };

  async function withVideoFile() {
    h.probeMedia.mockImplementation(async () => videoProbe);
    appState.outputDir = "/out";
    appState.addDroppedFiles(["/in/clip.mkv"]);
    await waitFor(() => appState.isVideo("/in/clip.mkv"));
  }

  it("uses a validated hardware encoder with its vendor quality flags", async () => {
    h.probeEncoders.mockImplementation(async () => ["libx264", "h264_nvenc", "libvpx-vp9", "libopus"]);
    await appState.probeFfmpeg();
    h.convert.mockImplementation(async () => ({ ok: true }));
    await withVideoFile();

    await appState.runConversion();

    const item = appState.queue.find((i) => i.file.path === "/in/clip.mkv")!;
    expect(item.args).toContain("h264_nvenc");
    expect(item.args).toContain("-cq");
    // validation ran through the same convert binding
    expect(h.convert).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "validate:h264_nvenc" }),
    );
  });

  it("falls back to CPU when validation fails", async () => {
    h.probeEncoders.mockImplementation(async () => ["libx264", "h264_nvenc", "libvpx-vp9", "libopus"]);
    await appState.probeFfmpeg();
    // validation encode fails (e.g. driver blocks the GPU)
    h.convert.mockImplementation(async (p: { jobId: string; args: string[] }) =>
      p.args.includes("h264_nvenc") ? { ok: false, error: "Cannot load nvcuda" } : { ok: true },
    );
    await withVideoFile();

    await appState.runConversion();

    const item = appState.queue.find((i) => i.file.path === "/in/clip.mkv")!;
    expect(item.args).toContain("libx264");
    expect(item.args).not.toContain("h264_nvenc");
    expect(appState.logs.join("")).toContain("Encoder validation failed: h264_nvenc");
  });

  it("cpu preference keeps the CPU encoder even when hardware validates", async () => {
    h.probeEncoders.mockImplementation(async () => ["libx264", "h264_nvenc", "libvpx-vp9", "libopus"]);
    await appState.probeFfmpeg();
    h.convert.mockImplementation(async () => ({ ok: true }));
    appState.settings.videoEncoder = "cpu";
    await withVideoFile();

    await appState.runConversion();

    const item = appState.queue.find((i) => i.file.path === "/in/clip.mkv")!;
    expect(item.args).toContain("libx264");
    expect(item.args).not.toContain("h264_nvenc");
  });
});
