// Ported from src/conversion-plan.js — UMD wrapper removed, ESM exports added,
// types added per migrate/07-svelte-frontend.md. Algorithms unchanged.

export type OutputFormat =
  | "webp" | "jpg" | "png" | "avif" | "tiff" | "bmp" | "gif"
  | "apng" | "jp2" | "exr" | "qoi" | "tga" | "jls";
export type Preset = "balanced" | "quality" | "small" | "lossless";
export type CollisionMode = "overwrite" | "skip" | "rename";
export type ResizeMode = "none" | "inside" | "fill" | "stretch";

export interface NamingOptions {
  prefix: string;
  suffix: string;
  sequential: boolean;
  padWidth: number;
}

export interface ConversionIntent {
  format: OutputFormat;
  preset: Preset;
  quality: number;
  collisionMode: CollisionMode;
  keepMetadata: boolean;
  outputDir: string;
  ffmpegPath: string;
  resize: { mode: ResizeMode; width: number; height: number };
  naming: NamingOptions;
  advanced: {
    globalArgs: string[];
    inputArgs: string[];
    filterGraph: string;
    outputArgs: string[];
  };
}

export interface ConversionPlan {
  file: { path: string; name: string };
  outputPath: string;
  args: string[];
}

interface CreateIntentOptions {
  format?: string;
  preset?: string;
  quality?: number;
  collisionMode?: string;
  keepMetadata?: boolean;
  outputDir?: string;
  ffmpegPath?: string;
  resizeMode?: string;
  width?: number;
  height?: number;
  naming?: Partial<NamingOptions>;
  globalArgsText?: string;
  inputArgsText?: string;
  filterText?: string;
  outputArgsText?: string;
}

export const PRESET_DEFAULTS: Record<Preset, { quality: number }> = {
  balanced: { quality: 82 },
  quality: { quality: 94 },
  small: { quality: 64 },
  lossless: { quality: 100 },
};

const supportedFormats = new Set<string>([
  "webp", "jpg", "png", "avif", "tiff", "bmp", "gif",
  "apng", "jp2", "exr", "qoi", "tga", "jls",
]);
const supportedPresets = new Set<string>(Object.keys(PRESET_DEFAULTS));
const supportedResizeModes = new Set<string>(["none", "inside", "fill", "stretch"]);
const supportedCollisionModes = new Set<string>(["overwrite", "skip", "rename"]);

const encoderArgs: Record<
  OutputFormat,
  (quality: number, preset: Preset) => string[]
> = {
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
  gif: () => ["-c:v", "gif"],
  // ponytail: encoders below are standard in distro ffmpeg builds.
  apng: () => ["-c:v", "png", "-frames:v", "1"],
  jp2: (quality) => ["-c:v", "libopenjpeg", "-q:v", String(quality)],
  exr: () => ["-c:v", "exr"],
  qoi: () => ["-c:v", "qoi"],
  tga: () => ["-c:v", "targa"],
  jls: (quality) => ["-c:v", "jpegls", "-q:v", String(quality)],
};

export function createConversionIntent(options: CreateIntentOptions = {}): ConversionIntent {
  const preset = normalizePreset(options.preset);
  const quality = normalizeQuality(options.quality, PRESET_DEFAULTS[preset].quality);

  return {
    format: normalizeFormat(options.format),
    preset,
    quality,
    collisionMode: normalizeCollisionMode(options.collisionMode),
    keepMetadata: Boolean(options.keepMetadata),
    outputDir: String(options.outputDir || ""),
    ffmpegPath: normalizeFfmpegPath(options.ffmpegPath),
    resize: {
      mode: normalizeResizeMode(options.resizeMode),
      width: positiveInteger(options.width),
      height: positiveInteger(options.height),
    },
    naming: normalizeNaming(options.naming),
    advanced: {
      globalArgs: parseArgs(options.globalArgsText),
      inputArgs: parseArgs(options.inputArgsText),
      filterGraph: String(options.filterText || "").trim(),
      outputArgs: parseArgs(options.outputArgsText),
    },
  };
}

export function planConversion(
  file: { path: string; name: string },
  intent: ConversionIntent,
  index = 0,
): ConversionPlan {
  const conversionIntent = intent || createConversionIntent();
  const outputPath = getOutputPath(file, conversionIntent, index);
  const args = buildArgs(file, conversionIntent, outputPath);

  return {
    file,
    outputPath,
    args,
  };
}

