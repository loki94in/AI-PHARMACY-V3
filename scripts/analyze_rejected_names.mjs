import fs from 'fs';

const meds = JSON.parse(fs.readFileSync('./scripts/rejected_meds_list.json', 'utf8'));

console.log(`Total: ${meds.length}`);

// Look at some random samples
console.log('\n--- First 20 items ---');
meds.slice(0, 20).forEach(m => console.log(`[ID ${m.id}] "${m.name}" | Mfg: "${m.manufacturer}" | Pack: "${m.packaging}"`));

console.log('\n--- Middle 20 items (around 200) ---');
meds.slice(200, 220).forEach(m => console.log(`[ID ${m.id}] "${m.name}" | Mfg: "${m.manufacturer}" | Pack: "${m.packaging}"`));

console.log('\n--- Last 20 items ---');
meds.slice(521).forEach(m => console.log(`[ID ${m.id}] "${m.name}" | Mfg: "${m.manufacturer}" | Pack: "${m.packaging}"`));
