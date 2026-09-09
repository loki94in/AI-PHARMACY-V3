#!/usr/bin/env node

/**
 * scripts/scan_and_resolve_primary_images.mjs
 * 
 * Master Catalog Image Scanner & Primary Image Resolver:
 * - Scans all medicines in the database that have images in `catalog_images`.
 * - For each medicine, evaluates all attached active images (front, back, side, box).
 * - Uses the AI Camera OCR and packaging verification engine to identify which image
 *   actually displays the printed medicine name and active strength (e.g. foil back vs clear blister).
 * - Enforces "one medicine = one verified primary image" (is_primary = 1).
 * - Automatically deactivates and rejects wrong-strength or wrong-modifier images.
 * 
 * Usage:
 *   npx tsx scripts/scan_and_resolve_primary_images.mjs --help
 *   npx tsx scripts/scan_and_resolve_primary_images.mjs --filter="dytor"
 *   npx tsx scripts/scan_and_resolve_primary_images.mjs --inventory-only --limit=50
 *   npx tsx scripts/scan_and_resolve_primary_images.mjs --all
 *   npx tsx scripts/scan_and_resolve_primary_images.mjs --dry-run
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { aiCameraService } from '../src/services/aiCameraService.js';
import {
  extractDrugStrength,
  extractFormulationModifiers,
  hasFormulationModifierConflict,
  stripPharmacopoeiaMarkers
} from '../src/services/productNameFilterService.js';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const db = new Database(DB_PATH);

// Parse CLI arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npx tsx scripts/scan_and_resolve_primary_images.mjs [options]

Options:
  --all               Scan all medicines with images in the master database
  --filter=<term>     Scan only medicines matching name/brand (e.g. --filter="dytor")
  --inventory-only    Scan only medicines that are currently in stock in inventory
  --limit=<N>         Limit scan to N medicines (default: 50 if --all not specified)
  --dry-run           Preview OCR evaluations and primary image choices without saving to DB
  --batch-size=<N>    Log progress every N medicines (default: 10)
  `);
  process.exit(0);
}

const runAll = args.includes('--all');
const dryRun = args.includes('--dry-run');
const inventoryOnly = args.includes('--inventory-only');
const filterArg = args.find(a => a.startsWith('--filter='));
const filterTerm = filterArg ? filterArg.split('=')[1].trim() : null;
const limitArg = args.find(a => a.startsWith('--limit='));
const limitVal = limitArg ? parseInt(limitArg.split('=')[1], 10) : (runAll ? null : 50);

console.log('='.repeat(80));
console.log('   AI PHARMACY — MASTER CATALOG IMAGE SCANNER & PRIMARY RESOLVER');
console.log('='.repeat(80));
console.log(`Mode: ${dryRun ? 'DRY-RUN (Preview only, no DB writes)' : 'LIVE (Updating database)'}`);
if (filterTerm) console.log(`Filter: medicines matching "${filterTerm}"`);
if (inventoryOnly) console.log(`Scope: In-stock inventory medicines only`);
if (limitVal) console.log(`Limit: max ${limitVal} medicines`);
console.log('');

// 1. Build query for medicines that have active images
let medQuery = `
  SELECT DISTINCT m.id, m.name, m.manufacturer, m.strength, m.packaging
  FROM medicines m
  JOIN catalog_images ci ON ci.medicine_id = m.id AND ci.is_active = 1
`;
const params = [];
const conditions = [];

if (filterTerm) {
  conditions.push(`m.name LIKE ?`);
  params.push(`%${filterTerm}%`);
}

if (inventoryOnly) {
  conditions.push(`EXISTS (SELECT 1 FROM inventory i WHERE i.medicine_id = m.id AND (i.quantity > 0 OR i.loose_quantity > 0))`);
}

if (conditions.length > 0) {
  medQuery += ' WHERE ' + conditions.join(' AND ');
}

medQuery += ' ORDER BY m.id ASC';
if (limitVal) {
  medQuery += ` LIMIT ${limitVal}`;
}

const targetMeds = db.prepare(medQuery).all(...params);
console.log(`Found ${targetMeds.length} medicines to scan.\n`);

function resolveImageFile(imagePath) {
  if (!imagePath) return null;
  const cleanRel = imagePath.replace(/^\/+/, '');
  const candidatePaths = [
    path.resolve(ROOT_DIR, 'frontend/public', cleanRel),
    path.resolve(ROOT_DIR, cleanRel),
    path.resolve(ROOT_DIR, 'frontend/public/products', path.basename(cleanRel)),
    path.resolve(ROOT_DIR, 'uploads/products', path.basename(cleanRel)),
    path.resolve(ROOT_DIR, 'uploads', cleanRel)
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const stat = fs.statSync(p);
        if (stat.size > 0) return { path: p, size: stat.size };
      } catch {}
    }
  }
  return null;
}

const updatePrimaryStmt = db.prepare(`
  UPDATE catalog_images
  SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END,
      updated_at = CURRENT_TIMESTAMP
  WHERE medicine_id = ? AND is_active = 1
`);

const deactivateConflictStmt = db.prepare(`
  UPDATE catalog_images
  SET is_active = 0,
      is_primary = 0,
      verification_status = 'REJECTED',
      verification_reason = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

let totalScanned = 0;
let primaryUpdated = 0;
let conflictsDeactivated = 0;
let alreadyOptimal = 0;

for (let i = 0; i < targetMeds.length; i++) {
  const med = targetMeds[i];
  totalScanned++;

  const images = db.prepare(`
    SELECT id, image_path, product_name, is_primary, is_active, confidence_score, verification_status
    FROM catalog_images
    WHERE medicine_id = ? AND is_active = 1
    ORDER BY id ASC
  `).all(med.id);

  if (images.length === 0) continue;

  const medStrength = extractDrugStrength(med.name).strength || (med.strength ? extractDrugStrength(med.strength).strength : null);
  const medBrandWords = med.name.toUpperCase().replace(/[-_.,/()\[\]]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  const coreBrand = medBrandWords[0] || '';

  console.log(`[${i + 1}/${targetMeds.length}] Med #${med.id}: "${med.name}" (${images.length} images)`);

  const evaluatedImages = [];

  for (const img of images) {
    const fileInfo = resolveImageFile(img.image_path);
    if (!fileInfo) {
      evaluatedImages.push({
        ...img,
        score: -100,
        reason: 'Image file missing or 0 bytes on disk',
        conflict: 'FILE_MISSING'
      });
      continue;
    }

    try {
      const buf = fs.readFileSync(fileInfo.path);
      const ocrRes = await aiCameraService.processImage(buf, true);
      const ocrText = (ocrRes.text || '').toUpperCase();
      const detectedStrength = extractDrugStrength(ocrText).strength;
      const hasModConflict = hasFormulationModifierConflict(med.name, ocrText);

      let score = 50; // base score for a readable file
      let conflictType = null;
      let notes = [];

      // 1. Brand match
      if (coreBrand && ocrText.includes(coreBrand)) {
        score += 30;
        notes.push(`Brand "${coreBrand}" found`);
      }

      // 2. Strength match vs conflict
      if (medStrength && detectedStrength) {
        if (medStrength === detectedStrength) {
          score += 40;
          notes.push(`Strength ${detectedStrength} confirmed`);
        } else {
          score -= 120; // Severe strength conflict
          conflictType = 'STRENGTH_CONFLICT';
          notes.push(`Strength conflict: med is ${medStrength}, image shows ${detectedStrength}`);
        }
      }

      // 3. Modifier match vs conflict
      if (hasModConflict) {
        score -= 80;
        if (!conflictType) conflictType = 'MODIFIER_CONFLICT';
        notes.push('Formulation modifier conflict (e.g. plain vs plus/kit)');
      }

      // 4. Text clarity / content
      const cleanChars = ocrText.replace(/[^A-Z0-9]/g, '');
      if (cleanChars.length >= 25) {
        score += 15;
        notes.push(`Clear text (${cleanChars.length} chars)`);
      } else if (cleanChars.length < 8) {
        score -= 25;
        notes.push('Sparse/no text (likely clear blister bubble)');
      }

      // 5. Prefer printed foil back or labeled carton over plain bubble
      const lowerPath = img.image_path.toLowerCase();
      if (lowerPath.includes('back') || lowerPath.includes('side') || lowerPath.includes('box')) {
        score += 10;
        notes.push('Foil/side angle');
      }

      evaluatedImages.push({
        ...img,
        score,
        ocrTextPreview: ocrText.slice(0, 60).replace(/\s+/g, ' '),
        detectedStrength,
        conflict: conflictType,
        notes: notes.join(' | ')
      });
    } catch (ocrErr) {
      evaluatedImages.push({
        ...img,
        score: 10,
        reason: 'OCR processing error: ' + ocrErr.message
      });
    }
  }

  // Deactivate conflicting images
  for (const evaluated of evaluatedImages) {
    if (evaluated.conflict) {
      conflictsDeactivated++;
      console.log(`   ❌ DEACTIVATING image #${evaluated.id} (${path.basename(evaluated.image_path)}): ${evaluated.notes}`);
      if (!dryRun) {
        deactivateConflictStmt.run(`[AUTO-AUDIT] ${evaluated.notes}`, evaluated.id);
      }
    }
  }

  // Find remaining valid images sorted by score desc
  const validImages = evaluatedImages.filter(e => !e.conflict && e.score > 0).sort((a, b) => b.score - a.score);

  if (validImages.length > 0) {
    const bestImage = validImages[0];
    const currentPrimary = images.find(i => i.is_primary === 1);

    if (!currentPrimary || currentPrimary.id !== bestImage.id) {
      primaryUpdated++;
      console.log(`   ⭐ SETTING PRIMARY: #${bestImage.id} (${path.basename(bestImage.image_path)}) [Score: ${bestImage.score}] - ${bestImage.notes}`);
      if (currentPrimary) {
        console.log(`      (Demoted previous primary #${currentPrimary.id} - ${path.basename(currentPrimary.image_path)})`);
      }
      if (!dryRun) {
        updatePrimaryStmt.run(bestImage.id, med.id);
      }
    } else {
      alreadyOptimal++;
      console.log(`   ✓ Primary is already optimal: #${bestImage.id} (${path.basename(bestImage.image_path)}) [Score: ${bestImage.score}]`);
    }
  } else {
    console.log(`   ⚠️ No high-confidence image available after audit for Med #${med.id}`);
  }
  console.log('');
}

console.log('='.repeat(80));
console.log('--- AUDIT SUMMARY ---');
console.log('='.repeat(80));
console.log({
  totalMedicinesScanned: totalScanned,
  primaryImagesUpdated: primaryUpdated,
  primaryAlreadyOptimal: alreadyOptimal,
  conflictsDeactivated: conflictsDeactivated,
  dryRunMode: dryRun
});

db.close();
console.log('\nScan completed.');
process.exit(0);
