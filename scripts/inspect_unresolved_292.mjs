import fs from 'fs';

const un = JSON.parse(fs.readFileSync('./scripts/final_unresolved.json', 'utf-8'));
console.log('Unresolved count:', un.length);

const mfgCount = {};
for (const m of un) {
  const k = (m.manufacturer || 'UNKNOWN').trim().toUpperCase();
  mfgCount[k] = (mfgCount[k] || 0) + 1;
}
console.log('Top Unresolved Manufacturers:');
console.log(Object.entries(mfgCount).sort((a, b) => b[1] - a[1]).slice(0, 20));

console.log('\nFirst 150 unresolved items:');
un.slice(0, 150).forEach((m, i) => console.log(`${i + 1}. [${m.id}] ${m.name} | ${m.manufacturer}`));
