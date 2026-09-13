import Database from 'better-sqlite3';

const db = new Database('data/app.db');

const rows = db.prepare(`
  SELECT manufacturer, count(*) as total,
    SUM(CASE WHEN id IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1) THEN 1 ELSE 0 END) as with_img,
    SUM(CASE WHEN id IN (SELECT medicine_id FROM catalog_harvest_state) THEN 1 ELSE 0 END) as processed
  FROM medicines
  WHERE manufacturer IS NOT NULL 
    AND TRIM(manufacturer) != ''
    AND manufacturer NOT LIKE '%FOOT WEAR%'
    AND manufacturer NOT LIKE '%ORTHOTICS%'
  GROUP BY manufacturer
  ORDER BY total DESC
  LIMIT 30
`).all();

console.log('Top Companies by Medicine Count:');
rows.forEach((r, i) => {
  const pending = r.total - r.processed;
  console.log(`${String(i + 1).padStart(2)}. ${r.manufacturer.padEnd(35)} | Total: ${String(r.total).padStart(4)} | With Img: ${String(r.with_img).padStart(4)} | Pending: ${String(pending).padStart(4)}`);
});
