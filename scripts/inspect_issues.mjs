import fs from 'fs';

const d = JSON.parse(fs.readFileSync('./data/catalog_audit_issues.json', 'utf-8'));
const start = parseInt(process.argv[2] || '0', 10);
const end = parseInt(process.argv[3] || '50', 10);

console.log(`Showing issues ${start + 1} to ${Math.min(end, d.length)} of ${d.length}:`);
for (let i = start; i < Math.min(end, d.length); i++) {
  const x = d[i];
  console.log(`[${i+1}] Med ${x.medicine_id} (Img ${x.image_id}): "${x.med_name}" [${x.med_mfg}] -> "${x.img_product_name}" | ${x.reason}`);
}
