import fs from 'fs';
import { aiCameraService } from '../src/services/aiCameraService.js';

async function testSamplePrescription() {
  await aiCameraService.initialize();
  const imgPath = 'SAMPLE IMAGE/IMG_8548.JPEG';
  const buf = fs.readFileSync(imgPath);

  console.log('=== RUNNING OCR ON SAMPLE IMAGE: IMG_8548.JPEG ===');
  const result = await aiCameraService.processImage(buf, true);
  console.log('\n--- EXTRACTED DETAILS ---');
  console.log('Potential Name:', result.potentialName);
  console.log('Dosage Form:   ', result.dosageForm);
  console.log('Company:       ', result.company);
  console.log('Strength:      ', result.detectedStrength);
  console.log('\n--- RAW OCR TEXT DUMP ---');
  console.log(result.text || result.rawOcrText || '(no text detected)');
}

testSamplePrescription().catch(console.error);
