import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const TEST_IMAGES = [
  'telista-mt-25mg-tablet-front.jpg',
  'cefolac-cv-100625-mg-tablet-dt-6-front.jpg',
  'alphadopa-l-strip-of-10-tablets-front.jpg',
  'zipvit-syrup-200-ml-front.jpg',
  'globac-z-strip-of-60-capsules-box-front.jpg',
  'florita-strip-of-10-capsules-box-front.jpg',
  'evacure-strip-of-10-tablets-box-front.jpg',
  'clopilet-a-150mg-strip-of-10-capsules-box-front.jpg',
  'zen-400mg-tab-front.jpg',
  'canvaz-gel-front.jpg'
];

const PRODUCTS_DIR = 'E:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/frontend/public/products';

async function run() {
  console.log('===============================================================');
  console.log('       AI CAMERA REAL-TIME 10-MEDICINE SCAN TEST REPORT');
  console.log('===============================================================\n');

  const servicePath = pathToFileURL('E:/CURRENT PROJECT ON WORKING/AI PHARMACY v2/src/services/aiCameraService.js').href;
  const { aiCameraService } = await import(servicePath);

  await aiCameraService.loadDatabaseIgnoreList();

  const results: any[] = [];

  for (let i = 0; i < TEST_IMAGES.length; i++) {
    const filename = TEST_IMAGES[i];
    const filePath = path.join(PRODUCTS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      console.log(`[${i + 1}/10] Missing file: ${filename}`);
      continue;
    }

    console.log(`--- [${i + 1}/10] Scanning: ${filename} ---`);
    const fileBuf = fs.readFileSync(filePath);
    const start = Date.now();

    try {
      // skipEnrichment = true for pure real-time local OCR + Visual + Filter scanning
      const scanResult = await aiCameraService.processImage(fileBuf, true);
      const elapsed = Date.now() - start;

      const topMatch = scanResult.matches && scanResult.matches.length > 0 ? scanResult.matches[0] : 'No Match Found';
      const dosageForm = scanResult.detectedDosageForm || 'Unknown';
      const detectedApi = scanResult.detectedApi || 'None';

      results.push({
        num: i + 1,
        filename,
        elapsed: `${elapsed}ms`,
        dosageForm,
        detectedApi,
        topMatch,
        allMatches: (scanResult.matches || []).slice(0, 3)
      });

      console.log(`  ⏱️ Speed: ${elapsed}ms`);
      console.log(`  💊 Detected Form: ${dosageForm}`);
      console.log(`  🧪 Detected API: ${detectedApi}`);
      console.log(`  🎯 Top Match: ${topMatch}`);
      console.log(`  📋 Candidates: ${(scanResult.matches || []).slice(0, 3).join(' | ')}\n`);
    } catch (err: any) {
      console.error(`  ❌ Error processing ${filename}:`, err.message);
    }
  }

  console.log('\n===============================================================');
  console.log('                   FINAL SUMMARY REPORT');
  console.log('===============================================================');
  for (const r of results) {
    console.log(`[#${r.num}] File: ${r.filename}`);
    console.log(`     Detected Form: ${r.dosageForm} | API: ${r.detectedApi} | Scan Time: ${r.elapsed}`);
    console.log(`     🎯 AI Camera Top Match: ${r.topMatch}`);
    console.log('---------------------------------------------------------------');
  }

  process.exit(0);
}

run().catch(console.error);