function buildArgs(
  file: { path: string; name: string },
  intent: ConversionIntent,
  outputPath: string = getOutputPath(file, intent),
): string[] {
  const filterGraph = buildFilterGraph(intent);
  const overwrite = intent.collisionMode !== "skip";
  const args = [
    "-hide_banner",
    ...intent.advanced.globalArgs,
    overwrite ? "-y" : "-n",
    ...intent.advanced.inputArgs,
    "-i",
    file.path,
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

export function buildFilterGraph(intent: ConversionIntent): string {
  return [buildResizeFilter(intent.resize), intent.advanced.filterGraph].filter(Boolean).join(",");
}

export function buildResizeFilter(resize: {
  mode?: string;
  width?: number;
  height?: number;
}): string {
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

function getOutputPath(
  file: { path: string; name: string },
  intent: ConversionIntent,
  index = 0,
): string {
  const format = intent.format;
  const naming = intent.naming || { prefix: "", suffix: "", sequential: false, padWidth: 3 };
  const fileName = file.name || file.path;
  const fileStem = stem(fileName);
  const sourceExt = extension(fileName);
  const isSameFormat = (sourceExt === "jpeg" ? "jpg" : sourceExt) === format;

  let outputName: string;

  if (naming.sequential) {
    const paddedIndex = String(index + 1).padStart(naming.padWidth, "0");
    outputName = `${naming.prefix}${paddedIndex}${naming.suffix}.${format}`;
  } else {
    const suffix = naming.suffix || (isSameFormat ? "-converted" : "");
    outputName = `${naming.prefix}${fileStem}${suffix}.${format}`;
  }

  return joinPath(getOutputDirectory(file, intent), outputName);
}

function getOutputDirectory(file: { path: string }, intent: ConversionIntent): string {
  return intent.outputDir || dirname(file.path);
}

export function formatCommand(args: string[], options: { platform?: string } = {}): string {
  return args.map((arg) => formatArgForCommand(arg, options)).join(" ");
}

function formatArgForCommand(value: unknown, options: { platform?: string } = {}): string {
  const text = String(value || "");

  if (!text) {
    return '""';
  }

  if (/^[a-zA-Z0-9_./:=,+@%-]+$/.test(text)) {
    return text;
  }

  if (options.platform === "win32") {
    return `"${text.replace(/(\\*)"/g, "$1$1\\\"").replace(/\\+$/g, "$&$&")}"`;
  }

  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function parseArgs(value: unknown): string[] {
  const input = String(value || "").trim();

  if (!input) {
    return [];
  }

  const args: string[] = [];
  let current = "";
  let quote = "";
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote === '"') {
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

    if (char === '"' || char === "'") {
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

function normalizeFormat(format: unknown): OutputFormat {
  const value = String(format || "").toLowerCase();
  return (supportedFormats.has(value) ? value : "webp") as OutputFormat;
}

function normalizePreset(preset: unknown): Preset {
  const value = String(preset || "").toLowerCase();
  return (supportedPresets.has(value) ? value : "balanced") as Preset;
}

function normalizeResizeMode(mode: unknown): ResizeMode {
  const value = String(mode || "").toLowerCase();
  return (supportedResizeModes.has(value) ? value : "none") as ResizeMode;
}

function normalizeCollisionMode(mode: unknown): CollisionMode {
  const value = String(mode || "").toLowerCase();
  return (supportedCollisionModes.has(value) ? value : "overwrite") as CollisionMode;
}

function normalizeNaming(naming: Partial<NamingOptions> | undefined): NamingOptions {
  const source = naming && typeof naming === "object" ? naming : {};

  return {
    prefix: String(source.prefix || "").trim(),
    suffix: String(source.suffix || "").trim(),
    sequential: Boolean(source.sequential),
    padWidth: clamp(positiveInteger(source.padWidth) || 3, 1, 5),
  };
}

function normalizeQuality(quality: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(quality), 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return clamp(value, 1, 100);
}

function normalizeFfmpegPath(ffmpegPath: unknown): string {
  const value = String(ffmpegPath || "").trim();
  return value || "ffmpeg";
}

function positiveInteger(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function jpegQualityScale(quality: number): string {
  const value = 31 - Math.round((clamp(quality, 1, 100) / 100) * 29);
  return String(clamp(value, 2, 31));
}

function avifCrfScale(quality: number): string {
  const value = 63 - Math.round((clamp(quality, 1, 100) / 100) * 63);
  return String(clamp(value, 0, 63));
}

function pngCompressionLevel(preset: Preset): string {
  if (preset === "small") {
    return "9";
  }
  if (preset === "quality") {
    return "3";
  }
  return "6";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isWindowsPath(filePath: string): boolean {
  return /^[a-z]:\\/i.test(filePath);
}

function dirname(filePath: string): string {
  const text = String(filePath || "");
  const separator = isWindowsPath(text) || text.includes("\\") ? "\\" : "/";
  const index = text.lastIndexOf(separator);
  return index >= 0 ? text.slice(0, index) : "";
}

export function basename(filePath: string): string {
  const normalized = String(filePath || "").replaceAll("\\", "/");
  return normalized.split("/").pop() || "";
}

export function extension(name: string): string {
  const fileName = basename(name);
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(index + 1).toLowerCase() : "";
}

function stem(name: string): string {
  const fileName = basename(name);
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(0, index) : fileName;
}

function joinPath(directory: string, fileName: string): string {
  const text = String(directory || "");

  if (!text) {
    return fileName;
  }

  const separator = isWindowsPath(text) || text.includes("\\") ? "\\" : "/";
  return `${text.replace(/[\\/]+$/, "")}${separator}${fileName}`;
}
