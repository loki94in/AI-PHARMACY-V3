import type { PrecomputedInventoryIndex } from '../services/api';
import { isExpiredDate } from './date';
import { fefoRank, normMedKey } from './posBatchAllocator';

export interface PosBatchItem {
  id?: number | string;
  medicine_id?: number | string;
  inventory_id?: number | string;
  name?: string;
  medicine_name?: string;
  item_code?: string;
  short_code?: string;
  therapeutic?: string;
  sub_therapeutic?: string;
  batch_no?: string;
  expiry_date?: string;
  expiry?: string;
  quantity?: number;
  stock_qty?: number;
  loose_quantity?: number;
  loose_qty?: number;
  mrp?: number;
  cost_price?: number | null;
  unit_price?: number;
  sell_price?: number | string | null;
  pack_size?: number | null;
  pack_unit?: string | null;
  packUnit?: string | null;
  packMismatchDismissed?: boolean;
  packaging?: string | null;
  manufacturer?: string;
  salts?: string;
  hsn_code?: string;
  api_reference?: string;
  alternatives?: PosBatchItem[];
  is_out_of_stock?: boolean;
  discount?: number;
  batch_quantity?: number;
  __fefoRank?: string;
  scanImage?: string;
  rawOcrText?: string;
  [key: string]: unknown;
}

/**
 * Filters compact POS inventory for a search query and collapses all active,
 * non-expired batches of the same medicine into a single dropdown row
 * (combining stock and selecting the earliest-expiry FEFO batch), regardless
 * of differing batch numbers, MRPs, rates, or expiry dates.
 */
