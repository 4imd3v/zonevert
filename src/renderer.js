const api = window.zonevert;

const state = {
  files: [],
  outputDir: "",
  ffmpegOk: false,
  activeJobId: "",
  isConverting: false,
  queue: [],
  logs: []
};

const els = {
  ffmpegStatus: document.getElementById("ffmpegStatus"),
  ffmpegStatusText: document.getElementById("ffmpegStatusText"),
  addFilesButton: document.getElementById("addFilesButton"),
  clearFilesButton: document.getElementById("clearFilesButton"),
  dropTarget: document.getElementById("dropTarget"),
  browserFileInput: document.getElementById("browserFileInput"),
  sourceCount: document.getElementById("sourceCount"),
  fileList: document.getElementById("fileList"),
  outputDirButton: document.getElementById("outputDirButton"),
  outputFolderText: document.getElementById("outputFolderText"),
  formatSelect: document.getElementById("formatSelect"),
  presetSelect: document.getElementById("presetSelect"),
  qualityInput: document.getElementById("qualityInput"),
  qualityValue: document.getElementById("qualityValue"),
  overwriteInput: document.getElementById("overwriteInput"),
  metadataInput: document.getElementById("metadataInput"),
  resizeModeSelect: document.getElementById("resizeModeSelect"),
  widthInput: document.getElementById("widthInput"),
  heightInput: document.getElementById("heightInput"),
  resizeSummary: document.getElementById("resizeSummary"),
  ffmpegPathInput: document.getElementById("ffmpegPathInput"),
  globalArgsInput: document.getElementById("globalArgsInput"),
  inputArgsInput: document.getElementById("inputArgsInput"),
  filterInput: document.getElementById("filterInput"),
  outputArgsInput: document.getElementById("outputArgsInput"),
  probeButton: document.getElementById("probeButton"),
  commandSummary: document.getElementById("commandSummary"),
  commandPreview: document.getElementById("commandPreview"),
  copyCommandButton: document.getElementById("copyCommandButton"),
  convertButton: document.getElementById("convertButton"),
  cancelButton: document.getElementById("cancelButton"),
  queueSummary: document.getElementById("queueSummary"),
  queueList: document.getElementById("queueList"),
  logSummary: document.getElementById("logSummary"),
  logOutput: document.getElementById("logOutput"),
  clearLogButton: document.getElementById("clearLogButton")
};

const presetDefaults = {
  balanced: {
    quality: 82
  },
  quality: {
    quality: 94
  },
  small: {
    quality: 64
  },
  lossless: {
    quality: 100
  }
};

const encoderArgs = {
  webp: (quality, preset) => {
    if (preset === "lossless") {
      return ["-c:v", "libwebp", "-lossless", "1"];
    }

    return ["-c:v", "libwebp", "-q:v", String(quality)];
  },
  jpg: (quality) => ["-c:v", "mjpeg", "-q:v", jpegQualityScale(quality)],
  png: (_quality, preset) => ["-c:v", "png", "-compression_level", pngCompressionLevel(preset)],
  avif: (quality) => ["-c:v", "libaom-av1", "-crf", avifCrfScale(quality), "-still-picture", "1"],
  tiff: () => ["-c:v", "tiff"],
  bmp: () => ["-c:v", "bmp"],
  gif: () => ["-c:v", "gif"]
};

function jpegQualityScale(quality) {
  const value = 31 - Math.round((clamp(quality, 1, 100) / 100) * 29);
  return String(clamp(value, 2, 31));
}

function avifCrfScale(quality) {
  const value = 63 - Math.round((clamp(quality, 1, 100) / 100) * 63);
  return String(clamp(value, 0, 63));
}

