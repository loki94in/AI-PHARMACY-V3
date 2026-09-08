import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { catalogImageService } from '../src/services/catalogImageService.js';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const TARGET_FRONTEND = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(ROOT_DIR, 'uploads', 'products');

fs.mkdirSync(TARGET_FRONTEND, { recursive: true });
fs.mkdirSync(TARGET_UPLOADS, { recursive: true });

const db = new Database(DB_PATH);

const rejectedMeds = db.prepare(`
  SELECT DISTINCT m.id, m.name, m.manufacturer, m.generic_name, m.packaging, m.strength
  FROM medicines m
  JOIN catalog_images ci ON ci.medicine_id = m.id
  WHERE ci.verification_status = 'REJECTED'
    AND m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
  ORDER BY m.id ASC
`).all();

console.log(`Loaded ${rejectedMeds.length} medicines needing genuine images.`);

export function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

export function generateSearchQueries(med) {
  const queries = new Set();
  const rawName = (med.name || '').trim();
  const mfg = (med.manufacturer || '').trim();
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

  // 1. SSR web search (full catalog including OTC, Dettol, Cipladine, Manforce, Ayurvedic, etc.)
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

  // 2. REST API search (prescription drugs)
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

async function downloadImage(url, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
    return fs.statSync(destPath).size;
  }
  const cleanUrl = url.split('?')[0];
  const res = await fetch(cleanUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function main() {
  console.log('===========================================================');
  console.log('--- STARTING DUAL-SEARCH IMAGE ATTACH ENGINE ---');
  console.log('===========================================================');

  let success = 0;
  let unresolved = 0;
  const insertStmt = db.prepare(`
    INSERT INTO catalog_images (
      medicine_id, product_name, company_name, image_path, thumbnail_path,
      image_source, source_url, confidence_score, matching_method,
      verification_status, verification_reason, is_active, is_primary
    ) VALUES (?, ?, ?, ?, ?, 'pharmeasy_verified', ?, ?, 'ai_multi_signal_strict', 'HIGH_CONFIDENCE', ?, 1, 1)
  `);

  const historyStmt = db.prepare(`
    INSERT INTO image_review_history (
      product_image_id, medicine_id, previous_status, new_status, action, reason, performed_by
    ) VALUES (?, ?, 'REJECTED', 'HIGH_CONFIDENCE', 'AUTO_DOWNLOAD_REPLACE', ?, 'dual_search_engine')
  `);

  const fileCache = new Map();
  // Map from normalized medicine identity to matched result
  const identityMatchMap = new Map();
  const unresolvedList = [];

  for (let i = 0; i < rejectedMeds.length; i++) {
    const med = rejectedMeds[i];

    // Identity normalization
    let clean = med.name
      .replace(/\[.*?\]/g, ' ')
      .replace(/[\t\r\n]/g, ' ')
      .replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let norm = clean.replace(/^([A-Za-z\s]+?)\s+\d{2,3}\s+([A-Za-z])/i, '$1 $2').replace(/\s+/g, ' ').trim().toUpperCase();
    const identityKey = `${norm}__${(med.manufacturer || '').toUpperCase()}`;

    let bestCandidate = null;
    let bestScore = 0;
    let bestMatch = null;

    // Check if this exact product was already resolved in this run
    if (identityMatchMap.has(identityKey)) {
      const cached = identityMatchMap.get(identityKey);
      if (cached) {
        bestCandidate = cached.candidate;
        bestScore = cached.score;
        bestMatch = cached.match;
      }
    } else {
      const queries = generateSearchQueries(med);
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
              bestMatch = match;
            }
          }
        }

        if (bestCandidate && bestScore >= 95) break;
        await new Promise(r => setTimeout(r, 100));
      }

      // Cache identity result (even if null to avoid duplicate web requests for same unresolvable item)
      if (bestCandidate) {
        identityMatchMap.set(identityKey, { candidate: bestCandidate, score: bestScore, match: bestMatch });
      } else {
        identityMatchMap.set(identityKey, null);
      }
    }

    if (bestCandidate) {
      const damImages = bestCandidate.damImages || [];
      const rawImgUrl = (damImages.length > 0 && damImages[0].url) 
        ? damImages[0].url 
        : (bestCandidate.image ? bestCandidate.image : null);

      if (rawImgUrl) {
        const slug = slugify(bestCandidate.name);
        const fileName = `${slug}-front.jpg`;
        const pFront = path.join(TARGET_FRONTEND, fileName);
        const pUpload = path.join(TARGET_UPLOADS, fileName);

        try {
          if (!fileCache.has(fileName)) {
            await downloadImage(rawImgUrl, pFront);
            fs.copyFileSync(pFront, pUpload);
            fileCache.set(fileName, `/products/${fileName}`);
          }

          const relPath = `/products/${fileName}`;
          const insertRes = insertStmt.run(
            med.id,
            bestCandidate.name,
            bestCandidate.manufacturer || med.manufacturer,
            relPath,
            relPath,
            rawImgUrl.split('?')[0],
            bestScore,
            bestMatch.reason
          );

          try {
            historyStmt.run(insertRes.lastInsertRowid, med.id, bestMatch.reason);
          } catch {}

          success++;
          console.log(`[${i + 1}/${rejectedMeds.length}] SUCCESS: "${med.name}" -> "${bestCandidate.name}" (Score: ${bestScore})`);
        } catch (e) {
          console.error(`Download error for ${rawImgUrl}: ${e.message}`);
          unresolved++;
          unresolvedList.push(med);
        }
      } else {
        unresolved++;
        unresolvedList.push(med);
      }
    } else {
      unresolved++;
      unresolvedList.push(med);
      console.log(`[${i + 1}/${rejectedMeds.length}] UNRESOLVED: "${med.name}" (Mfg: ${med.manufacturer})`);
    }

    if ((i + 1) % 25 === 0 || i === rejectedMeds.length - 1) {
      console.log(`\n--- Progress: ${i + 1}/${rejectedMeds.length} | Success: ${success} | Unresolved: ${unresolved} ---\n`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Finished dual search pass. Success: ${success}, Unresolved: ${unresolved}`);
  console.log('='.repeat(60));

  fs.writeFileSync('./scripts/unresolved_after_dual_pass.json', JSON.stringify(unresolvedList, null, 2));
  db.close();
}

import { fileURLToPath } from 'url';

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(console.error);
}


