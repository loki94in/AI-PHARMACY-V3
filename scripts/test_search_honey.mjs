async function test(query) {
  const url = `https://pharmeasy.in/search/all?name=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (match) {
    const list = JSON.parse(match[1]).props?.pageProps?.productList || [];
    console.log(`\nQuery "${query}" found ${list.length} products:`);
    for (const p of list) {
      if (p.name.toUpperCase().includes('DABUR') && p.name.toUpperCase().includes('HONEY')) {
        console.log(' -> MATCH:', p.name, '| Mfg:', p.manufacturer, '| Img:', Boolean(p.image || p.damImages?.[0]?.url));
      }
    }
  }
}

async function run() {
  await test('Dabur Honey 50g');
  await test('Dabur Honey 250g');
  await test('Dabur Honey 500g');
  await test('Dabur Honey 1kg');
  await test('Dabur Pure Honey');
}
run();
