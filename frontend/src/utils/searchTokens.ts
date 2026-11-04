/**
 * Utility functions for pharmacy medicine search query sanitization and distributor stock evaluation.
 */

/**
 * Extracts only the first two alphanumeric tokens (letters and numbers) from any medicine name or search query.
 *
 * e.g. "TELMA 40MG TABLET 10'S" -> "TELMA 40MG"
 * e.g. "TELMA 40 MG TABLET"     -> "TELMA 40"
 * e.g. "Augmentin 625 Duo Tab"   -> "Augmentin 625"
 * e.g. "Dolo 650"               -> "Dolo 650"
 * e.g. "Paracetamol"            -> "Paracetamol"
 *
 * Prevents Pharmarack live search misses caused by trailing words like "TABLET", "STRIP", "10'S", etc.
 */
export function getFirstTwoAlphanumericTokens(name: string | undefined | null): string {
  if (!name) return '';
  const tokens = String(name).trim().match(/[a-zA-Z0-9]+/g) || [];
  return tokens.slice(0, 2).join(' ');
}

/**
 * Evaluates whether a distributor's reported stock meets the minimum 15-quantity threshold
 * required for guaranteed delivery (Tier 2 High Stock).
 *
 * Handles numbers, numeric strings, and descriptive status keywords ("High", "Low", "Nil", "OOS").
 */
export function hasMinStock15(stockStr: string | number | undefined | null): boolean {
  if (stockStr === undefined || stockStr === null) return false;
  if (typeof stockStr === 'number') return stockStr >= 15;

  const s = String(stockStr).toLowerCase().trim();
  if (s === 'high') return true;
  if (s === 'low' || s === 'offline') return false;
  if (s === '0' || s === 'out of stock' || s === 'nil' || s === 'no stock' || s === 'oos') return false;

  const num = parseInt(s, 10);
  if (!isNaN(num)) {
    return num >= 15;
  }
  return false;
}

