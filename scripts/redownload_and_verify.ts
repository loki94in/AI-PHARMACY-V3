import fs from 'fs';
import path from 'path';
import { dbManager } from '../src/database/connection.js';
import { catalogImageService } from '../src/services/catalogImageService.js';

async function main() {
  console.log('='.repeat(80));
  console.log('   DISCARDING PREVIOUS IMAGES & FRESH RE-DOWNLOAD VIA UPGRADED AI CAMERA');
  console.log('='.repeat(80));

  const db = await dbManager.getConnection();

  // Target medicines to test
  const targetMedicines = [
    { id: 286089, label: 'ZOCEF 500 (Tablet Blister - Must show Box/Back with text)' },
    { id: 278825, label: 'CHESTON D (Must NOT download Cheston Cold)' },
    { id: 71503,  label: 'APDROPS DX EYE DROPS (Must NOT download Apdrops LP)' },
    { id: 278923, label: 'CIPLOX (Eye/Ear Drops)' },
    { id: 278968, label: 'CLEARWAX EAR DROPS 10ML' },
    { id: 281310, label: 'INSULIN 40IU (BD Insulin Syringe)' },
    { id: 90709,  label: 'REDOTIL 100MG CAPSULE' },
    { id: 175958, label: 'COVERSYL 4MG STRIP OF 10 TABLETS' },
    { id: 64327,  label: 'KETOFORD TAB (Must catch cream vs tab conflict)' }
  ];

  console.log('\n--- Step 1: Discarding previous image records and files ---');
  for (const item of targetMedicines) {
    const existing = await db.all('SELECT * FROM catalog_images WHERE medicine_id = ?', [item.id]);
    for (const rec of existing) {
      console.log(`  Deleting DB record #${rec.id} for [${rec.product_name}]`);
      await db.run('DELETE FROM catalog_images WHERE id = ?', [rec.id]);
      if (rec.image_path) {
        const fePath = path.resolve('frontend/public', rec.image_path.replace(/^\//, ''));
        const upPath = path.resolve(rec.image_path.replace(/^\//, ''));
        if (fs.existsSync(fePath)) {
          fs.unlinkSync(fePath);
          console.log(`  Removed file: ${fePath}`);
        }
        if (fs.existsSync(upPath)) {
          fs.unlinkSync(upPath);
        }
      }
    }
  }

  console.log('\n--- Step 2: Executing Fresh Re-download via Upgraded AI Camera ---');
  const results = [];

  for (let i = 0; i < targetMedicines.length; i++) {
    const target = targetMedicines[i];
    const med = await db.get('SELECT * FROM medicines WHERE id = ?', [target.id]);
    if (!med) {
      console.log(`[${i + 1}/${targetMedicines.length}] Medicine ID ${target.id} not found in DB`);
      continue;
    }

    console.log(`\n[${i + 1}/${targetMedicines.length}] Processing ID ${med.id}: "${med.name}" (${target.label})`);
    try {
      const record = await catalogImageService.searchAndDownloadCandidate(med.id, 1);
      if (record) {
        console.log(`  STATUS: DOWNLOADED & VERIFIED`);
        console.log(`  Candidate Product: "${record.product_name}"`);
        console.log(`  Score: ${record.confidence_score}% (${record.verification_status})`);
        console.log(`  Image Face / Type: ${record.image_type}`);
        console.log(`  Local File: ${record.image_path}`);
        console.log(`  Reason: ${record.verification_reason}`);
        console.log(`  Source: ${record.source_url}`);
        results.push({
          id: med.id,
          medicine_name: med.name,
          status: 'DOWNLOADED',
          candidate_product: record.product_name,
          confidence_score: record.confidence_score,
          verification_status: record.verification_status,
          image_type: record.image_type,
          image_path: record.image_path,
          source_url: record.source_url,
          reason: record.verification_reason
        });
      } else {
        console.log(`  STATUS: REJECTED / NOT FOUND (Protected by AI Guards)`);
        results.push({
          id: med.id,
          medicine_name: med.name,
          status: 'REJECTED_OR_NOT_FOUND',
          note: 'No candidate passed the strict brand, dosage form, and formulation modifier filters.'
        });
      }
    } catch (err: any) {
      console.error(`  ERROR:`, err.message);
      results.push({
        id: med.id,
        medicine_name: med.name,
        status: 'ERROR',
        error: err.message
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('   FINAL RE-DOWNLOAD RESULTS SUMMARY');
  console.log('='.repeat(80));
  console.log(JSON.stringify(results, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
