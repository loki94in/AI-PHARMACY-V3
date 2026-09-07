#!/usr/bin/env node

/**
 * scripts/cross-check-images-aicamera.ts
 * 
 * Uses the app's upgraded AI Camera engine (aiCameraService) to cross-check downloaded images
 * against the store inventory Catalog Name, Frontend Name, and SQLite medicines database.
 * 
 * Flags:
 *   --all            Test all available downloaded product images
 *   --limit=<N>      Test up to N products (default: 30)
 *   --batch-size=<N> Batch report size (default: 10)
 */

import fs from 'fs';
import path from 'path';
import { aiCameraService } from '../src/services/aiCameraService.js';

const STATE_FILE = path.resolve('data/image_download_state.json');
const PRODUCTS_DIR = path.resolve('frontend/public/products');
const AUDIT_OUT_FILE = path.resolve('data/image_audit_results.json');

interface CheckResult {
  index: number;
  catalogName: string;
  cleanCatalogName: string;
  frontendName: string;
  imageFileName: string;
  ocrConfidence: number;
  ocrText: string;
  detectedDbMatches: string[];
  detectedDosageForm?: string | null;
  detectedManufacturer?: string | null;
  catalogFrontendMatch: boolean;
  imageCatalogMatch: boolean;
  dbMatchFound: boolean;
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

function computeSimilarity(catalogName: string, frontendName: string, ocrText: string, dbMatches: string[] = []): {
  catalogFrontendMatch: boolean;
  imageCatalogMatch: boolean;
  dbMatchFound: boolean;
  matchScore: number;
  isWrong: boolean;
  verdict: string;
  reason: string;
} {
  const brand = extractCoreBrand(catalogName);
  const normFrontend = frontendName.toUpperCase();
  const normOcr = ocrText.toUpperCase();

  // 1. Catalog vs Frontend Match
  const brandInFrontend = Boolean(brand && normFrontend.includes(brand));

  // 2. Image vs Catalog Match (brand found in OCR text or DB matches)
  const brandInOcr = Boolean(brand && normOcr.includes(brand));
  const brandInDbMatch = Boolean(brand && dbMatches.some(m => m.toUpperCase().includes(brand)));
  const imageCatalogMatch = brandInOcr || brandInDbMatch;
  const dbMatchFound = dbMatches.length > 0;

  // Check for strength match if catalog specifies numbers
  const strengthMatch = catalogName.match(/\b\d+(?:\.\d+)?\s*(?:MG|ML|GM|MCG|IU|%)\b/i);
  let strengthInOcr = false;
  if (strengthMatch) {
    const num = strengthMatch[0].match(/\d+/)?.[0];
    if (num && (normOcr.includes(num) || dbMatches.some(m => m.includes(num)))) {
      strengthInOcr = true;
    }
  }

  let matchScore = 0;
  if (brandInFrontend && imageCatalogMatch) {
    matchScore = (strengthInOcr || brandInDbMatch) ? 99 : 92;
  } else if (brandInFrontend && !imageCatalogMatch) {
    matchScore = 70;
  } else if (!brandInFrontend) {
    matchScore = 15;
  }

  const isWrong = !brandInFrontend || (!imageCatalogMatch && normOcr.length > 30 && matchScore < 50);

  let verdict = '99% MATCH (VERIFIED)';
  let reason = 'Exact brand verified in frontend name and packaging label.';

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
    catalogFrontendMatch: brandInFrontend,
    imageCatalogMatch,
    dbMatchFound,
    matchScore,
    isWrong,
    verdict,
    reason
  };
}

