/**
 * Safe, zero-deletion healing script for orphaned patient_refills.
 * 
 * - Populates patient_refills.medicine_name from preserved link names.
 * - Reconnects patient_refills.medicine_id to the active catalog medicines.id.
 * - Duplicates medicine_distributor_links to the active medicine_id so all distributor pills resolve.
 * - ZERO deletions.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const mappingTable = [
  { refillId: 133, oldId: 6629993, newId: 9768994, name: 'EPTOIN 100MG BOTTLE OF 120 TABLETS' },
  { refillId: 138, oldId: 6630995, newId: 9769966, name: 'HHGLIM M 2MG TABLET' },
  { refillId: 147, oldId: 6632178, newId: 9546403, name: 'LUPISULIN M 30 100IU VIAL.' },
  { refillId: 148, oldId: 6630691, newId: 9769666, name: 'GLYCIGON 80MG TABLET' },
  { refillId: 149, oldId: 6631996, newId: 9770946, name: 'LIRALIN EP  25  TAB' },
  { refillId: 150, oldId: 6631324, newId: 9505652, name: 'BD GLIDE WITH TBL 6 MM NEEDLE PACKET OF 1ML INSULIN SYRINGE' },
  { refillId: 156, oldId: 6668471, newId: 9768379, name: 'DAPAMITE 5MG STRIP OF 14 TAB' },
  { refillId: 160, oldId: 6916355, newId: 9769349, name: 'FORACORT 200MCG ROTACAPS' },
  { refillId: 161, oldId: 6921840, newId: 9774232, name: 'TELMIKIND BETA 50MG TABLET' },
  { refillId: 162, oldId: 6916669, newId: 9769645, name: 'GLUCONORM G 1MG STRIP OF 15 TABLETS' },
  { refillId: 163, oldId: 6922542, newId: 9774878, name: 'VONOGRESS 20 STRIP OF 10 TAB' },
  { refillId: 165, oldId: 6915382, newId: 9503313, name: 'DENTE91 TOOTHPASTE 100GM' },
  { refillId: 166, oldId: 6915569, newId: 9730503, name: 'DILZEM 120MG TABLET' },
  { refillId: 171, oldId: 6921948, newId: 9774334, name: 'THYROX 100MCG BOTTLE OF 100 TABLETS' },
  { refillId: 172, oldId: 6916004, newId: 9768995, name: 'EPTOIN 100MG TABLET' },
  { refillId: 173, oldId: 6921941, newId: 9774328, name: 'THYRONORM 25MCG BOTTLE OF 120 TABLETS' },
  { refillId: 174, oldId: 6921936, newId: 9774323, name: "THYRONORM 100MCG 120'S" },
  { refillId: 175, oldId: 6921938, newId: 9774325, name: 'THYRONORM 125MCG BOTTLE OF 120 TABLETS' },
];

const targetDatabases = [
  'G:\\AI Pharmacy OS\\data\\app.db',
  path.join(process.cwd(), 'data', 'app.dev.db')
];

for (const dbPath of targetDatabases) {
  if (!fs.existsSync(dbPath)) continue;
  console.log(`\n========================================`);
  console.log(`Healing database: ${dbPath}`);
  console.log(`========================================`);
  const db = new Database(dbPath);

  const updateRefillStmt = db.prepare(`
    UPDATE patient_refills
    SET medicine_name = ?, medicine_id = ?
    WHERE id = ?
  `);

  const copyLinksStmt = db.prepare(`
    INSERT OR IGNORE INTO medicine_distributor_links 
      (medicine_id, store_id, store_name, product_code, product_id, product_name, packaging, company, mapped, pick_order, rate, mrp, scheme, medicine_name, created_at, updated_at)
    SELECT ?, store_id, store_name, product_code, product_id, product_name, packaging, company, mapped, pick_order, rate, mrp, scheme, COALESCE(medicine_name, ?), created_at, updated_at
    FROM medicine_distributor_links
    WHERE medicine_id = ?
  `);

  let healedCount = 0;
  let linksDuplicated = 0;

  db.transaction(() => {
    for (const m of mappingTable) {
      // Verify row exists
      const existingRefill = db.prepare('SELECT id, patient_name, medicine_id, medicine_name FROM patient_refills WHERE id = ?').get(m.refillId);
      if (!existingRefill) continue;

      // Update patient_refills
      const res = updateRefillStmt.run(m.name, m.newId, m.refillId);
      if (res.changes > 0) {
        healedCount++;
        console.log(`[Healed] Refill #${m.refillId} (${existingRefill.patient_name}) -> "${m.name}" (ID ${m.oldId} => ${m.newId})`);
      }

      // Copy distributor links to the new ID if not already there
      const linkRes = copyLinksStmt.run(m.newId, m.name, m.oldId);
      if (linkRes.changes > 0) {
        linksDuplicated += linkRes.changes;
        console.log(`  -> Cloned ${linkRes.changes} distributor link(s) to new medicine ID ${m.newId}`);
      }
    }

    // Generic healing: for any remaining patient_refills with missing medicine_name, pull from distributor links
    const genericFix = db.prepare(`
      UPDATE patient_refills
      SET medicine_name = (
        SELECT mdl.medicine_name
        FROM medicine_distributor_links mdl
        WHERE mdl.medicine_id = patient_refills.medicine_id
          AND mdl.medicine_name IS NOT NULL AND TRIM(mdl.medicine_name) != ''
        LIMIT 1
      )
      WHERE (medicine_name IS NULL OR TRIM(medicine_name) = '')
        AND EXISTS (
          SELECT 1 FROM medicine_distributor_links mdl
          WHERE mdl.medicine_id = patient_refills.medicine_id
            AND mdl.medicine_name IS NOT NULL AND TRIM(mdl.medicine_name) != ''
        )
    `).run();

    if (genericFix.changes > 0) {
      console.log(`[Generic Healing] Updated ${genericFix.changes} refill rows with names from medicine_distributor_links.`);
    }
  })();

  console.log(`Done: ${healedCount} refills reconnected, ${linksDuplicated} distributor links preserved.`);
  db.close();
}
