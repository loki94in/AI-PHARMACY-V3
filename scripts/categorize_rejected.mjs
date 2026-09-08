import fs from 'fs';

const meds = JSON.parse(fs.readFileSync('./scripts/rejected_meds_list.json', 'utf8'));

console.log('Total items:', meds.length);

const categories = {
  vicks: [],
  drOrtho: [],
  himalaya: [],
  baidyanath: [],
  zandu: [],
  dabur: [],
  surgicalCottonBandageDiaper: [],
  hairOilShampooSoap: [],
  creamsLotionsBalms: [],
  syrupsTabletsCapsules: [],
  others: []
};

for (const m of meds) {
  const n = m.name.toUpperCase();
  const mfg = (m.manufacturer || '').toUpperCase();

  if (n.includes('VICKS')) categories.vicks.push(m);
  else if (n.includes('DR ORTHO')) categories.drOrtho.push(m);
  else if (n.includes('HIM') || mfg.includes('HIMALAYA')) categories.himalaya.push(m);
  else if (n.includes('BAID') || mfg.includes('BAIDYANATH')) categories.baidyanath.push(m);
  else if (n.includes('ZANDU') || mfg.includes('ZANDU')) categories.zandu.push(m);
  else if (n.includes('DABUR') || mfg.includes('DABUR')) categories.dabur.push(m);
  else if (/\b(COTTON|DIAPER|DIPER|BANDAGE|GAUZE|GLOVES|SYRINGE|NEEDLE|DISPOVAN|PADS?)\b/.test(n)) categories.surgicalCottonBandageDiaper.push(m);
  else if (/\b(OIL|SHAMPOO|SOAP|WASH STONE|BLADE)\b/.test(n)) categories.hairOilShampooSoap.push(m);
  else if (/\b(CREAM|LOTION|BALM|BALAM|GEL|POWDER|TALC|VASELINE|BOROLINE)\b/.test(n)) categories.creamsLotionsBalms.push(m);
  else if (/\b(SYP|SYRUP|TAB|TABLET|CAP|CAPSULE|SUSP|DROPS|INJ)\b/.test(n)) categories.syrupsTabletsCapsules.push(m);
  else categories.others.push(m);
}

for (const [cat, list] of Object.entries(categories)) {
  console.log(`${cat}: ${list.length} items`);
}
