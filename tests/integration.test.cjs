const test = require("node:test");
const assert = require("node:assert/strict");
const { createConversionIntent, planConversion } = require("../src/lib/logic/conversion-plan");
const {
  createQueue,
  markRunning,
  markResult,
  markSkipped,
  summarizeQueue,
  resetFailed
} = require("../src/lib/logic/queue-state");

test("full queue lifecycle: create → run → mark → summarize", () => {
  const intent = createConversionIntent({ format: "webp", outputDir: "/out" });
  const files = [
    { path: "/in/a.png", name: "a.png" },
    { path: "/in/b.png", name: "b.png" },
    { path: "/in/c.png", name: "c.png" }
  ];

  const queue = createQueue(files, intent, (file, _intent, index) => planConversion(file, intent, index), () => "job-x");

  assert.equal(queue.length, 3);
  assert.equal(queue.every((item) => item.status === "pending"), true);

  let summary = summarizeQueue(queue);
  assert.equal(summary.pending, 3);
  assert.equal(summary.progress, 0);

  // Run first item — success
  markRunning(queue[0]);
  summary = summarizeQueue(queue);
  assert.equal(summary.running, 1);
  assert.equal(summary.progress, 0);

  markResult(queue[0], { ok: true }, false);
  summary = summarizeQueue(queue);
  assert.equal(summary.done, 1);
  assert.equal(summary.progress, 33);

  // Run second item — failure
  markRunning(queue[1]);
  markResult(queue[1], { ok: false, error: "boom" }, false);
  summary = summarizeQueue(queue);
  assert.equal(summary.failed, 1);
  assert.equal(summary.progress, 67);

  // Third item skipped
  markSkipped(queue[2]);
  summary = summarizeQueue(queue);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.progress, 100);

  // Retry failed
  resetFailed(queue);
  summary = summarizeQueue(queue);
  assert.equal(summary.pending, 1);
  assert.equal(summary.done, 1);
  assert.equal(summary.skipped, 1);
});

test("collision resolution during full lifecycle", () => {
  const intent = createConversionIntent({ format: "webp", outputDir: "/out" });
  const files = [
    { path: "/dir/photo.png", name: "photo.png" },
    { path: "/other/photo.png", name: "photo.png" }
  ];

  const queue = createQueue(files, intent, (file, _intent, index) => planConversion(file, intent, index), () => "job-y");

  // Both output to /out/photo.webp since same output dir — collision resolved
  assert.equal(queue[0].outputPath, "/out/photo.webp");
  assert.equal(queue[1].outputPath, "/out/photo-1.webp");
});
