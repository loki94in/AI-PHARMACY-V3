import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');

console.log('=== STARTING IMAGE CATALOG PURGE ===');

// 1. Clean frontend/public/products
const frontendProductsDir = path.join(ROOT_DIR, 'frontend', 'public', 'products');
let frontendDeleted = 0;
if (fs.existsSync(frontendProductsDir)) {
  const files = fs.readdirSync(frontendProductsDir);
  console.log(`Found ${files.length} files in frontend/public/products`);
  for (const file of files) {
    if (file === '.gitkeep') continue;
    try {
      fs.unlinkSync(path.join(frontendProductsDir, file));
      frontendDeleted++;
    } catch (err) {
      console.error(`Failed to delete ${file}:`, err);
    }
  }
}
console.log(`Deleted ${frontendDeleted} files from frontend/public/products.`);

// 2. Clean uploads/products
const uploadsProductsDir = path.join(ROOT_DIR, 'uploads', 'products');
let uploadsDeleted = 0;
if (fs.existsSync(uploadsProductsDir)) {
  const files = fs.readdirSync(uploadsProductsDir);
  console.log(`Found ${files.length} files in uploads/products`);
  for (const file of files) {
    if (file === '.gitkeep') continue;
    try {
      fs.unlinkSync(path.join(uploadsProductsDir, file));
      uploadsDeleted++;
    } catch (err) {
      console.error(`Failed to delete ${file}:`, err);
    }
  }
}
console.log(`Deleted ${uploadsDeleted} files from uploads/products.`);

// 3. Clear database tables
console.log('\nConnecting to database:', DB_PATH);
const db = new Database(DB_PATH);

const tablesToClear = [
  'catalog_images',
  'catalog_image_rejections',
  'image_review_history',
  'catalog_correction_log'
];

for (const table of tablesToClear) {
  try {
    const info = db.prepare(`SELECT count(*) as count FROM ${table}`).get();
    db.prepare(`DELETE FROM ${table}`).run();
    console.log(`Cleared table ${table} (removed ${info.count} rows).`);
  } catch (err) {
    console.warn(`Could not clear table ${table}:`, err.message);
  }
}

// 4. Verify medicines table is intact
const medCount = db.prepare('SELECT count(*) as count FROM medicines').get();
console.log(`\nVerification: Master medicines table has ${medCount.count} records (intact).`);

// 5. Final disk count verification
const remainingFrontend = fs.existsSync(frontendProductsDir) ? fs.readdirSync(frontendProductsDir).filter(f => f !== '.gitkeep').length : 0;
const remainingUploads = fs.existsSync(uploadsProductsDir) ? fs.readdirSync(uploadsProductsDir).filter(f => f !== '.gitkeep').length : 0;
console.log(`Remaining files in frontend/public/products: ${remainingFrontend}`);
console.log(`Remaining files in uploads/products: ${remainingUploads}`);

console.log('=== IMAGE CATALOG PURGE COMPLETE ===\n');
