// Sync the Rust-side version (tauri.conf.json, Cargo.toml, Cargo.lock)
// to the version in package.json. Run by `pnpm version` after it bumps package.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;

const tauriConf = resolve(root, "src-tauri/tauri.conf.json");
const conf = JSON.parse(readFileSync(tauriConf, "utf8"));
conf.version = version;
writeFileSync(tauriConf, JSON.stringify(conf, null, 4) + "\n");

const cargoToml = resolve(root, "src-tauri/Cargo.toml");
const cargo = readFileSync(cargoToml, "utf8").replace(/^version = .*/m, `version = "${version}"`);
writeFileSync(cargoToml, cargo);

// Refresh the lockfile entry for the local crate (best-effort).
if (existsSync(resolve(root, "src-tauri/Cargo.lock"))) {
  try {
    execSync(`cargo update -p zonevert --precise ${version}`, { cwd: resolve(root, "src-tauri"), stdio: "inherit" });
  } catch {
    // cargo may be absent in some envs; tauri build will refresh the lock anyway.
  }
}

console.log(`synced Rust version to ${version}`);
