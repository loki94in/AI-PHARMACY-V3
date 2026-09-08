async function testNetmeds(query) {
  const url = `https://www.netmeds.com/catalogsearch/result/${encodeURIComponent(query)}/all`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    console.log('Netmeds status:', res.status);
    const html = await res.text();
    console.log('HTML length:', html.length);
    // Find image URLs or product cards
    const imgMatches = html.match(/https:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi) || [];
    console.log('Found image links:', imgMatches.filter(u => u.includes('product') || u.includes('catalog')).slice(0, 5));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testNetmeds('Dabur Honey 50 gm');
