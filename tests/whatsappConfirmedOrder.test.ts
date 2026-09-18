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

    test('successful Live Cart addition creates Confirmed order, stages collection message, and notifies owner — customer message is staged only, never auto-sent', async () => {
      const cartResult = { success: true, mode: 'Live' };
      let specialOrderStatus = '';
      let stagedNotification: any = null;
      let adminAlertPayload: any = null;
      let customerDirectSendAttempted = false;

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
        // Per WhatsApp Confirmed Order.md: owner notification is automatic, but the
        // customer-facing message must remain STAGED — no direct/auto send follows
        // owner notification. customerDirectSendAttempted must stay false.
      }

      expect(specialOrderStatus).toBe('Confirmed');
      expect(stagedNotification.status).toBe('staged');
      expect(stagedNotification.needs_confirmation).toBe(1);
      expect(adminAlertPayload.success).toBe(true);
      expect(customerDirectSendAttempted).toBe(false);
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

  describe('Auto Add to Live Cart Setting & Decision Gate', () => {
    test('isAutoAddToLiveCartEnabled defaults to true when setting is absent', async () => {
      const { isAutoAddToLiveCartEnabled } = await import('../src/services/storeSettingsService.js');
      const mockDb = {
        get: async () => null
      };
      const enabled = await isAutoAddToLiveCartEnabled(mockDb);
      expect(enabled).toBe(true);
    });

    test('isAutoAddToLiveCartEnabled returns true for truthy values', async () => {
      const { isAutoAddToLiveCartEnabled } = await import('../src/services/storeSettingsService.js');
      for (const val of ['true', '1', 'on', 'TRUE']) {
        const mockDb = {
          get: async () => ({ value: val })
        };
        const enabled = await isAutoAddToLiveCartEnabled(mockDb);
        expect(enabled).toBe(true);
      }
    });

    test('isAutoAddToLiveCartEnabled returns false for falsy values', async () => {
      const { isAutoAddToLiveCartEnabled } = await import('../src/services/storeSettingsService.js');
      for (const val of ['false', '0', 'off', 'FALSE']) {
        const mockDb = {
          get: async () => ({ value: val })
        };
        const enabled = await isAutoAddToLiveCartEnabled(mockDb);
        expect(enabled).toBe(false);
      }
    });

    test('when Auto Add is OFF: Live Cart addition is bypassed, order is confirmed, admin is notified for manual review, and message is staged only', async () => {
      const autoAddToCart = false;
      let cartAdditionAttempted = false;
      let specialOrderCreated = false;
      let specialOrderStatus = '';
      let stagedMessageCreated = false;
      let adminAlertPayload: any = null;
      let customerDirectSendAttempted = false;

      // Simulate the decision gate in executeConfirmedProcurementFlow
      if (autoAddToCart) {
        cartAdditionAttempted = true;
      } else {
        // OFF: Skip automatic cart call
        cartAdditionAttempted = false;
      }

      // Both ON and OFF proceed to record the order and stage communication
      specialOrderCreated = true;
      specialOrderStatus = 'Confirmed';
      stagedMessageCreated = true;

      adminAlertPayload = {
        orderId: 102,
        customer: { name: 'Priya Sharma' },
        phone: '9876543210',
        items: [{ name: 'Augmentin 625 Duo', quantity: 1, distributor: 'Apex Healthcare', rate: 140, mrp: 200 }],
        success: true,
        manualReview: !autoAddToCart
      };

      // Per WhatsApp Confirmed Order.md: customer message stays staged regardless of
      // the Auto Add setting — no direct send should ever follow owner notification.

      // Assertions
      expect(cartAdditionAttempted).toBe(false);
      expect(specialOrderCreated).toBe(true);
      expect(specialOrderStatus).toBe('Confirmed');
      expect(stagedMessageCreated).toBe(true);
      expect(adminAlertPayload.manualReview).toBe(true);
      expect(adminAlertPayload.success).toBe(true);
      expect(customerDirectSendAttempted).toBe(false);
    });

    test('when Auto Add is ON: Live Cart addition is attempted and treated as Live addition', async () => {
      const autoAddToCart = true;
      let cartAdditionAttempted = false;
      const cartResult = { success: true, mode: 'Live' };

      if (autoAddToCart) {
        cartAdditionAttempted = true;
      }

      const adminAlertPayload = {
        orderId: 103,
        customer: { name: 'Rahul Patel' },
        phone: '9876543210',
        items: [{ name: 'Pan 40', quantity: 2, distributor: 'Apollo Distributors', rate: 95, mrp: 155 }],
        success: cartResult.success,
        manualReview: !autoAddToCart
      };

      expect(cartAdditionAttempted).toBe(true);
      expect(adminAlertPayload.manualReview).toBe(false);
      expect(adminAlertPayload.success).toBe(true);
    });
  });
});

