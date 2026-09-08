import fs from 'fs';
import { catalogImageService } from '../src/services/catalogImageService.js';

const meds = JSON.parse(fs.readFileSync('./scripts/unique_rejected_meds.json', 'utf8'));

export function generateSearchQueries(med) {
  const queries = new Set();
  const rawName = (med.name || '').trim();
  const mfg = (med.mfg || med.manufacturer || '').trim();
  const pack = (med.packaging || '').trim();
  const strength = (med.strength || '').trim();

  let clean = rawName
    .replace(/\[.*?\]/g, ' ')
    .replace(/[\t\r\n]/g, ' ')
    .replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let expanded = clean;
  if (/^HIM\b/i.test(expanded)) expanded = expanded.replace(/^HIM\b/i, 'Himalaya');
  else if (/^BAID\b/i.test(expanded)) expanded = expanded.replace(/^BAID\b/i, 'Baidyanath');
  else if (/^DAB\b/i.test(expanded)) expanded = expanded.replace(/^DAB\b/i, 'Dabur');
  else if (/^ZAN\b/i.test(expanded)) expanded = expanded.replace(/^ZAN\b/i, 'Zandu');
  else if (/^PAT\b/i.test(expanded)) expanded = expanded.replace(/^PAT\b/i, 'Patanjali');

  expanded = expanded
    .replace(/\bSYP\b/gi, 'Syrup')
    .replace(/\bTAB\b/gi, 'Tablet')
    .replace(/\bCAP\b/gi, 'Capsule')
    .replace(/\bBALAM\b/gi, 'Balm')
    .replace(/\bBAM\b/gi, 'Balm')
    .replace(/\bDIPER\b/gi, 'Diaper')
    .replace(/\bCURN\b/gi, 'Churna')
    .replace(/\bSUNSCREEM\b/gi, 'Sunscreen')
    .replace(/\bALOVERA\b/gi, 'Aloe Vera');

  let strippedPrice = expanded.replace(/^([A-Za-z\s]+?)\s+\d{2,3}\s+([A-Za-z])/i, '$1 $2').replace(/\s+/g, ' ').trim();

  const up = clean.toUpperCase();
  const mfgUp = mfg.toUpperCase();
  const s = catalogImageService.extractStrength(clean) || strength || '';

  // Targeted queries
  if (up.includes('VICKS')) {
    if (up.includes('INHALER')) queries.add('Vicks Inhaler');
    else if (up.includes('DROP') || up.includes('TAB 1200') || up.includes('COUGH')) queries.add('Vicks Cough Drops');
    else if (up.includes('ACTION 500')) queries.add('Vicks Action 500');
    else if (up.includes('BABY')) queries.add('Vicks Babyrub');
    else if (up.includes('ZZZQUIL')) queries.add('Vicks ZzzQuil');
    else if (up.includes('ROLL')) queries.add('Vicks Roll On');
    else {
      if (s) queries.add(`Vicks Vaporub ${s}`);
      queries.add('Vicks Vaporub');
    }
  }

  if (up.includes('BOROLINE')) {
    if (s) queries.add(`Boroline Antiseptic Cream ${s}`);
    queries.add('Boroline Antiseptic Cream');
  }

  if (up.includes('DETTOL')) {
    if (up.includes('HAND WASH') || up.includes('HANDWASH') || up.includes('REFILL')) {
      if (s) queries.add(`Dettol Liquid Handwash ${s}`);
      queries.add('Dettol Liquid Handwash');
    } else if (up.includes('SANITIZER')) {
      queries.add('Dettol Hand Sanitizer');
    } else if (up.includes('SOAP')) {
      queries.add('Dettol Soap');
    } else {
      if (s) queries.add(`Dettol Antiseptic Liquid ${s}`);
      queries.add('Dettol Antiseptic Liquid');
    }
  }

  if (up.includes('CIPLADINE')) {
    if (s) queries.add(`Cipladine ${s} Ointment`);
    queries.add('Cipladine Ointment');
  }

  if (up.includes('MANFORCE')) {
    queries.add('Manforce Staylong Gel');
    queries.add('Manforce Staylong');
  }

  if (up.includes('DR ORTHO')) {
    if (up.includes('CREAM') || up.includes('OINTMENT')) {
      queries.add('Dr Ortho Pain Relief Ointment');
      queries.add('Dr Ortho Ayurvedic Ointment');
    } else {
      if (s) queries.add(`Dr Ortho Ayurvedic Medicinal Oil ${s}`);
      queries.add('Dr Ortho Ayurvedic Medicinal Oil');
      queries.add('Dr Ortho Oil');
    }
  }

  if (up.includes('ZANDU')) {
    if (up.includes('ULTRA')) queries.add('Zandu Ultra Power Balm');
    else if (up.includes('BALM') || up.includes('BAM') || up.includes('BALAM')) {
      if (s) queries.add(`Zandu Balm ${s}`);
      queries.add('Zandu Balm');
    } else if (up.includes('NITYAM')) queries.add('Zandu Nityam');
  }

  if (up.includes('DABUR')) {
    if (up.includes('HONEY')) {
      if (s) queries.add(`Dabur Honey ${s}`);
      queries.add('Dabur Honey');
    } else if (up.includes('HONITUS')) {
      if (s) queries.add(`Dabur Honitus Syrup ${s}`);
      queries.add('Dabur Honitus');
    } else if (up.includes('LAL TAIL') || up.includes('LAL')) {
      if (s) queries.add(`Dabur Lal Tail ${s}`);
      queries.add('Dabur Lal Tail');
    } else if (up.includes('TRIPHALA')) {
      queries.add('Dabur Triphala Churna');
    }
  }

  if (up.includes('CREMAFFIN')) {
    queries.add('Cremaffin Mint Syrup 200ml');
    queries.add('Cremaffin Constipation Syrup');
  }

  if (up.includes('CODISTAR')) {
    queries.add('Codistar Dx Syrup 60ml');
    queries.add('Codistar Dx');
  }

  if (up.includes('IBUGESIC PLUS')) {
    queries.add('Ibugesic Plus Suspension 60ml');
    queries.add('Ibugesic Plus');
  }

  if (up.includes('DOXY')) {
    queries.add('Doxy 100mg Capsule');
    queries.add('Doxy 100mg');
  }

  if (up.includes('ZUKANORM')) {
    queries.add('Zukanorm M 50/500mg Tablet');
    queries.add('Zukanorm M');
  }

  if (up.includes('HEMPUSHPA')) {
    queries.add('Hempushpa Syrup 170ml');
    queries.add('Hempushpa');
  }

  if (up.includes('ZINDA TILISMATH')) {
    queries.add('Zinda Tilismath');
  }

  if (up.includes('SITOPALADI')) {
    queries.add('Baidyanath Sitopaladi Churna');
  }

  if (up.includes('ANU TAILA')) {
    queries.add('Baidyanath Anu Taila');
  }

  if (up.includes('DRAKSHASAVA')) {
    queries.add('Baidyanath Drakshasav');
  }

  if (up.includes('PUNARNAVARISHTA')) {
    queries.add('Baidyanath Punarnavarishta');
  }

  if (up.includes('ABHAYARISHTA')) {
    queries.add('Baidyanath Abhayarishta');
  }

  if (up.includes('KUTAJGHAN')) {
    queries.add('Baidyanath Kutajghan Bati');
  }

  if (up.includes('HEALTH OK')) {
    queries.add('Health OK Sachet');
    queries.add('Mankind Health OK');
  }

  if (mfgUp.includes('PARACHUT') || (up.includes('OIL') && mfgUp.includes('PARACHUT'))) {
    if (s) queries.add(`Parachute Coconut Oil ${s}`);
    queries.add('Parachute Coconut Oil');
  }

  if (mfgUp.includes('BAJAJ') || up.includes('BAJAJ')) {
    if (s) queries.add(`Bajaj Almond Drops Hair Oil ${s}`);
    queries.add('Bajaj Almond Drops Hair Oil');
  }

  if (up.includes('DISPOVAN')) {
    if (s) queries.add(`Dispovan Syringe ${s}`);
    queries.add('Dispovan Syringe');
  }

  if (up.includes('BD INSULIN') || (up.includes('ULTRAFINE') && up.includes('SYRINGE'))) {
    queries.add('BD Ultra Fine Syringe');
    queries.add('BD Insulin Syringe');
  }

  if (up.includes('ADULT') && (up.includes('DIAPER') || up.includes('DIPER'))) {
    if (mfgUp.includes('FRIENDS') || up.includes('FRIENDS')) {
      queries.add('Friends Overnight Adult Diapers Medium');
      queries.add('Friends Overnight Adult Diapers Large');
      queries.add('Friends Adult Diapers');
    }
  }

  if (strippedPrice && strippedPrice.length >= 3) queries.add(strippedPrice);
  if (expanded && expanded.length >= 3) queries.add(expanded);
  if (clean && clean.length >= 3) queries.add(clean);

  const coreBrand = catalogImageService.extractCoreBrand(expanded);
  if (coreBrand && coreBrand.length >= 3 && !['ADULT', 'COTTON', 'BABY', 'SURGICAL', 'OIL', 'CREAM', 'POWDER', 'CASTOR', 'GLOVES'].includes(coreBrand.toUpperCase())) {
    if (s) queries.add(`${coreBrand} ${s}`);
    queries.add(coreBrand);
  }

  return Array.from(queries).filter(q => q && q.length >= 3);
}

