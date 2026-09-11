import { dbManager } from '../src/database/connection.js';
import { catalogImageService } from '../src/services/catalogImageService.js';
import fs from 'fs';
import path from 'path';

async function run() {
  const db = await dbManager.getConnection();
  const medId = 281310;

  // Clean existing catalog image for 281310
  const existing = await db.all('SELECT * FROM catalog_images WHERE medicine_id = ?', [medId]);
  for (const rec of existing) {
    console.log(`Deleting previous record #${rec.id}: ${rec.product_name} (${rec.image_path})`);
    await db.run('DELETE FROM catalog_images WHERE id = ?', [rec.id]);
    if (rec.image_path) {
      const fePath = path.resolve('frontend/public', rec.image_path.replace(/^\//, ''));
      if (fs.existsSync(fePath)) fs.unlinkSync(fePath);
    }
  }

  console.log('Searching and downloading candidate for INSULIN 40IU (ID 281310)...');
  const result = await catalogImageService.searchAndDownloadCandidate(medId, 1);

  if (result) {
    console.log('\n--- DOWNLOAD SUCCESS ---');
    console.log('ID:', result.id);
    console.log('Product Name:', result.product_name);
    console.log('Company:', result.company_name);
    console.log('Score:', result.confidence_score);
    console.log('Verification Status:', result.verification_status);
    console.log('Image Path:', result.image_path);
    console.log('Image Type:', (result as any).image_type);
    console.log('Reason:', result.verification_reason);
    console.log('Source:', result.source_url);
  } else {
    console.log('\n--- NO CANDIDATE DOWNLOADED (REJECTED/BLOCKED) ---');
  }
}

run().catch(console.error);
