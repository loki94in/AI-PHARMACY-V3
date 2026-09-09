import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { catalogImageService } from '../src/services/catalogImageService.js';

const db = new Database('./data/app.db');

const TARGET_FRONTEND = path.join(process.cwd(), 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(process.cwd(), 'uploads', 'products');

function sanitizeFileName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function buildSearchQueries(med) {
  const queries = new Set();
  const name = med.med_name || '';
  const mfg = med.med_mfg || '';
  const clean = name.replace(/\[.*?\]/g, ' ').replace(/[\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const up = clean.toUpperCase();
  const mfgUp = mfg.toUpperCase();

  // Special tailored queries for known commodity lines
  if (up.includes('BABY DRY SHEET')) {
    queries.add('Baby Dry Sheet Waterproof Mat');
    queries.add('Baby Dry Sheet');
  }
  if (up.includes('DETTOL') && up.includes('WIPES')) {
    queries.add('Dettol Disinfectant Multi Action Wet Wipes');
    queries.add('Dettol Wet Wipes');
  }
  if (up.includes('DETTOL') && up.includes('SHAVING')) {
    queries.add('Dettol Lather Shaving Cream Fresh');
    queries.add('Dettol Shaving Cream');
  }
  if (up.includes('DETTOL') && (up.includes('HAND WASH') || up.includes('HANDWASH'))) {
    queries.add('Dettol Liquid Handwash Original');
    queries.add('Dettol Hand Wash');
  }
  if ((up.includes('HIM') || mfgUp.includes('HIMALAYA')) && up.includes('WIPES')) {
    queries.add('Himalaya Gentle Baby Wipes');
    queries.add('Himalaya Baby Wipes');
  }
  if ((up.includes('HIM') || mfgUp.includes('HIMALAYA')) && up.includes('LOTION')) {
    queries.add('Himalaya Baby Lotion');
    queries.add('Himalaya Nourishing Body Lotion');
  }
  if ((up.includes('HIM') || mfgUp.includes('HIMALAYA')) && up.includes('BRUSH')) {
    queries.add('Himalaya Baby Toothbrush');
    queries.add('Himalaya Toothbrush');
  }
  if (up.includes('PAMPERS') && up.includes('NEW BORN')) {
    queries.add('Pampers New Baby Diapers Small New Born');
    queries.add('Pampers All Round Protection Pants New Born');
  }
  if (up.includes('PRO EASE')) {
    queries.add('Pro Ease Sanitary Napkin XL');
    queries.add('Pro Ease Sanitary Pads');
  }
  if (up.includes('SANITARY PAD') || (up.includes('WHISPER') && up.includes('PAD'))) {
    queries.add('Whisper Choice Ultra Sanitary Pads');
    queries.add('Whisper Sanitary Pads');
  }
  if (up.includes('MASK')) {
    queries.add('Cotton Face Mask Reusable');
    queries.add('3 Ply Surgical Mask');
  }
  if (up.includes('METBETIC GL 1/500')) {
    queries.add('Metbetic GL 1/500mg Tablet');
    queries.add('Metbetic GL 1mg 500mg');
  }
  if (up.includes('MONTAIR FX') && up.includes('LIQUID')) {
    queries.add('Montair FX Syrup 60ml');
    queries.add('Montair FX Suspension');
  }
  if (up.includes('HAEM UP') && up.includes('LIQUID')) {
    queries.add('Haem Up Liquid 200ml');
    queries.add('Haem Up Syrup');
  }
  if (up.includes('HUMAN ACTRAPID')) {
    queries.add('Human Actrapid 40IU Injection 10ml');
  }
  if (up.includes('GABANEURON NT 100')) {
    queries.add('Gabaneuron NT 100mg Tablet');
  }
  if (up.includes('GEMINOR M 1/500')) {
    queries.add('Geminor M 1/500mg Tablet');
  }
  if (up.includes('MET XL AM 25/2.5')) {
    queries.add('Met XL AM 25/2.5mg Tablet');
  }
  if (up.includes('TELPRES CT 40/12.5')) {
    queries.add('Telpres CT 40/12.5mg Tablet');
  }
  if (up.includes('ZUKANORM M 50/500')) {
    queries.add('Zukanorm M 50/500mg Tablet');
  }
  if (up.includes('ROSYCAP ASP 10/150')) {
    queries.add('Rosycap ASP 10/150mg Capsule');
  }
  if (up.includes('ROSYCAP ASP 20/150')) {
    queries.add('Rosycap ASP 20/150mg Capsule');
  }
  if (up.includes('CLEAN AND CLEAR') && (up.includes('LIQUID') || up.includes('FACE'))) {
    queries.add('Clean and Clear Morning Energy Face Wash 100ml');
    queries.add('Clean and Clear Face Wash');
  }
  if (up.includes('VICKS') && up.includes('TAB')) {
    queries.add('Vicks Cough Drops Lozenges');
    queries.add('Vicks Cough Drops');
  }
  if (up.includes('VICKS') && up.includes('BABY')) {
    queries.add('Vicks Babyrub');
  }
  if (up.includes('ROGAN BADAM') || up.includes('ROGHAN BADAM')) {
    queries.add('Zandu Roghan Badam Shirin Oil 25ml');
    queries.add('Patanjali Roghan Badam Shirin');
  }
  if (up.includes('ORALB') || up.includes('ORAL B')) {
    queries.add('Oral-B Classic Toothbrush');
  }
  if (up.includes('LISTRIN') || up.includes('LISTERINE')) {
    queries.add('Listerine Cool Mint Mouthwash 80ml');
  }
  if (up.includes('K.S') || up.includes('KAMASUTRA')) {
    queries.add('Kamasutra Deodorant Body Spray');
  }
  if (up.includes('MAX') && up.includes('RAZOR')) {
    queries.add('Gillette Presto Razor');
  }

  // General clean query
  const generalClean = clean
    .replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ')
    .replace(/^([A-Za-z\s]+?)\s+\d{2,3}\s+([A-Za-z])/i, '$1 $2')
    .trim();
  queries.add(generalClean);

  return Array.from(queries);
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

async function testResolver() {
  const issues = JSON.parse(fs.readFileSync('./data/true_mismatches.json', 'utf-8'));
  const testSample = issues.slice(0, 5);

  console.log(`Testing resolver on ${testSample.length} sample issues...\n`);

  for (const item of testSample) {
    console.log(`Searching for Med ${item.medicine_id}: "${item.med_name}" [${item.med_mfg}]`);
    const queries = buildSearchQueries(item);
    console.log(`  Queries:`, queries);

    let resolved = null;
    for (const q of queries) {
      const prods = await searchPharmEasy(q);
      for (const p of prods) {
        // Multi-image face evaluation: pick front or back if back has clear text
        const damImages = p.damImages || [];
        // Prioritize front if available, or back if it's blister foil with text
        const frontImg = damImages.find(img => img.face === 'front')?.url;
        const backImg = damImages.find(img => img.face === 'back')?.url;
        const chosenImgUrl = frontImg || backImg || (damImages[0] && damImages[0].url) || p.image;

        if (!chosenImgUrl) continue;

        // Verify using catalogImageService
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
          resolved = {
            product: p,
            chosenImgUrl,
            face: frontImg ? 'front' : (backImg ? 'back' : 'default'),
            match
          };
          break;
        }
      }
      if (resolved) break;
    }

    if (resolved) {
      console.log(`  MATCH: "${resolved.product.name}" [${resolved.product.manufacturer}] (Score: ${resolved.match.confidenceScore}%, Face: ${resolved.face})`);
      console.log(`  URL: ${resolved.chosenImgUrl}\n`);
    } else {
      console.log(`  NO MATCH FOUND for "${item.med_name}"\n`);
    }
  }
}

testResolver().catch(console.error);
