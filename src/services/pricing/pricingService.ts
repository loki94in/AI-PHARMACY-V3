import { dbManager } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

export interface PricingRule {
  id?: number;
  rule_type: 'DEFAULT' | 'CATEGORY' | 'PRODUCT' | 'STORE';
  target_id?: number | null;       // medicine_id or store_id
  category_name?: string | null;
  margin_percent?: number;
  discount_percent?: number;
  custom_selling_price?: number | null;
  min_margin_percent?: number | null;
  is_active?: number;
  created_at?: string;
  updated_at?: string;
}

export interface PricingCalculationInput {
  mrp: number;
  costPrice?: number | null;
  category?: string | null;
  medicineId?: number | null;
  storeId?: number | null;
}

export interface PricingCalculationResult {
  sellingPrice: number;
  mrp: number;
  discountAmount: number;
  discountPercent: number;
  appliedRuleType: string;
  marginPercent?: number;
}

class PricingService {
  private rulesCache: PricingRule[] | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 60 * 1000; // 1 minute local cache

  /**
   * Invalidate cached pricing rules
   */
  invalidateCache(): void {
    this.rulesCache = null;
    this.cacheExpiry = 0;
  }

  /**
   * Fetch all active pricing rules
   */
  async getActiveRules(): Promise<PricingRule[]> {
    const now = Date.now();
    if (this.rulesCache && now < this.cacheExpiry) {
      return this.rulesCache;
    }

    try {
      const db = await dbManager.getConnection();
      const rules = await db.all<PricingRule[]>(
        `SELECT * FROM pricing_rules WHERE is_active = 1 ORDER BY id ASC`
      );
      this.rulesCache = rules || [];
      this.cacheExpiry = now + this.CACHE_TTL_MS;
      return this.rulesCache;
    } catch (err) {
      logger.error('Failed to load pricing rules', err, { module: 'PricingService' });
      return [];
    }
  }

