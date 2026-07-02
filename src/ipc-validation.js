// @ts-check
(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  root.ZonevertIpcValidation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const maxJobIdLength = 128;
  const maxPathLength = 4096;
  const maxArgCount = 512;
  const maxArgLength = 8192;

  function validateProbePayload(payload = {}) {
    const ffmpegPath = normalizeOptionalString(payload.ffmpegPath, "FFmpeg path", maxPathLength);

    if (!ffmpegPath.ok) {
      return ffmpegPath;
    }

    return {
      ok: true,
      value: {
        ffmpegPath: ffmpegPath.value
      }
    };
  }

  function validateConversionPayload(payload = {}) {
    const jobId = normalizeRequiredString(payload.jobId, "Job id", maxJobIdLength);

    if (!jobId.ok) {
      return jobId;
    }

    const ffmpegPath = normalizeOptionalString(payload.ffmpegPath, "FFmpeg path", maxPathLength);

    if (!ffmpegPath.ok) {
      return ffmpegPath;
    }

    if (!Array.isArray(payload.args)) {
      return fail("Conversion args must be an array.");
    }

    if (payload.args.length === 0) {
      return fail("Conversion args cannot be empty.");
    }

    if (payload.args.length > maxArgCount) {
      return fail(`Conversion args cannot exceed ${maxArgCount} entries.`);
    }

    const args = [];

    for (const [index, arg] of payload.args.entries()) {
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
        args
      }
    };
  }

  function validateCancelPayload(payload = {}) {
    const jobId = normalizeRequiredString(payload.jobId, "Job id", maxJobIdLength);

    if (!jobId.ok) {
      return jobId;
    }

    return {
      ok: true,
      value: {
        jobId: jobId.value
      }
    };
  }

  function normalizeRequiredString(value, label, maxLength) {
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
      value: trimmed
    };
  }

  function normalizeOptionalString(value, label, maxLength) {
    if (value === undefined || value === null) {
      return {
        ok: true,
        value: ""
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
      value: trimmed
    };
  }

  function fail(error) {
    return {
      ok: false,
      error
    };
  }

  return {
    validateCancelPayload,
    validateConversionPayload,
    validateProbePayload
  };
});
