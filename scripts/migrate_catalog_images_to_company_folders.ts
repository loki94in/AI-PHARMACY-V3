#!/usr/bin/env node

/**
 * scripts/migrate_catalog_images_to_company_folders.ts
 *
 * Migrates flat catalog images from:
 *   frontend/public/products/<filename>.jpg
 *   uploads/products/<filename>.jpg
 * Into clean, per-company subfolders:
 *   frontend/public/products/<company-slug>/<filename>.jpg
 *   uploads/products/<company-slug>/<filename>.jpg
 *
 * And updates catalog_images.image_path and thumbnail_path in data/app.db.
 *
 * Usage:
 *   npx tsx scripts/migrate_catalog_images_to_company_folders.ts --dry-run
 *   npx tsx scripts/migrate_catalog_images_to_company_folders.ts
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const FRONTEND_PRODUCTS = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const UPLOADS_PRODUCTS = path.join(ROOT_DIR, 'uploads', 'products');

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function safeMoveFile(src: string, dest: string) {
  if (!fs.existsSync(src)) return false;
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  try {
    fs.renameSync(src, dest);
    return true;
  } catch {
    try {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      return true;
    } catch (e) {
      return false;
    }
  }
}

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log('===============================================================');
  console.log('      CATALOG IMAGES -> PER-COMPANY FOLDER MIGRATION');
  console.log('===============================================================');
  console.log(`Database: ${DB_PATH}`);
  console.log(`Mode    : ${isDryRun ? 'DRY-RUN (no changes made)' : 'LIVE MIGRATION'}`);
  console.log('');

  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 30000');

  const rows = db.prepare(`
    SELECT id, medicine_id, company_name, image_path, thumbnail_path
    FROM catalog_images
    WHERE image_path IS NOT NULL
  `).all() as Array<{
    id: number;
    medicine_id: number;
    company_name: string;
    image_path: string;
    thumbnail_path: string;
  }>;

  console.log(`Found ${rows.length} total catalog_images records in database.`);

  let skippedAlreadyMigrated = 0;
  let frontendMoved = 0;
  let uploadsMoved = 0;
  let missingOnDisk = 0;

  const updates: Array<{ id: number; newImagePath: string; newThumbPath: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawPath = (row.image_path || '').replace(/\\/g, '/');

    // Check if path already contains a subfolder under products/ (e.g. /products/sun-pharma/xyz.jpg)
    const match = rawPath.match(/^\/?products\/([^\/]+)\/(.+)$/i);
    if (match) {
      skippedAlreadyMigrated++;
      continue;
    }

    const fileName = path.basename(rawPath);
    if (!fileName || fileName === '.' || fileName === 'products') {
      continue;
    }

    const companyName = row.company_name || 'general';
    const companySlug = slugify(companyName) || 'general';

    const newRelPath = `/products/${companySlug}/${fileName}`;
    const newThumbPath = `/products/${companySlug}/${path.basename(row.thumbnail_path || fileName)}`;

    // Paths on disk
    const oldFrontend = path.join(FRONTEND_PRODUCTS, fileName);
    const newFrontend = path.join(FRONTEND_PRODUCTS, companySlug, fileName);

    const oldUploads = path.join(UPLOADS_PRODUCTS, fileName);
    const newUploads = path.join(UPLOADS_PRODUCTS, companySlug, fileName);

    let foundAny = false;

    if (!isDryRun) {
      if (fs.existsSync(oldFrontend)) {
        if (safeMoveFile(oldFrontend, newFrontend)) {
          frontendMoved++;
          foundAny = true;
        }
      } else if (fs.existsSync(newFrontend)) {
        foundAny = true;
      }

      if (fs.existsSync(oldUploads)) {
        if (safeMoveFile(oldUploads, newUploads)) {
          uploadsMoved++;
          foundAny = true;
        }
      } else if (fs.existsSync(newUploads)) {
        foundAny = true;
      }

      if (!foundAny) {
        missingOnDisk++;
      }

      updates.push({ id: row.id, newImagePath: newRelPath, newThumbPath: newThumbPath });
    } else {
      if (fs.existsSync(oldFrontend)) frontendMoved++;
      if (fs.existsSync(oldUploads)) uploadsMoved++;
      updates.push({ id: row.id, newImagePath: newRelPath, newThumbPath: newThumbPath });
    }

    if ((i + 1) % 5000 === 0 || i === rows.length - 1) {
      console.log(`[Progress] Processed ${i + 1}/${rows.length} records... (Frontend moved: ${frontendMoved}, Uploads moved: ${uploadsMoved})`);
    }
  }

  console.log('\n===============================================================');
  console.log('                     MIGRATION SUMMARY');
  console.log('===============================================================');
  console.log(`Already migrated        : ${skippedAlreadyMigrated}`);
  console.log(`Frontend images moved   : ${frontendMoved}`);
  console.log(`Uploads images moved    : ${uploadsMoved}`);
  console.log(`DB records to update    : ${updates.length}`);
  if (missingOnDisk > 0) {
    console.log(`Missing on disk notice  : ${missingOnDisk}`);
  }

  if (!isDryRun && updates.length > 0) {
    console.log(`\nWriting ${updates.length} updates to SQLite database in a transaction...`);
    const updateStmt = db.prepare(`
      UPDATE catalog_images
      SET image_path = ?, thumbnail_path = ?
      WHERE id = ?
    `);

    const runBatch = db.transaction((batch: typeof updates) => {
      for (const u of batch) {
        updateStmt.run(u.newImagePath, u.newThumbPath, u.id);
      }
    });

    runBatch(updates);
    console.log('✅ SQLite update complete! All catalog_images now point to per-company folders.');
  }

  console.log('===============================================================\n');
}

run().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
