// Ported from src/ipc-validation.js — UMD wrapper removed, ESM exports added,
// types added per migrate/07-svelte-frontend.md. Algorithms unchanged.

export interface ValidationOk<T> {
  ok: true;
  value: T;
}
export interface ValidationErr {
  ok: false;
  error: string;
}
export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

export interface ProbePayload {
  ffmpegPath: string;
}
export interface ConversionPayload {
  jobId: string;
  ffmpegPath: string;
  args: string[];
}
export interface CancelPayload {
  jobId: string;
}

const maxJobIdLength = 128;
const maxPathLength = 4096;
const maxArgCount = 512;
const maxArgLength = 8192;

export function validateProbePayload(payload: unknown = {}): ValidationResult<ProbePayload> {
  const ffmpegPath = normalizeOptionalString(
    (payload as Record<string, unknown>)?.ffmpegPath,
    "FFmpeg path",
    maxPathLength,
  );

  if (!ffmpegPath.ok) {
    return ffmpegPath;
  }

  return {
    ok: true,
    value: {
      ffmpegPath: ffmpegPath.value,
    },
  };
}

export function validateConversionPayload(
  payload: unknown = {},
): ValidationResult<ConversionPayload> {
  const jobId = normalizeRequiredString(
    (payload as Record<string, unknown>)?.jobId,
    "Job id",
    maxJobIdLength,
  );

  if (!jobId.ok) {
    return jobId;
  }

  const ffmpegPath = normalizeOptionalString(
    (payload as Record<string, unknown>)?.ffmpegPath,
    "FFmpeg path",
    maxPathLength,
  );

  if (!ffmpegPath.ok) {
    return ffmpegPath;
  }

  const argsRaw = (payload as Record<string, unknown>)?.args;
  if (!Array.isArray(argsRaw)) {
    return fail("Conversion args must be an array.");
  }

  if (argsRaw.length === 0) {
    return fail("Conversion args cannot be empty.");
  }

  if (argsRaw.length > maxArgCount) {
    return fail(`Conversion args cannot exceed ${maxArgCount} entries.`);
  }

  const args: string[] = [];

  for (const [index, arg] of argsRaw.entries()) {
    if (typeof arg !== "string") {
      return fail(`Conversion arg ${index + 1} must be a string.`);
    }

    if (arg.length > maxArgLength) {
      return fail(`Conversion arg ${index + 1} is too long.`);
    }

    args.push(arg);
  }

  return {
    ok: true,
    value: {
      jobId: jobId.value,
      ffmpegPath: ffmpegPath.value,
      args,
    },
  };
}

export function validateCancelPayload(payload: unknown = {}): ValidationResult<CancelPayload> {
  const jobId = normalizeRequiredString(
    (payload as Record<string, unknown>)?.jobId,
    "Job id",
    maxJobIdLength,
  );

  if (!jobId.ok) {
    return jobId;
  }

  return {
    ok: true,
    value: {
      jobId: jobId.value,
    },
  };
}

function normalizeRequiredString(
  value: unknown,
  label: string,
  maxLength: number,
): ValidationResult<string> {
  if (typeof value !== "string") {
    return fail(`${label} must be a string.`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return fail(`${label} is required.`);
  }

  if (trimmed.length > maxLength) {
    return fail(`${label} is too long.`);
  }

  return {
    ok: true,
    value: trimmed,
  };
}

function normalizeOptionalString(
  value: unknown,
  label: string,
  maxLength: number,
): ValidationResult<string> {
  if (value === undefined || value === null) {
    return {
      ok: true,
      value: "",
    };
  }

  if (typeof value !== "string") {
    return fail(`${label} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    return fail(`${label} is too long.`);
  }

  return {
    ok: true,
    value: trimmed,
  };
}

function fail(error: string): ValidationErr {
  return {
    ok: false,
    error,
  };
}
