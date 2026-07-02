const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zonevert", {
  platform: process.platform,
  selectImages: () => ipcRenderer.invoke("dialog:select-images"),
  selectOutputDir: () => ipcRenderer.invoke("dialog:select-output-dir"),
  probeFFmpeg: (ffmpegPath) => ipcRenderer.invoke("ffmpeg:probe", { ffmpegPath }),
  convert: (payload) => ipcRenderer.invoke("ffmpeg:convert", payload),
  cancel: (jobId) => ipcRenderer.invoke("ffmpeg:cancel", { jobId }),
  showNotification: (payload) => ipcRenderer.invoke("notification:show", payload),
  saveFile: (payload) => ipcRenderer.invoke("dialog:save-file", payload),
  checkExists: (filePath) => ipcRenderer.invoke("fs:check-exists", { path: filePath }),
  getThumbnail: (filePath) => ipcRenderer.invoke("image:thumbnail", { path: filePath }),
  probeImage: (filePath, ffmpegPath) => ipcRenderer.invoke("ffprobe:run", { path: filePath, ffmpegPath }),
  onLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("ffmpeg:log", handler);

    return () => {
      ipcRenderer.removeListener("ffmpeg:log", handler);
    };
  }
});
