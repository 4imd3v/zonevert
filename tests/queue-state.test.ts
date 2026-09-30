import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  applyProgress,
  createQueue,
  markResult,
  markRunning,
  markSkipped,
  resetFailed,
  resolveCollisions,
  runPool,
  statusLabel,
  summarizeQueue,
} from "../src/lib/logic/queue-state";
import { createConversionIntent, planConversion } from "../src/lib/logic/conversion-plan";

describe("queue-state", () => {
  test("creates queue items from planned conversions", () => {
    const files = [{ path: "/in/a.png", name: "a.png" }];
    const queue = createQueue(
      files,
      {} as any,
      (file) => ({
        file,
        args: ["-i", file.path, "/out/a.webp"],
        outputPath: "/out/a.webp",
      }),
      () => "job-1",
    );

    assert.deepEqual(queue, [
      {
        id: "job-1",
        file: files[0],
        args: ["-i", "/in/a.png", "/out/a.webp"],
        outputPath: "/out/a.webp",
        status: "pending",
      },
    ]);
  });

  test("summarizes progress and canceled jobs", () => {
    const queue = [
      { status: "done" },
      { status: "failed" },
      { status: "canceled" },
      { status: "pending" },
    ] as any[];

    assert.deepEqual(summarizeQueue(queue), {
      pending: 1,
      running: 0,
      done: 1,
      failed: 1,
      canceled: 1,
      skipped: 0,
      total: 4,
      progress: 75,
      text: "1 pending · 0 running · 1 done · 1 failed · 1 canceled",
    });
  });

  test("marks cancellation without treating it as failure", () => {
    const queue = [{ status: "running" }, { status: "pending" }] as any[];

    markRunning(queue[0]);
    markResult(queue[0], { ok: false }, true);

    assert.deepEqual(queue.map((item: any) => item.status), ["canceled", "pending"]);
    assert.equal(statusLabel("canceled"), "Canceled");
  });

  test("resolves output path collisions with numeric suffixes", () => {
    const queue = [
      { outputPath: "/out/photo.webp", args: ["-i", "a.png", "/out/photo.webp"], status: "pending" },
      { outputPath: "/out/photo.webp", args: ["-i", "b.png", "/out/photo.webp"], status: "pending" },
      { outputPath: "/out/photo.webp", args: ["-i", "c.png", "/out/photo.webp"], status: "pending" },
    ] as any[];

    resolveCollisions(queue);

    assert.equal(queue[0].outputPath, "/out/photo.webp");
    assert.equal(queue[1].outputPath, "/out/photo-1.webp");
    assert.equal(queue[2].outputPath, "/out/photo-2.webp");
    assert.equal(queue[1].args[2], "/out/photo-1.webp");
  });

  test("sequential numbering produces 001, 002, ...", () => {
    const intent = createConversionIntent({ format: "webp", outputDir: "/out", naming: { sequential: true } });
    const files = [
      { path: "/in/a.png", name: "a.png" },
      { path: "/in/b.png", name: "b.png" },
      { path: "/in/c.png", name: "c.png" },
    ];
    const queue = createQueue(files, intent, (file, _intent, index) => planConversion(file, intent, index), () => "job-seq");
    assert.equal(queue[0].outputPath, "/out/001.webp");
    assert.equal(queue[1].outputPath, "/out/002.webp");
    assert.equal(queue[2].outputPath, "/out/003.webp");
  });

  test("marks items as skipped and includes them in summary", () => {
    const queue = [
      { status: "done" },
      { status: "skipped" },
      { status: "pending" },
    ] as any[];

    const summary = summarizeQueue(queue);
    assert.equal(summary.done, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.progress, 67);
  });

  test("resets failed items back to pending", () => {
    const queue = [
      { status: "done", file: { name: "a" } },
      { status: "failed", file: { name: "b" } },
      { status: "failed", file: { name: "c" } },
      { status: "pending", file: { name: "d" } },
    ] as any[];

    const reset = resetFailed(queue);
    assert.equal(reset.length, 2);
    assert.deepEqual(queue.map((item: any) => item.status), ["done", "pending", "pending", "pending"]);
  });

  test("cancellation wins even when the conversion reported success", () => {
    const queue = [{ status: "running" }] as any[];

    markResult(queue[0], { ok: true }, true);

    assert.equal(queue[0].status, "canceled");
  });
});

describe("applyProgress", () => {
  const frame = { frame: 42, fps: 30, time: "00:00:01.00", sizeKb: 512, elapsed: null };

  test("applies only to running items", () => {
    const running = { id: "a", status: "running" } as any;
    const done = { id: "b", status: "done" } as any;
    const queue = [running, done];

    assert.equal(applyProgress(queue, "a", frame), true);
    assert.deepEqual(running.progress, frame);
  });

  test("drops frames for finished jobs and unknown ids", () => {
    const done = { id: "b", status: "done" } as any;
    const queue = [done];

    assert.equal(applyProgress(queue, "b", frame), false);
    assert.equal(applyProgress(queue, "missing", frame), false);
    assert.equal(done.progress, undefined);
  });
});

describe("runPool", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test("caps in-flight workers at the concurrency limit", async () => {
    let active = 0;
    let peak = 0;

    await runPool([1, 2, 3, 4, 5, 6], 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(10);
      active -= 1;
    });

    assert.equal(peak, 3, `expected peak concurrency 3, got ${peak}`);
  });

  test("runs sequentially at concurrency 1, preserving order", async () => {
    let active = 0;
    let peak = 0;
    const order: number[] = [];

    await runPool([1, 2, 3], 1, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      order.push(n);
      active -= 1;
    });

    assert.equal(peak, 1);
    assert.deepEqual(order, [1, 2, 3]);
  });

  test("drains remaining items through onSkipped once stopped", async () => {
    const processed: number[] = [];
    const skipped: number[] = [];
    let stop = false;

    await runPool(
      [1, 2, 3, 4],
      2,
      async (n) => {
        processed.push(n);
        if (processed.length === 2) stop = true;
        await sleep(5);
      },
      (n) => skipped.push(n),
      () => stop,
    );

    assert.deepEqual(processed.sort(), [1, 2]);
    assert.deepEqual(skipped.sort(), [3, 4]);
  });

  test("empty item list completes without calling the worker", async () => {
    let called = 0;

    await runPool([], 4, async () => {
      called += 1;
    });

    assert.equal(called, 0);
  });
});
