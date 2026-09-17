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
});
