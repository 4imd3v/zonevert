const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zonevert", {
  selectImages: () => ipcRenderer.invoke("dialog:select-images"),
  selectOutputDir: () => ipcRenderer.invoke("dialog:select-output-dir"),
  probeFFmpeg: (ffmpegPath) => ipcRenderer.invoke("ffmpeg:probe", { ffmpegPath }),
  convert: (payload) => ipcRenderer.invoke("ffmpeg:convert", payload),
  cancel: (jobId) => ipcRenderer.invoke("ffmpeg:cancel", { jobId }),
  onLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("ffmpeg:log", handler);

    return () => {
      ipcRenderer.removeListener("ffmpeg:log", handler);
    };
  }
});
