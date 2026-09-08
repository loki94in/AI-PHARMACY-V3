import { catalogImageService } from '../src/services/catalogImageService.js';
import { getTargetedQueries } from './resolve_master_catalog.mjs';

const med = { name: 'DABUR HONEY 50 GM', manufacturer: 'DABUR INDIA LIMITED', strength: '50 GM' };
console.log('Core brand:', catalogImageService.extractCoreBrand(med.name));
console.log('Queries:', getTargetedQueries(med));

const cand = { name: 'Dabur Honey 50g', manufacturer: 'Dabur India Limited' };
const res = catalogImageService.computeConfidence(med, cand);
console.log('Match result:', res);
