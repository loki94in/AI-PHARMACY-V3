import Database from 'better-sqlite3';

const db = new Database('./data/app.db');

const count = db.prepare(`SELECT count(*) as c FROM catalog_images WHERE is_active = 1`).get();
console.log('Current active catalog images:', count.c);

// How many rejected medicines still have no active image?
const rejectedCount = db.prepare(`
  SELECT count(DISTINCT m.id) as c
  FROM medicines m
  JOIN catalog_images ci ON ci.medicine_id = m.id
  WHERE ci.verification_status = 'REJECTED'
    AND m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
`).get();
console.log('Medicines needing active image:', rejectedCount.c);
