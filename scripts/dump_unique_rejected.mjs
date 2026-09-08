import fs from 'fs';

const meds = JSON.parse(fs.readFileSync('./scripts/rejected_meds_list.json', 'utf8'));

const distinct = [];
const seen = new Set();

for (const m of meds) {
  let clean = m.name
    .replace(/\[.*?\]/g, ' ')
    .replace(/[\t\r\n]/g, ' ')
    .replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let norm = clean.replace(/^([A-Z\s]+?)\s+\d{2,3}\s+([A-Z])/i, '$1 $2').replace(/\s+/g, ' ').trim().toUpperCase();

  const key = `${norm}__${(m.manufacturer || '').toUpperCase()}`;
  if (!seen.has(key)) {
    seen.add(key);
    distinct.push({
      id: m.id,
      name: m.name,
      cleaned: clean,
      normalized: norm,
      mfg: m.manufacturer,
      packaging: m.packaging,
      strength: m.strength
    });
  }
}

console.log(`Unique key count: ${distinct.length}`);
fs.writeFileSync('./scripts/unique_rejected_meds.json', JSON.stringify(distinct, null, 2));
console.log('Saved unique list to scripts/unique_rejected_meds.json');
