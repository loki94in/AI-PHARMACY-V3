import Database from 'better-sqlite3';

const db = new Database('./data/app.db');
const rejected = db.prepare(`
  SELECT DISTINCT m.id, m.name, m.manufacturer, m.generic_name, m.packaging, m.strength
  FROM medicines m
  JOIN catalog_images ci ON ci.medicine_id = m.id
  WHERE ci.verification_status = 'REJECTED'
    AND m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
  ORDER BY m.name ASC
`).all();

console.log('Total unique rejected medicines needing resolution:', rejected.length);

const groups = {};
for (const m of rejected) {
  const firstWord = m.name.trim().split(/\s+/)[0].toUpperCase();
  groups[firstWord] = (groups[firstWord] || 0) + 1;
}

const sortedGroups = Object.entries(groups).sort((a, b) => b[1] - a[1]);
console.log('Top brand/word groups:');
console.log(sortedGroups.slice(0, 35));
