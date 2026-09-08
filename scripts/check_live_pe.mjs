async function check() {
  const res = await fetch('https://pharmeasy.in/search/all?name=Parachute', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (match) {
    const json = JSON.parse(match[1]);
    const list = json.props?.pageProps?.productList || [];
    console.log('Found prods:', list.length);
    for (const p of list.slice(0, 3)) {
      console.log('---');
      console.log('Name:', p.name);
      console.log('Image:', p.image);
      console.log('damImages:', p.damImages);
      // Try to fetch image
      const imgUrl = p.image || p.damImages?.[0]?.url;
      if (imgUrl) {
        const iRes = await fetch(imgUrl);
        console.log('Fetch img status:', iRes.status, iRes.headers.get('content-type'));
      }
    }
  }
}
check();
