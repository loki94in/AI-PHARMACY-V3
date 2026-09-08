import Database from 'better-sqlite3';

const db = new Database('./data/app.db');
const rows = db.prepare(`
  SELECT DISTINCT m.id, m.name, m.manufacturer
  FROM medicines m
  JOIN catalog_images ci ON ci.medicine_id = m.id
  WHERE ci.verification_status = 'REJECTED'
    AND m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
  ORDER BY m.id ASC
`).all();

console.log('Total Count:', rows.length);

const mfgCount = {};
for (const r of rows) {
  const k = (r.manufacturer || 'UNKNOWN').trim().toUpperCase();
  mfgCount[k] = (mfgCount[k] || 0) + 1;
}

const sorted = Object.entries(mfgCount).sort((a, b) => b[1] - a[1]);
console.log('Top Manufacturers:');
console.log(sorted.slice(0, 30));

console.log('\nSample items (first 40):');
rows.slice(0, 40).forEach((r, i) => console.log(`${i + 1}. [${r.id}] ${r.name} | ${r.manufacturer}`));

db.close();
