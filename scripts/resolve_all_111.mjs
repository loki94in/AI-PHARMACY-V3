import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { catalogImageService } from '../src/services/catalogImageService.js';

const db = new Database('./data/app.db');

const TARGET_FRONTEND = path.join(process.cwd(), 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(process.cwd(), 'uploads', 'products');

function clean(s) {
  return (s || '').toUpperCase().replace(/\[.*?\]/g, '').replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCore(s) {
  const w = clean(s).split(' ').filter(x => x.length >= 2 && !['TAB', 'TABLET', 'TABLETS', 'CAP', 'CAPSULE', 'CAPSULES', 'SYP', 'SYRUP', 'INJ', 'INJECTION', 'STRIP', 'OF', 'BOTTLE', 'MG', 'ML', 'GM', 'MCG', 'NEW', 'PLUS', 'FORTE', 'DT'].includes(x));
  return w[0] || '';
}

function extractStrength(text) {
  if (!text) return null;
  const m = text.match(/\b(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*(MG|MCG|IU|%)\b/i);
  return m ? `${m[1]}${m[2].toUpperCase()}` : null;
}

function extractForm(text) {
  if (!text) return null;
  const u = text.toUpperCase();
  if (/\b(TAB|TABLET|TABLETS|CAPLET)\b/.test(u)) return 'TABLET';
  if (/\b(CAP|CAPSULE|CAPSULES)\b/.test(u)) return 'CAPSULE';
  if (/\b(SYP|SYRUP|SUSP|SUSPENSION|LIQUID|SOLUTION)\b/.test(u)) return 'SYRUP';
  if (/\b(INJ|INJECTION|VIAL|AMPOULE|INFUSION)\b/.test(u)) return 'INJECTION';
  if (/\b(EYE DROP|EAR DROP|DROPS?)\b/.test(u)) return 'DROPS';
  if (/\b(CREAM|OINT|OINTMENT|GEL|LOTION)\b/.test(u)) return 'CREAM';
  if (/\b(INHALER|RESPULE|ROTACAP)\b/.test(u)) return 'INHALER';
  if (/\b(BALM|VAPORUB|RUB)\b/.test(u)) return 'BALM';
  if (/\b(SOAP|BAR|WASH)\b/.test(u)) return 'SOAP';
  if (/\b(OIL|TAIL|TAILA)\b/.test(u)) return 'OIL';
  if (/\b(POWDER)\b/.test(u)) return 'POWDER';
  if (/\b(PAD|PADS|NAPKIN|NAPKINS|SANITARY)\b/.test(u)) return 'SANITARY_PAD';
  if (/\b(DIAPER|DIAPERS|PANTS?)\b/.test(u)) return 'DIAPER';
  if (/\b(WIPES?)\b/.test(u)) return 'WIPES';
  if (/\b(COTTON|GAUZE|BANDAGE)\b/.test(u)) return 'COTTON';
  if (/\b(SYRINGE|NEEDLE|DISPOVAN)\b/.test(u)) return 'SYRINGE';
  if (/\b(MASK)\b/.test(u)) return 'MASK';
  return null;
}

function sanitizeFileName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function buildSearchQueries(med) {
  const queries = new Set();
  const name = med.med_name || '';
  const mfg = med.med_mfg || '';
  const cleanStr = name.replace(/\[.*?\]/g, ' ').replace(/[\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const up = cleanStr.toUpperCase();
  const mfgUp = mfg.toUpperCase();
  const str = extractStrength(cleanStr);

  // Commodity / brand specific overrides
  if (up.includes('BABY DRY SHEET')) {
    queries.add('Baby Dry Sheet Waterproof Mat');
    queries.add('Baby Dry Sheet');
  } else if (up.includes('DETTOL') && up.includes('WIPES')) {
    queries.add('Dettol Disinfectant Multi Action Wet Wipes');
    queries.add('Dettol Wet Wipes');
  } else if (up.includes('DETTOL') && up.includes('SHAVING')) {
    queries.add('Dettol Lather Shaving Cream Fresh');
    queries.add('Dettol Shaving Cream');
  } else if (up.includes('DETTOL') && (up.includes('HAND WASH') || up.includes('HANDWASH'))) {
    queries.add('Dettol Liquid Handwash Original');
    queries.add('Dettol Hand Wash');
  } else if ((up.includes('HIM') || mfgUp.includes('HIMALAYA')) && up.includes('WIPES')) {
    queries.add('Himalaya Gentle Baby Wipes');
    queries.add('Himalaya Baby Wipes');
  } else if ((up.includes('HIM') || mfgUp.includes('HIMALAYA')) && up.includes('LOTION')) {
    queries.add('Himalaya Baby Lotion');
    queries.add('Himalaya Nourishing Body Lotion');
  } else if ((up.includes('HIM') || mfgUp.includes('HIMALAYA')) && up.includes('BRUSH')) {
    queries.add('Himalaya Baby Toothbrush');
  } else if (up.includes('PAMPERS') && up.includes('NEW BORN')) {
    queries.add('Pampers All Round Protection Pants New Born');
    queries.add('Pampers New Baby Diapers');
  } else if (up.includes('PRO EASE')) {
    queries.add('Pro Ease Sanitary Napkin XL');
    queries.add('Pro Ease Sanitary Pads');
  } else if (up.includes('SANITARY PAD') || (up.includes('WHISPER') && up.includes('PAD'))) {
    queries.add('Whisper Choice Ultra Sanitary Pads');
    queries.add('Whisper Sanitary Pads');
  } else if (up.includes('MASK')) {
    queries.add('Cotton Face Mask Reusable Washable');
    queries.add('3 Ply Surgical Mask');
  } else if (up.includes('METBETIC GL 1/500')) {
    queries.add('Metbetic GL 1/500mg Tablet');
    queries.add('Metbetic GL 1mg 500mg');
  } else if (up.includes('MONTAIR FX') && up.includes('LIQUID')) {
    queries.add('Montair FX Syrup 60ml');
    queries.add('Montair FX Suspension');
  } else if (up.includes('HAEM UP') && up.includes('LIQUID')) {
    queries.add('Haem Up Liquid 200ml');
    queries.add('Haem Up Syrup');
  } else if (up.includes('HUMAN ACTRAPID')) {
    queries.add('Human Actrapid 40IU Injection 10ml');
  } else if (up.includes('GABANEURON NT 100')) {
    queries.add('Gabaneuron NT 100mg Tablet');
  } else if (up.includes('GEMINOR M 1/500')) {
    queries.add('Geminor M 1/500mg Tablet');
  } else if (up.includes('MET XL AM 25/2.5')) {
    queries.add('Met XL AM 25/2.5mg Tablet');
  } else if (up.includes('TELPRES CT 40/12.5')) {
    queries.add('Telpres CT 40/12.5mg Tablet');
  } else if (up.includes('ZUKANORM M 50/500')) {
    queries.add('Zukanorm M 50/500mg Tablet');
  } else if (up.includes('ROSYCAP ASP 10/150')) {
    queries.add('Rosycap ASP 10/150mg Capsule');
  } else if (up.includes('ROSYCAP ASP 20/150')) {
    queries.add('Rosycap ASP 20/150mg Capsule');
  } else if (up.includes('CLEAN AND CLEAR') && (up.includes('LIQUID') || up.includes('FACE'))) {
    queries.add('Clean and Clear Morning Energy Face Wash 100ml');
    queries.add('Clean and Clear Face Wash');
  } else if (up.includes('VICKS') && up.includes('TAB')) {
    queries.add('Vicks 3 in 1 Cough Drops');
    queries.add('Vicks Cough Drops');
  } else if (up.includes('VICKS') && up.includes('BABY')) {
    queries.add('Vicks Babyrub');
  } else if (up.includes('ROGAN BADAM') || up.includes('ROGHAN BADAM')) {
    queries.add('Zandu Roghan Badam Shirin Oil 25ml');
    queries.add('Roghan Badam Shirin');
  } else if (up.includes('ORALB') || up.includes('ORAL B')) {
    queries.add('Oral-B Classic Soft Toothbrush');
  } else if (up.includes('LISTRIN') || up.includes('LISTERINE')) {
    queries.add('Listerine Cool Mint Mouthwash 80ml');
  } else if (up.includes('K.S') || up.includes('KAMASUTRA')) {
    queries.add('Kamasutra Deodorant Body Spray');
  } else if (up.includes('MAX') && up.includes('RAZOR')) {
    queries.add('Gillette Presto Razor');
  } else if (up.includes('CALADRYL')) {
    queries.add('Lacto Calamine Lotion 60ml');
    queries.add('Caladew Calamine Lotion 75ml');
  } else if (up.includes('IODEX')) {
    queries.add('Iodex Fast Relief Balm');
    queries.add('Iodex Pain Relief Balm');
  } else if (up.includes('MARKS RUB')) {
    queries.add('Marks Rub Gel');
  } else if (up.includes('TIGER BALM')) {
    queries.add('Tiger Balm Red Ointment');
    queries.add('Tiger Balm White');
  } else if (up.includes('CANDID') && up.includes('POWDER')) {
    queries.add('Candid Dusting Powder 120 Gm');
    queries.add('Candid Dusting Powder');
  } else if (up.includes('EVERYUTH') && up.includes('PEEL')) {
    queries.add('Everyuth Orange Peel Off Mask 100g');
    queries.add('Everyuth Peel Off Mask');
  } else if (up.includes('SENSUR RUB')) {
    queries.add('Sensur Pain Relief Rub 30gm');
  } else if (up.includes('ORASEP')) {
    queries.add('Orasep Mouth Gel 15ml');
  } else if (up.includes('ROSE WATER')) {
    queries.add('Dabur Gulabari Premium Rose Water 120ml');
    queries.add('Dabur Gulabari Rose Water');
  } else if (up.includes('NEEM') && up.includes('OIL')) {
    queries.add('Goodcare Neem Oil');
    queries.add('Pure Neem Oil');
  }

  // Add clean title without noise
  let general = cleanStr
    .replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ')
    .replace(/^([A-Za-z\s]+?)\s+\d{2,3}\s+([A-Za-z])/i, '$1 $2')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (general.length >= 4) queries.add(general);

  // Add brand + strength
  const core = getCore(cleanStr);
  if (core && core.length >= 3 && !['ADULT', 'COTTON', 'BABY', 'SURGICAL', 'OIL', 'CREAM', 'POWDER', 'CASTOR', 'GLOVES', 'SANITARY'].includes(core.toUpperCase())) {
    if (str) queries.add(`${core} ${str}`);
    queries.add(core);
  }

  return Array.from(queries).filter(q => q && q.length >= 3);
}

async function searchPharmEasy(query) {
  try {
    const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(query)}&page=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.products || [];
  } catch (e) {
    return [];
  }
}

async function downloadAndSave(url, fileName) {
  let finalUrl = url;
  if (finalUrl.includes('pharmeasy.in') && !finalUrl.includes('?')) {
    finalUrl += '?dim=700x0&f=jpg&dpr=1&q=100';
  }
  const res = await fetch(finalUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const pFront = path.join(TARGET_FRONTEND, fileName);
  const pUpload = path.join(TARGET_UPLOADS, fileName);
  fs.writeFileSync(pFront, buf);
  fs.copyFileSync(pFront, pUpload);
  return `/products/${fileName}`;
}

async function resolveAll() {
  const issues = JSON.parse(fs.readFileSync('./data/true_mismatches.json', 'utf-8'));
  console.log(`Starting resolution for all ${issues.length} true mismatches...\n`);

  let resolvedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < issues.length; i++) {
    const item = issues[i];
    console.log(`[${i+1}/${issues.length}] Resolving Med ${item.medicine_id}: "${item.med_name}" [${item.med_mfg}]`);
    console.log(`  Current bad image: "${item.img_product_name}" (${item.image_path}) | Issue: ${item.reasons}`);

    const queries = buildSearchQueries(item);
    let best = null;

    for (const q of queries) {
      const prods = await searchPharmEasy(q);
      for (const p of prods) {
        const damImages = p.damImages || [];
        // Face evaluation: front, back, or default
        const frontImg = damImages.find(img => img.face === 'front')?.url;
        const backImg = damImages.find(img => img.face === 'back')?.url;
        
        // For solid orals (tablets/capsules), back foil has the composition; for bottles/boxes front has the logo
        const chosenImgUrl = frontImg || backImg || (damImages[0] && damImages[0].url) || p.image;
        if (!chosenImgUrl) continue;

        const match = catalogImageService.computeConfidence(
          {
            name: item.med_name,
            manufacturer: item.med_mfg
          },
          {
            name: p.name,
            manufacturer: p.manufacturer,
            imagePath: chosenImgUrl
          }
        );

        if (match.verificationStatus === 'HIGH_CONFIDENCE' || match.confidenceScore >= 75) {
          best = {
            product: p,
            chosenImgUrl,
            face: frontImg ? 'front' : (backImg ? 'back' : 'default'),
            match
          };
          break;
        }
      }
      if (best) break;
    }

    if (best) {
      try {
        const destName = `${sanitizeFileName(item.med_name)}-${best.face}-${Date.now()}.jpg`;
        const localPath = await downloadAndSave(best.chosenImgUrl, destName);

        // Update database: Deactivate old image and insert/activate new verified image
        db.prepare('UPDATE catalog_images SET is_active = 0, verification_status = "REJECTED", verification_reason = ? WHERE id = ?').run(
          `Replaced with authentic image: ${item.reasons}`,
          item.image_id
        );

        db.prepare(`
          INSERT INTO catalog_images (
            medicine_id, product_name, company_name, image_path, thumbnail_path,
            image_source, source_url, confidence_score, matching_method,
            verification_status, verification_reason, is_active, is_primary, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(
          item.medicine_id,
          best.product.name,
          best.product.manufacturer || item.med_mfg,
          localPath,
          localPath,
          'pharmeasy_api_verified',
          best.chosenImgUrl,
          best.match.confidenceScore,
          'multi_signal_deep_audit',
          'HIGH_CONFIDENCE',
          `Verified match: Brand=${best.match.signals.brandMatch}, Mfg=${best.match.signals.companyMatch}, Face=${best.face}`
        );

        resolvedCount++;
        console.log(`  REPLACED WITH: "${best.product.name}" [${best.product.manufacturer}] (Score: ${best.match.confidenceScore}%, Face: ${best.face}) -> ${localPath}\n`);
      } catch (err) {
        console.error(`  Download error for Med ${item.medicine_id}:`, err.message);
        skippedCount++;
      }
    } else {
      console.log(`  NO VERIFIED MATCH FOUND - Keeping candidate under review.\n`);
      skippedCount++;
    }
  }

  console.log('='.repeat(70));
  console.log(`RESOLUTION COMPLETE: Replaced & Verified: ${resolvedCount} | Unresolved: ${skippedCount}`);
  console.log('='.repeat(70));
}

resolveAll().catch(console.error);
