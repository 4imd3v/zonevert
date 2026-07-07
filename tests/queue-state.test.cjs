const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createQueue,
  markResult,
  markRunning,
  markSkipped,
  resetFailed,
  resolveCollisions,
  statusLabel,
  summarizeQueue
} = require("../src/lib/logic/queue-state");
const { createConversionIntent, planConversion } = require("../src/lib/logic/conversion-plan");

test("creates queue items from planned conversions", () => {
  const files = [{ path: "/in/a.png", name: "a.png" }];
  const queue = createQueue(
    files,
    {},
    (file) => ({
      file,
      args: ["-i", file.path, "/out/a.webp"],
      outputPath: "/out/a.webp"
    }),
    () => "job-1"
  );

  assert.deepEqual(queue, [
    {
      id: "job-1",
      file: files[0],
      args: ["-i", "/in/a.png", "/out/a.webp"],
      outputPath: "/out/a.webp",
      status: "pending"
    }
  ]);
});

test("summarizes progress and canceled jobs", () => {
  const queue = [
    { status: "done" },
    { status: "failed" },
    { status: "canceled" },
    { status: "pending" }
  ];

  assert.deepEqual(summarizeQueue(queue), {
    pending: 1,
    running: 0,
    done: 1,
    failed: 1,
    canceled: 1,
    skipped: 0,
    total: 4,
    progress: 75,
    text: "1 pending · 0 running · 1 done · 1 failed · 1 canceled"
  });
});

test("marks cancellation without treating it as failure", () => {
  const queue = [{ status: "running" }, { status: "pending" }];

  markRunning(queue[0]);
  markResult(queue[0], { ok: false }, true);
  // ponytail: cancelPending removed — only running item reaches markResult;
  // pending items are canceled via markCanceled in the store's cancel path.

  assert.deepEqual(queue.map((item) => item.status), ["canceled", "pending"]);
  assert.equal(statusLabel("canceled"), "Canceled");
});

test("resolves output path collisions with numeric suffixes", () => {
  const queue = [
    { outputPath: "/out/photo.webp", args: ["-i", "a.png", "/out/photo.webp"], status: "pending" },
    { outputPath: "/out/photo.webp", args: ["-i", "b.png", "/out/photo.webp"], status: "pending" },
    { outputPath: "/out/photo.webp", args: ["-i", "c.png", "/out/photo.webp"], status: "pending" }
  ];

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
    { status: "pending" }
  ];

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
    { status: "pending", file: { name: "d" } }
  ];

  const reset = resetFailed(queue);
  assert.equal(reset.length, 2);
  assert.deepEqual(queue.map((item) => item.status), ["done", "pending", "pending", "pending"]);
});
