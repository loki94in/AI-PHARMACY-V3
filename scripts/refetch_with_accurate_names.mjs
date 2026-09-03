import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const STATE_FILE = path.join(ROOT_DIR, 'data', 'image_download_state.json');
const TARGET_FRONTEND = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(ROOT_DIR, 'uploads', 'products');

fs.mkdirSync(TARGET_FRONTEND, { recursive: true });
fs.mkdirSync(TARGET_UPLOADS, { recursive: true });

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function cleanMedicineName(raw) {
  let cleaned = raw.replace(/\[.*?\]/g, ' ');
  cleaned = cleaned.replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ');
  return cleaned.replace(/\s+/g, ' ').trim();
}

function extractMfg(raw) {
  const match = raw.match(/\[(.*?)\]/);
  return match ? match[1].trim() : '';
}

function generateAccurateQueries(rawName) {
  const mfg = extractMfg(rawName);
  const clean = cleanMedicineName(rawName);
  const queries = [];

  // Special curated accurate queries for known abbreviations
  if (/^O2 TAB/i.test(rawName)) {
    queries.push('O2 Tablet', 'O2 Medley Tablet');
  } else if (/^SW\s+GEL/i.test(rawName)) {
    queries.push('Set Wet Hair Gel', 'Set Wet Wet Look Gel', 'Set Wet Cool Hold Gel');
  } else if (/N\s*95.*8210/i.test(rawName)) {
    queries.push('3M 8210 N95 Mask', '3M Particulate Respirator 8210');
  } else if (/R7\s+DROP/i.test(rawName)) {
    queries.push('Dr. Reckeweg R7 Liver & Gall Bladder Drops', 'Reckeweg R7 Drops');
  } else if (/PD PUPPY FOOD/i.test(rawName)) {
    queries.push('Pedigree Puppy Dry Dog Food Chicken & Milk', 'Pedigree Puppy Food');
  } else if (/NDS-N FLOX TZ/i.test(rawName)) {
    queries.push('Nds New Advanced Nflox Tz', 'Nflox Tz Tablet');
  } else if (/D-DERM-KT/i.test(rawName)) {
    queries.push('D Derm KT Cream');
  }

  // Tier 1: Cleaned brand without brackets
  queries.push(clean);

  // Tier 2: With manufacturer brand if helpful
  if (mfg && !['ABC', 'AYURVED', 'HEALLING', 'MAYA', 'RR', 'SHREE SO'].includes(mfg)) {
    queries.push(`${clean} ${mfg}`);
  }

  // Tier 3: Core brand + strength
  const words = clean.split(/\s+/).filter(w => w.length >= 2);
  if (words.length >= 2) {
    queries.push(`${words[0]} ${words[1]}`);
  }

  return Array.from(new Set(queries));
}

function isBrandMatch(queryBrand, candidateName) {
  if (!candidateName || !queryBrand) return false;
  const cleanQ = queryBrand.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanCand = candidateName.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (cleanCand.includes(cleanQ)) return true;

  // Check individual significant words
  const words = queryBrand.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !['tab', 'tablet', 'syp', 'cream', 'gel', 'capsule', 'drop', 'spray'].includes(w));
  for (const w of words) {
    if (cleanCand.includes(w)) return true;
  }

  return false;
}

