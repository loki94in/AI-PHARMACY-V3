import { dbManager } from '../src/database/connection.js';
import { catalogImageService } from '../src/services/catalogImageService.js';
import fs from 'fs';
import path from 'path';

async function testFlamingoCotton() {
  const db = await dbManager.getConnection();
  const testIds = [
    { id: 564, label: 'FLAMINGO FLAMICREPE COTTON CREPE BANDAGE 10 CM' },
    { id: 280290, label: 'FLAMINGO FLAMICREPE COTTON CREPE BANDAGE 5 CM' },
    { id: 1622, label: 'FLAMINGO CREPE BANDAGE 8*4CM' },
    { id: 165, label: 'FLAMINGO ELBOW SUPPORT (item_type: COTTON)' },
    { id: 638, label: 'ABSORBENT COTTON WOOL 400 GM' },
    { id: 986, label: 'COTTON ABSORBENT 200 GM' },
    { id: 1445, label: 'FLAMINGO ORTHOPEDIC HEAT BELT' },
    { id: 1967, label: 'FLAMINGO KNEE CAP' }
  ];

  console.log('Testing Flamingo & Cotton items download:');

  for (const item of testIds) {
    const med = await db.get('SELECT * FROM medicines WHERE id = ?', [item.id]);
    if (!med) {
      console.log(`ID ${item.id} not found`);
      continue;
    }

    console.log(`\nTesting [${med.id}] "${med.name}" (Mfg: ${med.manufacturer}, Type: ${med.item_type}):`);
    
    // Purge previous
    const old = await db.all('SELECT * FROM catalog_images WHERE medicine_id = ?', [med.id]);
    for (const r of old) {
      await db.run('DELETE FROM catalog_images WHERE id = ?', [r.id]);
      if (r.image_path) {
        const p1 = path.resolve('frontend/public', r.image_path.replace(/^\//, ''));
        if (fs.existsSync(p1)) fs.unlinkSync(p1);
      }
    }

    const res = await catalogImageService.searchAndDownloadCandidate(med.id, 1);
    if (res) {
      console.log(`  -> DOWNLOADED: "${res.product_name}"`);
      console.log(`     Score: ${res.confidence_score} (${res.verification_status})`);
      console.log(`     Face: ${(res as any).image_type}`);
      console.log(`     Path: ${res.image_path}`);
      console.log(`     Reason: ${res.verification_reason}`);
    } else {
      console.log(`  -> REJECTED / NOT FOUND`);
    }
  }
}

testFlamingoCotton().catch(console.error);
