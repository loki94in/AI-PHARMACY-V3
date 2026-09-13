#!/usr/bin/env node

/**
 * scripts/fix_legacy_catalog_images.ts
 *
 * Automated Legacy Image Cleanup & Sibling Rescue Pipeline:
 * 1. Scans all active catalog images.
 * 2. Detects strength conflicts (e.g. 100mg vs 200mg, 10 vs 20) and dosage conflicts (e.g. Shampoo vs Soap, Soap vs Cream).
 * 3. Attempts opportunistic sibling rescue: if packaging matches a sibling medicine in the catalog with 0 images,
 *    it renames the file and reassigns the image to the genuine sibling.
 * 4. If no genuine match exists, it deletes the false images from disk and database.
 * 5. Clears the harvest state for affected medicines so the 12 background harvesters re-fetch genuine packaging.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { detectDosageFormFromText, isItemTypeConflicting } from '../src/services/productNameFilterService.js';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const db = new Database(DB_PATH);
db.pragma('busy_timeout = 30000');

const PACK_QUANTITIES = new Set([2, 4, 5, 6, 7, 8, 10, 14, 15, 20, 21, 24, 28, 30, 50, 60, 90, 100, 120, 150, 180, 200]);

function normalizeTokens(text: string): string {
  if (!text) return '';
  return text
    .replace(/['’]s\b/gi, ' ')
    .replace(/\b\d+\s*x\s*\d+\b/gi, ' ')
    .replace(/([a-zA-Z])(\d+)/g, '$1 $2')
    .replace(/(\d+)(mg|mcg|ml|gm|iu|%)\b/gi, '$1 $2');
}

function extractStrengthTokens(name: string): Array<{ val: number; unit?: string }> {
  const norm = normalizeTokens(name).toUpperCase();
  const tokens: Array<{ val: number; unit?: string }> = [];

  const regexUnit = /\b(\d+(?:\.\d+)?)\s*(MG|MCG|IU|%|ML|GM)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regexUnit.exec(norm)) !== null) {
    tokens.push({ val: parseFloat(match[1]), unit: match[2].toLowerCase() });
  }

  const regexForm = /\b(\d+(?:\.\d+)?)\s*(?:TABLET|TABLETS|TAB|TABS|CAPSULE|CAPSULES|CAP|CAPS|STRIP|SUSPENSION|SYRUP|INJECTION|INJ|CREAM|GEL|OINTMENT|OINT|RESPICAP|RESPICAPS|RESPULE|RESPULES|ROTACAP|ROTACAPS|INHALER|TRANSHALER|NEOHALER|PUFFS?|DOSE|DOSES|DROPS?|SOLUTION|SACHET|SACHETS)\b/gi;
  while ((match = regexForm.exec(norm)) !== null) {
    const val = parseFloat(match[1]);
    const prevText = norm.slice(Math.max(0, match.index - 12), match.index);
    if (!/STRIP\s+OF|PACK\s+OF|BOX\s+OF/i.test(prevText)) {
      if (tokens.length > 0 && PACK_QUANTITIES.has(val)) {
        continue;
      }
      if (!tokens.some(t => Math.abs(t.val - val) < 0.001)) {
        tokens.push({ val });
      }
    }
  }

  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && /^\d+(?:\.\d+)?$/.test(words[1])) {
    const prevWord = words[0].toUpperCase();
    if (!/^(PACK|STRIP|BOX|BOTTLE|TAB|CAP|SYP|INJ|\d+)$/i.test(prevWord)) {
      const val = parseFloat(words[1]);
      if (!isNaN(val) && val >= 0.5 && val <= 5000 && !tokens.some(t => Math.abs(t.val - val) < 0.001)) {
        tokens.push({ val });
      }
    }
  }

  return tokens;
}

function hasStrengthConflict(name1: string, name2: string): boolean {
  const s1 = extractStrengthTokens(name1);
  const s2 = extractStrengthTokens(name2);

  if (s1.length === 0 || s2.length === 0) return false;

  const sum1 = s1.reduce((acc, t) => acc + t.val, 0);
  const sum2 = s2.reduce((acc, t) => acc + t.val, 0);
  if (Math.abs(sum1 - sum2) <= 0.01) return false;
  if (s1.length === 1 && s2.length > 1 && Math.abs(s1[0].val - sum2) <= 0.01) return false;
  if (s2.length === 1 && s1.length > 1 && Math.abs(s2[0].val - sum1) <= 0.01) return false;

  for (const t1 of s1) {
    const matching = s2.find(t2 => Math.abs(t2.val - t1.val) <= 0.001);
    if (!matching) {
      if (s2.length > 1 && Math.abs(t1.val - sum2) <= 0.01) continue;
      return true;
    }
    if (t1.unit && matching.unit && t1.unit !== matching.unit) return true;
  }
  return false;
}

function hasDosageConflict(q: string, c: string): boolean {
  const df1 = detectDosageFormFromText(q);
  if (df1 && isItemTypeConflicting(df1, c)) return true;
  const df2 = detectDosageFormFromText(c);
  if (df2 && isItemTypeConflicting(df2, q)) return true;
  return false;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function findSiblingTarget(cdnName: string, mfg: string, excludeMedId: number): any | null {
  const brandWord = cdnName.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '');
  if (brandWord.length < 3) return null;

  const mfgLead = (mfg || '').split(/\s+/)[0];
  const candidates = db.prepare(`
    SELECT id, name, manufacturer
    FROM medicines
    WHERE manufacturer LIKE ?
      AND name LIKE ?
      AND id != ?
    LIMIT 25
  `).all(`%${mfgLead}%`, `%${brandWord}%`, excludeMedId) as any[];

  for (const cand of candidates) {
    const nameWords = cand.name.toUpperCase().split(/[^A-Z0-9]+/);
    if (!nameWords.includes(brandWord.toUpperCase())) continue;
    if (hasDosageConflict(cand.name, cdnName)) continue;
    if (hasStrengthConflict(cand.name, cdnName)) continue;

    // Must not already have active images
    const hasActiveImg = db.prepare('SELECT 1 FROM catalog_images WHERE medicine_id = ? AND is_active = 1 LIMIT 1').get(cand.id);
    if (hasActiveImg) continue;

    return cand;
  }
  return null;
}

async function run() {
  console.log('===============================================================');
  console.log('   LEGACY CATALOG IMAGES AUDIT & AUTOMATED CORRECTION');
  console.log('===============================================================');

  const rows = db.prepare(`
    SELECT ci.id, ci.medicine_id, m.name as med_name, m.manufacturer as med_mfg,
           ci.product_name, ci.image_path, ci.thumbnail_path, ci.image_type
    FROM catalog_images ci
    JOIN medicines m ON m.id = ci.medicine_id
    WHERE ci.is_active = 1
    ORDER BY ci.medicine_id ASC, ci.id ASC
  `).all() as any[];

  console.log(`Auditing ${rows.length} active images...`);

  // Group by medicine_id
  const medMap = new Map<number, any[]>();
  for (const r of rows) {
    if (!medMap.has(r.medicine_id)) medMap.set(r.medicine_id, []);
    medMap.get(r.medicine_id)!.push(r);
  }

  let strengthConflictCount = 0;
  let dosageConflictCount = 0;
  let rescuedCount = 0;
  let purgedCount = 0;
  const resetHarvestMeds = new Set<number>();

  for (const [medId, imgs] of medMap.entries()) {
    const medName = imgs[0].med_name;
    const medMfg = imgs[0].med_mfg;
    const cdnName = imgs[0].product_name;

    const sConflict = hasStrengthConflict(medName, cdnName);
    const dConflict = hasDosageConflict(medName, cdnName);

    if (!sConflict && !dConflict) continue;

    if (sConflict) strengthConflictCount++;
    if (dConflict) dosageConflictCount++;

    console.log(`\n⚠️ Conflict Detected: [ID ${medId}] "${medName}" vs Packaging "${cdnName}"`);
    if (sConflict) console.log(`   - Reason: Strength conflict`);
    if (dConflict) console.log(`   - Reason: Dosage form conflict`);

    // Attempt sibling rescue
    const sibling = findSiblingTarget(cdnName, medMfg, medId);

    if (sibling) {
      console.log(`   ✨ Sibling Match Found! Moving packaging to "${sibling.name}" (ID: ${sibling.id})`);
      const siblingSlug = slugify(sibling.name);

      for (const img of imgs) {
        const oldFile = path.basename(img.image_path);
        const face = img.image_type || 'front';
        const newFile = `${siblingSlug}-${face}.jpg`;

        const fOld = path.join(ROOT_DIR, 'frontend', 'public', 'products', oldFile);
        const fNew = path.join(ROOT_DIR, 'frontend', 'public', 'products', newFile);
        const uOld = path.join(ROOT_DIR, 'uploads', 'products', oldFile);
        const uNew = path.join(ROOT_DIR, 'uploads', 'products', newFile);

        try {
          if (fs.existsSync(fOld)) { fs.copyFileSync(fOld, fNew); fs.unlinkSync(fOld); }
          if (fs.existsSync(uOld)) { fs.copyFileSync(uOld, uNew); fs.unlinkSync(uOld); }
        } catch {}

        db.prepare(`
          UPDATE catalog_images
          SET medicine_id = ?,
              product_name = ?,
              image_path = '/products/' || ?,
              thumbnail_path = '/products/' || ?,
              matching_method = 'gemini_sibling_remapped'
          WHERE id = ?
        `).run(sibling.id, sibling.name, newFile, newFile, img.id);
      }

      // Mark sibling as success in harvest state
      db.prepare(`
        INSERT INTO catalog_harvest_state (medicine_id, medicine_name, company, status, reason, checked_at)
        VALUES (?, ?, ?, 'success', NULL, CURRENT_TIMESTAMP)
        ON CONFLICT(medicine_id) DO UPDATE SET
          medicine_name = excluded.medicine_name,
          company = excluded.company,
          status = 'success',
          reason = NULL,
          checked_at = CURRENT_TIMESTAMP
      `).run(sibling.id, sibling.name, medMfg);

      rescuedCount += imgs.length;
    } else {
      console.log(`   🗑️ No sibling match. Purging ${imgs.length} images...`);
      for (const img of imgs) {
        const fPath = path.join(ROOT_DIR, 'frontend', 'public', img.image_path);
        const uPath = path.join(ROOT_DIR, 'uploads', img.image_path.replace('/products/', 'products/'));
        try { if (fs.existsSync(fPath)) fs.unlinkSync(fPath); } catch {}
        try { if (fs.existsSync(uPath)) fs.unlinkSync(uPath); } catch {}

        db.prepare('DELETE FROM catalog_images WHERE id = ?').run(img.id);
      }
      purgedCount += imgs.length;
    }

    // Reset harvest state for source medicine so it can be re-harvested cleanly
    resetHarvestMeds.add(medId);
    db.prepare('DELETE FROM catalog_harvest_state WHERE medicine_id = ?').run(medId);
  }

  console.log('\n===============================================================');
  console.log('   AUDIT & CORRECTION SUMMARY');
  console.log('===============================================================');
  console.log(`Medicines with Strength Conflicts : ${strengthConflictCount}`);
  console.log(`Medicines with Dosage Conflicts   : ${dosageConflictCount}`);
  console.log(`Packaging Images Rescued (Remapped): ${rescuedCount}`);
  console.log(`Invalid Packaging Images Purged    : ${purgedCount}`);
  console.log(`Medicines Reset for Clean Harvest : ${resetHarvestMeds.size}`);
  console.log('===============================================================\n');
}

run().catch(console.error);
