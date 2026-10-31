import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { isDistributorStockAdequate, DEFAULT_MIN_DISTRIBUTOR_STOCK_THRESHOLD, addItemsToPharmarackCart, rankSpecialOrderDistributorCandidates } from '../src/routes/pharmarack.js';
import { getMinDistributorStockThreshold, saveMinDistributorStockThreshold } from '../src/services/storeSettingsService.js';
import { dbManager } from '../src/database/connection.js';

describe('Distributor Stock Threshold (Auto-Skip < 15)', () => {
  describe('isDistributorStockAdequate unit checks', () => {
    test('default threshold is 15', () => {
      expect(DEFAULT_MIN_DISTRIBUTOR_STOCK_THRESHOLD).toBe(15);
    });

    test('rejects numeric stock below 15', () => {
      expect(isDistributorStockAdequate(0)).toBe(false);
      expect(isDistributorStockAdequate(1)).toBe(false);
      expect(isDistributorStockAdequate(5)).toBe(false);
      expect(isDistributorStockAdequate(14)).toBe(false);
      expect(isDistributorStockAdequate(-3)).toBe(false);
    });

    test('accepts numeric stock equal to or above 15', () => {
      expect(isDistributorStockAdequate(15)).toBe(true);
      expect(isDistributorStockAdequate(16)).toBe(true);
      expect(isDistributorStockAdequate(50)).toBe(true);
      expect(isDistributorStockAdequate(1000)).toBe(true);
    });

    test('rejects string numeric stock below 15 and low-stock terms', () => {
      expect(isDistributorStockAdequate('0')).toBe(false);
      expect(isDistributorStockAdequate('5')).toBe(false);
      expect(isDistributorStockAdequate('14')).toBe(false);
      expect(isDistributorStockAdequate('<15')).toBe(false);
      expect(isDistributorStockAdequate('low')).toBe(false);
      expect(isDistributorStockAdequate('Low')).toBe(false);
      expect(isDistributorStockAdequate('out of stock')).toBe(false);
      expect(isDistributorStockAdequate('oos')).toBe(false);
      expect(isDistributorStockAdequate('nil')).toBe(false);
      expect(isDistributorStockAdequate('unavailable')).toBe(false);
    });

    test('accepts string numeric stock >= 15 and abundant availability indicators', () => {
      expect(isDistributorStockAdequate('15')).toBe(true);
      expect(isDistributorStockAdequate('20')).toBe(true);
      expect(isDistributorStockAdequate('>20')).toBe(true);
      expect(isDistributorStockAdequate('High')).toBe(true);
      expect(isDistributorStockAdequate('In Stock')).toBe(true);
      expect(isDistributorStockAdequate('Available')).toBe(true);
    });

    test('rejects empty, null, and undefined values', () => {
      expect(isDistributorStockAdequate(null)).toBe(false);
      expect(isDistributorStockAdequate(undefined)).toBe(false);
      expect(isDistributorStockAdequate('')).toBe(false);
    });

    test('supports custom threshold argument', () => {
      expect(isDistributorStockAdequate(10, 10)).toBe(true);
      expect(isDistributorStockAdequate(9, 10)).toBe(false);
      expect(isDistributorStockAdequate(20, 25)).toBe(false);
      expect(isDistributorStockAdequate(25, 25)).toBe(true);
    });
  });

  describe('rankSpecialOrderDistributorCandidates stock filtering', () => {
    test('filters out candidates with stock below 15', async () => {
      const candidates = [
        { storeId: 1, distributor: 'Distributor A', stock: '10', rate: 100 },
        { storeId: 2, distributor: 'Distributor B', stock: '25', rate: 105 },
        { storeId: 3, distributor: 'Distributor C', stock: '5', rate: 95 }
      ];

      const ranked = await rankSpecialOrderDistributorCandidates(null, candidates, 10);
      expect(ranked.length).toBe(1);
      expect(ranked[0].distributor).toBe('Distributor B');
    });

    test('returns empty if all candidates have stock below 15', async () => {
      const candidates = [
        { storeId: 1, distributor: 'Distributor A', stock: '14', rate: 100 },
        { storeId: 2, distributor: 'Distributor B', stock: '0', rate: 105 }
      ];

      const ranked = await rankSpecialOrderDistributorCandidates(null, candidates, 10);
      expect(ranked).toEqual([]);
    });
  });

  describe('addItemsToPharmarackCart stock check', () => {
    test('auto-skips item when distributor stock is explicitly below 15', async () => {
      const res = await addItemsToPharmarackCart([{
        productName: 'PARACETAMOL 500',
        productId: 101,
        productCode: 'PARA-1',
        storeId: 55,
        storeName: 'Test Distributor',
        stock: '12',
        qty: 1
      }]);

      expect(res.success).toBe(false);
      expect(res.reason).toBe('LOW_STOCK');
      expect(res.error).toMatch(/below safety threshold/);
    });

    test('bypasses stock check when skipStockCheck: true is passed', async () => {
      const res = await addItemsToPharmarackCart([{
        productName: 'PARACETAMOL 500',
        productId: 101,
        productCode: 'PARA-1',
        storeId: 55,
        storeName: 'Test Distributor',
        stock: '12',
        qty: 1,
        skipStockCheck: true
      }]);

      // When skipStockCheck is true, it does not fail with LOW_STOCK (it proceeds to token check)
      expect(res.reason).not.toBe('LOW_STOCK');
    });
  });

  describe('Store Settings threshold persistence', () => {
    test('reads default 15 when not configured or invalid', async () => {
      const mockDb = {
        get: async () => null
      };
      const val = await getMinDistributorStockThreshold(mockDb);
      expect(val).toBe(15);
    });

    test('reads stored custom threshold correctly', async () => {
      const mockDb = {
        get: async () => ({ value: '25' })
      };
      const val = await getMinDistributorStockThreshold(mockDb);
      expect(val).toBe(25);
    });

    test('saves threshold via saveMinDistributorStockThreshold', async () => {
      let savedKey = '';
      let savedVal = '';
      const mockDb = {
        run: async (_sql: string, params: any[]) => {
          savedVal = params[0];
        }
      };
      await saveMinDistributorStockThreshold(20, mockDb);
      expect(savedVal).toBe('20');
    });
  });
});
