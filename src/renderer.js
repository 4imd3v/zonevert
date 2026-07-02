// @ts-check
const api = window.zonevert;
const conversionPlan = window.ZonevertConversionPlan;
const queueState = window.ZonevertQueueState;
const progressParser = window.ZonevertProgressParser;

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
  settingsLoaded: false,
  conversionTimes: [],
  thumbnails: new Map(),
  imageMeta: new Map()
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
  collisionModeSelect: document.getElementById("collisionModeSelect"),
  namePrefixInput: document.getElementById("namePrefixInput"),
  nameSuffixInput: document.getElementById("nameSuffixInput"),
  sequentialInput: document.getElementById("sequentialInput"),
  padWidthInput: document.getElementById("padWidthInput"),
  namingSummary: document.getElementById("namingSummary"),
  resizeModeSelect: document.getElementById("resizeModeSelect"),
  widthInput: document.getElementById("widthInput"),
  heightInput: document.getElementById("heightInput"),
  resizeSummary: document.getElementById("resizeSummary"),
  ffmpegPathInput: document.getElementById("ffmpegPathInput"),
  concurrencyInput: document.getElementById("concurrencyInput"),
  globalArgsInput: document.getElementById("globalArgsInput"),
  inputArgsInput: document.getElementById("inputArgsInput"),
  filterInput: document.getElementById("filterInput"),
  outputArgsInput: document.getElementById("outputArgsInput"),
  probeButton: document.getElementById("probeButton"),
  resetSettingsButton: document.getElementById("resetSettingsButton"),
  commandSummary: document.getElementById("commandSummary"),
  commandPreview: document.getElementById("commandPreview"),
  copyCommandButton: document.getElementById("copyCommandButton"),
  exportScriptButton: document.getElementById("exportScriptButton"),
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
  saveLogButton: document.getElementById("saveLogButton"),
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
    collisionMode: els.collisionModeSelect.value,
    keepMetadata: els.metadataInput.checked,
    outputDir: state.outputDir,
    ffmpegPath: els.ffmpegPathInput.value,
    resizeMode: els.resizeModeSelect.value,
    width: els.widthInput.value,
    height: els.heightInput.value,
    naming: {
      prefix: els.namePrefixInput.value,
      suffix: els.nameSuffixInput.value,
      sequential: els.sequentialInput.checked,
      padWidth: els.padWidthInput.value
    },
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
          <div class="file-row" data-path="${escapeHtml(file.path)}">
            <img class="file-thumb" alt="" data-path="${escapeHtml(file.path)}" />
            <div class="file-info">
              <strong>${escapeHtml(file.name || conversionPlan.basename(file.path))}</strong>
              <span>${escapeHtml(conversionPlan.extension(file.name || file.path).toUpperCase() || "IMAGE")}</span>
              <span class="file-dimensions" data-path="${escapeHtml(file.path)}"></span>
            </div>
            <button class="icon-button file-remove-button" type="button" aria-label="Remove ${escapeHtml(file.name || "file")}" title="Remove" data-index="${index}">
              <svg><use href="#icon-x"></use></svg>
            </button>
          </div>
        `
      )
      .join("");
    fetchThumbnailsAndMeta();
  } else {
    state.files.forEach((file, index) => {
      const row = existingRows[index];
      if (!row) return;
      const thumb = row.querySelector(".file-thumb");
      const cached = state.thumbnails.get(file.path);
      if (thumb && cached && thumb.src !== cached) {
        thumb.src = cached;
      }
      const dimSpan = row.querySelector(".file-dimensions");
      const meta = state.imageMeta.get(file.path);
      if (dimSpan && meta && dimSpan.textContent !== meta) {
        dimSpan.textContent = meta;
      }
    });
  }
}

async function fetchThumbnailsAndMeta() {
  if (!api) return;

  for (const file of state.files) {
    if (!state.thumbnails.has(file.path) && api.getThumbnail) {
      state.thumbnails.set(file.path, null);
      api.getThumbnail(file.path).then((result) => {
        if (result.ok) {
          state.thumbnails.set(file.path, result.dataUrl);
          const img = els.fileList.querySelector(`.file-thumb[data-path="${cssEscape(file.path)}"]`);
          if (img) img.src = result.dataUrl;
        }
      });
    }

    if (!state.imageMeta.has(file.path) && api.probeImage) {
      state.imageMeta.set(file.path, null);
      api.probeImage(file.path, els.ffmpegPathInput.value).then((result) => {
        if (result.ok && result.width && result.height) {
          const text = `${result.width}×${result.height}`;
          state.imageMeta.set(file.path, text);
          const span = els.fileList.querySelector(`.file-dimensions[data-path="${cssEscape(file.path)}"]`);
          if (span) span.textContent = text;
          renderResizeSummary();
        }
      });
    }
  }
}

function cssEscape(value) {
  return String(value).replace(/(["\\])/g, "\\$1");
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

function formatItemProgress(item) {
  if (item.status !== "running" || !item.progress) {
    return "";
  }

  const parts = [];
  if (item.progress.frame !== null) {
    parts.push(`frame ${item.progress.frame}`);
  }
  if (item.progress.fps !== null) {
    parts.push(`${item.progress.fps} fps`);
  }
  if (item.progress.time) {
    parts.push(item.progress.time);
  }

  return parts.join(" · ");
}

function formatEta(times, queue) {
  if (!times.length || !queue.length) return "";
  const pending = queue.filter((item) => item.status === "pending").length;
  if (!pending) return "";
  const avgMs = times.reduce((sum, t) => sum + t, 0) / times.length;
  const etaMs = avgMs * pending;
  const etaSec = Math.round(etaMs / 1000);
  if (etaSec < 60) return `~${etaSec}s left`;
  const min = Math.floor(etaSec / 60);
  const sec = etaSec % 60;
  return `~${min}m ${sec}s left`;
}

function renderQueue() {
  const summary = queueState.summarizeQueue(state.queue);

  const eta = state.isConverting ? formatEta(state.conversionTimes, state.queue) : "";
  els.queueSummary.textContent = eta ? `${summary.text} · ${eta}` : summary.text;
  els.queueProgressBar.style.width = `${summary.progress}%`;
  els.queueProgressBar.parentElement.setAttribute("aria-valuenow", String(summary.progress));

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
          <div class="queue-row queue-row--${item.status}${!state.isConverting ? " queue-row--draggable" : ""}" data-queue-index="${state.queue.indexOf(item)}"${!state.isConverting ? " draggable=\"true\"" : ""}>
            <div>
              <strong>${escapeHtml(item.file.name || conversionPlan.basename(item.file.path))}</strong>
              <span>${escapeHtml(item.outputPath)}</span>
              <span class="queue-progress-text">${formatItemProgress(item)}</span>
            </div>
            <span>${queueState.statusLabel(item.status)}</span>
          </div>
        `
      )
      .join("");
    setupQueueReorder();
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

      const progressSpan = row.querySelector(".queue-progress-text");
      const progressText = formatItemProgress(item);
      if (progressSpan && progressSpan.textContent !== progressText) {
        progressSpan.textContent = progressText;
      }
    });
  }
}

