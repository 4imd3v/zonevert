// ponytail: minimal dev wrapper — spawns electron with --no-sandbox and
// auto-reloads the renderer on src/ file changes.
const { spawn } = require("node:child_process");
const path = require("node:path");

const electronPath = require.resolve("electron");
const args = [".", "--no-sandbox"];

function startElectron() {
  const child = spawn(electronPath, args, {
    stdio: "inherit",
    cwd: path.resolve(__dirname, "..")
  });

  child.on("close", (code) => {
    process.exit(code ?? 0);
  });

  return child;
}

try {
  require("electron-reload")(
    path.resolve(__dirname, "..", "src"),
    {
      electron: electronPath
    }
  );
} catch {
  console.log("electron-reload not available, starting electron without reload");
}

startElectron();
