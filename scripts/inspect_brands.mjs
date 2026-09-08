async function inspectBrand(brandQuery, mfgFilter) {
  const url = `https://pharmeasy.in/search/all?name=${encodeURIComponent(brandQuery)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (match) {
    const list = JSON.parse(match[1]).props?.pageProps?.productList || [];
    console.log(`\n=== Query: "${brandQuery}" (Total: ${list.length}) ===`);
    for (const p of list) {
      const m = (p.manufacturer || '').toUpperCase();
      const n = (p.name || '').toUpperCase();
      if (!mfgFilter || m.includes(mfgFilter) || n.includes(mfgFilter)) {
        const img = p.image || p.images?.[0] || p.damImages?.[0]?.url;
        console.log(`- [${p.manufacturer}] ${p.name} -> ${img ? 'YES' : 'NO'}`);
        if (img) console.log(`  ${img}`);
      }
    }
  }
}

async function run() {
  await inspectBrand('Himalaya Baby', 'HIMALAYA');
  await inspectBrand('Bajaj Almond', 'BAJAJ');
  await inspectBrand('Dabur Honitus', 'DABUR');
  await inspectBrand('Dabur Lal Tail', 'DABUR');
  await inspectBrand('Dabur Amla', 'DABUR');
  await inspectBrand('Dabur Red Toothpaste', 'DABUR');
  await inspectBrand('Patanjali Dant Kanti', 'PATANJALI');
}

run();
