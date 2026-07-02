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
  logs: [],
  logStreamCleanup: null,
  renderTimer: null,
  settingsLoaded: false
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
  resetSettingsButton: document.getElementById("resetSettingsButton"),
  commandSummary: document.getElementById("commandSummary"),
  commandPreview: document.getElementById("commandPreview"),
  copyCommandButton: document.getElementById("copyCommandButton"),
  convertButton: document.getElementById("convertButton"),
  convertButtonText: document.getElementById("convertButtonText"),
  cancelButton: document.getElementById("cancelButton"),
  retryFailedButton: document.getElementById("retryFailedButton"),
  queueSummary: document.getElementById("queueSummary"),
  queueProgressBar: document.getElementById("queueProgressBar"),
  queueList: document.getElementById("queueList"),
  logSummary: document.getElementById("logSummary"),
  logOutput: document.getElementById("logOutput"),
  clearLogButton: document.getElementById("clearLogButton"),
  themeToggleButton: document.getElementById("themeToggleButton"),
  themeIconSun: null,
  themeIconMoon: null
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
    if (!els.fileList.querySelector(".empty-state")) {
      els.fileList.innerHTML = `
        <div class="empty-state">
          <svg><use href="#icon-alert"></use></svg>
          <span>Add images to start building the FFmpeg command.</span>
        </div>
      `;
    }
    return;
  }

  if (els.fileList.querySelector(".empty-state")) {
    els.fileList.innerHTML = "";
  }

  const existingRows = els.fileList.querySelectorAll(".file-row");

  if (existingRows.length !== state.files.length) {
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
    if (!els.queueList.querySelector(".empty-state")) {
      els.queueList.innerHTML = `
        <div class="empty-state">
          <svg><use href="#icon-terminal"></use></svg>
          <span>Conversion jobs will appear here.</span>
        </div>
      `;
    }
    return;
  }

  if (els.queueList.querySelector(".empty-state")) {
    els.queueList.innerHTML = "";
  }

  const existingRows = els.queueList.querySelectorAll(".queue-row");

  if (existingRows.length !== state.queue.length) {
    els.queueList.innerHTML = state.queue
      .map(
        (item) => `
          <div class="queue-row queue-row--${item.status}" data-queue-index="${state.queue.indexOf(item)}">
            <div>
              <strong>${escapeHtml(item.file.name || conversionPlan.basename(item.file.path))}</strong>
              <span>${escapeHtml(item.outputPath)}</span>
            </div>
            <span>${queueState.statusLabel(item.status)}</span>
          </div>
        `
      )
      .join("");
  } else {
    state.queue.forEach((item, index) => {
      const row = existingRows[index];
      if (!row) return;

      const newClass = `queue-row queue-row--${item.status}`;
      if (row.className !== newClass) {
        row.className = newClass;
      }

      const statusSpan = row.querySelector("span:last-child");
      const label = queueState.statusLabel(item.status);
      if (statusSpan && statusSpan.textContent !== label) {
        statusSpan.textContent = label;
      }
    });
  }
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

  const hasFailed = state.queue.some((item) => item.status === "failed");
  els.retryFailedButton.hidden = !hasFailed || state.isConverting;

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
  saveSettings();
}

