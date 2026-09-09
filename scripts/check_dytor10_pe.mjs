async function checkDytor10() {
  const url = `https://pharmeasy.in/api/search/search/?q=${encodeURIComponent('Dytor 10')}&page=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const data = await res.json();
  const list = data?.data?.products || [];
  console.log('PharmEasy Dytor 10 search:');
  for (const p of list.slice(0, 3)) {
    console.log({
      name: p.name,
      slug: p.slug,
      image: p.damImages?.[0]?.url || p.image,
      allImages: (p.damImages || []).map(d => d.url)
    });
  }
}
checkDytor10();