function pngCompressionLevel(preset) {
  if (preset === "small") {
    return "9";
  }

  if (preset === "quality") {
    return "3";
  }

  return "6";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseArgs(value) {
  const input = String(value || "").trim();

  if (!input) {
    return [];
  }

  const args = [];
  let current = "";
  let quote = "";
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote === "\"") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function formatPathForCommand(value) {
  const text = String(value || "");

  if (!text) {
    return "";
  }

  if (!/[\s"'()]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll("\"", "\\\"")}"`;
}

function isWindowsPath(filePath) {
  return /^[a-z]:\\/i.test(filePath);
}

function dirname(filePath) {
  const separator = isWindowsPath(filePath) || filePath.includes("\\") ? "\\" : "/";
  const index = filePath.lastIndexOf(separator);
  return index >= 0 ? filePath.slice(0, index) : "";
}

function basename(filePath) {
  const normalized = String(filePath || "").replaceAll("\\", "/");
  return normalized.split("/").pop() || "";
}

function extension(name) {
  const fileName = basename(name);
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(index + 1).toLowerCase() : "";
}

function stem(name) {
  const fileName = basename(name);
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(0, index) : fileName;
}

function joinPath(directory, fileName) {
  if (!directory) {
    return fileName;
  }

  const separator = isWindowsPath(directory) || directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${fileName}`;
}

function getQuality() {
  return Number.parseInt(els.qualityInput.value, 10);
}

function getFfmpegPath() {
  return els.ffmpegPathInput.value.trim() || "ffmpeg";
}

function getOutputDirectory(file) {
  return state.outputDir || dirname(file.path);
}

function getOutputPath(file) {
  const format = els.formatSelect.value;
  const sourceExt = extension(file.name || file.path);
  const normalizedSourceExt = sourceExt === "jpeg" ? "jpg" : sourceExt;
  const outputStem = normalizedSourceExt === format ? `${stem(file.name || file.path)}-converted` : stem(file.name || file.path);
  const outputName = `${outputStem}.${format}`;
  return joinPath(getOutputDirectory(file), outputName);
}

function buildResizeFilter() {
  const mode = els.resizeModeSelect.value;
  const width = Number.parseInt(els.widthInput.value, 10);
  const height = Number.parseInt(els.heightInput.value, 10);
  const hasWidth = Number.isFinite(width) && width > 0;
  const hasHeight = Number.isFinite(height) && height > 0;

  if (mode === "none" || (!hasWidth && !hasHeight)) {
    return "";
  }

  const w = hasWidth ? width : -1;
  const h = hasHeight ? height : -1;

  if (mode === "stretch") {
    return `scale=${w}:${h}`;
  }

  if (mode === "fill" && hasWidth && hasHeight) {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  }

  return `scale=${w}:${h}:force_original_aspect_ratio=decrease`;
}

function buildFilterGraph() {
  return [buildResizeFilter(), els.filterInput.value.trim()].filter(Boolean).join(",");
}

function buildArgs(file) {
  const format = els.formatSelect.value;
  const preset = els.presetSelect.value;
  const quality = getQuality();
  const filterGraph = buildFilterGraph();
  const args = [
    "-hide_banner",
    ...parseArgs(els.globalArgsInput.value),
    els.overwriteInput.checked ? "-y" : "-n",
    ...parseArgs(els.inputArgsInput.value),
    "-i",
    file.path
  ];

  if (!els.metadataInput.checked) {
    args.push("-map_metadata", "-1");
  }

  if (filterGraph) {
    args.push("-vf", filterGraph);
  }

  args.push(...(encoderArgs[format]?.(quality, preset) || []));
  args.push(...parseArgs(els.outputArgsInput.value));
  args.push(getOutputPath(file));

  return args;
}

function buildCommand(file = state.files[0]) {
  if (!file) {
    return `${getFfmpegPath()} -hide_banner -i source.png output.${els.formatSelect.value}`;
  }

  return [getFfmpegPath(), ...buildArgs(file)].map(formatPathForCommand).join(" ");
}

function canRunConversion() {
  return Boolean(api && state.files.length && !state.isConverting);
}

function setFfmpegStatus(status, text) {
  const dot = els.ffmpegStatus.querySelector(".status-dot");
  dot.className = `status-dot status-dot--${status}`;
  els.ffmpegStatusText.textContent = text;
}

function setLogSummary(text) {
  els.logSummary.textContent = text;
}

function appendLog(text) {
  const normalized = String(text || "").replace(/\r/g, "\n");
  state.logs.push(normalized);

  if (state.logs.length > 500) {
    state.logs.splice(0, state.logs.length - 500);
  }

  els.logOutput.textContent = state.logs.join("");
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function renderFiles() {
  els.sourceCount.textContent =
    state.files.length === 1 ? "1 file selected" : `${state.files.length} files selected`;

  if (!state.files.length) {
    els.sourceCount.textContent = "No files selected";
    els.fileList.innerHTML = `
      <div class="empty-state">
        <svg><use href="#icon-alert"></use></svg>
        <span>Add images to start building the FFmpeg command.</span>
      </div>
    `;
    return;
  }

  els.fileList.innerHTML = state.files
    .map(
      (file, index) => `
        <div class="file-row">
          <div>
            <strong>${escapeHtml(file.name || basename(file.path))}</strong>
            <span>${escapeHtml(extension(file.name || file.path).toUpperCase() || "IMAGE")}</span>
          </div>
          <button class="icon-button file-remove-button" type="button" aria-label="Remove ${escapeHtml(file.name || "file")}" title="Remove" data-index="${index}">
            <svg><use href="#icon-x"></use></svg>
          </button>
        </div>
      `
    )
    .join("");
}

function renderOutput() {
  els.outputFolderText.textContent = state.outputDir || "Same folder as each source";
}

function renderQueue() {
  const pending = state.queue.filter((item) => item.status === "pending").length;
  const running = state.queue.filter((item) => item.status === "running").length;
  const done = state.queue.filter((item) => item.status === "done").length;
  const failed = state.queue.filter((item) => item.status === "failed").length;

  els.queueSummary.textContent = state.queue.length
    ? `${pending} pending · ${running} running · ${done} done · ${failed} failed`
    : "0 pending";

  if (!state.queue.length) {
    els.queueList.innerHTML = `
      <div class="empty-state">
        <svg><use href="#icon-terminal"></use></svg>
        <span>Conversion jobs will appear here.</span>
      </div>
    `;
    return;
  }

  els.queueList.innerHTML = state.queue
    .map(
      (item) => `
        <div class="queue-row queue-row--${item.status}">
          <div>
            <strong>${escapeHtml(item.file.name || basename(item.file.path))}</strong>
            <span>${escapeHtml(item.outputPath)}</span>
          </div>
          <span>${statusLabel(item.status)}</span>
        </div>
      `
    )
    .join("");
}

function statusLabel(status) {
  if (status === "running") {
    return "Running";
  }

  if (status === "done") {
    return "Done";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Pending";
}

function renderResizeSummary() {
  const filter = buildResizeFilter();
  els.resizeSummary.textContent = filter || "Original dimensions";
}

function renderCommand() {
  els.commandPreview.textContent = buildCommand();

  if (!state.files.length) {
    els.commandSummary.textContent = "Waiting for source images";
  } else if (!state.outputDir) {
    els.commandSummary.textContent = "Output goes beside each source";
  } else {
    els.commandSummary.textContent = `${state.files.length} output file${state.files.length === 1 ? "" : "s"}`;
  }
}

function renderControls() {
  els.convertButton.disabled = !canRunConversion();
  els.cancelButton.disabled = !state.isConverting || !state.activeJobId;

  if (!api) {
    els.convertButton.disabled = true;
    els.outputDirButton.disabled = true;
    els.probeButton.disabled = true;
  }
}

function renderAll() {
  renderFiles();
  renderOutput();
  renderResizeSummary();
  renderCommand();
  renderQueue();
  renderControls();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function dedupeFiles(files) {
  const existing = new Set(state.files.map((file) => file.path));
  const next = [];

  for (const file of files) {
    if (!file.path || existing.has(file.path)) {
      continue;
    }

    existing.add(file.path);
    next.push(file);
  }

  return next;
}

async function addFiles() {
  if (!api) {
    els.browserFileInput.click();
    return;
  }

  const files = await api.selectImages();
  state.files.push(...dedupeFiles(files));
  renderAll();
}

function addBrowserFiles(fileList) {
  const files = Array.from(fileList || []).map((file) => ({
    path: file.path || file.name,
    name: file.name
  }));
  state.files.push(...dedupeFiles(files));
  renderAll();
}

async function selectOutputDir() {
  if (!api) {
    return;
  }

  const directory = await api.selectOutputDir();

  if (directory) {
    state.outputDir = directory;
    renderAll();
  }
}

async function probeFfmpeg() {
  if (!api) {
    setFfmpegStatus("warn", "Open with Electron to run FFmpeg");
    return;
  }

  setFfmpegStatus("idle", "Checking FFmpeg");
  const result = await api.probeFFmpeg(els.ffmpegPathInput.value);

  if (result.ok) {
    state.ffmpegOk = true;
    setFfmpegStatus("ok", result.version || "FFmpeg ready");
  } else {
    state.ffmpegOk = false;
    setFfmpegStatus("warn", "FFmpeg not found");
    appendLog(`FFmpeg probe failed: ${result.error || "Unknown error"}\n`);
  }

  renderControls();
}

function prepareQueue() {
  state.queue = state.files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    args: buildArgs(file),
    outputPath: getOutputPath(file),
    status: "pending"
  }));
}

async function runConversion() {
  if (!api || state.isConverting || !state.files.length) {
    return;
  }

  prepareQueue();
  state.isConverting = true;
  setLogSummary("Running");
  appendLog(`Starting ${state.queue.length} conversion${state.queue.length === 1 ? "" : "s"}.\n`);
  renderAll();

  for (const item of state.queue) {
    if (!state.isConverting) {
      item.status = "failed";
      continue;
    }

    item.status = "running";
    state.activeJobId = item.id;
    appendLog(`\n$ ${[getFfmpegPath(), ...item.args].map(formatPathForCommand).join(" ")}\n`);
    renderAll();

    const result = await api.convert({
      jobId: item.id,
      ffmpegPath: els.ffmpegPathInput.value,
      args: item.args
    });

    if (result.ok) {
      item.status = "done";
      appendLog(`Finished: ${item.outputPath}\n`);
    } else {
      item.status = "failed";
      appendLog(`Failed: ${result.error || "Unknown FFmpeg error"}\n`);
    }

    state.activeJobId = "";
    renderAll();
  }

  state.isConverting = false;
  state.activeJobId = "";
  setLogSummary("Idle");
  appendLog("\nQueue finished.\n");
  renderAll();
}

async function cancelCurrentJob() {
  if (!api || !state.activeJobId) {
    return;
  }

  await api.cancel(state.activeJobId);
  state.isConverting = false;
  appendLog("\nCancel requested.\n");
  setLogSummary("Canceling");
  renderAll();
}

async function copyCommand() {
  const command = buildCommand();

  try {
    await navigator.clipboard.writeText(command);
    els.commandSummary.textContent = "Command copied";
  } catch {
    els.commandSummary.textContent = "Copy failed";
  }
}

function applyPreset() {
  const preset = presetDefaults[els.presetSelect.value];

  if (!preset) {
    return;
  }

  els.qualityInput.value = preset.quality;
  els.qualityValue.textContent = String(preset.quality);
  renderAll();
}

function setupListeners() {
  els.addFilesButton.addEventListener("click", addFiles);
  els.dropTarget.addEventListener("click", addFiles);
  els.clearFilesButton.addEventListener("click", () => {
    state.files = [];
    state.queue = [];
    renderAll();
  });

  els.browserFileInput.addEventListener("change", (event) => {
    addBrowserFiles(event.target.files);
    event.target.value = "";
  });

  els.dropTarget.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropTarget.classList.add("is-dragging");
  });

  els.dropTarget.addEventListener("dragleave", () => {
    els.dropTarget.classList.remove("is-dragging");
  });

  els.dropTarget.addEventListener("drop", (event) => {
    event.preventDefault();
    els.dropTarget.classList.remove("is-dragging");
    addBrowserFiles(event.dataTransfer.files);
  });

  els.fileList.addEventListener("click", (event) => {
    const button = event.target.closest(".file-remove-button");

    if (!button) {
      return;
    }

    state.files.splice(Number(button.dataset.index), 1);
    renderAll();
  });

  els.outputDirButton.addEventListener("click", selectOutputDir);
  els.probeButton.addEventListener("click", probeFfmpeg);
  els.convertButton.addEventListener("click", runConversion);
  els.cancelButton.addEventListener("click", cancelCurrentJob);
  els.copyCommandButton.addEventListener("click", copyCommand);
  els.clearLogButton.addEventListener("click", () => {
    state.logs = [];
    els.logOutput.textContent = "";
    setLogSummary("Idle");
  });

  [
    els.formatSelect,
    els.overwriteInput,
    els.metadataInput,
    els.resizeModeSelect,
    els.widthInput,
    els.heightInput,
    els.ffmpegPathInput,
    els.globalArgsInput,
    els.inputArgsInput,
    els.filterInput,
    els.outputArgsInput
  ].forEach((element) => {
    element.addEventListener("input", renderAll);
  });

  els.presetSelect.addEventListener("change", applyPreset);
  els.qualityInput.addEventListener("input", () => {
    els.qualityValue.textContent = els.qualityInput.value;
    renderAll();
  });
}

function setupLogStream() {
  if (!api) {
    return;
  }

  api.onLog((data) => {
    if (data.jobId !== state.activeJobId) {
      return;
    }

    appendLog(data.text);
  });
}

function init() {
  setupListeners();
  setupLogStream();

  if (!api) {
    setFfmpegStatus("warn", "Preview mode");
    appendLog("Open with Electron to select folders and run FFmpeg.\n");
  } else {
    probeFfmpeg();
  }

  renderAll();
}

init();
