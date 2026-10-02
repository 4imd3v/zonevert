import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  createVideoIntent,
  planVideoConversion,
  videoOutputPath,
} from "../src/lib/logic/video-plan";
import type { MediaProbeResult } from "../src/lib/bindings";

const h264Probe: MediaProbeResult = {
  ok: true,
  duration: 12.345,
  video: { codecType: "video", codecName: "h264", width: 1920, height: 1080, pixFmt: "yuv420p", frameRate: 30 },
  audio: { codecType: "audio", codecName: "aac", sampleRate: 44100, channels: 2 },
};

// no-audio video — planner must use the optional audio map
const silentProbe: MediaProbeResult = {
  ok: true,
  duration: 2,
  video: { codecType: "video", codecName: "h264", width: 320, height: 240 },
};

// mp3 with cover art: Rust filtered the attached_pic stream
const coverArtProbe: MediaProbeResult = {
  ok: true,
  duration: 1,
  audio: { codecType: "audio", codecName: "mp3", sampleRate: 44100, channels: 1 },
};

const vp9Probe: MediaProbeResult = {
  ok: true,
  duration: 5,
  video: { codecType: "video", codecName: "vp9", width: 1280, height: 720 },
  audio: { codecType: "audio", codecName: "opus", sampleRate: 48000, channels: 1 },
};

const file = { path: "/in/clip.mkv", name: "clip.mkv" };

