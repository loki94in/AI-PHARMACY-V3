import fs from 'fs';
import path from 'path';

const TARGET_FRONTEND = path.join(process.cwd(), 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(process.cwd(), 'uploads', 'products');

const list = [
  { name: 'vicks-vaporub-front.jpg', url: 'https://cdn01.pharmeasy.in/dam/products_otc/181135/vicks-vaporub-25ml-relief-from-cold-cough-headache-and-body-pain-2-1755070449.jpg?dim=700x0&f=jpg&dpr=1&q=100' },
  { name: 'dispovan-10ml-syringe-front.jpg', url: 'https://images.apollo247.in/pub/media/catalog/product/S/Y/SYR0007_1.jpg' }
];

async function run() {
  for (const item of list) {
    const res = await fetch(item.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(TARGET_FRONTEND, item.name), buf);
      fs.writeFileSync(path.join(TARGET_UPLOADS, item.name), buf);
      console.log(`Saved ${item.name}: ${buf.length} bytes`);
    } else {
      console.log(`Failed ${item.name}: ${res.status}`);
    }
  }
}

run();
