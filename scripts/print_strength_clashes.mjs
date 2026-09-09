import fs from 'fs';

const list = JSON.parse(fs.readFileSync('./data/confirmed_clinical_mismatches.json', 'utf8'));
const strengths = list.filter(x => x.strengthClash);
console.log('Total strength clashes:', strengths.length);
for (const s of strengths) {
  console.log(`[ID ${s.id}] ${s.med_name} (${s.med_mfg})`);
  console.log(`   Img: ${s.img_name} [${s.image_path}]`);
  console.log(`   -> Med: ${s.strengthClash.med} vs Img: ${s.strengthClash.img} (ratio: ${s.strengthClash.ratio.toFixed(2)})\n`);
}
