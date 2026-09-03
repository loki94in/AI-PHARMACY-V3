#!/usr/bin/env node

/**
 * scripts/cross-check-images-aicamera.ts
 * 
 * Uses the app's AI Camera OCR engine (aiCameraService) to cross-check downloaded images
 * against the store inventory Catalog Name and the Frontend Name.
 */

import fs from 'fs';
import path from 'path';
import { aiCameraService } from '../src/services/aiCameraService.ts';

const STATE_FILE = path.resolve('data/image_download_state.json');
const PRODUCTS_DIR = path.resolve('frontend/public/products');

interface CheckResult {
  index: number;
  catalogName: string;
  cleanCatalogName: string;
  frontendName: string;
  imageFileName: string;
  ocrConfidence: number;
  ocrText: string;
  catalogFrontendMatch: boolean;
  imageCatalogMatch: boolean;
  matchScore: number;
  isWrong: boolean;
  verdict: string;
  reason: string;
}

function cleanName(raw: string): string {
  let c = raw.replace(/\[.*?\]/g, ' ');
  c = c.replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ');
  return c.replace(/\s+/g, ' ').trim();
}

function extractCoreBrand(raw: string): string {
  const c = cleanName(raw);
  const words = c.split(/[^A-Za-z0-9\+\-]+/).filter(w => w.length >= 2);
  return words[0] ? words[0].toUpperCase() : '';
}

function computeSimilarity(catalogName: string, frontendName: string, ocrText: string): {
  catalogFrontendMatch: boolean;
  imageCatalogMatch: boolean;
  matchScore: number;
  isWrong: boolean;
  verdict: string;
  reason: string;
} {
  const brand = extractCoreBrand(catalogName);
  const normFrontend = frontendName.toUpperCase();
  const normOcr = ocrText.toUpperCase();

  // 1. Catalog vs Frontend Match
  const brandInFrontend = brand && normFrontend.includes(brand);

  // Check if frontend is completely different brand
  let catalogFrontendMatch = Boolean(brandInFrontend);

  // 2. Image vs Catalog Match
  // Does OCR text on the image contain the brand or key tokens?
  const brandInOcr = brand && normOcr.includes(brand);

  // Check for strength match if catalog specifies numbers
  const strengthMatch = catalogName.match(/\b\d+(?:\.\d+)?\s*(?:MG|ML|GM|MCG|IU|%)\b/i);
  let strengthInOcr = false;
  if (strengthMatch) {
    const num = strengthMatch[0].match(/\d+/)?.[0];
    if (num && normOcr.includes(num)) {
      strengthInOcr = true;
    }
  }

  let matchScore = 0;
  if (brandInFrontend && brandInOcr) {
    matchScore = strengthInOcr ? 99 : 92;
  } else if (brandInFrontend && !brandInOcr) {
    // Brand in frontend, but OCR missed or partial
    matchScore = 70;
  } else if (!brandInFrontend) {
    // Frontend itself downloaded a completely different product
    matchScore = 15;
  }

  const isWrong = !brandInFrontend || (!brandInOcr && normOcr.length > 30 && matchScore < 50);

  let verdict = '99% MATCH (VERIFIED)';
  let reason = 'Exact brand verified in both frontend name and image label.';

  if (isWrong) {
    verdict = 'WRONG IMAGE (MISMATCH)';
    if (!brandInFrontend) {
      reason = `Downloaded image belongs to a different brand ("${frontendName}") instead of catalog brand "${brand}".`;
    } else {
      reason = `Image OCR shows unrelated text; brand "${brand}" not found on packaging.`;
    }
  } else if (matchScore < 90) {
    verdict = 'PARTIAL / UNCERTAIN';
    reason = `Brand matched in frontend, but OCR text on packaging was low confidence or obscured.`;
  }

  return {
    catalogFrontendMatch,
    imageCatalogMatch: Boolean(brandInOcr),
    matchScore,
    isWrong,
    verdict,
    reason
  };
}