function scheduleRender() {
  if (state.renderTimer) {
    clearTimeout(state.renderTimer);
  }
  state.renderTimer = setTimeout(() => {
    state.renderTimer = null;
    renderAll();
  }, 80);
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

const SETTINGS_KEY = "zonevert:settings";
const SETTINGS_FIELDS = [
  "format",
  "preset",
  "quality",
  "overwrite",
  "metadata",
  "resizeMode",
  "width",
  "height",
  "ffmpegPath",
  "globalArgs",
  "inputArgs",
  "filter",
  "outputArgs"
];

function collectSettings() {
  return {
    format: els.formatSelect.value,
    preset: els.presetSelect.value,
    quality: els.qualityInput.value,
    overwrite: els.overwriteInput.checked,
    metadata: els.metadataInput.checked,
    resizeMode: els.resizeModeSelect.value,
    width: els.widthInput.value,
    height: els.heightInput.value,
    ffmpegPath: els.ffmpegPathInput.value,
    globalArgs: els.globalArgsInput.value,
    inputArgs: els.inputArgsInput.value,
    filter: els.filterInput.value,
    outputArgs: els.outputArgsInput.value
  };
}

let saveSettingsTimer = null;

function saveSettings() {
  if (!state.settingsLoaded || typeof localStorage === "undefined") {
    return;
  }

  if (saveSettingsTimer) {
    clearTimeout(saveSettingsTimer);
  }

  saveSettingsTimer = setTimeout(() => {
    saveSettingsTimer = null;
    try {
      const settings = collectSettings();
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // localStorage may be unavailable (private mode, quota, etc.)
    }
  }, 200);
}

function loadSettings() {
  if (typeof localStorage === "undefined") {
    return;
  }

  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return;
  }

  if (!stored || typeof stored !== "object") {
    return;
  }

  if (typeof stored.format === "string") els.formatSelect.value = stored.format;
  if (typeof stored.preset === "string") els.presetSelect.value = stored.preset;
  if (typeof stored.quality === "string" || typeof stored.quality === "number") els.qualityInput.value = stored.quality;
  if (typeof stored.overwrite === "boolean") els.overwriteInput.checked = stored.overwrite;
  if (typeof stored.metadata === "boolean") els.metadataInput.checked = stored.metadata;
  if (typeof stored.resizeMode === "string") els.resizeModeSelect.value = stored.resizeMode;
  if (typeof stored.width === "string" || typeof stored.width === "number") els.widthInput.value = stored.width;
  if (typeof stored.height === "string" || typeof stored.height === "number") els.heightInput.value = stored.height;
  if (typeof stored.ffmpegPath === "string") els.ffmpegPathInput.value = stored.ffmpegPath;
  if (typeof stored.globalArgs === "string") els.globalArgsInput.value = stored.globalArgs;
  if (typeof stored.inputArgs === "string") els.inputArgsInput.value = stored.inputArgs;
  if (typeof stored.filter === "string") els.filterInput.value = stored.filter;
  if (typeof stored.outputArgs === "string") els.outputArgsInput.value = stored.outputArgs;

  els.qualityValue.textContent = String(els.qualityInput.value);
  state.settingsLoaded = true;

  if (typeof stored.theme === "string" && (stored.theme === "light" || stored.theme === "dark")) {
    applyTheme(stored.theme);
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    applyTheme("dark");
  }
}

const THEME_KEY = "zonevert:theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  const sunIcon = els.themeToggleButton.querySelector(".icon-sun");
  const moonIcon = els.themeToggleButton.querySelector(".icon-moon");

  if (theme === "dark") {
    sunIcon?.removeAttribute("hidden");
    moonIcon?.setAttribute("hidden", "");
  } else {
    sunIcon?.setAttribute("hidden", "");
    moonIcon?.removeAttribute("hidden");
  }

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage may be unavailable
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(current === "dark" ? "light" : "dark");
}

function loadTheme() {
  let stored;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    // localStorage may be unavailable
  }

  if (stored === "dark" || stored === "light") {
    applyTheme(stored);
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    applyTheme("dark");
  }
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

