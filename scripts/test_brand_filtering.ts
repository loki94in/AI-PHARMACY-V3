import { aiCameraService } from '../src/services/aiCameraService.js';

console.log('=== TESTING AICAMERA COMPOSITION & PHARMACOPOEIA FILTERING ===\n');

const testLines = [
  'Paracetamol Tablets I.P. 650mg',
  'Each film coated tablet contains: Paracetamol IP 650mg',
  'Store at temperature not exceeding 30°C',
  'Schedule H Prescription Drug - Caution: Not to be sold by retail',
  'Mfg. Lic. No.: 123/UA/2020',
  'Batch No: B10203',
  'DOLO 650',
  'AUGMENTIN 625 DUO',
  'PAN 40',
  'BECOSULES CAPSULES',
  'ZIFI 200'
];

let allPassed = true;

for (const line of testLines) {
  const isExcluded = aiCameraService.isPackagingOrCompositionLine(line);
  const shouldBeExcluded = [
    'Paracetamol Tablets I.P. 650mg',
    'Each film coated tablet contains: Paracetamol IP 650mg',
    'Store at temperature not exceeding 30°C',
    'Schedule H Prescription Drug - Caution: Not to be sold by retail',
    'Mfg. Lic. No.: 123/UA/2020',
    'Batch No: B10203'
  ].includes(line);

  const status = isExcluded === shouldBeExcluded ? 'PASS' : 'FAIL';
  if (status === 'FAIL') allPassed = false;

  console.log(`[${status}] "${line}" -> ${isExcluded ? 'EXCLUDED (Composition/Regulatory Noise)' : 'KEPT (Brand Name candidate)'}`);
}

console.log(`\nOverall Result: ${allPassed ? 'ALL TESTS PASSED ✅' : 'FAILURES DETECTED ❌'}`);
process.exit(allPassed ? 0 : 1);
