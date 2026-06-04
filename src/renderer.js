const api = window.zonevert;
const conversionPlan = window.ZonevertConversionPlan;
const queueState = window.ZonevertQueueState;

const state = {
  files: [],
  outputDir: "",
  activeJobId: "",
  isConverting: false,
  cancelRequested: false,
  queue: [],
  logs: []
};

const els = {
  ffmpegStatus: document.getElementById("ffmpegStatus"),
  ffmpegStatusText: document.getElementById("ffmpegStatusText"),
  summaryFiles: document.getElementById("summaryFiles"),
  summaryFormat: document.getElementById("summaryFormat"),
  summaryQuality: document.getElementById("summaryQuality"),
  summaryOutput: document.getElementById("summaryOutput"),
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
  convertButtonText: document.getElementById("convertButtonText"),
  cancelButton: document.getElementById("cancelButton"),
  queueSummary: document.getElementById("queueSummary"),
  queueProgressBar: document.getElementById("queueProgressBar"),
  queueList: document.getElementById("queueList"),
  logSummary: document.getElementById("logSummary"),
  logOutput: document.getElementById("logOutput"),
  clearLogButton: document.getElementById("clearLogButton")
};

function getQuality() {
  return Number.parseInt(els.qualityInput.value, 10);
}

function getConversionIntent() {
  return conversionPlan.createConversionIntent({
    format: els.formatSelect.value,
    preset: els.presetSelect.value,
    quality: getQuality(),
    overwrite: els.overwriteInput.checked,
    keepMetadata: els.metadataInput.checked,
    outputDir: state.outputDir,
    ffmpegPath: els.ffmpegPathInput.value,
    resizeMode: els.resizeModeSelect.value,
    width: els.widthInput.value,
    height: els.heightInput.value,
    globalArgsText: els.globalArgsInput.value,
    inputArgsText: els.inputArgsInput.value,
    filterText: els.filterInput.value,
    outputArgsText: els.outputArgsInput.value
  });
}

function buildCommand(file = state.files[0]) {
  const intent = getConversionIntent();

  if (!file) {
    return conversionPlan.formatCommand([intent.ffmpegPath, "-hide_banner", "-i", "source.png", `output.${intent.format}`], {
      platform: api?.platform
    });
  }

  const plan = conversionPlan.planConversion(file, intent);
  return conversionPlan.formatCommand([intent.ffmpegPath, ...plan.args], {
    platform: api?.platform
  });
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
            <strong>${escapeHtml(file.name || conversionPlan.basename(file.path))}</strong>
            <span>${escapeHtml(conversionPlan.extension(file.name || file.path).toUpperCase() || "IMAGE")}</span>
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

function renderSummary() {
  const formatLabel = els.formatSelect.options[els.formatSelect.selectedIndex]?.textContent || els.formatSelect.value.toUpperCase();

  els.summaryFiles.textContent = String(state.files.length);
  els.summaryFormat.textContent = formatLabel;
  els.summaryQuality.textContent = String(getQuality());
  els.summaryOutput.textContent = state.outputDir ? "Folder" : "Source";
}

function renderQueue() {
  const summary = queueState.summarizeQueue(state.queue);

  els.queueSummary.textContent = summary.text;
  els.queueProgressBar.style.width = `${summary.progress}%`;

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
            <strong>${escapeHtml(item.file.name || conversionPlan.basename(item.file.path))}</strong>
            <span>${escapeHtml(item.outputPath)}</span>
          </div>
          <span>${queueState.statusLabel(item.status)}</span>
        </div>
      `
    )
    .join("");
}

function renderResizeSummary() {
  const filter = conversionPlan.buildResizeFilter(getConversionIntent().resize);
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
  els.cancelButton.disabled = !state.isConverting || !state.activeJobId || state.cancelRequested;
  els.convertButtonText.textContent = state.isConverting ? "Converting" : "Convert";
  els.convertButton.classList.toggle("is-busy", state.isConverting);

  if (!api) {
    els.convertButton.disabled = true;
    els.outputDirButton.disabled = true;
    els.probeButton.disabled = true;
  }
}

function renderAll() {
  renderFiles();
  renderOutput();
  renderSummary();
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
    setFfmpegStatus("ok", result.version || "FFmpeg ready");
  } else {
    setFfmpegStatus("warn", "FFmpeg not found");
    appendLog(`FFmpeg probe failed: ${result.error || "Unknown error"}\n`);
  }

  renderControls();
}

function prepareQueue(intent) {
  state.queue = queueState.createQueue(state.files, intent, conversionPlan.planConversion);
}

async function runConversion() {
  if (!api || state.isConverting || !state.files.length) {
    return;
  }

  const intent = getConversionIntent();

  prepareQueue(intent);
  state.isConverting = true;
  state.cancelRequested = false;
  setLogSummary("Running");
  appendLog(`Starting ${state.queue.length} conversion${state.queue.length === 1 ? "" : "s"}.\n`);
  renderAll();

  for (const item of state.queue) {
    if (state.cancelRequested) {
      queueState.markCanceled(item);
      continue;
    }

    queueState.markRunning(item);
    state.activeJobId = item.id;
    appendLog(
      `\n$ ${conversionPlan.formatCommand([intent.ffmpegPath, ...item.args], {
        platform: api?.platform
      })}\n`
    );
    renderAll();

    const result = await api.convert({
      jobId: item.id,
      ffmpegPath: intent.ffmpegPath,
      args: item.args
    });

    queueState.markResult(item, result, state.cancelRequested);

    if (item.status === "canceled") {
      appendLog(`Canceled: ${item.outputPath}\n`);
    } else if (item.status === "done") {
      appendLog(`Finished: ${item.outputPath}\n`);
    } else {
      appendLog(`Failed: ${result.error || "Unknown FFmpeg error"}\n`);
    }

    state.activeJobId = "";
    renderAll();
  }

  state.isConverting = false;
  state.activeJobId = "";
  const wasCanceled = state.cancelRequested;
  state.cancelRequested = false;
  setLogSummary("Idle");
  appendLog(wasCanceled ? "\nQueue canceled.\n" : "\nQueue finished.\n");
  renderAll();
}

async function cancelCurrentJob() {
  if (!api || !state.activeJobId) {
    return;
  }

  await api.cancel(state.activeJobId);
  state.cancelRequested = true;
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
  const preset = conversionPlan.PRESET_DEFAULTS[els.presetSelect.value];

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
    els.logOutput.textContent = "Ready.\n";
  }

  renderAll();
}

init();
