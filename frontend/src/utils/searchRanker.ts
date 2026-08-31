/**
 * Centralized utility for ranking medicine search results.
 * Ranking Tiers:
 *  - Tier 1: Names / Item Codes / Batches that START WITH the search term (exact prefix), sorted A-Z.
 *  - Tier 2: Acronyms & Shorthand initials (e.g., "cd 12" -> "Crocin DS 12", "cv 625" -> "Clavam 625", "pcm 650" -> "Paracetamol 650"), sorted A-Z.
 *  - Tier 3: Multi-token / word prefix matches (e.g., "cro 12", "clav 625", "dolo 30"), sorted A-Z.
 *  - Tier 4: Infix matches (names / generic / strength containing search term), sorted A-Z.
 *  - Tier 5: Batch or MRP numeric matches (e.g., searching "120" or "30"), sorted A-Z.
 */

export interface SearchableMedicineItem {
  name?: string;
  medicine_name?: string;
  item_code?: string;
  batch_no?: string;
  batch?: string;
  strength?: string;
  mrp?: number | string;
  manufacturer?: string;
  generic_name?: string;
  api_reference?: string;
  stock_qty?: number | string;
  quantity?: number | string;
  loose_qty?: number | string;
  loose_quantity?: number | string;
  expiry_date?: string | null;
  expiry?: string | null;
  isValidForPos?: boolean;
}

export function isExpiredDateFast(expiryStr: string | null | undefined): boolean {
  if (!expiryStr) return false;
  const str = String(expiryStr).trim();
  if (!str) return false;
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const mmYyyy = str.match(/^(\d{1,2})[\/\-](\d{2,4})$/);
  if (mmYyyy) {
    const m = parseInt(mmYyyy[1], 10);
    let y = parseInt(mmYyyy[2], 10);
    if (y < 100) y += 2000;
    if (y < curYear) return true;
    if (y === curYear && m < curMonth) return true;
    return false;
  }
  const iso = str.match(/^(\d{4})[\/\-](\d{1,2})/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    if (y < curYear) return true;
    if (y === curYear && m < curMonth) return true;
    return false;
  }
  return false;
}

/**
 * Checks whether an item is sellable in current inventory (has stock > 0 and not expired).
 */
export function isSellableMedicine(item: SearchableMedicineItem): boolean {
  if (item.isValidForPos === false) return false;

  const stock = Number(item.stock_qty ?? item.quantity ?? 0);
  const loose = Number(item.loose_quantity ?? item.loose_qty ?? 0);
  if (stock <= 0 && loose <= 0) return false;

  const expStr = item.expiry_date || item.expiry;
  if (expStr && isExpiredDateFast(expStr)) return false;

  return true;
}

export function matchMedicineSearch(
  item: SearchableMedicineItem,
  searchTerm: string
): { matched: boolean; tier: number } {
  const q = (searchTerm || '').trim().toLowerCase();
  if (!q) return { matched: true, tier: 1 };

  const name = String(item.medicine_name || item.name || '').toLowerCase();
  const code = String(item.item_code || '').toLowerCase();
  const batch = String(item.batch_no || item.batch || '').toLowerCase();
  const strength = String(item.strength || '').toLowerCase();
  const generic = String(item.generic_name || item.api_reference || '').toLowerCase();
  const mrpNum = Number(item.mrp || 0);
  const mrpStr = mrpNum > 0 ? String(mrpNum) : '';
  const mrpIntStr = mrpNum > 0 ? String(Math.round(mrpNum)) : '';

  // Tier 1: Direct Prefix on Name, Item Code, or Batch
  if (name.startsWith(q) || (code && code.startsWith(q)) || (batch && batch.startsWith(q))) {
    return { matched: true, tier: 1 };
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  const compactQ = q.replace(/[^a-z0-9]/g, '');

  // Extract words from medicine name
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);

  // Precompute initials + numeric tokens (e.g. "crocin ds 12 suspension" -> "cd12s", "cd12", "cds")
  let initials = '';
  let initialsNoNum = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d+$/.test(w)) {
      initials += w;
    } else {
      initials += w[0];
      initialsNoNum += w[0];
    }
  }

  // Tier 2: Acronym / Initialism Match (e.g. "cd 12", "cd12", "cv 625", "pcm 650")
  if (compactQ.length >= 2 && (
    initials.startsWith(compactQ) ||
    initialsNoNum.startsWith(compactQ) ||
    (compactQ.length <= initials.length && initials.includes(compactQ))
  )) {
    return { matched: true, tier: 2 };
  }

  // Tier 3: Multi-token match where every query token matches a part of name / strength / mrp / batch
  if (tokens.length > 1) {
    let allTokensMatch = true;
    for (const token of tokens) {
      const tokenMatchesWord = words.some(w => w.startsWith(token) || w === token);
      const tokenMatchesName = name.includes(token);
      const tokenMatchesStrength = strength.includes(token);
      const tokenMatchesBatch = batch.includes(token);
      const tokenMatchesGeneric = generic.includes(token);
      const tokenMatchesMrp = (mrpStr && mrpStr.startsWith(token)) || (mrpIntStr && mrpIntStr === token);

      if (!tokenMatchesWord && !tokenMatchesName && !tokenMatchesStrength && !tokenMatchesBatch && !tokenMatchesGeneric && !tokenMatchesMrp) {
        allTokensMatch = false;
        break;
      }
    }
    if (allTokensMatch) {
      return { matched: true, tier: 3 };
    }
  }

  // Tier 4: Infix / Contains on Name, Strength, Item Code, or Generic
  if (
    name.includes(q) ||
    (strength && strength.includes(q)) ||
    (code && code.includes(q)) ||
    (generic && generic.includes(q))
  ) {
    return { matched: true, tier: 4 };
  }

  // Tier 5: Batch or MRP numeric search (e.g. typing "625", "AX99", or "30")
  if (
    (batch && batch.includes(q)) ||
    (mrpStr && (mrpStr === q || mrpStr.startsWith(q))) ||
    (mrpIntStr && mrpIntStr === q)
  ) {
    return { matched: true, tier: 5 };
  }

  return { matched: false, tier: 99 };
}

export interface RankAndSortOptions {
  onlySellable?: boolean;
}

export function rankAndSortMedicines<T extends SearchableMedicineItem>(
  items: T[],
  searchTerm: string,
  options?: RankAndSortOptions
): T[] {
  const q = (searchTerm || '').trim().toLowerCase();
  if (!q || !items || items.length === 0) return items || [];

  const tier1: T[] = [];
  const tier2: T[] = [];
  const tier3: T[] = [];
  const tier4: T[] = [];
  const tier5: T[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (options?.onlySellable && !isSellableMedicine(item)) {
      continue;
    }
    const match = matchMedicineSearch(item, q);
    if (!match.matched) continue;
    if (match.tier === 1) tier1.push(item);
    else if (match.tier === 2) tier2.push(item);
    else if (match.tier === 3) tier3.push(item);
    else if (match.tier === 4) tier4.push(item);
    else tier5.push(item);
  }

  // Sort each group strictly alphabetically A-Z
  const sortAlpha = (a: T, b: T) => {
    const nameA = String(a.name || a.medicine_name || '');
    const nameB = String(b.name || b.medicine_name || '');
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  };

  tier1.sort(sortAlpha);
  tier2.sort(sortAlpha);
  tier3.sort(sortAlpha);
  tier4.sort(sortAlpha);
  tier5.sort(sortAlpha);

  return [...tier1, ...tier2, ...tier3, ...tier4, ...tier5];
}
