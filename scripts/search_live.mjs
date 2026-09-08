const query = process.argv[2] || 'Dispovan';

async function search(q) {
  const url = `https://pharmeasy.in/search/all?name=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (match) {
    const json = JSON.parse(match[1]);
    const list = json.props?.pageProps?.productList || [];
    console.log(`Query "${q}" found ${list.length} products:`);
    for (const p of list.slice(0, 10)) {
      console.log(`- ${p.name} | Mfg: ${p.manufacturer} | Img: ${p.image ? 'YES' : 'NO'}`);
      if (p.image) console.log(`  Img URL: ${p.image}`);
    }
  } else {
    console.log('No __NEXT_DATA__ found');
  }
}

search(query).catch(console.error);
