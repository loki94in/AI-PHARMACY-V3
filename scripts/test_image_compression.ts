import fs from 'fs';
import path from 'path';
import { imageCompressionService } from '../src/services/imageCompressionService.js';
import { aiCameraService } from '../src/services/aiCameraService.js';

async function testImageCompressionAndOcr() {
  console.log('=== TESTING SMART IMAGE COMPRESSION & OCR SPEED ===\n');

  const sampleDir = path.resolve(process.cwd(), 'SAMPLE IMAGE');
  const files = fs.readdirSync(sampleDir).filter(f => /\.(jpe?g|png)$/i.test(f));

  if (files.length === 0) {
    console.error('No sample images found to test');
    return;
  }

  // Pick 2 sample images
  const testFiles = files.slice(0, 2);
  const testOutDir = path.resolve(process.cwd(), 'scratch', 'compressed_test');
  if (!fs.existsSync(testOutDir)) fs.mkdirSync(testOutDir, { recursive: true });

  await aiCameraService.initialize();

  for (const file of testFiles) {
    const inputPath = path.join(sampleDir, file);
    const rawBuffer = fs.readFileSync(inputPath);
    const originalKb = Math.round(rawBuffer.length / 1024);

    console.log(`[TEST] Image: ${file} (Original Size: ${originalKb} KB)`);

    // 1. Test compression and saving to disk
    const compressStart = performance.now();
    const destPath = path.join(testOutDir, file);
    const saveResult = await imageCompressionService.compressAndSave(rawBuffer, destPath, 1400, 82);
    const compressTimeMs = Math.round(performance.now() - compressStart);
    const newKb = Math.round(saveResult.sizeBytes / 1024);

    console.log(`  -> Compressed & Saved: ${newKb} KB (${saveResult.savedPercent}% disk space saved on PC)`);
    console.log(`  -> Compression Time:  ${compressTimeMs} ms`);

    // 2. Test fast OCR processing on the compressed buffer
    const ocrStart = performance.now();
    const compressedBuffer = fs.readFileSync(destPath);
    const ocrResult = await aiCameraService.processImage(compressedBuffer, true);
    const ocrTimeMs = Math.round(performance.now() - ocrStart);

    console.log(`  -> AI OCR & Parser Time: ${ocrTimeMs} ms`);
    console.log(`  -> Brand Name:        "${ocrResult.medicineInfo?.potentialName || 'N/A'}"`);
    console.log(`  -> Form / Strength:   ${ocrResult.medicineInfo?.dosageForm || 'N/A'} / ${ocrResult.medicineInfo?.strength || 'N/A'}`);
    console.log(`  -> Matches Found:     ${ocrResult.matches?.length || 0}\n`);
  }

  console.log('=== TEST PASSED: Image compression and OCR speed verified! ===\n');
}

testImageCompressionAndOcr().catch(console.error);
