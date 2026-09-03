#!/usr/bin/env node

/**
 * scripts/retry-not-found-images.mjs
 * 
 * Enhanced Image Retry Worker for Previously "Not Found" Medicines.
 * 
 * Improvements over original downloader:
 * 1. Checks top 5 search results instead of only index 0 (capturing alternate pack sizes / views).
 * 2. Multi-tier query fallbacks:
 *    - Tier 1: Standard cleaned query (stripping manufacturer & container boilerplate).
 *    - Tier 2: Stripping pack count numbers (e.g. "ACILOC 300MG TAB 15" -> "ACILOC 300MG TAB").
 *    - Tier 3: Core brand + strength/form (e.g. "ACILOC 300MG").
 * 3. Validates brand name similarity to prevent false-positive image matching.
 * 4. Saves high-res files to frontend/public/products and uploads/products.
 * 5. Updates data/image_download_state.json incrementally.
 */

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

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
  return { last_updated: null, products: {} };
}

function saveState(state) {
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function generateSearchQueries(rawName) {
  let cleaned = rawName.replace(/\[.*?\]/g, ' ');
  cleaned = cleaned.replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  const queries = [cleaned];

  // Tier 2: Remove trailing pack numbers like 'TAB 15', 'CAP 10', 'TAB 10', 'TABLET 20'
  let t2 = cleaned.replace(/\b(TAB|TABLET|CAP|CAPSULE|SYP|SYRUP|INJ|INJECTION|SUSP|DROPS?|OINT|GEL|CREAM)\s+\d+\b/gi, '$1').trim();
  t2 = t2.replace(/\s+/g, ' ');
  if (t2 && t2 !== cleaned && t2.length > 2) {
    queries.push(t2);
  }

  // Tier 3: Core brand + strength if available (e.g. "ACILOC 300MG" or "ALERID")
  const brandStrengthMatch = cleaned.match(/^([A-Za-z0-9\-\+]+(?:\s+[A-Za-z0-9\-\+]+)?(?:\s+\d+(?:\.\d+)?\s*(?:MG|GM|ML|MCG|IU|%))?)/i);
  if (brandStrengthMatch && brandStrengthMatch[1]) {
    const t3 = brandStrengthMatch[1].trim();
    if (t3 && !queries.includes(t3) && t3.length > 2) {
      queries.push(t3);
    }
  }

  return queries;
}

// Check if candidate product is a legitimate match for the search
function isAcceptableMatch(candidateName, rawQuery) {
  const normCand = candidateName.toLowerCase().replace(/[^\w\s]/g, ' ');
  const normQuery = rawQuery.toLowerCase().replace(/[^\w\s]/g, ' ');

  const queryWords = normQuery.split(/\s+/).filter(w => w.length > 2);
  if (queryWords.length === 0) return true;

  const brandWord = queryWords[0];
  // Candidate MUST contain the primary brand word
  if (!normCand.includes(brandWord)) {
    return false;
  }

  // If query specifies a distinct number/strength (like 150, 300, 500, 625), candidate should ideally share it
  const queryNums = rawQuery.match(/\b\d+(?:\.\d+)?\b/g);
  if (queryNums && queryNums.length > 0) {
    const candNums = candidateName.match(/\b\d+(?:\.\d+)?\b/g) || [];
    const mainNum = queryNums[0];
    // If the main strength number is present in candidate, strong positive
    if (candNums.includes(mainNum)) {
      return true;
    }
  }

  return true;
}

async function fetchFromSearch(query) {
  const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(query)}&page=1`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    },
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const prods = data?.data?.products || [];
  return prods;
}

async function findBestMedicineImages(rawName) {
  const queries = generateSearchQueries(rawName);

  for (const query of queries) {
    try {
      const prods = await fetchFromSearch(query);
      if (!prods || prods.length === 0) continue;

      // Scan up to top 6 results
      for (const p of prods.slice(0, 6)) {
        const hasImages = (p.damImages && p.damImages.length > 0) || Boolean(p.image);
        if (!hasImages) continue;

        if (!isAcceptableMatch(p.name, query)) continue;

        const imageMap = {};
        if (p.damImages && p.damImages.length > 0) {
          for (const img of p.damImages) {
            const face = img.face || 'default';
            if (!imageMap[face] && img.url) {
              imageMap[face] = img.url.split('?')[0];
            }
          }
        }

        if (Object.keys(imageMap).length === 0 && p.image) {
          imageMap['default'] = p.image.split('?')[0];
        }

        if (Object.keys(imageMap).length > 0) {
          return {
            matchedName: p.name,
            slug: p.slug,
            matchedQuery: query,
            images: imageMap
          };
        }
      }
    } catch (err) {
      // Continue to next query tier on error
    }
  }

  return null;
}

async function downloadImage(url, destPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

async function main() {
  console.log('='.repeat(70));
  console.log('       AI PHARMACY — NOT-FOUND IMAGES ENHANCED RETRY');
  console.log('='.repeat(70));

  const state = loadState();
  const notFoundItems = Object.entries(state.products || {})
    .filter(([_, v]) => v.status === 'not_found')
    .map(([k, _]) => k);

  console.log(`Found ${notFoundItems.length} products with 'not_found' status to retry.\n`);

  if (notFoundItems.length === 0) {
    console.log('No items to retry.');
    return;
  }

  let recoveredCount = 0;
  let remainingNotFound = 0;
  let errorCount = 0;

  for (let i = 0; i < notFoundItems.length; i++) {
    const rawName = notFoundItems[i];
    const queries = generateSearchQueries(rawName);
    const itemSlug = slugify(queries[0]);

    process.stdout.write(`[${i + 1}/${notFoundItems.length}] Searching "${queries[0]}"... `);

    try {
      const match = await findBestMedicineImages(rawName);

      if (!match || Object.keys(match.images).length === 0) {
        console.log(`❌ No image available.`);
        remainingNotFound++;
      } else {
        const imageCount = Object.keys(match.images).length;
        console.log(`✅ Matched: "${match.matchedName}" (${imageCount} images)`);

        const downloadedFaces = {};
        for (const [face, imgUrl] of Object.entries(match.images)) {
          const ext = path.extname(imgUrl) || '.jpg';
          const fileName = `${itemSlug}-${face}${ext}`;
          const destFrontend = path.join(TARGET_FRONTEND, fileName);
          const destUploads = path.join(TARGET_UPLOADS, fileName);

          const bytes = await downloadImage(imgUrl, destFrontend);
          fs.copyFileSync(destFrontend, destUploads);

          downloadedFaces[face] = {
            fileName,
            url: `/products/${fileName}`,
            uploadsUrl: `/uploads/products/${fileName}`,
            bytes
          };
        }

        state.products[rawName] = {
          status: 'success',
          matched_name: match.matchedName,
          slug: itemSlug,
          images: downloadedFaces,
          matched_query: match.matchedQuery,
          recovered_in_retry: true,
          updated_at: new Date().toISOString()
        };

        recoveredCount++;
      }
    } catch (err) {
      console.log(`⚠️ Error: ${err.message}`);
      errorCount++;
    }

    // Persist state every 5 items or at the end
    if ((i + 1) % 5 === 0 || i === notFoundItems.length - 1) {
      saveState(state);
    }

    // Gentle pacing to respect rate limits (350ms)
    await new Promise(r => setTimeout(r, 350));
  }

  saveState(state);

  console.log('\n' + '='.repeat(70));
  console.log('                 RETRY RUN COMPLETED');
  console.log('='.repeat(70));
  console.log(`Total Attempted:      ${notFoundItems.length}`);
  console.log(`Newly Recovered:      ${recoveredCount}`);
  console.log(`Still Not Available:  ${remainingNotFound}`);
  console.log(`Errors encountered:   ${errorCount}`);
  console.log(`Total In Store State: ${Object.values(state.products).filter(p => p.status === 'success').length} SUCCESS / ${Object.values(state.products).filter(p => p.status === 'not_found').length} NOT FOUND`);
  console.log('='.repeat(70) + '\n');
}

main().catch(err => {
  console.error('Fatal retry error:', err);
  process.exit(1);
});
