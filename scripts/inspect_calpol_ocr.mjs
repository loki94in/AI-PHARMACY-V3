import Database from 'better-sqlite3';
const db = new Database('./data/app.db');
const row = db.prepare("SELECT id, medicine_id, product_name, image_path, ocr_text, confidence_score FROM catalog_images WHERE id IN (575, 576, 577, 12302)").all();
console.log(row);
