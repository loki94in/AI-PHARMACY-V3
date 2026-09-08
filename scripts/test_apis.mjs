async function test() {
  // Test PharmEasy CDN with Referer
  const peUrl = 'https://cdn01.pharmeasy.in/dam/products_otc/131679/parachute-100-pure-coconut-oil-bottle-of-100-ml-2-1641398939.jpg';
  const resPE = await fetch(peUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://pharmeasy.in/',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  });
  console.log('PharmEasy with Referer:', resPE.status, resPE.headers.get('content-type'));

  // Test Apollo 24|7 Search API
  const apolloSearchUrl = 'https://api.apollo247.com/m-site-service/catalog/search?query=Parachute%20Coconut%20Oil&page=1&size=5';
  try {
    const resAp = await fetch(apolloSearchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Authorization': 'Bearer 39d1b09b-640a-42c2-b369-07b973fc7827' // common public client token or test without
      }
    });
    console.log('Apollo API Status:', resAp.status);
    if (resAp.ok) {
      const data = await resAp.json();
      console.log('Apollo result count:', data?.data?.products?.length);
    }
  } catch (e) {
    console.log('Apollo API error:', e.message);
  }

  // Test 1mg search API
  const onemgSearch = 'https://www.1mg.com/pharmacy_api_provider/v4/search?name=Parachute%20Coconut%20Oil&pageSize=5';
  try {
    const res1mg = await fetch(onemgSearch, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log('1mg API Status:', res1mg.status);
    if (res1mg.ok) {
      const data = await res1mg.json();
      console.log('1mg products:', data?.results?.length);
    }
  } catch (e) {
    console.log('1mg error:', e.message);
  }
}

test();
