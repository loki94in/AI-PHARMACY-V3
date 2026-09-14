import { onnxOcrService } from '../src/services/onnxOcrService.js';
import { aiCameraService } from '../src/services/aiCameraService.js';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('===============================================================');
  console.log('⚡ TESTING PADDLEOCR ONNX ENGINE & AI CAMERA INTEGRATION');
  console.log('===============================================================\n');

  console.log('1. Checking ONNX model files on disk...');
  const available = await onnxOcrService.checkAvailability();
  console.log('   Result: onnxOcrService.checkAvailability() =', available);

  if (!available) {
    console.error('❌ FAILED: ONNX models could not be found.');
    process.exit(1);
  }

  const sampleDir = path.join(process.cwd(), 'uploads', 'products');
  const sampleFiles = fs.readdirSync(sampleDir).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
  
  if (sampleFiles.length === 0) {
    console.warn('⚠️ No sample images found in uploads/products.');
    process.exit(0);
  }

  const sampleFile = sampleFiles[0];
  const samplePath = path.join(sampleDir, sampleFile);
  console.log(`\n2. Sample image: uploads/products/${sampleFile}`);
  const buffer = fs.readFileSync(samplePath);

  console.log('\n3. Running DIRECT PaddleOCR ONNX neural inference...');
  const tStartOcr = Date.now();
  const directOcr = await onnxOcrService.scanImage(buffer);
  const ocrLatency = Date.now() - tStartOcr;

  console.log('   Direct ONNX OCR Latency :', ocrLatency, 'ms');
  console.log('   Direct ONNX OCR Success :', directOcr.success);
  console.log('   Confidence Score        :', directOcr.confidence + '%');
  console.log('   Detected Words Count    :', directOcr.words?.length || 0);
  console.log('   Extracted Text Preview  :', JSON.stringify((directOcr.text || '').slice(0, 150)));

  console.log('\n4. Running Harvester Terminal method: aiCameraService.extractRawText()...');
  const tStartHarvester = Date.now();
  const rawText = await aiCameraService.extractRawText(buffer);
  const harvesterLatency = Date.now() - tStartHarvester;
  console.log('   Harvester extractRawText Latency :', harvesterLatency, 'ms');
  console.log('   Extracted Characters Count       :', rawText.length);
  console.log('   Extracted Text Preview           :', JSON.stringify(rawText.slice(0, 120)));

  console.log('\n5. Running FULL AI Camera pipeline (Preprocessing + ONNX + Catalog matching)...');
  const tStartFull = Date.now();
  const fullResult = await aiCameraService.processImage(buffer, true);
  const fullLatency = Date.now() - tStartFull;

  console.log('\n===============================================================');
  console.log('📊 AI CAMERA FULL PIPELINE RESULTS:');
  console.log('===============================================================');
  console.log(`   • Total Latency   : ${fullLatency} ms`);
  console.log(`   • Fallback Used   : ${fullResult.fallbackUsed} (false = ONNX ACTIVE, true = Tesseract fallback)`);
  console.log(`   • Confidence Score: ${fullResult.confidence}%`);
  console.log(`   • Identified Name : "${fullResult.medicineInfo?.potentialName || 'N/A'}"`);
  console.log(`   • Strength        : "${fullResult.medicineInfo?.strength || 'N/A'}"`);
  console.log(`   • Dosage Form     : "${fullResult.medicineInfo?.dosageForm || 'N/A'}"`);
  console.log('===============================================================\n');

  if (!fullResult.fallbackUsed && directOcr.success) {
    console.log('🎉 SUCCESS: PaddleOCR ONNX neural engine is FULLY CONNECTED, ACTIVE, and VERIFIED!\n');
    process.exit(0);
  } else {
    console.warn('⚠️ Warning: Fallback was used or direct OCR failed.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Error during test:', err);
  process.exit(1);
});
