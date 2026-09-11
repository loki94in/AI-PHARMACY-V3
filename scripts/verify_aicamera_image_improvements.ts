import { catalogImageService } from '../src/services/catalogImageService.js';
import { hasFormulationModifierConflict, extractFormulationModifiers } from '../src/services/productNameFilterService.js';
import { dbManager } from '../src/database/connection.js';
import fs from 'fs';
import path from 'path';

console.log('='.repeat(80));
console.log('   VERIFYING AI CAMERA & CATALOG IMAGE MATCHER UPGRADES');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

// 1. Modifier Conflict Unit Checks
console.log('\n[1] Testing Formulation Modifier Conflict Engine:');
const dxVsLp = hasFormulationModifierConflict('APDROPS DX EYE DROPS', 'Apdrops Lp Bottle Of 5Ml Eye Drops');
assert(dxVsLp === true, `APDROPS DX vs Apdrops LP must conflict (got ${dxVsLp})`);

const chestonDVsCold = hasFormulationModifierConflict('CHESTON D', 'Cheston Cold And Flu Strip Of 10 Tablets');
assert(chestonDVsCold === true, `CHESTON D vs Cheston Cold & Flu must conflict (got ${chestonDVsCold})`);

const zocefVsCv = hasFormulationModifierConflict('ZOCEF 500', 'Zocef Cv 500Mg Strip Of 6 Tablets');
assert(zocefVsCv === true, `ZOCEF 500 vs Zocef CV must conflict (got ${zocefVsCv})`);

const plainMatch = hasFormulationModifierConflict('ZOCEF 500MG TABLET', 'Zocef 500Mg Strip Of 10 Tablets');
assert(plainMatch === false, `Plain ZOCEF 500 vs Zocef 500 must NOT conflict (got ${plainMatch})`);

// 2. computeConfidence Evaluation Checks
console.log('\n[2] Testing computeConfidence Hard Rejections on Suffix Mismatches:');
const scoreApdrops = catalogImageService.computeConfidence(
  { name: 'APDROPS DX EYE DROPS', manufacturer: 'AJANTA PHARMA LTD' },
  { name: 'Apdrops Lp Bottle Of 5Ml Eye Drops', manufacturer: 'AJANTA PHARMA LTD' }
);
assert(scoreApdrops.verificationStatus === 'REJECTED', `Apdrops DX vs LP status must be REJECTED (got ${scoreApdrops.verificationStatus})`);
assert(scoreApdrops.confidenceScore <= 25, `Apdrops DX vs LP score must be <= 25 (got ${scoreApdrops.confidenceScore})`);
assert(scoreApdrops.signals.modifierConflict === true, `Apdrops DX vs LP signals.modifierConflict must be true`);

const scoreCheston = catalogImageService.computeConfidence(
  { name: 'CHESTON D', manufacturer: 'CIPLA LIMITED' },
  { name: 'Cheston Cold And Flu Strip Of 10 Tablets', manufacturer: 'CIPLA LIMITED' }
);
assert(scoreCheston.verificationStatus === 'REJECTED', `CHESTON D vs Cheston Cold status must be REJECTED (got ${scoreCheston.verificationStatus})`);
assert(scoreCheston.signals.modifierConflict === true, `CHESTON D vs Cheston Cold signals.modifierConflict must be true`);

// 3. Packaging Face Prioritization Checks
console.log('\n[3] Testing Packaging Face Prioritization:');
const mockDamImages = [
  { face: 'box-front', url: 'https://cdn.example.com/zocef-box-front.jpg' },
  { face: 'front', url: 'https://cdn.example.com/zocef-blank-bubbles.jpg' },
  { face: 'combo', url: 'https://cdn.example.com/zocef-combo.jpg' },
  { face: 'back', url: 'https://cdn.example.com/zocef-foil-back.jpg' }
];

const stripChoice = catalogImageService.pickBestPackagingFace(
  'ZOCEF 500MG TABLET',
  '10 TABLETS',
  mockDamImages
);
assert(stripChoice !== null, `Must pick a packaging face`);
assert(stripChoice?.face === 'combo', `Solid oral strip must prioritize 'combo' over blank 'front' (got ${stripChoice?.face})`);
assert(stripChoice?.url === 'https://cdn.example.com/zocef-combo.jpg', `Must pick combo URL`);

