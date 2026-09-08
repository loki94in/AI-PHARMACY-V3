async function test1mg(q) {
  const url = `https://www.1mg.com/pharmacy_api_provider/v4/search?name=${encodeURIComponent(q)}&pageSize=5`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  console.log('Status:', res.status);
  if (res.ok) {
    const json = await res.json();
    console.log('Results:', json?.data?.skus?.length || json?.results?.length);
    const list = json?.data?.skus || json?.results || [];
    for (const item of list) {
      console.log('-', item.name, '| Img:', item.image_url || item.image);
    }
  } else {
    // Try 1mg page fetch
    const pageUrl = `https://www.1mg.com/search/all?name=${encodeURIComponent(q)}`;
    const pRes = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    console.log('Page status:', pRes.status);
    if (pRes.ok) {
      const html = await pRes.text();
      const imgs = html.match(/https:\/\/onemg\.gumlet\.io\/[^\"]+/g);
      console.log('Gumlet images:', imgs ? imgs.slice(0, 5) : 'None');
    }
  }
}

test1mg(process.argv[2] || 'Himalaya Baby Powder').catch(console.error);
