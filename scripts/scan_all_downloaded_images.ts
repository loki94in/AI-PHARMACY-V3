import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const DB_PATH = path.join(REPO_ROOT, 'data', 'app.db');
const isCleanMode = process.argv.includes('--clean');
const db = new Database(DB_PATH, { readonly: !isCleanMode });

const PRODUCTS_DIR = path.join(REPO_ROOT, 'frontend', 'public', 'products');
const UPLOADS_DIR = path.join(REPO_ROOT, 'uploads', 'products');

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
  if (/\b(TAB|TABLET|TABLETS|CAPLET)\b/.test(u)) return 'TABLET';
  if (/\b(CAP|CAPSULE|CAPSULES|SOFTGEL)\b/.test(u)) return 'CAPSULE';
  if (/\b(SYP|SYRUP|SUSP|SUSPENSION|LIQUID|SOLUTION)\b/.test(u)) return 'SYRUP';
  if (/\b(INJ|INJECTION|VIAL|AMPOULE|AMP|INFUSION|VAC|VACCINE)\b/.test(u)) return 'INJECTION';
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

async function runFullScan() {
  console.log('======================================================================');
  console.log('     FULL AUDIT ON ALL DOWNLOADED PACKAGING IMAGES (DISK + DB)');
  console.log('======================================================================\n');

  if (!fs.existsSync(PRODUCTS_DIR)) {
    console.error(`Directory not found: ${PRODUCTS_DIR}`);
    return;
  }

  // 1. Build lookup maps from medicines table
  console.log('Indexing medicine catalog...');
  const allMeds = db.prepare(`
    SELECT id, name, canonical_name, normalized_name, manufacturer, generic_name, dosage_form, strength, legacy_id
    FROM medicines
  `).all() as any[];

  const idMap = new Map<number, any>();
  const legacyMap = new Map<string, any>();
  const nameMap = new Map<string, any>();

  for (const m of allMeds) {
    idMap.set(m.id, m);
    if (m.legacy_id) legacyMap.set(String(m.legacy_id), m);
    const cleanName = clean(m.name);
    if (cleanName) nameMap.set(cleanName, m);
  }
  console.log(`Loaded ${allMeds.length} medicines into memory.\n`);

  // 2. Query catalog_images table to match files to medicine records
  console.log('Loading all catalog_images from database...');
  const dbImages = db.prepare(`
    SELECT id, medicine_id, product_name, image_path, image_type, is_primary, is_active, verification_status
    FROM catalog_images
  `).all() as any[];

  const fileToImageMap = new Map<string, any>();
  for (const img of dbImages) {
    const fn = path.basename(img.image_path || '').toLowerCase();
    const rel = (img.image_path || '').replace(/^\/+/, '').toLowerCase();
    if (fn) fileToImageMap.set(fn, img);
    if (rel) fileToImageMap.set(rel, img);
  }
  console.log(`Indexed ${dbImages.length} database image mappings.\n`);

  // 3. Scan all physical files in products directory (including 56 company subdirectories)
  interface ScannedFile {
    filename: string;
    relPath: string;
    fullPath: string;
  }
  const files: ScannedFile[] = [];
  const rootEntries = fs.readdirSync(PRODUCTS_DIR, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(entry.name)) {
      files.push({
        filename: entry.name,
        relPath: entry.name,
        fullPath: path.join(PRODUCTS_DIR, entry.name)
      });
    } else if (entry.isDirectory()) {
      try {
        const subFiles = fs.readdirSync(path.join(PRODUCTS_DIR, entry.name));
        for (const sf of subFiles) {
          if (/\.(jpg|jpeg|png|webp)$/i.test(sf)) {
            files.push({
              filename: sf,
              relPath: `${entry.name}/${sf}`,
              fullPath: path.join(PRODUCTS_DIR, entry.name, sf)
            });
          }
        }
      } catch {}
    }
  }
  console.log(`Found ${files.length} total image files across frontend/public/products (root + subdirectories).\n`);

  let scannedCount = 0;
  let passedCount = 0;
  let unmappedCount = 0;
  let approvedProtectedCount = 0;
  const conflicts: any[] = [];

  for (let i = 0; i < files.length; i++) {
    const fileObj = files[i];
    const filename = fileObj.filename;
    scannedCount++;

    const dbImg = fileToImageMap.get(fileObj.relPath.toLowerCase()) || fileToImageMap.get(filename.toLowerCase());

    // 🔒 Human-in-the-loop protection: never flag or purge human-approved images
    if (dbImg?.verification_status === 'APPROVED' || dbImg?.verification_status === 'VERIFIED') {
      approvedProtectedCount++;
      passedCount++;
      continue;
    }

    let med: any = null;

    if (dbImg) {
      med = idMap.get(dbImg.medicine_id) || legacyMap.get(String(dbImg.medicine_id)) || nameMap.get(clean(dbImg.product_name));
    }

    if (!med) {
      // Try matching by slug tokens from filename
      const stem = filename.replace(/-(front|back|combo|side|box-front|box-back|box-side)\.[^.]+$/i, '').replace(/[-_]/g, ' ');
      med = nameMap.get(clean(stem));
    }

    if (!med) {
      unmappedCount++;
      continue;
    }

    const medName = med.name || '';
    const imgProduct = dbImg?.product_name || '';
    const cleanFilename = filename.replace(/[-_]/g, ' ');

    const medTokens = getTokens(medName);
    const imgTokens = getTokens(`${imgProduct} ${cleanFilename}`);

    const reasons: string[] = [];

    // 1. Suffix Modifier Protection (e.g. MCL, ER, SR, etc.)
    for (const suffix of MODIFIER_SUFFIXES) {
      if (imgTokens.has(suffix) && !medTokens.has(suffix)) {
        const isStandalone = new RegExp(`\\b${suffix}\\b`, 'i').test(`${imgProduct} ${cleanFilename}`);
        if (isStandalone) {
          reasons.push(`Suffix Bleed: packaging contains '${suffix}' not in medicine name`);
        }
      }
    }

    // 2. Dosage Form Conflict
    const medForm = extractDosageForm(medName) || extractDosageForm(med.dosage_form || '');
    const imgForm = extractDosageForm(imgProduct) || extractDosageForm(cleanFilename);
    if (medForm && imgForm && medForm !== imgForm) {
      reasons.push(`Dosage Form Conflict: Medicine is '${medForm}' but packaging is '${imgForm}'`);
    }

    // 3. Strength Conflict with decimal slug tolerance
    const medStrs = extractStrengthNumbers(`${medName} ${med.strength || ''}`);
    const imgStrs = extractStrengthNumbers(`${imgProduct} ${cleanFilename}`);
    if (medStrs.length === 1 && imgStrs.length === 1) {
      const s1 = medStrs[0];
      const s2 = imgStrs[0];
      if (s1 !== s2 && normalizeStrength(s1) !== normalizeStrength(s2)) {
        reasons.push(`Strength Mismatch: Medicine requires '${s1}' but packaging shows '${s2}'`);
      }
    }

    // 4. Single Salt vs Multi-Salt Combination Gate
    const generic = med.generic_name || '';
    if (generic && generic !== 'N/A' && generic !== 'NOT APPLICABLE' && !generic.includes('FOOD') && !generic.includes('COSMETIC')) {
      const isSingleSalt = !generic.includes('+') && !generic.includes('/') && !generic.includes('COMBINATION');
      if (isSingleSalt) {
        if (imgProduct.includes('+') || /\b(MCL|TRIO|CV|LS|DSR|SP)\b/i.test(imgProduct)) {
          reasons.push(`Salt Count Conflict: Single-salt medicine matched combination packaging`);
        }
      }
    }

    if (reasons.length > 0) {
      conflicts.push({
        filename,
        fullPath: fileObj.fullPath,
        imageId: dbImg?.id || null,
        medicineId: med.id,
        medicineName: med.name,
        reasons
      });
    } else {
      passedCount++;
    }

    if ((i + 1) % 5000 === 0) {
      console.log(`Progress: ${i + 1}/${files.length} images scanned...`);
    }
  }

  console.log('\n======================================================================');
  console.log('                      ALL IMAGES AUDIT RESULTS');
  console.log('======================================================================');
  console.log(`Total Downloaded Files Scanned: ${scannedCount}`);
  console.log(`Human Approved Protected:       ${approvedProtectedCount}`);
  console.log(`Resolved to Medicine Record:    ${scannedCount - unmappedCount} (${(((scannedCount - unmappedCount) / scannedCount) * 100).toFixed(1)}%)`);
  console.log(`Verified Clean & Accurate:      ${passedCount} (${((passedCount / (scannedCount - unmappedCount || 1)) * 100).toFixed(1)}%)`);
  console.log(`Flagged with Rule Conflicts:    ${conflicts.length}`);
  console.log(`Unmapped / Standalone Files:    ${unmappedCount}`);
  console.log('======================================================================\n');

  if (conflicts.length > 0) {
    console.log('Sample Flagged Conflicts (First 10):');
    for (let i = 0; i < Math.min(conflicts.length, 10); i++) {
      const c = conflicts[i];
      console.log(`[#${i + 1}] File: ${c.filename}`);
      console.log(`     Medicine: ${c.medicineName} (ID: ${c.medicineId})`);
      console.log(`     Reason:   ${c.reasons.join(' | ')}`);
    }
    console.log('----------------------------------------------------------------------\n');
  }

  // Save report to disk
  const reportPath = path.join(process.cwd(), 'all_downloaded_images_conflict_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(conflicts, null, 2));
  console.log(`Detailed audit report saved to: ${reportPath}`);

  // Cleanup execution if --clean is passed
  if (isCleanMode && conflicts.length > 0) {
    console.log('\n======================================================================');
    console.log('         PURGING FLAGGED CONFLICTS FROM ALL DOWNLOADED IMAGES');
    console.log('======================================================================');

    const deleteStmt = db.prepare('DELETE FROM catalog_images WHERE id = ?');
    let dbDeleted = 0;
    let filesDeleted = 0;

    const tx = db.transaction(() => {
      for (const c of conflicts) {
        if (c.imageId) {
          deleteStmt.run(c.imageId);
          dbDeleted++;
        }
        const p1 = c.fullPath || path.join(PRODUCTS_DIR, c.filename);
        const p2 = path.join(UPLOADS_DIR, c.filename);
        if (fs.existsSync(p1)) {
          try { fs.unlinkSync(p1); filesDeleted++; } catch {}
        }
        if (fs.existsSync(p2)) {
          try { fs.unlinkSync(p2); } catch {}
        }
      }
    });

    tx();
    console.log(`Purged ${dbDeleted} conflicting DB records.`);
    console.log(`Deleted ${filesDeleted} conflicting files from disk.`);
    console.log('======================================================================\n');
  }
}

runFullScan().catch(console.error);
