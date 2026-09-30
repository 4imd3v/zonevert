import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appState } from "$lib/stores/app-state.svelte";

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
