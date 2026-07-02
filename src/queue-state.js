// @ts-check
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  root.ZonevertQueueState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const terminalStatuses = new Set(["done", "failed", "canceled", "skipped"]);

  function createQueue(files, intent, planner, createId = defaultCreateId) {
    const queue = files.map((file) => {
      const plan = planner(file, intent);

      return {
        id: createId(),
        file,
        args: plan.args,
        outputPath: plan.outputPath,
        status: "pending"
      };
    });

    resolveCollisions(queue);
    return queue;
  }

  function resolveCollisions(queue) {
    const seen = new Map();

    for (const item of queue) {
      const original = item.outputPath;
      if (!seen.has(original)) {
        seen.set(original, 1);
        continue;
      }

      const count = seen.get(original);
      seen.set(original, count + 1);

      const dotIndex = original.lastIndexOf(".");
      const ext = dotIndex > 0 ? original.slice(dotIndex) : "";
      const base = dotIndex > 0 ? original.slice(0, dotIndex) : original;
      const newPath = `${base}-${count}${ext}`;

      item.outputPath = newPath;

      if (item.args && item.args.length) {
        item.args[item.args.length - 1] = newPath;
      }
    }
  }

  function summarizeQueue(queue) {
    const summary = {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      canceled: 0,
      skipped: 0,
      total: queue.length,
      progress: 0,
      text: "0 pending"
    };

    for (const item of queue) {
      if (summary[item.status] !== undefined) {
        summary[item.status] += 1;
      }
    }

    const finished = summary.done + summary.failed + summary.canceled + summary.skipped;
    summary.progress = summary.total ? Math.round((finished / summary.total) * 100) : 0;

    if (summary.total) {
      const parts = [
        `${summary.pending} pending`,
        `${summary.running} running`,
        `${summary.done} done`,
        `${summary.failed} failed`
      ];

      if (summary.canceled) {
        parts.push(`${summary.canceled} canceled`);
      }

      if (summary.skipped) {
        parts.push(`${summary.skipped} skipped`);
      }

      summary.text = parts.join(" · ");
    }

    return summary;
  }

  function markRunning(item) {
    item.status = "running";
    return item;
  }

  function markResult(item, result, cancelRequested) {
    if (cancelRequested) {
      return markCanceled(item);
    }

    item.status = result?.ok ? "done" : "failed";
    return item;
  }

  function markCanceled(item) {
    item.status = "canceled";
    return item;
  }

  function cancelPending(queue) {
    for (const item of queue) {
      if (!terminalStatuses.has(item.status)) {
        markCanceled(item);
      }
    }
  }

  function statusLabel(status) {
    if (status === "running") {
      return "Running";
    }

    if (status === "done") {
      return "Done";
    }

    if (status === "failed") {
      return "Failed";
    }

    if (status === "canceled") {
      return "Canceled";
    }

    if (status === "skipped") {
      return "Skipped";
    }

    return "Pending";
  }

  function markSkipped(item) {
    item.status = "skipped";
    return item;
  }

  function resetFailed(queue) {
    const reset = [];
    for (const item of queue) {
      if (item.status === "failed") {
        item.status = "pending";
        reset.push(item);
      }
    }
    return reset;
  }

  function defaultCreateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  return {
    cancelPending,
    createQueue,
    markCanceled,
    markResult,
    markRunning,
    markSkipped,
    resetFailed,
    resolveCollisions,
    statusLabel,
    summarizeQueue
  };
});
