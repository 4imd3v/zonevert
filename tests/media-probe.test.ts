import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMedia,
  formatDuration,
  formatProbeSummary,
  isConvertibleVideo,
} from "../src/lib/logic/media-probe";
import type { MediaProbeResult } from "../src/lib/bindings";

const videoProbe: MediaProbeResult = {
  ok: true,
  duration: 12.345,
  video: {
    codecType: "video",
    codecName: "h264",
    width: 1920,
    height: 1080,
    pixFmt: "yuv420p",
    frameRate: 30,
  },
  audio: { codecType: "audio", codecName: "aac", sampleRate: 44100, channels: 2 },
};

// mp3 with embedded cover art: Rust strips the attached_pic stream, so the
// frontend must see audio — never a 64×48 "video" to transcode.
const coverArtProbe: MediaProbeResult = {
  ok: true,
  duration: 1,
  audio: { codecType: "audio", codecName: "mp3", sampleRate: 44100, channels: 1 },
};

const noAudioProbe: MediaProbeResult = {
  ok: true,
  duration: 2,
  video: {
    codecType: "video",
    codecName: "h264",
    width: 320,
    height: 240,
    frameRate: 29.97,
  },
};

describe("media-probe", () => {
  test("classifies video, audio, unknown", () => {
    assert.equal(classifyMedia(videoProbe), "video");
    assert.equal(classifyMedia(coverArtProbe), "audio");
    assert.equal(classifyMedia({ ok: false, error: "boom" }), "unknown");
    assert.equal(classifyMedia(null), "unknown");
    assert.equal(classifyMedia({ ok: true }), "unknown");
  });

  test("isConvertibleVideo requires real dimensions", () => {
    assert.equal(isConvertibleVideo(videoProbe), true);
    assert.equal(isConvertibleVideo(noAudioProbe), true);
    assert.equal(isConvertibleVideo(coverArtProbe), false);
    assert.equal(isConvertibleVideo({ ok: false }), false);
    assert.equal(
      isConvertibleVideo({
        ok: true,
        video: { codecType: "video", codecName: "h264", width: 0, height: 0 },
      }),
      false,
    );
  });

  test("formatProbeSummary builds a UI one-liner", () => {
    assert.equal(formatProbeSummary(videoProbe), "1920×1080 · h264 · 30 fps · 12.3s · aac");
    assert.equal(formatProbeSummary(coverArtProbe), "1.0s · mp3");
    assert.equal(formatProbeSummary(noAudioProbe), "320×240 · h264 · 30 fps · 2.0s");
    assert.equal(formatProbeSummary({ ok: false }), "unreadable");
  });

  test("formatDuration formats seconds", () => {
    assert.equal(formatDuration(0), "0.0s");
    assert.equal(formatDuration(12.34), "12.3s");
    assert.equal(formatDuration(65), "1:05");
    assert.equal(formatDuration(3725), "1:02:05");
    assert.equal(formatDuration(undefined), "?");
    assert.equal(formatDuration(Number.NaN), "?");
  });
});
