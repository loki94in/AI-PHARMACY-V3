import fs from 'fs';

async function testSSR(name) {
  const url = `https://pharmeasy.in/search/all?name=${encodeURIComponent(name)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
    if (!match) return [];
    const json = JSON.parse(match[1]);
    return json.props?.pageProps?.productList || [];
  } catch(e) {
    return [];
  }
}

async function run() {
  const queries = [
    'Dabur Honitus Syrup 100ml',
    'Dabur Lal Tail 100ml',
    'Dabur Triphala Churna',
    'Dettol Antiseptic Liquid 550ml',
    'Dexona 5mg Tablet',
    'Dispovan 2ml Syringe',
    'Dr Ortho Pain Relief Oil 60ml',
    'Durex Feel Thin',
    'Ecosprin AV 75/20',
    'Enerzal Orange Powder 50g',
    'Febrex 250mg Suspension',
    'Flexon Suspension 100ml',
    'Gabanuron NT 100mg',
    'Geminor M 1/500',
    'Glucon D Regular 500g',
    'Woodwards Gripe Water',
    'Gudlax Plus Suspension',
    'Hempushpa 170ml',
    'Himalaya Baby Powder 100g',
    'Himalaya Baby Wipes'
  ];

  for (const q of queries) {
    const prods = await testSSR(q);
    console.log(`\nQuery: "${q}" -> Found ${prods.length} products`);
    if (prods.length > 0) {
      console.log(`   Top: "${prods[0].name}" (Mfg: ${prods[0].manufacturer})`);
      const img = prods[0].images?.[0] || prods[0].image || (prods[0].damImages?.[0]?.url);
      console.log(`   Img: ${img}`);
    }
  }
}

run();
