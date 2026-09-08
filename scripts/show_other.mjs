import fs from 'fs';

const meds = JSON.parse(fs.readFileSync('./scripts/rejected_534.json', 'utf-8'));

const other = [];
for (const med of meds) {
  const up = med.name.toUpperCase();
  const mfg = (med.manufacturer || '').toUpperCase();

  // Surgical/canonical
  if (up.includes('DIAPER') || up.includes('DIPER') || up.includes('PULL UP') || (up.includes('PANTS') && (mfg.includes('PANDG') || up.includes('ADULT')))) continue;
  if (up.includes('GLOVES') || up.includes('GLOVE')) continue;
  if (up.includes('BANDAGE')) continue;
  if (up.includes('BD INSULIN') || (up.includes('ULTRAFINE') && up.includes('SYRINGE'))) continue;
  if (up.includes('DISPOVAN') || (up.includes('DISPO') && up.includes('SYRINGE'))) continue;
  if (up.includes('COTTON') && !up.includes('BUD') && !up.includes('EAR')) continue;

  if (up.startsWith('HIM ') || mfg.includes('HIMALAYA')) continue;
  if (mfg.includes('PARACHUT') || up.includes('PARACHUTE')) continue;
  if (up.includes('VICKS') || mfg.includes('VICKS')) continue;
  if (up.includes('DABUR') || mfg.includes('DABUR') || up.startsWith('DAB ')) continue;
  if (up.includes('DETTOL') || mfg.includes('RECKITT')) continue;
  if (up.includes('BAJAJ') || mfg.includes('BAJAJ')) continue;
  if (up.includes('GILLET') || mfg.includes('GILLET')) continue;
  if (up.includes('PAMPERS')) continue;
  if (up.includes('ZANDU') || mfg.includes('ZANDU')) continue;
  if (up.includes('BAIDYANATH') || mfg.includes('BAIDYANATH')) continue;
  if (up.includes('DR ORTHO')) continue;
  if (up.includes('MOOV')) continue;
  if (up.includes('IODEX')) continue;
  if (up.includes('CIPLADINE')) continue;
  if (mfg.includes('CIPLA')) continue;
  if (mfg.includes('MANKIND')) continue;
  if (mfg.includes('ALKEM')) continue;
  if (mfg.includes('MACLEODS')) continue;
  if (mfg.includes('DR REDDY')) continue;

  other.push(med);
}

console.log('Other count:', other.length);
other.forEach((m, idx) => console.log(`${idx + 1}. [${m.id}] ${m.name} | ${m.manufacturer}`));
