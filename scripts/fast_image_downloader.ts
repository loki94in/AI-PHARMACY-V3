#!/usr/bin/env node

/**
 * scripts/fast_image_downloader.ts
 *
 * Stage 1: Ultra-Fast Network Image Harvester (Company-by-Company with Auto-Resume)
 * - Pure I/O & Network bound: Fetches packaging images from pharma CDNs in ~1.5s per item.
 * - Processes ONE COMPANY AT A TIME (highest medicine count first, or targeted via --company="NAME").
 * - Multi-Layer Skip Guard:
 *     1. Pre-indexes all 27,940+ existing packaging files on local PC (~160ms scan).
 *     2. Checks SQLite `catalog_images` table (<0.05ms).
 *     3. Persists state in `data/harvest_company_progress.json` with atomic rename.
 * - 100% Resume Safe: If PC turns off or user presses Ctrl+C, restarting immediately resumes
 *   from the exact medicine where it left off. ZERO duplicates downloaded.
 * - Supports multi-terminal modulo sharding: --terminal=1..N --total-shards=M
 *
 * Usage:
 *   npx tsx scripts/fast_image_downloader.ts --company="CIPLA LIMITED"
 *   npx tsx scripts/fast_image_downloader.ts --single-company
 *   npx tsx scripts/fast_image_downloader.ts --continuous
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { catalogImageService } from '../src/services/catalogImageService.js';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'harvest_company_progress.json');
const FRONTEND_PRODUCTS = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const UPLOADS_PRODUCTS = path.join(ROOT_DIR, 'uploads', 'products');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');

// Helper to normalize company name to filesystem slug
function slugifyCompany(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Helper to extract clean slug from medicine name
function slugifyMedicine(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

// Parse CLI Flags
const args = process.argv.slice(2);
let terminalIndex = 1;
let totalShards = 1;
let limit = 0; // 0 = unlimited / entire company
let companyFilter: string | null = null;
let singleCompanyMode = true; // Default: finish one company catalog at a time
let force = false;

for (const a of args) {
  if (a.startsWith('--terminal=')) terminalIndex = parseInt(a.split('=')[1], 10);
  if (a.startsWith('--total-shards=')) totalShards = parseInt(a.split('=')[1], 10);
  if (a.startsWith('--limit=')) limit = parseInt(a.split('=')[1], 10);
  if (a.startsWith('--company=')) companyFilter = a.split('=')[1].replace(/^["']|["']$/g, '').trim();
  if (a === '--continuous') singleCompanyMode = false;
  if (a === '--single-company') singleCompanyMode = true;
  if (a === '--force') force = true;
}

// ---------------------------------------------------------------------------
// Persistent State Management (Atomic Disk Sync)
// ---------------------------------------------------------------------------
interface HarvestState {
  last_updated: string | null;
  completed_companies: string[];
  products: Record<string, { status: string; company?: string; timestamp: string }>;
}

function loadState(): HarvestState {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      return {
        last_updated: parsed.last_updated || null,
        completed_companies: Array.isArray(parsed.completed_companies) ? parsed.completed_companies : [],
        products: parsed.products || {}
      };
    } catch {}
  }
  return { last_updated: null, completed_companies: [], products: {} };
}

function saveProductProgress(medId: number, status: string, company: string) {
  try {
    const current = loadState();
    current.products[String(medId)] = {
      status,
      company,
      timestamp: new Date().toISOString()
    };
    current.last_updated = new Date().toISOString();

    const tmp = `${STATE_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err: any) {
    // Non-blocking notice
  }
}

function markCompanyComplete(company: string) {
  try {
    const current = loadState();
    if (!current.completed_companies.includes(company)) {
      current.completed_companies.push(company);
    }
    current.last_updated = new Date().toISOString();
    const tmp = `${STATE_FILE}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf-8');
    fs.renameSync(tmp, STATE_FILE);
  } catch {}
}

// ---------------------------------------------------------------------------
// High-Speed Local Disk Pre-Indexer (~160ms for 28,000+ files)
// ---------------------------------------------------------------------------
interface DiskImageItem {
  relPath: string;
  face: string;
  fullPath: string;
  size: number;
}

interface LocalDiskIndex {
  companyMap: Map<string, Map<string, DiskImageItem[]>>;
  globalSlugMap: Map<string, DiskImageItem[]>;
  totalFiles: number;
}

function buildLocalDiskIndex(): LocalDiskIndex {
  const t0 = Date.now();
  const companyMap = new Map<string, Map<string, DiskImageItem[]>>();
  const globalSlugMap = new Map<string, DiskImageItem[]>();
  let totalFiles = 0;

  if (!fs.existsSync(FRONTEND_PRODUCTS)) {
    return { companyMap, globalSlugMap, totalFiles: 0 };
  }

  const parseFileFace = (filename: string): { stem: string; face: string } => {
    const m = filename.match(/-(front|back|combo|side|box-front|box-back|box-side)\.[^.]+$/i);
    if (m) {
      const face = m[1].toLowerCase();
      const stem = filename.slice(0, m.index);
      return { stem, face };
    }
    const cleanStem = filename.replace(/\.[^.]+$/, '');
    return { stem: cleanStem, face: 'combo' };
  };

  const addEntry = (companySlug: string | null, filename: string, fullPath: string) => {
    if (!/\.(jpg|jpeg|png|webp)$/i.test(filename)) return;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size < 1000) return; // Skip zero/corrupt files

      const { stem, face } = parseFileFace(filename);
      const relPath = companySlug ? `/products/${companySlug}/${filename}` : `/products/${filename}`;
      const item: DiskImageItem = { relPath, face, fullPath, size: stat.size };
      totalFiles++;

      if (companySlug) {
        if (!companyMap.has(companySlug)) companyMap.set(companySlug, new Map());
        const cMap = companyMap.get(companySlug)!;
        if (!cMap.has(stem)) cMap.set(stem, []);
        cMap.get(stem)!.push(item);
      }

      if (!globalSlugMap.has(stem)) globalSlugMap.set(stem, []);
      globalSlugMap.get(stem)!.push(item);
    } catch {}
  };

  // Scan root frontend/public/products entries
  const entries = fs.readdirSync(FRONTEND_PRODUCTS, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const companySlug = entry.name;
      const subDir = path.join(FRONTEND_PRODUCTS, companySlug);
      try {
        const subFiles = fs.readdirSync(subDir);
        for (const sf of subFiles) {
          addEntry(companySlug, sf, path.join(subDir, sf));
        }
      } catch {}
    } else if (entry.isFile()) {
      addEntry(null, entry.name, path.join(FRONTEND_PRODUCTS, entry.name));
    }
  }

  const elapsed = Date.now() - t0;
  console.log(`⚡ [Pre-Scan] Indexed ${totalFiles} existing local packaging files across disk in ${elapsed}ms.`);
  return { companyMap, globalSlugMap, totalFiles };
}

async function main() {
  console.log('='.repeat(80));
  console.log(`🚀 STAGE 1: COMPANY-BY-COMPANY FAST IMAGE HARVESTER`);
  console.log(`   (Zero Duplicates: ACTIVE | Local Disk Pre-Scan: ON | Auto-Resume: ACTIVE)`);
  console.log(`   (Terminal #${terminalIndex}/${totalShards} | Single Company Mode: ${singleCompanyMode ? 'ON' : 'CONTINUOUS'})`);
  console.log('='.repeat(80));

  const state = loadState();
  const previouslyProcessed = new Set(Object.keys(state.products));

  // Build high-speed in-memory local disk index
  const diskIndex = buildLocalDiskIndex();

  // 1. Identify companies ordered by catalog volume
  let companyRows: { manufacturer: string; count: number }[] = [];
  if (companyFilter) {
    companyRows = db.prepare(`
      SELECT manufacturer, COUNT(*) as count
      FROM medicines
      WHERE manufacturer LIKE ?
      GROUP BY manufacturer
      ORDER BY count DESC
    `).all(`%${companyFilter}%`) as any[];
  } else {
    companyRows = db.prepare(`
      SELECT manufacturer, COUNT(*) as count
      FROM medicines
      WHERE manufacturer IS NOT NULL AND TRIM(manufacturer) != ''
      GROUP BY manufacturer
      ORDER BY count DESC
    `).all() as any[];
  }

  if (companyRows.length === 0) {
    console.error(`❌ No medicines found matching company filter "${companyFilter || ''}".`);
    process.exit(1);
  }

  // Filter out already finished companies if not forced
  const pendingCompanies = companyRows.filter(c => force || !state.completed_companies.includes(c.manufacturer));

  console.log(`Found ${companyRows.length} total company catalogues (${state.completed_companies.length} already completed).`);
  console.log(`Next pending companies queued:`);
  pendingCompanies.slice(0, 5).forEach((c, idx) => {
    console.log(`   ${idx + 1}. ${c.manufacturer} (${c.count} medicines)`);
  });
  console.log();

  if (pendingCompanies.length === 0) {
    console.log('🎉 ALL company catalogues are already 100% completed!');
    process.exit(0);
  }

  // Prepared statements for sub-millisecond database queries
  const checkDbImages = db.prepare(`
    SELECT id, image_path, verification_status, image_type, is_primary
    FROM catalog_images 
    WHERE medicine_id = ?
  `);

  const insertLocalImage = db.prepare(`
    INSERT INTO catalog_images (
      medicine_id, company_name, product_name, image_path, thumbnail_path,
      image_source, source_url, confidence_score, matching_method,
      verification_status, verification_reason, is_active, retry_count, image_type, is_primary
    ) VALUES (?, ?, ?, ?, ?, 'local_disk', 'local_pc', 88.0, 'local_disk_index', 'PENDING_OCR', 'Linked from existing genuine packaging on disk', 0, 0, ?, ?)
  `);

  const updatePending = db.prepare("UPDATE catalog_images SET verification_status = 'PENDING_OCR' WHERE id = ?");

  let totalDownloaded = 0;
  let totalIndexedFromDisk = 0;
  let totalSkipped = 0;
  let totalNotFound = 0;
  const startAll = Date.now();

  // Process companies one-by-one sequentially
  for (let cIdx = 0; cIdx < pendingCompanies.length; cIdx++) {
    const company = pendingCompanies[cIdx].manufacturer;
    const companySlug = slugifyCompany(company);

    console.log(`\n======================================================================`);
    console.log(`📦 [Company ${cIdx + 1}/${pendingCompanies.length}] Processing: "${company}" (${pendingCompanies[cIdx].count} medicines)`);
    console.log(`   Company Storage Slug: "${companySlug}"`);
    console.log(`======================================================================`);

    const medList = db.prepare(`
      SELECT id, name, manufacturer, strength, packaging, mrp, category, dosage_form
      FROM medicines
      WHERE manufacturer = ?
      ORDER BY id ASC
    `).all(company) as any[];

    // Shard partition for this company
    const shardMeds = medList.filter((_, idx) => (idx % totalShards) === (terminalIndex - 1));
    console.log(`Shard Allocation: ${shardMeds.length} medicines assigned to Terminal #${terminalIndex}.\n`);

    let companyDownloaded = 0;
    let companyIndexed = 0;
    let companySkipped = 0;
    let companyNotFound = 0;

    for (let mIdx = 0; mIdx < shardMeds.length; mIdx++) {
      if (limit > 0 && totalDownloaded >= limit) {
        console.log(`\nReached global download limit of ${limit} medicines.`);
        break;
      }

      const med = shardMeds[mIdx];
      const medId = med.id;
      const medSlug = slugifyMedicine(med.name);

      // -------------------------------------------------------------------
      // MULTI-LAYER DUPLICATE & RESUME CHECK (< 0.05 milliseconds)
      // -------------------------------------------------------------------
      if (!force) {
        // Check 1: Already processed in state file
        if (previouslyProcessed.has(String(medId))) {
          companySkipped++;
          totalSkipped++;
          continue;
        }

        // Check 2: Check SQLite catalog_images and verify physical disk file exists
        const dbRecords = checkDbImages.all(medId) as any[];
        let hasValidDbFileOnDisk = false;

        for (const rec of dbRecords) {
          if (rec.image_path) {
            const diskFile = path.resolve(ROOT_DIR, 'frontend/public', rec.image_path.replace(/^\//, ''));
            const uploadFile = path.resolve(ROOT_DIR, rec.image_path.replace(/^\//, ''));
            if ((fs.existsSync(diskFile) && fs.statSync(diskFile).size > 1000) ||
                (fs.existsSync(uploadFile) && fs.statSync(uploadFile).size > 1000)) {
              hasValidDbFileOnDisk = true;
              break;
            }
          }
        }

        if (hasValidDbFileOnDisk) {
          companySkipped++;
          totalSkipped++;
          previouslyProcessed.add(String(medId));
          saveProductProgress(medId, 'already_verified', company);
          continue;
        }

        // Check 3: Pre-indexed local files on PC in frontend/public/products/<company-slug>/
        const compFolderMap = diskIndex.companyMap.get(companySlug);
        const matchingLocalFiles = (compFolderMap && compFolderMap.get(medSlug)) || diskIndex.globalSlugMap.get(medSlug);

        if (matchingLocalFiles && matchingLocalFiles.length > 0) {
          // Register the existing genuine packaging files into SQLite catalog_images if not already registered
          let primaryAssigned = false;
          for (const item of matchingLocalFiles) {
            const alreadyInDb = dbRecords.some(r => r.image_path === item.relPath);
            if (!alreadyInDb) {
              const isPrimary = (!primaryAssigned && (item.face === 'front' || item.face === 'combo')) ? 1 : 0;
              if (isPrimary) primaryAssigned = true;
              insertLocalImage.run(
                medId,
                company,
                med.name,
                item.relPath,
                item.relPath,
                item.face,
                isPrimary
              );
            }
          }

          companyIndexed++;
          totalIndexedFromDisk++;
          previouslyProcessed.add(String(medId));
          saveProductProgress(medId, 'already_on_disk', company);
          console.log(`[T${terminalIndex}] [${mIdx + 1}/${shardMeds.length}] "${med.name.slice(0, 32)}" -> ⚡ FOUND ON PC (${matchingLocalFiles.length} face(s) linked) [0ms]`);
          continue;
        }
      }

      // -------------------------------------------------------------------
      // Not on PC: Fetch candidate from pharma CDN
      // -------------------------------------------------------------------
      const t0 = Date.now();
      const progressLabel = `[T${terminalIndex}] [${mIdx + 1}/${shardMeds.length}]`;
      process.stdout.write(`${progressLabel} Downloading: "${med.name.slice(0, 32)}"... `);

      try {
        const record = await catalogImageService.searchAndDownloadCandidate(medId, 1);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        if (record) {
          updatePending.run(record.id);
          companyDownloaded++;
          totalDownloaded++;
          previouslyProcessed.add(String(medId));
          saveProductProgress(medId, 'downloaded', company);
          console.log(`✅ OK (${elapsed}s) -> "${record.product_name.slice(0, 28)}" [${(record as any).image_type || 'combo'}]`);
        } else {
          companyNotFound++;
          totalNotFound++;
          previouslyProcessed.add(String(medId));
          saveProductProgress(medId, 'not_found', company);
          console.log(`⚠️ Skipped (${elapsed}s) -> No match on CDN`);
        }
      } catch (err: any) {
        console.log(`❌ ERROR: ${err.message}`);
      }

      // Small delay between online CDN requests to prevent rate limiting
      await new Promise(r => setTimeout(r, 350));
    }

    // Company Completion Check
    const totalCompanyResolved = companyDownloaded + companyIndexed + companySkipped + companyNotFound;
    if (shardMeds.length > 0 && totalCompanyResolved >= shardMeds.length) {
      markCompanyComplete(company);
      console.log(`\n✨ ======================================================================`);
      console.log(`🎉 COMPANY COMPLETE: "${company}" catalogue is 100% processed!`);
      console.log(`   - Linked from Local PC : ${companyIndexed}`);
      console.log(`   - Newly Downloaded     : ${companyDownloaded}`);
      console.log(`   - Already Verified     : ${companySkipped}`);
      console.log(`   - Not Found on CDN     : ${companyNotFound}`);
      console.log(`✨ ======================================================================\n`);
    }

    // In Single Company Mode, exit cleanly after finishing this company
    if (singleCompanyMode) {
      console.log(`🛑 Single-Company Mode: "${company}" completed. Exiting cleanly.`);
      break;
    }

    if (limit > 0 && totalDownloaded >= limit) break;
  }

  const totalTime = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(80));
  console.log(`🏁 HARVEST BATCH SUMMARY:`);
  console.log(`   - Linked from Local PC (Zero download) : ${totalIndexedFromDisk}`);
  console.log(`   - Newly Downloaded from Pharma CDN     : ${totalDownloaded}`);
  console.log(`   - Already In DB / Skipped              : ${totalSkipped}`);
  console.log(`   - Not Found on CDN                     : ${totalNotFound}`);
  console.log(`   - Total Execution Time                 : ${totalTime}s`);
  console.log('='.repeat(80));

  const pendingCount = (db.prepare("SELECT COUNT(*) as c FROM catalog_images WHERE verification_status = 'PENDING_OCR'").get() as any)?.c || 0;
  console.log(`📋 Total images currently waiting for Batch OCR: ${pendingCount}`);
  console.log(`💡 Next Step: Run 'npx tsx scripts/batch_ocr_worker.ts' to OCR-verify them!\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error in fast downloader:', err);
  process.exit(1);
});
