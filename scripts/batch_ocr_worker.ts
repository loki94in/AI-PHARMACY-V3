#!/usr/bin/env node

/**
 * scripts/batch_ocr_worker.ts
 *
 * Stage 2: Pure Offline Local Batch OCR Worker
 * - Reads downloaded images with status 'PENDING_OCR' from SQLite.
 * - Processes images in batches of 10 using local ONNX PaddleOCR + Tesseract.js.
 * - Extracts printed brand name, dosage form, and strength.
 * - Evaluates multi-signal verification score and updates database to:
 *     'HIGH_CONFIDENCE' or 'PENDING_REVIEW'
 * - 100% Offline: ZERO Gemini API keys used.
 *
 * Usage:
 *   npx tsx scripts/batch_ocr_worker.ts
 *   npx tsx scripts/batch_ocr_worker.ts --batch-size=10 --watch
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { aiCameraService } from '../src/services/aiCameraService.js';
import { eventService } from '../src/services/eventService.js';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Parse CLI Flags
const args = process.argv.slice(2);
let batchSize = 10;
let watchMode = false;

for (const a of args) {
  if (a.startsWith('--batch-size=')) batchSize = parseInt(a.split('=')[1], 10);
  if (a === '--watch') watchMode = true;
}

function cleanTokens(s: string): string[] {
  return (s || '')
    .toUpperCase()
    .replace(/\[.*?\]/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

function extractStrengthToken(name: string): string | null {
  const m = name.match(/\b\d+(?:\.\d+)?\s*(?:MG|ML|GM|MCG|IU|%)\b/i);
  return m ? m[0].replace(/\s+/g, '').toUpperCase() : null;
}

async function processSingleImage(imgRow: any, medRow: any): Promise<{
  status: 'HIGH_CONFIDENCE' | 'PENDING_REVIEW' | 'REJECTED';
  confidence: number;
  extractedBrand: string;
  extractedStrength: string;
  ocrSnippet: string;
}> {
  const diskPath = path.resolve(ROOT_DIR, 'frontend/public', imgRow.image_path.replace(/^\//, ''));
  if (!fs.existsSync(diskPath)) {
    return {
      status: 'REJECTED',
      confidence: 0,
      extractedBrand: 'File missing',
      extractedStrength: 'N/A',
      ocrSnippet: 'Disk file not found'
    };
  }

  const imgBuffer = fs.readFileSync(diskPath);
  const rawOcr = await aiCameraService.extractRawText(imgBuffer);
  const cleanOcr = rawOcr.toUpperCase();
  const ocrSnippet = rawOcr.slice(0, 100).replace(/\s+/g, ' ');

  const targetName = (medRow?.name || imgRow.product_name || '').toUpperCase();
  const targetTokens = cleanTokens(targetName);
  const targetBrand = targetTokens[0] || '';
  const targetStrength = extractStrengthToken(targetName) || (medRow?.strength ? extractStrengthToken(medRow.strength) : null);

  const brandFound = Boolean(targetBrand && cleanOcr.includes(targetBrand));

  let strengthFound = false;
  let strengthConflict = false;
  if (targetStrength) {
    const numOnly = targetStrength.match(/\d+(?:\.\d+)?/)?.[0];
    if (numOnly && cleanOcr.includes(numOnly)) {
      strengthFound = true;
    }
    // Check conflicting strength numbers (e.g. target 500 vs OCR only seeing 250)
    const ocrStrengths = cleanOcr.match(/\b\d+(?:\.\d+)?\s*(?:MG|ML|GM|MCG|IU|%)\b/g) || [];
    if (ocrStrengths.length > 0) {
      const normalizedOcr = ocrStrengths.map(s => s.replace(/\s+/g, ''));
      if (!normalizedOcr.includes(targetStrength) && numOnly && !normalizedOcr.some(s => s.includes(numOnly))) {
        strengthConflict = true;
      }
    }
  }

  let confidence = 50;
  let status: 'HIGH_CONFIDENCE' | 'PENDING_REVIEW' | 'REJECTED' = 'PENDING_REVIEW';

  if (strengthConflict) {
    confidence = 35;
    status = 'PENDING_REVIEW';
  } else if (brandFound && strengthFound) {
    confidence = 98;
    status = 'HIGH_CONFIDENCE';
  } else if (brandFound) {
    confidence = 88;
    status = 'HIGH_CONFIDENCE';
  } else if (cleanOcr.length > 30) {
    confidence = 65;
    status = 'PENDING_REVIEW';
  }

  return {
    status,
    confidence,
    extractedBrand: brandFound ? targetBrand : 'Unconfirmed',
    extractedStrength: strengthFound ? (targetStrength || 'Verified') : (strengthConflict ? 'CONFLICT' : 'Unconfirmed'),
    ocrSnippet
  };
}

async function runBatch(): Promise<number> {
  // Query pending images
  const pendingRows = db.prepare(`
    SELECT ci.*, m.name as medicine_name, m.strength as medicine_strength, m.manufacturer as medicine_manufacturer
    FROM catalog_images ci
    LEFT JOIN medicines m ON ci.medicine_id = m.id
    WHERE ci.verification_status = 'PENDING_OCR'
    ORDER BY ci.id ASC
    LIMIT ?
  `).all(batchSize) as any[];

  if (pendingRows.length === 0) return 0;

  console.log(`\n======================================================================`);
  console.log(`🧠 RUNNING LOCAL ONNX BATCH OCR (${pendingRows.length} IMAGES)`);
  console.log(`======================================================================`);

  const updateStmt = db.prepare(`
    UPDATE catalog_images
    SET verification_status = ?,
        confidence_score = ?,
        ocr_text = ?,
        is_active = ?,
        verified_by = 'local_onnx_ocr',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const batchResults: any[] = [];
  const batchStart = Date.now();

  for (let i = 0; i < pendingRows.length; i++) {
    const row = pendingRows[i];
    const medName = row.medicine_name || row.product_name || `ID ${row.medicine_id}`;
    const t0 = Date.now();

    process.stdout.write(`[${i + 1}/${pendingRows.length}] OCR Scanning: "${medName.slice(0, 32)}"... `);

    try {
      const res = await processSingleImage(row, {
        name: row.medicine_name,
        strength: row.medicine_strength,
        manufacturer: row.medicine_manufacturer
      });

      const isActive = res.status === 'HIGH_CONFIDENCE' ? 1 : 0;
      updateStmt.run(res.status, res.confidence, res.ocrSnippet, isActive, row.id);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`✅ ${res.status} (${res.confidence}%) [${elapsed}s]`);

      batchResults.push({
        Medicine: medName.slice(0, 30),
        Status: res.status,
        Confidence: `${res.confidence}%`,
        'Extracted Brand': res.extractedBrand,
        'Strength Check': res.extractedStrength,
        Time: `${elapsed}s`
      });

      // Broadcast SSE update so UI refreshes live
      eventService.broadcast('catalog_image_updated', {
        id: row.id,
        medicine_id: row.medicine_id,
        status: res.status,
        confidence: res.confidence
      });
    } catch (err: any) {
      console.log(`❌ ERROR: ${err.message}`);
    }
  }

  const batchTotal = ((Date.now() - batchStart) / 1000).toFixed(1);
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`📊 BATCH COMPLETED IN ${batchTotal}s (Avg ${(parseFloat(batchTotal) / pendingRows.length).toFixed(1)}s/item)`);
  console.log(`----------------------------------------------------------------------`);
  console.table(batchResults);

  return pendingRows.length;
}

async function main() {
  console.log('='.repeat(80));
  console.log('   AI PHARMACY — LOCAL OFFLINE BATCH OCR WORKER (ONNX PADDLEOCR)');
  console.log('='.repeat(80));

  await aiCameraService.initialize();

  if (watchMode) {
    console.log('👁️ Watch Mode Active: Polling for new PENDING_OCR images every 3 seconds...\n');
    while (true) {
      const processed = await runBatch();
      if (processed === 0) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  } else {
    let totalProcessed = 0;
    while (true) {
      const count = await runBatch();
      totalProcessed += count;
      if (count === 0) break;
    }
    console.log(`\n🎉 All pending images processed! Total OCR scans completed: ${totalProcessed}\n`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error in batch OCR worker:', err);
  process.exit(1);
});
