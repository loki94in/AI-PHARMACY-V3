import { dbManager } from '../database/connection.js';

export interface DistributorRecommendationItem {
  distributorId: number;
  distributorName: string;
  phone?: string;
  score: number; // 0 to 100
  estimatedPrice: number;
  estimatedMargin: number; // percentage (e.g. 20.5)
  estimatedDeliveryHours: number;
  availability: 'IN_STOCK' | 'LIKELY' | 'UNKNOWN';
  badges: string[];
  reason: string;
}

export interface RecommendationResult {
  medicineId?: number;
  medicineName: string;
  mrp: number;
  requestedQty: number;
  localInventory: {
    inStock: boolean;
    availableQty: number;
    recommendedAction: 'FULFILL_LOCALLY' | 'ORDER_FROM_DISTRIBUTOR';
  };
  recommendations: DistributorRecommendationItem[];
}

/**
 * Computes multi-distributor score based on margin, purchase history, and stock health.
 * Adheres to MULTI-PHARMACY.md §14 and §15.
 */
export function calculateDistributorScore(params: {
  distributorId: number;
  distributorName: string;
  ptr: number;
  mrp: number;
  currentStock?: number;
  purchaseCount?: number;
  lastPurchaseDaysAgo?: number;
}): {
  score: number;
  marginPercent: number;
  marginPoints: number;
  frequencyPoints: number;
  stockFactor: number;
} {
  const effectiveMrp = params.mrp || (params.ptr > 0 ? Math.round(params.ptr * 1.25) : 100);
  const marginPercent = effectiveMrp > params.ptr && effectiveMrp > 0
    ? Math.round(((effectiveMrp - params.ptr) / effectiveMrp) * 1000) / 10
    : 15.0;

  const marginPoints = Math.min(Math.round((marginPercent / 25) * 35), 35);
  const frequencyPoints = Math.min(Number(params.purchaseCount || 1) * 5, 20);
  const stockFactor = (params.currentStock ?? 0) > 0 ? 10 : 0;
  const baseAvailability = 25;
  const deliveryPoints = 10;

  const score = Math.min(
    Math.max(marginPoints + frequencyPoints + stockFactor + baseAvailability + deliveryPoints, 40),
    98
  );

  return {
    score,
    marginPercent,
    marginPoints,
    frequencyPoints,
    stockFactor
  };
}

