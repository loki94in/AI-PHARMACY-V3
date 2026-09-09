import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

console.log('=== FIXING DYTOR CATALOG IMAGES ===\n');

db.transaction(() => {
  // 1. DYTOR 10MG (MedID 294291)
  console.log('1. Fixing DYTOR 10MG (MedID 294291)...');
  // Deactivate wrong combikit and plus images
  db.prepare(`
    UPDATE catalog_images 
    SET is_active = 0, is_primary = 0, verification_status = 'REPLACED', updated_at = CURRENT_TIMESTAMP 
    WHERE medicine_id = 294291 AND id IN (10398, 10399, 10400)
  `).run();

  // Set genuine dytor-10mg-side.jpg as primary
  db.prepare(`
    UPDATE catalog_images
    SET is_primary = 1, is_active = 1, image_type = 'front', confidence_score = 98,
        verification_status = 'HIGH_CONFIDENCE',
        product_name = 'Dytor 10Mg Strip Of 15 Tablets',
        verification_reason = 'Brand matched ("DYTOR") • Strength verified (10MG) • OCR verified ("DYTOR-10 10mg")',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1221
  `).run();

  // Attach to DYTOR 10MG STRIP OF 10 TABLETS (MedID 277966) if missing
  const existing10_10 = db.prepare(`SELECT id FROM catalog_images WHERE medicine_id = 277966 AND is_active = 1`).get();
  if (!existing10_10) {
    db.prepare(`
      INSERT INTO catalog_images (
        medicine_id, company_name, product_name, image_path, thumbnail_path, image_source,
        confidence_score, matching_method, verification_status, verification_reason, is_active,
        image_type, is_primary, match_source, match_confidence, created_at, updated_at
      ) VALUES (
        277966, 'CIPLA LIMITED', 'Dytor 10Mg Strip Of 10 Tablets', '/products/dytor-10mg-side.jpg', '/products/dytor-10mg-side.jpg', 'pharmeasy',
        95, 'ai_multi_signal', 'HIGH_CONFIDENCE', 'Brand matched ("DYTOR") • Strength verified (10MG) • OCR verified ("DYTOR-10 10mg")', 1,
        'front', 1, 'manual', 95, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `).run();
    console.log('   Attached dytor-10mg-side.jpg to MedID 277966 (DYTOR 10MG STRIP OF 10 TABLETS)');
  }

  // 2. DYTOR 20MG STRIP OF 10 TABLETS (MedID 287067)
  console.log('2. Fixing DYTOR 20MG STRIP OF 10 TABLETS (MedID 287067)...');
  db.prepare(`
    UPDATE catalog_images
    SET is_primary = 1, is_active = 1, image_type = 'front', confidence_score = 98,
        verification_status = 'HIGH_CONFIDENCE',
        product_name = 'Dytor 20Mg Strip Of 10 Tablets',
        verification_reason = 'Brand matched ("DYTOR") • Strength verified (20MG) • OCR verified ("DYTOR-20 20mg")',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 5927
  `).run();
  db.prepare(`
    UPDATE catalog_images
    SET is_primary = 0, is_active = 1, image_type = 'back', confidence_score = 85,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1222
  `).run();

  // 3. DYTOR 20MG STRIP OF 15 TABLETS (MedID 294248)
  console.log('3. Fixing DYTOR 20MG STRIP OF 15 TABLETS (MedID 294248)...');
  db.prepare(`
    UPDATE catalog_images
    SET is_primary = 1, is_active = 1, image_type = 'front', confidence_score = 98,
        verification_status = 'HIGH_CONFIDENCE',
        product_name = 'Dytor 20Mg Strip Of 15 Tablets',
        verification_reason = 'Brand matched ("DYTOR") • Strength verified (20MG) • OCR verified ("DYTOR-20 20mg")',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 5928
  `).run();
  db.prepare(`
    UPDATE catalog_images
    SET is_primary = 0, is_active = 1, image_type = 'back', confidence_score = 85,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1223
  `).run();

  // 4. DYTOR 20MG TAB 20'S (MedID 144279)
  console.log('4. Attaching verified 20mg packaging to DYTOR 20MG TAB 20\'S (MedID 144279)...');
  const existing20_20 = db.prepare(`SELECT id FROM catalog_images WHERE medicine_id = 144279 AND is_active = 1`).get();
  if (!existing20_20) {
    db.prepare(`
      INSERT INTO catalog_images (
        medicine_id, company_name, product_name, image_path, thumbnail_path, image_source,
        confidence_score, matching_method, verification_status, verification_reason, is_active,
        image_type, is_primary, match_source, match_confidence, created_at, updated_at
      ) VALUES (
        144279, 'CIPLA LIMITED', 'Dytor 20Mg Tab 20''s', '/products/dytor-20mg-back.jpg', '/products/dytor-20mg-back.jpg', 'pharmeasy',
        98, 'ai_multi_signal', 'HIGH_CONFIDENCE', 'Brand matched ("DYTOR") • Strength verified (20MG) • OCR verified ("DYTOR-20 20mg")', 1,
        'front', 1, 'manual', 98, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `).run();
    db.prepare(`
      INSERT INTO catalog_images (
        medicine_id, company_name, product_name, image_path, thumbnail_path, image_source,
        confidence_score, matching_method, verification_status, verification_reason, is_active,
        image_type, is_primary, match_source, match_confidence, created_at, updated_at
      ) VALUES (
        144279, 'CIPLA LIMITED', 'Dytor 20Mg Tab 20''s', '/products/dytor-20mg-front.jpg', '/products/dytor-20mg-front.jpg', 'pharmeasy',
        85, 'ai_multi_signal', 'HIGH_CONFIDENCE', 'Blister bubble view', 1,
        'back', 0, 'manual', 85, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `).run();
    console.log('   Attached 20mg front and back to MedID 144279');
  }

  // 5. DYTOR 40MG TABLET (MedID 287068)
  console.log('5. Fixing DYTOR 40MG TABLET (MedID 287068)...');
  db.prepare(`
    UPDATE catalog_images
    SET is_primary = 1, is_active = 1, image_type = 'front', confidence_score = 98,
        verification_status = 'HIGH_CONFIDENCE',
        product_name = 'Dytor 40Mg Strip Of 10 Tablets',
        verification_reason = 'Brand matched ("DYTOR") • Strength verified (40MG) • OCR verified ("DYTOR-40 40mg")',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 5929
  `).run();
  db.prepare(`
    UPDATE catalog_images
    SET is_primary = 0, is_active = 1, image_type = 'back', confidence_score = 85,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1224
  `).run();

  // 6. DYTOR 5MG STRIP OF 15 TABLETS (MedID 287069)
  console.log('6. Fixing DYTOR 5MG STRIP OF 15 TABLETS (MedID 287069)...');
  db.prepare(`
    UPDATE catalog_images
    SET is_primary = 1, is_active = 1, image_type = 'front', confidence_score = 98,
        verification_status = 'HIGH_CONFIDENCE',
        product_name = 'Dytor 5Mg Strip Of 15 Tablets',
        verification_reason = 'Brand matched ("DYTOR") • Strength verified (5MG) • OCR verified ("Torsemide IP 5mg")',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 5930
  `).run();
  db.prepare(`
    UPDATE catalog_images
    SET is_primary = 0, is_active = 1, image_type = 'back', confidence_score = 85,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1225
  `).run();

  // Attach to DYTOR 5MG STRIP OF 10 TABLETS (MedID 205242) if missing
  const existing5_10 = db.prepare(`SELECT id FROM catalog_images WHERE medicine_id = 205242 AND is_active = 1`).get();
  if (!existing5_10) {
    db.prepare(`
      INSERT INTO catalog_images (
        medicine_id, company_name, product_name, image_path, thumbnail_path, image_source,
        confidence_score, matching_method, verification_status, verification_reason, is_active,
        image_type, is_primary, match_source, match_confidence, created_at, updated_at
      ) VALUES (
        205242, 'CIPLA LIMITED', 'Dytor 5Mg Strip Of 10 Tablets', '/products/dytor-5mg-back.jpg', '/products/dytor-5mg-back.jpg', 'pharmeasy',
        95, 'ai_multi_signal', 'HIGH_CONFIDENCE', 'Brand matched ("DYTOR") • Strength verified (5MG) • OCR verified ("Torsemide IP 5mg")', 1,
        'front', 1, 'manual', 95, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `).run();
    console.log('   Attached dytor-5mg-back.jpg to MedID 205242 (DYTOR 5MG STRIP OF 10 TABLETS)');
  }
})();

console.log('\n=== VERIFICATION AUDIT FOR ALL DYTOR MEDICINES ===\n');

const dytorMeds = db.prepare(`SELECT id, name, pack_size FROM medicines WHERE name LIKE '%DYTOR%' ORDER BY name`).all();

for (const m of dytorMeds) {
  const images = db.prepare(`
    SELECT id, product_name, image_path, image_type, is_primary, is_active, confidence_score, verification_status 
    FROM catalog_images 
    WHERE medicine_id = ? 
    ORDER BY is_active DESC, is_primary DESC, id ASC
  `).all(m.id);

  if (images.length > 0) {
    console.log(`MED [${m.id}] "${m.name}"`);
    for (const img of images) {
      console.log(`   -> CI[${img.id}] primary=${img.is_primary} active=${img.is_active} type=${img.image_type} score=${img.confidence_score} status=${img.verification_status}`);
      console.log(`      path: "${img.image_path}" | prod: "${img.product_name}"`);
    }
  }
}
