const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCancelPayload,
  validateConversionPayload,
  validateProbePayload
} = require("../src/lib/logic/ipc-validation");

test("normalizes valid IPC payloads", () => {
  assert.deepEqual(validateProbePayload({ ffmpegPath: " /usr/bin/ffmpeg " }), {
    ok: true,
    value: {
      ffmpegPath: "/usr/bin/ffmpeg"
    }
  });
  assert.deepEqual(validateCancelPayload({ jobId: " job-1 " }), {
    ok: true,
    value: {
      jobId: "job-1"
    }
  });
  assert.deepEqual(validateConversionPayload({ jobId: " job-1 ", ffmpegPath: "", args: ["-i", "a.png", "b.webp"] }), {
    ok: true,
    value: {
      jobId: "job-1",
      ffmpegPath: "",
      args: ["-i", "a.png", "b.webp"]
    }
  });
});

test("rejects malformed conversion payloads", () => {
  assert.equal(validateConversionPayload({ jobId: "", args: ["-i"] }).ok, false);
  assert.equal(validateConversionPayload({ jobId: "job-1", args: [] }).ok, false);
  assert.equal(validateConversionPayload({ jobId: "job-1", args: ["-i", 42] }).ok, false);
  assert.equal(validateConversionPayload({ jobId: "job-1", ffmpegPath: 7, args: ["-i"] }).ok, false);
});
