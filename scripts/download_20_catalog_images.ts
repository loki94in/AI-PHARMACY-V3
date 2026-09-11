import fs from 'fs';
import path from 'path';
import { dbManager } from '../src/database/connection.js';
import { catalogImageService } from '../src/services/catalogImageService.js';

// The 20 key medicines across diverse categories
const TARGET_20 = [
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
  console.log('='.repeat(80));
  console.log('       FAST DIRECT DOWNLOAD OF 20 PACKAGING IMAGES INTO APP');
  console.log('='.repeat(80));

  const db = await dbManager.getConnection();
  const results: any[] = [];
  const startAll = Date.now();

  for (let i = 0; i < TARGET_20.length; i++) {
    const item = TARGET_20[i];
    const t0 = Date.now();
    process.stdout.write(`[${i + 1}/20] Downloading ${item.label}... `);

    // Delete old record and image file
    const old = await db.all('SELECT * FROM catalog_images WHERE medicine_id = ?', [item.id]);
    for (const r of old) {
      await db.run('DELETE FROM catalog_images WHERE id = ?', [r.id]);
      if (r.image_path) {
        const fp = path.resolve('frontend/public', r.image_path.replace(/^\//, ''));
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
    }

    try {
      const record = await catalogImageService.searchAndDownloadCandidate(item.id, 1);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (record) {
        console.log(`DONE (${elapsed}s) -> ${record.product_name} [${(record as any).image_type}]`);
        results.push({
          id: item.id,
          name: item.label,
          status: 'SUCCESS',
          candidate: record.product_name,
          view: (record as any).image_type,
          path: record.image_path,
          time: `${elapsed}s`
        });
      } else {
        console.log(`SKIPPED (${elapsed}s) -> No safe candidate found`);
        results.push({
          id: item.id,
          name: item.label,
          status: 'SKIPPED',
          time: `${elapsed}s`
        });
      }
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
      results.push({
        id: item.id,
        name: item.label,
        status: 'ERROR',
        error: err.message
      });
    }
  }

  const totalTime = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(80));
  console.log(`         DOWNLOAD COMPLETE: ${results.filter(r => r.status === 'SUCCESS').length}/20 in ${totalTime}s`);
  console.log('='.repeat(80));
  console.table(results.map(r => ({
    Medicine: r.name,
    Status: r.status,
    View: r.view || '-',
    Path: r.path || '-',
    Time: r.time
  })));
}

main().catch(console.error);
