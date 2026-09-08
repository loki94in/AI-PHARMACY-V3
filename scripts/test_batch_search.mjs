import fs from 'fs';
import { catalogImageService } from '../src/services/catalogImageService.js';

const meds = JSON.parse(fs.readFileSync('./scripts/rejected_meds_list.json', 'utf8'));

export function generateSearchQueries(med) {
  const queries = new Set();
  const rawName = (med.name || '').trim();
  const mfg = (med.manufacturer || '').trim();
  const pack = (med.packaging || '').trim();
  const strength = (med.strength || '').trim();

  // 1. Basic clean
  let clean = rawName
    .replace(/\[.*?\]/g, ' ')
    .replace(/[\t\r\n]/g, ' ')
    .replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Expand common abbreviations
  let expanded = clean;
  if (/^HIM\b/i.test(expanded)) expanded = expanded.replace(/^HIM\b/i, 'HIMALAYA');
  else if (/^BAID\b/i.test(expanded)) expanded = expanded.replace(/^BAID\b/i, 'BAIDYANATH');
  else if (/^DAB\b/i.test(expanded)) expanded = expanded.replace(/^DAB\b/i, 'DABUR');
  else if (/^ZAN\b/i.test(expanded)) expanded = expanded.replace(/^ZAN\b/i, 'ZANDU');
  else if (/^PAT\b/i.test(expanded)) expanded = expanded.replace(/^PAT\b/i, 'PATANJALI');

  // Fix typos in forms
  expanded = expanded
    .replace(/\bSYP\b/gi, 'SYRUP')
    .replace(/\bTAB\b/gi, 'TABLET')
    .replace(/\bCAP\b/gi, 'CAPSULE')
    .replace(/\bBALAM\b/gi, 'BALM')
    .replace(/\bBAM\b/gi, 'BALM')
    .replace(/\bDIPER\b/gi, 'DIAPER')
    .replace(/\bCURN\b/gi, 'CHURNA')
    .replace(/\bSUNSCREEM\b/gi, 'SUNSCREEN')
    .replace(/\bALOVERA\b/gi, 'ALOE VERA');

  // 3. Clean distributor price tokens
  let strippedPrice = expanded.replace(/^([A-Z\s]+?)\s+\d{2,3}\s+([A-Z])/i, '$1 $2');

  // Add in priority order
  queries.add(strippedPrice);
  queries.add(expanded);
  queries.add(clean);

  // 4. Special brand expansions
  const up = clean.toUpperCase();
  const s = catalogImageService.extractStrength(clean) || strength || '';

  if (up.includes('VICKS') && (up.includes('CREAM') || up.includes('BOTTLE') || up.includes('ROLL'))) {
    queries.add(`Vicks Vaporub ${s}`.trim());
    queries.add(`Vicks Vaporub`);
  }
  if (up.includes('DR ORTHO')) {
    const rawForm = clean.match(/\b(OIL|CREAM|SPRAY|BALM)\b/i)?.[0] || 'Oil';
    queries.add(`Dr Ortho Ayurvedic Medicinal ${rawForm} ${s}`.trim());
    queries.add(`Dr Ortho ${rawForm} ${s}`.trim());
  }
  if (up.includes('BOROLINE')) {
    queries.add(`Boroline Antiseptic Cream ${s}`.trim());
    queries.add(`Boroline Cream`);
  }
  if (up.includes('CREMAFFIN')) {
    queries.add('Cremaffin Constipation Syrup 200ml');
    queries.add('Cremaffin Mint 200ml');
  }
  if (up.includes('DISPOVAN')) {
    queries.add(`Dispovan Syringe ${s}`.trim());
  }
  if (up.includes('ZANDU') && (up.includes('BALM') || up.includes('BAM') || up.includes('BALAM'))) {
    queries.add(`Zandu Balm ${s}`.trim());
    queries.add(`Zandu Balm`);
  }
  if (up.includes('HAMDARD') || up.includes('BADAM SHIRIN')) {
    queries.add(`Hamdard Roghan Badam Shirin ${s}`.trim());
    queries.add(`Roghan Badam Shirin`);
  }
  if (up.includes('HEMPUSHPA')) {
    queries.add(`Hempushpa Syrup ${s}`.trim());
    queries.add(`Hempushpa`);
  }
  if (up.includes('ZINDA TILISMATH')) {
    queries.add(`Zinda Tilismath Liquid ${s}`.trim());
  }
  if (up.includes('AMRUTANJAN')) {
    queries.add(`Amrutanjan Pain Relief Balm ${s}`.trim());
    queries.add(`Amrutanjan Strong ${s}`.trim());
  }

  // 5. Distinctive Brand + Pack
  const coreBrand = catalogImageService.extractCoreBrand(expanded);
  if (coreBrand && coreBrand.length >= 3) {
    let q = coreBrand;
    if (s) q += ` ${s}`;
    queries.add(q.trim());
  }

  return Array.from(queries).filter(q => q && q.length >= 3);
}

async function searchCandidates(query) {
  const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(query)}&page=1`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.products || [];
  } catch (e) {
    return [];
  }
}

async function runTest() {
  const sample = meds.slice(0, 30);
  let matched = 0;
  let notFound = 0;

  for (let i = 0; i < sample.length; i++) {
    const med = sample[i];
    const queries = generateSearchQueries(med);
    let bestCandidate = null;
    let bestScore = 0;
    let bestMatchDetails = null;

    for (const q of queries) {
      const candidates = await searchCandidates(q);
      for (const cand of candidates) {
        const hasImg = Boolean(cand.image || (cand.damImages && cand.damImages.length > 0));
        if (!hasImg) continue;

        const match = catalogImageService.computeConfidence(
          {
            name: med.name,
            manufacturer: med.manufacturer,
            strength: med.strength,
            packaging: med.packaging
          },
          {
            name: cand.name,
            manufacturer: cand.manufacturer
          }
        );

        if (match.verificationStatus === 'HIGH_CONFIDENCE' && match.confidenceScore >= 80) {
          if (match.confidenceScore > bestScore) {
            bestScore = match.confidenceScore;
            bestCandidate = cand;
            bestMatchDetails = match;
          }
        }
      }
      if (bestCandidate && bestScore >= 95) break; // found perfect match
      await new Promise(r => setTimeout(r, 200)); // polite delay
    }

    if (bestCandidate) {
      matched++;
      console.log(`[PASS ${matched}] "${med.name}"`);
      console.log(`   -> Matched: "${bestCandidate.name}" | Score: ${bestScore}`);
      console.log(`   -> Reason: ${bestMatchDetails.reason}`);
    } else {
      notFound++;
      console.log(`[NO MATCH] "${med.name}" (Mfg: ${med.manufacturer})`);
    }
  }

  console.log(`\nResults: ${matched} matched with HIGH_CONFIDENCE, ${notFound} not found`);
}

runTest();
