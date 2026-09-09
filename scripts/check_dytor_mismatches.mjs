import fs from 'fs';

const data = JSON.parse(fs.readFileSync('./data/true_mismatches.json', 'utf8'));
const dytorItems = data.filter(d => (d.med_name || '').includes('DYTOR'));
console.log('Dytor items in true_mismatches.json:', dytorItems);
