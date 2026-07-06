// Downloads a pinned, checksum-verified static ffmpeg sidecar for the current
// platform into src-tauri/binaries/ (Tauri externalBin). Idempotent: skips if
// present. Hashes pin the exact artifact so a moved upstream "latest" fails the
// build instead of silently shipping a different binary.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = resolve(__dirname, "../src-tauri/binaries");
const isWin = process.platform === "win32";

// ponytail: linux = stable johnvansickle 6.0.1; macOS = same (both arches);
// windows = BtbN autobuild. Bump version + sha256 when you want newer ffmpeg.
let targets;
if (process.platform === "darwin") {
  // Apple Silicon vs Intel — pick the matching johnvansickle darwin build.
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const triple = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  targets = {
    name: `ffmpeg-${triple}`,
    url: `https://johnvansickle.com/ffmpeg/old-releases/ffmpeg-6.0.1-${arch}-static.tar.xz`,
    sha256:
      arch === "arm64"
        ? "7dbd8e2f47bd83de591b9d6ea70e67d32d9aa97e7d47ae402b60c2fe3fd4d0ab"
        : "28268bf402f1083833ea269331587f60a242848880073be8016501d864bd07a5",
    zip: false,
    inner: "ffmpeg",
  };
} else if (isWin) {
  targets = {
    name: "ffmpeg-x86_64-pc-windows-msvc.exe",
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip",
    sha256: "96da2e45528106314a3d474ccbbc9c8a7a32b3ba731754b78623cb8c9429b8e9",
    zip: true,
    inner: "ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe",
  };
} else {
  targets = {
    name: "ffmpeg-x86_64-unknown-linux-gnu",
    url: "https://johnvansickle.com/ffmpeg/old-releases/ffmpeg-6.0.1-amd64-static.tar.xz",
    sha256: "28268bf402f1083833ea269331587f60a242848880073be8016501d864bd07a5",
    zip: false,
    inner: "ffmpeg",
  };
}
const dest = join(binDir, targets.name);
if (existsSync(dest)) {
  console.log(`[fetch-ffmpeg] ${targets.name} already present, skipping.`);
  process.exit(0);
}
mkdirSync(binDir, { recursive: true });

const tmp = tmpdir();
const archive = join(tmp, `zv-ffmpeg-${isWin ? "win.zip" : "linux.tar.xz"}`);
download(targets.url, archive);

const actual = sha256File(archive);
if (actual !== targets.sha256) {
  console.error(
    `[fetch-ffmpeg] CHECKSUM MISMATCH for ${targets.name}\n  expected: ${targets.sha256}\n  actual:   ${actual}`,
  );
  process.exit(1);
}

if (targets.zip) {
  unzip(archive, tmp);
  copyFileSync(join(tmp, targets.inner), dest);
  rmSync(join(tmp, targets.inner), { force: true });
} else {
  execFileSync("tar", ["-xf", archive, "-C", tmp]);
  const extracted = join(tmp, readdirSync(tmp).find((d) => d.startsWith("ffmpeg-")) || "", targets.inner);
  copyFileSync(extracted, dest);
  rmSync(extracted, { force: true });
}
console.log(`[fetch-ffmpeg] verified + wrote ${dest}`);

function download(url, out) {
  if (isWin) {
    execFileSync("powershell", ["-NoProfile", "-Command", `Invoke-WebRequest -Uri '${url}' -OutFile '${out}'`]);
  } else {
    execFileSync("curl", ["-fsSL", "-o", out, url]);
  }
}
function unzip(archive, destDir) {
  if (isWin) {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive '${archive}' -DestinationPath '${destDir}'`]);
  } else {
    execFileSync("unzip", ["-o", archive, "-d", destDir]);
  }
}
function sha256File(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}
