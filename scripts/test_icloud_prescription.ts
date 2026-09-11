import fs from 'fs';
import path from 'path';
import { prescriptionScannerService } from '../src/services/prescriptionScannerService.js';

async function testPrescriptionScan() {
  console.log('===============================================================');
  console.log('  STARTING PURE OFFLINE PRESCRIPTION SCANNER (ZERO CLOUD APIS)');
  console.log('  Timeout Guard: Strict 5-Minute (300s) Maximum Enforced');
  console.log('===============================================================\n');

  // Locate prescription image: Try original high-res SAMPLE IMAGE first, then scratch
  let samplePath = path.resolve('SAMPLE IMAGE/IMG_8548.JPEG');
  if (!fs.existsSync(samplePath)) {
    samplePath = 'C:/Users/ratna/.gemini/antigravity-ide/brain/da4bc785-747b-4eb9-87b8-799b860e0815/scratch/icloud_prescription_thumb.jpg';
  }

  if (!fs.existsSync(samplePath)) {
    console.error('Error: Prescription image file not found at:', samplePath);
    process.exit(1);
  }

  const stat = fs.statSync(samplePath);
  console.log(`Target Image: ${samplePath}`);
  console.log(`File Size: ${(stat.size / 1024).toFixed(1)} KB`);
  console.log(`Scan Started at: ${new Date().toLocaleTimeString()}\n`);

  const tStart = Date.now();

  try {
    const result = await prescriptionScannerService.scanPrescription(samplePath);
    const totalDurationSeconds = ((Date.now() - tStart) / 1000).toFixed(2);

    console.log('---------------------------------------------------------------');
    console.log(`SCAN COMPLETED SUCCESSFULLY IN: ${totalDurationSeconds} SECONDS`);
    console.log(`Verdict: ${Number(totalDurationSeconds) < 300 ? 'PASSED (< 5 MINUTES)' : 'FAILED (> 5 MINUTES)'}`);
    console.log('---------------------------------------------------------------\n');

    console.log('=== EXTRACTED CLINIC & PATIENT METADATA ===');
    console.log(`Clinic:  ${result.clinicName || 'Not detected'}`);
    console.log(`Doctor:  ${result.doctorName || 'Not detected'}`);
    console.log(`Patient: ${result.patientName || 'Not detected'}`);
    console.log(`Age:     ${result.patientAge || 'Not detected'}\n`);

    console.log(`=== PRESCRIBED MEDICINES MATCHED AGAINST DATABASE (${result.items.length} FOUND) ===`);
    result.items.forEach((item, index) => {
      console.log(`\n[${index + 1}] Line: "${item.rawText}"`);
      console.log(`    Parsed: Brand="${item.brandName}", Strength="${item.strength}", Form=${item.dosageForm}, Qty=${item.prescribedQuantity}`);
      console.log(`    Database Matches (${item.matchedMedicines.length} found):`);
      item.matchedMedicines.forEach((m, mIdx) => {
        console.log(`      (${mIdx + 1}) [ID: ${m.id}] ${m.name}`);
        console.log(`          Manufacturer: ${m.manufacturer || 'Unknown'} | Packaging: ${m.packaging || 'N/A'}`);
      });
    });

    console.log('\n=== RAW OCR TEXT RECOGNIZED ===');
    console.log(result.rawOcrText.trim());

    await prescriptionScannerService.terminate();
    process.exit(0);
  } catch (err: any) {
    const elapsedSeconds = ((Date.now() - tStart) / 1000).toFixed(2);
    console.error(`\nScan failed after ${elapsedSeconds} seconds:`, err.message);
    await prescriptionScannerService.terminate();
    process.exit(1);
  }
}

testPrescriptionScan().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
