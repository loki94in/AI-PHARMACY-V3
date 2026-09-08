import Database from 'better-sqlite3';

const db = new Database('./data/app.db');
const rows = db.prepare(`
  SELECT id, medicine_id, product_name, image_path, confidence_score, verification_status, verification_reason, matching_method
  FROM catalog_images
  WHERE product_name LIKE '%ABZORB%' OR product_name LIKE '%ALKOF%' OR product_name LIKE '%VICKS 115%'
`).all();

console.log(rows);
