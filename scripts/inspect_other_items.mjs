import fs from 'fs';

const needs = JSON.parse(fs.readFileSync('./scripts/needs_download.json', 'utf8'));

const topPrefixes = [
  'HIM', 'OIL', 'VICKS', 'DETTOL', 'BAJAJ', 'COTTON', 'DABUR', 'BANDAGE',
  'WHISPER', 'GILLET', 'GLOVES', 'ZANDU', 'DISPOVAN', 'DR', 'BABY', 'ADULT',
  'AYUR', 'DAB', 'ENERZAL', 'GOOD', 'IODEX', 'MOOV', 'PAMPERS', 'YARDLEY'
];

const otherItems = needs.filter(item => {
  const norm = item.name.trim().toUpperCase();
  return !topPrefixes.some(p => norm.startsWith(p));
});

console.log(`Other items not in top prefixes: ${otherItems.length}`);
for (const item of otherItems) {
  console.log(`[${item.id}] "${item.name}" | Mfg: "${item.manufacturer}" | Strength: "${item.strength}" | Pack: "${item.packaging}"`);
}
