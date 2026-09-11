import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');

console.log('=== CLEANING ALL REMAINING TEST & UPLOAD IMAGES ===\n');

const targetDirs = [
  'SAMPLE IMAGE',
  'uploads/prescriptions',
  'data/audit_images',
  'scratch/compressed_test'
];

let totalDeleted = 0;
let totalBytes = 0;

for (const relDir of targetDirs) {
  const absDir = path.join(ROOT_DIR, relDir);
  if (fs.existsSync(absDir)) {
    const files = fs.readdirSync(absDir).filter(f => f !== '.gitkeep');
    for (const file of files) {
      const filePath = path.join(absDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          totalBytes += stats.size;
          fs.unlinkSync(filePath);
          totalDeleted++;
        }
      } catch (err) {
        console.error(`Failed to delete ${filePath}:`, err);
      }
    }
    console.log(`Cleaned ${relDir}: removed ${files.length} files.`);
  }
}

// Clean loose images in root
const looseImages = ['combined_medicines.png', 'combined_medicines_horizontal.png'];
for (const file of looseImages) {
  const filePath = path.join(ROOT_DIR, file);
  if (fs.existsSync(filePath)) {
    try {
      totalBytes += fs.statSync(filePath).size;
      fs.unlinkSync(filePath);
      totalDeleted++;
      console.log(`Cleaned loose image: ${file}`);
    } catch (err) {
      console.error(`Failed to delete ${file}:`, err);
    }
  }
}

// Reset ocr_audit_queue table and audit_queue.json
const db = new Database(DB_PATH);
try {
  const count = db.prepare('SELECT count(*) as c FROM ocr_audit_queue').get().c;
  db.prepare('DELETE FROM ocr_audit_queue').run();
  console.log(`Cleared ocr_audit_queue table (removed ${count} rows).`);
} catch (err) {
  console.warn('Could not clear ocr_audit_queue:', err.message);
}

const auditJson = path.join(ROOT_DIR, 'data', 'audit_queue.json');
if (fs.existsSync(auditJson)) {
  fs.writeFileSync(auditJson, '[]');
}

const mbFreed = (totalBytes / (1024 * 1024)).toFixed(2);
console.log(`\n=== PURGE COMPLETE: Deleted ${totalDeleted} images, freed ${mbFreed} MB of disk space! ===\n`);
