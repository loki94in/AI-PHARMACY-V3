import { dbManager } from '../src/database/connection.js';
import { catalogImageService } from '../src/services/catalogImageService.js';

async function main() {
  console.log('='.repeat(80));
  console.log('   AI PHARMACY — DOWNLOADING 10 RANDOM MEDICINES FOR USER REVIEW');
  console.log('='.repeat(80));

  const db = await dbManager.getConnection();
  
  // Pick 10 random medicines from master DB
  const randomMeds = await db.all(`
    SELECT id, name, manufacturer, strength, packaging, mrp
    FROM medicines
    ORDER BY RANDOM()
    LIMIT 10
  `);

  console.log(`Selected 10 random medicines from master DB:\n`);
  randomMeds.forEach((m, i) => {
    console.log(`${i + 1}. [ID: ${m.id}] ${m.name} | Mfg: ${m.manufacturer || 'N/A'} | Strength: ${m.strength || 'N/A'}`);
  });
  console.log('\nStarting search and download process...\n');

  const results = [];

  for (let i = 0; i < randomMeds.length; i++) {
    const med = randomMeds[i];
    console.log(`\n--- [${i + 1}/10] Processing ID ${med.id}: ${med.name} ---`);
    try {
      const record = await catalogImageService.searchAndDownloadCandidate(med.id, 1);
      if (record) {
        console.log(`  SUCCESS!`);
        console.log(`  Product Found: "${record.product_name}"`);
        console.log(`  Confidence Score: ${record.confidence_score}% (${record.verification_status})`);
        console.log(`  Reason: ${record.verification_reason}`);
        console.log(`  Local File Path: ${record.image_path}`);
        console.log(`  Source URL: ${record.source_url}`);
        results.push({
          index: i + 1,
          id: med.id,
          medicine_name: med.name,
          manufacturer: med.manufacturer,
          status: 'FOUND',
          downloaded: record
        });
      } else {
        console.log(`  NOT FOUND online or rejected by multi-signal filter.`);
        results.push({
          index: i + 1,
          id: med.id,
          medicine_name: med.name,
          manufacturer: med.manufacturer,
          status: 'NOT_FOUND_OR_REJECTED',
          downloaded: null
        });
      }
    } catch (err: any) {
      console.error(`  ERROR:`, err.message);
      results.push({
        index: i + 1,
        id: med.id,
        medicine_name: med.name,
        manufacturer: med.manufacturer,
        status: 'ERROR',
        error: err.message
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('   SUMMARY REPORT');
  console.log('='.repeat(80));
  console.log(JSON.stringify(results, null, 2));

  // Exit cleanly
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