  /**
   * Core centralized price calculation
   */
  async calculatePrice(input: PricingCalculationInput): Promise<PricingCalculationResult> {
    const mrp = Number(input.mrp) || 0;
    const costPrice = input.costPrice !== undefined && input.costPrice !== null ? Number(input.costPrice) : null;
    const category = (input.category || '').trim().toLowerCase();
    const medicineId = input.medicineId ? Number(input.medicineId) : null;
    const storeId = input.storeId ? Number(input.storeId) : null;

    // Zero or negative MRP fallback
    if (mrp <= 0) {
      return {
        sellingPrice: costPrice && costPrice > 0 ? costPrice : 0,
        mrp: 0,
        discountAmount: 0,
        discountPercent: 0,
        appliedRuleType: 'ZERO_MRP'
      };
    }

    const rules = await this.getActiveRules();

    // 1. Priority 1: Product Override
    if (medicineId) {
      const productRule = rules.find(
        r => r.rule_type === 'PRODUCT' && Number(r.target_id) === medicineId
      );
      if (productRule) {
        if (productRule.custom_selling_price !== null && productRule.custom_selling_price !== undefined && productRule.custom_selling_price > 0) {
          const finalPrice = Math.min(mrp, Math.round(productRule.custom_selling_price * 100) / 100);
          return {
            sellingPrice: finalPrice,
            mrp,
            discountAmount: Math.max(0, Math.round((mrp - finalPrice) * 100) / 100),
            discountPercent: Math.round(((mrp - finalPrice) / mrp) * 10000) / 100,
            appliedRuleType: 'PRODUCT_OVERRIDE'
          };
        }
        if (productRule.discount_percent && productRule.discount_percent > 0) {
          const disc = (mrp * productRule.discount_percent) / 100;
          const finalPrice = Math.max(0, Math.round((mrp - disc) * 100) / 100);
          return {
            sellingPrice: finalPrice,
            mrp,
            discountAmount: Math.round(disc * 100) / 100,
            discountPercent: productRule.discount_percent,
            appliedRuleType: 'PRODUCT_DISCOUNT'
          };
        }
      }
    }

    // 2. Priority 2: Category Rule
    if (category) {
      const catRule = rules.find(
        r => r.rule_type === 'CATEGORY' && (r.category_name || '').trim().toLowerCase() === category
      );
      if (catRule) {
        if (catRule.discount_percent && catRule.discount_percent > 0) {
          const disc = (mrp * catRule.discount_percent) / 100;
          const finalPrice = Math.max(0, Math.round((mrp - disc) * 100) / 100);
          return {
            sellingPrice: finalPrice,
            mrp,
            discountAmount: Math.round(disc * 100) / 100,
            discountPercent: catRule.discount_percent,
            appliedRuleType: 'CATEGORY_DISCOUNT'
          };
        }
        if (costPrice && costPrice > 0 && catRule.margin_percent && catRule.margin_percent > 0) {
          const marginVal = (costPrice * catRule.margin_percent) / 100;
          const finalPrice = Math.min(mrp, Math.round((costPrice + marginVal) * 100) / 100);
          return {
            sellingPrice: finalPrice,
            mrp,
            discountAmount: Math.max(0, Math.round((mrp - finalPrice) * 100) / 100),
            discountPercent: Math.round(((mrp - finalPrice) / mrp) * 10000) / 100,
            appliedRuleType: 'CATEGORY_MARGIN',
            marginPercent: catRule.margin_percent
          };
        }
      }
    }

    // 3. Priority 3: Store Override
    if (storeId) {
      const storeRule = rules.find(
        r => r.rule_type === 'STORE' && Number(r.target_id) === storeId
      );
      if (storeRule && storeRule.discount_percent && storeRule.discount_percent > 0) {
        const disc = (mrp * storeRule.discount_percent) / 100;
        const finalPrice = Math.max(0, Math.round((mrp - disc) * 100) / 100);
        return {
          sellingPrice: finalPrice,
          mrp,
          discountAmount: Math.round(disc * 100) / 100,
          discountPercent: storeRule.discount_percent,
          appliedRuleType: 'STORE_DISCOUNT'
        };
      }
    }

    // 4. Priority 4: Default System Rule
    const defaultRule = rules.find(r => r.rule_type === 'DEFAULT');
    if (defaultRule) {
      if (defaultRule.discount_percent && defaultRule.discount_percent > 0) {
        const disc = (mrp * defaultRule.discount_percent) / 100;
        const finalPrice = Math.max(0, Math.round((mrp - disc) * 100) / 100);
        return {
          sellingPrice: finalPrice,
          mrp,
          discountAmount: Math.round(disc * 100) / 100,
          discountPercent: defaultRule.discount_percent,
          appliedRuleType: 'DEFAULT_DISCOUNT'
        };
      }
      if (costPrice && costPrice > 0 && defaultRule.margin_percent && defaultRule.margin_percent > 0) {
        const marginVal = (costPrice * defaultRule.margin_percent) / 100;
        const finalPrice = Math.min(mrp, Math.round((costPrice + marginVal) * 100) / 100);
        return {
          sellingPrice: finalPrice,
          mrp,
          discountAmount: Math.max(0, Math.round((mrp - finalPrice) * 100) / 100),
          discountPercent: Math.round(((mrp - finalPrice) / mrp) * 10000) / 100,
          appliedRuleType: 'DEFAULT_MARGIN',
          marginPercent: defaultRule.margin_percent
        };
      }
    }

    // Standard Fallback: Standard MRP or modest 5% retail discount if no rules defined
    return {
      sellingPrice: mrp,
      mrp,
      discountAmount: 0,
      discountPercent: 0,
      appliedRuleType: 'STANDARD_MRP'
    };
  }

  /**
   * Save or update a pricing rule
   */
  async saveRule(rule: PricingRule): Promise<number> {
    const db = await dbManager.getConnection();
    let id = rule.id;

    if (id) {
      await db.run(
        `UPDATE pricing_rules 
         SET rule_type = ?, target_id = ?, category_name = ?, margin_percent = ?, 
             discount_percent = ?, custom_selling_price = ?, min_margin_percent = ?, 
             is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          rule.rule_type,
          rule.target_id ?? null,
          rule.category_name ?? null,
          rule.margin_percent ?? 0,
          rule.discount_percent ?? 0,
          rule.custom_selling_price ?? null,
          rule.min_margin_percent ?? null,
          rule.is_active ?? 1,
          id
        ]
      );
    } else {
      const res = await db.run(
        `INSERT INTO pricing_rules (
           rule_type, target_id, category_name, margin_percent, discount_percent, 
           custom_selling_price, min_margin_percent, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rule.rule_type,
          rule.target_id ?? null,
          rule.category_name ?? null,
          rule.margin_percent ?? 0,
          rule.discount_percent ?? 0,
          rule.custom_selling_price ?? null,
          rule.min_margin_percent ?? null,
          rule.is_active ?? 1
        ]
      );
      id = res.lastID;
    }

    this.invalidateCache();
    return id!;
  }

  /**
   * Delete or deactivate a pricing rule
   */
  async deleteRule(id: number): Promise<void> {
    const db = await dbManager.getConnection();
    await db.run(`DELETE FROM pricing_rules WHERE id = ?`, id);
    this.invalidateCache();
  }
}

export const pricingService = new PricingService();
