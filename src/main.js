const { app, BrowserWindow, dialog, ipcMain, Notification, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  validateCancelPayload,
  validateConversionPayload,
  validateProbePayload
} = require("./ipc-validation");

const runningProcesses = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 680,
    backgroundColor: "#f4f5f7",
    title: "Zonevert",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

function resolveFfmpegPath(ffmpegPath) {
  const trimmed = typeof ffmpegPath === "string" ? ffmpegPath.trim() : "";
  return trimmed || process.env.FFMPEG_PATH || "ffmpeg";
}

function runProbe(ffmpegPath) {
  return new Promise((resolve) => {
    const child = spawn(resolveFfmpegPath(ffmpegPath), ["-version"], {
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        error: error.message
      });
    });

    child.on("close", (code) => {
      const firstLine = stdout.split(/\r?\n/).find(Boolean);
      resolve({
        ok: code === 0,
        code,
        version: firstLine || "",
        error: code === 0 ? "" : stderr || stdout
      });
    });
  });
}

function runConversion(event, request) {
  return new Promise((resolve) => {
    const { jobId, ffmpegPath, args } = request;

    const child = spawn(resolveFfmpegPath(ffmpegPath), args, {
      windowsHide: true
    });

    runningProcesses.set(jobId, child);

    child.stdout.on("data", (chunk) => {
      event.sender.send("ffmpeg:log", {
        jobId,
        stream: "stdout",
        text: chunk.toString()
      });
    });

    child.stderr.on("data", (chunk) => {
      event.sender.send("ffmpeg:log", {
        jobId,
        stream: "stderr",
        text: chunk.toString()
      });
    });

    child.on("error", (error) => {
      runningProcesses.delete(jobId);
      resolve({
        ok: false,
        error: error.message
      });
    });

    child.on("close", (code, signal) => {
      runningProcesses.delete(jobId);
      resolve({
        ok: code === 0,
        code,
        signal,
        error: code === 0 ? "" : `FFmpeg exited with code ${code}.`
      });
    });
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  for (const child of runningProcesses.values()) {
    child.kill("SIGTERM");
  }
  runningProcesses.clear();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("dialog:select-images", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select source images",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Images",
        extensions: [
          "apng",
          "avif",
          "bmp",
          "gif",
          "heic",
          "heif",
          "jpeg",
          "jpg",
          "png",
          "tif",
          "tiff",
          "webp"
        ]
      },
      {
        name: "All files",
        extensions: ["*"]
      }
    ]
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths.map((filePath) => ({
    path: filePath,
    name: path.basename(filePath)
  }));
});

ipcMain.handle("dialog:select-output-dir", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select output folder",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled) {
    return "";
  }

  return result.filePaths[0] || "";
});

ipcMain.handle("dialog:save-file", async (_event, payload = {}) => {
  if (!payload || typeof payload.content !== "string") {
    return { ok: false, error: "File content is required." };
  }

  const result = await dialog.showSaveDialog({
    title: payload.title || "Save file",
    defaultPath: payload.defaultPath || "output.txt",
    filters: payload.filters || [{ name: "Text", extensions: ["txt"] }]
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  try {
    await fs.promises.writeFile(result.filePath, payload.content, "utf8");
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("ffmpeg:probe", async (_event, payload = {}) => {
  const validation = validateProbePayload(payload);

  if (!validation.ok) {
    return validation;
  }

  return runProbe(validation.value.ffmpegPath);
});

ipcMain.handle("ffmpeg:convert", async (event, payload = {}) => {
  const validation = validateConversionPayload(payload);

  if (!validation.ok) {
    return validation;
  }

  return runConversion(event, validation.value);
});

ipcMain.handle("ffmpeg:cancel", async (_event, payload = {}) => {
  const validation = validateCancelPayload(payload);

  if (!validation.ok) {
    return validation;
  }

  const child = runningProcesses.get(validation.value.jobId);

  if (!child) {
    return {
      ok: false,
      error: "No running process found."
    };
  }

  child.kill();
  return {
    ok: true
  };
});

ipcMain.handle("notification:show", async (_event, payload = {}) => {
  if (!payload || typeof payload.title !== "string") {
    return { ok: false, error: "Notification title is required." };
  }

  if (!Notification.isSupported()) {
    return { ok: false, error: "Notifications not supported on this platform." };
  }

  const notification = new Notification({
    title: payload.title,
    body: typeof payload.body === "string" ? payload.body : ""
  });
  notification.show();
  return { ok: true };
});
