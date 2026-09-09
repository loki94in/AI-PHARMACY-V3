import fs from 'fs';

const state = JSON.parse(fs.readFileSync('./data/image_download_state.json', 'utf8'));
const products = state.products || state;

for (const [k, v] of Object.entries(products)) {
  if (k.toUpperCase().includes('DYTOR')) {
    console.log(`Key: "${k}"`);
    console.log(JSON.stringify(v, null, 2));
    console.log('---------------------------------');
  }
}
