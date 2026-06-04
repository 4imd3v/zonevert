const fs = require("node:fs/promises");
const path = require("node:path");

const artifactDirs = ["release", "dist", "out", "build"];

async function main() {
  const root = path.resolve(__dirname, "..");

  for (const directory of artifactDirs) {
    const target = path.join(root, directory);
    await fs.rm(target, {
      recursive: true,
      force: true
    });
    console.log(`Removed ${directory}/`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
