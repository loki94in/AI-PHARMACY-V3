import { http } from './client';

export interface PricingRule {
  id?: number;
  rule_type: 'DEFAULT' | 'CATEGORY' | 'PRODUCT' | 'STORE';
  target_id?: number | null;
  category_name?: string | null;
  margin_percent?: number;
  discount_percent?: number;
  custom_selling_price?: number | null;
  min_margin_percent?: number | null;
  is_active?: number;
}

export interface PricingCalculationResult {
  sellingPrice: number;
  mrp: number;
  discountAmount: number;
  discountPercent: number;
  appliedRuleType: string;
  marginPercent?: number;
}

export const pricingApi = {
  // Fetch active pricing rules
  getRules: () =>
    http.get<{ rules: PricingRule[] }>('/admin/pricing/rules'),

  // Save or update a pricing rule
  saveRule: (rule: PricingRule) =>
    http.post<{ ruleId: number; message: string }>('/admin/pricing/rules', rule),

  // Delete a pricing rule
  deleteRule: (id: number) =>
    http.delete<{ message: string }>(`/admin/pricing/rules/${id}`),

  // Test calculate price on arbitrary product
  calculatePrice: (input: { mrp: number; costPrice?: number; category?: string; medicineId?: number; storeId?: number }) =>
    http.post<PricingCalculationResult>('/admin/pricing/calculate', input),
};
