import fs from 'fs';

async function testSSR(name) {
  const url = `https://pharmeasy.in/search/all?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (match) {
    const json = JSON.parse(match[1]);
    const pp = json.props?.pageProps || {};
    const prods = pp.productList || [];
    console.log(`Found ${prods.length} products in productList for "${name}":`);
    for (const p of prods.slice(0, 5)) {
      console.log({
        name: p.name,
        mfg: p.manufacturer,
        img: p.image || p.images?.[0] || p.damImages?.[0]?.url
      });
    }
  }
}

async function run() {
  await testSSR('Dettol');
  await testSSR('Cipladine');
  await testSSR('Manforce Staylong');
  await testSSR('Boroline 7g');
  await testSSR('Baidyanath Punarnavarishta');
}

run();
