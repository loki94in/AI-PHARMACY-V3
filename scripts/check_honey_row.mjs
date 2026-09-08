import Database from 'better-sqlite3';

const db = new Database('./data/app.db');
const row = db.prepare(`SELECT * FROM catalog_images WHERE image_path LIKE '%dabur-honey-50gm%'`).all();
console.log(row);
