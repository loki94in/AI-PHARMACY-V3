import type { CompactInventoryItem } from '../services/api';
import { getExpiryMonthKey, getExpirySortTimestamp, isExpiredDate } from './date';
import { detectPackSize } from './packSizeDetector';

export interface PosAllocatorCartRow {
  id: number | string;
  medicine_id?: number | string;
  inventory_id?: number | string;
  name?: string;
  medicine_name?: string;
  batch?: string;
  batch_no?: string;
  batch_number?: string;
  expiry?: string;
  expiry_date?: string;
  mrp?: number;
  item_mrp?: number | string;
  sell_price?: number | string | null;
  unit_price?: number;
  unitPrice?: number;
  cost_price?: number | null;
  costPrice?: number | null;
  qty?: number;
  quantity?: number;
  looseQty?: number;
  loose_qty?: number;
  loose_quantity?: number;
  discount?: number;
  discount_per?: number;
  discountPer?: number;
  packSize?: number;
  pack_size?: number | null;
  pack_unit?: string | null;
  packUnit?: string | null;
  packMismatchDismissed?: boolean;
  gst_percent?: number;
  stock_qty?: number;
  availableStock?: number;
  availableLooseStock?: number;
  salts?: string;
  isEmptyRow?: boolean;
  allow_loose_sale?: number | boolean;
  manualBatchSelected?: boolean;
  alternative_batches?: unknown[];
  alternatives?: unknown[];
  scanImage?: string;
  rawOcrText?: string;
  hsn_code?: string;
  api_reference?: string;
  manufacturer?: string;
  packaging?: string | null;
  is_out_of_stock?: boolean;
  batch_quantity?: number;
  gst?: number | string;
  tax_percent?: number | string;
  item_code?: string;
  short_code?: string;
  therapeutic?: string;
  sub_therapeutic?: string;
  originalQty?: number;
  originalLooseQty?: number;
  [key: string]: unknown;
}

export interface AllocateMedicineBatchesParams {
  medicineId: number;
  medicineName: string;
  requestedQty: number;
  requestedLooseQty: number;
  packSize?: number;
  fallbackItem?: Partial<PosAllocatorCartRow>;
  compactInventory: CompactInventoryItem[];
  editingInvoiceId?: number | null;
  priorityBatchNo?: string;
  priorityInventoryId?: number | string;
  /** Only honor priorityBatchNo/priorityInventoryId when explicitly pinned (invoice edit, manual Switch Batch, or batch barcode scan). */
  respectPriorityBatch?: boolean;
  onNotify?: (message: string, type: 'info' | 'error') => void;
}

export const normMedKey = (n: unknown): string =>
  String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * FEFO rank string: canonical YYYY-MM expiry comes FIRST so earliest expiry always wins,
 * then strip/loose availability breaks ties within the same expiry month.
 */
export const fefoRank = (stripQty: number, exp?: string | null, looseQty: number = 0): string => {
  const expKey = getExpiryMonthKey(exp);
  const stockTier = Number(stripQty) > 0 ? 0 : (Number(looseQty) > 0 ? 1 : 2);
  return `${expKey}|${stockTier}`;
};

export const parsePackSizeFromPackaging = (packaging: string | null | undefined): number | null => {
  if (!packaging) return null;
  const trimmed = packaging.trim();
  if (/\b(?:ml|gm|gms|mg|kg|ltr|litre)\b/i.test(trimmed)) {
    return 1;
  }
  const stripOfMatch = trimmed.match(/^\s*(?:STRIP|PACK|BOX|BLISTER)\s+OF\s+(\d+)/i);
  if (stripOfMatch) {
    const size = parseInt(stripOfMatch[1], 10);
    if (size > 0) return size;
  }
  const bottleOfMatch = trimmed.match(/^\s*BOTTLE\s+OF\s+(\d+)/i);
  if (bottleOfMatch) {
    const size = parseInt(bottleOfMatch[1], 10);
    if (size > 0) return size;
  }
  if (/\b\d+\s*x\s*\d+\b/i.test(trimmed)) {
    const parts = trimmed.split(/x/i);
    return (parseInt(parts[0], 10) || 1) * (parseInt(parts[1], 10) || 1);
  }
  const match = trimmed.match(/^(\d+)/);
  if (!match) return null;
  const size = parseInt(match[1], 10);
  return size > 0 ? size : null;
};

export const isLiquidOrSingleUnitForm = (name?: string, packaging?: string | null): boolean => {
  const combined = `${packaging || ''} ${name || ''}`.toLowerCase();
  return /bottle|syrup|syp|suspension|susp|drop|inj|liquid|lotion|spray|ointment|oint|gel|cream|\bml\b|respule|sachet|vial|amp/i.test(combined);
};

