import fs from 'fs';

const needs = JSON.parse(fs.readFileSync('./scripts/needs_download.json', 'utf8'));
console.log('Total items needing download/attach:', needs.length);

const brandMap = new Map();
for (const item of needs) {
  const brand = item.name.split(/\s+/)[0].toUpperCase();
  if (!brandMap.has(brand)) brandMap.set(brand, []);
  brandMap.get(brand).push(item);
}

console.log('Top brands in needs_download:');
const sorted = Array.from(brandMap.entries()).sort((a, b) => b[1].length - a[1].length);
for (const [brand, list] of sorted.slice(0, 25)) {
  console.log(` - ${brand}: ${list.length} items (e.g. "${list[0].name}")`);
}
