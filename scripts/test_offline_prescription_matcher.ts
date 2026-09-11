import fs from 'fs';
import { dbManager } from '../src/database/connection.js';

async function testMatching() {
  const db = await dbManager.getConnection();

  const detectedLines = [
    { raw: 'Dolo 650mg', qty: 10 },
    { raw: 'Th. Pan 40mg', qty: 6 },
    { raw: 'Zifi-O 200mg', qty: 6 },
    { raw: 'Cap Uprise - D3 60K', qty: 12 }
  ];

  console.log('=== MATCHING DETECTED LINES AGAINST 286,210 MEDICINES IN DATABASE ===\n');

  for (const item of detectedLines) {
    // 1. Extract dosage form
    let form = 'TABLET';
    if (/\b(cap|capsule)\b/i.test(item.raw)) form = 'CAPSULE';
    else if (/\b(syp|syrup)\b/i.test(item.raw)) form = 'SYRUP';

    // 2. Extract strength (e.g. 650mg, 40mg, 200mg, 60K)
    const strengthMatches = Array.from(item.raw.matchAll(/(\d+(?:\.\d+)?\s*(?:mg|gm|g|ml|k|iu)?)/gi)).map(m => m[1]);
    // The main dosage strength is typically the one with units or the largest / last number
    let targetStrength = '';
    for (const sm of strengthMatches) {
      if (/(?:mg|gm|k|iu)/i.test(sm)) {
        targetStrength = sm;
      }
    }
    if (!targetStrength && strengthMatches.length > 0) {
      targetStrength = strengthMatches[strengthMatches.length - 1];
    }

    // 3. Clean brand tokens
    // Replace punctuation but preserve alphanumeric
    const normalizedRaw = item.raw
      .replace(/\b(th|tb|tab|tablet|cap|capsule|inj|syp)\b/gi, ' ')
      .replace(/\(\d+\)/g, ' ') // remove circled quantities like (6), (12)
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .trim();

    const tokens = normalizedRaw.split(/\s+/).filter(t => t.length >= 2 && !/^(mg|gm|ml|iu|tab|cap)$/i.test(t));
    
    // Find primary brand token (e.g. DOLO, PAN, ZIFI, UPRISE)
    const brandTokens = tokens.filter(t => !/^\d+k?$/i.test(t));
    const mainBrand = brandTokens[0] || '';
    const secondBrand = brandTokens[1] || '';

    console.log(`[Input] "${item.raw}" (Qty: ${item.qty}) -> Brand: "${mainBrand} ${secondBrand}".trim(), Strength: "${targetStrength}", Form: ${form}`);

    // Query SQLite database
    let query = `
      SELECT id, name, packaging, manufacturer, mrp 
      FROM medicines 
      WHERE (name LIKE ? OR name LIKE ?)
    `;
    const params: any[] = [`${mainBrand} %`, `${mainBrand}%`];

    if (secondBrand && !['D3', 'D', 'O', 'CV', 'LB', 'PLUS'].includes(secondBrand.toUpperCase())) {
      query += ` AND name LIKE ?`;
      params.push(`%${secondBrand}%`);
    } else if (secondBrand) {
      query += ` AND name LIKE ?`;
      params.push(`%${secondBrand}%`);
    }

    if (targetStrength) {
      const numOnly = targetStrength.replace(/[^0-9]/g, '');
      if (numOnly) {
        query += ` AND (name LIKE ? OR name LIKE ?)`;
        params.push(`%${numOnly}MG%`, `%${numOnly}%`);
      }
    }

    if (form === 'CAPSULE') {
      query += ` AND (name LIKE '%CAP%' OR packaging LIKE '%CAP%')`;
    } else if (form === 'TABLET') {
      query += ` AND (name LIKE '%TAB%' OR packaging LIKE '%TAB%')`;
    }

    query += ` ORDER BY name ASC LIMIT 3`;

    const matches = await db.all(query, params);

    console.log(`  -> Top Database Matches:`);
    if (matches.length === 0) {
      // Fallback without strict strength
      const fallbackMatches = await db.all(
        `SELECT id, name, packaging, manufacturer, mrp FROM medicines WHERE name LIKE ? LIMIT 3`,
        [`${mainBrand}%`]
      );
      fallbackMatches.forEach((m, idx) => {
        console.log(`     [${idx + 1}] ID: ${m.id} | ${m.name} | Mfg: ${m.manufacturer} | Pkg: ${m.packaging} | MRP: ₹${m.mrp}`);
      });
    } else {
      matches.forEach((m, idx) => {
        console.log(`     [${idx + 1}] ID: ${m.id} | ${m.name} | Mfg: ${m.manufacturer} | Pkg: ${m.packaging} | MRP: ₹${m.mrp}`);
      });
    }
    console.log('');
  }
}

testMatching().catch(console.error);
