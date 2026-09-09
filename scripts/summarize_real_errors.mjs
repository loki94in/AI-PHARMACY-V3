import fs from 'fs';

const errs = JSON.parse(fs.readFileSync('./data/real_clinical_errors.json', 'utf8'));
console.log('Total real errors:', errs.length);
console.log('Unique medicines affected:', new Set(errs.map(e => e.med_id)).size);

// Group by error type
const byType = {};
for (const e of errs) {
  const t = e.errorReason.split(':')[0];
  byType[t] = (byType[t] || 0) + 1;
}
console.log('Breakdown by error type:', byType);
