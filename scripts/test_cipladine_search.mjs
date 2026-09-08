import { generateSearchQueries } from './resolve_all_rejected.mjs';

async function testCipladine() {
  const med = {
    name: 'CIPLADINE 5% OINT 15GM',
    manufacturer: 'CIPLA GX',
    strength: '15GM'
  };
  const queries = generateSearchQueries(med);
  console.log('Queries generated:', queries);

  for (const q of queries) {
    console.log('\n--- Searching SSR for:', q);
    const url = `https://pharmeasy.in/search/all?name=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(6000)
      });
      console.log('Status:', res.status);
      const html = await res.text();
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
      if (match) {
        const json = JSON.parse(match[1]);
        const list = json.props?.pageProps?.productList || [];
        console.log(`Found ${list.length} products in SSR`);
        list.slice(0, 3).forEach(p => console.log(' - ', p.name, '| Mfg:', p.manufacturer, '| Img:', Boolean(p.image || p.damImages?.[0]?.url)));
      } else {
        console.log('No __NEXT_DATA__ match. HTML length:', html.length);
      }
    } catch (e) {
      console.error('Error:', e.message);
    }
  }
}

testCipladine();
