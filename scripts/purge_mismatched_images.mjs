import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const STATE_FILE = path.join(ROOT_DIR, 'data', 'image_download_state.json');
const PRODUCTS_DIR = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads', 'products');

if (!fs.existsSync(STATE_FILE)) {
  console.error('State file does not exist:', STATE_FILE);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

function cleanName(raw) {
  let c = raw.replace(/\[.*?\]/g, ' ');
  c = c.replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ');
  return c.replace(/\s+/g, ' ').trim();
}

function extractCoreBrand(raw) {
  const c = cleanName(raw);
  const words = c.split(/[^A-Za-z0-9\+\-]+/).filter(w => w.length >= 2);
  return words[0] ? words[0].toUpperCase() : '';
}

function normalizeStr(s) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isAccurateMatch(catalogName, matchedName) {
  if (!matchedName) return false;
  const brand = extractCoreBrand(catalogName);
  const normBrand = normalizeStr(brand);
  const normMatched = normalizeStr(matchedName);
  return normMatched.includes(normBrand);
}

// 1. Find all mismatched products
const mismatched = [];
for (const [catalogName, p] of Object.entries(state.products || {})) {
  if (p.status !== 'success' && p.status !== 'found') continue;
  if (!isAccurateMatch(catalogName, p.matched_name)) {
    mismatched.push({ catalogName, product: p });
  }
}

console.log(`[Step 1] Identified ${mismatched.length} mismatched products to purge.`);

let deletedFilesCount = 0;

// 2. Delete files and reset state
for (const { catalogName, product } of mismatched) {
  if (product.images) {
    for (const [face, imgInfo] of Object.entries(product.images)) {
      if (imgInfo && imgInfo.fileName) {
        const p1 = path.join(PRODUCTS_DIR, imgInfo.fileName);
        const p2 = path.join(UPLOADS_DIR, imgInfo.fileName);
        if (fs.existsSync(p1)) {
          fs.unlinkSync(p1);
          deletedFilesCount++;
        }
        if (fs.existsSync(p2)) {
          fs.unlinkSync(p2);
        }
      }
    }
  }

  // Reset product state
  state.products[catalogName] = {
    status: 'not_found',
    images: {},
    matched_name: null,
    purged_previous_wrong_match: product.matched_name,
    updated_at: new Date().toISOString()
  };
}

state.last_updated = new Date().toISOString();
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');

console.log(`[Step 1 Complete] Deleted ${deletedFilesCount} incorrect image files and reset ${mismatched.length} state entries.`);
