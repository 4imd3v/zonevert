// Ported from src/queue-state.js — UMD wrapper removed, ESM exports added,
// types added per migrate/07-svelte-frontend.md. Algorithms unchanged.

import type { ConversionIntent, ConversionPlan } from "./conversion-plan";
import { etaSeconds, progressPercent, type ProgressFrame } from "./progress-parser";

export type QueueItemStatus = "pending" | "running" | "done" | "failed" | "canceled" | "skipped";

export interface QueueItem {
  id: string;
  file: { path: string; name: string };
  args: string[];
  outputPath: string;
  status: QueueItemStatus;
  progress?: ProgressFrame;
  /** Total duration in seconds from the media probe (video items). */
  duration?: number;
  /** 0-100 once a progress frame with a timecode arrives; omitted when
   *  duration is unknown (indeterminate progress). */
  progressPercent?: number;
  /** Approximate output size in bytes (video plans). */
  estimatedBytes?: number;
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

export function createQueue(
  files: { path: string; name: string }[],
  intent: ConversionIntent,
  planner: (file: { path: string; name: string }, intent: ConversionIntent, index?: number) => ConversionPlan,
  createId: () => string = defaultCreateId,
): QueueItem[] {
  const queue = files.map((file, index) => {
    const plan = planner(file, intent, index);

    return {
      id: createId(),
      file,
      args: plan.args,
      outputPath: plan.outputPath,
      status: "pending" as QueueItemStatus,
      ...(plan.duration != null ? { duration: plan.duration } : {}),
      ...(plan.estimatedBytes != null ? { estimatedBytes: plan.estimatedBytes } : {}),
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

/**
 * Attach a progress frame only to a *running* item. Frames that arrive after
 * a job reached a terminal state (or for an unknown job) are dropped.
 * Returns true if the frame was applied (caller reassigns for reactivity).
 */
export function applyProgress(
  queue: QueueItem[],
  jobId: string,
  frame: ProgressFrame,
): boolean {
  const item = queue.find((q) => q.id === jobId);
  if (!item || item.status !== "running") return false;
  item.progress = frame;
  const percent = progressPercent(frame.time, item.duration);
  if (percent !== null) {
    item.progressPercent = percent;
  }
  return true;
}

/** Video ETA from the item's frame speed, or null when not computable. */
export function itemEtaSeconds(item: QueueItem): number | null {
  if (item.status !== "running") return null;
  return etaSeconds(item.progress, item.duration);
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight. Shared by
 * the thumbnail loader and the conversion queue. Once `shouldStop()` returns
 * true, remaining items are drained through `onSkipped` (e.g. marked
 * canceled) and every worker exits.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  onSkipped?: (item: T) => void,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  const queue = [...items];
  const lanes = Math.max(1, Math.min(concurrency, queue.length || 1));
  const workers = Array.from({ length: lanes }, async () => {
    while (queue.length) {
      if (shouldStop()) {
        for (const skipped of queue.splice(0)) onSkipped?.(skipped);
        return;
      }
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
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
