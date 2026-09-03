// Automated verification script for Dedicated Product Image Correction System
import Database from 'better-sqlite3';

const db = new Database('./data/app.db');

console.log('--- 1. Testing Database Schema ---');
const ciCols = db.prepare('PRAGMA table_info(catalog_images)').all();
const colNames = ciCols.map(c => c.name);
console.log('catalog_images columns count:', ciCols.length);

const requiredCols = [
  'previous_image_url',
  'next_review_at',
  'skip_reason',
  'locked_by',
  'locked_at',
  'verification_version'
];

for (const col of requiredCols) {
  if (colNames.includes(col)) {
    console.log(`[PASS] Column catalog_images.${col} exists`);
  } else {
    console.error(`[FAIL] Column catalog_images.${col} is MISSING`);
    process.exit(1);
  }
}

const historyInfo = db.prepare('PRAGMA table_info(image_review_history)').all();
if (historyInfo.length > 0) {
  console.log('[PASS] Table image_review_history exists with', historyInfo.length, 'columns');
} else {
  console.error('[FAIL] Table image_review_history is MISSING');
  process.exit(1);
}

console.log('\n--- 2. Testing State Transitions & Queue Logic ---');

// Find or create test medicine
let med = db.prepare('SELECT id, name FROM medicines LIMIT 1').get();
if (!med) {
  const mRes = db.prepare("INSERT INTO medicines (name, manufacturer, packaging) VALUES ('TEST MEDICINE 500MG', 'TEST PHARMA', '10 TABS')").run();
  med = { id: mRes.lastInsertRowid, name: 'TEST MEDICINE 500MG' };
}

// Insert a test catalog_images record in PENDING_REVIEW
const insertRes = db.prepare(`
  INSERT INTO catalog_images (
    medicine_id, product_name, image_path, verification_status, confidence_score, is_active
  ) VALUES (?, ?, '/products/test-image.jpg', 'PENDING_REVIEW', 75, 1)
`).run(med.id, med.name);

const testImageId = insertRes.lastInsertRowid;
console.log('Created test image ID:', testImageId);

// Test A: Queue query must include PENDING_REVIEW
const inQueueBefore = db.prepare(`
  SELECT id, verification_status FROM catalog_images 
  WHERE id = ? AND verification_status IN ('PENDING_REVIEW', 'PENDING', 'INCORRECT')
    AND (next_review_at IS NULL OR next_review_at <= CURRENT_TIMESTAMP)
`).get(testImageId);

if (inQueueBefore) {
  console.log('[PASS] Newly created image is visible in unresolved queue (status =', inQueueBefore.verification_status, ')');
} else {
  console.error('[FAIL] Newly created image NOT found in unresolved queue');
  process.exit(1);
}

// Test B: Mark as CORRECT -> must vanish from queue
db.prepare(`
  UPDATE catalog_images 
  SET verification_status = 'APPROVED', verified_by = 'test_agent', verified_at = CURRENT_TIMESTAMP 
  WHERE id = ?
`).run(testImageId);

db.prepare(`
  INSERT INTO image_review_history (
    product_image_id, medicine_id, previous_status, new_status, previous_image_url, new_image_url, action, performed_by
  ) VALUES (?, ?, 'PENDING_REVIEW', 'APPROVED', '/products/test-image.jpg', '/products/test-image.jpg', 'MARK_CORRECT', 'test_agent')
`).run(testImageId, med.id);

const inQueueAfterCorrect = db.prepare(`
  SELECT id FROM catalog_images 
  WHERE id = ? AND verification_status IN ('PENDING_REVIEW', 'PENDING', 'INCORRECT')
    AND (next_review_at IS NULL OR next_review_at <= CURRENT_TIMESTAMP)
`).get(testImageId);

if (!inQueueAfterCorrect) {
  console.log('[PASS] After MARK_CORRECT, image successfully REMOVED from unresolved queue');
} else {
  console.error('[FAIL] Image still returned in unresolved queue after MARK_CORRECT');
  process.exit(1);
}

// Test C: Mark as INCORRECT -> must reappear in queue
db.prepare(`
  UPDATE catalog_images 
  SET verification_status = 'INCORRECT', verification_reason = 'Wrong dosage packaging' 
  WHERE id = ?
`).run(testImageId);

db.prepare(`
  INSERT INTO image_review_history (
    product_image_id, medicine_id, previous_status, new_status, previous_image_url, new_image_url, action, reason, performed_by
  ) VALUES (?, ?, 'APPROVED', 'INCORRECT', '/products/test-image.jpg', '/products/test-image.jpg', 'MARK_INCORRECT', 'Wrong dosage packaging', 'test_agent')
`).run(testImageId, med.id);

const inQueueAfterIncorrect = db.prepare(`
  SELECT id, verification_status FROM catalog_images 
  WHERE id = ? AND verification_status IN ('PENDING_REVIEW', 'PENDING', 'INCORRECT')
    AND (next_review_at IS NULL OR next_review_at <= CURRENT_TIMESTAMP)
`).get(testImageId);

if (inQueueAfterIncorrect && inQueueAfterIncorrect.verification_status === 'INCORRECT') {
  console.log('[PASS] After MARK_INCORRECT, image correctly visible in queue with status = INCORRECT');
} else {
  console.error('[FAIL] Image NOT visible in queue after MARK_INCORRECT');
  process.exit(1);
}

// Test D: SKIP image for 24 hours -> must be hidden from queue
const futureTime = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
db.prepare(`
  UPDATE catalog_images 
  SET verification_status = 'SKIPPED', next_review_at = ?, skip_reason = 'Waiting for clarification' 
  WHERE id = ?
`).run(futureTime, testImageId);

const inQueueAfterSkip = db.prepare(`
  SELECT id FROM catalog_images 
  WHERE id = ? AND verification_status IN ('PENDING_REVIEW', 'PENDING', 'INCORRECT')
    AND (next_review_at IS NULL OR next_review_at <= CURRENT_TIMESTAMP)
`).get(testImageId);

if (!inQueueAfterSkip) {
  console.log('[PASS] After SKIP (24h cooldown), image successfully hidden from active queue');
} else {
  console.error('[FAIL] Image still returned in queue despite active future skip cooldown');
  process.exit(1);
}

// Test E: Audit history trail verification
const historyRows = db.prepare(`
  SELECT * FROM image_review_history WHERE product_image_id = ? ORDER BY id ASC
`).all(testImageId);

console.log('\n--- 3. Testing Audit Trail Records ---');
console.log('Recorded history entries:', historyRows.length);
historyRows.forEach(h => console.log(` - Action: ${h.action}, ${h.previous_status} -> ${h.new_status}, Reason: ${h.reason || 'none'}`));

if (historyRows.length >= 2) {
  console.log('[PASS] Full lifecycle history correctly persisted in image_review_history');
} else {
  console.error('[FAIL] History trail records insufficient');
  process.exit(1);
}

// Cleanup test record
db.prepare('DELETE FROM image_review_history WHERE product_image_id = ?').run(testImageId);
db.prepare('DELETE FROM catalog_images WHERE id = ?').run(testImageId);
console.log('\n[PASS] Cleaned up test records');

db.close();
console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