let dragSrcIndex = null;

function setupQueueReorder() {
  if (state.isConverting) return;

  const rows = els.queueList.querySelectorAll(".queue-row--draggable");n
  rows.forEach((row) => {
    row.addEventListener("dragstart", safe((event) => {
      dragSrcIndex = Number(row.dataset.queueIndex);
      event.dataTransfer.effectAllowed = "move";
      row.classList.add("is-dragging");
    }, "dragstart"));

    row.addEventListener("dragend", safe(() => {
      row.classList.remove("is-dragging");
      dragSrcIndex = null;
    }, "dragend"));

    row.addEventListener("dragover", safe((event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const targetIndex = Number(row.dataset.queueIndex);
      if (dragSrcIndex === null || targetIndex === dragSrcIndex) return;
      row.classList.toggle("drag-above", targetIndex < dragSrcIndex);
      row.classList.toggle("drag-below", targetIndex > dragSrcIndex);
    }, "dragover"));

    row.addEventListener("dragleave", safe(() => {
      row.classList.remove("drag-above", "drag-below");
    }, "dragleave"));

    row.addEventListener("drop", safe((event) => {
      event.preventDefault();
      row.classList.remove("drag-above", "drag-below");
      const targetIndex = Number(row.dataset.queueIndex);
      if (dragSrcIndex === null || targetIndex === dragSrcIndex) return;
      const [moved] = state.queue.splice(dragSrcIndex, 1);
      state.queue.splice(targetIndex, 0, moved);
      renderAll();
    }, "drop"));
  });
}

