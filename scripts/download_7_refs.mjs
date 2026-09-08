import fs from 'fs';
import path from 'path';

const TARGET_FRONTEND = path.join(process.cwd(), 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(process.cwd(), 'uploads', 'products');

const refs = [
  { name: 'himalaya-baby-powder-front.jpg', url: 'https://cdn01.pharmeasy.in/dam/products_otc/275502/himalaya-baby-prickly-heat-powder-bottle-of-200-g-2-1669655122.jpg?dim=700x0&f=jpg&dpr=1&q=100' },
  { name: 'parachute-100-pure-coconut-oil-front.jpg', url: 'https://cdn01.pharmeasy.in/dam/products_otc/136265/parachute-hair-oil-100ml-2-1671741437.jpg?dim=700x0&f=jpg&dpr=1&q=100' },
  { name: 'dabur-lal-tail-front.jpg', url: 'https://cdn01.pharmeasy.in/dam/products_otc/271343/dabur-lal-tail-100-ml-2-1671741635.jpg?dim=700x0&f=jpg&dpr=1&q=100' },
  { name: 'dabur-red-toothpaste-front.jpg', url: 'https://cdn01.pharmeasy.in/dam/products_otc/051525/dabur-red-paste-100gm-2-1671741637.jpg?dim=700x0&f=jpg&dpr=1&q=100' },
  { name: 'patanjali-dant-kanti-toothpaste-front.jpg', url: 'https://cdn01.pharmeasy.in/dam/products_otc/C42340/patanjali-dant-kanti-toothpaste-200-gm-2-1679653993.jpg?dim=700x0&f=jpg&dpr=1&q=100' },
  { name: 'dabur-triphala-churna-front.jpg', url: 'https://cdn01.pharmeasy.in/dam/products_otc/I05478/dabur-triphala-churna-for-digestion-constipation-oral-powder-jar-500-gm-2-1767943088.jpg?dim=700x0&f=jpg&dpr=1&q=100' }
];

async function run() {
  for (const r of refs) {
    const res = await fetch(r.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(TARGET_FRONTEND, r.name), buf);
      fs.writeFileSync(path.join(TARGET_UPLOADS, r.name), buf);
      console.log(`SAVED: ${r.name} (${buf.length} bytes)`);
    } else {
      console.log(`FAILED: ${r.name} status ${res.status}`);
    }
  }
}

run().catch(console.error);
