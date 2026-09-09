import { catalogImageService } from '../src/services/catalogImageService.js';

const med = {
  med_name: 'HIM BABY 200 WIPES 1',
  med_mfg: 'THE HIMALAYA DRUG COMPANY'
};

const candidate = {
  name: 'Himalaya Gentle Baby Wipes | Extra Soft | Packet 72 Wipes',
  manufacturer: 'HIMALAYA',
  imagePath: 'https://cdn01.pharmeasy.in/dam/products_otc/090531/himalaya-gentle-baby-wipes-extra-soft-packet-72-wipes-2-1787036589.jpg'
};

const res = catalogImageService.computeConfidence(
  { name: med.med_name, manufacturer: med.med_mfg },
  candidate
);

console.log('Result for Himalaya Baby Wipes:', res);