export class DistributorRecommendationService {
  /**
   * Calculates intelligent distributor recommendations for a medicine.
   * Conforms to MULTI-PHARMACY.md §14 and §15.
   */
  async recommendDistributor(params: {
    medicineId?: number;
    medicineName?: string;
    requestedQty?: number;
    storeId?: number;
  }): Promise<RecommendationResult> {
    const db = await dbManager.getConnection();
    const storeId = params.storeId || 1;
    const requestedQty = params.requestedQty && params.requestedQty > 0 ? params.requestedQty : 1;

    let targetMedId = params.medicineId;
    let targetMedName = (params.medicineName || '').trim();
    let mrp = 0;

    // Resolve medicine if needed
    if (targetMedId) {
      const medRow = await db.get('SELECT id, name, mrp FROM medicines WHERE id = ?', [targetMedId]);
      if (medRow) {
        targetMedName = medRow.name;
        mrp = Number(medRow.mrp || 0);
      }
    } else if (targetMedName) {
      const medRow = await db.get(
        'SELECT id, name, mrp FROM medicines WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1',
        [targetMedName]
      );
      if (medRow) {
        targetMedId = medRow.id;
        targetMedName = medRow.name;
        mrp = Number(medRow.mrp || 0);
      }
    }

    // 1. Check local inventory in requesting store
    let localQty = 0;
    if (targetMedId) {
      const stockRow = await db.get(
        `SELECT IFNULL(SUM(quantity), 0) as qty, IFNULL(SUM(loose_quantity), 0) as lqty, MAX(mrp) as stock_mrp
         FROM inventory_master 
         WHERE medicine_id = ? AND (store_id = ? OR (store_id IS NULL AND ? = 1)) AND COALESCE(is_active, 1) = 1`,
        [targetMedId, storeId, storeId]
      );
      localQty = Number(stockRow?.qty || 0);
      if (!mrp && stockRow?.stock_mrp) mrp = Number(stockRow.stock_mrp);
    }

    const inStock = localQty >= requestedQty;
    const recommendedAction = inStock ? 'FULFILL_LOCALLY' : 'ORDER_FROM_DISTRIBUTOR';

    // 2. Fetch distributor purchase history & catalog data
    // Query past purchases for this medicine to determine recent PTR, margins, and purchase frequency
    const purchaseDistributorStats = await db.all(
      `SELECT d.id as distributor_id, d.name as distributor_name, d.phone,
              COUNT(p.id) as purchase_frequency,
              AVG(pi.rate) as avg_ptr,
              MAX(pi.rate) as max_ptr,
              MIN(pi.rate) as min_ptr,
              MAX(p.date) as last_purchased_date
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id
       JOIN distributors d ON d.id = p.distributor_id
       WHERE (pi.medicine_id = ? OR LOWER(TRIM(pi.item_name)) = LOWER(TRIM(?)))
         AND (p.store_id = ? OR (p.store_id IS NULL AND ? = 1))
       GROUP BY d.id, d.name, d.phone
       ORDER BY purchase_frequency DESC LIMIT 10`,
      [targetMedId || -1, targetMedName, storeId, storeId]
    ).catch(() => []);

    // Also check all active distributors as fallback
    const allDistributors = await db.all(
      'SELECT id, name, phone, address FROM distributors ORDER BY name ASC LIMIT 20'
    ).catch(() => []);

    const recommendationsMap = new Map<number, DistributorRecommendationItem>();

    // Process distributors with known purchase history for this product
    for (const stat of purchaseDistributorStats) {
      const estimatedPrice = Number(stat.min_ptr || stat.avg_ptr || 0);
      const effectiveMrp = mrp || (estimatedPrice > 0 ? Math.round(estimatedPrice * 1.25) : 100);
      const estimatedMargin = effectiveMrp > estimatedPrice && effectiveMrp > 0
        ? Math.round(((effectiveMrp - estimatedPrice) / effectiveMrp) * 1000) / 10
        : 15.0;

      // Score calculation:
      // - Base availability score: 35 points (has supplied recently)
      // - Margin score: up to 35 points (35 * margin / 30 capped at 35)
      // - Reliability score: up to 20 points (frequency)
      // - Delivery score: 10 points
      const marginPoints = Math.min(Math.round((estimatedMargin / 25) * 35), 35);
      const frequencyPoints = Math.min(Number(stat.purchase_frequency || 1) * 5, 20);
      const availabilityPoints = 35;
      const deliveryPoints = 10;
      const totalScore = Math.min(Math.max(marginPoints + frequencyPoints + availabilityPoints + deliveryPoints, 40), 98);

      const badges: string[] = [];
      if (estimatedMargin >= 20) badges.push(`High Margin (${estimatedMargin}%)`);
      if (stat.purchase_frequency >= 3) badges.push('Preferred Supplier');
      badges.push('Verified History');

      recommendationsMap.set(stat.distributor_id, {
        distributorId: stat.distributor_id,
        distributorName: stat.distributor_name,
        phone: stat.phone || '',
        score: totalScore,
        estimatedPrice,
        estimatedMargin,
        estimatedDeliveryHours: 4,
        availability: 'IN_STOCK',
        badges,
        reason: `Supplied ${stat.purchase_frequency} times recently with ~${estimatedMargin}% margin`
      });
    }

    // Add other active distributors with default baseline scores
    for (const dist of allDistributors) {
      if (!recommendationsMap.has(dist.id)) {
        const baselinePrice = mrp > 0 ? Math.round(mrp * 0.8) : 0;
        const baselineMargin = mrp > 0 ? 20.0 : 15.0;
        recommendationsMap.set(dist.id, {
          distributorId: dist.id,
          distributorName: dist.name,
          phone: dist.phone || '',
          score: 50,
          estimatedPrice: baselinePrice,
          estimatedMargin: baselineMargin,
          estimatedDeliveryHours: 12,
          availability: 'LIKELY',
          badges: ['Alternative Supplier'],
          reason: 'Active distributor available for inquiry'
        });
      }
    }

    // Sort by score descending
    const recommendations = Array.from(recommendationsMap.values()).sort((a, b) => b.score - a.score);

    return {
      medicineId: targetMedId,
      medicineName: targetMedName || 'Medicine',
      mrp,
      requestedQty,
      localInventory: {
        inStock,
        availableQty: localQty,
        recommendedAction
      },
      recommendations
    };
  }
}

export const distributorRecommendationService = new DistributorRecommendationService();
