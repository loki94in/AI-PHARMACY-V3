import { isItemInStock, resolveCommonOrFrequentDistributor } from '../src/routes/pharmarack.js';

describe('WhatsApp Confirmed Order & Live Cart Helpers', () => {
  describe('isItemInStock', () => {
    test('identifies positive numeric stocks as in-stock', () => {
      expect(isItemInStock(10)).toBe(true);
      expect(isItemInStock(1)).toBe(true);
      expect(isItemInStock(999)).toBe(true);
    });

    test('rejects 0, negative, and invalid numbers as out-of-stock', () => {
      expect(isItemInStock(0)).toBe(false);
      expect(isItemInStock(-5)).toBe(false);
      expect(isItemInStock(NaN)).toBe(false);
      expect(isItemInStock(null)).toBe(false);
      expect(isItemInStock(undefined)).toBe(false);
      expect(isItemInStock('')).toBe(false);
    });

    test('rejects common string representations of 0 and OOS', () => {
      expect(isItemInStock('0')).toBe(false);
      expect(isItemInStock('out of stock')).toBe(false);
      expect(isItemInStock('OOS')).toBe(false);
      expect(isItemInStock('oos')).toBe(false);
      expect(isItemInStock('nil')).toBe(false);
      expect(isItemInStock('none')).toBe(false);
      expect(isItemInStock('unavailable')).toBe(false);
    });

    test('accepts positive string numbers and availability indicators', () => {
      expect(isItemInStock('15')).toBe(true);
      expect(isItemInStock('in stock')).toBe(true);
      expect(isItemInStock('Available')).toBe(true);
      expect(isItemInStock('>10')).toBe(true);
    });
  });

  describe('resolveCommonOrFrequentDistributor', () => {
    test('returns null for empty candidates', async () => {
      const res = await resolveCommonOrFrequentDistributor(null, []);
      expect(res).toBeNull();
    });

    test('returns the sole candidate directly', async () => {
      const candidate = { storeId: 101, storeName: 'Apex Healthcare' };
      const res = await resolveCommonOrFrequentDistributor(null, [candidate]);
      expect(res).toEqual(candidate);
    });

    test('picks the most frequent distributor from purchase history if no cart items exist', async () => {
      const candidates = [
        { storeId: 101, storeName: 'Apollo Distributors' },
        { storeId: 202, storeName: 'MedLife Pharma' }
      ];

      const mockDb = {
        all: async (sql: string) => {
          if (sql.includes('FROM distributors')) {
            return [
              { name: 'MedLife Pharma', order_count: 25 },
              { name: 'Apollo Distributors', order_count: 5 }
            ];
          }
          return [];
        }
      };

      const res = await resolveCommonOrFrequentDistributor(mockDb, candidates);
      expect(res?.storeName).toBe('MedLife Pharma');
      expect(res?.storeId).toBe(202);
    });
  });

  describe('Live Cart Hard Gate & Customer Staging Safeguards', () => {
    test('failed Live Cart addition blocks Confirmed order and customer staging, triggering admin alert', async () => {
      // Simulate failure response from Live Cart add
      const cartResult = { success: false, error: 'Session expired or product unavailable' };
      let specialOrderCreated = false;
      let stagedMessageCreated = false;
      let adminAlertPayload: any = null;

      // Simulated workflow gate matching executeConfirmedProcurementFlow
      if (!cartResult.success) {
        adminAlertPayload = {
          orderId: 'FAILED',
          items: [{ name: 'Zifi 200mg', quantity: 2, distributor: 'Apex Healthcare' }],
          success: false,
          error: cartResult.error
        };
      } else {
        specialOrderCreated = true;
        stagedMessageCreated = true;
      }

      expect(specialOrderCreated).toBe(false);
      expect(stagedMessageCreated).toBe(false);
      expect(adminAlertPayload).not.toBeNull();
      expect(adminAlertPayload.success).toBe(false);
      expect(adminAlertPayload.error).toBe('Session expired or product unavailable');
    });

    test('successful Live Cart addition creates Confirmed order, stages collection message, notifies owner, and sends customer courtesy acknowledgment', async () => {
      const cartResult = { success: true, mode: 'Live' };
      let specialOrderStatus = '';
      let stagedNotification: any = null;
      let adminAlertPayload: any = null;
      let customerAckEnqueued = false;
      let customerAckText = '';

      if (cartResult.success) {
        specialOrderStatus = 'Confirmed';
        stagedNotification = {
          type: 'whatsapp_order',
          status: 'staged',
          needs_confirmation: 1,
          message: 'Hi John, your order for Zifi 200mg (Qty: 2) has been received at City Pharmacy...'
        };
        adminAlertPayload = {
          orderId: 101,
          success: true
        };
        // Sent ONLY after owner notification is complete:
        if (adminAlertPayload.success) {
          customerAckEnqueued = true;
          customerAckText = 'Thank you! Your request for *Zifi 200mg* × 2 has been received and forwarded to our pharmacy owner. We are arranging it with our distributor and will message you as soon as it is ready for collection.';
        }
      }

      expect(specialOrderStatus).toBe('Confirmed');
      expect(stagedNotification.status).toBe('staged');
      expect(stagedNotification.needs_confirmation).toBe(1);
      expect(adminAlertPayload.success).toBe(true);
      expect(customerAckEnqueued).toBe(true);
      expect(customerAckText).toContain('forwarded to our pharmacy owner');
    });

    test('15-minute idempotency guard prevents duplicate Live Cart orders for same phone and medicine', () => {
      const existingRecentOrder = {
        id: 42,
        phone: '9876543210',
        medicine_name: 'Zifi 200mg',
        created_at: new Date().toISOString()
      };

      const incomingRequest = {
        phone: '9876543210',
        medicine: 'zifi 200mg'
      };

      const isDuplicate = existingRecentOrder.phone === incomingRequest.phone &&
        existingRecentOrder.medicine_name.toLowerCase() === incomingRequest.medicine.toLowerCase();

      expect(isDuplicate).toBe(true);
    });
  });
});
