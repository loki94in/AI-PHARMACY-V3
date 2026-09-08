const urls = [
  // Dabur Honey
  'https://images.apollo247.in/pub/media/catalog/product/D/A/DAB0024_1-JULY23_1.jpg', // 50g
  'https://images.apollo247.in/pub/media/catalog/product/D/A/DAB0019_1-JULY23_1.jpg', // 100g
  'https://images.apollo247.in/pub/media/catalog/product/D/A/DAB0021_1-JULY23_1.jpg', // 250g
  'https://images.apollo247.in/pub/media/catalog/product/D/A/DAB0023_1-JULY23_1.jpg', // 500g
  'https://images.apollo247.in/pub/media/catalog/product/d/a/dab0018-1.jpg',           // 1kg

  // Dispovan / Syringes
  'https://cdn01.pharmeasy.in/dam/products_otc/Q88420/hmd-dispo-van-with-needle-2-ml-syringe-2-1671744183.jpg',
  'https://cdn01.pharmeasy.in/dam/products_otc/I00334/hmd-dispo-van-with-needle-5-ml-syringe-2-1671742468.jpg',
  'https://cdn01.pharmeasy.in/dam/products_otc/I00335/hmd-dispo-van-with-needle-10-ml-syringe-2-1671742469.jpg',

  // Parachute
  'https://cdn01.pharmeasy.in/dam/products_otc/131679/parachute-100-pure-coconut-oil-bottle-of-100-ml-2-1641398939.jpg',
  'https://cdn01.pharmeasy.in/dam/products_otc/131682/parachute-100-pure-coconut-oil-bottle-of-250-ml-2-1641398940.jpg',
  'https://cdn01.pharmeasy.in/dam/products_otc/131683/parachute-100-pure-coconut-oil-bottle-of-500-ml-2-1641398941.jpg',
  'https://cdn01.pharmeasy.in/dam/products_otc/131678/parachute-100-pure-coconut-oil-bottle-of-50-ml-2-1641398938.jpg',

  // Vicks Vaporub
  'https://cdn01.pharmeasy.in/dam/products_otc/181140/vicks-vaporub-50ml-relief-from-cold-cough-headache-and-body-pain-2-1671741170.jpg',
  'https://cdn01.pharmeasy.in/dam/products_otc/181137/vicks-vaporub-25ml-relief-from-cold-cough-headache-and-body-pain-2-1671741169.jpg',
  'https://cdn01.pharmeasy.in/dam/products_otc/181136/vicks-vaporub-10ml-relief-from-cold-cough-headache-and-body-pain-2-1671741168.jpg',
  'https://cdn01.pharmeasy.in/dam/products_otc/181134/vicks-inhaler-05ml-relief-from-blocked-nose-2-1671741166.jpg'
];

async function check() {
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(5000)
      });
      console.log(res.status, res.headers.get('content-type'), u.slice(u.lastIndexOf('/') + 1));
    } catch (e) {
      console.log('ERR', e.message, u.slice(u.lastIndexOf('/') + 1));
    }
  }
}

check();
