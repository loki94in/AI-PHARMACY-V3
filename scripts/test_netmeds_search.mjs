async function testNetmeds(q) {
  const url = `https://www.netmeds.com/catalogsearch/result?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html'
    }
  });
  console.log('Status:', res.status);
  if (res.ok) {
    const html = await res.text();
    const matches = html.match(/https:\/\/www\.netmeds\.com\/images\/product-v1\/[^\"]+/g);
    console.log('Netmeds images found:', matches ? matches.slice(0, 5) : 'None');
    // Also check for product names
    const titles = html.match(/<span class=\"clsgetname\">([^<]+)<\/span>/g);
    console.log('Netmeds titles:', titles ? titles.slice(0, 5) : 'None');
  }
}

testNetmeds(process.argv[2] || 'Parachute Coconut Oil').catch(console.error);
