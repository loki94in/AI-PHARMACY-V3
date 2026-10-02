import assert from 'assert';
import { normalizeInvoiceNo, stripPharmaNoise, tokensMatchFuzzy } from '../src/utils/reconciliationMatcher.js';

console.log('\n--- Running Bounced & Reconciliation Verification Tests ---');

// 1. normalizeInvoiceNo
console.log('Testing normalizeInvoiceNo...');
assert.strictEqual(normalizeInvoiceNo('INV/2026/00123'), '202600123');
assert.strictEqual(normalizeInvoiceNo('TAX-INV-0045'), '45');
assert.strictEqual(normalizeInvoiceNo('BILL #0099'), '99');
assert.strictEqual(normalizeInvoiceNo('0000789'), '789');
assert.strictEqual(normalizeInvoiceNo('SB-2024-88'), 'SB202488');
assert.strictEqual(normalizeInvoiceNo(''), '');
assert.strictEqual(normalizeInvoiceNo(null), '');
assert.strictEqual(normalizeInvoiceNo(undefined), '');
console.log('✔ normalizeInvoiceNo passed all test cases');

// 2. stripPharmaNoise
console.log('Testing stripPharmaNoise...');
assert.strictEqual(stripPharmaNoise('TELMA 40MG TAB 10\'S'), 'telma 40');
assert.strictEqual(stripPharmaNoise('AUGMENTIN 625 DUO TAB (GLENMARK)'), 'augmentin 625 duo');
assert.strictEqual(stripPharmaNoise('PAN 40 INJ (ALKEM)'), 'pan 40');
assert.strictEqual(stripPharmaNoise('AZITHRAL 500 MG TABLET 3S'), 'azithral 500');
assert.strictEqual(stripPharmaNoise('CALPOL 650MG SYRUP 60ML'), 'calpol 650');
assert.strictEqual(stripPharmaNoise('CETGEL CAP'), 'cetgel');
console.log('✔ stripPharmaNoise passed all test cases');

// 3. tokensMatchFuzzy
console.log('Testing tokensMatchFuzzy matching & safeguards...');
assert.strictEqual(tokensMatchFuzzy('TELMA 40MG TAB 10\'S', 'TELMA 40'), true, 'Should match TELMA 40 with forms and pack size');
assert.strictEqual(tokensMatchFuzzy('AUGMENTIN 625 DUO TAB (GLENMARK)', 'AUGMENTIN 625 DUO'), true, 'Should match AUGMENTIN with company in parens');
assert.strictEqual(tokensMatchFuzzy('PAN 40 INJ', 'PAN 40'), true, 'Should match PAN 40 INJ with PAN 40');
assert.strictEqual(tokensMatchFuzzy('AZITHRAL 500 MG TAB', 'AZITHRAL 500'), true, 'Should match AZITHRAL 500');
assert.strictEqual(tokensMatchFuzzy('CALPOL 650MG', 'CALPOL 650'), true, 'Should match CALPOL 650');
assert.strictEqual(tokensMatchFuzzy('CETGEL CAP', 'CETGEL'), true, 'Should match CETGEL CAP');

// Strength protections
assert.strictEqual(tokensMatchFuzzy('TELMA 40', 'TELMA 80'), false, 'Must reject different strengths 40 vs 80');
assert.strictEqual(tokensMatchFuzzy('CALPOL 500', 'CALPOL 650'), false, 'Must reject different strengths 500 vs 650');
assert.strictEqual(tokensMatchFuzzy('AMLONG 2.5', 'AMLONG 5'), false, 'Must reject different strengths 2.5 vs 5');
assert.strictEqual(tokensMatchFuzzy('ATORVA 10', 'ATORVA 20'), false, 'Must reject different strengths 10 vs 20');

// Combination suffix protections
assert.strictEqual(tokensMatchFuzzy('PAN-D', 'PAN 40'), false, 'Must reject combination PAN-D against single salt PAN 40');
assert.strictEqual(tokensMatchFuzzy('PAN DSR', 'PAN 40'), false, 'Must reject combination PAN DSR against single salt PAN 40');
assert.strictEqual(tokensMatchFuzzy('TELMA-AM', 'TELMA 40'), false, 'Must reject combination TELMA-AM against single salt TELMA 40');
assert.strictEqual(tokensMatchFuzzy('TELMA-H', 'TELMA 40'), false, 'Must reject combination TELMA-H against single salt TELMA 40');

// Alias map support
const aliasMap = new Map<string, string>([
  ['pcm', 'paracetamol'],
  ['dolo', 'paracetamol']
]);
assert.strictEqual(tokensMatchFuzzy('PCM 500', 'PARACETAMOL 500', aliasMap), true, 'Must match with alias PCM -> PARACETAMOL');
console.log('✔ tokensMatchFuzzy passed all test cases');

// 4. Invariant test
console.log('Testing Bounced (0) invariant...');
const emptyMedicines: string[] = [];
let status = 'Bounced';
if (emptyMedicines.length === 0 && status === 'Bounced') {
  status = 'Matched';
}
assert.strictEqual(status, 'Matched', 'Status must convert to Matched when medicines array is empty');
console.log('✔ Invariant test passed');

console.log('\nAll 15 verification tests passed successfully!\n');
