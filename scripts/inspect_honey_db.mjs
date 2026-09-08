import Database from 'better-sqlite3';

const db = new Database('./data/app.db');
const rows = db.prepare(`SELECT * FROM catalog_images WHERE image_path LIKE '%dabur-honey%'`).all();
console.log(rows);
