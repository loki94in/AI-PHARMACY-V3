import fs from 'fs';

const un = JSON.parse(fs.readFileSync('./scripts/final_unresolved.json', 'utf-8'));
console.log('Total unresolved to classify:', un.length);

const patterns = {
  HIMALAYA_BABY_OIL: [],
  HIMALAYA_BABY_POWDER: [],
  HIMALAYA_BABY_LOTION: [],
  HIMALAYA_BABY_CREAM: [],
  HIMALAYA_BABY_OTHER: [],
  PARACHUTE_OIL: [],
  BAJAJ_ALMOND: [],
  DABUR_PRODUCTS: [],
  VICKS_PRODUCTS: [],
  MOOV_IODEX_ZANDU_TIGER: [],
  PATANJALI: [],
  WHISPER_PAMPERS: [],
  SURGICAL_COMMODITY: [],
  PHARMA_RX_OTC: [],
  OTHER: []
};

for (const m of un) {
  const up = m.name.toUpperCase();
  const mfg = (m.manufacturer || '').toUpperCase();

  // Himalaya baby
  if ((up.startsWith('HIM ') || mfg.includes('HIMALAYA')) && (up.includes('BABY') || up.includes('BEBY') || up.includes('MESSAGE'))) {
    if (up.includes('MASAGE') || up.includes('MASSAGE') || up.includes('OIL') || up.includes('MESSAGE')) {
      patterns.HIMALAYA_BABY_OIL.push(m);
    } else if (up.includes('POWDER') || up.includes('POWD')) {
      patterns.HIMALAYA_BABY_POWDER.push(m);
    } else if (up.includes('LOTION')) {
      patterns.HIMALAYA_BABY_LOTION.push(m);
    } else if (up.includes('CREAM')) {
      patterns.HIMALAYA_BABY_CREAM.push(m);
    } else {
      patterns.HIMALAYA_BABY_OTHER.push(m);
    }
  } else if (mfg.includes('PARACHUT') || (up.includes('OIL') && mfg.includes('PARACHUT')) || up.startsWith('PARA OIL')) {
    patterns.PARACHUTE_OIL.push(m);
  } else if (up.includes('BAJAJ') || mfg.includes('BAJAJ')) {
    patterns.BAJAJ_ALMOND.push(m);
  } else if (up.includes('DABUR') || mfg.includes('DABUR') || up.startsWith('DAB ')) {
    patterns.DABUR_PRODUCTS.push(m);
  } else if (up.includes('VICKS') || mfg.includes('VICKS') || up.includes('VAPORUB') || up.includes('VAPORAB')) {
    patterns.VICKS_PRODUCTS.push(m);
  } else if (up.includes('MOOV') || up.includes('IODEX') || up.includes('ZANDU') || up.includes('TIGER BALM') || up.includes('BOROLINE') || up.includes('AMRUTANJAN')) {
    patterns.MOOV_IODEX_ZANDU_TIGER.push(m);
  } else if (up.includes('PATA ') || up.includes('PATANJALI') || mfg.includes('PATANJALI')) {
    patterns.PATANJALI.push(m);
  } else if (up.includes('WHISPER') || up.includes('PAMPERS') || up.includes('PRO EASE') || up.includes('PXL 120') || up.includes('PAMPERSM')) {
    patterns.WHISPER_PAMPERS.push(m);
  } else if (up.includes('SYRINGE') || up.includes('SYRANGE') || up.includes('RAZOR') || up.includes('BLADE') || up.includes('BED PAN') || up.includes('BAND AID') || up.includes('SCALP VEIN') || up.includes('WAX') || up.includes('SANITIZER') || up.includes('DISPO')) {
    patterns.SURGICAL_COMMODITY.push(m);
  } else {
    patterns.PHARMA_RX_OTC.push(m);
  }
}

for (const [k, v] of Object.entries(patterns)) {
  console.log(`${k}: ${v.length}`);
}

console.log('\nPharma RX/OTC items list:');
patterns.PHARMA_RX_OTC.forEach((m, i) => console.log(`${i+1}. [${m.id}] ${m.name} | ${m.manufacturer}`));
