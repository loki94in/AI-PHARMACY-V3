import { 
  enhancedSimilarity, 
  extractUmbrellaFormulation, 
  extractDrugStrength, 
  extractVolumeOrWeight,
  isItemTypeConflicting,
  isModalityConflict 
} from '../src/services/productNameFilterService.js';
import { aiCameraService } from '../src/services/aiCameraService.js';

console.log('='.repeat(70));
console.log('   VERIFYING AI CAMERA & PRODUCT MATCHER IMPROVEMENTS');
console.log('='.repeat(70));

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

// 1. Umbrella Brand Formulation Disambiguation
console.log('\n[1] Testing Umbrella Brand Disambiguation:');
const daburHoneyVsGlucose = enhancedSimilarity('Dabur Honey', 'Dabur Glucose D');
assert(daburHoneyVsGlucose <= 0.25, `Dabur Honey vs Dabur Glucose D must be penalized (got ${daburHoneyVsGlucose.toFixed(2)})`);

const himalayaLivVsCystone = enhancedSimilarity('Himalaya Liv 52', 'Himalaya Cystone');
assert(himalayaLivVsCystone <= 0.25, `Himalaya Liv 52 vs Himalaya Cystone must be penalized (got ${himalayaLivVsCystone.toFixed(2)})`);

const daburHoneyMatch = enhancedSimilarity('Dabur Honey 500g', 'Dabur Pure Honey 500g');
assert(daburHoneyMatch >= 0.80, `Dabur Honey 500g vs Dabur Pure Honey 500g should match (got ${daburHoneyMatch.toFixed(2)})`);

// 2. Unit-Aware Drug Strength vs Pack Count
console.log('\n[2] Testing Unit-Aware Strength vs Pack Count:');
const str10vs15 = enhancedSimilarity('Paracetamol 500mg Strip of 10', 'Paracetamol 500mg Strip of 15');
assert(str10vs15 >= 0.85, `Same strength 500mg with pack variation (10 vs 15) should score high (got ${str10vs15.toFixed(2)})`);

const str500vs250 = enhancedSimilarity('Paracetamol 500mg Strip of 10', 'Paracetamol 250mg Strip of 10');
assert(str500vs250 < 0.65, `Conflicting strength (500mg vs 250mg) must NOT be masked by shared pack count 10 (got ${str500vs250.toFixed(2)})`);

// 3. Modality Conflict Guard (Vicks / Topical Balm vs Inhaler vs Lozenge)
console.log('\n[3] Testing Modality Conflict Guards:');
const vicksVapoVsInhaler = enhancedSimilarity('Vicks Vaporub 25ml', 'Vicks Inhaler');
assert(vicksVapoVsInhaler <= 0.20, `Vicks Vaporub vs Vicks Inhaler must be rejected (got ${vicksVapoVsInhaler.toFixed(2)})`);

const vicksVapoVsDrops = enhancedSimilarity('Vicks Vaporub 25ml', 'Vicks 3-in-1 Cough Drops');
assert(vicksVapoVsDrops <= 0.20, `Vicks Vaporub vs Vicks Cough Drops must be rejected (got ${vicksVapoVsDrops.toFixed(2)})`);

const isConflict = isModalityConflict('Vicks Vaporub', 'Vicks Inhaler');
assert(isConflict === true, 'isModalityConflict returns true for Balm vs Inhaler');

// 4. Bounded Prefix Matching
console.log('\n[4] Testing Bounded Prefix Matching:');
const dermaSim = enhancedSimilarity('derma', 'dermatouch');
assert(dermaSim < 0.80, `Medical prefix "derma" must not falsely inflate against "dermatouch" (got ${dermaSim.toFixed(2)})`);

// 5. Clinical Dosage Form Conflict
console.log('\n[5] Testing Clinical Dosage Form Conflict:');
assert(isItemTypeConflicting('Tablet', 'Amoxicillin Syrup 60ml') === true, 'Tablet conflicts with Syrup');
assert(isItemTypeConflicting('Tablet', 'Ceftriaxone Injection 1g') === true, 'Tablet conflicts with Injection');
assert(isItemTypeConflicting('Tablet', 'Strip of 10 Tablets') === false, 'Tablet compatible with Strip of 10 Tablets');
assert(isItemTypeConflicting('Inhaler', 'Vicks Vaporub Balm') === true, 'Inhaler conflicts with Balm');

// 6. AI Camera detectDosageForm Expansion
console.log('\n[6] Testing AI Camera Dosage Form Detection:');
assert(aiCameraService.detectDosageForm('Vicks Vaporub Balm 25ml') === 'Balm', 'Detects Balm');
assert(aiCameraService.detectDosageForm('Asthalin Inhaler 200 MDI') === 'Inhaler', 'Detects Inhaler');
assert(aiCameraService.detectDosageForm('Dettol Bathing Soap Bar') === 'Soap', 'Detects Soap');
assert(aiCameraService.detectDosageForm('Parachute Pure Coconut Oil 100ml') === 'Oil', 'Detects Oil');

console.log('\n' + '='.repeat(70));
console.log(`RESULTS: ${passed} passed, ${failed} failed.`);
console.log('='.repeat(70));

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