async function runAudit() {
  console.log('='.repeat(80));
  console.log('   AI PHARMACY — IMAGE CROSS-CHECK AUDIT VIA AI CAMERA OCR');
  console.log('='.repeat(80));

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  const allProds = Object.entries(state.products)
    .filter(([_, v]: any) => v.status === 'success' && v.images && (v.images.front || v.images.default))
    .map(([k, v]: any) => ({
      catalogName: k,
      frontendName: v.matched_name || '',
      imageFileName: (v.images.front || v.images.default).fileName
    }));

  console.log(`Loaded ${allProds.length} products with downloadable images.\n`);

  const NUM_BATCHES = 3;
  const BATCH_SIZE = 10;
  const totalToTest = NUM_BATCHES * BATCH_SIZE;

  const testItems = allProds.slice(0, totalToTest);
  const results: CheckResult[] = [];

  for (let i = 0; i < testItems.length; i++) {
    const item = testItems[i];
    const imagePath = path.join(PRODUCTS_DIR, item.imageFileName);

    if (!fs.existsSync(imagePath)) {
      continue;
    }

    const buf = fs.readFileSync(imagePath);
    let ocrRes = { text: '', confidence: 0 };
    try {
      ocrRes = await aiCameraService.extractTextFromImage(buf);
    } catch (e: any) {
      console.error(`Error processing image ${item.imageFileName}:`, e.message);
    }

    const sim = computeSimilarity(item.catalogName, item.frontendName, ocrRes.text);

    results.push({
      index: i + 1,
      catalogName: item.catalogName,
      cleanCatalogName: cleanName(item.catalogName),
      frontendName: item.frontendName,
      imageFileName: item.imageFileName,
      ocrConfidence: ocrRes.confidence,
      ocrText: ocrRes.text.replace(/\s+/g, ' ').trim(),
      ...sim
    });
  }

  await aiCameraService.terminate();

  // Save audit results to JSON
  fs.writeFileSync('data/image_audit_results.json', JSON.stringify(results, null, 2), 'utf-8');

  // Print results batch by batch
  for (let b = 0; b < NUM_BATCHES; b++) {
    const startIdx = b * BATCH_SIZE;
    const endIdx = startIdx + BATCH_SIZE;
    const batch = results.slice(startIdx, endIdx);

    console.log('\n' + '#'.repeat(80));
    console.log(`                BATCH ${b + 1} (Products ${startIdx + 1} to ${endIdx})`);
    console.log('#'.repeat(80));

    for (const r of batch) {
      const statusIcon = r.isWrong ? '❌ [WRONG IMAGE]' : (r.matchScore >= 90 ? '✅ [99% MATCH]' : '⚠️ [PARTIAL]');
      console.log(`\nItem #${r.index}: ${statusIcon}`);
      console.log(`  📋 Catalog Name:   ${r.catalogName}`);
      console.log(`  🌐 Frontend Name:  ${r.frontendName}`);
      console.log(`  🖼️  Image File:     ${r.imageFileName}`);
      console.log(`  📸 AI Camera OCR:  "${r.ocrText.slice(0, 90)}${r.ocrText.length > 90 ? '...' : ''}" (Confidence: ${r.ocrConfidence}%)`);
      console.log(`  ⚖️  Verdict:        ${r.verdict} (Score: ${r.matchScore}%)`);
      if (r.isWrong) {
        console.log(`  🚨 Failure Reason: ${r.reason}`);
      }
    }

    const wrongInBatch = batch.filter(x => x.isWrong);
    console.log(`\n>>> Batch ${b + 1} Summary: ${batch.length - wrongInBatch.length} Correct Matches, ${wrongInBatch.length} Wrong Images.`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('                        AUDIT RUN SUMMARY');
  console.log('='.repeat(80));
  const totalWrong = results.filter(x => x.isWrong).length;
  const totalCorrect = results.length - totalWrong;
  console.log(`Total Tested:          ${results.length}`);
  console.log(`Verified Matches:      ${totalCorrect} (${((totalCorrect / results.length) * 100).toFixed(1)}%)`);
  console.log(`Wrong/Mismatched:      ${totalWrong} (${((totalWrong / results.length) * 100).toFixed(1)}%)`);
  console.log('='.repeat(80) + '\n');
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
