import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), '..', 'data', 'app.db');
const isCleanMode = process.argv.includes('--clean');
const db = new Database(DB_PATH, { readonly: !isCleanMode });
const TARGET_FRONTEND = path.join(process.cwd(), '..', 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(process.cwd(), '..', 'uploads', 'products');

// Suffix modifiers that represent distinct chemical formulations
const MODIFIER_SUFFIXES = [
  'MCL', 'AM', 'H', 'CH', 'PLUS', 'D', 'TRIO', 'CV', 'LS', 'DSR', 'SP', 
  'DT', 'SR', 'ER', 'PR', 'CR', 'XL', 'FORTE', 'KID', 'PAED', 'PAEDIATRIC', 
  'PEDIATRIC', 'JUNIOR', 'JR', 'BABY', 'EZ', 'OZ', 'TZ', 'AZ', 'DX', 'CZ'
];

function clean(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/\[.*?\]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDosageForm(text: string): string | null {
  if (!text) return null;
  const u = text.toUpperCase();
  if (/\b(TAB|TABLET|TABLETS|CAPLET|DT)\b/.test(u)) return 'TABLET';
  if (/\b(CAP|CAPSULE|CAPSULES|SOFTGEL)\b/.test(u)) return 'CAPSULE';
  if (/\b(SYP|SYRUP|SUSP|SUSPENSION|LIQUID|SOLUTION)\b/.test(u)) return 'SYRUP';
  if (/\b(INJ|INJECTION|VIAL|AMPOULE|INFUSION)\b/.test(u)) return 'INJECTION';
  if (/\b(EYE DROP|EAR DROP|DROPS?)\b/.test(u)) return 'DROPS';
  if (/\b(CREAM|OINT|OINTMENT|GEL|LOTION)\b/.test(u)) return 'TOPICAL';
  return null;
}

function extractStrengthNumbers(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\b\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?\s*(?:MG|MCG|GM|ML|%)\b/gi) || [];
  return matches.map(m => m.replace(/\s+/g, '').toUpperCase());
}

function normalizeStrength(s: string): string {
  return s.replace(/[\.\/]/g, '').toUpperCase();
}

function getTokens(s: string): Set<string> {
  return new Set(clean(s).split(' ').filter(w => w.length >= 2));
}

async function runScan() {
  console.log('======================================================================');
  console.log('     DATABASE PACKAGING IMAGE ACCURACY & COMPLIANCE SCANNER');
  console.log('======================================================================\n');

  const rows = db.prepare(`
    SELECT 
      ci.id as image_id,
      ci.medicine_id,
      m.name as med_name,
      m.manufacturer as med_mfg,
      m.generic_name as med_generic,
      m.dosage_form as med_form,
      m.strength as med_strength,
      ci.product_name as img_product_name,
      ci.company_name as img_company_name,
      ci.image_path,
      ci.image_type,
      ci.ocr_text,
      ci.is_primary,
      ci.is_active
    FROM catalog_images ci
    JOIN medicines m ON ci.medicine_id = m.id
    ORDER BY ci.id ASC
  `).all() as any[];

  console.log(`Found ${rows.length} total catalog_images linked to medicines in DB.\n`);

  const conflicts: any[] = [];
  let passedCount = 0;

  for (const r of rows) {
    const medName = r.med_name || '';
    const imgProduct = r.img_product_name || '';
    const filename = path.basename(r.image_path || '').replace(/[-_]/g, ' ');
    const ocr = r.ocr_text || '';

    const medTokens = getTokens(medName);
    const imgTokens = getTokens(`${imgProduct} ${filename}`);

    const reasons: string[] = [];

    // 1. Suffix Modifier Protection (e.g. Telista MCL vs Telista)
    for (const suffix of MODIFIER_SUFFIXES) {
      if (imgTokens.has(suffix) && !medTokens.has(suffix)) {
        // Double check if suffix is part of another word
        const isStandalone = new RegExp(`\\b${suffix}\\b`, 'i').test(`${imgProduct} ${filename}`);
        if (isStandalone) {
          reasons.push(`Suffix Bleed: packaging contains modifier '${suffix}' not in medicine name`);
        }
      }
    }

    // 2. Bidirectional Dosage Form Conflict (TABLET vs CAPSULE, etc.)
    const medForm = extractDosageForm(medName) || extractDosageForm(r.med_form || '');
    const imgForm = extractDosageForm(imgProduct) || extractDosageForm(filename);
    if (medForm && imgForm && medForm !== imgForm) {
      reasons.push(`Dosage Form Conflict: Medicine is '${medForm}' but packaging is '${imgForm}'`);
    }

    // 3. Single Salt vs Multi-Salt Gate
    const generic = r.med_generic || '';
    if (generic && generic !== 'N/A' && generic !== 'NOT APPLICABLE') {
      const isSingleSalt = !generic.includes('+') && !generic.includes('/') && !generic.includes('COMBINATION');
      if (isSingleSalt) {
        // If single salt, packaging OCR / name shouldn't have known combo indicator or '+'
        if (imgProduct.includes('+') || /\b(MCL|TRIO|PLUS|CV|LS|DSR|SP)\b/i.test(imgProduct)) {
          reasons.push(`Salt Count Conflict: Single-salt medicine matched combination packaging`);
        }
      }
    }

    // 4. Strength Conflict (with decimal dot and slash slug tolerance)
    const medStrengths = extractStrengthNumbers(`${medName} ${r.med_strength || ''}`);
    const imgStrengths = extractStrengthNumbers(`${imgProduct} ${filename}`);
    if (medStrengths.length === 1 && imgStrengths.length === 1) {
      const s1 = medStrengths[0];
      const s2 = imgStrengths[0];
      if (s1 !== s2 && normalizeStrength(s1) !== normalizeStrength(s2)) {
        reasons.push(`Strength Mismatch: Medicine requires '${s1}' but packaging shows '${s2}'`);
      }
    }

    if (reasons.length > 0) {
      conflicts.push({
        imageId: r.image_id,
        medicineId: r.medicine_id,
        medicineName: r.med_name,
        imageProduct: r.img_product_name,
        imagePath: r.image_path,
        imageType: r.image_type,
        reasons
      });
    } else {
      passedCount++;
    }
  }

  console.log('======================================================================');
  console.log('                         SCAN RESULTS');
  console.log('======================================================================');
  console.log(`Total Images Scanned:     ${rows.length}`);
  console.log(`Verified Clean / Passed:  ${passedCount} (${((passedCount / rows.length) * 100).toFixed(1)}%)`);
  console.log(`Flagged with Conflicts:   ${conflicts.length} (${((conflicts.length / rows.length) * 100).toFixed(1)}%)\n`);

  // Breakdown by Conflict Category
  const categoryCounts: Record<string, number> = {};
  for (const c of conflicts) {
    for (const re of c.reasons) {
      const cat = re.split(':')[0];
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
  }

  console.log('Conflict Breakdown by Category:');
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`  - ${cat.padEnd(26)}: ${count}`);
  }

  console.log('\n----------------------------------------------------------------------');
  console.log('Sample Flagged Conflicts (First 15):');
  console.log('----------------------------------------------------------------------');

  for (let i = 0; i < Math.min(conflicts.length, 15); i++) {
    const c = conflicts[i];
    console.log(`[#${i + 1}] Medicine: ${c.medicineName} (ID: ${c.medicineId})`);
    console.log(`     Image File: ${path.basename(c.imagePath)} [Angle: ${c.imageType}]`);
    console.log(`     Detected Conflict(s):`);
    for (const r of c.reasons) {
      console.log(`       * ${r}`);
    }
    console.log('----------------------------------------------------------------------');
  }

  // Save report to JSON file for audit
  const outPath = path.join(process.cwd(), 'image_scan_conflict_report.json');
  fs.writeFileSync(outPath, JSON.stringify(conflicts, null, 2));
  console.log(`\nComplete detailed audit report saved to: ${outPath}`);

  if (isCleanMode && conflicts.length > 0) {
    console.log('\n======================================================================');
    console.log('             EXECUTING CLEANUP OF FLAGGED CONFLICTS');
    console.log('======================================================================');

    const deleteStmt = db.prepare('DELETE FROM catalog_images WHERE id = ?');
    const rejInfo = db.prepare('PRAGMA table_info(catalog_image_rejections)').all() as any[];
    const hasReasonCol = rejInfo.some(c => c.name === 'rejection_reason');
    const hasReasonTextCol = rejInfo.some(c => c.name === 'reason');

    const insertRejectionStmt = hasReasonCol
      ? db.prepare('INSERT OR IGNORE INTO catalog_image_rejections (medicine_id, rejected_image_url, rejection_reason) VALUES (?, ?, ?)')
      : hasReasonTextCol
      ? db.prepare('INSERT OR IGNORE INTO catalog_image_rejections (medicine_id, rejected_image_url, reason) VALUES (?, ?, ?)')
      : db.prepare('INSERT OR IGNORE INTO catalog_image_rejections (medicine_id, rejected_image_url) VALUES (?, ?)');

    const setPrimaryStmt = db.prepare('UPDATE catalog_images SET is_primary = 1 WHERE id = ?');

    let deletedFiles = 0;
    const affectedMeds = new Set<number>();

    const tx = db.transaction(() => {
      for (const item of conflicts) {
        affectedMeds.add(item.medicineId);
        deleteStmt.run(item.imageId);

        try {
          insertRejectionStmt.run(item.medicineId, item.imagePath, item.reasons.join('; '));
        } catch {}

        const fn = path.basename(item.imagePath);
        const p1 = path.join(TARGET_FRONTEND, fn);
        const p2 = path.join(TARGET_UPLOADS, fn);

        const shared = db.prepare('SELECT count(*) as count FROM catalog_images WHERE image_path = ?').get(item.imagePath) as any;
        if (shared.count === 0) {
          if (fs.existsSync(p1)) {
            try { fs.unlinkSync(p1); deletedFiles++; } catch {}
          }
          if (fs.existsSync(p2)) {
            try { fs.unlinkSync(p2); } catch {}
          }
        }
      }

      for (const mid of affectedMeds) {
        const remaining = db.prepare('SELECT id, is_primary FROM catalog_images WHERE medicine_id = ? ORDER BY is_primary DESC, id ASC').all(mid) as any[];
        if (remaining.length > 0 && !remaining.some(r => r.is_primary === 1)) {
          setPrimaryStmt.run(remaining[0].id);
        }
      }
    });

    tx();

    console.log(`Successfully purged ${conflicts.length} conflicting image records.`);
    console.log(`Unlinked ${deletedFiles} unshared image files from disk.`);
    console.log(`Rebalanced primary images for ${affectedMeds.size} affected medicines.`);
    console.log('======================================================================\n');
  }
}

runScan().catch(console.error);
