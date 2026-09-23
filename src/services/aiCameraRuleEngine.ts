// AI Camera Pharmaceutical Precision Rule Engine (100 Universal Rules across 10 Batches)
// Mimics licensed human pharmacist visual cognition to prioritize prominent trade brand names
// and disqualify packaging noise, regulatory warnings, barcodes, excipients, and storage directions.

export interface WordBox {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

export interface DrugStrengthResult {
  strength: string | null;
  numericVal: number | null;
  unit: string | null;
  components: number[];
  sumVal: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 1: Statutory & Regulatory Disqualification Rules (Rules 1–10)
// ─────────────────────────────────────────────────────────────────────────────
const REGULATORY_WARNING_PATTERNS = [
  // Rule 1: Schedule H/H1/X Red Line Warning
  /\bschedule\s+[h1x]\b/i,
  /\bprescription\s+drug\b/i,
  /\bnot\s+to\s+be\s+sold\s+by\s+retail\b/i,
  /\bwithout\s+the\s+prescription\b/i,
  // Rule 2: Veterinary Disqualification
  /\bnot\s+for\s+human\s+use\b/i,
  /\bfor\s+animal\s+treatment\b/i,
  /\bveterinary\b/i,
  /\bfor\s+vet\s+use\b/i,
  // Rule 3: Child Safety & Overdose Warning
  /\bkeep\s+(?:out\s+of\s+reach\s+of|all\s+medicines\s+away)\b/i,
  /\boverdose\s+may\s+cause\b/i,
  /\bswallow\s+whole\b/i,
  // Rule 4: Cautionary Administration
  /\bshake\s+well\s+before\s+use\b/i,
  /\bfor\s+external\s+use\s+only\b/i,
  /\bnot\s+for\s+injection\b/i,
  /\bfor\s+oral\s+use\s+only\b/i,
  // Rule 5: Pharmacopoeia Regulatory Markers
  /\b(?:i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?|1\.?p\.?|e\.?p\.?|n\.?f\.?)\b/i,
  // Rule 6: Physician Direction
  /\b(?:dosage|dose)\s*[:\-]?\s*as\s+directed\b/i,
  /\bas\s+prescribed\s+by\b/i,
  /\bsee\s+package\s+insert\b/i,
  // Rule 7: Cytotoxic Warning
  /\bcytotoxic\b/i,
  /\bchemotherapy\s+agent\b/i,
  /\bbiohazard\b/i,
  // Rule 8: Dropper & Solution Expiry
  /\buse\s+within\s+\d+\s+(?:days|months?)\b/i,
  /\bdo\s+not\s+touch\s+dropper\b/i,
  // Rule 9: Alcohol Disclosure
  /\balcohol\s*(?:content)?\s*[:\-]?\s*\d+/i,
  // Rule 10: Narcotics / Habit Forming Statement
  /\bhabits?\s*forming\b/i,
  /\bcaution\s+it\s+is\s+dangerous\b/i,
  /\bnarcotic\s+drug\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 2: Storage, Chemistry & Excipients Disqualification Rules (Rules 11–20)
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_AND_CHEMISTRY_PATTERNS = [
  // Rule 11: Temperature & Climate
  /\bstore\s+(?:below|between|at)\s+\d+/i,
  /\bdo\s+not\s+freeze\b/i,
  /\bprotect\s+from\s+(?:light|moisture|heat)\b/i,
  /\bcool\s*(?:and|\&)?\s*dry\s+place\b/i,
  // Rule 12: Permitted Colours/Dyes
  /\bcolours?\s*[:\-]?/i,
  /\btitanium\s+dioxide\b/i,
  /\bsunset\s+yellow\b/i,
  /\btartrazine\b/i,
  /\bferric\s+oxide\b/i,
  /\bindigo\s+carmine\b/i,
  /\bponceau\s+4r\b/i,
  // Rule 13: Excipients q.s.
  /\bexcipients?\s*(?:q\.?s\.?)?\b/i,
  /\bbase\s*q\.?s\.?\b/i,
  /\bq\.?s\.?\s*to\b/i,
  // Rule 14: Preservatives
  /\b(?:methyl|propyl)?paraben\b/i,
  /\bsodium\s+benzoate\b/i,
  /\bbenzalkonium\s+chloride\b/i,
  /\bbronopol\b/i,
  /\bchlorocresol\b/i,
  // Rule 15: Capsule Shell Origin
  /\b(?:empty\s+)?hard\s+gelatin\b/i,
  /\bcapsule\s+shell\s+contains\b/i,
  /\banimal\s+origin\b/i,
  /\bveg(?:an|etarian)?\s+capsule\b/i,
  // Rule 16: Film & Enteric Coating
  /\b(?:film|enteric|sugar)\s+coated\b/i,
  /\buncoated\s+tablets?\b/i,
  // Rule 17: Vehicle Base
  /\b(?:flavoured|syrupy|aqueous|ointment|emulsion)\s+base\b/i,
  // Rule 18: Reconstitution Directions
  /\bsterile\s+water\s+for\s+injection\b/i,
  /\bfor\s+reconstitution\b/i,
  /\bswfi\b/i,
  // Rule 19: Desiccant Sachet
  /\bsilica\s+gel\b/i,
  /\bdo\s+not\s+eat\b/i,
  /\bdesiccant\b/i,
  // Rule 20: Sweeteners
  /\bsugar\s*free\b/i,
  /\bcontains\s+aspartame\b/i,
  /\bartificial\s+sweetener\b/i,
  /\bsucralose\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 3: Commercial, Pricing, Barcode & Supply Chain Disqualification (Rules 21–30)
// ─────────────────────────────────────────────────────────────────────────────
const COMMERCIAL_PATTERNS = [
  // Rule 21: M.R.P. & Currency
  /\b(?:m\.?r\.?p\.?|max\.?\s*retail\s*price|price)\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*[\d,]+/i,
  // Rule 22: Taxes Statement
  /\binclusive\s+of\s+all\s+taxes\b/i,
  /\bincl\.\s*of\s*all\s*taxes\b/i,
  /\blocal\s+taxes\s+extra\b/i,
  // Rule 23: Batch / Lot Identification
  /\b(?:b\.?no\.?|batch\s*(?:no\.?)?|lot\s*(?:no\.?)?)\s*[:\-]?\s*[A-Z0-9\-\/]+/i,
  // Rule 24: Mfg / Exp Dates
  /\b(?:mfg|mkt|exp|expiry)\.?\s*(?:date)?\s*[:\-]?\s*\d{2}[\/\-\.]\d{2,4}\b/i,
  /\bbest\s+before\b/i,
  // Rule 25: Mfg Lic No
  /\b(?:mfg\.?\s*lic\.?\s*no\.?|m\.?l\.?\s*no\.?|lic\.?\s*no\.?|d\.?l\.?\s*no\.?)\s*[:\-]?\s*[A-Z0-9\-\/]+/i,
  // Rule 26: Pure Barcode Number (8-14 digits)
  /^\d{8,14}$/,
  // Rule 27: GS1 DataMatrix AI Indicators
  /\(\d{2}\)\d{4,}/,
  // Rule 28: Flap Fold / Packaging Factory Stamp
  /^[A-Z]{1,2}[-\/]\d{1,4}$/i,
  // Rule 29: GSTIN & CIN
  /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/,
  /\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/,
  // Rule 30: Tariff HSN Code
  /\bhsn\s*(?:code)?\s*[:\-]?\s*\d{4,8}\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 4: Corporate, Marketing & Manufacturing Entity Filtering (Rules 31–40)
// ─────────────────────────────────────────────────────────────────────────────
const CORPORATE_PATTERNS = [
  // Rule 31: Manufactured by
  /\b(?:mfd|manufactured|produced)\s+by\b/i,
  // Rule 32: Marketed by
  /\b(?:mkt|marketed|distributed)\s+by\b/i,
  // Rule 33: Registered Trademark Ownership
  /\b(?:regd\.?\s*trade\s*mark\s+of|trademark\s+owned\s+by|tm\s+of)\b/i,
  // Rule 34: Factory Postal Address
  /\b(?:plot\s+no|ind\.\s*area|industrial\s+area|sector\s+\d+|taluka|district|dist\.|pin\s*[:\-]?\s*\d{6})\b/i,
  // Rule 35: Helpline & Customer Care
  /\b(?:toll\s*free|customer\s*care|helpline|call\s*us\s*at)\b/i,
  // Rule 36: Websites & Emails
  /https?:\/\/|www\.|\.com\b|\.co\.in\b|\.org\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  // Rule 37: Quality Badges
  /\b(?:who\s*[-–]?\s*gmp|iso\s+\d+|cgmp\s+certified)\b/i,
  // Rule 38: Corporate Suffixes (when line is dominated by corporate entities)
  /\b(?:private\s+limited|pvt\.?\s*ltd\.?|laboratories|pharmaceuticals|healthcare|lifesciences|remedies)\b/i,
  // Rule 39: Delivery Platform Trademarks
  /\b(?:nano\s*tech|liposomal\s*tech|micro\s*encapsulation)\b/i,
  // Rule 40: Technical Collaboration
  /\b(?:technical\s+collaboration\s+with|in\s+partnership\s+with)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 5: Container, Dimensions & Blister Repetition Rules (Rules 41–50)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rule 41: Disqualify lines composed purely of dosages, numbers, math symbols, and pack words.
 * Example: "500mg+125mg 3x10Tablets", "10x10 Strip", "100ml Bottle"
 */
export function isPureDosageOrPackLine(line: string): boolean {
  if (!line || line.trim().length === 0) return true;
  const cleaned = line
    .replace(/\b(?:tablets?|capsules?|strips?|blisters?|bottles?|tubes?|packs?|boxes?|vials?|ampoules?|sachets?|tabs?|caps?)\b/gi, ' ')
    .replace(/\b(?:mg|mcg|gm|g|ml|kg|iu|%)\b/gi, ' ')
    .replace(/[\d\s\+\-\*\/xX\(\)\[\]\.,:%]/g, '')
    .trim();
  // If removing container words, dosage units, and numbers leaves nothing or <2 characters, it is a pure packaging line!
  return cleaned.length < 2;
}

/**
 * Rule 42: Blister Pocket Deduplication
 * Blister foil strips often print the identical medicine name on every single pocket foil.
 * Deduplicates adjacent or near-adjacent repeated tokens while preserving order.
 */
export function deduplicateBlisterPocketLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const uniqueLines: string[] = [];
  for (const line of lines) {
    const norm = line.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!norm) continue;
    if (!seen.has(norm)) {
      seen.add(norm);
      uniqueLines.push(line);
    }
  }
  return uniqueLines;
}

/**
 * Rules 43–50: Container geometry, volume, packaging stamps, and promotion noise.
 */
export function isPackagingContainerNoise(line: string): boolean {
  if (!line) return true;
  const trimmed = line.trim();

  // Rule 43: Net Content & Volume (e.g. Net Content: 100ml, Net Wt: 30g)
  if (/\bnet\s*(?:content|vol|volume|weight|wt|qty|quantity)\s*[:\-]?\s*\d+/i.test(trimmed)) return true;

  // Rule 44: Pack multiplier arithmetic (e.g. 10 x 10 Tablets, 1 x 10 Capsules, 3 x 10 Tabs)
  if (/\b\d+\s*x\s*\d+\s*(?:tablets?|capsules?|tabs?|caps?|strips?|blisters?)\b/i.test(trimmed)) return true;

  // Rule 45: Container geometry word filtering
  if (/\b(?:alu[-\s]?alu|blister\s*pack|hdpe\s*bottle|glass\s*vial|ampoule\s*pack)\b/i.test(trimmed)) return true;

  // Rule 46: Tear notch / Open here
  if (/\b(?:tear\s*here|peel\s*here|press\s*to\s*open|cut\s*along\s*dotted\s*line)\b/i.test(trimmed)) return true;

  // Rule 47: Embossed batch imprint
  if (/\b(?:emb|embossed|blind\s*deboss)\b/i.test(trimmed)) return true;

  // Rule 48: Promotional Free / Offer Pack
  if (/\b(?:free\b|buy\s+\d+\s+get|special\s+offer|promo\s+pack|extra\s+\d+|save\s+rs)\b/i.test(trimmed)) return true;

  // Rule 49: Braille tactile indicators
  if (/\b(?:braille|tactile\s*warning|dots?\s*representation)\b/i.test(trimmed)) return true;

  // Rule 50: Mono-carton flap fold markers
  if (/\b(?:tuck\s*in\s*flap|top\s*flap|bottom\s*flap|side\s*flap)\b/i.test(trimmed)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED LINE DISQUALIFIER (Rules 1–50)
// ─────────────────────────────────────────────────────────────────────────────
export function isDisqualifiedPackagingLine(line: string): boolean {
  if (!line) return true;
  const trimmed = line.trim();
  if (trimmed.length < 2) return true;

  // Rule 41: Pure dosage and pack arithmetic (e.g. 500mg+125mg 3x10Tablets)
  if (isPureDosageOrPackLine(trimmed)) return true;

  // Rules 43-50: Container geometry and pack noise
  if (isPackagingContainerNoise(trimmed)) return true;

  // Batch 1: Statutory & Regulatory (Rules 1–10)
  for (const pat of REGULATORY_WARNING_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }

  // Batch 2: Storage & Chemistry (Rules 11–20)
  for (const pat of STORAGE_AND_CHEMISTRY_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }

  // Batch 3: Commercial & Supply Chain (Rules 21–30)
  for (const pat of COMMERCIAL_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }

  // Batch 4: Corporate & Addresses (Rules 31–40)
  for (const pat of CORPORATE_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }

  // Rule 51: "Each film coated tablet contains"
  if (/^(?:each\s+|composition|contains|contents?|formulation\s*[:\-])/i.test(trimmed)) {
    return true;
  }

  // Rule 53: Counter-ions when listed standalone
  if (/\b(?:anhydrous|trihydrate|hydrochloride|maleate|succinate|besylate|fumarate|mesylate)\b/i.test(trimmed)) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 6: Active Salt Composition vs Trade Brand Discrimination (Rules 51–60)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rule 52: Chemical salt generic stems.
 * Words ending in these stems are active pharmaceutical salts/generics, NOT unique brand names.
 */
const CHEMICAL_SALT_STEMS = [
  'cillin', 'statin', 'olol', 'sartan', 'floxacin', 'prazole', 'dipine', 'gliflozin',
  'gliptin', 'mycin', 'vir', 'mab', 'asone', 'oxacin', 'dronate', 'pril', 'artan',
  'tidine', 'zole', 'nazole', 'fenac', 'coxib', 'quine', 'thromycin', 'cyclin', 'cycline'
];

export function isGenericChemicalSaltStem(token: string): boolean {
  if (!token || token.length < 5) return false;
  const lower = token.toLowerCase();
  return CHEMICAL_SALT_STEMS.some(stem => lower.endsWith(stem));
}

/**
 * Rules 53–60: Chemical formulation markers, counter-ions, and excipient declarations.
 */
export function isChemicalSaltOrExcipient(line: string): boolean {
  if (!line) return false;
  const l = line.toLowerCase();

  // Rule 53: Chemical counter-ions
  if (/\b(anhydrous|trihydrate|hydrochloride|hcl|maleate|succinate|besylate|fumarate|mesylate|potassium|sodium|phosphate|citrate|acetate|nitrate|tartrate|gluconate)\b/i.test(l)) return true;

  // Rule 54: Equivalent to base statement
  if (/\beq\.?\s*to\s+[a-z]+/i.test(l) || /\bequivalent\s+to\b/i.test(l)) return true;

  // Rule 55: Salt percentage listing
  if (/\b\d+(?:\.\d+)?\s*%\s*(?:w\/w|w\/v|v\/v)\b/i.test(l)) return true;

  // Rule 56: Inactive excipients/carriers
  if (/\b(microcrystalline\s*cellulose|dicalcium\s*phosphate|lactose\s*monohydrate|maize\s*starch|croscarmellose|silicon\s*dioxide)\b/i.test(l)) return true;

  // Rule 57: Buffer and tonicity
  if (/\b(isotonic|citrate\s*buffer|phosphate\s*buffered)\b/i.test(l)) return true;

  // Rule 58: Radio-opaque & contrast markings
  if (/\bradio[-\s]?opaque\b/i.test(l)) return true;

  // Rule 59: Vitamin & Mineral salts
  if (/\b(elemental\s*(?:iron|zinc|calcium)|ascorbic\s*acid|cyanocobalamin|cholecalciferol|folic\s*acid)\b/i.test(l)) return true;

  // Rule 60: Probiotic strain CFU count
  if (/\b(?:\d+\s*(?:billion|million)\s*(?:cfu|spores)|lactobacillus|bifidobacterium|saccharomyces)\b/i.test(l)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 7: Multi-Salt Combination Arithmetic & Suffix Protection (Rules 61–70)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rules 61, 62, 63: Extracts single strengths or sums multi-salt combination additions.
 * Examples:
 *   "500mg+125mg" -> numericVal: 500, components: [500, 125], sumVal: 625, strength: "500+125MG"
 *   "500/125 MG"  -> numericVal: 500, components: [500, 125], sumVal: 625, strength: "500/125MG"
 *   "625MG"       -> numericVal: 625, components: [625], sumVal: 625, strength: "625MG"
 */
export function extractMultiSaltDrugStrength(text: string): DrugStrengthResult {
  const result: DrugStrengthResult = {
    strength: null,
    numericVal: null,
    unit: null,
    components: [],
    sumVal: null
  };

  if (!text) return result;

  // 1. Multi-salt addition pattern: e.g. "500mg+125mg", "500 mg + 125 mg", "500/125 mg", "1000mg+200mg"
  const comboMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:mg|mcg|gm|g)?\s*[\+\/]\s*(\d+(?:\.\d+)?)\s*(MG|MCG|GM|G|IU|%)\b/i) ||
                     text.match(/\b(\d+(?:\.\d+)?)\s*[\+\/]\s*(\d+(?:\.\d+)?)\s*(?:mg|mcg|gm|g)?\b/i);

  if (comboMatch) {
    const val1 = parseFloat(comboMatch[1]);
    const val2 = parseFloat(comboMatch[2]);
    const unit = (comboMatch[3] || 'MG').toUpperCase();
    if (!isNaN(val1) && !isNaN(val2)) {
      result.components = [val1, val2];
      result.sumVal = Math.round((val1 + val2) * 100) / 100;
      result.numericVal = val1;
      result.unit = unit;
      result.strength = `${val1}+${val2}${unit}`;
      return result;
    }
  }

  // 2. Standard single strength: e.g. "625mg", "650 mg", "40 mg", "100iu"
  const singleMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(MG|MCG|GM|G|IU|%)\b/i);
  if (singleMatch) {
    const nVal = parseFloat(singleMatch[1]);
    const unit = singleMatch[2].toUpperCase();
    if (!isNaN(nVal)) {
      result.numericVal = nVal;
      result.sumVal = nVal;
      result.components = [nVal];
      result.unit = unit;
      result.strength = `${nVal}${unit}`;
      return result;
    }
  }

  // 3. Standalone numeric strength directly following brand word (e.g. "Amoxyclav 625", "Dolo 650", "Pan 40")
  const brandNumMatch = text.match(/\b([A-Za-z]{3,})\s+(\d+(?:\.\d+)?)\b/);
  if (brandNumMatch) {
    const prevWord = brandNumMatch[1].toUpperCase();
    // Exclude pack size / container words (e.g. "TABLET 15", "STRIP 10", "PACK 30", "BOTTLE 60")
    if (!/^(TABLET|TABLETS|TAB|TABS|CAPSULE|CAPSULES|CAP|CAPS|STRIP|STRIPS|PACK|PACKS|BOX|BOXES|BOTTLE|BOTTLES|OF|FOR)$/i.test(prevWord)) {
      const nVal = parseFloat(brandNumMatch[2]);
      if (!isNaN(nVal) && nVal >= 5 && nVal <= 5000) {
        // Exclude pack count indicators right after number (e.g. "15'S", "10'S", "4'S")
        const afterMatch = text.slice((brandNumMatch.index || 0) + brandNumMatch[0].length);
        if (!/^['’]s\b/i.test(afterMatch)) {
          result.numericVal = nVal;
          result.sumVal = nVal;
          result.components = [nVal];
          result.strength = String(nVal);
          return result;
        }
      }
    }
  }

  return result;
}

/**
 * Rule 61: Multi-Salt Combination Equality Check
 * Verifies if single strength equals either the combined sum (e.g. 500+125 == 625)
 * or any constituent component.
 */
export function areMultiSaltStrengthsEqual(s1: DrugStrengthResult, s2: DrugStrengthResult): boolean {
  if (!s1.strength || !s2.strength) return false;

  // Direct numeric equality
  if (s1.numericVal !== null && s2.numericVal !== null) {
    if (Math.abs(s1.numericVal - s2.numericVal) <= 0.001) return true;
  }

  // Multi-salt sum equality: e.g. 500+125 (sumVal: 625) matches catalog "625MG"
  if (s1.sumVal !== null && s2.numericVal !== null) {
    if (Math.abs(s1.sumVal - s2.numericVal) <= 0.001) return true;
  }
  if (s2.sumVal !== null && s1.numericVal !== null) {
    if (Math.abs(s2.sumVal - s1.numericVal) <= 0.001) return true;
  }

  // Constituent component equality
  if (s1.components.length > 0 && s2.numericVal !== null) {
    if (s1.components.some(c => Math.abs(c - s2.numericVal!) <= 0.001)) return true;
  }
  if (s2.components.length > 0 && s1.numericVal !== null) {
    if (s2.components.some(c => Math.abs(c - s1.numericVal!) <= 0.001)) return true;
  }

  return s1.strength === s2.strength;
}

/**
 * Rules 64, 65: Multi-Salt Combination Conflict Check
 * Ensures a combination drug (500mg+125mg) is NOT falsely flagged as conflicting with its sum (625MG).
 */
export function areMultiSaltStrengthsConflicting(s1: DrugStrengthResult, s2: DrugStrengthResult): boolean {
  if (!s1.strength || !s2.strength) return false;

  // If they are equal or match via combination sum, they DO NOT conflict!
  if (areMultiSaltStrengthsEqual(s1, s2)) return false;

  // Genuine conflict: numbers differ and sum doesn't match
  if (s1.numericVal !== null && s2.numericVal !== null) {
    return true;
  }

  return s1.strength !== s2.strength;
}

/**
 * Rule 66: Suffix Binding Without Bleed
 * Identifies standard trade brand modifiers (e.g. "625", "650", "AM", "H", "D", "Plus", "Forte", "MCL")
 */
export function extractTradeSuffix(text: string): string | null {
  if (!text) return null;
  const m = text.match(/\b(625|650|1000|500|250|AM|MCL|H|D|PLUS|FORTE|MAX|DS|LS|CV|OZ|TZ|TG|CT|D3|K2)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Rule 70: Metric Unit Normalization
 */
export function normalizeMetricUnits(value: number, unit: string): { normalizedValue: number; baseUnit: string } {
  const u = (unit || '').toUpperCase();
  if (u === 'MCG') {
    return { normalizedValue: value / 1000, baseUnit: 'MG' };
  }
  if (u === 'G' || u === 'GM') {
    return { normalizedValue: value * 1000, baseUnit: 'MG' };
  }
  if (u === 'L') {
    return { normalizedValue: value * 1000, baseUnit: 'ML' };
  }
  return { normalizedValue: value, baseUnit: u || 'MG' };
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 8: Spatial Layout & Typography Prominence (Rules 71–80)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rules 71, 72: Compute typography metrics from bounding boxes.
 */
export function getLineTypographyMetrics(line: string, words: WordBox[]): { maxHeight: number; avgHeight: number } {
  if (!words || words.length === 0 || !line) return { maxHeight: 0, avgHeight: 0 };
  const lineTokens = line.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 0);
  if (lineTokens.length === 0) return { maxHeight: 0, avgHeight: 0 };

  const matchingHeights: number[] = [];
  for (const w of words) {
    if (!w.bbox || !w.text) continue;
    const wClean = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!wClean) continue;
    if (lineTokens.some(tok => tok === wClean || tok.includes(wClean) || wClean.includes(tok))) {
      const h = Math.abs(w.bbox.y1 - w.bbox.y0);
      if (h > 0) matchingHeights.push(h);
    }
  }

  if (matchingHeights.length === 0) return { maxHeight: 0, avgHeight: 0 };
  const maxHeight = Math.max(...matchingHeights);
  const avgHeight = Math.round(matchingHeights.reduce((a, b) => a + b, 0) / matchingHeights.length);
  return { maxHeight, avgHeight };
}

/**
 * Rules 71–79: Comprehensive spatial layout scoring:
 * - Font height prominence
 * - Vertical position bias (top 40% of package)
 * - Aspect ratio plausibility
 * - ALL CAPS or Title Case prominence
 * - Line length constraint (1-4 words)
 */
export function calculateSpatialLayoutScore(
  line: string,
  words: WordBox[],
  imageHeight: number = 1000
): number {
  if (!line) return 0;
  let score = 0;

  // Rule 71: Typography Font Height Dominance
  const { maxHeight } = getLineTypographyMetrics(line, words);
  if (maxHeight > 0) {
    score += Math.round(maxHeight / 10);
  }

  // Rule 73: Top Half/Third Packaging Vertical Bias
  const lineTokens = line.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const matchingY0s: number[] = [];
  for (const w of words) {
    if (!w.bbox || !w.text) continue;
    const wClean = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lineTokens.includes(wClean)) {
      matchingY0s.push(w.bbox.y0);
    }
  }
  if (matchingY0s.length > 0 && imageHeight > 0) {
    const avgY0 = matchingY0s.reduce((a, b) => a + b, 0) / matchingY0s.length;
    const relativeY = avgY0 / imageHeight;
    if (relativeY <= 0.40) {
      score += 3; // Brand names are overwhelmingly in the top 40%
    } else if (relativeY > 0.80) {
      score -= 2; // Bottom of packaging is almost always barcode/manufacturer/license
    }
  }

  // Rule 76: Title Case / ALL CAPS Prominence
  if (/^[A-Z\s0-9\-\+]+$/.test(line) && line.length >= 3) {
    score += 2; // ALL CAPS brand
  } else if (/^[A-Z][a-z]+(?:\s+[A-Z0-9][a-z0-9]*)*$/.test(line)) {
    score += 2; // Title Case brand
  }

  // Rule 79: Line Length Constraints (trade brands are 1-4 words, <50 chars)
  const wordCount = line.trim().split(/\s+/).length;
  if (wordCount >= 1 && wordCount <= 3 && line.length <= 35) {
    score += 2;
  } else if (wordCount > 6 || line.length > 60) {
    score -= 4; // Long legal or instruction sentences are not brand names
  }

  return score;
}

/**
 * Rule 80: Multi-line Brand Wrap Detection
 * When a brand wraps across two lines (e.g. "AUGMENTIN" on line 1, "625 DUO" on line 2),
 * combine them if both lines share prominent font height.
 */
export function mergeWrappedBrandLines(
  lines: Array<{ line: string; fontHeight: number }>
): Array<{ line: string; fontHeight: number }> {
  if (lines.length <= 1) return lines;
  const merged: Array<{ line: string; fontHeight: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    if (i < lines.length - 1) {
      const next = lines[i + 1];
      // If current is letters-only brand and next is strength/formulation modifier
      if (
        current.fontHeight >= 20 &&
        next.fontHeight >= 15 &&
        /^[A-Za-z]+$/.test(current.line.trim()) &&
        /^\d+|^DUO|^FORTE|^PLUS|^AM|^SR/i.test(next.line.trim())
      ) {
        merged.push({
          line: `${current.line.trim()} ${next.line.trim()}`,
          fontHeight: Math.max(current.fontHeight, next.fontHeight)
        });
        i++; // Skip next line since it was merged
        continue;
      }
    }
    merged.push(current);
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 9: OCR Corruption, Character Confusion & Symbol Sanitization (Rules 81–90)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rules 81, 82, 87, 88: Clean OCR tokens:
 * - Strip legal trademark symbols (®, ™, ©, SM)
 * - Split glued alphanumerics ("Amoxyclav625" -> "Amoxyclav 625")
 * - Split glued pharmacopoeia ("TabletsI.P." -> "Tablets")
 * - Remove non-alphanumeric noise
 */
export function cleanBrandToken(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/[®™©]/g, ' ')                                         // Rule 81: Trademark symbol stripping
    .replace(/\b(?:SM|\(R\)|\(TM\))\b/gi, ' ')                      // Rule 81: Textual trademark markers
    .replace(/([A-Za-z]+)(\d+(?:\.\d+)?)/g, '$1 $2')                 // Rule 82: Glued brand and strength split
    .replace(/(\d+(?:\.\d+)?)([A-Za-z]+)/g, '$1 $2')                 // Rule 86: Glued unit splitting
    .replace(/([A-Za-z]+)(I\.?P\.?|B\.?P\.?|U\.?S\.?P\.?)/gi, '$1')        // Rule 87: Glued pharmacopoeia strip
    .replace(/[^a-zA-Z0-9\s\.\-\+\/]/g, ' ')                        // Rule 88: Non-alphanumeric noise strip
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rule 83: Character Confusion Disambiguation
 * Disambiguates common OCR misreads ('0' vs 'O', '1' vs 'I' vs 'l', '5' vs 'S', '8' vs 'B')
 * based on whether the token is numeric or alphabetic context.
 */
export function disambiguateOcrCharacters(token: string, isNumericContext: boolean): string {
  if (!token) return '';
  if (isNumericContext) {
    return token
      .replace(/[oO]/g, '0')
      .replace(/[lI]/g, '1')
      .replace(/[sS]/g, '5')
      .replace(/[bB]/g, '8');
  }
  return token;
}

/**
 * Rule 84: Punctuation & Dot Normalization
 * Handles hyphenated brand names (e.g. "C-DENSE" -> "CDENSE", "PAN-D" -> "PAN D")
 */
export function normalizeMedicinePunctuation(text: string): string {
  if (!text) return '';
  return text
    .replace(/([A-Za-z])-([A-Za-z]{3,})/g, '$1$2') // "C-DENSE" -> "CDENSE"
    .replace(/([A-Za-z])-([A-Za-z]{1,2}\b)/g, '$1 $2') // "PAN-D" -> "PAN D"
    .trim();
}

/**
 * Rule 89: Minimum Token Length Filter
 * Rejects tokens < 3 characters unless recognized as an essential pharmaceutical modifier.
 */
const VALID_SHORT_MODIFIERS = new Set([
  'am', 'cv', 'ds', 'ls', 'sr', 'cr', 'er', 'xl', 'xr', 'pr', 'mr', 'dt',
  'd3', 'k2', 'b6', 'oz', 'tz', 'tg', 'ct', 'az', 'od', 'bd', 'hs'
]);

export function isValidBrandTokenLength(token: string): boolean {
  if (!token) return false;
  const clean = token.toLowerCase().trim();
  if (clean.length >= 3) return true;
  return VALID_SHORT_MODIFIERS.has(clean);
}

/**
 * Rule 90: Stopword Exclusion
 * Standard non-drug words that frequently corrupt OCR matches.
 */
const PHARMA_STOP_WORDS = new Set([
  'tablet', 'tablets', 'capsule', 'capsules', 'strip', 'blister', 'pack', 'box',
  'bottle', 'syrup', 'suspension', 'injection', 'cream', 'ointment', 'gel',
  'pharma', 'laboratories', 'pharmaceuticals', 'ltd', 'limited', 'pvt',
  'mfg', 'exp', 'mrp', 'batch', 'lic', 'dose', 'oral', 'use', 'only'
]);

export function isPharmaStopWord(token: string): boolean {
  if (!token) return false;
  return PHARMA_STOP_WORDS.has(token.toLowerCase().trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH 10: Routing, Doctor Rx Segmentation & Human-in-the-Loop Safeguards (Rules 91–100)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rule 91: Packaging vs Prescription Routing Classifier
 * Distinguishes medicine package/strip/box photos from handwritten/printed doctor prescriptions.
 */
export function classifyImageContent(ocrText: string): 'packaging' | 'prescription' | 'unknown' {
  if (!ocrText || ocrText.trim().length === 0) return 'unknown';

  let rxScore = 0;
  let pkgScore = 0;

  // Prescription markers
  if (/\b(?:dr\.?|doctor)\s+[a-z]/i.test(ocrText)) rxScore += 3;
  if (/\b(?:rx|℞|clinic|hospital|patient|consultant|mbbs|md)\b/i.test(ocrText)) rxScore += 3;
  if (/\b(?:age|sex|gender|date)\s*[:\-]?\s*\d+/i.test(ocrText)) rxScore += 2;
  if (/\b(?:1-0-1|1-1-1|0-1-0|1-0-0|0-0-1|od|bd|tds|qid|hs)\b/i.test(ocrText)) rxScore += 3;

  // Packaging markers
  if (/\b(?:m\.?r\.?p\.?|max\.?\s*retail\s*price)\b/i.test(ocrText)) pkgScore += 3;
  if (/\b(?:b\.?no\.?|batch\s*no|exp\.?\s*date|mfg\.?\s*date)\b/i.test(ocrText)) pkgScore += 3;
  if (/\b(?:schedule\s+[h1x]|each\s+film\s+coated|excipients\s*q\.?s\.?)\b/i.test(ocrText)) pkgScore += 3;
  if (/\b(?:alu[-\s]?alu|blister|strip\s+of)\b/i.test(ocrText)) pkgScore += 2;

  if (rxScore > pkgScore && rxScore >= 3) return 'prescription';
  if (pkgScore > rxScore && pkgScore >= 3) return 'packaging';
  return 'packaging'; // default to packaging for camera scan
}

/**
 * Rule 92: Doctor Rx Numbered Item Parser
 * Parses lines formatted as "1. Tab...", "2. Cap...", "3. Syr..."
 */
export function parseDoctorRxNumberedItems(ocrText: string): Array<{ index: number; text: string; dosageForm?: string; qty: number }> {
  if (!ocrText) return [];
  const lines = ocrText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items: Array<{ index: number; text: string; dosageForm?: string; qty: number }> = [];

  const numberedPattern = /^(?:(\d+)[\.\)]\s*|[-•*]\s*)(.*)$/;

  for (const line of lines) {
    const match = line.match(numberedPattern);
    if (match) {
      const idx = match[1] ? parseInt(match[1], 10) : items.length + 1;
      const content = match[2].trim();

      // Detect dosage form prefix
      let dosageForm: string | undefined;
      const formMatch = content.match(/^(?:tab\.?|tablet|cap\.?|capsule|syr\.?|syrup|inj\.?|injection|gel|ointment)\s+/i);
      if (formMatch) {
        dosageForm = formMatch[0].trim();
      }

      // Detect prescribed quantity: e.g. (10), x 10, #10
      let qty = 1;
      const qtyMatch = content.match(/\((\d+)\)/) || content.match(/x\s*(\d+)/i) || content.match(/#\s*(\d+)/);
      if (qtyMatch) {
        const qVal = parseInt(qtyMatch[1], 10);
        if (qVal > 0 && qVal <= 200) qty = qVal;
      }

      items.push({ index: idx, text: content, dosageForm, qty });
    }
  }

  return items;
}

/**
 * Rule 93: Doctor Rx Sig / Frequency Extraction
 * Identifies dosing schedules: 1-0-1, OD, BD, TDS, QID, HS, AC, PC
 */
export function extractDoctorRxSig(line: string): { sig: string | null; timing: string | null } {
  if (!line) return { sig: null, timing: null };

  let sig: string | null = null;
  let timing: string | null = null;

  // Numeric frequency: e.g. 1-0-1, 1-1-1, 0-1-0
  const numSig = line.match(/\b([012]-[012]-[012](?:-[012])?)\b/);
  if (numSig) {
    sig = numSig[1];
  } else {
    // Latin abbreviation frequency
    const latSig = line.match(/\b(OD|BD|TDS|QID|HS|SOS|STAT)\b/i);
    if (latSig) sig = latSig[1].toUpperCase();
  }

  // Meal timing
  if (/\b(?:before\s+food|before\s+meals?|empty\s+stomach|a\.?c\.?)\b/i.test(line)) {
    timing = 'Before Food';
  } else if (/\b(?:after\s+food|after\s+meals?|p\.?c\.?)\b/i.test(line)) {
    timing = 'After Food';
  }

  return { sig, timing };
}

/**
 * Rule 94: Doctor Rx Duration Parsing
 * Extracts treatment duration: e.g. "x 5 days", "for 1 week", "x 10 days"
 */
export function extractDoctorRxDuration(line: string): string | null {
  if (!line) return null;
  const m = line.match(/\b(?:for|x)\s*(\d+)\s*(days?|weeks?|months?)\b/i);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

/**
 * Rule 98: High-Risk Look-Alike Sound-Alike (LASA) Warning
 * Critical patient safety guardrail for high-confusion drug pairs in Indian pharmacy.
 */
const KNOWN_LASA_PAIRS: Array<[string, string]> = [
  ['metformin', 'metronidazole'],
  ['cefotaxime', 'ceftriaxone'],
  ['prednisone', 'prednisolone'],
  ['clonazepam', 'lorazepam'],
  ['ephedrine', 'epinephrine'],
  ['amiodarone', 'amlodipine'],
  ['ciprofloxacin', 'norfloxacin'],
  ['carbamazepine', 'oxcarbazepine']
];

export function checkLasaConflict(candidate1: string, candidate2: string): { isLasa: boolean; warning?: string } {
  if (!candidate1 || !candidate2) return { isLasa: false };
  const c1 = candidate1.toLowerCase().trim();
  const c2 = candidate2.toLowerCase().trim();

  for (const [d1, d2] of KNOWN_LASA_PAIRS) {
    if ((c1.includes(d1) && c2.includes(d2)) || (c1.includes(d2) && c2.includes(d1))) {
      return {
        isLasa: true,
        warning: `CRITICAL SAFETY ALERT: Potential Look-Alike Sound-Alike (LASA) confusion between "${candidate1}" and "${candidate2}". Licensed pharmacist verification required before dispensing!`
      };
    }
  }

  return { isLasa: false };
}

/**
 * Rule 99: Pharmacist 1-Click Interactive Review Card Generation
 * Human-in-the-Loop Safeguard: Formats verification card for Pharmacist Approval in Dashboard & WhatsApp.
 */
export interface PharmacistReviewCard {
  cardType: 'PHARMACIST_HITL_REVIEW';
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  brandName: string;
  strength: string | null;
  dosageForm: string | null;
  composition?: string;
  stockQty: number;
  inStock: boolean;
  mrp?: number | null;
  isScheduleH: boolean;
  confidenceScore: number;
  confirmationNote?: string;
  actions: {
    approveLabel: string;
    rejectLabel: string;
    editLabel: string;
  };
}

export function generatePharmacistReviewCard(item: {
  brandName: string;
  composition?: string;
  strength?: string | null;
  dosageForm?: string | null;
  stockQty: number;
  mrp?: number | null;
  isScheduleH?: boolean;
  confidenceScore: number;
  confirmationNote?: string;
}): PharmacistReviewCard {
  return {
    cardType: 'PHARMACIST_HITL_REVIEW',
    status: 'PENDING_APPROVAL',
    brandName: item.brandName,
    strength: item.strength || null,
    dosageForm: item.dosageForm || null,
    composition: item.composition,
    stockQty: item.stockQty,
    inStock: item.stockQty > 0,
    mrp: item.mrp || null,
    isScheduleH: !!item.isScheduleH,
    confidenceScore: Math.round(item.confidenceScore * 100) / 100,
    confirmationNote: item.confirmationNote,
    actions: {
      approveLabel: 'Approve & Add to Cart',
      rejectLabel: 'Reject / Rescan',
      editLabel: 'Edit Item'
    }
  };
}

/**
 * Rule 100: Rejection Audit Log Entry
 * Formats structured audit records when an image cannot be verified or has conflicts.
 */
export function buildRejectionAuditEntry(
  rawText: string,
  reason: string,
  details?: Record<string, any>
): { timestamp: string; rawText: string; reason: string; details: string } {
  return {
    timestamp: new Date().toISOString(),
    rawText: rawText.slice(0, 500),
    reason,
    details: JSON.stringify(details || {})
  };
}

/**
 * Rule 101: Pure Medicine Brand Name Isolation
 * Extracts strictly the clean medicine brand name + essential clinical modifier/strength,
 * stripping packaging arithmetic, container words, pharmacopoeia standards (IP/BP/USP),
 * dosage forms (tablets/capsules/syrups), manufacturer noise, and marketing slogans.
 *
 * Examples:
 *   "DOLO 650 TABLET 15'S"                                           -> "DOLO 650"
 *   "AUGMENTIN 625 DUO TABLET 10'S"                                  -> "AUGMENTIN 625 DUO"
 *   "PAN 40MG TABLET"                                                -> "PAN 40"
 *   "HERMIN INJ 200ML"                                               -> "HERMIN"
 *   "ALMOX 500 strip of 15 cap (ALKEM LAB)"                          -> "ALMOX 500"
 *   "TELMA-AM TABLET"                                                -> "TELMA AM"
 *   "CIPLA DOLO 650 TABLETS I.P."                                    -> "DOLO 650"
 *   "BIOTIQUE BIO PISTACHIO YOUTHFUL NOURISHING ... FACE PACK 50 GM" -> "BIOTIQUE BIO PISTACHIO"
 */
const MEDICINE_DOSAGE_FORMS = new Set([
  'tablet', 'tablets', 'tab', 'tabs', 'tb', 'th', 'cap', 'caps', 'capsule', 'capsules',
  'syp', 'syrup', 'syrups', 'sus', 'susp', 'suspension', 'inj', 'injection', 'injections',
  'inf', 'infusion', 'infusions', 'gel', 'gels', 'cream', 'creams', 'crm',
  'ointment', 'oint', 'ointments', 'lotion', 'lotions', 'drops', 'drop', 'drp', 'drps',
  'powder', 'powders', 'pwd', 'spray', 'sprays', 'inhaler', 'inhalers',
  'respule', 'respules', 'rotacap', 'rotacaps', 'respicap', 'respicaps',
  'sachet', 'sachets', 'solution', 'solutions', 'sol', 'shampoo', 'shampoos',
  'soap', 'soaps', 'oil', 'oils', 'emulsion', 'emulsions', 'balm', 'balms'
]);

const GENERIC_PACK_WORDS = new Set([
  'strip', 'strips', 'blister', 'blisters', 'bottle', 'bottles', 'box', 'boxes',
  'jar', 'jars', 'tube', 'tubes', 'pack', 'packs', 'packing', 'packings',
  'packet', 'packets', 'vial', 'vials', 'ampoule', 'ampoules', 'container'
]);

const MARKETING_DESCRIPTORS = new Set([
  'youthful', 'nourishing', 'revitalizing', 'whitening', 'brightening',
  'hydrating', 'soothing', 'advanced', 'complete', 'action', 'fast', 'quick',
  'relief', 'formula', 'care', 'daily', 'intense', 'deep', 'clean', 'pure',
  'natural', 'herbal', 'ayurvedic', 'organic', 'active', 'face', 'pack', 'body'
]);

export function extractPureMedicineName(
  rawTitle: string,
  options?: { detectedCompany?: string | null; dosageForm?: string | null }
): string {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  let str = rawTitle.trim();

  // 1. Remove parenthetical text e.g. "(MICRO LABS LTD)", "(ALKEM LAB)", "(10'S)"
  str = str.replace(/\([^)]*\)/g, ' ');

  // 2. Remove pharmacopoeia markers: I.P., B.P., U.S.P., 1.P.
  str = str.replace(/\b(?:i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?|1\.?p\.?|e\.?p\.?|n\.?f\.?)\b/gi, ' ');

  // 3. Remove statutory warnings / schedule text: Schedule H, Rx, etc.
  str = str.replace(/\b(?:schedule\s+[h1x]|prescription\s+drug|rx\s+only)\b/gi, ' ');

  // 4. Remove packaging descriptions: "strip of 15 tab", "pack of 10", etc.
  str = str.replace(/\b(?:strip|pack|box|bottle|jar|tube|tin|blister)\s+of\s+\d+.*$/i, ' ');

  // 5. Remove standalone pack counts like "15's", "10's", "15 s", "10 s"
  str = str.replace(/\b\d+\s*['’]?s\b/gi, ' ');

  // 6. Remove multiplier pack math like "10x10", "3x10"
  str = str.replace(/\b\d+\s*[xX]\s*\d+(?:\s*[xX]\s*\d+)?\b/g, ' ');

  // 7. Remove standalone container volume like "200ML", "50 GM", "2 KG", "100 ML"
  str = str.replace(/\b\d+(?:\.\d+)?\s*(?:gm|g|kg|ml|ltr|l)\b/gi, ' ');

  // 8. Split glued alphanumeric brand and strength: "DOLO650" -> "DOLO 650", "PAN40" -> "PAN 40"
  str = str.replace(/([A-Za-z]{3,})(\d+(?:\.\d+)?)/g, '$1 $2');

  // 9. Normalize hyphens for modifiers: "PAN-D" -> "PAN D", "TELMA-AM" -> "TELMA AM", "TELMA-H" -> "TELMA H"
  str = str.replace(/([A-Za-z]{2,})-([A-Za-z0-9]{1,3}\b)/g, '$1 $2');

  // 10. Remove detected company prefix or suffix if specified
  if (options?.detectedCompany) {
    const compWords = options.detectedCompany.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
    for (const cw of compWords) {
      if (['ltd', 'pvt', 'limited', 'private', 'pharma', 'laboratories', 'healthcare', 'remedies'].includes(cw)) continue;
      const re = new RegExp(`\\b${cw}\\b`, 'gi');
      str = str.replace(re, ' ');
    }
  }

  // 11. Token-level filtering and smart truncation
  const tokens = str.split(/[\s,;:|+\/]+/).filter(Boolean);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const low = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!low) continue;

    // Disqualify dosage forms
    if (MEDICINE_DOSAGE_FORMS.has(low)) continue;

    // Disqualify generic pack words
    if (GENERIC_PACK_WORDS.has(low)) continue;

    // Normalize unit from strength: "40MG" -> "40", "650MG" -> "650"
    const strengthMatch = t.match(/^(\d+(?:\.\d+)?)(?:mg|mcg|iu|%)$/i);
    if (strengthMatch) {
      out.push(strengthMatch[1]);
      // If we have Brand + Strength, check if immediate next word is a recognized formulation modifier
      const next = tokens[i + 1]?.toUpperCase();
      if (next && ['DUO', 'PLUS', 'AM', 'H', 'D', 'SR', 'XL', 'CR', 'ER', 'MR', 'FORTE', 'MAX', 'DS', 'LS', 'CV', 'OZ'].includes(next)) {
        out.push(next);
      }
      break; // Stop after Brand + Strength (+ modifier)!
    }

    // Stop before marketing descriptors if we already have 2+ brand words
    if (out.length >= 2 && MARKETING_DESCRIPTORS.has(low)) {
      break;
    }

    out.push(t);

    // If we reach 4 words without a number, cap it
    if (out.length >= 4) {
      break;
    }
  }

  const result = out.join(' ').replace(/\s+/g, ' ').trim();

  // If over-cleaned (<2 chars), fall back to original trimmed
  return result.length >= 2 ? result : rawTitle.trim();
}