async function runConversion(retry = false) {
  if (!api || state.isConverting || !state.files.length) {
    return;
  }

  const intent = getConversionIntent();

  if (!retry) {
    prepareQueue(intent);
  }
  state.isConverting = true;
  state.cancelRequested = false;
  setLogSummary("Running");

  const runnable = retry
    ? state.queue.filter((item) => item.status === "pending")
    : state.queue;

  appendLog(`Starting ${runnable.length} conversion${runnable.length === 1 ? "" : "s"}.\n`);
  renderAll();

  for (const item of runnable) {
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

  if (!wasCanceled) {
    notifyQueueComplete();
  }
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

function notifyQueueComplete() {
  if (!api?.showNotification) {
    return;
  }

  const summary = queueState.summarizeQueue(state.queue);
  const parts = [];
  if (summary.done) parts.push(`${summary.done} done`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped`);

  const title = summary.failed > 0 ? "Conversion finished with errors" : "Conversion complete";
  const body = parts.join(", ") || "Queue finished";

  api.showNotification({ title, body });
}

async function retryFailed() {
  if (!api || state.isConverting) {
    return;
  }

  const reset = queueState.resetFailed(state.queue);
  if (!reset.length) {
    return;
  }

  appendLog(`Retrying ${reset.length} failed conversion${reset.length === 1 ? "" : "s"}.\n`);
  await runConversion(true);
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

function resetSettings() {
  els.formatSelect.value = "webp";
  els.presetSelect.value = "balanced";
  els.qualityInput.value = "82";
  els.qualityValue.textContent = "82";
  els.overwriteInput.checked = true;
  els.metadataInput.checked = false;
  els.resizeModeSelect.value = "none";
  els.widthInput.value = "";
  els.heightInput.value = "";
  els.ffmpegPathInput.value = "";
  els.globalArgsInput.value = "";
  els.inputArgsInput.value = "";
  els.filterInput.value = "";
  els.outputArgsInput.value = "";

  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // localStorage may be unavailable
  }

  appendLog("Settings reset to defaults.\n");
  renderAll();
}

function safeAsync(fn, context) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      handleError(error, context);
    }
  };
}

function safe(fn, context) {
  return (...args) => {
    try {
      fn(...args);
    } catch (error) {
      handleError(error, context);
    }
  };
}

function setupListeners() {
  els.addFilesButton.addEventListener("click", safeAsync(addFiles, "addFiles"));
  els.dropTarget.addEventListener("click", safeAsync(addFiles, "addFiles"));
  els.clearFilesButton.addEventListener("click", safe(() => {
    state.files = [];
    state.queue = [];
    renderAll();
  }, "clearFiles"));

  els.browserFileInput.addEventListener("change", safe((event) => {
    addBrowserFiles(event.target.files);
    event.target.value = "";
  }, "browserFileInput"));

  els.dropTarget.addEventListener("dragover", safe((event) => {
    event.preventDefault();
    els.dropTarget.classList.add("is-dragging");
  }, "dragover"));

  els.dropTarget.addEventListener("dragleave", safe(() => {
    els.dropTarget.classList.remove("is-dragging");
  }, "dragleave"));

  els.dropTarget.addEventListener("drop", safe((event) => {
    event.preventDefault();
    els.dropTarget.classList.remove("is-dragging");
    addBrowserFiles(event.dataTransfer.files);
  }, "drop"));

  els.fileList.addEventListener("click", safe((event) => {
    const button = event.target.closest(".file-remove-button");

    if (!button) {
      return;
    }

    state.files.splice(Number(button.dataset.index), 1);
    renderAll();
  }, "fileList click"));

  els.outputDirButton.addEventListener("click", safeAsync(selectOutputDir, "selectOutputDir"));
  els.probeButton.addEventListener("click", safeAsync(probeFfmpeg, "probeFfmpeg"));
  els.resetSettingsButton.addEventListener("click", safe(resetSettings, "resetSettings"));
  els.convertButton.addEventListener("click", safeAsync(runConversion, "runConversion"));
  els.cancelButton.addEventListener("click", safeAsync(cancelCurrentJob, "cancelCurrentJob"));
  els.retryFailedButton.addEventListener("click", safeAsync(retryFailed, "retryFailed"));
  els.copyCommandButton.addEventListener("click", safeAsync(copyCommand, "copyCommand"));
  els.clearLogButton.addEventListener("click", safe(() => {
    state.logs = [];
    els.logOutput.textContent = "";
    setLogSummary("Idle");
  }, "clearLog"));

  els.themeToggleButton.addEventListener("click", safe(toggleTheme, "toggleTheme"));

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
    element.addEventListener("input", safe(scheduleRender, "input render"));
  });

  els.presetSelect.addEventListener("change", safe(applyPreset, "applyPreset"));
  els.qualityInput.addEventListener("input", safe(() => {
    els.qualityValue.textContent = els.qualityInput.value;
    scheduleRender();
  }, "qualityInput"));
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", safe((event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const typing = event.target.tagName === "INPUT" || event.target.tagName === "SELECT" || event.target.tagName === "TEXTAREA";

    if (ctrl && event.shiftKey && event.key === "C") {
      event.preventDefault();
      copyCommand();
      return;
    }

    if (typing) {
      return;
    }

    if (ctrl && event.key === "o") {
      event.preventDefault();
      addFiles();
      return;
    }

    if (ctrl && event.key === "Enter") {
      event.preventDefault();
      runConversion();
      return;
    }

    if (event.key === "Escape" && state.isConverting) {
      event.preventDefault();
      cancelCurrentJob();
      return;
    }

    if (ctrl && event.key === "l") {
      event.preventDefault();
      els.logOutput.focus();
      els.logOutput.scrollTop = els.logOutput.scrollHeight;
      return;
    }
  }, "keyboard shortcut"));
}

function setupLogStream() {
  if (!api) {
    return;
  }

  if (state.logStreamCleanup) {
    state.logStreamCleanup();
  }

  state.logStreamCleanup = api.onLog((data) => {
    if (data.jobId !== state.activeJobId) {
      return;
    }

    appendLog(data.text);
  });
}

function handleError(error, context) {
  const message = `[Error${context ? ` in ${context}` : ""}] ${error?.message || error}\n`;
  console.error(message, error);

  try {
    appendLog(message);
    setLogSummary("Error");
  } catch {
    // If logging itself fails, nothing more we can do
  }
}

function init() {
  try {
    loadSettings();
    loadTheme();
    setupListeners();
    setupKeyboardShortcuts();
    setupLogStream();

    if (!api) {
      setFfmpegStatus("warn", "Preview mode");
      appendLog("Open with Electron to select folders and run FFmpeg.\n");
    } else {
      probeFfmpeg();
      els.logOutput.textContent = "Ready.\n";
    }

    renderAll();
  } catch (error) {
    handleError(error, "init");
  }
}

init();