export function filterLocalInventory<T extends PosBatchItem>(
  query: string,
  inventory: T[],
  index: PrecomputedInventoryIndex[] = []
): T[] {
  if (!query || query.trim().length < 2) return [];
  const rawTerm = query.trim().toLowerCase();
  const term = rawTerm.replace(/\s+/g, ' ');
  const tokens = term.split(/\s+/).filter(Boolean);
  const compactTerm = term.replace(/[^a-z0-9]/g, '');
  const useIndex = index.length === inventory.length;
  // Never run the unindexed per-row scan over a large list; the indexed pass repaints once the index matches.
  if (!useIndex && inventory.length > 2000) return [];

  const matchMap = new Map<string, { tier: number; item: T }>();

  const len = inventory.length;
  for (let i = 0; i < len; i++) {
    const item = inventory[i];
    const isValid = useIndex ? index[i].isValidForPos : (
      !!item.inventory_id && (Number(item.stock_qty || item.quantity || 0) > 0 || Number(item.loose_quantity || item.loose_qty || 0) > 0) && !isExpiredDate(item.expiry_date || item.expiry)
    );
    if (!isValid) continue;

    const name = useIndex ? index[i].nameLower : (item.medicine_name || item.name || '').toLowerCase();
    const normName = name.replace(/\s+/g, ' ');
    const compactName = name.replace(/[^a-z0-9]/g, '');
    const code = useIndex ? index[i].itemCodeLower : (item.item_code || '').toLowerCase();
    const batch = useIndex ? index[i].batchNoLower : (item.batch_no || '').toLowerCase();
    const mrpNum = Number(item.mrp || 0);
    const mrpStr = useIndex ? index[i].mrpStr : (mrpNum > 0 ? String(mrpNum) : '');
    const mrpIntStr = useIndex ? index[i].mrpIntStr : (mrpNum > 0 ? String(Math.round(mrpNum)) : '');
    const initials = useIndex ? index[i].initials : '';
    const initialsNoNum = useIndex ? index[i].initialsNoNum : '';
    const words = useIndex ? index[i].words : name.split(/[^a-z0-9]+/).filter(Boolean);

    let tier = 0;

    // 1. Direct Prefix on Name, Item Code, or Space-compact Name
    // (Pure batch matches are handled in Tier 5 so medicine name/strength strictly outranks batch numbers)
    if (name.startsWith(term) || normName.startsWith(term) || (compactTerm.length >= 2 && compactName.startsWith(compactTerm)) || code.startsWith(term)) {
      tier = 1;
    }
    // 2. Acronym / Shorthand (e.g. "cd 12" or "cd12" matching "crocin ds 12")
    else if (compactTerm.length >= 2 && (
      (initials && initials.startsWith(compactTerm)) ||
      (initialsNoNum && initialsNoNum.startsWith(compactTerm)) ||
      (initials && compactTerm.length <= initials.length && initials.includes(compactTerm))
    )) {
      tier = 2;
    }
    // 3. Multi-token match where every token matches word prefix, name, batch, or MRP
    else if (tokens.length > 1) {
      let allMatch = true;
      for (const t of tokens) {
        const wordMatch = words.some(w => w.startsWith(t) || w === t);
        const nameMatch = name.includes(t) || normName.includes(t);
        const batchMatch = batch.includes(t);
        const mrpMatch = (mrpStr && mrpStr.startsWith(t)) || (mrpIntStr && mrpIntStr === t);
        if (!wordMatch && !nameMatch && !batchMatch && !mrpMatch) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        tier = 3;
      }
    }
    // 4. Infix / Contains on Name, Code, or Space-compact Name
    if (!tier && (name.includes(term) || normName.includes(term) || (compactTerm.length >= 3 && compactName.includes(compactTerm)) || code.includes(term))) {
      tier = 4;
    }
    // 5. Batch or MRP search (e.g. typing "625", "AX99", or "30")
    if (!tier && (
      batch.includes(term) ||
      (mrpStr && (mrpStr === term || mrpStr.startsWith(term))) ||
      (mrpIntStr && mrpIntStr === term)
    )) {
      tier = 5;
    }

    if (!tier) continue;

    // Combine all batches under one single medicine row (no split by batch, MRP, rate, or expiry)
    const key = normMedKey(item.medicine_name || item.name) || String(item.medicine_id || item.inventory_id || i);
    const stripQty = Number(item.stock_qty || item.quantity || 0);
    const looseQty = Number(item.loose_quantity || item.loose_qty || 0);

    const existingEntry = matchMap.get(key);
    if (!existingEntry) {
      matchMap.set(key, {
        tier,
        item: {
          ...item,
          medicine_name: item.medicine_name || item.name,
          name: item.name || item.medicine_name,
          quantity: stripQty,
          stock_qty: stripQty,
          batch_quantity: stripQty,
          loose_quantity: looseQty,
          __fefoRank: fefoRank(stripQty, item.expiry_date || item.expiry, looseQty),
        },
      });
    } else {
      if (tier < existingEntry.tier) {
        existingEntry.tier = tier;
      }
      const existing = existingEntry.item;
      existing.quantity = (existing.quantity || 0) + stripQty;
      existing.stock_qty = (existing.stock_qty || 0) + stripQty;
      existing.loose_quantity = (existing.loose_quantity || 0) + looseQty;

      const rank = fefoRank(stripQty, item.expiry_date || item.expiry, looseQty);
      if (rank < (existing.__fefoRank || '9999-12|9')) {
        existing.__fefoRank = rank;
        existing.inventory_id = item.inventory_id;
        existing.batch_no = item.batch_no;
        existing.expiry_date = item.expiry_date;
        existing.mrp = item.mrp;
        existing.cost_price = item.cost_price;
        existing.unit_price = item.unit_price;
        existing.sell_price = item.sell_price;
        existing.batch_quantity = stripQty;
      }
    }
  }

  const tiers: [T[], T[], T[], T[], T[]] = [[], [], [], [], []];
  for (const entry of matchMap.values()) {
    tiers[entry.tier - 1].push(entry.item);
  }

  const sortAlpha = (a: T, b: T) => {
    const nameA = String(a.medicine_name || a.name || '').toLowerCase();
    const nameB = String(b.medicine_name || b.name || '').toLowerCase();
    return nameA < nameB ? -1 : (nameA > nameB ? 1 : 0);
  };

  return [
    ...tiers[0].sort(sortAlpha),
    ...tiers[1].sort(sortAlpha),
    ...tiers[2].sort(sortAlpha),
    ...tiers[3].sort(sortAlpha),
    ...tiers[4].sort(sortAlpha),
  ].slice(0, 30);
}
