import { catalogImageService } from '../src/services/catalogImageService.js';

console.log('1. Testing Baidyanath Drakshasava vs Diabo Vital Juice:');
const m1 = catalogImageService.computeConfidence(
  { name: 'BAIDYANATH DRAKSHASAVA LIQUID 227 ML', manufacturer: 'BAIDYANATH AYURVEDA BHAVAN LTD' },
  { name: 'Baidyanath Asli Ayurved Diabo Vital Juice | Diabetic Care | Blend With Karela Jamun Neem Gudmar - 1L', manufacturer: 'Baidyanath' }
);
console.log('Result:', m1.verificationStatus, m1.confidenceScore, m1.reason);

console.log('\n2. Testing Baidyanath Drakshasava vs Baidyanath Drakshasava:');
const m2 = catalogImageService.computeConfidence(
  { name: 'BAIDYANATH DRAKSHASAVA LIQUID 227 ML', manufacturer: 'BAIDYANATH AYURVEDA BHAVAN LTD' },
  { name: 'Baidyanath Asli Ayurved Drakshasava 220 Ml', manufacturer: 'Baidyanath' }
);
console.log('Result:', m2.verificationStatus, m2.confidenceScore, m2.reason);

console.log('\n3. Testing Dabur Glucose D vs Dabur Giloy Neem Juice:');
const m3 = catalogImageService.computeConfidence(
  { name: 'DABUR GLUCOSE D POWDER 75GM', manufacturer: 'DABUR' },
  { name: 'Dabur Giloy Neem Juice With Tulsi - 1 Litre', manufacturer: 'Dabur' }
);
console.log('Result:', m3.verificationStatus, m3.confidenceScore, m3.reason);

console.log('\n4. Testing New Alkof Cofgels vs New Coldact:');
const m4 = catalogImageService.computeConfidence(
  { name: 'NEW ALKOF COFGELS STRIP OF 10 CAPSULES', manufacturer: 'ALKEM LABORATORIES LTD' },
  { name: 'New Coldact Capsule 20s', manufacturer: 'Sun Pharma' }
);
console.log('Result:', m4.verificationStatus, m4.confidenceScore, m4.reason);
