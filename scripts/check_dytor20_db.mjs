import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const rows = db.prepare("SELECT * FROM catalog_images WHERE image_path LIKE '%dytor-20%'").all();
console.log(rows);
