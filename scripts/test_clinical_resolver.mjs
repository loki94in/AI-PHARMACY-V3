import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const db = new Database('./data/app.db');
const TARGET_FRONTEND = path.resolve('frontend/public/products');
const TARGET_UPLOADS = path.resolve('uploads/products');

const errs = JSON.parse(fs.readFileSync('./data/real_clinical_errors.json', 'utf8'));

// Unique medicines
const uniqueMeds = [];
const seenMeds = new Set();
for (const e of errs) {
  if (!seenMeds.has(e.med_id)) {
    seenMeds.add(e.med_id);
    uniqueMeds.push(e);
  }
}

console.log(`Auditing ${uniqueMeds.length} unique medicines with confirmed mismatches...`);

// Function to search PharmEasy SSR & REST
async function searchPharmEasy(query) {
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
            candidates.push({ name: p.name, manufacturer: p.manufacturer, image: img });
          }
        }
      }
    }
  } catch (e) {}

  if (candidates.length === 0) {
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
            candidates.push({ name: p.name, manufacturer: p.manufacturer, image: img });
          }
        }
      }
    } catch (e) {}
  }

  return candidates;
}

// Function to download image
async function saveImage(url, destFileName) {
  const pFront = path.join(TARGET_FRONTEND, destFileName);
  const pUpload = path.join(TARGET_UPLOADS, destFileName);

  if (!fs.existsSync(pFront) || fs.statSync(pFront).size < 1000) {
    let finalUrl = url;
    if (finalUrl.includes('pharmeasy.in') && !finalUrl.includes('?')) {
      finalUrl += '?dim=700x0&f=jpg&dpr=1&q=100';
    }
    const res = await fetch(finalUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error(`Image payload too small (${buf.length} bytes)`);
    fs.writeFileSync(pFront, buf);
  }

  if (!fs.existsSync(pUpload) || fs.statSync(pUpload).size < 1000) {
    fs.copyFileSync(pFront, pUpload);
  }

  return `/products/${destFileName}`;
}

function clean(s) {
  return (s || '').toUpperCase().replace(/\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractExactStrength(text) {
  if (!text) return null;
  const clean = text.replace(/\b(?:STRIP|PACK|BOTTLE|BOX|TUBE|BLISTER)\s+(?:OF\s+)?\d+\b/gi, ' ');
  const m = clean.match(/\b(\d+(?:\.\d+)?)\s*(MG|MCG|IU|%)\b/i);
  return m ? { full: `${m[1]}${m[2].toUpperCase()}`, val: parseFloat(m[1]), unit: m[2].toUpperCase() } : null;
}

function extractExactVolumeOrWeight(text) {
  if (!text) return null;
  const clean = text.replace(/\b\d+(?:\.\d+)?\s*(?:MG|MCG)\s*\/\s*\d+(?:\.\d+)?\s*ML\b/gi, ' ');
  const m = clean.match(/\b(\d+(?:\.\d+)?)\s*(ML|GM|G|KG)\b/i);
  return m ? { full: `${m[1]}${m[2].toUpperCase().replace('GM', 'G')}`, val: parseFloat(m[1]), unit: m[2].toUpperCase().replace('GM', 'G') } : null;
}

// Generate cleanest search queries
function getSearchQueries(medName) {
  const c = clean(medName);
  const queries = [];
  
  if (c.includes('DISPOVAN') && c.includes('10')) queries.push('Dispovan 10ml Syringe', 'Dispovan 10ml', 'HMD 10ml Syringe');
  else if (c.includes('DISPOVAN') && c.includes('2.5')) queries.push('Dispovan 2.5ml Syringe', 'Dispovan 2ml Syringe', 'Dispovan 2ml');
  else if (c.includes('BETNESOL') && !c.includes('FORTE')) queries.push('Betnesol 0.5mg Tablet', 'Betnesol Tablet');
  else if (c.includes('BANDY') && !c.includes('PLUS')) queries.push('Bandy Suspension 10ml', 'Bandy Oral Suspension');
  else if (c.includes('BUSCOGAST') && !c.includes('PLUS')) queries.push('Buscogast 10mg Tablet', 'Buscogast Tablet');
  else if (c.includes('CALPOL') && c.includes('PLUS')) queries.push('Calpol Plus Syrup');
  else if (c.includes('PANTOSEC') && !c.includes(' D') && !c.includes(' LS')) queries.push('Pantosec 40mg Tablet', 'Pantosec 40');
  else if (c.includes('TELMIKIND') && !c.includes('AM') && !c.includes('CT') && !c.includes('H')) queries.push('Telmikind 40mg Tablet', 'Telmikind 40');
  else if (c.includes('MET XL AM 25/2.5')) queries.push('Met XL AM 25/2.5 Tablet', 'Met XL AM 25 2.5');
  else if (c.includes('ROSYCAP ASP 10/150')) queries.push('Rosycap ASP 10/150 Capsule', 'Rosycap ASP 10 150');
  else if (c.includes('ROSYCAP ASP 20/150')) queries.push('Rosycap ASP 20/150 Capsule', 'Rosycap ASP 20 150');
  else if (c.includes('ZUKANORM M 50/500')) queries.push('Zukanorm M 50/500 Tablet', 'Zukanorm M 50 500');
  else if (c.includes('BADAM SHIRIN') && c.includes('25')) queries.push('Hamdard Roghan Badam Shirin 25ml', 'Rogan Badam Shirin 25ml');
  else if (c.includes('CALADRYL') && c.includes('60')) queries.push('Caladryl Lotion 60ml');
  else if (c.includes('CALADRYL') && c.includes('120')) queries.push('Caladryl Lotion 120ml');
  else {
    // Default queries
    const words = c.split(/\s+/).filter(w => !['TAB', 'TABLET', 'CAP', 'CAPSULE', 'STRIP', 'OF', 'BOTTLE'].includes(w));
    queries.push(words.slice(0, 4).join(' '));
  }
  return queries;
}

// Test first 15 unique meds
async function test() {
  for (const m of uniqueMeds.slice(0, 15)) {
    console.log(`\nMedicine: "${m.med_name}"`);
    console.log(`Current wrong image: "${m.img_name}" [${m.image_path}]`);
    console.log(`Issue: ${m.errorReason}`);
    const queries = getSearchQueries(m.med_name);
    console.log(`Trying queries:`, queries);
    let found = null;
    for (const q of queries) {
      const cands = await searchPharmEasy(q);
      for (const c of cands) {
        // Check if candidate matches exact strength and volume
        const medStr = extractExactStrength(m.med_name);
        const candStr = extractExactStrength(c.name);
        const medVol = extractExactVolumeOrWeight(m.med_name);
        const candVol = extractExactVolumeOrWeight(c.name);

        let valid = true;
        if (medStr && candStr && medStr.val !== candStr.val) valid = false;
        if (medVol && candVol && medVol.val !== candVol.val) valid = false;

        // Check formulation modifiers (PLUS, FORTE, etc.)
        const medMods = ['PLUS', 'FORTE', 'DS', 'AM', 'H', 'CT', 'D', 'M', 'OZ', 'TZ', 'SP', 'LS'].filter(mod => new RegExp(`\\b${mod}\\b`, 'i').test(clean(m.med_name)));
        const candMods = ['PLUS', 'FORTE', 'DS', 'AM', 'H', 'CT', 'D', 'M', 'OZ', 'TZ', 'SP', 'LS'].filter(mod => new RegExp(`\\b${mod}\\b`, 'i').test(clean(c.name)));
        if (JSON.stringify(medMods) !== JSON.stringify(candMods)) valid = false;

        if (valid) {
          found = c;
          break;
        }
      }
      if (found) break;
    }

    if (found) {
      console.log(`-> MATCH FOUND! "${found.name}" | Mfg: ${found.manufacturer}`);
    } else {
      console.log(`-> No exact match found on network. Candidate action: Deactivate/Reject wrong image.`);
    }
  }
}

test();
