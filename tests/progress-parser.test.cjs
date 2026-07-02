const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLine, parseStderr, timeToSeconds } = require("../src/progress-parser");

test("parses a single FFmpeg progress line", () => {
  const result = parseLine("frame=  123 fps= 45 q=28.0 size=    1024kB time=00:00:05.12 bitrate=1638.4kbits/s");
  assert.deepEqual(result, {
    frame: 123,
    fps: 45,
    time: "00:00:05.12",
    sizeKb: 1024
  });
});

test("parses partial progress with only frame and fps", () => {
  const result = parseLine("frame=   42 fps= 12.5");
  assert.equal(result.frame, 42);
  assert.equal(result.fps, 12.5);
  assert.equal(result.time, null);
  assert.equal(result.sizeKb, null);
});

test("returns null for non-progress lines", () => {
  assert.equal(parseLine("Press [q] to stop"), null);
  assert.equal(parseLine("Stream mapping:"), null);
  assert.equal(parseLine(""), null);
});

test("extracts the last progress line from a multi-line stderr chunk", () => {
  const chunk = `frame=  10 fps= 30 q=28.0 size=     128kB time=00:00:00.40 bitrate=2621.4kbits/s
frame=  20 fps= 30 q=28.0 size=     256kB time=00:00:00.80 bitrate=2621.4kbits/s
frame=  30 fps= 30 q=28.0 size=     384kB time=00:00:01.20 bitrate=2621.4kbits/s`;

  const result = parseStderr(chunk);
  assert.equal(result.frame, 30);
  assert.equal(result.time, "00:00:01.20");
});

test("converts time strings to seconds", () => {
  assert.equal(timeToSeconds("00:00:05.12"), 5.12);
  assert.equal(timeToSeconds("00:01:30.00"), 90);
  assert.equal(timeToSeconds("01:00:00.00"), 3600);
  assert.equal(timeToSeconds(null), null);
  assert.equal(timeToSeconds("invalid"), null);
});
