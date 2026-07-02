import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// ---- result types (mirror the Rust serde structs in 03-rust-backend.md) ----

export interface ProbeResult {
  ok: boolean;
  code?: number;
  version?: string;
  error?: string;
}

export interface ConvertResult {
  ok: boolean;
  code?: number;
  signal?: string;
  error?: string;
}

export interface CancelResult {
  ok: boolean;
  error?: string;
}

export interface ExistsResult {
  ok: boolean;
  exists: boolean;
}

export interface SaveResult {
  ok: boolean;
  filePath: string;
  error?: string;
  canceled?: boolean;
}

export interface ThumbnailResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export interface ProbeImageResult {
  ok: boolean;
  width?: number;
  height?: number;
  error?: string;
}

export interface SelectedImage {
  path: string;
  name: string;
}

export interface LogEntry {
  jobId: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface ConvertPayload {
  jobId: string;
  ffmpegPath?: string;
  args: string[];
}

const IMAGE_EXTENSIONS = [
  "apng", "avif", "bmp", "gif", "heic", "heif",
  "jpeg", "jpg", "png", "tif", "tiff", "webp",
];

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i === -1 ? p : p.slice(i + 1);
}

// ---- bindings ----

/** Returns Electron-style platform strings ("win32"/"linux"/"darwin")
 *  so conversion-plan.ts path-quoting (`=== "win32"`) needs no changes. */
export async function getPlatform(): Promise<string> {
  return invoke<string>("platform");
}

export async function selectImages(): Promise<SelectedImage[]> {
  const result = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: "Images", extensions: IMAGE_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!result) return [];
  const list = Array.isArray(result) ? result : [result];
  return list.map((p) => ({ path: p, name: basename(p) }));
}

export async function selectOutputDir(): Promise<string> {
  const result = await open({ directory: true, multiple: false });
  return result ?? "";
}

export async function probeFfmpeg(ffmpegPath?: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("probe_ffmpeg", { ffmpegPath });
}

export async function convert(payload: ConvertPayload): Promise<ConvertResult> {
  return invoke<ConvertResult>("convert", { payload });
}

export async function cancel(jobId: string): Promise<CancelResult> {
  return invoke<CancelResult>("cancel", { jobId });
}

export async function checkExists(filePath: string): Promise<ExistsResult> {
  return invoke<ExistsResult>("check_exists", { path: filePath });
}

export async function getThumbnail(filePath: string): Promise<ThumbnailResult> {
  return invoke<ThumbnailResult>("image_thumbnail", { filePath });
}

export async function probeImage(
  filePath: string,
  ffmpegPath?: string,
): Promise<ProbeImageResult> {
  return invoke<ProbeImageResult>("probe_image", { filePath, ffmpegPath });
}

export async function saveFile(payload: {
  title?: string;
  defaultPath?: string;
  content: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<SaveResult> {
  if (typeof payload.content !== "string") {
    return { ok: false, filePath: "", error: "File content is required." };
  }
  const filePath = await save({
    title: payload.title ?? "Save file",
    defaultPath: payload.defaultPath ?? "output.txt",
    filters: payload.filters ?? [{ name: "Text", extensions: ["txt"] }],
  });
  if (!filePath) return { ok: false, filePath: "", canceled: true };
  return invoke<SaveResult>("save_file", { filePath, content: payload.content });
}

export async function showNotification(payload: {
  title: string;
  body?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (typeof payload.title !== "string") {
    return { ok: false, error: "Notification title is required." };
  }
  let granted = await isPermissionGranted();
  if (!granted) {
    const p = await requestPermission();
    granted = p === "granted";
  }
  if (!granted) {
    return { ok: false, error: "Notifications not supported on this platform." };
  }
  sendNotification({
    title: payload.title,
    body: payload.body ?? "",
  });
  return { ok: true };
}

/** Subscribe to global ffmpeg:log events. Returns an unsubscribe function. */
export async function onLog(callback: (entry: LogEntry) => void): Promise<UnlistenFn> {
  // Tauri's listen() returns a Promise<UnlistenFn>. The store awaits it
  // (see 07-svelte-frontend.md) so teardown is always safe.
  return listen<LogEntry>("ffmpeg:log", (event) => callback(event.payload));
}
