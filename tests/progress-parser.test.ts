import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  etaSeconds,
  parseLine,
  parseStderr,
  parseTimecodeSeconds,
  progressPercent,
} from "../src/lib/logic/progress-parser";

describe("progress-parser", () => {
  test("parses a single FFmpeg progress line", () => {
    const result = parseLine("frame=  123 fps= 45 q=28.0 size=    1024kB time=00:00:05.12 bitrate=1638.4kbits/s");
    assert.deepEqual(result, {
      frame: 123,
      fps: 45,
      time: "00:00:05.12",
      sizeKb: 1024,
      elapsed: null,
      speed: null,
    });
  });

  test("parses elapsed wall-clock when the build emits it", () => {
    const result = parseLine(
      "frame=  60 fps= 30 q=28.0 size=     256kB time=00:00:02.00 bitrate=1024.0kbits/s elapsed=00:00:07.40 speed=0.27x",
    );
    assert.equal(result?.time, "00:00:02.00");
    assert.equal(result?.elapsed, "00:00:07.40");
    assert.equal(result?.speed, 0.27);
  });

  test("parses partial progress with only frame and fps", () => {
    const result = parseLine("frame=   42 fps= 12.5");
    assert.equal(result?.frame, 42);
    assert.equal(result?.fps, 12.5);
    assert.equal(result?.time, null);
    assert.equal(result?.sizeKb, null);
  });

  test("returns null for non-progress lines", () => {
    assert.equal(parseLine("Press [q] to stop"), null);
    assert.equal(parseLine("Stream mapping:"), null);
    assert.equal(parseLine(""), null);
  });

  test("parses speed without the x suffix", () => {
    assert.equal(parseLine("frame=1 fps=1 speed=2.5")?.speed, 2.5);
  });
});

describe("progress math", () => {
  test("parseTimecodeSeconds converts HH:MM:SS.cc", () => {
    assert.equal(parseTimecodeSeconds("00:00:05.12"), 5.12);
    assert.equal(parseTimecodeSeconds("01:02:03.40"), 3723.4);
    assert.equal(parseTimecodeSeconds("00:00:00.00"), 0);
    assert.equal(parseTimecodeSeconds("N/A"), null);
    assert.equal(parseTimecodeSeconds(null), null);
    assert.equal(parseTimecodeSeconds("5.12"), null);
  });

  test("progressPercent from timecode and duration", () => {
    assert.equal(progressPercent("00:00:30.00", 120), 25);
    assert.equal(progressPercent("00:02:00.00", 60), 100, "clamps past 100");
    assert.equal(progressPercent("00:00:01.00", 0), null);
    assert.equal(progressPercent(null, 120), null);
    assert.equal(progressPercent("00:00:01.00", undefined), null);
  });

  test("etaSeconds divides remaining time by encode speed", () => {
    const frame = { time: "00:00:30.00", speed: 2 };
    assert.equal(etaSeconds(frame, 130), 50, "100s remaining at 2x = 50s eta");
    assert.equal(etaSeconds({ time: "00:00:30.00", speed: null }, 130), null);
    assert.equal(etaSeconds({ time: "00:00:30.00", speed: 0 }, 130), null);
    assert.equal(etaSeconds({ time: "00:00:30.00", speed: 1 }, undefined), null);
    assert.equal(etaSeconds({ time: "00:02:00.00", speed: 4 }, 60), null, "past duration");
    assert.equal(etaSeconds(null, 60), null);
  });
  test("parses speed without the x suffix", () => {
    assert.equal(parseLine("frame=1 fps=1 speed=2.5")?.speed, 2.5);
  });

  test("extracts the last progress line from a multi-line stderr chunk", () => {
    const chunk = `frame=  10 fps= 30 q=28.0 size=     128kB time=00:00:00.40 bitrate=2621.4kbits/s
frame=  20 fps= 30 q=28.0 size=     256kB time=00:00:00.80 bitrate=2621.4kbits/s
frame=  30 fps= 30 q=28.0 size=     384kB time=00:00:01.20 bitrate=2621.4kbits/s`;

    const result = parseStderr(chunk);
    assert.equal(result?.frame, 30);
    assert.equal(result?.time, "00:00:01.20");
  });
});
