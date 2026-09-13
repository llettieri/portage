import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE = 'assets/icon.svg';
const OUTPUT_DIR = 'public/icons';

const EXTENSION_SIZES = [16, 32, 48, 128];
const ACTION_SIZES = [16, 24, 32];

async function generateIcons() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const sourceBuffer = fs.readFileSync(SOURCE);

  for (const size of [...new Set([...EXTENSION_SIZES, ...ACTION_SIZES])]) {
    await sharp(sourceBuffer, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(OUTPUT_DIR, `_${size}.png`));
  }

  for (const size of EXTENSION_SIZES) {
    fs.copyFileSync(path.join(OUTPUT_DIR, `_${size}.png`), path.join(OUTPUT_DIR, `icon${size}.png`));
    console.log(`Generated icon${size}.png`);
  }
  for (const size of ACTION_SIZES) {
    fs.copyFileSync(path.join(OUTPUT_DIR, `_${size}.png`), path.join(OUTPUT_DIR, `action${size}.png`));
    console.log(`Generated action${size}.png`);
  }
  for (const size of [...new Set([...EXTENSION_SIZES, ...ACTION_SIZES])]) {
    fs.unlinkSync(path.join(OUTPUT_DIR, `_${size}.png`));
  }

  console.log('\nAll icons generated successfully.');
}

generateIcons().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
