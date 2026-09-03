/**
 * Product Normalizer & Identity Utility
 * Implements Centralized Catalog Identity & Search Standards
 * Reference: CENTRALIZED CATALOG + BOOKING/PICKUP WORKFLOW.md (§2, §3, §7, §10)
 */

export interface ProductMatchCandidate {
  id: number;
  product_code: string;
  name: string;
  canonical_name?: string;
  normalized_name?: string;
  manufacturer?: string;
  strength?: string;
  dosage_form?: string;
  barcode?: string;
  match_type: 'BARCODE' | 'EXACT_NORMALIZED' | 'SIMILAR';
}

const COMMON_DOSAGE_FORMS: Record<string, string> = {
  tab: 'TABLET',
  tabs: 'TABLET',
  tablet: 'TABLET',
  tablets: 'TABLET',
  cap: 'CAPSULE',
  caps: 'CAPSULE',
  capsule: 'CAPSULE',
  capsules: 'CAPSULE',
  syp: 'SYRUP',
  syrup: 'SYRUP',
  susp: 'SUSPENSION',
  suspension: 'SUSPENSION',
  inj: 'INJECTION',
  injection: 'INJECTION',
  drop: 'DROPS',
  drops: 'DROPS',
  oint: 'OINTMENT',
  ointment: 'OINTMENT',
  cream: 'CREAM',
  gel: 'GEL',
  inhaler: 'INHALER',
  respules: 'RESPULES',
  powder: 'POWDER',
  lotion: 'LOTION',
  spray: 'SPRAY',
  solution: 'SOLUTION',
};

/**
 * Format internal numeric ID to permanent canonical product ID
 * Example: 1234 -> "MED-00001234"
 */
export function formatProductCode(id: number): string {
  if (!id || id <= 0) return '';
  return `MED-${String(id).padStart(8, '0')}`;
}

/**
 * Parse permanent product ID to numeric ID
 * Example: "MED-00001234" -> 1234
 */
export function parseProductCode(code: string): number | null {
  if (!code) return null;
  const match = code.trim().match(/^MED-(\d+)$/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Clean and normalize a product name for catalog search and deduplication
 * Stems punctuation, converts to lowercase, normalizes whitespace.
 */
export function normalizeProductName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // replace punctuation with space
    .replace(/\s+/g, ' ')     // condense multiple spaces
    .trim();
}

/**
 * Extract the first 3 normalized words from a query for rapid prefix catalog scan
 */
export function getThreeWordPrefix(name: string): string {
  const normalized = normalizeProductName(name);
  if (!normalized) return '';
  const words = normalized.split(' ').filter(Boolean);
  return words.slice(0, 3).join(' ');
}

/**
 * Extract dosage form token if present
 */
export function extractDosageForm(text: string): string | null {
  if (!text) return null;
  const tokens = text.toLowerCase().split(/[^\w]+/);
  for (const token of tokens) {
    if (COMMON_DOSAGE_FORMS[token]) {
      return COMMON_DOSAGE_FORMS[token];
    }
  }
  return null;
}

/**
 * Extract strength pattern (e.g. 500mg, 10mg/5ml, 2%, 250 mg)
 */
export function extractStrength(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b\d+(\.\d+)?\s*(mg|g|mcg|ml|iu|%|mg\/ml|mg\/5ml)\b/i);
  return match ? match[0].replace(/\s+/g, '').toLowerCase() : null;
}

/**
 * Check if a medicine already exists in the centralized catalog to prevent duplicates
 * (§10: Duplicate Product Protection)
 */
export async function detectPossibleDuplicates(
  db: any,
  params: {
    name: string;
    barcode?: string;
    manufacturer?: string;
    strength?: string;
    excludeId?: number;
  }
): Promise<ProductMatchCandidate[]> {
  const matches: ProductMatchCandidate[] = [];
  const normalized = normalizeProductName(params.name);
  const cleanBarcode = (params.barcode || '').trim();
  const excludeId = params.excludeId || 0;

  // 1. Check Barcode
  if (cleanBarcode) {
    const barcodeMatch = await db.get(
      'SELECT id, name, canonical_name, normalized_name, manufacturer, strength, barcode, product_code FROM medicines WHERE barcode = ? AND id != ? LIMIT 1',
      [cleanBarcode, excludeId]
    ).catch(() => null);

    if (barcodeMatch) {
      matches.push({
        id: barcodeMatch.id,
        product_code: barcodeMatch.product_code || formatProductCode(barcodeMatch.id),
        name: barcodeMatch.name,
        canonical_name: barcodeMatch.canonical_name,
        normalized_name: barcodeMatch.normalized_name,
        manufacturer: barcodeMatch.manufacturer,
        strength: barcodeMatch.strength,
        barcode: barcodeMatch.barcode,
        match_type: 'BARCODE',
      });
      return matches; // Exact barcode match is definitive
    }
  }

  // 2. Check exact normalized name
  if (normalized) {
    const exactNameMatches = await db.all(
      'SELECT id, name, canonical_name, normalized_name, manufacturer, strength, barcode, product_code FROM medicines WHERE normalized_name = ? AND id != ? LIMIT 3',
      [normalized, excludeId]
    ).catch(() => []);

    for (const m of exactNameMatches) {
      matches.push({
        id: m.id,
        product_code: m.product_code || formatProductCode(m.id),
        name: m.name,
        canonical_name: m.canonical_name,
        normalized_name: m.normalized_name,
        manufacturer: m.manufacturer,
        strength: m.strength,
        barcode: m.barcode,
        match_type: 'EXACT_NORMALIZED',
      });
    }

    if (matches.length > 0) return matches;
  }

  // 3. Check 3-word prefix + manufacturer/strength similarity
  const prefix = getThreeWordPrefix(params.name);
  if (prefix && prefix.length >= 3) {
    const similarRows = await db.all(
      `SELECT id, name, canonical_name, normalized_name, manufacturer, strength, barcode, product_code
       FROM medicines
       WHERE (normalized_name LIKE ? OR name LIKE ?) AND id != ?
       LIMIT 5`,
      [`${prefix}%`, `${prefix}%`, excludeId]
    ).catch(() => []);

    for (const s of similarRows) {
      matches.push({
        id: s.id,
        product_code: s.product_code || formatProductCode(s.id),
        name: s.name,
        canonical_name: s.canonical_name,
        normalized_name: s.normalized_name,
        manufacturer: s.manufacturer,
        strength: s.strength,
        barcode: s.barcode,
        match_type: 'SIMILAR',
      });
    }
  }

  return matches;
}
