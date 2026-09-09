async function testApollo(query) {
  try {
    const res = await fetch(`https://search.apollohospitals.com/v1/search?query=${encodeURIComponent(query)}&page=1&products_per_page=10`);
    const data = await res.json();
    console.log(`Apollo results for "${query}":`, (data.products || []).map(p => ({ name: p.name, img: p.image_url })));
  } catch (e) {
    console.log('Apollo error:', e.message);
  }
}

async function test1mg(query) {
  try {
    const res = await fetch(`https://www.1mg.com/api/v1/search/autocomplete?name=${encodeURIComponent(query)}&pageSize=10`);
    const data = await res.json();
    console.log(`1mg results for "${query}":`, (data.result || []).map(p => ({ name: p.name, img: p.image_url })));
  } catch (e) {
    console.log('1mg error:', e.message);
  }
}

async function run() {
  await testApollo('Dispovan 10ml');
  await testApollo('Dispovan Syringe 10ml');
}
run();
