import fs from 'fs';

const state = JSON.parse(fs.readFileSync('./data/image_download_state.json', 'utf8'));
const prods = state.products || {};

for (const [k, v] of Object.entries(prods)) {
  if (k.includes('DYTOR 20')) {
    console.log('State entry for DYTOR 20:', k);
    console.log(v);
  }
  if (k.includes('DYTOR 10')) {
    console.log('State entry for DYTOR 10:', k);
    console.log(v);
  }
}
