import Database from 'better-sqlite3';

const db = new Database('./data/app.db');
const med = db.prepare(`SELECT * FROM medicines WHERE name LIKE '%ABZORB ANTI FUNGAL POWDER%'`).all();
console.log('Medicine:', med);

if (med.length > 0) {
  const images = db.prepare(`SELECT * FROM catalog_images WHERE medicine_id = ?`).all(med[0].id);
  console.log('Images:', images);
}
