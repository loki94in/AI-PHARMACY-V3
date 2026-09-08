import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const db = new Database('./data/app.db');

const rejectedRows = db.prepare(`
  SELECT ci.id, ci.medicine_id, ci.product_name, ci.image_path, m.name as med_name, m.manufacturer as med_mfg
  FROM catalog_images ci
  JOIN medicines m ON m.id = ci.medicine_id
  WHERE ci.verification_status = 'REJECTED'
    AND m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
`).all();

console.log(`Total rejected rows for medicines with no active image: ${rejectedRows.length}`);

let onDiskCount = 0;
let missingDiskCount = 0;

for (const r of rejectedRows) {
  const cleanRel = r.image_path ? r.image_path.replace(/^\/+/, '') : '';
  const p1 = path.resolve('frontend/public', cleanRel);
  const p2 = path.resolve('frontend/public/products', path.basename(cleanRel));
  const exists = (fs.existsSync(p1) && fs.statSync(p1).size > 1000) || (fs.existsSync(p2) && fs.statSync(p2).size > 1000);
  if (exists) {
    onDiskCount++;
  } else {
    missingDiskCount++;
  }
}

console.log({
  totalRows: rejectedRows.length,
  existingFilesOnDisk: onDiskCount,
  missingFilesOnDisk: missingDiskCount
});

db.close();
