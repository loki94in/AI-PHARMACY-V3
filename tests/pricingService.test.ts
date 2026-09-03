import { pricingService, PricingRule } from '../src/services/pricing/pricingService.js';
import { dbManager } from '../src/database/connection.js';

describe('PricingService Centralized Engine', () => {
  beforeAll(async () => {
    const db = await dbManager.getConnection();
    await db.run(`
      CREATE TABLE IF NOT EXISTS pricing_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_type TEXT NOT NULL,
        target_id INTEGER,
        category_name TEXT,
        margin_percent REAL DEFAULT 0,
        discount_percent REAL DEFAULT 0,
        custom_selling_price REAL,
        min_margin_percent REAL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(`DELETE FROM pricing_rules`);
    pricingService.invalidateCache();
  });

  afterEach(async () => {
    const db = await dbManager.getConnection();
    await db.run(`DELETE FROM pricing_rules`);
    pricingService.invalidateCache();
  });

  test('calculates standard MRP when no rules exist', async () => {
    const res = await pricingService.calculatePrice({
      mrp: 100,
      costPrice: 80,
      medicineId: 1
    });

    expect(res.mrp).toBe(100);
    expect(res.sellingPrice).toBe(100);
    expect(res.discountAmount).toBe(0);
    expect(res.appliedRuleType).toBe('STANDARD_MRP');
  });

  test('applies Product Override custom selling price correctly', async () => {
    await pricingService.saveRule({
      rule_type: 'PRODUCT',
      target_id: 101,
      custom_selling_price: 85.50
    });

    const res = await pricingService.calculatePrice({
      mrp: 100,
      medicineId: 101
    });

    expect(res.sellingPrice).toBe(85.50);
    expect(res.discountAmount).toBe(14.50);
    expect(res.appliedRuleType).toBe('PRODUCT_OVERRIDE');
  });

  test('applies Category Discount correctly', async () => {
    await pricingService.saveRule({
      rule_type: 'CATEGORY',
      category_name: 'Antibiotics',
      discount_percent: 15
    });

    const res = await pricingService.calculatePrice({
      mrp: 200,
      category: 'Antibiotics'
    });

    expect(res.sellingPrice).toBe(170);
    expect(res.discountAmount).toBe(30);
    expect(res.discountPercent).toBe(15);
    expect(res.appliedRuleType).toBe('CATEGORY_DISCOUNT');
  });

  test('applies Default Discount when no specific category or product matches', async () => {
    await pricingService.saveRule({
      rule_type: 'DEFAULT',
      discount_percent: 10
    });

    const res = await pricingService.calculatePrice({
      mrp: 50,
      category: 'General'
    });

    expect(res.sellingPrice).toBe(45);
    expect(res.discountAmount).toBe(5);
    expect(res.discountPercent).toBe(10);
    expect(res.appliedRuleType).toBe('DEFAULT_DISCOUNT');
  });

  test('handles zero or invalid MRP safely', async () => {
    const res = await pricingService.calculatePrice({
      mrp: 0,
      costPrice: 40
    });

    expect(res.sellingPrice).toBe(40);
    expect(res.appliedRuleType).toBe('ZERO_MRP');
  });
});
