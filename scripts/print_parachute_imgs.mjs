async function printParachuteImages() {
  const url = `https://pharmeasy.in/search/all?name=Parachute`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (match) {
    const list = JSON.parse(match[1]).props?.pageProps?.productList || [];
    for (const p of list) {
      if (p.manufacturer === 'PARACHUTE') {
        const img = p.image || p.images?.[0] || p.damImages?.[0]?.url;
        console.log(`Product: "${p.name}" | Img: ${img}`);
      }
    }
  }
}
printParachuteImages();
