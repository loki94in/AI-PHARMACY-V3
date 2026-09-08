async function test1mg(query) {
  try {
    const url = `https://www.1mg.com/pharmacy_api/v4/search/all?name=${encodeURIComponent(query)}&pageSize=5`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    console.log(`1mg status for "${query}":`, res.status);
    if (res.ok) {
      const data = await res.json();
      const hits = data?.data?.result || [];
      console.log(`Found ${hits.length} in 1mg:`);
      hits.slice(0, 3).forEach(h => console.log(' - ', h.name, '| Mfg:', h.manufacturer, '| Img:', h.image_url));
    }
  } catch (e) {
    console.log('1mg error:', e.message);
  }
}

async function testApollo(query) {
  try {
    const url = `https://www.apollopharmacy.in/search-medicines/${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log(`Apollo status for "${query}":`, res.status);
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
    if (match) {
      const data = JSON.parse(match[1]);
      const products = data.props?.pageProps?.products || data.props?.pageProps?.data?.products || [];
      console.log(`Found ${products.length} in Apollo`);
    }
  } catch (e) {
    console.log('Apollo error:', e.message);
  }
}

async function run() {
  await test1mg('Parachute Coconut Oil 250ml');
  await test1mg('Dabur Honey 50g');
}
run();
