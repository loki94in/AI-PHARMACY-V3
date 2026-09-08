import fs from 'fs';
import path from 'path';
import { catalogImageService } from '../src/services/catalogImageService.js';

const meds = JSON.parse(fs.readFileSync('./scripts/rejected_534.json', 'utf-8'));
const files = fs.readdirSync('./frontend/public/products').filter(f => f.endsWith('.jpg') || f.endsWith('.png'));

console.log(`Total 534 meds. Total public product images: ${files.length}`);

// Check local matching
let matchedLocal = 0;
const needsRemote = [];

for (const med of meds) {
  const up = med.name.toUpperCase();
  const mfg = (med.manufacturer || '').toUpperCase();

  // Check canonical surgical/diaper/cotton
  let isCanonical = false;
  if (up.includes('DIAPER') || up.includes('DIPER') || up.includes('PULL UP') || (up.includes('PANTS') && (mfg.includes('PANDG') || up.includes('ADULT')))) {
    isCanonical = true;
  } else if (up.includes('GLOVES') || up.includes('GLOVE')) {
    isCanonical = true;
  } else if (up.includes('BANDAGE')) {
    isCanonical = true;
  } else if (up.includes('BD INSULIN') || (up.includes('ULTRAFINE') && up.includes('SYRINGE'))) {
    isCanonical = true;
  } else if (up.includes('DISPOVAN') || (up.includes('DISPO') && up.includes('SYRINGE'))) {
    isCanonical = true;
  } else if (up.includes('COTTON') && !up.includes('BUD') && !up.includes('EAR')) {
    isCanonical = true;
  }

  if (isCanonical) {
    matchedLocal++;
    continue;
  }

  needsRemote.push(med);
}

console.log(`Canonical matched: ${matchedLocal}`);
console.log(`Needs remote search or specific map: ${needsRemote.length}`);

// Group needsRemote by brand / keyword
const groups = {};
for (const m of needsRemote) {
  const up = m.name.toUpperCase();
  const mfg = (m.manufacturer || '').toUpperCase();
  let key = 'OTHER';

  if (up.startsWith('HIM ') || mfg.includes('HIMALAYA')) key = 'HIMALAYA';
  else if (mfg.includes('PARACHUT') || up.includes('PARACHUTE')) key = 'PARACHUTE';
  else if (up.includes('VICKS') || mfg.includes('VICKS')) key = 'VICKS';
  else if (up.includes('DABUR') || mfg.includes('DABUR') || up.startsWith('DAB ')) key = 'DABUR';
  else if (up.includes('DETTOL') || mfg.includes('RECKITT')) key = 'DETTOL/RECKITT';
  else if (up.includes('BAJAJ') || mfg.includes('BAJAJ')) key = 'BAJAJ';
  else if (up.includes('GILLET') || mfg.includes('GILLET')) key = 'GILLETTE';
  else if (up.includes('PAMPERS')) key = 'PAMPERS';
  else if (up.includes('ZANDU') || mfg.includes('ZANDU')) key = 'ZANDU';
  else if (up.includes('BAIDYANATH') || mfg.includes('BAIDYANATH')) key = 'BAIDYANATH';
  else if (up.includes('DR ORTHO')) key = 'DR ORTHO';
  else if (up.includes('MOOV')) key = 'MOOV';
  else if (up.includes('IODEX')) key = 'IODEX';
  else if (up.includes('CIPLADINE')) key = 'CIPLADINE';
  else if (mfg.includes('CIPLA')) key = 'CIPLA';
  else if (mfg.includes('MANKIND')) key = 'MANKIND';
  else if (mfg.includes('ALKEM')) key = 'ALKEM';
  else if (mfg.includes('MACLEODS')) key = 'MACLEODS';
  else if (mfg.includes('DR REDDY')) key = 'DR REDDY';

  groups[key] = (groups[key] || 0) + 1;
}

console.log('Group breakdown:');
console.log(Object.entries(groups).sort((a,b) => b[1] - a[1]));
