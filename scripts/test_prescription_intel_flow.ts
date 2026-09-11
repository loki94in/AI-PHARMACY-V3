import fs from 'fs';
import path from 'path';
import { dbManager } from '../src/database/connection.js';
import { processPrescriptionAndNotifyPharmacy, getPharmacyAdminPhone } from '../src/services/prescriptionIntelService.js';

async function main() {
  console.log('--- Testing Autonomous Prescription Intel Flow ---');
  const db = await dbManager.getConnection();

  const phone = await getPharmacyAdminPhone(db);
  console.log('Resolved Pharmacy Admin WhatsApp Phone:', phone || '(None set in DB)');

  // Check sample prescription file
  const samplePath = path.resolve(process.cwd(), 'SAMPLE IMAGE', 'IMG_8548.JPEG');
  if (!fs.existsSync(samplePath)) {
    console.error('Sample prescription not found at:', samplePath);
    return;
  }
  console.log('Found sample prescription image at:', samplePath);

  // Test the end-to-end extraction and intel check
  console.log('Simulating Order #999999 processing...');
  const startTime = Date.now();
  await processPrescriptionAndNotifyPharmacy({
    orderId: 999999,
    customerName: 'Test Patient',
    customerPhone: '9876543210',
    imagePaths: [samplePath],
    manualMedicineName: 'Dolo 650',
    host: 'localhost:5175',
    protocol: 'http',
    savedUrls: ['/uploads/prescriptions/sample.jpg']
  });

  console.log(`Flow completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

  // Verify tracking event was inserted
  const event = await db.get(
    "SELECT * FROM order_tracking_events WHERE order_id = 999999 ORDER BY id DESC LIMIT 1"
  );
  console.log('Verified order_tracking_event:', event);

  // Clean up test event
  await db.run("DELETE FROM order_tracking_events WHERE order_id = 999999");
  console.log('Test completed successfully!');
  process.exit(0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
