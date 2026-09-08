#!/usr/bin/env node

/**
 * scripts/audit_and_correct_catalog_images.mjs
 * 
 * Comprehensive Catalog Product Image Audit & Correction Engine:
 * 1. Audits each and every product image in catalog_images against medicines in SQLite.
 * 2. Uses strict multi-signal validation (brand match without circular path leak,
 *    dosage form compatibility, strength verification, file existence).
 * 3. Deactivates and marks as REJECTED any wrong images.
 * 4. Cleans image_download_state.json so wrong items are purged from customer portal.
 * 5. Re-searches genuine pharmaceutical image repository with clean queries & strict brand filters
 *    to download and install genuine images for corrected items.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { catalogImageService } from '../src/services/catalogImageService.js';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'image_download_state.json');
const TARGET_FRONTEND = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(ROOT_DIR, 'uploads', 'products');

fs.mkdirSync(TARGET_FRONTEND, { recursive: true });
fs.mkdirSync(TARGET_UPLOADS, { recursive: true });

const db = new Database(DB_PATH);

console.log('===========================================================');
console.log('--- STEP 1: AUDITING ALL ACTIVE CATALOG PRODUCT IMAGES ---');
console.log('===========================================================');

const rows = db.prepare(`
  SELECT ci.id, ci.medicine_id, ci.product_name, ci.image_path, ci.company_name, 
         ci.verification_status, ci.confidence_score, ci.is_active, ci.is_primary,
         m.name as med_name, m.manufacturer as med_mfg, m.strength as med_strength, m.packaging as med_packaging
  FROM catalog_images ci
  JOIN medicines m ON m.id = ci.medicine_id
  WHERE ci.is_active = 1
`).all();

console.log(`Found ${rows.length} active images in database to evaluate.`);

const toDeactivate = [];
let dosageFormConflicts = 0;
let strengthConflicts = 0;
let brandMismatches = 0;
let missingFiles = 0;

for (const r of rows) {
  // Check file existence
  const cleanRel = r.image_path ? r.image_path.replace(/^\/+/, '') : '';
  const p1 = path.resolve('frontend/public', cleanRel);
  const p2 = path.resolve(cleanRel);
  const p3 = path.resolve('frontend/public/products', path.basename(cleanRel));
  const p4 = path.resolve('uploads/products', path.basename(cleanRel));
  const exists = (fs.existsSync(p1) && fs.statSync(p1).size > 0) ||
                 (fs.existsSync(p2) && fs.statSync(p2).size > 0) ||
                 (fs.existsSync(p3) && fs.statSync(p3).size > 0) ||
                 (fs.existsSync(p4) && fs.statSync(p4).size > 0);

  if (!exists) {
    missingFiles++;
    toDeactivate.push({
      id: r.id,
      med_id: r.medicine_id,
      med_name: r.med_name,
      prod_name: r.product_name,
      reason: '[AUTO-AUDIT REJECTED] Image file missing or 0 bytes on disk',
      type: 'FILE_MISSING'
    });
    continue;
  }

  const match = catalogImageService.computeConfidence(
    {
      name: r.med_name,
      manufacturer: r.med_mfg || r.company_name,
      strength: r.med_strength,
      packaging: r.med_packaging
    },
    {
      name: r.product_name,
      manufacturer: r.company_name || r.med_mfg,
      imagePath: r.image_path
    }
  );

  if (match.signals.dosageFormConflict) {
    dosageFormConflicts++;
    toDeactivate.push({
      id: r.id,
      med_id: r.medicine_id,
      med_name: r.med_name,
      prod_name: r.product_name,
      reason: `[AUTO-AUDIT REJECTED] ${match.reason}`,
      type: 'DOSAGE_CONFLICT'
    });
  } else if (match.signals.strengthConflict) {
    strengthConflicts++;
    toDeactivate.push({
      id: r.id,
      med_id: r.medicine_id,
      med_name: r.med_name,
      prod_name: r.product_name,
      reason: `[AUTO-AUDIT REJECTED] ${match.reason}`,
      type: 'STRENGTH_CONFLICT'
    });
  } else if (!match.signals.brandMatch) {
    brandMismatches++;
    toDeactivate.push({
      id: r.id,
      med_id: r.medicine_id,
      med_name: r.med_name,
      prod_name: r.product_name,
      reason: `[AUTO-AUDIT REJECTED] ${match.reason}`,
      type: 'BRAND_MISMATCH'
    });
  }
}

console.log(`\nAudit identified ${toDeactivate.length} WRONG / MISMATCHED images:`);
console.log(` - Brand Mismatches:      ${brandMismatches}`);
console.log(` - Strength Conflicts:     ${strengthConflicts}`);
console.log(` - Dosage Form Conflicts:  ${dosageFormConflicts}`);
console.log(` - Missing / Empty Files:  ${missingFiles}`);

console.log('\n===========================================================');
console.log('--- STEP 2: DEACTIVATING WRONG IMAGES IN DATABASE ---');
console.log('===========================================================');

const deactivateStmt = db.prepare(`
  UPDATE catalog_images
  SET is_active = 0,
      is_primary = 0,
      verification_status = 'REJECTED',
      confidence_score = 30,
      verification_reason = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const historyStmt = db.prepare(`
  INSERT INTO image_review_history (
    product_image_id, medicine_id, previous_status, new_status, action, reason, performed_by
  ) VALUES (?, ?, 'APPROVED', 'REJECTED', 'AUTO_AUDIT_PURGE', ?, 'audit_engine')
`);

const deactTx = db.transaction((items) => {
  for (const item of items) {
    deactivateStmt.run(item.reason, item.id);
    try {
      historyStmt.run(item.id, item.med_id, item.reason);
    } catch {}
  }
});

deactTx(toDeactivate);
console.log(`Successfully deactivated ${toDeactivate.length} wrong images in database.`);

console.log('\n===========================================================');
console.log('--- STEP 3: PURGING WRONG ENTRIES FROM DOWNLOAD STATE ---');
console.log('===========================================================');

let statePurgedCount = 0;
if (fs.existsSync(STATE_FILE)) {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const deactMedNames = new Set(toDeactivate.map(i => i.med_name.trim().toUpperCase()));

  for (const [key, p] of Object.entries(state.products || {})) {
    const cleanKey = key.replace(/\[.*?\]/g, '').trim().toUpperCase();
    if (deactMedNames.has(key.trim().toUpperCase()) || deactMedNames.has(cleanKey)) {
      state.products[key] = {
        status: 'purged_incorrect',
        matched_name: null,
        purged_previous_match: p.matched_name,
        updated_at: new Date().toISOString()
      };
      statePurgedCount++;
    }
  }

  state.last_updated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  console.log(`Purged ${statePurgedCount} incorrect match entries from data/image_download_state.json.`);
}

console.log('\n===========================================================');
console.log('--- STEP 4: RE-SEARCH & CORRECTION FOR AFFECTED PRODUCTS ---');
console.log('===========================================================');

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

async function downloadImage(url, destPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

// Extract distinct medicines that were deactivated and need genuine images
const distinctMedsMap = new Map();
for (const item of toDeactivate) {
  if (!distinctMedsMap.has(item.med_id)) {
    distinctMedsMap.set(item.med_id, item);
  }
}

console.log(`Attempting to find genuine accurate images for ${distinctMedsMap.size} affected medicines...`);

let correctedCount = 0;

// Re-search top affected items
const medsToRetry = Array.from(distinctMedsMap.values()).slice(0, 30);

for (const m of medsToRetry) {
  const cleanName = m.med_name.replace(/\[.*?\]/g, ' ').replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ').trim();
  const searchUrl = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(cleanName)}&page=1`;

  try {
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) continue;
    const data = await res.json();
    const candidates = data?.data?.products || [];

    for (const cand of candidates) {
      const match = catalogImageService.computeConfidence(
        {
          name: m.med_name,
          manufacturer: m.med_mfg,
          strength: m.med_strength,
          packaging: m.med_packaging
        },
        {
          name: cand.name,
          manufacturer: cand.manufacturer
        }
      );

      if (match.verificationStatus === 'HIGH_CONFIDENCE' && match.confidenceScore >= 80) {
        const damImages = cand.damImages || [];
        const candImg = (damImages.length > 0 && damImages[0].url) ? damImages[0].url.split('?')[0] : (cand.image ? cand.image.split('?')[0] : null);

        if (candImg) {
          const slug = slugify(cleanName);
          const fileName = `${slug}-genuine-front.jpg`;
          const pFront = path.join(TARGET_FRONTEND, fileName);
          const pUpload = path.join(TARGET_UPLOADS, fileName);

          try {
            await downloadImage(candImg, pFront);
            fs.copyFileSync(pFront, pUpload);

            const relPath = `/products/${fileName}`;
            db.prepare(`
              INSERT INTO catalog_images (
                medicine_id, product_name, image_path, thumbnail_path, image_source,
                source_url, confidence_score, matching_method, verification_status,
                verification_reason, is_active, is_primary
              ) VALUES (?, ?, ?, ?, 'pharmeasy_verified', ?, ?, 'strict_ai_matcher', 'HIGH_CONFIDENCE', ?, 1, 1)
            `).run(m.med_id, cand.name, relPath, relPath, candImg, match.confidenceScore, match.reason);

            console.log(`[CORRECTED] ${m.med_name} -> "${cand.name}" (Score: ${match.confidenceScore})`);
            correctedCount++;
            break;
          } catch (err) {
            // download failure, skip
          }
        }
      }
    }
  } catch (err) {
    // network timeout, skip
  }
}

console.log(`\nRe-fetch completed. Downloaded & installed ${correctedCount} genuine replacement images.`);

console.log('\n===========================================================');
console.log('--- STEP 5: FINAL DATABASE VERIFICATION ---');
console.log('===========================================================');

const remainingActive = db.prepare('SELECT COUNT(*) as c FROM catalog_images WHERE is_active = 1').get().c;
const remainingApproved = db.prepare('SELECT COUNT(*) as c FROM catalog_images WHERE is_active = 1 AND verification_status IN (\'HIGH_CONFIDENCE\', \'APPROVED\')').get().c;
const totalRejected = db.prepare('SELECT COUNT(*) as c FROM catalog_images WHERE verification_status = \'REJECTED\'').get().c;

console.log({
  totalAudited: rows.length,
  deactivatedMismatches: toDeactivate.length,
  newlyCorrectedImages: correctedCount,
  remainingActiveImages: remainingActive,
  remainingVerifiedGood: remainingApproved,
  totalRejectedInDatabase: totalRejected
});

db.close();
console.log('\nAudit & Database correction completed successfully.');
process.exit(0);
