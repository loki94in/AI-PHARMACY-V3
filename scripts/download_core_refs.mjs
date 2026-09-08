import fs from 'fs';
import path from 'path';

const TARGET_FRONTEND = path.join(process.cwd(), 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(process.cwd(), 'uploads', 'products');

async function download(name, query) {
  const url = `https://pharmeasy.in/search/all?name=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (match) {
    const json = JSON.parse(match[1]);
    const list = json.props?.pageProps?.productList || [];
    for (const p of list) {
      if (p.image) {
        let imgUrl = p.image;
        if (imgUrl.includes('pharmeasy.in') && !imgUrl.includes('?')) {
          imgUrl += '?dim=700x0&f=jpg&dpr=1&q=100';
        }
        const imgRes = await fetch(imgUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          }
        });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          if (buf.length > 1000) {
            fs.writeFileSync(path.join(TARGET_FRONTEND, name), buf);
            fs.writeFileSync(path.join(TARGET_UPLOADS, name), buf);
            console.log(`SUCCESS: ${name} -> ${p.name} (${buf.length} bytes)`);
            return true;
          }
        }
      }
    }
  }
  console.log(`FAILED: ${name} for query "${query}"`);
  return false;
}

async function run() {
  await download('himalaya-baby-massage-oil-front.jpg', 'Himalaya Baby Massage Oil 100ml');
  await download('himalaya-baby-powder-front.jpg', 'Himalaya Baby Powder 100g');
  await download('himalaya-baby-lotion-front.jpg', 'Himalaya Baby Lotion 100ml');
  await download('himalaya-baby-cream-front.jpg', 'Himalaya Baby Cream 100ml');
  await download('parachute-100-pure-coconut-oil-front.jpg', 'Parachute 100% Pure Coconut Oil 100ml');
  await download('bajaj-almond-drops-hair-oil-front.jpg', 'Bajaj Almond Drops Hair Oil 100ml');
  await download('dabur-honitus-cough-syrup-front.jpg', 'Dabur Honitus Cough Syrup 100ml');
  await download('dabur-lal-tail-front.jpg', 'Dabur Lal Tail 100ml');
  await download('dabur-amla-hair-oil-front.jpg', 'Dabur Amla Hair Oil 100ml');
  await download('dabur-red-toothpaste-front.jpg', 'Dabur Red Toothpaste 100g');
  await download('moov-pain-relief-ointment-front.jpg', 'Moov Pain Relief Ointment');
  await download('iodex-fast-relief-balm-front.jpg', 'Iodex Fast Relief Balm');
  await download('zandu-balm-front.jpg', 'Zandu Balm 25ml');
  await download('tiger-balm-front.jpg', 'Tiger Balm White 21ml');
  await download('boroline-antiseptic-cream-front.jpg', 'Boroline Antiseptic Ayurvedic Cream');
  await download('patanjali-dant-kanti-toothpaste-front.jpg', 'Patanjali Dant Kanti Toothpaste');
  await download('whisper-choice-sanitary-pads-front.jpg', 'Whisper Choice Sanitary Pads');
  await download('pampers-all-round-protection-pants-front.jpg', 'Pampers All Round Protection Pants');
}

run().catch(console.error);
