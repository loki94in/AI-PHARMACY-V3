import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const rows = db.prepare("SELECT id, medicine_id, product_name, image_path, source_url, previous_image_url FROM catalog_images WHERE id IN (1222, 1223, 5927, 5928)").all();
console.log(rows);
