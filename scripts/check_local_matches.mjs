import fs from 'fs';
import path from 'path';

const errs = JSON.parse(fs.readFileSync('./data/real_clinical_errors.json', 'utf8'));
const files = fs.readdirSync('frontend/public/products');

console.log(`Checking ${errs.length} errors against ${files.length} files on disk...`);

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

let foundLocal = 0;
for (const e of errs) {
  const cleanMed = e.med_name.replace(/\[.*?\]/g, '').replace(/\b(?:STRIP|PACK|BOTTLE|BOX|TUBE|BLISTER)\s+(?:OF\s+)?\d+\b/gi, '').trim();
  const slug = slugify(cleanMed);
  const matched = files.filter(f => f.includes(slug) && f.endsWith('.jpg'));
  if (matched.length > 0) {
    foundLocal++;
    console.log(`Med: "${e.med_name}" -> Found on disk:`, matched);
  }
}

console.log(`Found ${foundLocal} matches directly on disk!`);
