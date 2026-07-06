// Downloads the static ffmpeg sidecar for the current platform into
// src-tauri/binaries/ (Tauri externalBin). Idempotent: skips if present.
// CI also fetches (release.yml) before packaging.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = resolve(__dirname, "../src-tauri/binaries");
const isWin = process.platform === "winnt" || process.platform === "win32";

const targets = isWin
  ? { name: "ffmpeg-x86_64-pc-windows-msvc.exe", url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip", zip: true, inner: "ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe" }
  : { name: "ffmpeg-x86_64-unknown-linux-gnu", url: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz", zip: false, inner: "ffmpeg" };

const dest = join(binDir, targets.name);
if (existsSync(dest)) {
  console.log(`[fetch-ffmpeg] ${targets.name} already present, skipping.`);
  process.exit(0);
}
mkdirSync(binDir, { recursive: true });

const tmp = tmpdir();
if (targets.zip) {
  const archive = join(tmp, "ff.zip");
  download(targets.url, archive);
  unzip(archive, tmp);
  renameSync(join(tmp, targets.inner), dest);
} else {
  const archive = join(tmp, "ff.tar.xz");
  download(targets.url, archive);
  execFileSync("tar", ["-xf", archive, "-C", tmp]);
  const extracted = join(tmp, (readdirSync(tmp).find((d) => d.startsWith("ffmpeg-")) || ""), targets.inner);
  renameSync(extracted, dest);
}
console.log(`[fetch-ffmpeg] wrote ${dest}`);

function download(url, out) {
  if (process.platform === "win32") {
    execFileSync("powershell", ["-NoProfile", "-Command", `Invoke-WebRequest -Uri '${url}' -OutFile '${out}'`]);
  } else {
    execFileSync("curl", ["-fsSL", "-o", out, url]);
  }
}
function unzip(archive, destDir) {
  if (process.platform === "win32") {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive '${archive}' -DestinationPath '${destDir}'`]);
  } else {
    execFileSync("unzip", ["-o", archive, "-d", destDir]);
  }
}
