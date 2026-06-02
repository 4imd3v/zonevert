const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const electronPackagePath = require.resolve("electron/package.json");
const electronRoot = path.dirname(electronPackagePath);
const electronPackage = require(electronPackagePath);
const platformPath = getPlatformPath();

function isInstalled() {
  try {
    const distVersion = fs.readFileSync(path.join(electronRoot, "dist", "version"), "utf8").replace(/^v/, "");
    const pathFile = fs.readFileSync(path.join(electronRoot, "path.txt"), "utf8");

    return distVersion === electronPackage.version && pathFile === platformPath;
  } catch {
    return false;
  }
}

function getPlatformPath() {
  const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform;

  switch (platform) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

async function main() {
  if (isInstalled()) {
    return;
  }

  const getPackagePath = require.resolve("@electron/get", {
    paths: [electronRoot]
  });
  const { downloadArtifact } = await import(pathToFileURL(getPackagePath).href);
  const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform;
  const arch = process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch;
  const distPath = path.join(electronRoot, "dist");

  const zipPath = await downloadArtifact({
    version: electronPackage.version,
    artifactName: "electron",
    platform,
    arch,
    cacheRoot: process.env.electron_config_cache,
    checksums: require(path.join(electronRoot, "checksums.json"))
  });

  await fs.promises.rm(distPath, {
    recursive: true,
    force: true
  });
  await fs.promises.mkdir(distPath, {
    recursive: true
  });
  extractArchive(zipPath, distPath);

  const extractedTypes = path.join(distPath, "electron.d.ts");
  if (fs.existsSync(extractedTypes)) {
    await fs.promises.rename(extractedTypes, path.join(electronRoot, "electron.d.ts"));
  }

  await fs.promises.writeFile(path.join(electronRoot, "path.txt"), platformPath);
}

function extractArchive(zipPath, distPath) {
  if (process.platform === "win32") {
    runArchiveTool("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Expand-Archive -Force -LiteralPath $args[0] -DestinationPath $args[1]",
      zipPath,
      distPath
    ]);
    return;
  }

  const unzip = spawnSync("unzip", ["-oq", zipPath, "-d", distPath], {
    stdio: "inherit"
  });

  if (unzip.status === 0) {
    return;
  }

  runArchiveTool("tar", ["-xf", zipPath, "-C", distPath]);
}

function runArchiveTool(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
