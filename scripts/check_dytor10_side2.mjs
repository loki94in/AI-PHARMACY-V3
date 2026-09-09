async function check() {
  const url = 'https://cdn01.pharmeasy.in/dam/productsnowatermark/063908/dytor-10mg-strip-of-15-tablets-side-6.2-1785588842-non-watermark.jpg';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('Size of side-6.2:', buf.length);
}
check();
