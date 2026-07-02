// Ported from src/queue-state.js — UMD wrapper removed, ESM exports added,
// types added per migrate/07-svelte-frontend.md. Algorithms unchanged.

import type { ConversionIntent, ConversionPlan } from "./conversion-plan";

export type QueueItemStatus = "pending" | "running" | "done" | "failed" | "canceled" | "skipped";

export interface QueueItem {
  id: string;
  file: { path: string; name: string };
  args: string[];
  outputPath: string;
  status: QueueItemStatus;
}

export interface QueueSummary {
  pending: number;
  running: number;
  done: number;
  failed: number;
  canceled: number;
  skipped: number;
  total: number;
  progress: number;
  text: string;
}

const terminalStatuses = new Set<string>(["done", "failed", "canceled", "skipped"]);

export function createQueue(
  files: { path: string; name: string }[],
  intent: ConversionIntent,
  planner: (file: { path: string; name: string }, intent: ConversionIntent) => ConversionPlan,
  createId: () => string = defaultCreateId,
): QueueItem[] {
  const queue = files.map((file) => {
    const plan = planner(file, intent);

    return {
      id: createId(),
      file,
      args: plan.args,
      outputPath: plan.outputPath,
      status: "pending" as QueueItemStatus,
    };
  });

  resolveCollisions(queue);
  return queue;
}

export function resolveCollisions(queue: QueueItem[]): void {
  const seen = new Map<string, number>();

  for (const item of queue) {
    const original = item.outputPath;
    if (!seen.has(original)) {
      seen.set(original, 1);
      continue;
    }

    const count = seen.get(original)!;
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

export function summarizeQueue(queue: QueueItem[]): QueueSummary {
  const summary: QueueSummary = {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    canceled: 0,
    skipped: 0,
    total: queue.length,
    progress: 0,
    text: "0 pending",
  };

  for (const item of queue) {
    const key = item.status as keyof QueueSummary;
    if (typeof summary[key] === "number") {
      (summary[key] as number) += 1;
    }
  }

  const finished = summary.done + summary.failed + summary.canceled + summary.skipped;
  summary.progress = summary.total ? Math.round((finished / summary.total) * 100) : 0;

  if (summary.total) {
    const parts = [
      `${summary.pending} pending`,
      `${summary.running} running`,
      `${summary.done} done`,
      `${summary.failed} failed`,
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

export function markRunning(item: QueueItem): QueueItem {
  item.status = "running";
  return item;
}

export function markResult(
  item: QueueItem,
  result: { ok?: boolean } | null | undefined,
  cancelRequested: boolean,
): QueueItem {
  if (cancelRequested) {
    return markCanceled(item);
  }

  item.status = result?.ok ? "done" : "failed";
  return item;
}

export function markCanceled(item: QueueItem): QueueItem {
  item.status = "canceled";
  return item;
}

export function cancelPending(queue: QueueItem[]): void {
  for (const item of queue) {
    if (!terminalStatuses.has(item.status)) {
      markCanceled(item);
    }
  }
}

export function statusLabel(status: QueueItemStatus): string {
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

export function markSkipped(item: QueueItem): QueueItem {
  item.status = "skipped";
  return item;
}

export function resetFailed(queue: QueueItem[]): QueueItem[] {
  const reset: QueueItem[] = [];
  for (const item of queue) {
    if (item.status === "failed") {
      item.status = "pending";
      reset.push(item);
    }
  }
  return reset;
}

function defaultCreateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
