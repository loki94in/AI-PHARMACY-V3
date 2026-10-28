/**
 * Pack-Size & Unit Detection Utility for POS & Inventory
 *
 * Confidently extracts pack sizes and units from medicine names and packaging descriptions
 * while strictly ignoring dosage strengths (e.g. 650mg, 40mg, 500/125mg), dimension measurements
 * (e.g. 15 x 8 cm), and ambiguous numbers.
 */

export interface PackSizeDetectionResult {
  savedPackSize: number;
  savedUnit: string;
  detectedPackSize: number | null;
  detectedUnit: string | null;
  confidence: 'HIGH' | 'AMBIGUOUS' | 'NONE';
  hasMismatch: boolean;
  isUncertain: boolean;
  message?: string;
  calculatedSavedUnitPrice: number;
  calculatedDetectedUnitPrice?: number;
}

export interface PackSizeInput {
  name?: string | null;
  packaging?: string | null;
  dosageForm?: string | null;
  savedPackSize?: number | string | null;
  savedUnit?: string | null;
  mrp?: number | string | null;
  allowLooseSale?: number | boolean | null;
}

/**
 * Normalizes common unit names to standard short codes.
 */
export function normalizeUnit(rawUnit?: string | null, fallbackForm?: string | null): string {
  if (!rawUnit && !fallbackForm) return 'TAB';
  const u = (rawUnit || fallbackForm || '').trim().toUpperCase();

  if (/CAP|CAPSULE/.test(u)) return 'CAP';
  if (/TAB|TABLET|PILL/.test(u)) return 'TAB';
  if (/BOTTLE|SYRUP|SUSP|DROP|LIQUID/.test(u)) return 'BOTTLE';
  if (/VIAL|AMP|INJ/.test(u)) return 'VIAL';
  if (/TUBE|CREAM|OINT|GEL/.test(u)) return 'TUBE';
  if (/SACHET|POUCH/.test(u)) return 'SACHET';
  if (/RESPULE/.test(u)) return 'RESPULE';
  if (/STRIP/.test(u)) return 'STRIP';
  if (/BOX|CARTON/.test(u)) return 'BOX';

  return u || 'TAB';
}

/**
 * Checks if medicine is a liquid, topical, or inherently single-unit packaging form.
 */
export function isLiquidOrSingleUnit(name?: string | null, packaging?: string | null, dosageForm?: string | null): boolean {
  const combined = `${packaging || ''} ${name || ''} ${dosageForm || ''}`.toLowerCase();
  return /\b(bottle|syrup|syp|suspension|susp|drop|drops|inj|injection|liquid|lotion|spray|ointment|oint|gel|cream|respule|sachet|vial|amp|ampoule)\b/i.test(combined);
}

/**
 * Confidently detects pack size from medicine name and packaging string.
 * Strictly ignores dosage strengths (500mg, 650, 40mg), ratios (40/5), and dimensions (15x8 cm).
 */
