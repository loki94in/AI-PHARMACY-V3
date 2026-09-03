#!/usr/bin/env node

/**
 * scripts/download-inventory-images.mjs
 * 
 * Production Batch Image Collector for Pharmacy Inventory.
 * - Reads actual inventory from CATALOG/Batch Stock.csv (skips cosmetics).
 * - Queries genuine pharmaceutical image repositories for front, blister (back), and combo views.
 * - Saves high-res non-watermarked reference images to:
 *     1) frontend/public/products/ (for direct website frontend use)
 *     2) uploads/products/         (for backend API static access)
 * - Tracks state in data/image_download_state.json so runs can be safely resumed anytime.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const CSV_PATH = path.join(ROOT_DIR, 'CATALOG', 'Batch Stock.csv');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'image_download_state.json');
const TARGET_FRONTEND = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(ROOT_DIR, 'uploads', 'products');

// Ensure destination directories exist
fs.mkdirSync(TARGET_FRONTEND, { recursive: true });
fs.mkdirSync(TARGET_UPLOADS, { recursive: true });
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

// Cosmetic patterns to skip
const COSMETIC_REGEX = /\b(shampoo|conditioner|hair oil|chameli oil|amla oil|badam oil|almond oil|coconut oil|jasmine oil|hair dye|hair color|hair colour|hair gel|face wash|facewash|face scrub|face pack|face cream|cleanser|toner|moisturizer|moisturiser|brightening cream|glow cream|whitening cream|fairness|fair & lovely|glow & lovely|ponds|pond's|scrub|serum|body wash|body lotion|vaseline|nivea|baby lotion|baby cream|baby powder|petroleum jelly|sunscreen|sun screen|bleach|lip balm|lipstick|kajal|mascara|eyeliner|foundation|nail polish|perfume|deodorant|deo|body spray|axe|fogg|lux|dove|lifebuoy|santoor|pears|cinthol|mysore sandal|palmolive|hamam|soap|colgate|pepsodent|close up|closeup|toothbrush|toothpaste|chocolate|chocolates|cadbury|dairy milk|5 star|perk|kitkat|biscuit|biscuits|candy|toffee|comfort|surf excel|tide|rin|vim|dishwash|floor cleaner|lizol|harpic|hit red|hit black|good knight|goodknight|all out|allout|odomos|air fresh)\b/i;

const COSMETIC_MFGS = [
  'HINDUSTAN UNILEVER', 'HINDUSTAN UNILIVER', 'LOREAL', 'L\'OREAL', 'CADBURY',
  'MARICO', 'NIVEA', 'GARNIER', 'LOTUS HERBALS', 'GODREJ CONSUMER PRODUCTS',
  'COLGATE-PALMOLIVE', 'JOHNSON & JOHNSON CONSUMER', 'RECKITT BENCKISER (INDIA)',
  'EMAMI LIMITED', 'VLCC', 'JOY PERSONAL CARE', 'RAMSONS', 'AERO CARE'
];

const MEDICATED_SALTS = [
  'KETOCONAZOLE', 'CLOTRIMAZOLE', 'PERMETHRIN', 'CHLORHEXIDINE', 'MICONAZOLE',
  'TERBINAFINE', 'SALICYLIC ACID', 'BENZOYL PEROXIDE', 'FUSIDIC', 'MUPIROCIN',
  'BETAMETHASONE', 'CLOBETASOL', 'MOMETASONE', 'POVIDONE', 'SILVER SULFADIAZINE',
  'CALAMINE'
];

// CLI arguments parser
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    batchSize: 25,
    limit: 0,
    delay: 800,
    category: 'all',
    force: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && args[i + 1]) options.batchSize = parseInt(args[++i], 10);
    else if (args[i] === '--limit' && args[i + 1]) options.limit = parseInt(args[++i], 10);
    else if (args[i] === '--delay' && args[i + 1]) options.delay = parseInt(args[++i], 10);
    else if (args[i] === '--category' && args[i + 1]) options.category = args[++i].toLowerCase();
    else if (args[i] === '--force') options.force = true;
  }
  return options;
}

// Clean medicine raw string for best search relevance
function cleanSearchQuery(rawName) {
  let cleaned = rawName.replace(/\[.*?\]/g, ' '); // remove [MANUFACTURER]
  cleaned = cleaned.replace(/\b(STRIP OF \d+ (TABLETS|CAPSULES)|BOTTLE OF \d+ (TABLETS|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

// Generate URL-friendly slug
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Load or initialize state
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {
      // Fallback on corrupt state
    }
  }
  return { last_updated: null, products: {} };
}

function saveState(state) {
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// Parse CSV lines cleanly
function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

// Read inventory medicines excluding cosmetics
function readInventoryMedicines() {
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split(/\r?\n/);
  
  const products = [];
  const seen = new Set();

  for (let i = 4; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.toLowerCase().includes('computed values') || line.toLowerCase().includes('total qty')) continue;

    const cols = parseCSVLine(line);
    if (cols.length < 2) continue;

    const rawName = (cols[0] || '').trim();
    const pack = (cols[1] || '').trim();
    const sch = (cols[2] || '').trim().toUpperCase();
    const gst = (cols[3] || '').trim();
    const salts = (cols[4] || '').trim().toUpperCase();
    const mfg = (cols[5] || '').trim().toUpperCase();

    if (!rawName || seen.has(rawName)) continue;
    seen.add(rawName);

    // Skip cosmetics
    let isMedicine = true;
    if (sch === 'SCHEDULED H' || sch === 'SCHEDULED H1' || sch === 'NARCOTIC DRUG') {
      isMedicine = true;
    } else {
      const isMedicatedSalt = salts && MEDICATED_SALTS.some(ms => salts.includes(ms));
      const hasCosmKw = COSMETIC_REGEX.test(rawName);
      const isCosmMfg = COSMETIC_MFGS.some(cm => mfg.includes(cm));
      if ((hasCosmKw || isCosmMfg) && !isMedicatedSalt) {
        isMedicine = false;
      }
    }

    if (isMedicine) {
      products.push({
        rawName,
        pack,
        sch,
        gst,
        salts,
        mfg
      });
    }
  }
  return products;
}

// Check if candidate product is a genuine brand match
function isBrandMatch(query, candidateName) {
  if (!candidateName || !query) return false;
  const cleanQ = query.replace(/[^A-Za-z0-9]/g, ' ').toLowerCase().trim();
  const cleanCand = candidateName.replace(/[^A-Za-z0-9]/g, ' ').toLowerCase().trim();
  const qWords = cleanQ.split(/\s+/).filter(w => w.length >= 3 && !['tab', 'tablet', 'tablets', 'cap', 'capsule', 'capsules', 'syp', 'syrup', 'inj', 'injection', 'drop', 'drops', 'pack', 'bottle', 'strip'].includes(w));
  if (qWords.length === 0) return true;
  const brand = qWords[0];
  const candWords = new Set(cleanCand.split(/\s+/));
  const compactQ = cleanQ.replace(/\s+/g, '');
  const compactCand = cleanCand.replace(/\s+/g, '');
  return candWords.has(brand) || cleanCand.includes(brand) || compactCand.includes(brand);
}

// Fetch images for a medicine from PharmEasy CDN API, prioritizing maximum views (front, back, side, combo)
async function fetchImagesForMedicine(query) {
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
  if (prods.length === 0) return null;

  // Filter candidates that have images
  const candidatesWithImages = prods.filter(c => (c.damImages && c.damImages.length > 0) || Boolean(c.image));
  if (candidatesWithImages.length === 0) return null;

  // Sort: brand matches first, then candidate with the highest number of angles (front, back, side, combo)
  candidatesWithImages.sort((a, b) => {
    const aBrand = isBrandMatch(query, a.name) ? 1 : 0;
    const bBrand = isBrandMatch(query, b.name) ? 1 : 0;
    if (aBrand !== bBrand) return bBrand - aBrand;
    const aImgs = a.damImages?.length || (a.image ? 1 : 0);
    const bImgs = b.damImages?.length || (b.image ? 1 : 0);
    return bImgs - aImgs;
  });

  const best = candidatesWithImages[0];
  const damImages = best.damImages || [];
  const imageMap = {};

  // Capture all available angles: front, back, side, combo (combine), box-front, box-back
  for (const img of damImages) {
    const face = img.face || 'default';
    if (!imageMap[face] && img.url) {
      imageMap[face] = img.url.split('?')[0];
    }
  }

  if (Object.keys(imageMap).length === 0 && best.image) {
    imageMap['default'] = best.image.split('?')[0];
  }

  if (Object.keys(imageMap).length > 0) {
    return {
      matchedName: best.name,
      slug: best.slug,
      images: imageMap
    };
  }

  return null;
}

// Download image file safely — NEVER delete or truncate existing files
async function downloadImage(url, destPath) {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
    return fs.statSync(destPath).size;
  }
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

// Main execution routine
async function main() {
  const options = parseArgs();
  console.log('='.repeat(70));
  console.log('       AI PHARMACY — BATCH INVENTORY IMAGE DOWNLOADER');
  console.log('='.repeat(70));
  console.log(`Settings: batchSize=${options.batchSize}, limit=${options.limit || 'none'}, delay=${options.delay}ms, force=${options.force}`);

  const allMedicines = readInventoryMedicines();
  console.log(`Loaded ${allMedicines.length} non-cosmetic medicines from store inventory.`);

  const state = loadState();
  const processedKeys = new Set(Object.keys(state.products || {}));
  console.log(`State file: ${processedKeys.size} medicines already recorded in state.`);

  // Filter items that need download
  let queue = allMedicines;
  if (!options.force) {
    queue = queue.filter(m => !state.products?.[m.rawName] || state.products[m.rawName].status !== 'success');
  }

  if (options.limit > 0) {
    queue = queue.slice(0, options.limit);
  }

  console.log(`Processing queue: ${queue.length} medicines remaining to download.\n`);

  let successCount = 0;
  let skippedCount = 0;
  let failureCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const med = queue[i];
    const query = cleanSearchQuery(med.rawName);
    const itemSlug = slugify(query);

    console.log(`[${i + 1}/${queue.length}] Searching: "${query}"...`);

    try {
      const match = await fetchImagesForMedicine(query);
      if (!match || Object.keys(match.images).length === 0) {
        console.log(`  -> No images found online. Marking skipped.`);
        state.products[med.rawName] = {
          status: 'not_found',
          searched_query: query,
          updated_at: new Date().toISOString()
        };
        skippedCount++;
      } else {
        console.log(`  -> Matched: "${match.matchedName}" (${Object.keys(match.images).length} views)`);
        
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
          console.log(`     Saved [${face}]: ${fileName} (${(bytes / 1024).toFixed(1)} KB)`);
        }

        state.products[med.rawName] = {
          status: 'success',
          matched_name: match.matchedName,
          slug: itemSlug,
          images: downloadedFaces,
          updated_at: new Date().toISOString()
        };
        successCount++;
      }
    } catch (err) {
      console.error(`  -> Error: ${err.message}`);
      state.products[med.rawName] = {
        status: 'error',
        error: err.message,
        updated_at: new Date().toISOString()
      };
      failureCount++;
    }

    // Periodically persist state every 5 items or on completion
    if ((i + 1) % 5 === 0 || i === queue.length - 1) {
      saveState(state);
    }

    // Rate limiting delay
    if (i < queue.length - 1 && options.delay > 0) {
      await new Promise(r => setTimeout(r, options.delay));
    }

    // Pause between batches if batch size reached
    if ((i + 1) % options.batchSize === 0 && (i + 1) < queue.length) {
      console.log(`\n--- Batch of ${options.batchSize} completed. State saved. Pausing 2 seconds... ---\n`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  saveState(state);

  console.log('\n' + '='.repeat(70));
  console.log('                 BATCH DOWNLOAD RUN COMPLETED');
  console.log('='.repeat(70));
  console.log(`Successfully Downloaded: ${successCount}`);
  console.log(`Not Found / Skipped:     ${skippedCount}`);
  console.log(`Errors / Retries:        ${failureCount}`);
  console.log(`State saved at:          ${STATE_FILE}`);
  console.log(`Website Public Assets:   ${TARGET_FRONTEND}`);
  console.log(`Backend Uploads:         ${TARGET_UPLOADS}`);
  console.log('='.repeat(70) + '\n');
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
