import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const rows = db.prepare("SELECT id, medicine_id, product_name, image_path, is_active FROM catalog_images WHERE image_path LIKE '%candidate%'").all();
console.log('Candidate rows in catalog_images:');
console.log(rows);