// Dual search: SSR Web Search + REST API Search
async function searchCandidates(query) {
  const candidates = [];
  const seen = new Set();

  try {
    const url = `https://pharmeasy.in/search/all?name=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
      if (match) {
        const json = JSON.parse(match[1]);
        const list = json.props?.pageProps?.productList || [];
        for (const p of list) {
          const img = p.image || p.images?.[0] || p.damImages?.[0]?.url;
          if (img && !seen.has(p.name)) {
            seen.add(p.name);
            candidates.push({
              name: p.name,
              manufacturer: p.manufacturer,
              image: img,
              damImages: p.damImages
            });
          }
        }
      }
    }
  } catch (e) {}

  try {
    const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(query)}&page=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      const list = data?.data?.products || [];
      for (const p of list) {
        const img = (p.damImages && p.damImages[0]?.url) || p.image;
        if (img && !seen.has(p.name)) {
          seen.add(p.name);
          candidates.push({
            name: p.name,
            manufacturer: p.manufacturer,
            image: img,
            damImages: p.damImages
          });
        }
      }
    }
  } catch (e) {}

  return candidates;
}

async function testSample() {
  const testItems = [
    { name: 'MANFORCE STAYLONG GEL 10 GM', mfg: 'MANKIND PHARMACEUTICALS LTD' },
    { name: 'DR ORTHO 48 CREAM 15GM', mfg: 'DR ORTHO' },
    { name: 'BOROLINE 10 CREAM 7GM', mfg: 'BOROLINE' },
    { name: 'ABZORB ANTI FUNGAL POWDER BOTTLE OF 100 G', mfg: 'SUN PHARMA (CONSUMER HEALTHCARE)' },
    { name: 'ALKOF JUNIOR COUGH SYP 100ML', mfg: 'ALKEM LABORATORIES LTD' },
    { name: 'BAIDYANATH PUNARNAVARISHTA LIQUID 455 ML', mfg: 'BAIDYANATH AYURVEDA BHAVAN LTD' },
    { name: 'BAIDYANATH DRAKSHASAVA LIQUID 227 ML', mfg: 'BAIDYANATH AYURVEDA BHAVAN LTD' },
    { name: 'CIPLADINE 5% OINT 15GM', mfg: 'CIPLA GX' },
    { name: 'DETTOL ANTISEPTIC LIQUID BOTTLE OF 550 ML', mfg: 'RECKITT BENCKISER' },
    { name: 'IBUGESIC PLUS SUSP 60ML', mfg: 'CIPLA LIMITED' },
    { name: 'CODISTAR DX SYP 60ML', mfg: 'MANKIND PHARMACEUTICALS LTD' },
    { name: 'DOXY 100MG STRIP OF 8 TABLETS', mfg: 'USV PVT LTD' },
    { name: 'HEMPUSHPA SYP 170ML', mfg: 'RAJVAIDYA SHITAL PRASAD & SONS' },
    { name: 'SITOPALADI  CURN 30GM', mfg: 'BAIDYANATH CONSUMER LTD' },
    { name: 'HEALTH OK SACHET', mfg: 'MANKIND PHARMACEUTICALS LTD' }
  ];

  console.log(`Testing ${testItems.length} specific key products:`);
  let passed = 0;

  for (const item of testItems) {
    const queries = generateSearchQueries(item);
    let bestCand = null;
    let bestScore = 0;
    let bestMatch = null;

    for (const q of queries) {
      const candidates = await searchCandidates(q);
      for (const cand of candidates) {
        const match = catalogImageService.computeConfidence(
          { name: item.name, manufacturer: item.mfg },
          { name: cand.name, manufacturer: cand.manufacturer }
        );
        if (match.verificationStatus === 'HIGH_CONFIDENCE' && match.confidenceScore >= 80) {
          if (match.confidenceScore > bestScore) {
            bestScore = match.confidenceScore;
            bestCand = cand;
            bestMatch = match;
          }
        }
      }
      if (bestCand && bestScore >= 95) break;
      await new Promise(r => setTimeout(r, 100));
    }

    if (bestCand) {
      passed++;
      console.log(`[PASS ${passed}/${testItems.length}] "${item.name}"`);
      console.log(`   -> Matched: "${bestCand.name}" (Score: ${bestScore})`);
      console.log(`   -> Reason: ${bestMatch.reason}`);
    } else {
      console.log(`[FAIL] "${item.name}" (Queries: ${queries.join(' | ')})`);
    }
  }

  console.log(`\nFinal score: ${passed} / ${testItems.length} PASSED`);
}

testSample();