async function fetchCandidate(query, primaryBrand) {
  const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(query)}&page=1`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) return null;
    const data = await res.json();
    const prods = data?.data?.products || [];

    for (const prod of prods) {
      const damImages = prod.damImages || [];
      const hasImages = damImages.length > 0 || Boolean(prod.image);
      if (!hasImages) continue;

      // Strict validation against primary brand
      if (isBrandMatch(primaryBrand, prod.name)) {
        return prod;
      }
    }
  } catch (err) {
    // Timeout or network error
  }
  return null;
}

async function downloadImage(url, destPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function run() {
  console.log('='.repeat(75));
  console.log('       AI PHARMACY — ACCURATE IMAGE RE-FETCH WORKER');
  console.log('='.repeat(75));

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  // Collect target products: purged products + not-found products
  const targets = [];
  for (const [name, p] of Object.entries(state.products)) {
    if (p.purged_previous_wrong_match || p.status === 'not_found' || !p.images || Object.keys(p.images).length === 0) {
      targets.push(name);
    }
  }

  console.log(`Identified ${targets.length} products to evaluate for accurate re-fetch.`);

  let newlyFetched = 0;
  let stillNotFound = 0;

  // Process purged first, then top not-found items
  const prioritized = targets.sort((a, b) => {
    const aPurged = state.products[a].purged_previous_wrong_match ? 1 : 0;
    const bPurged = state.products[b].purged_previous_wrong_match ? 1 : 0;
    return bPurged - aPurged;
  });

  // Limit batch size to keep network fast and reliable
  const batch = prioritized.slice(0, 50);

  for (let i = 0; i < batch.length; i++) {
    const rawName = batch[i];
    const clean = cleanMedicineName(rawName);
    const words = clean.split(/[^A-Za-z0-9\+\-]+/).filter(w => w.length >= 2);
    let primaryBrand = words[0] || clean;

    if (/^SW\s+GEL/i.test(rawName)) primaryBrand = 'SET WET';
    if (/^PD PUPPY/i.test(rawName)) primaryBrand = 'PEDIGREE';
    if (/N\s*95.*8210/i.test(rawName)) primaryBrand = '8210';
    if (/R7\s+DROP/i.test(rawName)) primaryBrand = 'R7';

    const queries = generateAccurateQueries(rawName);
    let candidate = null;

    for (const q of queries) {
      candidate = await fetchCandidate(q, primaryBrand);
      if (candidate) break;
      await new Promise(r => setTimeout(r, 150));
    }

    if (candidate) {
      console.log(`\n[MATCH FOUND] ${rawName}`);
      console.log(`  -> Accurately Matched: "${candidate.name}"`);

      const slug = slugify(clean);
      const imagesMap = {};
      const damImages = candidate.damImages || [];

      if (damImages.length > 0) {
        for (const img of damImages) {
          const face = img.face || 'default';
          if (!imagesMap[face] && img.url) {
            const fileName = `${slug}-${face}.jpg`;
            const destFront = path.join(TARGET_FRONTEND, fileName);
            const destUpload = path.join(TARGET_UPLOADS, fileName);
            try {
              const bytes = await downloadImage(img.url.split('?')[0], destFront);
              fs.copyFileSync(destFront, destUpload);
              imagesMap[face] = {
                fileName,
                url: `/products/${fileName}`,
                uploadsUrl: `/uploads/products/${fileName}`,
                bytes
              };
            } catch (dlErr) {
              // skip failed face
            }
          }
        }
      } else if (candidate.image) {
        const fileName = `${slug}-front.jpg`;
        const destFront = path.join(TARGET_FRONTEND, fileName);
        const destUpload = path.join(TARGET_UPLOADS, fileName);
        try {
          const bytes = await downloadImage(candidate.image.split('?')[0], destFront);
          fs.copyFileSync(destFront, destUpload);
          imagesMap['front'] = {
            fileName,
            url: `/products/${fileName}`,
            uploadsUrl: `/uploads/products/${fileName}`,
            bytes
          };
        } catch (dlErr) {}
      }

      if (Object.keys(imagesMap).length > 0) {
        state.products[rawName] = {
          status: 'success',
          matched_name: candidate.name,
          slug,
          images: imagesMap,
          updated_at: new Date().toISOString(),
          verified: true
        };
        newlyFetched++;
      } else {
        stillNotFound++;
      }
    } else {
      stillNotFound++;
    }

    await new Promise(r => setTimeout(r, 200));
  }

  state.last_updated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');

  console.log('\n' + '='.repeat(75));
  console.log(`Re-fetch Complete: ${newlyFetched} accurate images downloaded, ${stillNotFound} accurately marked as not found.`);
  console.log('='.repeat(75));
}

run().catch(err => {
  console.error('Fatal re-fetch error:', err);
  process.exit(1);
});
