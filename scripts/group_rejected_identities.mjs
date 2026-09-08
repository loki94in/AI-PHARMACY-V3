import fs from 'fs';
import { catalogImageService } from '../src/services/catalogImageService.js';

const meds = JSON.parse(fs.readFileSync('./scripts/rejected_meds_list.json', 'utf8'));

console.log(`Total rows: ${meds.length}`);

// Group by normalized identity
const groups = new Map();

for (const m of meds) {
  let clean = m.name
    .replace(/\[.*?\]/g, ' ')
    .replace(/[\t\r\n]/g, ' ')
    .replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip leading price code like "HIM 100 ", "VICKS 115 ", "BOROLINE 10 "
  let norm = clean.replace(/^([A-Z\s]+?)\s+\d{2,3}\s+([A-Z])/i, '$1 $2');
  norm = norm.replace(/\s+/g, ' ').trim().toUpperCase();

  if (!groups.has(norm)) {
    groups.set(norm, []);
  }
  groups.get(norm).push(m);
}

console.log(`Distinct product identities: ${groups.size}`);

// Print the most frequent normalized groups
const sorted = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
console.log('\nTop 25 recurring product groups:');
sorted.slice(0, 25).forEach(([norm, list]) => {
  console.log(`- "${norm}": ${list.length} records (e.g. ID ${list[0].id}: "${list[0].name}")`);
});
