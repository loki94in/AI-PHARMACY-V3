import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { catalogImageService } from '../src/services/catalogImageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(REPO_ROOT, 'data', 'app.db');
const PRODUCTS_DIR = path.join(REPO_ROOT, 'frontend', 'public', 'products');

const isDryRun = process.argv.includes('--dry-run');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');

function clean(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/\[.*?\]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFace(filename: string): { stem: string; face: string } {
  const m = filename.match(/-(front|back|combo|side|box-front|box-back|box-side|angle_\d+)\.[^.]+$/i);
  if (m) {
    const rawFace = m[1].toLowerCase();
    let face = 'combo';
    if (rawFace.includes('front')) face = 'front';
    else if (rawFace.includes('back')) face = 'back';
    else if (rawFace.includes('side')) face = 'side';
    else if (rawFace.includes('combo')) face = 'combo';
    return { stem: filename.slice(0, m.index), face };
  }
  const cleanStem = filename.replace(/\.[^.]+$/, '');
  return { stem: cleanStem, face: 'combo' };
}

function slugify(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function linkAllDiskImages() {
  console.log('='.repeat(70));
  console.log(`⚡ HIGH-SPEED ZERO-DOWNLOAD LOCAL PACKAGING DISK LINKER`);
  console.log(`   Mode: ${isDryRun ? 'DRY-RUN (No DB Writes)' : 'ACTIVE (Committing to SQLite)'}`);
  console.log('='.repeat(70));

  // 1. Index all existing images in DB
  console.log('Reading existing catalog_images from database...');
  const existingImages = db.prepare(`
    SELECT id, medicine_id, image_path, verification_status, image_type, is_primary
    FROM catalog_images
  `).all() as any[];

  const existingPathSet = new Set<string>();
  const medToApprovedSet = new Set<number>();
  const medToImageCount = new Map<number, number>();
  const medHasPrimarySet = new Set<number>();

  for (const img of existingImages) {
    if (img.image_path) {
      existingPathSet.add(img.image_path.toLowerCase().replace(/^\/+/, ''));
    }
    if (img.verification_status === 'APPROVED' || img.verification_status === 'VERIFIED') {
      medToApprovedSet.add(img.medicine_id);
    }
    if (img.is_primary === 1 && img.is_active === 1) {
      medHasPrimarySet.add(img.medicine_id);
    }
    medToImageCount.set(img.medicine_id, (medToImageCount.get(img.medicine_id) || 0) + 1);
  }
  console.log(`Indexed ${existingImages.length} database image records (${medToApprovedSet.size} medicines have human-approved images).\n`);

  // 2. Discover all company subdirectories in frontend/public/products
  const entries = fs.readdirSync(PRODUCTS_DIR, { withFileTypes: true });
  const subdirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  console.log(`Found ${subdirs.length} company subdirectories in frontend/public/products.\n`);

  // 3. Prepare queries for medicines
  const allMeds = db.prepare(`
    SELECT id, name, manufacturer, strength, packaging, dosage_form
    FROM medicines
    WHERE manufacturer IS NOT NULL AND TRIM(manufacturer) != ''
  `).all() as any[];

  // Group medicines by normalized manufacturer slug
  const companyMedsMap = new Map<string, any[]>();
  for (const med of allMeds) {
    const slug = slugify(med.manufacturer);
    if (!companyMedsMap.has(slug)) companyMedsMap.set(slug, []);
    companyMedsMap.get(slug)!.push(med);
  }

  // Prepared insert statement
  const insertStmt = db.prepare(`
    INSERT INTO catalog_images (
      medicine_id, company_name, product_name, image_path, thumbnail_path,
      image_source, source_url, confidence_score, matching_method,
      verification_status, verification_reason, is_active, retry_count,
      image_type, is_primary
    ) VALUES (?, ?, ?, ?, ?, 'local_disk', 'local_pc', ?, 'disk_pre_scan', 'HIGH_CONFIDENCE', ?, 1, 0, ?, ?)
  `);

  let totalScanned = 0;
  let alreadyLinked = 0;
  let newlyMatched = 0;
  let skippedConflicts = 0;
  let unmappedFiles = 0;

  const insertQueue: any[] = [];

  for (const sd of subdirs) {
    const folderPath = path.join(PRODUCTS_DIR, sd);
    const files = fs.readdirSync(folderPath).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (files.length === 0) continue;

    // Find candidate medicines for this company
    // Check direct slug match or fuzzy company match
    let companyMeds = companyMedsMap.get(sd);
    if (!companyMeds) {
      // Try finding by partial word match
      const keyWords = sd.split('-').filter(w => w.length > 2 && w !== 'ltd' && w !== 'pvt' && w !== 'limited' && w !== 'pharmaceuticals' && w !== 'healthcare');
      for (const [cSlug, meds] of companyMedsMap.entries()) {
        if (keyWords.some(kw => cSlug.includes(kw))) {
          companyMeds = meds;
          break;
        }
      }
    }

    if (!companyMeds || companyMeds.length === 0) {
      unmappedFiles += files.length;
      continue;
    }

    // Index company medicines by clean slug and words for sub-millisecond lookup
    const medSlugMap = new Map<string, any[]>();
    for (const med of companyMeds) {
      const mSlug = slugify(med.name);
      if (!medSlugMap.has(mSlug)) medSlugMap.set(mSlug, []);
      medSlugMap.get(mSlug)!.push(med);

      // Also map by primary brand word
      const brandWord = clean(med.name).split(' ')[0]?.toLowerCase();
      if (brandWord && brandWord.length > 2) {
        if (!medSlugMap.has(brandWord)) medSlugMap.set(brandWord, []);
        medSlugMap.get(brandWord)!.push(med);
      }
    }

    for (const file of files) {
      totalScanned++;
      const relPath = `products/${sd}/${file}`;
      const dbRelPath = `/products/${sd}/${file}`;

      if (existingPathSet.has(relPath.toLowerCase()) || existingPathSet.has(dbRelPath.toLowerCase().replace(/^\/+/, ''))) {
        alreadyLinked++;
        continue;
      }

      const { stem, face } = parseFace(file);
      const cleanStem = stem.replace(/[-_]/g, ' ');
      const stemWords = cleanStem.split(/\s+/).filter(Boolean);
      const stemBrand = stemWords[0]?.toLowerCase();

      // Find candidates from company medicines
      const candidates = medSlugMap.get(slugify(stem)) || (stemBrand ? medSlugMap.get(stemBrand) : null);
      if (!candidates || candidates.length === 0) {
        unmappedFiles++;
        continue;
      }

      // Find best candidate using computeConfidence
      let bestMed: any = null;
      let highestScore = -1;
      let bestConfidence: any = null;

      for (const cand of candidates) {
        const conf = catalogImageService.computeConfidence(
          {
            name: cand.name,
            manufacturer: cand.manufacturer,
            strength: cand.strength,
            packaging: cand.packaging
          },
          {
            name: cleanStem,
            manufacturer: cand.manufacturer,
            imagePath: relPath
          }
        );

        if (!conf.signals.dosageFormConflict && conf.signals.brandMatch && conf.confidenceScore > highestScore) {
          highestScore = conf.confidenceScore;
          bestMed = cand;
          bestConfidence = conf;
        }
      }

      if (bestMed && highestScore >= 50) {
        // Multi-angle slot management: assign primary if front or combo
        const existingCount = medToImageCount.get(bestMed.id) || 0;
        let isPrimary = 0;
        if (!medHasPrimarySet.has(bestMed.id) && (face === 'front' || face === 'combo')) {
          isPrimary = 1;
          medHasPrimarySet.add(bestMed.id);
        } else if (!medHasPrimarySet.has(bestMed.id) && existingCount === 0) {
          isPrimary = 1;
          medHasPrimarySet.add(bestMed.id);
        }

        insertQueue.push({
          medicineId: bestMed.id,
          companyName: bestMed.manufacturer,
          productName: bestMed.name,
          imagePath: dbRelPath,
          thumbnailPath: dbRelPath,
          confidenceScore: highestScore,
          reason: `Auto-linked from genuine packaging: ${bestConfidence.reason}`,
          imageType: face,
          isPrimary
        });

        medToImageCount.set(bestMed.id, existingCount + 1);
        existingPathSet.add(relPath.toLowerCase());
        newlyMatched++;
      } else {
        if (bestConfidence?.signals.dosageFormConflict) {
          skippedConflicts++;
        } else {
          unmappedFiles++;
        }
      }
    }
  }

  console.log('='.repeat(70));
  console.log('                        SCAN SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total Subdirectory Files Scanned: ${totalScanned}`);
  console.log(`Already Linked in Database:       ${alreadyLinked}`);
  console.log(`Newly Verified Packaging Files:   ${newlyMatched}`);
  console.log(`Skipped Dosage/Strength Conflicts: ${skippedConflicts}`);
  console.log(`Unmatched / Variant Files:        ${unmappedFiles}`);
  console.log('='.repeat(70));

  if (!isDryRun && insertQueue.length > 0) {
    console.log(`\nWriting ${insertQueue.length} verified packaging image records into SQLite in a single transaction...`);
    const t0 = Date.now();
    const tx = db.transaction(() => {
      for (const item of insertQueue) {
        insertStmt.run(
          item.medicineId,
          item.companyName,
          item.productName,
          item.imagePath,
          item.thumbnailPath,
          item.confidenceScore,
          item.reason,
          item.imageType,
          item.isPrimary
        );
      }
    });

    tx();
    const elapsed = Date.now() - t0;
    console.log(`🎉 Successfully inserted ${insertQueue.length} genuine packaging records in ${elapsed}ms!`);
  }
}

linkAllDiskImages().catch(console.error);
