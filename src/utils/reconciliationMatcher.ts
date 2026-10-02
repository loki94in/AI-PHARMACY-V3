/**
 * Canonical Reconciliation and Bounced Product Matching Utility
 *
 * Ensures consistent, pharma-accurate matching between:
 * - Distributor order emails & attachments
 * - SQLite purchases & purchase_items
 * - Bounced product alerts & reports
 *
 * Enforces:
 * 1. Pharmaceutical noise stripping (dosage forms, pack units, manufacturer tags)
 * 2. Strict strength check (Telma 40 != Telma 80)
 * 3. Combination vs single-salt suffix protection (Pan-D != Pan 40)
 */

export const PHARMA_PACKAGING_STOP_WORDS = new Set([
  'strip', 'strips', 'tab', 'tabs', 'tablet', 'tablets',
  'cap', 'caps', 'capsule', 'capsules',
  'inj', 'injection', 'injections',
  'syp', 'syrup', 'susp', 'suspension',
  'drops', 'drop', 'cream', 'crm', 'ointment', 'oint', 'gel', 'lotion', 'solution', 'sol',
  'respules', 'respule', 'rotacaps', 'inhaler', 'spray', 'wash', 'soap', 'powder', 'sachet', 'sachets',
  'bottle', 'btl', 'vial', 'ampoule', 'amp', 'box', 'pc', 'pcs', 'pack', 'pck',
  'mg', 'mcg', 'gm', 'g', 'ml', 'iu', 'kg', 'ltr',
  '10s', '15s', '20s', '30s', '5s', '6s', '1s', '100s', '1x10', '1x15', '1x14', '1x30', '1x20'
]);

export const COMBINATION_SUFFIX_MODIFIERS = new Set([
  'd', 'dsr', 'ls', 'am', 'h', 'plus', 'forte', 'mcl', 'mf', 'ap', 'sp', 'cv', 'cl', 'oz', 'tz', 'tc', 'dx', 'ex'
]);

/**
 * Normalizes invoice number by stripping non-alphanumeric chars and leading zeroes.
 */
