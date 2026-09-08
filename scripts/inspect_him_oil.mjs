import fs from 'fs';

const needs = JSON.parse(fs.readFileSync('./scripts/needs_download.json', 'utf8'));

console.log('=== ALL HIM (Himalaya) ITEMS ===');
const himItems = needs.filter(i => i.name.trim().startsWith('HIM'));
for (const item of himItems) {
  console.log(`[${item.id}] "${item.name}" | Mfg: "${item.manufacturer}" | Pack: "${item.packaging}"`);
}

console.log('\n=== ALL OIL ITEMS ===');
const oilItems = needs.filter(i => i.name.trim().startsWith('OIL'));
for (const item of oilItems) {
  console.log(`[${item.id}] "${item.name}" | Mfg: "${item.manufacturer}" | Pack: "${item.packaging}"`);
}
