async function test() {
  const url = 'https://cdn01.pharmeasy.in/dam/products_otc/131679/parachute-100-pure-coconut-oil-bottle-of-100-ml-2-1641398939.jpg';
  
  // Test with curl / different headers
  const headersList = [
    { 'User-Agent': 'curl/7.88.1' },
    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
    { 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
      'Accept': '*/*'
    }
  ];

  for (const h of headersList) {
    try {
      const res = await fetch(url, { headers: h });
      console.log('Status:', res.status, 'Headers:', JSON.stringify(h));
      if (res.status === 200) {
        console.log('SUCCESS! Content length:', res.headers.get('content-length'));
        break;
      } else {
        const text = await res.text();
        console.log('Body preview:', text.slice(0, 150));
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

test();
