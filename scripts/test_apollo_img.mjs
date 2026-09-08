async function test() {
  const url = 'https://www.apollopharmacy.in/otc/parachute-pure-coconut-hair-oil-100-ml';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  console.log('Status:', res.status);
  const html = await res.text();
  const match = html.match(/https:\/\/images\.apollo247\.in\/pub\/media\/catalog\/product\/[^\s"']+/g);
  console.log('Images matched:', match ? Array.from(new Set(match)).slice(0, 5) : 'None');
}
test();