function renderResizeSummary() {
  const intent = getConversionIntent();
  const filter = conversionPlan.buildResizeFilter(intent.resize);

  if (!filter) {
    els.resizeSummary.textContent = "Original dimensions";
    return;
  }

  if (state.files.length && state.imageMeta.size) {
    const firstFile = state.files[0];
    const meta = state.imageMeta.get(firstFile.path);
    if (meta) {
      const [sw, sh] = meta.split("×");
      let targetW = sw;
      let targetH = sh;
      if (intent.resize.mode === "stretch" || (intent.resize.mode === "fill" && intent.resize.width && intent.resize.height)) {
        targetW = intent.resize.width || sw;
        targetH = intent.resize.height || sh;
      } else if (intent.resize.mode === "inside") {
        targetW = intent.resize.width || `${sw}→`;
        targetH = intent.resize.height || `${sh}→`;
      }
      els.resizeSummary.textContent = `${sw}×${sh} → ${targetW}×${targetH}`;
      return;
    }
  }

  els.resizeSummary.textContent = filter;
}

function renderNamingSummary() {
  const intent = getConversionIntent();
  const naming = intent.naming;

  if (naming.sequential) {
    els.namingSummary.textContent = `Sequential (${"1".padStart(naming.padWidth, "0")}, ${"2".padStart(naming.padWidth, "0")}, …).${intent.format}`;
  } else {
    const parts = [];
    if (naming.prefix) parts.push(naming.prefix);
    parts.push("name");
    if (naming.suffix) parts.push(naming.suffix);
    else if (!naming.suffix) parts.push("(auto)");
    els.namingSummary.textContent = `${parts.join("")}.${intent.format}`;
  }
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
  const hasRunning = state.queue.some((item) => item.status === "running");
  els.cancelButton.disabled = !state.isConverting || !hasRunning || state.cancelRequested;
  els.convertButtonText.textContent = state.isConverting ? "Converting" : "Convert";
  els.convertButton.classList.toggle("is-busy", state.isConverting);
  els.convertButton.setAttribute("aria-busy", String(state.isConverting));

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
  renderNamingSummary();
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
  "collisionMode",
  "metadata",
  "resizeMode",
  "width",
  "height",
  "namePrefix",
  "nameSuffix",
  "sequential",
  "padWidth",
  "ffmpegPath",
  "concurrency",
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
    collisionMode: els.collisionModeSelect.value,
    metadata: els.metadataInput.checked,
    resizeMode: els.resizeModeSelect.value,
    width: els.widthInput.value,
    height: els.heightInput.value,
    namePrefix: els.namePrefixInput.value,
    nameSuffix: els.nameSuffixInput.value,
    sequential: els.sequentialInput.checked,
    padWidth: els.padWidthInput.value,
    ffmpegPath: els.ffmpegPathInput.value,
    concurrency: els.concurrencyInput.value,
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
  if (typeof stored.collisionMode === "string") els.collisionModeSelect.value = stored.collisionMode;
  if (typeof stored.metadata === "boolean") els.metadataInput.checked = stored.metadata;
  if (typeof stored.resizeMode === "string") els.resizeModeSelect.value = stored.resizeMode;
  if (typeof stored.width === "string" || typeof stored.width === "number") els.widthInput.value = stored.width;
  if (typeof stored.height === "string" || typeof stored.height === "number") els.heightInput.value = stored.height;
  if (typeof stored.namePrefix === "string") els.namePrefixInput.value = stored.namePrefix;
  if (typeof stored.nameSuffix === "string") els.nameSuffixInput.value = stored.nameSuffix;
  if (typeof stored.sequential === "boolean") els.sequentialInput.checked = stored.sequential;
  if (typeof stored.padWidth === "string" || typeof stored.padWidth === "number") els.padWidthInput.value = stored.padWidth;
  els.padWidthInput.disabled = !els.sequentialInput.checked;
  if (typeof stored.ffmpegPath === "string") els.ffmpegPathInput.value = stored.ffmpegPath;
  if (typeof stored.concurrency === "string" || typeof stored.concurrency === "number") els.concurrencyInput.value = stored.concurrency;
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
  state.queue = state.files.map((file, index) => {
    const plan = conversionPlan.planConversion(file, intent, index);
    return {
      id: queueState.defaultCreateId ? queueState.defaultCreateId() : `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      file,
      args: plan.args,
      outputPath: plan.outputPath,
      status: "pending"
    };
  });
  queueState.resolveCollisions(state.queue);
}

function getConcurrency() {
  const parsed = Number.parseInt(els.concurrencyInput.value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 8) : 1;
}

async function runConversionItem(item, intent) {
  if (intent.collisionMode === "skip" && api?.checkExists) {
    const exists = await api.checkExists(item.outputPath);
    if (exists.ok && exists.exists) {
      queueState.markSkipped(item);
      appendLog(`Skipped (already exists): ${item.outputPath}\n`);
      renderAll();
      return;
    }
  }

  queueState.markRunning(item);
  appendLog(
    `\n$ ${conversionPlan.formatCommand([intent.ffmpegPath, ...item.args], {
      platform: api?.platform
    })}\n`
  );
  renderAll();

  const startTime = Date.now();
  const result = await api.convert({
    jobId: item.id,
    ffmpegPath: intent.ffmpegPath,
    args: item.args
  });

  if (item.status !== "skipped") {
    const elapsed = Date.now() - startTime;
    state.conversionTimes.push(elapsed);
    if (state.conversionTimes.length > 50) {
      state.conversionTimes.shift();
    }
  }

  queueState.markResult(item, result, state.cancelRequested);

  if (item.status === "canceled") {
    appendLog(`Canceled: ${item.outputPath}\n`);
  } else if (item.status === "done") {
    appendLog(`Finished: ${item.outputPath}\n`);
  } else {
    appendLog(`Failed: ${result.error || "Unknown FFmpeg error"}\n`);
  }

  renderAll();
}

async function runConversionPool(items, intent, concurrency) {
  const queue = [...items];
  const workers = [];

  async function worker() {
    while (queue.length) {
      if (state.cancelRequested) {
        const skipped = queue.splice(0);
        for (const item of skipped) {
          queueState.markCanceled(item);
        }
        renderAll();
        return;
      }

      const item = queue.shift();
      if (!item) return;

      await runConversionItem(item, intent);
    }
  }

  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
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

  const concurrency = getConcurrency();
  appendLog(`Starting ${runnable.length} conversion${runnable.length === 1 ? "" : "s"}${concurrency > 1 ? ` (${concurrency} parallel)` : ""}.\n`);
  renderAll();

  if (concurrency > 1) {
    await runConversionPool(runnable, intent, concurrency);
  } else {
    for (const item of runnable) {
      if (state.cancelRequested) {
        queueState.markCanceled(item);
        continue;
      }

      await runConversionItem(item, intent);
    }
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
  if (!api) {
    return;
  }

  const running = state.queue.filter((item) => item.status === "running");
  if (!running.length) {
    return;
  }

  for (const item of running) {
    await api.cancel(item.id);
  }
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

async function exportScript() {
  if (!state.files.length) {
    els.commandSummary.textContent = "Add files first";
    return;
  }

  const intent = getConversionIntent();
  const platform = api?.platform || "linux";
  const isWindows = platform === "win32";

  const lines = state.files.map((file) => {
    const plan = conversionPlan.planConversion(file, intent);
    return conversionPlan.formatCommand([intent.ffmpegPath, ...plan.args], { platform });
  });

  const shebang = isWindows ? "@echo off\r\n" : "#!/bin/sh\n";
  const content = shebang + lines.join("\n") + "\n";
  const ext = isWindows ? "bat" : "sh";
  const defaultName = `zonevert-convert.${ext}`;

  if (api?.saveFile) {
    const result = await api.saveFile({
      title: "Export conversion script",
      defaultPath: defaultName,
      content,
      filters: [{ name: isWindows ? "Batch" : "Shell", extensions: [ext] }]
    });

    els.commandSummary.textContent = result.ok ? "Script saved" : (result.canceled ? "Export canceled" : "Export failed");
  } else {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(url);
    els.commandSummary.textContent = "Script downloaded";
  }
}

async function saveLog() {
  const content = state.logs.join("");
  if (!content.trim()) {
    setLogSummary("Log is empty");
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const defaultName = `zonevert-log-${date}.txt`;

  if (api?.saveFile) {
    const result = await api.saveFile({
      title: "Save log",
      defaultPath: defaultName,
      content,
      filters: [{ name: "Text", extensions: ["txt"] }]
    });

    setLogSummary(result.ok ? "Log saved" : (result.canceled ? "Idle" : "Save failed"));
  } else {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(url);
    setLogSummary("Log downloaded");
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
  els.collisionModeSelect.value = "overwrite";
  els.metadataInput.checked = false;
  els.resizeModeSelect.value = "none";
  els.widthInput.value = "";
  els.heightInput.value = "";
  els.namePrefixInput.value = "";
  els.nameSuffixInput.value = "";
  els.sequentialInput.checked = false;
  els.padWidthInput.value = "3";
  els.padWidthInput.disabled = true;
  els.ffmpegPathInput.value = "";
  els.concurrencyInput.value = "1";
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
    state.thumbnails.clear();
    state.imageMeta.clear();
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

    const index = Number(button.dataset.index);
    const removed = state.files[index];
    if (removed) {
      state.thumbnails.delete(removed.path);
      state.imageMeta.delete(removed.path);
    }
    state.files.splice(index, 1);
    renderAll();
  }, "fileList click"));

  els.outputDirButton.addEventListener("click", safeAsync(selectOutputDir, "selectOutputDir"));
  els.probeButton.addEventListener("click", safeAsync(probeFfmpeg, "probeFfmpeg"));
  els.resetSettingsButton.addEventListener("click", safe(resetSettings, "resetSettings"));
  els.convertButton.addEventListener("click", safeAsync(runConversion, "runConversion"));
  els.cancelButton.addEventListener("click", safeAsync(cancelCurrentJob, "cancelCurrentJob"));
  els.retryFailedButton.addEventListener("click", safeAsync(retryFailed, "retryFailed"));
  els.copyCommandButton.addEventListener("click", safeAsync(copyCommand, "copyCommand"));
  els.exportScriptButton.addEventListener("click", safeAsync(exportScript, "exportScript"));
  els.clearLogButton.addEventListener("click", safe(() => {
    state.logs = [];
    els.logOutput.textContent = "";
    setLogSummary("Idle");
  }, "clearLog"));

  els.saveLogButton.addEventListener("click", safeAsync(saveLog, "saveLog"));

  els.themeToggleButton.addEventListener("click", safe(toggleTheme, "toggleTheme"));

  [
    els.formatSelect,
    els.overwriteInput,
    els.collisionModeSelect,
    els.metadataInput,
    els.resizeModeSelect,
    els.widthInput,
    els.heightInput,
    els.namePrefixInput,
    els.nameSuffixInput,
    els.padWidthInput,
    els.ffmpegPathInput,
    els.concurrencyInput,
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

  els.sequentialInput.addEventListener("change", safe(() => {
    els.padWidthInput.disabled = !els.sequentialInput.checked;
    renderAll();
  }, "sequentialToggle"));
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
    const isRunning = state.queue.some((item) => item.id === data.jobId && item.status === "running");
    if (!isRunning) {
      return;
    }

    if (data.stream === "stderr" && progressParser) {
      const progress = progressParser.parseStderr(data.text);
      if (progress) {
        const item = state.queue.find((q) => q.id === data.jobId);
        if (item) {
          item.progress = progress;
          renderQueue();
        }
        return;
      }
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
