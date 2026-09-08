import { catalogImageService } from '../src/services/catalogImageService.js';

const res = catalogImageService.computeConfidence(
  { name: 'MANFORCE STAYLONG GEL 10 GM', manufacturer: 'MANKIND PHARMACEUTICALS LTD' },
  { name: 'Manforce Staylong Gel 8 Gm', manufacturer: 'MANFORCE' }
);
console.log('MANFORCE STAYLONG TEST:');
console.log({
  score: res.confidenceScore,
  status: res.verificationStatus,
  reason: res.reason,
  signals: res.signals
});
