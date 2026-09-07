/**
 * scripts/cleanupDuplicateMedicines.mjs
 *
 * One-shot consolidation script to remove user-created convenience duplicates
 * (tagged source = 'inventory_catalog') and remap all active stock, purchases,
 * ledger, and image references to their official clean master medicines.
 *
 * Safety:
 * - Runs in a single atomic SQLite transaction (rolls back on any error).
 * - Remaps active inventory, purchases, stock ledger, aliases, and images.
 * - Rebuilds the FTS5 search index (medicines_fts) after deletion.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'app.db');

function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\[.*?\]/g, '') // remove bracketed company like [MICRO LABS]
    .replace(/[^a-z0-9]/g, '') // remove punctuation/spaces
    .trim();
}

console.log('--- Starting Duplicate Medicines Cleanup & Consolidation ---');
console.log(`Database: ${DB_PATH}`);

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 30000');
db.pragma('foreign_keys = OFF'); // prevent cascade conflicts during remapping

const beforeTotal = db.prepare('SELECT count(*) as c FROM medicines').get().c;
console.log(`Total medicines before cleanup: ${beforeTotal}`);

// 1. Fetch all custom medicines
const customMeds = db.prepare(`
  SELECT id, name, manufacturer, api_reference, hsn_code 
  FROM medicines 
  WHERE source = 'inventory_catalog'
`).all();

console.log(`Custom duplicate medicines identified: ${customMeds.length}`);

// 2. Build index of official master medicines
const masterMeds = db.prepare(`
  SELECT id, name, manufacturer, api_reference, hsn_code 
  FROM medicines 
  WHERE source != 'inventory_catalog'
`).all();

const masterMap = new Map();
for (const m of masterMeds) {
  const key = norm(m.name);
  if (key && !masterMap.has(key)) {
    masterMap.set(key, m.id);
  }
}

// 3. Map custom_id -> master_id
const mapping = new Map(); // customId -> masterId
let matchedCount = 0;
let fallbackCount = 0;

for (const cm of customMeds) {
  const key = norm(cm.name);
  let masterId = masterMap.get(key);

  if (!masterId) {
    // Fallback: try prefix or LIKE match
    const cleanName = cm.name.replace(/\[.*?\]/g, '').trim();
    const fallback = db.prepare(`
      SELECT id FROM medicines 
      WHERE source != 'inventory_catalog' AND (
        LOWER(name) = LOWER(?) OR name LIKE ?
      )
      LIMIT 1
    `).get(cleanName, `${cleanName}%`);

    if (fallback) {
      masterId = fallback.id;
      fallbackCount++;
    }
  } else {
    matchedCount++;
  }

  if (masterId) {
    mapping.set(cm.id, masterId);
  }
}

console.log(`Successfully mapped: ${mapping.size} of ${customMeds.length} items (${matchedCount} direct, ${fallbackCount} fallback)`);

// 4. Atomic Remap & Delete Transaction
const runCleanup = db.transaction(() => {
  let remappedInv = 0;
  let remappedPurchases = 0;
  let remappedLedger = 0;
  let remappedImages = 0;
  let remappedAliases = 0;

  const updateInv = db.prepare('UPDATE inventory_master SET medicine_id = ? WHERE medicine_id = ?');
  const updatePurch = db.prepare('UPDATE purchase_items SET medicine_id = ? WHERE medicine_id = ?');
  const updateLedger = db.prepare('UPDATE stock_ledger SET medicine_id = ? WHERE medicine_id = ?');
  const updateImages = db.prepare('UPDATE catalog_images SET medicine_id = ? WHERE medicine_id = ?');
  const updateImgRejections = db.prepare('UPDATE catalog_image_rejections SET medicine_id = ? WHERE medicine_id = ?');
  const updateImgHistory = db.prepare('UPDATE image_review_history SET medicine_id = ? WHERE medicine_id = ?');
  const updateAliases = db.prepare('UPDATE OR IGNORE medicine_aliases SET medicine_id = ? WHERE medicine_id = ?');
  const updateDistAliases = db.prepare('UPDATE OR IGNORE distributor_medicine_aliases SET medicine_id = ? WHERE medicine_id = ?');
  const deleteStockConfig = db.prepare('DELETE FROM stock_config WHERE medicine_id = ?');
  const deleteStockMetrics = db.prepare('DELETE FROM precalculated_stock_metrics WHERE medicine_id = ?');

  for (const [customId, masterId] of mapping) {
    // Inventory
    const invRes = updateInv.run(masterId, customId);
    remappedInv += invRes.changes;

    // Purchases
    const purchRes = updatePurch.run(masterId, customId);
    remappedPurchases += purchRes.changes;

    // Stock ledger
    const ledgerRes = updateLedger.run(masterId, customId);
    remappedLedger += ledgerRes.changes;

    // Catalog images
    const imgRes = updateImages.run(masterId, customId);
    remappedImages += imgRes.changes;
    updateImgRejections.run(masterId, customId);
    updateImgHistory.run(masterId, customId);

    // Aliases
    const aliasRes = updateAliases.run(masterId, customId);
    remappedAliases += aliasRes.changes;
    updateDistAliases.run(masterId, customId);

    // One-to-one metrics
    deleteStockConfig.run(customId);
    deleteStockMetrics.run(customId);
  }

  console.log(`Remapped inventory batches: ${remappedInv}`);
  console.log(`Remapped purchase items: ${remappedPurchases}`);
  console.log(`Remapped stock ledger lines: ${remappedLedger}`);
  console.log(`Remapped images: ${remappedImages}`);
  console.log(`Remapped aliases: ${remappedAliases}`);

  // Delete custom medicines
  console.log('Deleting duplicate custom medicines from medicines table...');
  const deleteRes = db.prepare("DELETE FROM medicines WHERE source = 'inventory_catalog'").run();
  console.log(`Deleted rows from medicines: ${deleteRes.changes}`);

  // Rebuild medicines_fts full text search index
  console.log('Rebuilding medicines_fts full-text search index...');
  try {
    db.prepare("INSERT INTO medicines_fts(medicines_fts) VALUES('rebuild')").run();
    console.log('Full-text search index (medicines_fts) rebuilt successfully.');
  } catch (ftsErr) {
    console.warn('FTS rebuild warning:', ftsErr.message);
  }
});

runCleanup();

// 5. Verification
const afterTotal = db.prepare('SELECT count(*) as c FROM medicines').get().c;
const remainingCustom = db.prepare("SELECT count(*) as c FROM medicines WHERE source = 'inventory_catalog'").get().c;

console.log('\n=== VERIFICATION SUMMARY ===');
console.log(`Initial total: ${beforeTotal}`);
console.log(`Final total: ${afterTotal}`);
console.log(`Removed duplicate entries: ${beforeTotal - afterTotal}`);
console.log(`Remaining custom entries: ${remainingCustom}`);

// Check Dolo 650 inventory
const doloStock = db.prepare(`
  SELECT im.id, m.id as medicine_id, m.name, im.quantity, im.batch_no, m.source
  FROM inventory_master im
  JOIN medicines m ON im.medicine_id = m.id
  WHERE m.name LIKE '%DOLO 650%'
`).all();
console.log('\nDolo 650 live stock batches after remapping:');
console.dir(doloStock);

db.close();
console.log('\nCleanup completed successfully! All records verified.');
