import fs from 'fs';
import path from 'path';

const TARGET_FRONTEND = path.join(process.cwd(), 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(process.cwd(), 'uploads', 'products');

async function saveImage(url, destFileName) {
  const pFront = path.join(TARGET_FRONTEND, destFileName);
  const pUpload = path.join(TARGET_UPLOADS, destFileName);

  let finalUrl = url;
  if (finalUrl.includes('pharmeasy.in') && !finalUrl.includes('?')) {
    finalUrl += '?dim=700x0&f=jpg&dpr=1&q=100';
  }
  const res = await fetch(finalUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(pFront, buf);
  fs.copyFileSync(pFront, pUpload);

  return { size: buf.length, path: `/products/${destFileName}` };
}

async function run() {
  const t1 = await saveImage('https://images.apollo247.in/pub/media/catalog/product/D/A/DAB0024_1-JULY23_1.jpg', 'test-dabur-honey-50g.jpg');
  console.log('T1 (Apollo):', t1);

  const t2 = await saveImage('https://cdn01.pharmeasy.in/dam/products_otc/M02588/parachute-advansed-jasmine-coconut-hair-oil-for-shiny-strong-hair-500ml-2-1671741719.jpg?dim=300x0&f=jpg&dpr=3&q=60', 'test-parachute-500ml.jpg');
  console.log('T2 (PE Live Parachute):', t2);

  const t3 = await saveImage('https://cdn01.pharmeasy.in/dam/products_otc/Q88420/hmd-dispo-van-with-needle-2-ml-syringe-2-1671744183.jpg', 'test-dispovan-2ml.jpg');
  console.log('T3 (PE Dispovan):', t3);
}

run().catch(console.error);