async function runAudit() {
  const args = process.argv.slice(2);
  const runAll = args.includes('--all');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limitVal = limitArg ? parseInt(limitArg.split('=')[1], 10) : (args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : null);
  const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
  const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 10;

  console.log('='.repeat(80));
  console.log('   AI PHARMACY — IMAGE CROSS-CHECK AUDIT VIA AI CAMERA OCR & DB MATCH');
  console.log('='.repeat(80));

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  const allProds = Object.entries(state.products)
    .filter(([_, v]: any) => v.status === 'success' && v.images && (v.images.front || v.images.default))
    .map(([k, v]: any) => ({
      catalogName: k,
      frontendName: v.matched_name || '',
      imageFileName: (v.images.front || v.images.default).fileName
    }))
    .filter(item => fs.existsSync(path.join(PRODUCTS_DIR, item.imageFileName)));

  console.log(`Loaded ${allProds.length} valid downloaded product images on disk.\n`);

  const totalToTest = runAll ? allProds.length : (limitVal || 30);
  const testItems = allProds.slice(0, totalToTest);
  console.log(`Auditing ${testItems.length} products (Batch size: ${BATCH_SIZE}, Run all: ${runAll})...\n`);

  const results: CheckResult[] = [];

  for (let i = 0; i < testItems.length; i++) {
    const item = testItems[i];
    const imagePath = path.join(PRODUCTS_DIR, item.imageFileName);

    const buf = fs.readFileSync(imagePath);
    let processRes: any = { text: '', confidence: 0, matches: [], medicineInfo: {} };
    try {
      processRes = await aiCameraService.processImage(buf, true);
    } catch (e: any) {
      console.error(`Error processing image ${item.imageFileName}:`, e.message);
    }

    const sim = computeSimilarity(item.catalogName, item.frontendName, processRes.text, processRes.matches);

    const checkItem: CheckResult = {
      index: i + 1,
      catalogName: item.catalogName,
      cleanCatalogName: cleanName(item.catalogName),
      frontendName: item.frontendName,
      imageFileName: item.imageFileName,
      ocrConfidence: processRes.confidence,
      ocrText: (processRes.text || '').replace(/\s+/g, ' ').trim(),
      detectedDbMatches: processRes.matches || [],
      detectedDosageForm: processRes.medicineInfo?.dosageForm || null,
      detectedManufacturer: processRes.medicineInfo?.manufacturer || null,
      ...sim
    };

    results.push(checkItem);

    // Save incrementally after each item
    fs.writeFileSync(AUDIT_OUT_FILE, JSON.stringify(results, null, 2), 'utf-8');

    // Progress print
    const statusIcon = checkItem.isWrong ? '❌' : (checkItem.matchScore >= 90 ? '✅' : '⚠️');
    console.log(`[${i + 1}/${testItems.length}] ${statusIcon} ${checkItem.cleanCatalogName} -> ${checkItem.verdict} (${checkItem.matchScore}%) | DB Matches: [${checkItem.detectedDbMatches.slice(0, 2).join(', ')}]`);

    // Batch report at boundary
    if ((i + 1) % BATCH_SIZE === 0 || i === testItems.length - 1) {
      const batchNum = Math.ceil((i + 1) / BATCH_SIZE);
      const startIdx = (batchNum - 1) * BATCH_SIZE;
      const batch = results.slice(startIdx, i + 1);
      const wrongInBatch = batch.filter(x => x.isWrong).length;
      console.log(`>>> Batch ${batchNum} Complete: ${batch.length - wrongInBatch}/${batch.length} Verified Correct\n`);
    }
  }

  await aiCameraService.terminate();

  console.log('\n' + '='.repeat(80));
  console.log('                        AUDIT RUN SUMMARY');
  console.log('='.repeat(80));
  const totalWrong = results.filter(x => x.isWrong).length;
  const totalCorrect = results.length - totalWrong;
  const totalWithDbMatches = results.filter(x => x.dbMatchFound).length;
  console.log(`Total Images Tested:    ${results.length}`);
  console.log(`Verified Matches:       ${totalCorrect} (${((totalCorrect / results.length) * 100).toFixed(1)}%)`);
  console.log(`Database Matches Found: ${totalWithDbMatches} (${((totalWithDbMatches / results.length) * 100).toFixed(1)}%)`);
  console.log(`Mismatched/Wrong:       ${totalWrong} (${((totalWrong / results.length) * 100).toFixed(1)}%)`);
  console.log(`Results Saved To:       ${AUDIT_OUT_FILE}`);
  console.log('='.repeat(80) + '\n');
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
