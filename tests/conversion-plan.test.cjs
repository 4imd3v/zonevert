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

test("applies custom prefix and suffix to output name", () => {
  const intent = createConversionIntent({
    format: "webp",
    naming: { prefix: "thumb-", suffix: "-v2" }
  });
  const plan = planConversion({ path: "/in/photo.png", name: "photo.png" }, intent);
  assert.equal(plan.outputPath, "/in/thumb-photo-v2.webp");
});

test("uses sequential numbering when enabled", () => {
  const intent = createConversionIntent({
    format: "webp",
    naming: { sequential: true, padWidth: 3 }
  });
  const plan0 = planConversion({ path: "/in/a.png", name: "a.png" }, intent, 0);
  const plan2 = planConversion({ path: "/in/b.png", name: "b.png" }, intent, 2);
  assert.equal(plan0.outputPath, "/in/001.webp");
  assert.equal(plan2.outputPath, "/in/003.webp");
});

test("defaults collision mode to overwrite", () => {
  const intent = createConversionIntent({ format: "webp" });
  assert.equal(intent.collisionMode, "overwrite");
});

test("skip collision mode suppresses overwrite flag", () => {
  const intent = createConversionIntent({ format: "webp", collisionMode: "skip" });
  const plan = planConversion({ path: "/in/a.png", name: "a.png" }, intent);
  assert.equal(plan.args.includes("-y"), false);
  assert.equal(plan.args.includes("-n"), true);
});

test("handles empty path gracefully", () => {
  const intent = createConversionIntent({ format: "webp" });
  const plan = planConversion({ path: "", name: "" }, intent);
  assert.equal(plan.outputPath, ".webp");
});

test("handles unicode filenames", () => {
  const intent = createConversionIntent({ format: "png" });
  const plan = planConversion({ path: "/images/café résumé.jpg", name: "café résumé.jpg" }, intent);
  assert.equal(plan.outputPath, "/images/café résumé.png");
});

test("handles very long arg strings", () => {
  const longArg = "-metadata".padEnd(8000, "x");
  const intent = createConversionIntent({
    format: "webp",
    globalArgsText: longArg
  });
  const args = intent.advanced.globalArgs;
  assert.equal(args.length, 1);
  assert.equal(args[0].length, 8000);
});
