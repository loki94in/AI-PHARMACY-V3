import { catalogImageService } from '../src/services/catalogImageService.js';

const med = {
  name: 'OIL 92 BOTTLE 100ML',
  manufacturer: 'PARACHUT',
  strength: '100ML'
};

const cand = {
  name: 'Parachute Hair Oil 100Ml',
  manufacturer: 'PARACHUTE'
};

console.log('Result:', catalogImageService.computeConfidence(med, cand));