export const resolveAllowLooseSale = (
  item?: {
    allow_loose_sale?: number | boolean | null;
    name?: string;
    medicine_name?: string;
    packaging?: string | null;
    packSize?: number | null;
    pack_size?: number | null;
  } | null
): number => {
  if (!item) return 1;
  if (isLiquidOrSingleUnitForm(item.name || item.medicine_name, item.packaging)) return 0;
  const rawPack = item.packSize ?? item.pack_size;
  let pSize = 0;
  if (rawPack !== undefined && rawPack !== null && Number(rawPack) > 0) {
    pSize = Number(rawPack);
  } else if (item.packaging) {
    pSize = parsePackSizeFromPackaging(item.packaging) || 0;
  }
  if (pSize <= 0) {
    const det = detectPackSize(item.name || item.medicine_name, item.packaging);
    pSize = det.detectedPackSize || 1;
  }
  if (pSize <= 1) return 0;
  if (item.allow_loose_sale !== undefined && item.allow_loose_sale !== null) {
    return item.allow_loose_sale ? 1 : 0;
  }
  return 1;
};

/**
 * Universal FEFO Batch Allocator:
 * Distributes requested quantity across active unexpired batches strictly earliest-expiry-first,
 * creating one row per batch when demand exceeds a single batch's remaining stock.
 */
