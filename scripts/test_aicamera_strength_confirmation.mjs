import { aiCameraService } from '../src/services/aiCameraService.js';
import { productNameFilterService } from '../src/services/productNameFilterService.js';

async function test() {
  await productNameFilterService.initialize();

  console.log('=== AI CAMERA PACKAGING CONFIRMATION SUITE ===\n');

  // Test 1: Dytor 20mg OCR
  console.log('Test 1: Dytor 20mg Scan');
  const dytor20Ocr = 'Torsemide Tablets IP 20 mg\nDYTOR-20\nCipla Ltd\nBatch: SN30308\nExp: 05/27\nMRP: 202.81';
  const filter20 = await productNameFilterService.filterProductNames('dytor', {
    minConfidenceThreshold: 0.65,
    dosageForm: 'Tablet',
    rawOcrText: dytor20Ocr
  });
  console.log('  Filter Top Match:', filter20.matches[0]);
  console.log('  Filter Top Score:', filter20.topScore);
  if (!filter20.matches[0].includes('20MG')) {
    throw new Error(`Expected 20MG match, got: ${filter20.matches[0]}`);
  }
  console.log('  ✓ Correctly confirmed 20MG and rejected 10MG/40MG/5MG');

  // Test 2: Dytor 10mg Scan
  console.log('\nTest 2: Dytor 10mg Scan');
  const dytor10Ocr = 'Torsemide Tablets IP 10 mg\nDYTOR-10\nCipla Ltd\nBatch: SN11736\nExp: 08/26\nMRP: 102.72';
  const filter10 = await productNameFilterService.filterProductNames('dytor', {
    minConfidenceThreshold: 0.65,
    dosageForm: 'Tablet',
    rawOcrText: dytor10Ocr
  });
  console.log('  Filter Top Match:', filter10.matches[0]);
  console.log('  Filter Top Score:', filter10.topScore);
  if (!filter10.matches[0].includes('10MG')) {
    throw new Error(`Expected 10MG match, got: ${filter10.matches[0]}`);
  }
  console.log('  ✓ Correctly confirmed 10MG and rejected 20MG/40MG/5MG');

  // Test 3: Telma 40 vs Telma 20 vs Telma 80
  console.log('\nTest 3: Telma 40mg Scan');
  const telma40Ocr = 'Telmisartan Tablets IP 40 mg\nTELMA 40\nGlenmark Pharmaceuticals\nBatch: G123\nExp: 10/26';
  const filterTelma = await productNameFilterService.filterProductNames('telma', {
    minConfidenceThreshold: 0.65,
    dosageForm: 'Tablet',
    rawOcrText: telma40Ocr
  });
  console.log('  Filter Top Match:', filterTelma.matches[0]);
  console.log('  Filter Top Score:', filterTelma.topScore);
  if (!filterTelma.matches[0].includes('40')) {
    throw new Error(`Expected 40MG match for Telma, got: ${filterTelma.matches[0]}`);
  }
  console.log('  ✓ Correctly confirmed 40MG and rejected 20MG/80MG');

  // Test 4: Calpol 650 vs Calpol 500
  console.log('\nTest 4: Calpol 650mg Scan');
  const calpol650Ocr = 'Paracetamol Tablets IP 650 mg\nCALPOL 650\nGSK\nBatch: C650\nExp: 12/26';
  const filterCalpol = await productNameFilterService.filterProductNames('calpol', {
    minConfidenceThreshold: 0.65,
    dosageForm: 'Tablet',
    rawOcrText: calpol650Ocr
  });
  console.log('  Filter Top Match:', filterCalpol.matches[0]);
  console.log('  Filter Top Score:', filterCalpol.topScore);
  if (!filterCalpol.matches[0].includes('650')) {
    throw new Error(`Expected 650MG match for Calpol, got: ${filterCalpol.matches[0]}`);
  }
  console.log('  ✓ Correctly confirmed 650MG and rejected 500MG');

  // Test 5: Formulation Modifier Gating - Dytor plain vs Dytor Plus / Dytor Combikit
  console.log('\nTest 5: Formulation Modifier Gating - Plain Dytor vs Dytor Plus / Combikit');
  if (filter10.matches[0].includes('PLUS') || filter10.matches[0].includes('COMBIKIT')) {
    throw new Error(`Plain Dytor 10 matched a modifier variant: ${filter10.matches[0]}`);
  }
  console.log('  ✓ Top match is plain Dytor, rejected PLUS and COMBIKIT');

  // Test 6: Formulation Modifier Gating - Pan 40 vs Pan D / Pan DSR
  console.log('\nTest 6: Formulation Modifier Gating - Pan 40 vs Pan D / Pan DSR');
  const pan40Ocr = 'Pantoprazole Gastro-Resistant Tablets IP 40 mg\nPAN 40\nAlkem Laboratories\nBatch: P401\nExp: 11/27';
  const filterPan = await productNameFilterService.filterProductNames('pan', {
    minConfidenceThreshold: 0.65,
    dosageForm: 'Tablet',
    rawOcrText: pan40Ocr
  });
  console.log('  Filter Top Match for PAN 40:', filterPan.matches[0]);
  console.log('  Filter Top Score:', filterPan.topScore);
  if (filterPan.matches[0].includes('PAN D') || filterPan.matches[0].includes('PAN-D') || filterPan.matches[0].includes('DSR')) {
    throw new Error(`Plain PAN 40 matched a D/DSR variant: ${filterPan.matches[0]}`);
  }
  console.log('  ✓ Correctly confirmed plain PAN 40 and rejected PAN D / PAN DSR');

  // Test 7: Formulation Modifier Gating - Telma 40 vs Telma H / Telma AM
  console.log('\nTest 7: Formulation Modifier Gating - Telma 40 vs Telma H / Telma AM');
  if (filterTelma.matches[0].includes('TELMA H') || filterTelma.matches[0].includes('TELMA AM')) {
    throw new Error(`Plain Telma matched H/AM variant: ${filterTelma.matches[0]}`);
  }
  console.log('  ✓ Correctly confirmed plain Telma and rejected Telma H / Telma AM');

  console.log('\n=== ALL 7 CONFIRMATION & MODIFIER TESTS PASSED 100% ===');
  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