const mockDamWithoutCombo = [
  { face: 'front', url: 'https://cdn.example.com/blank-front.jpg' },
  { face: 'back', url: 'https://cdn.example.com/printed-foil-back.jpg' }
];
const backChoice = catalogImageService.pickBestPackagingFace(
  'CALPOL 500 TAB',
  '15 TABLETS',
  mockDamWithoutCombo
);
assert(
  backChoice?.face === 'combo-stitched' && Boolean(backChoice?.stitchSecondaryUrl),
  `Strip with front and back must auto-combine into 'combo-stitched' (got ${backChoice?.face})`
);

// 4. Live DB & Disk Clean-up and Re-download
console.log('\n[4] Running Clean-up and Re-download Verification:');
async function testLiveFixes() {
  const db = await dbManager.getConnection();

  // Purge any bad Apdrops LP image previously saved for Apdrops DX (med ID 71503)
  const badApdropsImages = await db.all('SELECT * FROM catalog_images WHERE medicine_id = 71503');
  for (const img of badApdropsImages) {
    console.log(`  Purging old wrong image record #${img.id} for Apdrops DX: ${img.product_name}`);
    await db.run('DELETE FROM catalog_images WHERE id = ?', [img.id]);
    const fullPath = path.resolve('frontend/public', img.image_path.replace(/^\//, ''));
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log(`  Deleted bad image file from disk: ${fullPath}`);
    }
  }

  // Attempt search and download for APDROPS DX (ID 71503)
  console.log('\n  Re-testing search and download for APDROPS DX (ID 71503)...');
  const apdropsResult = await catalogImageService.searchAndDownloadCandidate(71503, 1);
  if (!apdropsResult) {
    console.log('  PASS: APDROPS DX correctly refused to download Apdrops LP (no wrong image accepted)');
    passed++;
  } else {
    console.log(`  CHECK: APDROPS DX downloaded: ${apdropsResult.product_name}`);
    assert(!apdropsResult.product_name.toUpperCase().includes(' LP'), 'Downloaded product must NOT be LP');
  }

  // Find ZOCEF 500 in DB
  const zocefMed = await db.get("SELECT * FROM medicines WHERE id = 286089 OR name = 'ZOCEF 500' LIMIT 1");
  if (zocefMed) {
    console.log(`\n  Re-testing search and download for ZOCEF 500 (ID ${zocefMed.id})...`);
    // Delete existing images for Zocef 500
    await db.run('DELETE FROM catalog_images WHERE medicine_id = ?', [zocefMed.id]);

    const zocefResult = await catalogImageService.searchAndDownloadCandidate(zocefMed.id, 1);
    assert(zocefResult !== null, `Zocef 500 must find an image`);
    if (zocefResult) {
      console.log(`  Zocef 500 downloaded product: "${zocefResult.product_name}"`);
      console.log(`  Image path: ${zocefResult.image_path}`);
      console.log(`  Image type: ${zocefResult.image_type}`);
      console.log(`  Source URL: ${zocefResult.source_url}`);
      assert(zocefResult.image_type === 'combined' || zocefResult.image_type === 'box' || zocefResult.image_type === 'back',
        `Zocef 500 image_type must be combined/box/back with visible text (got ${zocefResult.image_type})`
      );
      assert(!zocefResult.source_url?.includes('front-2'), `Must NOT be the blank front-2 bubble view`);
    }
  }

  // Test CHESTON D (ID 278825)
  console.log('\n  Re-testing search and download for CHESTON D (ID 278825)...');
  await db.run('DELETE FROM catalog_images WHERE medicine_id = 278825');
  const chestonResult = await catalogImageService.searchAndDownloadCandidate(278825, 1);
  if (chestonResult) {
    console.log(`  Cheston D downloaded product: "${chestonResult.product_name}"`);
    assert(!chestonResult.product_name.toUpperCase().includes('COLD'), 'Downloaded product must NOT be Cheston Cold');
  } else {
    console.log('  PASS: CHESTON D correctly refused to download Cheston Cold (no wrong variant accepted)');
    passed++;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(80));
  process.exit(failed > 0 ? 1 : 0);
}

testLiveFixes().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