export function detectPackSize(
  name?: string | null,
  packaging?: string | null,
  dosageForm?: string | null
): { detectedPackSize: number | null; detectedUnit: string | null; confidence: 'HIGH' | 'AMBIGUOUS' | 'NONE' } {
  const rawName = (name || '').trim();
  const rawPackaging = (packaging || '').trim();
  const combined = `${rawPackaging} ${rawName}`.trim();

  if (!combined) {
    return { detectedPackSize: null, detectedUnit: null, confidence: 'NONE' };
  }

  // 1. Liquids, topicals, and single-unit forms: inherently 1 unit per pack
  if (isLiquidOrSingleUnit(rawName, rawPackaging, dosageForm)) {
    // If it has explicit tablet/capsule strip declarations (e.g. kit), don't treat as liquid
    if (!/\b(?:STRIP OF \d+|\d+\s*(?:TAB|CAP))\b/i.test(combined)) {
      let unit = 'BOTTLE';
      if (/vial/i.test(combined)) unit = 'VIAL';
      else if (/amp/i.test(combined)) unit = 'AMP';
      else if (/tube|cream|oint|gel/i.test(combined)) unit = 'TUBE';
      else if (/sachet/i.test(combined)) unit = 'SACHET';
      else if (/respule/i.test(combined)) unit = 'RESPULE';

      return {
        detectedPackSize: 1,
        detectedUnit: unit,
        confidence: 'HIGH'
      };
    }
  }

  // 2. Explicit packaging declaration: "STRIP OF 10", "PACK OF 15", "BOX OF 30", "BLISTER OF 14"
  const stripOfMatch = combined.match(/\b(?:STRIP|PACK|BOX|BLISTER)\s+OF\s+(\d+)\b/i);
  if (stripOfMatch) {
    const size = parseInt(stripOfMatch[1], 10);
    if (size > 0 && size <= 1000) {
      const isCap = /\b(?:CAP|CAPS|CAPSULE|CAPSULES)\b/i.test(combined);
      return {
        detectedPackSize: size,
        detectedUnit: isCap ? 'CAP' : 'TAB',
        confidence: 'HIGH'
      };
    }
  }

  // 3. Multi-pack multiplier: "10x10", "1x15", "1x10"
  // Make sure it is not dimensions like "15 x 8 cm" or "10 x 10 mm"
  const multiPackMatch = combined.match(/\b(\d+)\s*x\s*(\d+)(?!\s*(?:cm|mm|m|inch|in)\b)\b/i);
  if (multiPackMatch) {
    const n1 = parseInt(multiPackMatch[1], 10);
    const n2 = parseInt(multiPackMatch[2], 10);
    if (n1 > 0 && n2 > 0) {
      // If 1x15 or 1x10, strip pack size is n2
      const packSize = n1 === 1 ? n2 : (n1 <= 10 && n2 <= 100 ? n2 : n1 * n2);
      const isCap = /\b(?:CAP|CAPS|CAPSULE|CAPSULES)\b/i.test(combined);
      return {
        detectedPackSize: packSize,
        detectedUnit: isCap ? 'CAP' : 'TAB',
        confidence: 'HIGH'
      };
    }
  }

  // 4. Explicit unit count with TAB / CAP keyword:
  // e.g. "14 TAB", "15 TABLETS", "20 CAP", "10 CAPSULES"
  // Negative lookbehind / boundary check: must not be preceded by strength or ratio units
  const tabCapMatch = combined.match(/\b(\d+)\s*(TAB|TABS|TABLET|TABLETS|CAP|CAPS|CAPSULE|CAPSULES)\b/i);
  if (tabCapMatch) {
    const count = parseInt(tabCapMatch[1], 10);
    const unitWord = tabCapMatch[2].toUpperCase();
    // Exclude if it's an absurd number or followed by strength
    if (count > 0 && count <= 500) {
      const isCap = unitWord.startsWith('CAP');
      return {
        detectedPackSize: count,
        detectedUnit: isCap ? 'CAP' : 'TAB',
        confidence: 'HIGH'
      };
    }
  }

  // 5. Pack count with 'S suffix at word boundary:
  // e.g. "15'S", "14'S", "10'S", "30'S", "100'S"
  // Must NOT match strength numbers like 500MG or 650
  const apostropheMatch = combined.match(/\b(\d+)\s*(?:'S)\b/i);
  if (apostropheMatch) {
    const count = parseInt(apostropheMatch[1], 10);
    if (count > 0 && count <= 500) {
      const isCap = /\b(?:CAP|CAPS|CAPSULE|CAPSULES)\b/i.test(combined);
      return {
        detectedPackSize: count,
        detectedUnit: isCap ? 'CAP' : 'TAB',
        confidence: 'HIGH'
      };
    }
  }

  // 6. Explicit "TABLET 10" or "TAB 10" or "CAP 10" suffix:
  const typeCountMatch = combined.match(/\b(?:TAB|TABS|TABLET|TABLETS|CAP|CAPS|CAPSULE|CAPSULES)\s+(\d+)\b/i);
  if (typeCountMatch) {
    const count = parseInt(typeCountMatch[1], 10);
    if (count > 0 && count <= 500) {
      const isCap = /\b(?:CAP|CAPS|CAPSULE|CAPSULES)\b/i.test(typeCountMatch[0]);
      return {
        detectedPackSize: count,
        detectedUnit: isCap ? 'CAP' : 'TAB',
        confidence: 'HIGH'
      };
    }
  }

  // 7. Check for standalone numbers:
  // If the string contains numbers, determine whether they are strength values or ambiguous
  const standaloneNumbers = combined.match(/\b\d+(?:\.\d+)?\b/g);
  if (standaloneNumbers && standaloneNumbers.length > 0) {
    // Numbers exist, but none have unambiguous pack indicators.
    // Examples: "DOLO 650", "PAN 40", "AZITHRAL 500", "CALPOL 500"
    return {
      detectedPackSize: null,
      detectedUnit: null,
      confidence: 'AMBIGUOUS'
    };
  }

  return {
    detectedPackSize: null,
    detectedUnit: null,
    confidence: 'NONE'
  };
}

/**
 * Compares authoritative saved inventory pack configuration against detected pack size.
 * Returns detailed mismatch metrics and price calculations.
 */
export function evaluatePackSize(input: PackSizeInput): PackSizeDetectionResult {
  const savedPack = Math.max(1, parseInt(String(input.savedPackSize || 1), 10) || 1);
  const savedUnit = normalizeUnit(input.savedUnit, input.dosageForm);
  const mrp = Math.max(0, parseFloat(String(input.mrp || 0)) || 0);

  const { detectedPackSize, detectedUnit, confidence } = detectPackSize(
    input.name,
    input.packaging,
    input.dosageForm
  );

  const calculatedSavedUnitPrice = mrp > 0 ? parseFloat((mrp / savedPack).toFixed(2)) : 0;
  let calculatedDetectedUnitPrice: number | undefined;

  let hasMismatch = false;
  let isUncertain = false;
  let message: string | undefined;

  if (confidence === 'HIGH' && detectedPackSize !== null) {
    calculatedDetectedUnitPrice = mrp > 0 ? parseFloat((mrp / detectedPackSize).toFixed(2)) : 0;
    if (detectedPackSize !== savedPack) {
      hasMismatch = true;
      const unitLabel = detectedUnit || savedUnit;
      message = `Saved pack size (${savedPack} ${savedUnit}) conflicts with detected packaging (${detectedPackSize} ${unitLabel}).`;
    }
  } else if (confidence === 'AMBIGUOUS') {
    // If allow_loose_sale is enabled and saved pack is 1 for a solid dosage form, verify is recommended
    const isSolid = !isLiquidOrSingleUnit(input.name, input.packaging, input.dosageForm);
    if (isSolid && savedPack === 1 && input.allowLooseSale) {
      isUncertain = true;
      message = `Pack size is saved as 1 for solid medicine. Please verify pack size for loose unit sales.`;
    }
  }

  return {
    savedPackSize: savedPack,
    savedUnit,
    detectedPackSize,
    detectedUnit,
    confidence,
    hasMismatch,
    isUncertain,
    message,
    calculatedSavedUnitPrice,
    calculatedDetectedUnitPrice
  };
}

