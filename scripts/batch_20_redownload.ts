import fs from 'fs';
import path from 'path';
import { dbManager } from '../src/database/connection.js';
import { catalogImageService } from '../src/services/catalogImageService.js';

const TEST_20_MEDICINES = [
  { id: 111633, category: 'Tablet',  label: 'TELMA 40MG TABLET (Glenmark - BP Tablet)' },
  { id: 87564,  category: 'Tablet',  label: 'DOLO 650MG TABLET (Micro Labs - Paracetamol)' },
  { id: 263222, category: 'Tablet',  label: 'CAMLODIP 5MG TABLET (La Renon - Amlodipine)' },
  { id: 213996, category: 'Tablet',  label: 'POWERZOX TAB (Alkem - Muscle Relaxant)' },
  { id: 188945, category: 'Tablet',  label: 'NYMO S TAB (Intecare - Nimesulide+Serratio)' },
  { id: 5321,   category: 'Tablet',  label: 'TRUEBASICS MULTIVIT MEN (Bacfo - OTC Bottle)' },
  { id: 225182, category: 'Capsule', label: 'IMATIB 100MG CAPSULE (Cipla - Hard Gelatin)' },
  { id: 280553, category: 'Capsule', label: 'GENIBONE D3 CAPSULE (Ajanta - Softgel Vit D3)' },
  { id: 115637, category: 'Capsule', label: 'FOLWISE PLUS CAP (Sanofi - Folic Acid+Zinc)' },
  { id: 60074,  category: 'Liquid',  label: 'GELUSIL MPS MINT FLAVOUR 400ML (Pfizer - Liquid)' },
  { id: 139858, category: 'Syrup',   label: 'ASCORIL D PLUS SF SYP 100ML (Glenmark - Cough)' },
  { id: 211052, category: 'Syrup',   label: 'CYPRODINE SYP 100ML (Lincoln - Appetite Syp)' },
  { id: 190913, category: 'Syrup',   label: 'XOFDIM 50MG DRY SYP (Khandelwal - Dry Syp)' },
  { id: 13069,  category: 'Topical', label: 'VOLINI GEL 36GM (Sun Pharma - Pain Relief)' },
  { id: 278448, category: 'Topical', label: 'BOROLINE ULTRA SMOOTH CREAM 40GM (G D Pharma)' },
  { id: 282019, category: 'Topical', label: 'LUDURA LULICONAZOLE 1% CREAM 20GM (Cipla)' },
  { id: 99514,  category: 'Topical', label: 'LAMIFIL CREAM 10 GM (HAB Pharma - Terbinafine)' },
  { id: 35410,  category: 'Drops',   label: 'GENTOD EYE EAR DROPS 3ML (Zydus Cadila)' },
  { id: 191940, category: 'Drops',   label: 'DR WILLMAR SCHWABE ALPHA WD DROPS 30ML' },
  { id: 72139,  category: 'Inhaler', label: 'QUIKHALE FB 400MG ROTACAP 40S (Intas - Inhalation)' }
];

async function main() {
  console.log('='.repeat(85));
  console.log('    BATCH 20 MEDICINES RE-DOWNLOAD & FRONT+BACK COMBO VERIFICATION');
  console.log('='.repeat(85));

  const db = await dbManager.getConnection();

  console.log('\n--- Step 1: Discarding any previous images for these 20 medicines ---');
  for (const item of TEST_20_MEDICINES) {
    const existing = await db.all('SELECT * FROM catalog_images WHERE medicine_id = ?', [item.id]);
    for (const rec of existing) {
      console.log(`  Purging old record #${rec.id} for [${rec.product_name}]`);
      await db.run('DELETE FROM catalog_images WHERE id = ?', [rec.id]);
      if (rec.image_path) {
        const fePath = path.resolve('frontend/public', rec.image_path.replace(/^\//, ''));
        const upPath = path.resolve(rec.image_path.replace(/^\//, ''));
        if (fs.existsSync(fePath)) fs.unlinkSync(fePath);
        if (fs.existsSync(upPath)) fs.unlinkSync(upPath);
      }
    }
  }

  console.log('\n--- Step 2: Fresh Candidate Search & Front+Back Combo Downloading ---');
  const results = [];

  for (let i = 0; i < TEST_20_MEDICINES.length; i++) {
    const item = TEST_20_MEDICINES[i];
    const med = await db.get('SELECT * FROM medicines WHERE id = ?', [item.id]);
    if (!med) {
      console.log(`[${i + 1}/20] Medicine ID ${item.id} not found in DB`);
      continue;
    }

    console.log(`\n[${i + 1}/20] ID ${med.id}: "${med.name}" (${item.label})`);
    try {
      const record = await catalogImageService.searchAndDownloadCandidate(med.id, 1);
      if (record) {
        console.log(`  STATUS: DOWNLOADED & VERIFIED`);
        console.log(`  Candidate: "${record.product_name}"`);
        console.log(`  Score: ${record.confidence_score}% (${record.verification_status})`);
        console.log(`  Image Type: ${(record as any).image_type}`);
        console.log(`  Local Path: ${record.image_path}`);
        console.log(`  Source: ${record.source_url}`);
        console.log(`  Reason: ${record.verification_reason}`);
        results.push({
          id: med.id,
          name: med.name,
          category: item.category,
          status: 'DOWNLOADED',
          candidate_name: record.product_name,
          score: record.confidence_score,
          verification_status: record.verification_status,
          image_type: (record as any).image_type,
          image_path: record.image_path,
          source_url: record.source_url,
          reason: record.verification_reason
        });
      } else {
        console.log(`  STATUS: REJECTED / NO SAFE CANDIDATE FOUND`);
        results.push({
          id: med.id,
          name: med.name,
          category: item.category,
          status: 'REJECTED_OR_NOT_FOUND',
          note: 'Blocked by brand, strength, modifier, or dosage form filters'
        });
      }
    } catch (err: any) {
      console.error(`  ERROR:`, err.message);
      results.push({
        id: med.id,
        name: med.name,
        category: item.category,
        status: 'ERROR',
        error: err.message
      });
    }

    // Pacing between searches
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n' + '='.repeat(85));
  console.log('                     FINAL 20-MEDICINE BATCH SUMMARY');
  console.log('='.repeat(85));
  console.log(JSON.stringify(results, null, 2));

  // Write summary to scratch for easy reference
  const summaryPath = path.resolve('C:/Users/ratna/.gemini/antigravity-ide/brain/da4bc785-747b-4eb9-87b8-799b860e0815/scratch/batch_20_results.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved results JSON to: ${summaryPath}`);
}

main().catch(console.error);
