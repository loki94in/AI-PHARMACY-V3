async function test() {
  const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent('Calpol 650')}&page=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const data = await res.json();
  const products = data?.data?.products || [];
  console.log('Found:', products.map(p => ({ name: p.name, img: p.damImages?.[0]?.url || p.image })));
}
test();
