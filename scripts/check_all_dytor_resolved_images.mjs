import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const meds = db.prepare("SELECT id, name, manufacturer, strength FROM medicines WHERE name LIKE '%DYTOR%'").all();

console.log(`Found ${meds.length} Dytor medicines:`);
for (const m of meds) {
  // Check primary active image
  const primaryImg = db.prepare(`
    SELECT id, image_path, product_name, is_primary, is_active, confidence_score
    FROM catalog_images
    WHERE medicine_id = ? AND is_active = 1
    ORDER BY is_primary DESC, id ASC
    LIMIT 1
  `).get(m.id);

  // Check all images
  const allImgs = db.prepare(`
    SELECT id, image_path, product_name, is_primary, is_active
    FROM catalog_images
    WHERE medicine_id = ?
  `).all(m.id);

  console.log(`Med [${m.id}] "${m.name}"`);
  console.log(`  -> Primary Image:`, primaryImg ? `${primaryImg.image_path} ("${primaryImg.product_name}") [Primary: ${primaryImg.is_primary}]` : 'NO ACTIVE IMAGE');
  if (allImgs.length > 1) {
    console.log(`  -> All Images (${allImgs.length}):`, allImgs.map(i => `${i.id}: ${i.image_path} (act:${i.is_active}, pri:${i.is_primary})`).join(', '));
  }
}