export function allocateMedicineBatches(params: AllocateMedicineBatchesParams): PosAllocatorCartRow[] {
  const { medicineId, medicineName, compactInventory, editingInvoiceId, requestedQty, requestedLooseQty } = params;
  const pSize = Math.max(1, params.packSize || params.fallbackItem?.packSize || params.fallbackItem?.pack_size || 1);
  const totalRequestedTablets = (requestedQty * pSize) + (requestedLooseQty || 0);

  const targetNormName = normMedKey(medicineName);

  const isPinnedBatch = (item: CompactInventoryItem): boolean => Boolean(
    (params.priorityInventoryId !== undefined && String(item.inventory_id || item.id) === String(params.priorityInventoryId)) ||
    (params.priorityBatchNo && item.batch_no === params.priorityBatchNo)
  );

  // 1. Find all active unexpired batches for this medicine
  const activeBatches = (compactInventory || [])
    .filter(item => {
      const itemNorm = normMedKey(item.medicine_name || item.name);
      const idMatch = medicineId > 0 && (
        Number(item.medicine_id) === Number(medicineId) ||
        Number(item.id) === Number(medicineId) ||
        Number(item.inventory_id) === Number(medicineId)
      );
      const nameMatch = Boolean(targetNormName && itemNorm && itemNorm === targetNormName);
      const isEditingThisBatch = Boolean(editingInvoiceId && isPinnedBatch(item));
      const hasStock = ((item.stock_qty !== undefined ? item.stock_qty : item.quantity) || 0) > 0 || (item.loose_quantity || 0) > 0 || isEditingThisBatch;
      return (idMatch || nameMatch) && hasStock;
    })
    .map(item => {
      const isEditingThisBatch = Boolean(editingInvoiceId && isPinnedBatch(item));
      const isExpired = !isEditingThisBatch && isExpiredDate(item.expiry_date);
      const heldStock = isEditingThisBatch ? Number(params.fallbackItem?.originalQty || params.fallbackItem?.quantity || params.fallbackItem?.qty || 0) : 0;
      const heldLoose = isEditingThisBatch ? Number(params.fallbackItem?.originalLooseQty || params.fallbackItem?.loose_qty || params.fallbackItem?.looseQty || 0) : 0;
      return {
        ...item,
        stock_qty: (item.stock_qty !== undefined ? item.stock_qty : (item.quantity || 0)) + heldStock,
        loose_quantity: (item.loose_quantity || 0) + heldLoose,
        isExpired
      };
    })
    .filter(item => !item.isExpired);

  // 2. If no active batches in inventory cache, fall back to fallback item or single row
  if (activeBatches.length === 0) {
    if (editingInvoiceId || params.fallbackItem) {
      const refItem = params.fallbackItem || {};
      return [{
        ...refItem,
        id: refItem.inventory_id || refItem.id || `item_${medicineId}_${Date.now()}`,
        inventory_id: refItem.inventory_id || (typeof refItem.id === 'number' && refItem.id < 1000000000 ? refItem.id : undefined),
        medicine_id: medicineId || refItem.medicine_id,
        name: medicineName || refItem.name,
        medicine_name: medicineName || refItem.name,
        batch: refItem.batch || refItem.batch_no || '',
        batch_no: refItem.batch_no || refItem.batch || '',
        expiry: refItem.expiry || refItem.expiry_date || '',
        expiry_date: refItem.expiry_date || refItem.expiry || '',
        qty: requestedQty,
        quantity: requestedQty,
        looseQty: requestedLooseQty,
        mrp: Number(refItem.mrp || 0),
        sell_price: refItem.sell_price || null,
        unitPrice: Number(refItem.unitPrice || refItem.unit_price || refItem.sell_price || refItem.mrp || 0),
        discount: Number(refItem.discount || 0),
        packSize: pSize,
        pack_size: pSize,
        pack_unit: refItem.pack_unit || params.fallbackItem?.pack_unit || null,
        packaging: refItem.packaging || params.fallbackItem?.packaging || null,
        allow_loose_sale: resolveAllowLooseSale({
          allow_loose_sale: refItem.allow_loose_sale as number | boolean | null | undefined,
          name: medicineName || refItem.name,
          packaging: refItem.packaging || params.fallbackItem?.packaging,
          packSize: pSize,
          pack_size: pSize
        }),
        availableStock: Number(refItem.availableStock || refItem.stock_qty || 0),
        availableLooseStock: Number(refItem.availableLooseStock || refItem.loose_quantity || 0),
        alternative_batches: [],
        isEmptyRow: false
      }];
    }
    return [];
  }

  // 3. Sort active batches strictly by FEFO:
  // - Only honor priorityBatch when explicitly pinned (editing an invoice, manual Switch Batch, or batch barcode scan).
  // - Otherwise, earliest expiry timestamp ALWAYS comes first (near-expiry priority).
  // - Within the SAME expiry month, break ties by open loose stock (for loose-only) or full strips.
  const honorPriority = Boolean((editingInvoiceId || params.respectPriorityBatch) && (params.priorityBatchNo || params.priorityInventoryId));
  activeBatches.sort((a, b) => {
    if (honorPriority) {
      const aMatch = isPinnedBatch(a);
      const bMatch = isPinnedBatch(b);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
    }

    const aTime = getExpirySortTimestamp(a.expiry_date);
    const bTime = getExpirySortTimestamp(b.expiry_date);
    if (aTime !== bTime) return aTime - bTime;

    if (requestedLooseQty > 0 && requestedQty === 0) {
      const aHasLoose = (a.loose_quantity || 0) > 0 ? 0 : 1;
      const bHasLoose = (b.loose_quantity || 0) > 0 ? 0 : 1;
      if (aHasLoose !== bHasLoose) return aHasLoose - bHasLoose;
    } else {
      const aHasStrips = (a.stock_qty || 0) > 0 ? 0 : 1;
      const bHasStrips = (b.stock_qty || 0) > 0 ? 0 : 1;
      if (aHasStrips !== bHasStrips) return aHasStrips - bHasStrips;
    }

    return (a.inventory_id || a.id || 0) - (b.inventory_id || b.id || 0);
  });

  // 4. Distribute the requested quantity across batches in FEFO order (one row per batch)
  let remainingTablets = totalRequestedTablets;
  const allocations: PosAllocatorCartRow[] = [];
  let totalAvailableTablets = 0;

  for (const batch of activeBatches) {
    const batchStockTablets = (batch.stock_qty || 0) * pSize + (batch.loose_quantity || 0);
    totalAvailableTablets += batchStockTablets;

    if (remainingTablets > 0 && batchStockTablets > 0) {
      const takenTablets = Math.min(remainingTablets, batchStockTablets);
      const qty = Math.floor(takenTablets / pSize);
      const looseQty = takenTablets % pSize;

      if (qty > 0 || looseQty > 0) {
        const sellPrice = batch.sell_price !== undefined && batch.sell_price !== null
          ? batch.sell_price
          : (params.fallbackItem?.sell_price || null);
        const mrp = Number(batch.mrp || params.fallbackItem?.mrp || 0);
        const sameMrpAsFallback = Boolean(
          params.fallbackItem?.mrp && mrp > 0 && Math.abs(Number(params.fallbackItem.mrp) - mrp) < 0.05
        );
        let discount = params.fallbackItem?.discount;
        if ((discount === undefined || discount === 0) && sellPrice && Number(sellPrice) > 0 && mrp > 0 && Number(sellPrice) < mrp) {
          discount = parseFloat((((mrp - Number(sellPrice)) / mrp) * 100).toFixed(2));
        }
        const batchUnitPrice = batch.unit_price && Number(batch.unit_price) > 0 ? Number(batch.unit_price) : 0;
        const unitPrice = sameMrpAsFallback && params.fallbackItem?.unitPrice && Number(params.fallbackItem.unitPrice) > 0
          ? Number(params.fallbackItem.unitPrice)
          : Number(batchUnitPrice || mrp || sellPrice || 0);
        const invId = Number(batch.inventory_id || batch.id);
        const keepManualFlag = Boolean(params.respectPriorityBatch && params.fallbackItem?.manualBatchSelected && isPinnedBatch(batch));

        allocations.push({
          ...(params.fallbackItem || {}),
          id: invId,
          inventory_id: invId,
          medicine_id: Number(batch.medicine_id || medicineId),
          name: batch.name || batch.medicine_name || medicineName,
          medicine_name: batch.name || batch.medicine_name || medicineName,
          batch: batch.batch_no,
          batch_no: batch.batch_no,
          expiry: batch.expiry_date || '',
          expiry_date: batch.expiry_date || '',
          mrp,
          sell_price: sellPrice,
          qty,
          quantity: qty,
          looseQty,
          unitPrice,
          discount: discount || 0,
          packSize: pSize,
          pack_size: pSize,
          pack_unit: batch.pack_unit || params.fallbackItem?.pack_unit || null,
          packaging: batch.packaging || params.fallbackItem?.packaging || null,
          allow_loose_sale: resolveAllowLooseSale({
            allow_loose_sale: batch.allow_loose_sale !== undefined ? (batch.allow_loose_sale ? 1 : 0) : (params.fallbackItem?.allow_loose_sale !== undefined ? (params.fallbackItem.allow_loose_sale ? 1 : 0) : undefined),
            name: batch.medicine_name || params.medicineName,
            packaging: batch.packaging || params.fallbackItem?.packaging,
            packSize: pSize,
            pack_size: pSize
          }),
          costPrice: batch.cost_price != null ? batch.cost_price : (params.fallbackItem?.costPrice || null),
          availableStock: batch.stock_qty,
          availableLooseStock: batch.loose_quantity,
          manualBatchSelected: keepManualFlag,
          alternative_batches: activeBatches.filter(b => (b.inventory_id || b.id) !== (batch.inventory_id || batch.id)),
          isEmptyRow: false
        });
        remainingTablets -= takenTablets;
      }
    }
  }

  // If requested exceeds available stock, cap to maximum and inform user
  if (!editingInvoiceId && totalRequestedTablets > totalAvailableTablets && totalAvailableTablets > 0) {
    const availStrips = Math.floor(totalAvailableTablets / pSize);
    const availLoose = totalAvailableTablets % pSize;
    params.onNotify?.(
      `Only ${availStrips} strips${availLoose > 0 ? ` & ${availLoose} loose` : ''} available for "${medicineName}". Allocated across ${allocations.length} batch(es).`,
      'info'
    );
  }

  // If nothing allocated (e.g. 0 requested or 0 stock), return the earliest-expiry FEFO batch with 0 qty
  if (allocations.length === 0 && activeBatches.length > 0) {
    const firstB = activeBatches[0];
    const sellPrice = firstB.sell_price !== undefined && firstB.sell_price !== null ? firstB.sell_price : (params.fallbackItem?.sell_price || null);
    const mrp = Number(firstB.mrp || params.fallbackItem?.mrp || 0);
    const invId = Number(firstB.inventory_id || firstB.id);
    allocations.push({
      ...(params.fallbackItem || {}),
      id: invId,
      inventory_id: invId,
      medicine_id: Number(firstB.medicine_id || medicineId),
      name: firstB.name || firstB.medicine_name || medicineName,
      medicine_name: firstB.name || firstB.medicine_name || medicineName,
      batch: firstB.batch_no,
      batch_no: firstB.batch_no,
      expiry: firstB.expiry_date || '',
      expiry_date: firstB.expiry_date || '',
      mrp,
      sell_price: sellPrice,
      qty: params.requestedQty || 0,
      quantity: params.requestedQty || 0,
      looseQty: params.requestedLooseQty || 0,
      unitPrice: Number((firstB.unit_price && Number(firstB.unit_price) > 0 ? firstB.unit_price : 0) || mrp || sellPrice || 0),
      discount: 0,
      packSize: pSize,
      pack_size: pSize,
      pack_unit: firstB.pack_unit || params.fallbackItem?.pack_unit || null,
      packaging: firstB.packaging || params.fallbackItem?.packaging || null,
      allow_loose_sale: resolveAllowLooseSale({
        allow_loose_sale: firstB.allow_loose_sale !== undefined ? (firstB.allow_loose_sale ? 1 : 0) : (params.fallbackItem?.allow_loose_sale !== undefined ? (params.fallbackItem.allow_loose_sale ? 1 : 0) : undefined),
        name: firstB.name || firstB.medicine_name || params.medicineName,
        packaging: firstB.packaging || params.fallbackItem?.packaging,
        packSize: pSize,
        pack_size: pSize
      }),
      costPrice: firstB.cost_price != null ? firstB.cost_price : (params.fallbackItem?.costPrice || null),
      availableStock: firstB.stock_qty,
      availableLooseStock: firstB.loose_quantity,
      manualBatchSelected: Boolean(params.respectPriorityBatch && params.fallbackItem?.manualBatchSelected),
      alternative_batches: activeBatches.filter(b => (b.inventory_id || b.id) !== (firstB.inventory_id || firstB.id)),
      isEmptyRow: false
    });
  }

  return allocations;
}
