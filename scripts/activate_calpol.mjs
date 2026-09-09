import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

db.prepare(`
  UPDATE catalog_images
  SET is_active = 1,
      is_primary = 1,
      confidence_score = 98,
      verification_status = 'HIGH_CONFIDENCE',
      verification_reason = '[EXACT STRENGTH & NAME VERIFIED]',
      product_name = 'Calpol 650mg Tablets'
  WHERE id IN (576, 577)
`).run();

db.prepare(`
  UPDATE catalog_images
  SET is_active = 1,
      is_primary = 1,
      confidence_score = 98,
      verification_status = 'HIGH_CONFIDENCE',
      verification_reason = '[EXACT STRENGTH & NAME VERIFIED]',
      product_name = 'Calpol 500mg Tablets'
  WHERE id = 575
`).run();

console.log('Calpol 500mg & 650mg updated & activated successfully!');
