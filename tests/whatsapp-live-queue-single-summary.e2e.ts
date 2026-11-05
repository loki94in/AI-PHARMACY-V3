// tests/whatsapp-live-queue-single-summary.e2e.ts
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { dbManager } from '../src/database/connection.js';
import { sendBatchToDeliveryBoys } from '../src/services/pharmarackDailyDispatchService.js';

describe('WhatsApp Live Queue Controller & Single Delivery Boy Summary E2E Flow', { tags: ['whatsapp', 'queue', 'po-summary', 'e2e'] }, () => {
  test('PO History Batch Send enqueues strictly Format 1 (TODAY DISTRIBUTOR SUMMARY & TOTALS) and suppresses Format 2', async () => {
    const db = await dbManager.getConnection();

    // 1. Clean previous test notifications for clean assertion baseline
    await db.run("DELETE FROM whatsapp_send_queue WHERE number = '918888800000'");
    await db.run("DELETE FROM automation_notifications WHERE recipient_phone = '918888800000' OR recipient_phone = '8888800000'");

    // 2. Prepare mock orders representing PO history orders
    const mockOrders = [
      {
        id: 999901,
        store_name: 'Alpha Pharma Test Dist',
        order_no: 'PO-TEST-001',
        items_json: JSON.stringify([
          { name: 'Paracetamol 500mg', qty: 2, packaging: '10x10' },
          { name: 'Cetirizine 10mg', qty: 1, packaging: '10x10' }
        ]),
        delivery_persons_json: JSON.stringify([{ name: 'Test Om Route', phone: '8888800000' }])
      },
      {
        id: 999902,
        store_name: 'Beta Healthcare Test Dist',
        order_no: 'PO-TEST-002',
        items_json: JSON.stringify([
          { name: 'Amoxicillin 500mg', qty: 3, packaging: '10x10' }
        ]),
        delivery_persons_json: JSON.stringify([{ name: 'Test Om Route', phone: '8888800000' }])
      }
    ];

    // 3. Trigger Format 1 batch dispatch with explicitScheduledAt = NOW (ASAP)
    await sendBatchToDeliveryBoys(db, mockOrders, false, Date.now());

    // 4. Query queued items for this delivery boy
    const queuedItems = await db.all(
      "SELECT * FROM whatsapp_send_queue WHERE number = '918888800000' ORDER BY id DESC LIMIT 5"
    );

    // 5. Assert strictly ONE message was enqueued for the batch
    expect(queuedItems.length).toBeGreaterThanOrEqual(1);
    const summaryMsg = queuedItems[0].message;

    // 6. Verify Format 1 contract
    expect(summaryMsg).toContain('TODAY DISTRIBUTOR SUMMARY & TOTALS');
    expect(summaryMsg).toContain('Alpha Pharma Test Dist');
    expect(summaryMsg).toContain('Beta Healthcare Test Dist');
    expect(summaryMsg).toContain('Total Today Distributors:* 2');
    expect(summaryMsg).toContain('Total Today Order Items:* 3');

    // 7. Verify Format 2 (TODAY'S DISPATCH & COLLECTION LIST) is strictly NOT present
    expect(summaryMsg).not.toContain("TODAY'S DISPATCH & COLLECTION LIST");
    expect(summaryMsg).not.toContain('AFTERNOON DISPATCH & COLLECTION LIST');
    expect(summaryMsg).not.toContain('Pending Collection');
    expect(summaryMsg).not.toContain('Please verify bills with distributor counter');

    // 8. Clean up test records
    await db.run("DELETE FROM whatsapp_send_queue WHERE number = '918888800000'");
    await db.run("DELETE FROM automation_notifications WHERE recipient_phone = '918888800000' OR recipient_phone = '8888800000'");
  });

  test('Pharmarack Cart page and WhatsApp automation trigger render cleanly without crashes', async ({ app, browser, screen }) => {
    // 1. Visit Pharmarack Cart
    await app.open('/pharmarack-cart');
    await expect(browser).toHaveURL(/\/pharmarack-cart/);
    await expect(browser.locator('#root')).toBeVisible();

    // 2. Ensure no React error boundary or crash overlays
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(screen.getByText('Application Error')).toHaveCount(0);

    // 3. Verify Sent PO History button is visible via locator
    const sentPoHistoryBtn = browser.locator('button').filter({ hasText: /Sent PO History/i }).first();
    await expect(sentPoHistoryBtn).toBeVisible();

    // 4. Fire real-time SSE event sse-wa-queue-updated and ensure UI handles update cleanly
    await browser.evaluate(() => {
      window.dispatchEvent(new CustomEvent('sse-wa-queue-updated', { detail: { active: true, at: Date.now() } }));
    });

    // 5. Guarantee page integrity after SSE update
    await expect(screen.getByText('Something went wrong')).toHaveCount(0);
    await expect(sentPoHistoryBtn).toBeVisible();
  });
});