export function normalizeInvoiceNo(invoiceNo: string | null | undefined): string {
  if (!invoiceNo) return '';
  let cleaned = invoiceNo.trim().toUpperCase();
  cleaned = cleaned.replace(/^(INVOICE|INV|BILL|TAX|NO|NUM|#|SL|\/|-|\s)+/gi, '');
  cleaned = cleaned.replace(/[^A-Z0-9]/gi, '');
  cleaned = cleaned.replace(/^0+/, '');
  return cleaned;
}

/**
 * Strips pharmaceutical packaging noise, forms, pack quantities, and parenthesized text.
 * Leaves the core brand name, strength numbers, and modifier tokens.
 */
export function stripPharmaNoise(str: string): string {
  if (!str) return '';
  let s = str.toLowerCase();

  // Strip content in parentheses e.g. "(glenmark)", "(sun pharma)", "(10 tab)"
  s = s.replace(/\(.*?\)/g, ' ');

  // Normalize and strip pack sizes e.g. "10's", "15'S", "3s", "10s"
  s = s.replace(/(\d+)\s*['’]?\s*s\b/gi, ' ');

  // Strip bottle volumes and tube weights e.g. "60ml", "100ml", "20gm", "15g"
  s = s.replace(/(\d+)\s*(ml|ltr|gm|g)\b/gi, ' ');

  // Separate glued strength units from numbers e.g. "40mg" -> "40 mg", "625duo" -> "625 duo"
  s = s.replace(/(\d+)(mg|mcg|iu|duo|sr|er|cr|ir|dsr|ls|am|h)\b/gi, '$1 $2');
  s = s.replace(/\b(duo|sr|er|cr|ir|dsr|ls|am|h)(\d+)/gi, '$1 $2');

  // Replace punctuation and symbols with space, preserving decimal points between digits
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  s = s.replace(/[^a-z0-9\s.]/g, ' ');

  const words = s.split(/\s+/).filter(w => w.length > 0);
  const filtered = words.filter(w => !PHARMA_PACKAGING_STOP_WORDS.has(w));

  return filtered.join(' ');
}

/**
 * Extracts digit sequences including decimals representing strengths or pack numbers.
 */
function extractNumbers(str: string): string[] {
  return str.match(/\b\d+(?:\.\d+)?\b/g) || [];
}

/**
 * Checks if a medicine string contains any combination suffix modifier (d, dsr, am, etc.).
 */
function extractSuffixModifiers(tokens: Set<string>): Set<string> {
  const found = new Set<string>();
  for (const t of tokens) {
    if (COMBINATION_SUFFIX_MODIFIERS.has(t)) {
      found.add(t);
    }
  }
  return found;
}

/**
 * Token-level fuzzy matcher for medicine names with pharma-aware safeguards:
 * - Strips dosage forms & noise words
 * - Guards against different strengths (e.g. 40 vs 80)
 * - Guards against combination suffix mismatch (e.g. Pan-D vs Pan 40)
 */
export function tokensMatchFuzzy(term1: string, term2: string, aliasMap?: Map<string, string>): boolean {
  if (!term1 || !term2) return false;

  const rawNorm1 = term1.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const rawNorm2 = term2.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  // 1. Direct exact or full containment
  if (rawNorm1 === rawNorm2) return true;
  if (rawNorm1.length >= 5 && rawNorm2.length >= 5 && (rawNorm1 === rawNorm2 || rawNorm1.includes(rawNorm2) || rawNorm2.includes(rawNorm1))) {
    // Check numbers before accepting containment
    const rNum1 = extractNumbers(rawNorm1);
    const rNum2 = extractNumbers(rawNorm2);
    if (rNum1.length === 0 && rNum2.length === 0) return true;
    if (rNum1.some(n => rNum2.includes(n))) return true;
  }

  // 2. Pharma-stripped normalized strings
  const clean1 = stripPharmaNoise(term1);
  const clean2 = stripPharmaNoise(term2);

  if (clean1 && clean2 && clean1 === clean2) return true;

  // 3. Number check: if both terms have strength numbers, they MUST share at least one
  const nums1 = extractNumbers(clean1 || rawNorm1);
  const nums2 = extractNumbers(clean2 || rawNorm2);
  if (nums1.length > 0 && nums2.length > 0) {
    const hasCommonNumber = nums1.some(n => nums2.includes(n));
    if (!hasCommonNumber) {
      return false; // Different strengths (e.g., 40 vs 80) -> reject
    }
  }

  // 4. Tokenize
  const tokens1 = new Set((clean1 || rawNorm1).split(/\s+/).filter(t => t.length > 0));
  const tokens2 = new Set((clean2 || rawNorm2).split(/\s+/).filter(t => t.length > 0));

  if (tokens1.size === 0 || tokens2.size === 0) return false;

  // 5. Combination suffix check: if one has modifier 'd' or 'am' and the other doesn't, reject
  const mod1 = extractSuffixModifiers(tokens1);
  const mod2 = extractSuffixModifiers(tokens2);
  if (mod1.size > 0 || mod2.size > 0) {
    let modsMatch = true;
    for (const m of mod1) {
      if (!mod2.has(m)) { modsMatch = false; break; }
    }
    for (const m of mod2) {
      if (!mod1.has(m)) { modsMatch = false; break; }
    }
    if (!modsMatch) return false;
  }

  // 6. Token overlap counting with aliasMap support
  let commonCount = 0;
  for (const t1 of tokens1) {
    if (tokens2.has(t1)) {
      commonCount++;
    } else if (aliasMap && aliasMap.has(t1) && tokens2.has(aliasMap.get(t1)!)) {
      commonCount++;
    }
  }

  // If all tokens of the smaller set are present in the larger set, it's a match
  const minSize = Math.min(tokens1.size, tokens2.size);
  if (commonCount === minSize) return true;

  const overlap = commonCount / minSize;
  return overlap >= 0.5 || commonCount >= 2;
}
