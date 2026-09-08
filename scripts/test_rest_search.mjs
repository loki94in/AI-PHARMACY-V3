const q = process.argv[2] || 'Himalaya Baby Powder';

async function search(query) {
  const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent(query)}&page=1`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) {
    console.log('HTTP', res.status);
    return;
  }
  const json = await res.json();
  const prods = json?.data?.products || [];
  console.log(`REST search for "${query}" found ${prods.length} products:`);
  for (const p of prods.slice(0, 10)) {
    console.log(`- ${p.name} | Mfg: ${p.manufacturer}`);
    const img = (p.damImages && p.damImages[0]?.url) || p.image;
    if (img) console.log(`  Img: ${img}`);
  }
}

search(q).catch(console.error);
