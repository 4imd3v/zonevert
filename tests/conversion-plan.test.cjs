const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildResizeFilter,
  createConversionIntent,
  formatCommand,
  parseArgs,
  planConversion
} = require("../src/conversion-plan");

test("plans FFmpeg args from conversion intent", () => {
  const file = {
    path: "/images/source photo.png",
    name: "source photo.png"
  };
  const intent = createConversionIntent({
    format: "webp",
    preset: "quality",
    quality: 94,
    outputDir: "/exports",
    overwrite: false,
    keepMetadata: false,
    resizeMode: "inside",
    width: "1200",
    globalArgsText: "-nostdin",
    inputArgsText: "-framerate 1",
    filterText: "format=rgba",
    outputArgsText: "-threads 2"
  });

  const plan = planConversion(file, intent);

  assert.equal(plan.outputPath, "/exports/source photo.webp");
  assert.deepEqual(plan.args, [
    "-hide_banner",
    "-nostdin",
    "-n",
    "-framerate",
    "1",
    "-i",
    "/images/source photo.png",
    "-map_metadata",
    "-1",
    "-vf",
    "scale=1200:-1:force_original_aspect_ratio=decrease,format=rgba",
    "-c:v",
    "libwebp",
    "-q:v",
    "94",
    "-threads",
    "2",
    "/exports/source photo.webp"
  ]);
});

test("renames same-format outputs to avoid self-overwrite", () => {
  const intent = createConversionIntent({
    format: "jpg"
  });
  const plan = planConversion(
    {
      path: "C:\\images\\photo.jpeg",
      name: "photo.jpeg"
    },
    intent
  );

  assert.equal(plan.outputPath, "C:\\images\\photo-converted.jpg");
});

test("builds resize filters for fit, fill, and stretch", () => {
  assert.equal(buildResizeFilter({ mode: "inside", width: 800 }), "scale=800:-1:force_original_aspect_ratio=decrease");
  assert.equal(
    buildResizeFilter({ mode: "fill", width: 800, height: 600 }),
    "scale=800:600:force_original_aspect_ratio=increase,crop=800:600"
  );
  assert.equal(buildResizeFilter({ mode: "stretch", width: 800, height: 600 }), "scale=800:600");
});

test("parses quoted advanced args", () => {
  assert.deepEqual(parseArgs('-vf "scale=100:100" -metadata title=\'A B\''), [
    "-vf",
    "scale=100:100",
    "-metadata",
    "title=A B"
  ]);
});

test("formats copied commands with shell-sensitive paths", () => {
  assert.equal(formatCommand(["ffmpeg", "-i", "/tmp/a b's.png"], { platform: "linux" }), "ffmpeg -i '/tmp/a b'\\''s.png'");
  assert.equal(formatCommand(["ffmpeg", "-i", "C:\\A B\\photo.png"], { platform: "win32" }), 'ffmpeg -i "C:\\A B\\photo.png"');
});