describe("video-plan", () => {
  test("mp4-h264 argv", () => {
    const plan = planVideoConversion(file, vp9Probe, createVideoIntent({ profile: "mp4-h264" }));
    assert.equal(plan.ok, true);
    assert.equal(plan.remuxOnly, false);
    assert.deepEqual(plan.args, [
      "-hide_banner", "-y", "-i", "/in/clip.mkv",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-crf", "23", "-preset", "medium", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "/in/clip.mp4",
    ]);
    assert.equal(plan.outputPath, "/in/clip.mp4");
  });

  test("webm-vp9 argv (libvpx crf range, no faststart)", () => {
    const plan = planVideoConversion(file, h264Probe, createVideoIntent({ profile: "webm-vp9" }));
    assert.deepEqual(plan.args, [
      "-hide_banner", "-y", "-i", "/in/clip.mkv",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libvpx-vp9", "-crf", "31", "-b:v", "0", "-deadline", "good", "-cpu-used", "2",
      "-c:a", "libopus", "-b:a", "128k",
      "/in/clip.webm",
    ]);
  });

  test("mp4-hevc argv tags hvc1", () => {
    const plan = planVideoConversion(file, h264Probe, createVideoIntent({ profile: "mp4-hevc" }));
    assert.ok(plan.args.includes("hvc1"));
    assert.ok(plan.args.includes("libx265"));
  });

  test("crf clamps to the encoder range", () => {
    // vp9 source + h264 profile -> re-encode (h264 source would remux)
    const high = planVideoConversion(file, vp9Probe, createVideoIntent({ crf: 999 }));
    assert.ok(high.args.includes("51"), "x264 crf must clamp to 51");
    const vp9 = planVideoConversion(file, silentProbe, createVideoIntent({ profile: "webm-vp9", crf: 51 }));
    assert.ok(vp9.args.includes("51"), "vp9 accepts 51");
  });

  test("scaling and fps emit filters and warnings", () => {
    const plan = planVideoConversion(
      file, h264Probe,
      createVideoIntent({ resolution: "720p", fps: 30 }),
    );
    assert.ok(plan.args.includes("scale=-2:720"));
    assert.ok(plan.args.includes("-r"));
    assert.ok(plan.warnings.some((w) => w.includes("fps")));
    assert.ok(!plan.warnings.some((w) => w.includes("Upscaling")), "1080->720 is downscale");
  });

  test("upscaling warns", () => {
    const small = planVideoConversion(
      { path: "/in/small.mkv", name: "small.mkv" },
      { ...h264Probe, video: { codecType: "video", codecName: "h264", width: 640, height: 480 } },
      createVideoIntent({ resolution: "1080p" }),
    );
    assert.ok(small.args.includes("scale=-2:1080"));
    assert.ok(small.warnings.some((w) => w.includes("Upscaling")));
  });

  test("remux when profile codecs already match", () => {
    const plan = planVideoConversion(
      { path: "/in/a.mkv", name: "a.mkv" }, h264Probe,
      createVideoIntent({ profile: "mp4-h264" }),
    );
    assert.equal(plan.remuxOnly, true);
    assert.equal(plan.chosenVideoEncoder, "copy");
    assert.deepEqual(plan.args, [
      "-hide_banner", "-y", "-i", "/in/a.mkv",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c", "copy",
      "-movflags", "+faststart",
      "/in/a.mp4",
    ]);
  });

  test("no remux when codec or resolution differs", () => {
    // vp9 source with h264 profile must re-encode
    const wrongCodec = planVideoConversion(
      { path: "/in/a.webm", name: "a.webm" }, vp9Probe,
      createVideoIntent({ profile: "mp4-h264" }),
    );
    assert.equal(wrongCodec.remuxOnly, false);
    // any transform forces re-encode even when codecs match
    const scaled = planVideoConversion(
      { path: "/in/a.mkv", name: "a.mkv" }, h264Probe,
      createVideoIntent({ resolution: "480p" }),
    );
    assert.equal(scaled.remuxOnly, false);
    assert.ok(scaled.args.includes("libx264"));
    // mismatched audio codec also forces re-encode
    const badAudio = planVideoConversion(
      { path: "/in/a.mkv", name: "a.mkv" },
      { ...h264Probe, audio: { codecType: "audio", codecName: "eac3" } },
      createVideoIntent({ profile: "mp4-h264" }),
    );
    assert.equal(badAudio.remuxOnly, false);
  });

  test("rejects audio-only and unreadable inputs", () => {
    const cover = planVideoConversion(file, coverArtProbe, createVideoIntent());
    assert.equal(cover.ok, false);
    assert.match(cover.rejection!, /No video stream/);

    const failed = planVideoConversion(file, { ok: false, error: "boom" }, createVideoIntent());
    assert.equal(failed.ok, false);
    assert.match(failed.rejection!, /ffprobe could not read/);
  });

  test("no-audio video still plans (optional audio map)", () => {
    // silent h264 source into the webm profile forces re-encode (codecs differ)
    const plan = planVideoConversion(file, silentProbe, createVideoIntent({ profile: "webm-vp9" }));
    assert.equal(plan.ok, true);
    assert.ok(plan.args.includes("0:a:0?"));
    assert.ok(plan.args.includes("libopus"));
  });

  test("unknown duration warns but plans", () => {
    const plan = planVideoConversion(
      file, { ok: true, video: { codecType: "video", codecName: "h264", width: 640, height: 480 } },
      createVideoIntent(),
    );
    assert.equal(plan.ok, true);
    assert.ok(plan.warnings.some((w) => w.includes("indeterminate")));
  });

  test("output path: same-extension inputs get a -converted suffix", () => {
    const mp4In = { path: "/in/movie.mp4", name: "movie.mp4" };
    const intent = createVideoIntent({ profile: "mp4-h264" });
    assert.equal(videoOutputPath(mp4In, intent), "/in/movie-converted.mp4");
    assert.equal(videoOutputPath({ path: "/in/clip.mkv", name: "clip.mkv" }, intent), "/in/clip.mp4");
    // custom output dir honored
    assert.equal(videoOutputPath(mp4In, createVideoIntent({ outputDir: "/out" })), "/out/movie-converted.mp4");
  });

  test("same input/output path is rejected, not silently overwritten", () => {
    // mp4-hevc on an mp4-hevc source with a -converted suffix can't collide by
    // construction, so force the collision with a crafted intent instead.
    const intent = { ...createVideoIntent({ outputDir: "/in" }), profile: "mp4-hevc" as const };
    const plan = planVideoConversion(
      { path: "/in/movie.mp4", name: "movie.mp4" },
      { ok: true, duration: 1, video: { codecType: "video", codecName: "hevc", width: 640, height: 480 } },
      intent,
    );
    assert.equal(plan.ok, true, "suffix prevents collision");
    assert.equal(plan.outputPath, "/in/movie-converted.mp4");
  });

  test("normalization: unknown profile falls back to mp4-h264, weird fps to source", () => {
    const intent = createVideoIntent({ profile: "nope", resolution: "4k", fps: "144" as any, crf: "abc" as any });
    assert.equal(intent.profile, "mp4-h264");
    assert.equal(intent.resolution, "source");
    assert.equal(intent.fps, "source");
    assert.equal(intent.crf, 23);
  });
});
