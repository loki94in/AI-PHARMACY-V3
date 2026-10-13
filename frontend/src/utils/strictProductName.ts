/**
 * Strict "same product" check for auto-adding to the live cart.
 * Mirrors the exact / core-equal branch of backend src/utils/orderNameMatcher.ts
 * (scoreOrderNameMatch >= ARRIVAL_MATCH_THRESHOLD): packaging words are ignored, strength units are
 * collapsed ("40mg" == "40"), and ANY other token on only one side (Plus / DS / M / H / Forte ...)
 * means a DIFFERENT product. No substring or fuzzy matching: a wrong auto-add is worse than a picker.
 */
const PACKAGING_STOP_WORDS = new Set([
  'strip', 'strips', 'of', 'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
  'syp', 'syrup', 'susp', 'suspension', 'inj', 'injection', 'oint', 'ointment', 'crm', 'cream', 'gel',
  'drop', 'drops', 'sol', 'solution', 'lot', 'lotion', 'respule', 'respules', 'sachet', 'sachets',
  'soap', 'wash', 'shampoo', 'spray', 'powder', 'drg', 'oil', 'emulsion', 'pc', 'pcs', 'pack', 'pck',
  'box', 'btl', 'bottle', 'vial', 'amp', 'ampoule', 'gm', 'mg', 'ml', 'mcg', 'iu', 'kg', 'ltr',
  '10s', '15s', '20s', '30s', '5s', '1s', '6s'
]);

function coreTokens(s: string): string[] {
  const all = (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/)
    .filter(Boolean)
    .map(w => w.replace(/^(\d+)(mg|mcg|ml|gm|g|iu)$/, '$1'));
  // glued pack counts ("10tab", "15s", "10caps") are packaging, not part of the product identity
  const core = all.filter(w => !PACKAGING_STOP_WORDS.has(w) && !/^\d+(s|tab|tabs|cap|caps|strip|strips)$/.test(w));
  return (core.length > 0 ? core : all).sort();
}

export function isStrictSameProduct(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = coreTokens(a || '');
  const tb = coreTokens(b || '');
  if (ta.length === 0 || tb.length === 0) return false;
  return ta.join(' ') === tb.join(' ');
}
