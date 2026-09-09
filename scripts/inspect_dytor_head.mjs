import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const rows = db.prepare(`
  SELECT ci.id, ci.medicine_id, m.name as med_name, ci.product_name, ci.image_path, ci.is_active, ci.confidence_score
  FROM catalog_images ci
  JOIN medicines m ON ci.medicine_id = m.id
  WHERE m.name LIKE '%DYTOR%'
  LIMIT 15
`).all();

rows.forEach(r => console.log(JSON.stringify(r)));
