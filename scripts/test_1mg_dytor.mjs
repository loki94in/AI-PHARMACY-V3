async function test1mg() {
  try {
    const url = 'https://www.1mg.com/api/v1/search/autocomplete?name=Dytor%2020&pageSize=10';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    const data = await res.json();
    console.log('1mg Dytor 20:', (data.result || []).map(p => ({ name: p.name, img: p.image_url })));
  } catch (e) {
    console.log('1mg err:', e.message);
  }
}
test1mg();
