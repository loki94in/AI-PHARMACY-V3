import fs from 'fs';
import path from 'path';
import { dbManager } from '../src/database/connection.js';
import { catalogImageService } from '../src/services/catalogImageService.js';
import { aiCameraService } from '../src/services/aiCameraService.js';

// The 20 verified medicines downloaded in the app across diverse dosage forms
const TARGET_20_MEDICINES = [
  { id: 286089, label: 'ZOCEF 500MG TABLET' },
  { id: 90709,  label: 'REDOTIL 100MG CAPSULE' },
  { id: 278923, label: 'CIPLOX 0.3% EYE/EAR DROPS' },
  { id: 278968, label: 'CLEARWAX EAR DROPS 10ML' },
  { id: 281310, label: 'INSULIN 40IU (BD SYRINGE)' },
  { id: 175958, label: 'COVERSYL 4MG TABLETS' },
  { id: 111633, label: 'TELMA 40MG TABLET' },
  { id: 87564,  label: 'DOLO 650MG TABLET' },
  { id: 263222, label: 'CAMLODIP 5MG TABLET' },
  { id: 60074,  label: 'GELUSIL MPS MINT LIQUID 400ML' },
  { id: 139858, label: 'ASCORIL D PLUS SF SYP 100ML' },
  { id: 13069,  label: 'VOLINI GEL 36GM' },
  { id: 278448, label: 'BOROLINE ULTRA SMOOTH CREAM' },
  { id: 282019, label: 'LUDURA LULICONAZOLE 1% CREAM' },
  { id: 191940, label: 'DR WILLMAR SCHWABE DROPS 30ML' },
  { id: 564,    label: 'FLAMINGO FLAMICREPE BANDAGE 10CM' },
  { id: 280290, label: 'FLAMINGO FLAMICREPE BANDAGE 5CM' },
  { id: 1622,   label: 'FLAMINGO CREPE BANDAGE 8*4CM' },
  { id: 165,    label: 'FLAMINGO ELBOW SUPPORT' },
  { id: 1445,   label: 'FLAMINGO HEAT BELT XL' }
];

async function main() {
  console.log('='.repeat(90));
  console.log('    RE-DOWNLOADING 20 MEDICINES & RUNNING AI CAMERA SCAN (LOCAL FAST MODE)');
  console.log('='.repeat(90));

  const db = await dbManager.getConnection();
  await aiCameraService.initialize();

  const report: any[] = [];
  const startTime = Date.now();

  for (let i = 0; i < TARGET_20_MEDICINES.length; i++) {
    const item = TARGET_20_MEDICINES[i];
    const t0 = Date.now();
    console.log(`\n[${i + 1}/20] Processing: ${item.label} (ID: ${item.id})`);

    // Purge old catalog_images record
    const oldRecs = await db.all('SELECT * FROM catalog_images WHERE medicine_id = ?', [item.id]);
    for (const r of oldRecs) {
      await db.run('DELETE FROM catalog_images WHERE id = ?', [r.id]);
      if (r.image_path) {
        const full = path.resolve('frontend/public', r.image_path.replace(/^\//, ''));
        if (fs.existsSync(full)) fs.unlinkSync(full);
      }
    }

    // Step 1: Re-download candidate using AI camera catalog logic
    const downloadResult = await catalogImageService.searchAndDownloadCandidate(item.id, 1);
    if (!downloadResult) {
      console.log(`  -> DOWNLOAD REJECTED / NO SAFE CANDIDATE`);
      report.push({
        id: item.id,
        name: item.label,
        status: 'REJECTED',
        ai_name: 'N/A',
        ai_form: 'N/A',
        ai_company: 'N/A',
        ai_strength: 'N/A'
      });
      continue;
    }

    console.log(`  -> Downloaded: "${downloadResult.product_name}"`);
    console.log(`     Face: ${(downloadResult as any).image_type} | Score: ${downloadResult.confidence_score}%`);
    console.log(`     Path: ${downloadResult.image_path}`);

    // Step 2: Run local offline AI Camera OCR & Label Analysis
    const diskPath = path.resolve('frontend/public', downloadResult.image_path.replace(/^\//, ''));
    let detectedInfo = {
      potentialName: 'Unknown',
      dosageForm: 'Not detected',
      company: 'Not detected',
      strength: 'Not detected'
    };

    if (fs.existsSync(diskPath)) {
      const imgBuffer = fs.readFileSync(diskPath);
      // skipEnrichment = true for offline local AI camera scanning
      const aiResult = await aiCameraService.processImage(imgBuffer, true);
      detectedInfo = {
        potentialName: aiResult.potentialName || 'Unknown',
        dosageForm: aiResult.dosageForm || 'Not detected',
        company: aiResult.company || 'Not detected',
        strength: aiResult.detectedStrength || 'Not detected'
      };
    }

    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  -> AI Camera Findings (${elapsedSec}s):`);
    console.log(`     Detected Name: ${detectedInfo.potentialName}`);
    console.log(`     Dosage Form:   ${detectedInfo.dosageForm}`);
    console.log(`     Company:       ${detectedInfo.company}`);
    console.log(`     Strength:      ${detectedInfo.strength}`);

    report.push({
      id: item.id,
      name: item.label,
      candidate: downloadResult.product_name,
      face: (downloadResult as any).image_type,
      image_path: downloadResult.image_path,
      ai_name: detectedInfo.potentialName,
      ai_form: detectedInfo.dosageForm,
      ai_company: detectedInfo.company,
      ai_strength: detectedInfo.strength
    });
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(90));
  console.log(`       FINAL 20-MEDICINE AI CAMERA AUDIT TABLE (Completed in ${totalSec}s)`);
  console.log('='.repeat(90));
  console.table(report.map(r => ({
    Medicine: r.name,
    View: r.face,
    'AI Name Detected': r.ai_name,
    'AI Form': r.ai_form,
    'AI Company': r.ai_company,
    'AI Strength': r.ai_strength
  })));

  fs.writeFileSync(
    'C:/Users/ratna/.gemini/antigravity-ide/brain/da4bc785-747b-4eb9-87b8-799b860e0815/scratch/batch_20_ai_camera_results.json',
    JSON.stringify(report, null, 2)
  );
  console.log('Detailed JSON saved to scratch/batch_20_ai_camera_results.json');
}

main().catch(console.error);
