// Countable unit suffixes that mean "N per strip/pack" (tablets, capsules, pads, etc).
// Weight/volume units (G, KG, ML, L, MG) are not a per-strip count and must not be parsed as one.
const COUNTABLE_UNIT_PATTERN = /^\s*(\d+)\s*(NO'?S|TAB|TABS|CAP|CAPS|PAD|PADS)?\b/i;

/**
 * Extracts a numeric pack size (units per strip) from a free-text packaging
 * field like "15 NO'S", "10 NO'S", "10", "15", "TAB 10", or "10x10". Returns null for non-countable units
 * (e.g. "200 ML", "50 G") or unparseable/zero values, so callers can fall
 * back to their own default rather than treating a volume/weight as a count.
 */
export function parsePackSizeFromPackaging(packaging: string | null | undefined): number | null {
  if (!packaging) return null;
  const trimmed = packaging.trim();

  // Handle multiplication patterns like "10x10" or "10 x 10"
  if (/\b\d+\s*x\s*\d+\b/i.test(trimmed)) {
    const parts = trimmed.split(/x/i);
    return (parseInt(parts[0], 10) || 1) * (parseInt(parts[1], 10) || 1);
  }

  // Handle "STRIP OF 10 TAB", "PACK OF 15 CAP", "BLISTER OF 10"
  const stripOfMatch = trimmed.match(/^\s*(?:STRIP|PACK|BOX|BLISTER)\s+OF\s+(\d+)/i);
  if (stripOfMatch) {
    const size = parseInt(stripOfMatch[1], 10);
    if (size > 0) return size;
  }

  // Handle "TAB 10", "CAP 15", "TAB 6"
  const prefixTypeMatch = trimmed.match(/\b(?:TAB|TABS|CAP|CAPS|STRIP)\s+(\d+)\b/i);
  if (prefixTypeMatch) {
    const size = parseInt(prefixTypeMatch[1], 10);
    if (size > 0) return size;
  }

  // Exclude liquid volumes and weights (ML, L, G, GM, KG, MG)
  if (/\b\d+(\.\d+)?\s*(ML|LTR|LITER|LITRE|G|GM|GRAM|KG|MG|MCG)\b/i.test(trimmed)) {
    return null;
  }

  const match = trimmed.match(COUNTABLE_UNIT_PATTERN);
  if (!match) return null;
  const size = parseInt(match[1], 10);
  if (!size || size <= 0) return null;
  return size;
}
