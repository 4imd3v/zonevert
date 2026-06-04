(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  root.ZonevertQueueState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const terminalStatuses = new Set(["done", "failed", "canceled"]);

  function createQueue(files, intent, planner, createId = defaultCreateId) {
    return files.map((file) => {
      const plan = planner(file, intent);

      return {
        id: createId(),
        file,
        args: plan.args,
        outputPath: plan.outputPath,
        status: "pending"
      };
    });
  }

  function summarizeQueue(queue) {
    const summary = {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      canceled: 0,
      total: queue.length,
      progress: 0,
      text: "0 pending"
    };

    for (const item of queue) {
      if (summary[item.status] !== undefined) {
        summary[item.status] += 1;
      }
    }

    const finished = summary.done + summary.failed + summary.canceled;
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

    return "Pending";
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
    statusLabel,
    summarizeQueue
  };
});
