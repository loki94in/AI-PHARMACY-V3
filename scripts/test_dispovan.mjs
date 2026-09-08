async function test(query) {
  const url = `https://pharmeasy.in/search/all?name=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (match) {
    const list = JSON.parse(match[1]).props?.pageProps?.productList || [];
    console.log(`\nQuery "${query}" found ${list.length} products:`);
    for (const p of list) {
      if (p.name.toUpperCase().includes('DISPOVAN') || p.name.toUpperCase().includes('SYRINGE')) {
        const img = p.image || p.images?.[0] || p.damImages?.[0]?.url;
        console.log(' -> ', p.name, '| Mfg:', p.manufacturer, '| Img:', img);
      }
    }
  }
}

async function run() {
  await test('Dispovan 10ml Syringe');
  await test('Dispovan 10ml');
  await test('Dispovan 5ml');
  await test('Dispovan 2ml');
}
run();
