import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
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

const verifiedTargets = [
  {
    catalogName: 'O2 TAB 10 S [MEDLY]',
    query: 'O2 Tablet Medley',
    brandMatch: /\bO2\b/i,
    requiredKeyword: /\b(tablet|tab|strip)\b/i,
    slug: 'o2-tab-10-s'
  },
  {
    catalogName: 'PD PUPPY FOOD 1.2KG [PEDIGREE]',
    query: 'Pedigree Puppy Chicken & Milk 1.2 Kg',
    brandMatch: /\bPedigree\b/i,
    requiredKeyword: /\b(puppy|dog food)\b/i,
    slug: 'pd-puppy-food-12kg'
  },
  {
    catalogName: 'NDS-N FLOX TZ 400/600 MG TABLET 10 [LABORATE PHARMACEUTICALS INDIA LTD]',
    query: 'Nds Advanced Nflox Tz',
    brandMatch: /\bNds\b/i,
    requiredKeyword: /\b(nflox|tz)\b/i,
    slug: 'nds-n-flox-tz-400600-mg-tablet-10'
  },
  {
    catalogName: 'R7 DROP 30ML [DR RECKEWEG]',
    query: 'Dr Reckeweg R7 Drop',
    brandMatch: /\bReckeweg\b/i,
    requiredKeyword: /\bR7\b/i,
    slug: 'r7-drop-30ml'
  }
];

async function run() {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  for (const t of verifiedTargets) {
    console.log(`Processing verified item: ${t.catalogName}...`);
    const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(t.query)}&page=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) continue;
    const data = await res.json();
    const prods = data?.data?.products || [];

    let chosen = null;
    for (const p of prods) {
      if (t.brandMatch.test(p.name) && t.requiredKeyword.test(p.name)) {
        if ((p.damImages && p.damImages.length > 0) || Boolean(p.image)) {
          chosen = p;
          break;
        }
      }
    }

    if (!chosen) {
      console.log(`  No exact match found for ${t.catalogName}`);
      continue;
    }

    console.log(`  Found exact: "${chosen.name}"`);
    const imagesMap = {};
    const damImages = chosen.damImages || [];

    if (damImages.length > 0) {
      for (const img of damImages) {
        const face = img.face || 'default';
        if (!imagesMap[face] && img.url) {
          const fileName = `${t.slug}-${face}.jpg`;
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
          } catch (e) {}
        }
      }
    } else if (chosen.image) {
      const fileName = `${t.slug}-front.jpg`;
      const destFront = path.join(TARGET_FRONTEND, fileName);
      const destUpload = path.join(TARGET_UPLOADS, fileName);
      try {
        const bytes = await downloadImage(chosen.image.split('?')[0], destFront);
        fs.copyFileSync(destFront, destUpload);
        imagesMap['front'] = {
          fileName,
          url: `/products/${fileName}`,
          uploadsUrl: `/uploads/products/${fileName}`,
          bytes
        };
      } catch (e) {}
    }

    if (Object.keys(imagesMap).length > 0) {
      state.products[t.catalogName] = {
        status: 'success',
        matched_name: chosen.name,
        slug: t.slug,
        images: imagesMap,
        updated_at: new Date().toISOString(),
        verified: true
      };
      console.log(`  Successfully downloaded and updated ${Object.keys(imagesMap).length} images for ${t.catalogName}`);
    }
  }

  state.last_updated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  console.log('Finished accurately re-fetching verified items.');
}

run();
