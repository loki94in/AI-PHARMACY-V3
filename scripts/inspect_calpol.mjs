import Database from 'better-sqlite3';
const db = new Database('./data/app.db');
const rows = db.prepare("SELECT ci.id, ci.medicine_id, m.name, ci.product_name, ci.image_path, ci.is_active FROM catalog_images ci JOIN medicines m ON ci.medicine_id = m.id WHERE m.name LIKE '%CALPOL%'").all();
console.log(rows);
