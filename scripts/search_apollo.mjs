const q = process.argv[2] || 'Himalaya Baby Powder';

async function search(query) {
  const url = `https://www.apollo247.com/pharmacy/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await res.text();
  const regex = /https:\/\/images\.apollo247\.in\/pub\/media\/catalog\/product\/[^"'\s]+/g;
  const matches = [...new Set(html.match(regex) || [])];
  console.log(`Apollo search for "${query}" found ${matches.length} images:`);
  for (const m of matches.slice(0, 10)) {
    console.log('-', m);
  }
}

search(q).catch(console.error);
