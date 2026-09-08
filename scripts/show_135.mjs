import fs from 'fs';

const un = JSON.parse(fs.readFileSync('./scripts/remaining_unresolved.json', 'utf-8'));
console.log('Exact count of remaining unresolved:', un.length);

un.slice(0, 20).forEach((m, i) => {
  console.log(`${i + 1}. [${m.id}] "${m.name}" | Mfg: "${m.manufacturer}"`);
});
