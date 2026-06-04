const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cancelPending,
  createQueue,
  markResult,
  markRunning,
  statusLabel,
  summarizeQueue
} = require("../src/queue-state");

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
    total: 4,
    progress: 75,
    text: "1 pending · 0 running · 1 done · 1 failed · 1 canceled"
  });
});

test("marks cancellation without treating it as failure", () => {
  const queue = [{ status: "running" }, { status: "pending" }];

  markRunning(queue[0]);
  markResult(queue[0], { ok: false }, true);
  cancelPending(queue);

  assert.deepEqual(queue.map((item) => item.status), ["canceled", "canceled"]);
  assert.equal(statusLabel("canceled"), "Canceled");
});
