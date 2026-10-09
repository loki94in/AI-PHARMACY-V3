import { api, type RefillCartCandidate } from '../services/api';

/** Row shape of GET /pharmarack/search (routes/pharmarack.ts performPharmarackSearch). */
interface LocalPrSearchItem {
  name?: string;
  distributor?: string;
  storeId?: number | string;
  productCode?: string;
  productId?: string | number;
  packaging?: string;
  company?: string;
  mapped?: boolean;
  rate?: number | null;
  mrp?: number | null;
  scheme?: string;
  stock?: string | number | null;
  isOffline?: boolean;
  isLocalPharmacy?: boolean;
}

export const linkKeyOf = (c: { storeId: number; productCode: string }) => `${c.storeId}|${c.productCode}`;

export interface DistributorRank { name: string; purchases: number }

// ponytail: purchase counts move slowly — one fetch per app session is enough.
let ranksPromise: Promise<DistributorRank[]> | null = null;
export function loadDistributorRanks(): Promise<DistributorRank[]> {
  if (!ranksPromise) {
    ranksPromise = api.getDistributorRanks()
      .then(r => r.ranks || [])
      .catch(() => { ranksPromise = null; return []; });
  }
  return ranksPromise;
}

// The pharmacist's distributor priority (CRM → Distributor Priority): normalized name → rank (0 = first).
// ponytail: one small fetch, cached 60 s; a failed load simply means "no priority" (never invented).
let prioCache: { at: number; map: Map<string, number> } | null = null;
let prioPending: Promise<Map<string, number>> | null = null;
const prioKey = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function loadDistributorPriority(): Promise<Map<string, number>> {
  if (prioCache && Date.now() - prioCache.at < 60_000) return Promise.resolve(prioCache.map);
  if (!prioPending) {
    prioPending = api.getDistributorPriority()
      .then(r => {
        const map = new Map<string, number>();
        r.distributors.filter(d => d.ranked).forEach((d, i) => map.set(prioKey(d.storeName), i));
        prioCache = { at: Date.now(), map };
        return map;
      })
      .catch(() => new Map<string, number>())
      .finally(() => { prioPending = null; });
  }
  return prioPending;
}
export function clearDistributorPriorityCache(): void {
  prioCache = null;
  prioPending = null;
}
export const NO_PRIORITY = 100000;
export const priorityRankOf = (storeName: unknown, map: Map<string, number>): number => map.get(prioKey(storeName)) ?? NO_PRIORITY;

const normName = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** How many purchase bills the shop has from this Pharmarack distributor (name match; 0 = unknown). */
export function purchaseCountFor(storeName: string, ranks: DistributorRank[]): number {
  const sn = normName(storeName);
  if (sn.length < 4) return 0;
  const exact = ranks.find(r => normName(r.name) === sn);
  if (exact) return exact.purchases;
  // ranks are most-purchased first, so the first containment match is the best
  const partial = ranks.find(r => {
    const rn = normName(r.name);
    return rn.length >= 4 && (rn.includes(sn) || sn.includes(rn));
  });
  return partial ? partial.purchases : 0;
}

// Mirrors backend isItemInStock (routes/pharmarack.ts).
export function isInStock(stock: unknown): boolean {
  if (stock === null || stock === undefined || stock === '') return false;
  const s = String(stock).trim().toLowerCase();
  if (['0', 'out of stock', 'oos', 'nil', 'none', 'false', 'no', 'unavailable'].includes(s)) return false;
  const n = parseFloat(s);
  return isNaN(n) ? true : n > 0;
}

/**
 * Pharmarack search rows → products that can be linked to a medicine. Offline /
 * local-history rows are dropped (no real Pharmarack product code or stock), and
 * so are unmapped distributors (owner rule: link to mapped distributors only).
 */
export function toLinkCandidates(data: unknown, linkedKeys: Set<string>, limit = 30): RefillCartCandidate[] {
  const list = (Array.isArray(data) ? data : []) as LocalPrSearchItem[];
  return list
    .filter(i => !i.isOffline && !i.isLocalPharmacy && i.mapped !== false && Number(i.storeId) > 0 && String(i.productCode || '').trim())
    .slice(0, limit)
    .map(i => {
      const storeId = Number(i.storeId);
      const productCode = String(i.productCode);
      return {
        storeId,
        storeName: String(i.distributor || ''),
        productCode,
        productId: i.productId ?? null,
        productName: String(i.name || ''),
        packaging: String(i.packaging || ''),
        company: String(i.company || ''),
        mapped: i.mapped !== false,
        rate: i.rate ?? null,
        mrp: i.mrp ?? null,
        scheme: String(i.scheme || ''),
        stock: String(i.stock ?? ''),
        inStock: isInStock(i.stock),
        inCart: false,
        linked: linkedKeys.has(`${storeId}|${productCode}`)
      };
    });
}
