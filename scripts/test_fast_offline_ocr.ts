import fs from 'fs';
import { Jimp } from 'jimp';
import { createWorker, PSM } from 'tesseract.js';

async function benchmarkFastOfflineOcr() {
  console.log('--- Benchmarking Resized Offline Tesseract OCR ---');
  const t0 = Date.now();

  // 1. Read & resize with Jimp to max 1400px (fastest sweet spot for clarity vs speed)
  const rawBuf = fs.readFileSync('SAMPLE IMAGE/IMG_8548.JPEG');
  const img = await Jimp.read(rawBuf);
  console.log(`Original size: ${img.bitmap.width}x${img.bitmap.height}`);
  
  const maxDim = 1400;
  if (img.bitmap.width > maxDim || img.bitmap.height > maxDim) {
    if (img.bitmap.width > img.bitmap.height) {
      img.resize({ w: maxDim });
    } else {
      img.resize({ h: maxDim });
    }
  }
  console.log(`Resized to: ${img.bitmap.width}x${img.bitmap.height}`);

  // Enhance contrast & greyscale
  img.greyscale().contrast(0.3);
  const processedBuf = await img.getBuffer('image/jpeg');
  console.log(`Preprocessing took: ${Date.now() - t0}ms`);

  // 2. Run Tesseract with local eng.traineddata
  const tWorker = Date.now();
  const worker = await createWorker('eng', 1, {
    langPath: process.cwd(),
    gzip: false
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // Uniform block of text (much faster than 11)
  });

  const tRec = Date.now();
  const { data } = await worker.recognize(processedBuf);
  console.log(`OCR recognition took: ${Date.now() - tRec}ms`);
  console.log(`Total elapsed: ${Date.now() - t0}ms`);

  console.log('\n--- OCR TEXT DETECTED ---');
  console.log(data.text);

  await worker.terminate();
}

benchmarkFastOfflineOcr().catch(console.error);
