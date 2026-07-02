// @ts-check
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  /** @type {any} */ (root).ZonevertConversionPlan = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PRESET_DEFAULTS = {
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

  const supportedFormats = new Set(["webp", "jpg", "png", "avif", "tiff", "bmp", "gif"]);
  const supportedPresets = new Set(Object.keys(PRESET_DEFAULTS));
  const supportedResizeModes = new Set(["none", "inside", "fill", "stretch"]);
  const supportedCollisionModes = new Set(["overwrite", "skip", "rename"]);

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

  function createConversionIntent(options = {}) {
    const preset = normalizePreset(options.preset);
    const quality = normalizeQuality(options.quality, PRESET_DEFAULTS[preset].quality);

    return {
      format: normalizeFormat(options.format),
      preset,
      quality,
      overwrite: options.overwrite !== false,
      collisionMode: normalizeCollisionMode(options.collisionMode),
      keepMetadata: Boolean(options.keepMetadata),
      outputDir: String(options.outputDir || ""),
      ffmpegPath: normalizeFfmpegPath(options.ffmpegPath),
      resize: {
        mode: normalizeResizeMode(options.resizeMode),
        width: positiveInteger(options.width),
        height: positiveInteger(options.height)
      },
      naming: normalizeNaming(options.naming),
      advanced: {
        globalArgs: parseArgs(options.globalArgsText),
        inputArgs: parseArgs(options.inputArgsText),
        filterGraph: String(options.filterText || "").trim(),
        outputArgs: parseArgs(options.outputArgsText)
      }
    };
  }

  function planConversion(file, intent, index = 0) {
    const conversionIntent = intent || createConversionIntent();
    const outputPath = getOutputPath(file, conversionIntent, index);
    const args = buildArgs(file, conversionIntent, outputPath);

    return {
      file,
      outputPath,
      args
    };
  }

  function buildArgs(file, intent, outputPath = getOutputPath(file, intent)) {
    const filterGraph = buildFilterGraph(intent);
    const overwrite = intent.overwrite && intent.collisionMode !== "skip";
    const args = [
      "-hide_banner",
      ...intent.advanced.globalArgs,
      overwrite ? "-y" : "-n",
      ...intent.advanced.inputArgs,
      "-i",
      file.path
    ];

    if (!intent.keepMetadata) {
      args.push("-map_metadata", "-1");
    }

    if (filterGraph) {
      args.push("-vf", filterGraph);
    }

    args.push(...(encoderArgs[intent.format]?.(intent.quality, intent.preset) || []));
    args.push(...intent.advanced.outputArgs);
    args.push(outputPath);

    return args;
  }

  function buildFilterGraph(intent) {
    return [buildResizeFilter(intent.resize), intent.advanced.filterGraph].filter(Boolean).join(",");
  }

  function buildResizeFilter(resize) {
    const mode = normalizeResizeMode(resize?.mode);
    const width = positiveInteger(resize?.width);
    const height = positiveInteger(resize?.height);
    const hasWidth = width > 0;
    const hasHeight = height > 0;

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

  function getOutputPath(file, intent, index = 0) {
    const format = intent.format;
    const naming = intent.naming || { prefix: "", suffix: "", sequential: false, padWidth: 3 };
    const fileName = file.name || file.path;
    const fileStem = stem(fileName);
    const sourceExt = extension(fileName);
    const isSameFormat = (sourceExt === "jpeg" ? "jpg" : sourceExt) === format;

    let outputName;

    if (naming.sequential) {
      const paddedIndex = String(index + 1).padStart(naming.padWidth, "0");
      outputName = `${naming.prefix}${paddedIndex}${naming.suffix}.${format}`;
    } else {
      const suffix = naming.suffix || (isSameFormat ? "-converted" : "");
      outputName = `${naming.prefix}${fileStem}${suffix}.${format}`;
    }

    return joinPath(getOutputDirectory(file, intent), outputName);
  }

  function getOutputDirectory(file, intent) {
    return intent.outputDir || dirname(file.path);
  }

  function formatCommand(args, options = {}) {
    return args.map((arg) => formatArgForCommand(arg, options)).join(" ");
  }

  function formatArgForCommand(value, options = {}) {
    const text = String(value || "");

    if (!text) {
      return "\"\"";
    }

    if (/^[a-zA-Z0-9_./:=,+@%-]+$/.test(text)) {
      return text;
    }

    if (options.platform === "win32") {
      return `"${text.replace(/(\\*)"/g, "$1$1\\\"").replace(/\\+$/g, "$&$&")}"`;
    }

    return `'${text.replaceAll("'", "'\\''")}'`;
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

  function normalizeFormat(format) {
    const value = String(format || "").toLowerCase();
    return supportedFormats.has(value) ? value : "webp";
  }

  function normalizePreset(preset) {
    const value = String(preset || "").toLowerCase();
    return supportedPresets.has(value) ? value : "balanced";
  }

  function normalizeResizeMode(mode) {
    const value = String(mode || "").toLowerCase();
    return supportedResizeModes.has(value) ? value : "none";
  }

  function normalizeCollisionMode(mode) {
    const value = String(mode || "").toLowerCase();
    return supportedCollisionModes.has(value) ? value : "overwrite";
  }

  function normalizeNaming(naming) {
    const source = naming && typeof naming === "object" ? naming : {};

    return {
      prefix: String(source.prefix || "").trim(),
      suffix: String(source.suffix || "").trim(),
      sequential: Boolean(source.sequential),
      padWidth: clamp(positiveInteger(source.padWidth) || 3, 1, 5)
    };
  }

  function normalizeQuality(quality, fallback) {
    const parsed = Number.parseInt(quality, 10);
    const value = Number.isFinite(parsed) ? parsed : fallback;
    return clamp(value, 1, 100);
  }

  function normalizeFfmpegPath(ffmpegPath) {
    const value = String(ffmpegPath || "").trim();
    return value || "ffmpeg";
  }

  function positiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

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

  function isWindowsPath(filePath) {
    return /^[a-z]:\\/i.test(filePath);
  }

  function dirname(filePath) {
    const text = String(filePath || "");
    const separator = isWindowsPath(text) || text.includes("\\") ? "\\" : "/";
    const index = text.lastIndexOf(separator);
    return index >= 0 ? text.slice(0, index) : "";
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
    const text = String(directory || "");

    if (!text) {
      return fileName;
    }

    const separator = isWindowsPath(text) || text.includes("\\") ? "\\" : "/";
    return `${text.replace(/[\\/]+$/, "")}${separator}${fileName}`;
  }

  return {
    PRESET_DEFAULTS,
    basename,
    buildArgs,
    buildFilterGraph,
    buildResizeFilter,
    createConversionIntent,
    extension,
    formatArgForCommand,
    formatCommand,
    getOutputPath,
    parseArgs,
    planConversion,
    stem
  };
});
