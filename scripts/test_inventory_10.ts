import fs from 'fs';
import { dbManager } from '../src/database/connection.js';
import { catalogImageService } from '../src/services/catalogImageService.js';

async function main() {
  const lines = fs.readFileSync('CATALOG/Batch Stock.csv', 'utf-8').split(/\r?\n/);
  const db = await dbManager.getConnection();

  const medCandidates: string[] = [];
  for (let i = 4; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.includes('COMPUTED VALUES')) continue;
    const match = line.match(/^"([^"]+)"/);
    if (!match) continue;
    const rawName = match[1];
    // Filter out cosmetics
    if (/shampoo|oil|soap|face|cream|lotion|colgate|comfort|dove|rin|surf|fabric|powder/i.test(rawName)) continue;
    // Look for TAB, CAP, SYP, INJ, DROPS
    if (/\b(TAB|CAP|SYP|INJ|DROPS)\b/i.test(rawName)) {
      medCandidates.push(rawName);
    }
  }

  // Shuffle and pick 10
  const shuffled = medCandidates.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 10);

  console.log('Selected 10 random pharmacy items from Batch Stock.csv:\n');
  selected.forEach((s, idx) => console.log(`${idx + 1}. ${s}`));

  const report: any[] = [];

  for (let i = 0; i < selected.length; i++) {
    const raw = selected[i];
    const cleanName = raw.replace(/\[.*?\]/g, '').trim();
    console.log(`\n[${i + 1}/10] Looking up in DB: "${cleanName}"`);

    const brand = cleanName.split(/\s+/)[0];
    const med = await db.get(
      'SELECT * FROM medicines WHERE name LIKE ? ORDER BY LENGTH(name) ASC LIMIT 1',
      [`%${brand}%`]
    );

    if (!med) {
      console.log(`  Not found in DB medicines table`);
      report.push({ raw, status: 'NOT_IN_DB' });
      continue;
    }

    console.log(`  Found DB record: ID ${med.id} - ${med.name}`);
    const record = await catalogImageService.searchAndDownloadCandidate(med.id, 1);
    if (record) {
      console.log(`  DOWNLOADED: "${record.product_name}" (Confidence: ${record.confidence_score}%)`);
      console.log(`  File: ${record.image_path}`);
      report.push({
        raw,
        db_name: med.name,
        status: 'SUCCESS',
        product_name: record.product_name,
        confidence: record.confidence_score,
        reason: record.verification_reason,
        image_path: record.image_path,
        source_url: record.source_url
      });
    } else {
      console.log(`  NOT FOUND or REJECTED online`);
      report.push({
        raw,
        db_name: med.name,
        status: 'NOT_FOUND_OR_REJECTED'
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('FINAL REPORT:');
  console.log('='.repeat(80));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
