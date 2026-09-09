async function testNetmeds(q) {
  const url = `https://www.netmeds.com/catalogsearch/result?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (res.ok) {
    const html = await res.text();
    const imgs = html.match(/https:\/\/www\.netmeds\.com\/images\/product-v1\/[^\"]+/g);
    console.log('Netmeds imgs for', q, ':', imgs ? imgs.slice(0, 3) : 'None');
  }
}

async function testApollo(q) {
  const url = `https://www.apollopharmacy.in/search-medicines/${encodeURIComponent(q.replace(/\s+/g, '-'))}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (res.ok) {
    const html = await res.text();
    const imgs = html.match(/https:\/\/images\.apollo247\.in\/pub\/media\/catalog\/product\/[^\s"']+/g);
    console.log('Apollo imgs for', q, ':', imgs ? Array.from(new Set(imgs)).slice(0, 3) : 'None');
  }
}

async function run() {
  await testNetmeds('Caladryl Lotion 120ml');
  await testApollo('Caladryl-Lotion-120ml');
}

run();
