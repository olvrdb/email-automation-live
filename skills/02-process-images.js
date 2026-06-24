import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config.js';

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function makeSliceFileName(index) {
  return `slice-${String(index).padStart(3, '0')}.png`;
}

async function run() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error(
      'Missing input image path. Run: node skills/02-process-images.js "output/slices/email-hero.png"'
    );
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  const targetWidth = Number(process.env.EMAIL_WIDTH || 640);
  const maxSliceHeight = Number(process.env.EMAIL_SLICE_HEIGHT || 900);

  const fileName = path.basename(inputPath, path.extname(inputPath));
  const processedImagePath = path.join(
    config.output.slicesDir,
    `${fileName}-processed.png`
  );

  const sliceDir = path.join(config.output.slicesDir, `${fileName}-slices`);
  const manifestPath = path.join(sliceDir, 'manifest.json');

  console.log(`Processing image: ${inputPath}`);
  console.log(`Target email width: ${targetWidth}px`);
  console.log(`Max slice height: ${maxSliceHeight}px`);

  fs.mkdirSync(config.output.slicesDir, { recursive: true });

  fs.rmSync(sliceDir, {
    recursive: true,
    force: true,
  });

  fs.mkdirSync(sliceDir, {
    recursive: true,
  });

  const processedBuffer = await sharp(inputPath)
    .resize({
      width: targetWidth,
      withoutEnlargement: false,
    })
    .png({
      compressionLevel: 9,
      quality: 100,
    })
    .toBuffer();

  await sharp(processedBuffer).toFile(processedImagePath);

  const metadata = await sharp(processedBuffer).metadata();

  const finalWidth = metadata.width;
  const finalHeight = metadata.height;

  if (!finalWidth || !finalHeight) {
    throw new Error('Could not read processed image dimensions.');
  }

  const slices = [];
  let sliceIndex = 1;

  for (let y = 0; y < finalHeight; y += maxSliceHeight) {
    const sliceHeight = Math.min(maxSliceHeight, finalHeight - y);
    const sliceFileName = makeSliceFileName(sliceIndex);
    const slicePath = path.join(sliceDir, sliceFileName);

    await sharp(processedBuffer)
      .extract({
        left: 0,
        top: y,
        width: finalWidth,
        height: sliceHeight,
      })
      .png({
        compressionLevel: 9,
        quality: 100,
      })
      .toFile(slicePath);

    slices.push({
      index: sliceIndex,
      fileName: sliceFileName,
      localPath: normalizePath(slicePath),
      width: finalWidth,
      height: sliceHeight,
      y,
    });

    console.log(
      `Created slice ${sliceIndex}: ${sliceFileName} (${finalWidth}x${sliceHeight})`
    );

    sliceIndex += 1;
  }

  const manifest = {
    sourceImagePath: normalizePath(inputPath),
    processedImagePath: normalizePath(processedImagePath),
    sliceDir: normalizePath(sliceDir),
    targetWidth,
    maxSliceHeight,
    finalWidth,
    finalHeight,
    totalSlices: slices.length,
    slices,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('Image processing complete.');
  console.log(`Saved processed image to: ${processedImagePath}`);
  console.log(`Saved slices to: ${sliceDir}`);
  console.log(`Saved slice manifest to: ${manifestPath}`);
  console.log(`Total slices created: ${slices.length}`);
}

run().catch((error) => {
  console.error('Image processing failed.');
  console.error(error.message);
  process.exit(1);
});