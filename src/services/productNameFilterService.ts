import { dbManager } from '../database/connection.js';
import { extractMultiSaltDrugStrength, areMultiSaltStrengthsEqual, areMultiSaltStrengthsConflicting } from './aiCameraRuleEngine.js';
import fs from 'fs';
import path from 'path';

function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;

  const editDistance = (x: string, y: string): number => {
    if (x.length === 0) return y.length;
    if (y.length === 0) return x.length;

    let prevRow = Array.from({ length: y.length + 1 }, (_, i) => i);
    let currRow = new Array(y.length + 1);

    for (let j = 1; j <= x.length; j++) {
      currRow[0] = j;
      for (let i = 1; i <= y.length; i++) {
        if (y.charAt(i - 1) === x.charAt(j - 1)) {
          currRow[i] = prevRow[i - 1];
        } else {
          currRow[i] = Math.min(
            prevRow[i - 1] + 1,
            currRow[i - 1] + 1,
            prevRow[i] + 1
          );
        }
      }
      [prevRow, currRow] = [currRow, prevRow];
    }

    return prevRow[y.length];
  };

  const distance = editDistance(a, b);
  return 1 - distance / maxLen;
}

export const UMBRELLA_PHARMA_BRANDS = new Set([
  'BAIDYANATH', 'BAID', 'DABUR', 'DAB', 'HIMALAYA', 'HIM', 'PATANJALI', 'PAT',
  'ZANDU', 'ZAN', 'HAMDARD', 'SBL', 'SCHWABE', 'BEARDO', 'AYUR'
]);

export function extractUmbrellaFormulation(name: string): { brand: string | null; formulation: string | null } {
  if (!name) return { brand: null, formulation: null };
  const clean = name.toUpperCase().replace(/[-_.,/()\[\]]/g, ' ');
  const words = clean.split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return { brand: null, formulation: null };

  const brandIdx = words.findIndex(w => UMBRELLA_PHARMA_BRANDS.has(w));
  if (brandIdx === -1) return { brand: null, formulation: null };

  const brand = words[brandIdx];
  const stopTokens = new Set([
    'MG', 'ML', 'GM', 'G', 'MCG', 'IU', '%', 'TAB', 'TABLET', 'TABLETS',
    'CAP', 'CAPSULE', 'CAPSULES', 'SYP', 'SYRUP', 'SUSP', 'SUSPENSION',
    'INJ', 'INJECTION', 'OINT', 'OINTMENT', 'GEL', 'CREAM', 'LOTION',
    'PACK', 'BOX', 'STRIP', 'BOTTLE', 'JAR', 'TUBE', 'NEW', 'SUPER',
    'EXTRA', 'PLUS', 'PURE', 'ORIGINAL', 'REGULAR', 'FORTE', 'ADVANCED'
  ]);

  const formulationWords = words.filter((w, idx) =>
    idx !== brandIdx && !/^\d+$/.test(w) && !stopTokens.has(w)
  );

  return {
    brand,
    formulation: formulationWords.length > 0 ? formulationWords.join(' ') : null
  };
}

export function extractDrugStrength(text: string): { strength: string | null; numericVal: number | null; unit: string | null; components?: number[]; sumVal?: number | null } {
  if (!text) return { strength: null, numericVal: null, unit: null };
  const res = extractMultiSaltDrugStrength(text);
  if (res.strength) return res;

  // Fallback standalone number before dosage form (e.g. "Derinide 200 Respicaps", "Budecort 200 Rotacaps", "Foracort 400 Inhaler")
  const formMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:RESPICAP|RESPICAPS|RESPULE|RESPULES|ROTACAP|ROTACAPS|INHALER|TRANSHALER|NEOHALER|PUFFS?|DOSE|DOSES|TABLET|TABLETS|TAB|TABS|CAPSULE|CAPSULES|CAP|CAPS|SUSPENSION|SYRUP|INJECTION|INJ|CREAM|GEL|OINTMENT|OINT)\b/i);
  if (formMatch) {
    const prevText = text.slice(Math.max(0, (formMatch.index || 0) - 12), formMatch.index || 0);
    if (!/STRIP\s+OF|PACK\s+OF|BOX\s+OF/i.test(prevText)) {
      const nVal = parseFloat(formMatch[1]);
      if (!isNaN(nVal)) {
        return { strength: String(nVal), numericVal: nVal, unit: null, components: [nVal], sumVal: nVal };
      }
    }
  }

  // Fallback standalone number right after brand token (e.g. "Derinide 200", "Dolo 650", "Pan 40")
  const words = text.trim().split(/\s+/);
  if (words.length >= 2 && /^\d+(?:\.\d+)?$/.test(words[1])) {
    const prevWord = words[0].toUpperCase();
    if (!/^(PACK|STRIP|BOX|BOTTLE|TAB|CAP|SYP|INJ|\d+)$/i.test(prevWord)) {
      const nVal = parseFloat(words[1]);
      if (!isNaN(nVal) && nVal >= 0.5 && nVal <= 5000) {
        return { strength: String(nVal), numericVal: nVal, unit: null, components: [nVal], sumVal: nVal };
      }
    }
  }
  return { strength: null, numericVal: null, unit: null };
}

export function areStrengthsEqual(
  s1: { strength: string | null; numericVal: number | null; unit: string | null; components?: number[]; sumVal?: number | null },
  s2: { strength: string | null; numericVal: number | null; unit: string | null; components?: number[]; sumVal?: number | null }
): boolean {
  if (!s1.strength || !s2.strength) return false;
  return areMultiSaltStrengthsEqual(
    { strength: s1.strength, numericVal: s1.numericVal, unit: s1.unit, components: s1.components || (s1.numericVal !== null ? [s1.numericVal] : []), sumVal: s1.sumVal ?? s1.numericVal },
    { strength: s2.strength, numericVal: s2.numericVal, unit: s2.unit, components: s2.components || (s2.numericVal !== null ? [s2.numericVal] : []), sumVal: s2.sumVal ?? s2.numericVal }
  );
}

export function areStrengthsConflicting(
  s1: { strength: string | null; numericVal: number | null; unit: string | null; components?: number[]; sumVal?: number | null },
  s2: { strength: string | null; numericVal: number | null; unit: string | null; components?: number[]; sumVal?: number | null }
): boolean {
  if (!s1.strength || !s2.strength) return false;
  return areMultiSaltStrengthsConflicting(
    { strength: s1.strength, numericVal: s1.numericVal, unit: s1.unit, components: s1.components || (s1.numericVal !== null ? [s1.numericVal] : []), sumVal: s1.sumVal ?? s1.numericVal },
    { strength: s2.strength, numericVal: s2.numericVal, unit: s2.unit, components: s2.components || (s2.numericVal !== null ? [s2.numericVal] : []), sumVal: s2.sumVal ?? s2.numericVal }
  );
}

export function extractVolumeOrWeight(text: string): { amount: string | null; numericVal: number | null; unit: string | null } {
  if (!text) return { amount: null, numericVal: null, unit: null };
  const m = text.match(/\b(\d+(?:\.\d+)?)\s*(ML|GM|G|KG|LTR|L)\b/i);
  if (!m) return { amount: null, numericVal: null, unit: null };
  let unit = m[2].toUpperCase();
  if (unit === 'G') unit = 'GM';
  const numericVal = parseFloat(m[1]);
  return {
    amount: `${m[1]}${unit}`,
    numericVal: isNaN(numericVal) ? null : numericVal,
    unit
  };
}

// Common English filler words that show up in packaging/label text ("solution
// FOR injection", "tablets AND capsules") but never identify a drug — excluded
// from the token-containment similarity boost so they can't manufacture a
// false match between two otherwise unrelated product names.
const FILLER_WORDS = new Set([
  'for', 'and', 'the', 'with', 'without', 'per', 'each', 'use', 'used',
  'only', 'not', 'are', 'was', 'were', 'has', 'have', 'from', 'into'
]);

export const FORMULATION_MODIFIERS = new Set([
  // Combinations & Active Additions
  'PLUS', 'FORTE', 'FORT', 'DS', 'DUO', 'COMBIKIT', 'COMBI', 'KIT', 'MAX', 'EXTRA',
  'DSR', 'D', 'DP', 'AP', 'SP', 'AM', 'AT', 'AZ', 'H', 'LS', 'DX', 'AX', 'CZ', 'CT',
  'LP', 'CV', 'KT', 'COLD', 'FLU', 'TZ', 'OZ', 'TG', 'CH', 'CL', 'AF', 'DF', 'DM', 'XT', 'PF', 'PD',
  'F', 'RF', 'IR', 'SITA', 'CF', 'TC', 'P', 'M', 'G',
  'Z', 'T', 'A', 'L', 'C', 'K', 'N', 'S', 'B', 'X', 'O',
  // Release Modifiers
  'SR', 'ER', 'CR', 'PR', 'MR', 'TR', 'XR', 'XL', 'LA',
  // Form / Dispersibility
  'DT', 'MD', 'SL', 'OD'
]);

export function stripPharmacopoeiaMarkers(text: string): string {
  if (!text) return '';
  return text.replace(/\b(ip|bp|usp|1p|ep|nf|rx|i\.p\.?|b\.p\.?|u\.s\.p\.?|1\.p\.?)\b/gi, ' ')
             .replace(/\s+/g, ' ')
             .trim();
}

export function areFormulationModifiersEquivalent(mod1: string, mod2: string): boolean {
  if (mod1 === mod2) return true;
  if ((mod1 === 'FORT' && mod2 === 'FORTE') || (mod1 === 'FORTE' && mod2 === 'FORT')) return true;
  const releaseMods = new Set(['SR', 'ER', 'CR', 'PR', 'MR', 'TR', 'XR', 'XL', 'LA']);
  if (releaseMods.has(mod1) && releaseMods.has(mod2)) return true;
  return false;
}

export function extractFormulationModifiers(name: string): Set<string> {
  if (!name) return new Set();
  const clean = name
    .replace(/['’]s\b/gi, ' ')
    .replace(/\b\d+\s*x\s*\d+\b/gi, ' ')
    .replace(/\+/g, ' PLUS ')
    .toUpperCase()
    .replace(/[-_.,/()\[\]|'"]/g, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  const found = new Set<string>();

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // Skip single letter vitamins if preceded by 'VITAMIN' or 'VIT' (e.g. Vitamin D3, Vitamin C)
    if (['D', 'C', 'A', 'B'].includes(w) && i > 0 && (words[i - 1] === 'VITAMIN' || words[i - 1] === 'VIT')) {
      continue;
    }
    // Skip 'E' if part of 'E E' or 'E D' (eye/ear drops)
    if (w === 'E' && (words[i + 1] === 'E' || words[i + 1] === 'D')) continue;
    // Skip 'G' if followed by or preceded by weight (e.g. 200 G, 400 G, G POWDER)
    if (w === 'G' && (words[i - 1] === 'OF' || /^\d+$/.test(words[i - 1]) || words[i + 1] === 'POWDER')) continue;
    if (w === 'S' && i > 0 && /^\d+$/.test(words[i - 1])) continue; // e.g. "15 S"
    if (w === 'X' && ((i > 0 && /^\d+$/.test(words[i - 1])) || (i < words.length - 1 && /^\d+$/.test(words[i + 1])))) continue; // e.g. "10 X 15"
    // Skip orthopedic sizes (S, M, L, XL)
    if (['S', 'M', 'L', 'XL'].includes(w) && ((i > 0 && words[i - 1] === 'SIZE') || (i < words.length - 1 && words[i + 1] === 'SIZE') || /\b(BELT|SUPPORT|KNEE|ANKLE|ELBOW|WRIST|COLLAR|BANDAGE|GLOVES?)\b/i.test(name))) {
      continue;
    }
    if (FORMULATION_MODIFIERS.has(w)) {
      found.add(w);
    }
  }
  return found;
}

export const BENIGN_DELIVERY_MODIFIERS = new Set([
  'DT', 'MD', 'SL', 'OD', 'DISPERSIBLE',
  'SR', 'ER', 'CR', 'PR', 'MR', 'TR', 'XR', 'XL', 'LA'
]);

export function hasFormulationModifierConflict(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  const mods1 = extractFormulationModifiers(name1);
  const mods2 = extractFormulationModifiers(name2);

  // Both have no modifiers (e.g. plain DYTOR 10 vs plain DYTOR 20) -> no modifier conflict
  if (mods1.size === 0 && mods2.size === 0) return false;

  // One is plain and the other has modifiers
  // Allow benign delivery/dispersibility modifiers (e.g. ACIVIR 200 vs ACIVIR DT 200)
  if (mods1.size === 0 && mods2.size > 0) {
    const nonBenign = Array.from(mods2).filter(m => !BENIGN_DELIVERY_MODIFIERS.has(m));
    return nonBenign.length > 0;
  }
  if (mods2.size === 0 && mods1.size > 0) {
    const nonBenign = Array.from(mods1).filter(m => !BENIGN_DELIVERY_MODIFIERS.has(m));
    return nonBenign.length > 0;
  }

  // Both have modifiers -> ensure equivalent/matching modifier set (e.g. TELMA H vs TELMA AM)
  for (const m1 of mods1) {
    if (BENIGN_DELIVERY_MODIFIERS.has(m1)) continue;
    const matched = Array.from(mods2).some(m2 => areFormulationModifiersEquivalent(m1, m2));
    if (!matched) return true;
  }
  for (const m2 of mods2) {
    if (BENIGN_DELIVERY_MODIFIERS.has(m2)) continue;
    const matched = Array.from(mods1).some(m1 => areFormulationModifiersEquivalent(m1, m2));
    if (!matched) return true;
  }

  return false;
}

export function isModalityConflict(s1: string, s2: string): boolean {
  const upper1 = s1.toUpperCase();
  const upper2 = s2.toUpperCase();

  const isBalm1 = /\b(VAPORUB|BALM|AMRUTANJAN|IODEX|MOOV|FAST RELIEF)\b/.test(upper1);
  const isBalm2 = /\b(VAPORUB|BALM|AMRUTANJAN|IODEX|MOOV|FAST RELIEF)\b/.test(upper2);

  const isInhaler1 = /\b(INHALER|RESPULE|RESPULES|ROTACAP|ROTACAPS|NASAL SPRAY)\b/.test(upper1);
  const isInhaler2 = /\b(INHALER|RESPULE|RESPULES|ROTACAP|ROTACAPS|NASAL SPRAY)\b/.test(upper2);

  const isLozenge1 = /\b(COUGH\s*DROPS?|LOZENGES?|STREPSILS|THROAT\s*DROPS?)\b/.test(upper1);
  const isLozenge2 = /\b(COUGH\s*DROPS?|LOZENGES?|STREPSILS|THROAT\s*DROPS?)\b/.test(upper2);

  if ((isBalm1 && (isInhaler2 || isLozenge2)) || (isBalm2 && (isInhaler1 || isLozenge1))) return true;
  if ((isInhaler1 && isLozenge2) || (isInhaler2 && isLozenge1)) return true;

  return false;
}

export function getCompatibleItemTypes(dosageForm?: string): string[] {
  if (!dosageForm) return [];
  const df = dosageForm.toUpperCase().trim();
  if (df === 'SYRUP' || df === 'LIQUID' || df === 'SUSPENSION') {
    return ['BOTTLE', 'LIQUID', 'SYP', 'SUSP', 'DROP', 'SOLUTION', 'ELIXIR'];
  }
  if (df === 'TABLET') {
    return ['STRIP', 'TAB', 'BOX', 'PACK', 'STRIP OF', 'TABLET', 'TABLETS', 'DT', 'CAPLET'];
  }
  if (df === 'CAPSULE') {
    return ['STRIP', 'CAP', 'BOX', 'PACK', 'STRIP OF', 'CAPSULE', 'CAPSULES', 'SOFGEL', 'SOFTGEL'];
  }
  if (df === 'DROPS') {
    return ['BOTTLE', 'DROP', 'DROPS', 'EYE DROP', 'EAR DROP', 'NASAL DROP'];
  }
  if (df === 'INJECTION' || df === 'INFUSION') {
    return ['INJECTION', 'VIAL', 'AMPOULE', 'INFUSION', 'PRE-FILLED SYRINGE', 'I V VIAL', 'I V AMPOULE', 'DRY VIAL'];
  }
  if (df === 'CREAM' || df === 'OINTMENT' || df === 'GEL' || df === 'LOTION') {
    return ['TUBE', 'CREAM', 'OINT', 'GEL', 'LOTION'];
  }
  if (df === 'BALM') {
    return ['BALM', 'JAR', 'TUBE', 'RUB', 'OINT'];
  }
  if (df === 'INHALER') {
    return ['INHALER', 'RESPULE', 'ROTACAP', 'DEVICE', 'CAN'];
  }
  if (df === 'POWDER') {
    return ['POWDER', 'JAR', 'BOTTLE', 'CAN', 'GRANULES'];
  }
  if (df === 'SOAP') {
    return ['SOAP', 'BAR', 'WASH'];
  }
  if (df === 'OIL') {
    return ['OIL', 'TAIL', 'TAILA', 'BOTTLE'];
  }
  if (df === 'SACHET') {
    return ['SACHET', 'POUCH', 'PACKET', 'GRANULES'];
  }
  return [df];
}

export function isItemTypeCompatible(dosageForm?: string, itemType?: string): boolean {
  if (!dosageForm || !itemType) return false;
  const compatible = getCompatibleItemTypes(dosageForm);
  const it = itemType.toUpperCase().trim();
  return compatible.some(c => it.includes(c) || c.includes(it));
}

export function detectDosageFormFromText(text: string): string | null {
  if (!text) return null;
  const t = text.trim();

  // Injections & Infusions (check first to avoid 'solution for injection' matching syrup)
  if (/\b(?:injections?|injs?|infusions?|vials?|ampoules?|pre-?filled\s*syringes?|pfs|solution\s+for\s+(?:injection|infusion))\b/i.test(t)) {
    return 'INJECTION';
  }

  // Eye / Ear Drops (check before generic solutions)
  if (/\b(?:eye\s*drops?|ear\s*drops?|e\/e|ophthalmic(?:\s*solutions?)?)\b/i.test(t)) {
    return 'DROPS';
  }
  if (/\b(?:drops?)\b/i.test(t) && !/\b(?:cough\s*drops?|throat\s*drops?)\b/i.test(t)) {
    return 'DROPS';
  }

  // Respiratory / Inhaler
  if (/\b(?:inhalers?|respicaps?|respules?|rotacaps?|transhalers?|neohalers?|inhalations?|synchrobreathe|multihaler)\b/i.test(t)) {
    return 'INHALER';
  }

  // Oral liquids (Syrup, Suspension, Oral Solution)
  if (/\b(?:syrups?|syps?|suspensions?|susps?|oral\s*liquids?|oral\s*solutions?|elixirs?)\b/i.test(t)) {
    return 'SYRUP';
  }

  // Shampoo (strictly before soap/topical)
  if (/\b(?:shampoos?|hair\s*wash(?:es)?)\b/i.test(t)) {
    return 'SHAMPOO';
  }

  // Soap (strictly bathing bar / cleansing bar / soap)
  if (/\b(?:soaps?|bathing\s*bars?|syndet\s*bars?|cleansing\s*bars?)\b/i.test(t)) {
    return 'SOAP';
  }

  // Face wash
  if (/\b(?:face\s*wash(?:es)?|facewash(?:es)?|cleansers?|body\s*wash(?:es)?)\b/i.test(t)) {
    return 'FACE WASH';
  }

  // Topicals
  if (/\b(?:gels?)\b/i.test(t)) return 'GEL';
  if (/\b(?:creams?)\b/i.test(t)) return 'CREAM';
  if (/\b(?:ointments?|oints?)\b/i.test(t)) return 'OINTMENT';
  if (/\b(?:lotions?)\b/i.test(t)) return 'LOTION';
  if (/\b(?:balms?|vaporubs?)\b/i.test(t)) return 'BALM';

  // Solid orals
  if (/\b(?:tabs?|tablets?|dt|dispersible\s*tablets?|caplets?)\b/i.test(t)) {
    return 'TABLET';
  }
  if (/\b(?:caps?|capsules?)\b/i.test(t)) {
    return 'CAPSULE';
  }

  // Others
  if (/\b(?:powders?|dusting\s*powders?|protein\s+(?:for|powder|supplement)|lactation\s+supplement|nourishment\s+for)\b/i.test(t)) return 'POWDER';
  if (/\b(?:sprays?|nasal\s*sprays?)\b/i.test(t)) return 'SPRAY';
  if (/\b(?:sachets?|granules?)\b/i.test(t)) return 'SACHET';
  if (/\b(?:hair\s*oils?|massage\s*oils?|taila?)\b/i.test(t)) return 'OIL';

  return null;
}

export function detectFlavourFromText(text: string): string | null {
  if (!text) return null;
  const m = text.match(/\b(chocolate|choco|vanilla|cardamom|elaichi|strawberry|mango|orange|banana|kesar|pista|badam|butterscotch|pineapple|lemon|mint)(?:\s+(?:flavour|flavor|taste))?\b/i);
  return m ? m[1].toLowerCase() : null;
}

export function isItemTypeConflicting(dosageForm?: string, itemTypeOrName?: string): boolean {
  if (!dosageForm || !itemTypeOrName) return false;
  const df = dosageForm.toUpperCase().trim();
  const it = itemTypeOrName.toUpperCase().trim();

  const isTablet = df === 'TABLET';
  const isCapsule = df === 'CAPSULE';
  const isSolidOral = isTablet || isCapsule;
  const isLiquidOral = df === 'SYRUP' || df === 'LIQUID' || df === 'SUSPENSION';
  const isInjectable = df === 'INJECTION' || df === 'INFUSION';
  const isTopical = df === 'CREAM' || df === 'OINTMENT' || df === 'GEL' || df === 'LOTION' || df === 'BALM';
  const isInhaler = df === 'INHALER';
  const isDrops = df === 'DROPS';
  const isShampoo = df === 'SHAMPOO';
  const isSoap = df === 'SOAP' || df === 'BAR';
  const isFaceWash = df === 'FACE WASH' || df === 'FACEWASH';
  const isPowder = df === 'POWDER';

  const itIsTablet = /\b(TAB|TABLET|TABLETS|DT)\b/.test(it);
  const itIsCapsule = /\b(CAP|CAPSULE|CAPSULES|SOFGEL|SOFTGEL)\b/.test(it);
  const itIsSolidOral = itIsTablet || itIsCapsule;
  const itIsLiquidOral = /\b(SYP|SYRUP|SUSP|SUSPENSION|ELIXIR|ORAL SOLUTION)\b/.test(it);
  const itIsInjectable = /\b(INJ|INJECTION|VIAL|AMPOULE|INFUSION)\b/.test(it);
  const itIsFaceWash = /\b(FACE WASH|FACEWASH|CLEANSER|BODY WASH)\b/.test(it);
  const itIsTopical = /\b(CREAM|OINT|OINTMENT|GEL|LOTION|BALM)\b/.test(it) && !itIsFaceWash;
  const itIsInhaler = /\b(INHALER|RESPULE|ROTACAP|RESPICAP)\b/.test(it);
  const itIsDrops = /\b(DROPS?|EYE DROP|EAR DROP|OPHTHALMIC)\b/.test(it);
  const itIsShampoo = /\b(SHAMPOO|HAIR WASH)\b/.test(it);
  const itIsSoap = /\b(SOAP|BAR|BATHING BAR|SYNDET BAR)\b/.test(it);
  const itIsPowder = /\b(POWDER|POWDERS|GRANULES|SACHET)\b/.test(it);

  // Allow Face Wash Gel / Foaming Face Wash to match Face Wash
  if (isFaceWash && itIsFaceWash) return false;

  // Tablet vs Capsule conflict: tablets must NEVER match capsules
  if (isTablet && itIsCapsule && !itIsTablet) return true;
  if (isCapsule && itIsTablet && !itIsCapsule) return true;

  // Allow oral antacid gels (e.g. Digene Gel, Mucaine Gel) in bottles/ML to match suspension/liquid
  if ((df === 'GEL' || df === 'SYRUP') && /\b(ML|BOTTLE|SUSP|SUSPENSION|ANTACID)\b/.test(it) && !/\b(TUBE)\b/.test(it)) {
    return false;
  }

  // Powder strictly conflicts with liquids, tablets, capsules, injectables, topicals, drops
  if (isPowder && (itIsLiquidOral || itIsSolidOral || itIsInjectable || itIsDrops || itIsTopical || itIsInhaler || itIsShampoo || itIsSoap || itIsFaceWash)) return true;
  if ((isSolidOral || isLiquidOral || isInjectable || isDrops || isTopical || isInhaler || isShampoo || isSoap || isFaceWash) && itIsPowder) return true;

  if (isSolidOral && (itIsLiquidOral || itIsInjectable || itIsTopical || itIsInhaler || itIsShampoo || itIsSoap || itIsFaceWash || itIsDrops)) return true;
  if (isLiquidOral && (itIsSolidOral || itIsInjectable || itIsTopical || itIsInhaler || itIsShampoo || itIsSoap || itIsFaceWash || itIsDrops)) return true;
  if (isInjectable && (itIsSolidOral || itIsLiquidOral || itIsTopical || itIsInhaler || itIsShampoo || itIsSoap || itIsFaceWash || itIsDrops)) return true;
  if (isTopical && (itIsSolidOral || itIsLiquidOral || itIsInjectable || itIsInhaler || itIsShampoo || itIsSoap || itIsFaceWash || itIsDrops)) return true;
  if (isInhaler && (itIsSolidOral || itIsLiquidOral || itIsInjectable || itIsTopical || itIsDrops || itIsShampoo || itIsSoap || itIsFaceWash)) return true;
  if (isDrops && (itIsSolidOral || itIsLiquidOral || itIsInjectable || isInhaler || itIsShampoo || itIsSoap || itIsFaceWash || itIsTopical)) return true;
  if (isShampoo && (itIsSoap || itIsTopical || itIsFaceWash || itIsSolidOral || itIsLiquidOral || itIsInjectable || itIsDrops || itIsInhaler)) return true;
  if (isSoap && (itIsShampoo || itIsTopical || itIsFaceWash || itIsSolidOral || itIsLiquidOral || itIsInjectable || itIsDrops || itIsInhaler)) return true;
  if (isFaceWash && (itIsSoap || itIsShampoo || itIsTopical || itIsSolidOral || itIsLiquidOral || itIsInjectable || itIsDrops || itIsInhaler)) return true;

  return false;
}

// Helper function to calculate similarity using Levenshtein distance
function levenshteinSimilarity(s1: string, s2: string): number {
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;

  // Simple Levenshtein distance implementation
  const editDistance = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
    let currRow = new Array(b.length + 1);

    for (let j = 1; j <= a.length; j++) {
      currRow[0] = j;
      for (let i = 1; i <= b.length; i++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          currRow[i] = prevRow[i - 1];
        } else {
          currRow[i] = Math.min(
            prevRow[i - 1] + 1, // substitution
            currRow[i - 1] + 1, // insertion
            prevRow[i] + 1      // deletion
          );
        }
      }
      prevRow = [...currRow];
    }

    return prevRow[b.length];
  };

  const distance = editDistance(s1.toLowerCase(), s2.toLowerCase());
  return 1.0 - distance / maxLen;
}

// Helper function to calculate phonetic similarity using Soundex-like algorithm
function phoneticSimilarity(s1: string, s2: string): number {
  const soundex = (str: string): string => {
    if (str.length === 0) return "0000";
    str = str.toUpperCase();
    const soundexMap: Record<string, string> = {
      'B': '1', 'F': '1', 'P': '1', 'V': '1',
      'C': '2', 'G': '2', 'J': '2', 'K': '2', 'Q': '2', 'S': '2', 'X': '2', 'Z': '2',
      'D': '3', 'T': '3',
      'L': '4',
      'M': '5', 'N': '5',
      'R': '6'
    };

    let result = str[0];
    let lastDigit = soundexMap[str[0]] || '0';

    for (let i = 1; i < str.length && result.length < 4; i++) {
      const code = soundexMap[str[i]] || '0';
      if (code !== '0' && code !== lastDigit) {
        result += code;
        lastDigit = code;
      }
    }

    return result.padEnd(4, '0').substring(0, 4);
  };

  const code1 = soundex(s1);
  const code2 = soundex(s2);

  // Simple matching: count matching characters
  let matches = 0;
  for (let i = 0; i < 4; i++) {
    if (code1[i] === code2[i]) matches++;
  }
  return matches / 4.0;
}

// Helper function to calculate n-gram similarity
function ngramSimilarity(s1: string, s2: string, n: number = 2): number {
  if (s1.length < n || s2.length < n) {
    return s1 === s2 ? 1.0 : 0.0;
  }

  const getNgrams = (str: string, n: number): Set<string> => {
    const ngrams = new Set<string>();
    for (let i = 0; i <= str.length - n; i++) {
      ngrams.add(str.substring(i, i + n));
    }
    return ngrams;
  };

  const ngrams1 = getNgrams(s1.toLowerCase(), n);
  const ngrams2 = getNgrams(s2.toLowerCase(), n);

  if (ngrams1.size === 0 && ngrams2.size === 0) return 1.0;
  if (ngrams1.size === 0 || ngrams2.size === 0) return 0.0;

  let intersection = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) intersection++;
  }

  const union = ngrams1.size + ngrams2.size - intersection;
  return intersection / union;
}

// Enhanced similarity function combining multiple techniques
export function enhancedSimilarity(s1: string, s2: string): number {
  const norm1 = s1.toLowerCase().trim();
  const norm2 = s2.toLowerCase().trim();

  // Strip standalone pharmacopoeia standards (IP, BP, USP, etc.) so regulatory markers don't warp similarity
  const pStripped1 = stripPharmacopoeiaMarkers(norm1);
  const pStripped2 = stripPharmacopoeiaMarkers(norm2);

  // Convert to lowercase and clean for character-based matching
  const clean1 = pStripped1.replace(/[^a-z0-9]/g, '');
  const clean2 = pStripped2.replace(/[^a-z0-9]/g, '');

  if (clean1 === clean2) return 1.0; // Exact match after cleaning

  // 1. Modality conflict guard (e.g. Vicks Vaporub balm vs Vicks Inhaler stick vs Vicks Cough Drops)
  if (isModalityConflict(s1, s2)) {
    return 0.20;
  }

  // 2. Umbrella brand formulation disambiguation (e.g. Dabur Honey vs Dabur Glucose D)
  const umb1 = extractUmbrellaFormulation(s1);
  const umb2 = extractUmbrellaFormulation(s2);
  if (umb1.brand && umb2.brand && umb1.brand === umb2.brand) {
    if (umb1.formulation && umb2.formulation) {
      const f1 = umb1.formulation.toLowerCase().replace(/[^a-z0-9]/g, '');
      const f2 = umb2.formulation.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (f1 !== f2 && !f1.includes(f2) && !f2.includes(f1)) {
        return 0.20;
      }
    }
  }

  // 3. Formulation modifier conflict guard (e.g. plain DYTOR vs DYTOR PLUS or DYTOR COMBIKIT; PAN 40 vs PAN D)
  if (hasFormulationModifierConflict(s1, s2)) {
    return 0.20;
  }

  // Calculate individual similarities
  let levSim = levenshteinSimilarity(clean1, clean2);

  // Bounded prefix & substring match (prevent common 3-4 letter medical stems like "derma", "cipl" from falsely inflating)
  const isGenericStem = /^(derma?|cipl?|para?|cefi?|azith?|amox?|clot?|panto?|omep?|ator?|mont?)$/i.test(clean1) ||
                        /^(derma?|cipl?|para?|cefi?|azith?|amox?|clot?|panto?|omep?|ator?|mont?)$/i.test(clean2);
  const ratio = Math.min(clean1.length, clean2.length) / Math.max(clean1.length, clean2.length);

  if ((clean2.startsWith(clean1) || clean1.startsWith(clean2)) && !isGenericStem) {
    const shorter = clean1.length < clean2.length ? clean1 : clean2;
    const isWholeWord = new RegExp(`\\b${shorter}\\b`, 'i').test(s1) || new RegExp(`\\b${shorter}\\b`, 'i').test(s2);
    if (isWholeWord || ratio >= 0.75) {
      levSim = Math.max(levSim, 0.85 + 0.15 * ratio);
    }
  } else if ((clean2.includes(clean1) || clean1.includes(clean2)) && !isGenericStem) {
    const shorter = clean1.length < clean2.length ? clean1 : clean2;
    const isWholeWord = new RegExp(`\\b${shorter}\\b`, 'i').test(s1) || new RegExp(`\\b${shorter}\\b`, 'i').test(s2);
    if (isWholeWord || ratio >= 0.80) {
      levSim = Math.max(levSim, 0.75 + 0.20 * ratio);
    }
  }

  // Token containment boost (e.g. "baclof liquid" tokens all in "baclof liquid strawberry flav 100ml").
  // Filler words ("for", "and", "the"...) are excluded — otherwise a packaging
  // phrase like "...SOLUTION FOR INJ" trivially satisfies containment via
  // "for" prefix-matching a brand name like "foracort", wrongly boosting an
  // unrelated product to a near-1.0 base score (bug found 2026-09-20: plain
  // "Foracort 100" query matched an unrelated "Insugen R..." injection).
  const words1 = norm1.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !FILLER_WORDS.has(w));
  const words2 = norm2.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !FILLER_WORDS.has(w));
  if (words1.length > 0 && words2.length > 0) {
    const containedCount = words1.filter(w => words2.some(w2 => w2.startsWith(w) || w.startsWith(w2))).length;
    if (containedCount === words1.length) {
      levSim = Math.max(levSim, 0.90);
    }
  }

  const phoneSim = phoneticSimilarity(clean1, clean2);
  const ngramSim = ngramSimilarity(clean1, clean2, 2); // Bigrams

  let score = (levSim * 0.6) + (phoneSim * 0.2) + (ngramSim * 0.2);

  // Unit-aware drug strength vs volume vs pack size check (never match pack count "10" as drug strength)
  const str1 = extractDrugStrength(s1);
  const str2 = extractDrugStrength(s2);

  // A matching strength number can only REINFORCE a name match that is
  // already plausible on its own — it must never be what pushes two
  // otherwise-dissimilar product names (e.g. "Foracort 100" vs an unrelated
  // "Insugen R Refil 100 IU...") over a match threshold. Long unrelated names
  // can accidentally share enough bigrams to sit near the boost floor by
  // chance; requiring real pre-boost similarity closes that gap (bug found
  // 2026-09-20 via live search on this exact pair).
  const hasPlausibleBaseNameMatch = score >= 0.45;

  if (str1.strength && str2.strength) {
    if (areStrengthsEqual(str1, str2) && hasPlausibleBaseNameMatch) {
      score = Math.min(1.0, score + 0.15); // Matching active dosage strength boost
    } else if (areStrengthsConflicting(str1, str2)) {
      score = Math.max(0.0, score - 0.35); // Penalize conflicting dosage strength (e.g. 500mg vs 250mg)
    }
  } else {
    // Check volume/weight equivalence (e.g. 450ml vs 455ml)
    const vol1 = extractVolumeOrWeight(s1);
    const vol2 = extractVolumeOrWeight(s2);
    if (vol1.amount && vol2.amount && vol1.unit === vol2.unit) {
      const isEquivVolume = (vol1.numericVal === 450 && vol2.numericVal === 455) || (vol1.numericVal === 455 && vol2.numericVal === 450);
      if (vol1.amount === vol2.amount || isEquivVolume) {
        score = Math.min(1.0, score + 0.10);
      } else {
        const vRatio = (vol1.numericVal && vol2.numericVal)
          ? Math.max(vol1.numericVal, vol2.numericVal) / Math.min(vol1.numericVal, vol2.numericVal)
          : 1;
        if (vRatio >= 4.0) {
          score = Math.max(0.0, score - 0.30); // Extreme pack size difference (e.g. 50ml vs 500ml)
        }
      }
    }
  }

  return score;
}

export interface FilterOptions {
  enableInternetFallback?: boolean;
  internetApiEndpoint?: string;
  internetApiKey?: string;
  minConfidenceThreshold?: number;
  fallbackTimeoutMs?: number;
  dosageForm?: string;
  mrp?: number;
  mrpTolerance?: number; // default 0.2 = ±20%
  rawOcrText?: string;   // Full raw OCR text for chemical API verification
}

export interface FilterResult {
  matches: string[];
  sources: {
    local: boolean;
    internet: boolean;
    catalog: boolean;
  };
  confidence: number; // Average confidence of matches (0-100)
  fallbackUsed: boolean;
  processingTimeMs: number;
  catalogResults?: { mapped: any[]; nonMapped: any[] };
  scoredMatches?: Array<{ name: string; score: number }>; // local matches with real similarity scores, sorted desc
  topScore?: number; // best local similarity score (0-1); 0 when no local match
}

export class ProductNameFilterService {
  private medicineNames: string[] = [];
  public getMedicineNames(): string[] { return this.medicineNames; }
  private initialized: boolean = false;
  private dbPath: string;
  private readonly DEFAULT_THRESHOLD = 0.8; // 80% similarity threshold
  private readonly DEFAULT_TIMEOUT = 5000; // 5 seconds
  private corrections: Map<string, { correctName: string; count: number }> = new Map();
  private readonly correctionsPath: string;
  // Caches full filterProductNames() results for repeat lookups of the same name.
  // The full-array fuzzy fallback scans all medicine names (O(n) Levenshtein/phonetic/n-gram
  // per candidate) and can take 15-20+ seconds once the catalog grows into the hundreds of
  // thousands; callers like Pharmarack Cart's price-history prefetch look up the same product
  // names repeatedly, so caching turns every repeat lookup into an instant hit.
  private readonly filterCache: Map<string, FilterResult> = new Map();
  private readonly FILTER_CACHE_MAX = 2000;

  constructor(dbPath: string = './data/app.db') {
    this.dbPath = dbPath;
    this.correctionsPath = path.resolve(process.cwd(), 'data', 'ocr_corrections.json');
    this.loadCorrections();
  }

  private loadCorrections(): void {
    try {
      if (fs.existsSync(this.correctionsPath)) {
        const data = fs.readFileSync(this.correctionsPath, 'utf8');
        const correctionsArray: Array<{ocr: string; correct: string; count: number}> = JSON.parse(data);

        // Convert array to Map for efficient lookup
        for (const item of correctionsArray) {
          this.corrections.set(item.ocr.trim().toLowerCase(), {
            correctName: item.correct,
            count: item.count
          });
        }

        console.log(`Loaded ${this.corrections.size} OCR correction pairs from audit learning`);
      }
    } catch (error) {
      console.warn('Failed to load OCR corrections:', error);
      // Continue with empty corrections map
    }
  }
  private saveCorrections(): void {
    try {
      // Convert Map to array for JSON serialization
      const correctionsArray: Array<{ocr: string; correct: string; count: number}> = [];

      for (const [ocrText, { correctName, count }] of this.corrections.entries()) {
        correctionsArray.push({ ocr: ocrText, correct: correctName, count });
      }

      // Sort by count descending and keep top 1000 entries
      correctionsArray.sort((a, b) => b.count - a.count);
      if (correctionsArray.length > 1000) {
        correctionsArray.length = 1000;
      }

      // Ensure data directory exists
      const dataDir = path.dirname(this.correctionsPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const tempPath = this.correctionsPath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(correctionsArray, null, 2));
      fs.renameSync(tempPath, this.correctionsPath);
    } catch (error) {
      console.error('Failed to save OCR corrections atomically:', error);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const db = await dbManager.getConnection();
      const rows = await db.all('SELECT DISTINCT name FROM medicines WHERE name IS NOT NULL AND name <> ""');
      this.medicineNames = rows.map(row => row.name).filter(Boolean);

      // Load corrections from database
      try {
        const dbCorrections = await db.all('SELECT ocr, correct, count FROM ocr_corrections');
        for (const item of dbCorrections) {
          this.corrections.set(item.ocr.trim().toLowerCase(), {
            correctName: item.correct,
            count: item.count
          });
        }
        console.log(`Loaded ${dbCorrections.length} OCR correction pairs from SQLite database`);
      } catch (dbErr) {
        console.warn('Failed to load corrections from database, falling back to JSON:', dbErr);
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize ProductNameFilterService:', error);
      throw new Error(`Failed to load medicine names from database: ${(error as any).message}`);
    }
  }

  /**
   * Learn from a pharmacist correction - when they correct an OCR misrecognition
   * @param ocrText The original OCR text that was incorrect
   * @param correctName The correct medicine name as identified by the pharmacist
   */
  public learnFromCorrection(ocrText: string, correctName: string): void {
    if (!ocrText || !correctName) return;

    const normalizedOcr = ocrText.trim().toLowerCase();
    const normalizedCorrect = correctName.trim();

    let count = 1;
    // Get existing entry or create new
    const existing = this.corrections.get(normalizedOcr);
    if (existing) {
      // If it's already mapped to the same correct name, increment count
      if (existing.correctName === normalizedCorrect) {
        existing.count++;
        count = existing.count;
      }
    } else {
      // New correction pair
      this.corrections.set(normalizedOcr, {
        correctName: normalizedCorrect,
        count: 1
      });
    }

    // Save to file periodically (we could batch this, but for simplicity saving each time)
    this.saveCorrections();

    // A new correction can change the outcome of future lookups — drop stale cached results.
    this.filterCache.clear();

    // Save to SQLite database asynchronously
    dbManager.getConnection()
      .then(async (db) => {
        await db.run(
          'INSERT OR REPLACE INTO ocr_corrections (ocr, correct, count) VALUES (?, ?, ?)',
          [normalizedOcr, normalizedCorrect, count]
        );
        console.log(`Saved OCR correction to database: "${normalizedOcr}" → "${normalizedCorrect}" (count: ${count})`);
      })
      .catch((dbErr) => {
        console.error('Failed to save OCR correction to database:', dbErr);
      });

    console.log(`Learned OCR correction: "${ocrText}" → "${correctName}"`);
  }

  async filterProductNames(ocrText: string, options: FilterOptions = {}): Promise<FilterResult> {
    const startTime = Date.now();

    if (!this.initialized) {
      await this.initialize();
    }

    // Merge options with defaults
    const {
      enableInternetFallback = false,
      internetApiEndpoint,
      internetApiKey,
      minConfidenceThreshold = this.DEFAULT_THRESHOLD,
      fallbackTimeoutMs = this.DEFAULT_TIMEOUT,
      dosageForm,
      mrp,
      mrpTolerance = 0.4,
      rawOcrText
    } = options;

    const effectiveDosageForm = dosageForm || detectDosageFormFromText(rawOcrText || ocrText) || undefined;

    if (!ocrText || ocrText.trim() === '') {
      return {
        matches: [],
        sources: { local: false, internet: false, catalog: false },
        confidence: 0,
        fallbackUsed: false,
        processingTimeMs: Date.now() - startTime,
        scoredMatches: [],
        topScore: 0
      };
    }

    const normalizedOcr = ocrText.toLowerCase().trim();

    // Rule 85: Calibrate threshold for short query strings (<4 chars) to prevent random 3-letter noise traps like "FOT", "Biss"
    const effectiveThreshold = normalizedOcr.length <= 3 
      ? Math.max(minConfidenceThreshold, 0.80) 
      : minConfidenceThreshold;

    // Cache key covers every input that can change the result. Internet-fallback lookups are
    // skipped (not cached) — that path is rare, opt-in, and time-sensitive by nature.
    const rawStrength = rawOcrText ? (extractDrugStrength(rawOcrText).strength || '') : '';
    const rawVolume = rawOcrText ? (extractVolumeOrWeight(rawOcrText).amount || '') : '';
    const rawMods = Array.from(extractFormulationModifiers(normalizedOcr)).sort().join(',');
    const cacheKey = !enableInternetFallback
      ? `${normalizedOcr}|${effectiveDosageForm || ''}|${mrp || ''}|${rawStrength}|${rawVolume}|${rawMods}|${minConfidenceThreshold}`
      : null;
    if (cacheKey && this.filterCache.has(cacheKey)) {
      const cached = this.filterCache.get(cacheKey)!;
      return { ...cached, processingTimeMs: Date.now() - startTime };
    }

    const scoredMatches: Array<{ name: string; score: number }> = [];

    // First check if we have learned corrections (exact or token/substring match) for this OCR text
    for (const [ocrKey, correctionVal] of this.corrections.entries()) {
      if (normalizedOcr === ocrKey || normalizedOcr.includes(ocrKey) || (ocrKey.length >= 4 && normalizedOcr.includes(ocrKey))) {
        if (!scoredMatches.some(m => m.name === correctionVal.correctName)) {
          scoredMatches.push({ name: correctionVal.correctName, score: 0.96 });
          console.log(`Using learned OCR correction match: "${normalizedOcr}" → "${correctionVal.correctName}"`);
        }
      }
    }

    // FTS5 fast-path: use trigram index if available (O(log n) instead of O(n))
    let fts5Used = false;
    try {
      const db = await dbManager.getConnection();
      let fts5Sql = `SELECT m.id, m.name, m.mrp, m.item_type, m.api_reference
        FROM medicines_fts f JOIN medicines m ON m.id = f.rowid
        WHERE medicines_fts MATCH ?`;
      // FTS5 MATCH treats raw OCR text as boolean operators — sanitize by
      // stripping special chars and wrapping in quotes. Use the primary medicine token
      // with length >= 3 to allow trigram matching without exact phrase brittleness.
      const cleanedWords = normalizedOcr.replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).filter(w => w.length >= 3);
      const fts5SafeQuery = cleanedWords.length > 0
        ? `"${cleanedWords[0]}"`
        : `"${normalizedOcr.replace(/[^a-z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ')}"`;
      const fts5Params: any[] = [fts5SafeQuery];

      if (mrp && mrp > 0) {
        const low = mrp * (1 - mrpTolerance);
        const high = mrp * (1 + mrpTolerance);
        fts5Sql += ' AND m.mrp BETWEEN ? AND ?';
        fts5Params.push(low, high);
      }
      fts5Sql += ' LIMIT 30';

      const ftsRows = await db.all(fts5Sql, fts5Params);
      if (ftsRows && ftsRows.length > 0) {
        fts5Used = true;
        for (const row of ftsRows) {
          const nameSim = enhancedSimilarity(normalizedOcr, row.name.toLowerCase());
          const dosageConflict = isItemTypeConflicting(effectiveDosageForm, row.item_type || row.name);
          const dosageMatch = effectiveDosageForm && row.item_type
            ? (isItemTypeCompatible(effectiveDosageForm, row.item_type) ? 1.0 : (dosageConflict ? -0.5 : 0.2))
            : null;
          const mrpMatch = mrp && row.mrp ? (1 - Math.abs(mrp - row.mrp) / Math.max(mrp, row.mrp)) : null;
          
          let apiMatch: number | null = null;
          if (rawOcrText && row.api_reference) {
            const apiTokens = row.api_reference.toLowerCase().split(/[^a-z0-9]+/);
            const hasTokenMatch = apiTokens.some((token: string) => token.length > 3 && rawOcrText.toLowerCase().includes(token));
            apiMatch = hasTokenMatch ? 1.0 : 0.4;
          }

          // Strength & Volume cross-check confirmation against raw OCR text
          let strengthConflict = false;
          let strengthMatch = false;
          if (rawOcrText) {
            const ocrStr = extractDrugStrength(rawOcrText);
            const medStr = extractDrugStrength(row.name);
            // Require explicit unit or multi-salt combination for background raw OCR strength conflict:
            // A unitless number from raw background text (e.g. '6' from 'Biss 6') must never penalize a medicine!
            const isReliableOcrStrength = ocrStr.unit !== null || (ocrStr.components && ocrStr.components.length > 1);
            if (ocrStr.strength && medStr.strength && isReliableOcrStrength) {
              if (areStrengthsEqual(ocrStr, medStr)) {
                strengthMatch = true;
              } else if (areStrengthsConflicting(ocrStr, medStr)) {
                strengthConflict = true;
              }
            }
          }

          let volumeConflict = false;
          let volumeMatch = false;
          if (rawOcrText && !strengthConflict && !strengthMatch) {
            const ocrVol = extractVolumeOrWeight(rawOcrText);
            const medVol = extractVolumeOrWeight(row.name);
            if (ocrVol.amount && medVol.amount && ocrVol.unit === medVol.unit) {
              const vRatio = (ocrVol.numericVal && medVol.numericVal)
                ? Math.max(ocrVol.numericVal, medVol.numericVal) / Math.min(ocrVol.numericVal, medVol.numericVal)
                : 1;
              if (vRatio >= 1.5) {
                volumeConflict = true;
              } else if (ocrVol.amount === medVol.amount) {
                volumeMatch = true;
              }
            }
          }

          // Dynamic weighting: if mrp/dosage are unknown (normal for front-of-pack camera scan),
          // do NOT penalize the name match with false 0.5/0.2 baseline weights.
          let combinedScore: number;
          if (dosageMatch !== null && mrpMatch !== null) {
            combinedScore = 0.45 * nameSim + 0.25 * dosageMatch + 0.20 * mrpMatch + 0.10 * (apiMatch ?? 0.5);
          } else if (dosageMatch !== null) {
            combinedScore = 0.70 * nameSim + 0.20 * dosageMatch + 0.10 * (apiMatch ?? 0.5);
          } else if (mrpMatch !== null) {
            combinedScore = 0.70 * nameSim + 0.20 * mrpMatch + 0.10 * (apiMatch ?? 0.5);
          } else {
            // Front-of-pack OCR query: primary decision is name similarity
            combinedScore = (apiMatch !== null && apiMatch > 0.5)
              ? 0.85 * nameSim + 0.15 * apiMatch
              : nameSim;
          }

          // Strict clinical dosage form conflict penalty (e.g. tablet vs syrup)
          if (dosageConflict) {
            combinedScore = Math.max(0.0, combinedScore - 0.40);
          }

          // Packaging active strength confirmation boost or severe conflict penalty
          if (strengthMatch) {
            combinedScore = Math.min(1.0, combinedScore + 0.20);
          } else if (strengthConflict) {
            combinedScore = Math.max(0.0, combinedScore - 0.50);
          } else if (volumeMatch) {
            combinedScore = Math.min(1.0, combinedScore + 0.10);
          } else if (volumeConflict) {
            combinedScore = Math.max(0.0, combinedScore - 0.35);
          }

          // Formulation modifier conflict check (e.g. plain DYTOR vs DYTOR PLUS / COMBIKIT; PAN 40 vs PAN D)
          const modifierConflict = hasFormulationModifierConflict(ocrText, row.name);
          if (modifierConflict) {
            combinedScore = Math.max(0.0, combinedScore - 0.45);
          }

          if (combinedScore >= effectiveThreshold) {
            scoredMatches.push({ name: row.name, score: combinedScore });
          }
        }
      }
    } catch (ftsErr) {
      // FTS5 not available — fall through to full-array scan
      console.warn('[Filter] FTS5 query failed, using full-array fallback:', (ftsErr as any).message);
    }

    // Full-array fuzzy matching fallback (skip if FTS5 already found a confident result —
    // the O(n) scan over ~286k names is expensive, so only pay for it when FTS5 has nothing)
    if (!fts5Used || scoredMatches.length < 1) {
      for (const medicineName of this.medicineNames) {
        if (effectiveDosageForm && isItemTypeConflicting(effectiveDosageForm, medicineName)) {
          continue; // Clinical conflict: e.g. tablet vs syrup in medicine title
        }
        let similarityScore = enhancedSimilarity(normalizedOcr, medicineName.toLowerCase());
        if (rawOcrText) {
          const ocrStr = extractDrugStrength(rawOcrText);
          const medStr = extractDrugStrength(medicineName);
          const isReliableOcrStrength = ocrStr.unit !== null || (ocrStr.components && ocrStr.components.length > 1);
          if (ocrStr.strength && medStr.strength && isReliableOcrStrength) {
            if (areStrengthsEqual(ocrStr, medStr)) {
              similarityScore = Math.min(1.0, similarityScore + 0.20);
            } else if (areStrengthsConflicting(ocrStr, medStr)) {
              similarityScore = Math.max(0.0, similarityScore - 0.50);
            }
          }
        }
        if (hasFormulationModifierConflict(normalizedOcr, medicineName)) {
          similarityScore = Math.max(0.0, similarityScore - 0.45);
        }
        if (similarityScore >= effectiveThreshold) {
          // Avoid duplicates from FTS5 results
          if (!scoredMatches.some(m => m.name === medicineName)) {
            scoredMatches.push({ name: medicineName, score: similarityScore });
          }
        }
      }
    }

    // Sort using the cached score to avoid redundant Levenshtein matrix calculations
    scoredMatches.sort((a, b) => b.score - a.score);
    const localMatches = scoredMatches.map(item => item.name);

    // Determine if we need to use internet fallback
    const hasLocalMatches = localMatches.length > 0;
    const localConfidence = hasLocalMatches ?
      scoredMatches.reduce((sum, item) => sum + item.score, 0) / scoredMatches.length : 0;
    const shouldUseFallback = enableInternetFallback &&
      (!hasLocalMatches || localConfidence < minConfidenceThreshold);

    let internetMatches: string[] = [];
    let fallbackUsed = false;

    // Internet fallback (if enabled and needed)
    if (shouldUseFallback) {
      try {
        fallbackUsed = true;
        internetMatches = await this.queryInternetApi(
          normalizedOcr,
          internetApiEndpoint || 'https://api.fda.gov/drug/ndc.json',
          internetApiKey || process.env.OPENFDA_API_KEY,
          fallbackTimeoutMs,
          minConfidenceThreshold
        );
      } catch (error) {
        console.warn('Internet API query failed, falling back to local results only:', error);
      }
    }

    // Combine results (prioritizing local matches, then adding unique internet matches)
    const allMatches = [...localMatches];
    for (const match of internetMatches) {
      if (!allMatches.includes(match)) {
        allMatches.push(match);
      }
    }

    // Pharmarack catalog fallback: if no local/internet match, search offline distributor cache
    let catalogResults: { mapped: any[]; nonMapped: any[] } | undefined;
    if (allMatches.length === 0) {
      try {
        const { pharmarackCatalogCache } = await import('./pharmarackCatalogCache.js');
        catalogResults = await pharmarackCatalogCache.searchCatalog(normalizedOcr, dosageForm, mrp, mrpTolerance);
        if (catalogResults && (catalogResults.mapped?.length > 0 || catalogResults.nonMapped?.length > 0)) {
          // Add catalog product names to matches
          for (const p of [...(catalogResults.mapped || []), ...(catalogResults.nonMapped || [])]) {
            if (!allMatches.includes(p.name)) {
              allMatches.push(p.name);
            }
          }
        }
      } catch (catalogErr) {
        console.warn('[Filter] Pharmarack catalog fallback failed:', (catalogErr as any).message);
      }
    }

    // Calculate average confidence
    const totalMatches = allMatches.length;
    let averageConfidence = 0;
    if (totalMatches > 0) {
      averageConfidence = minConfidenceThreshold * 100;
    }

    const result: FilterResult = {
      matches: allMatches,
      sources: {
        local: localMatches.length > 0,
        internet: internetMatches.length > 0,
        catalog: !!(catalogResults?.mapped?.length || catalogResults?.nonMapped?.length)
      },
      confidence: averageConfidence,
      fallbackUsed,
      processingTimeMs: Date.now() - startTime,
      catalogResults,
      scoredMatches,
      topScore: scoredMatches.length > 0 ? scoredMatches[0].score : 0
    };

    if (cacheKey) {
      if (this.filterCache.size >= this.FILTER_CACHE_MAX) {
        // Map preserves insertion order — drop the oldest entry to bound memory.
        const oldestKey = this.filterCache.keys().next().value;
        if (oldestKey !== undefined) this.filterCache.delete(oldestKey);
      }
      this.filterCache.set(cacheKey, result);
    }

    return result;
  }

  private async queryInternetApi(
    query: string,
    endpoint: string,
    apiKey: string | undefined,
    timeoutMs: number,
    minConfidenceThreshold: number
  ): Promise<string[]> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    const matches: string[] = [];

    try {
      // 1. Query openFDA API if matching openFDA URL
      if (endpoint.includes('fda.gov')) {
        let fdaUrl = `https://api.fda.gov/drug/ndc.json?search=(brand_name:"${encodeURIComponent(query)}"+generic_name:"${encodeURIComponent(query)}")&limit=5`;
        if (apiKey) {
          fdaUrl += `&api_key=${apiKey}`;
        }

        const response = await fetch(fdaUrl, {
          signal: abortController.signal,
          method: 'GET'
        });

        if (response.ok) {
          const data = await response.json();
          if (data && Array.isArray(data.results)) {
            data.results.forEach((item: any) => {
              if (item.brand_name && typeof item.brand_name === 'string') {
                matches.push(item.brand_name);
              }
              if (item.generic_name && typeof item.generic_name === 'string') {
                matches.push(item.generic_name);
              }
            });
          }
        }
      }

      // 2. Query RxNav RxNorm API (NLM)
      const rxNavUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(query)}`;
      const responseRx = await fetch(rxNavUrl, {
        signal: abortController.signal,
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (responseRx.ok) {
        const data = await responseRx.json();
        if (data && data.drugGroup && Array.isArray(data.drugGroup.conceptGroup)) {
          data.drugGroup.conceptGroup.forEach((group: any) => {
            if (group.conceptProperties && Array.isArray(group.conceptProperties)) {
              group.conceptProperties.forEach((prop: any) => {
                if (prop.name && typeof prop.name === 'string') {
                  matches.push(prop.name);
                }
              });
            }
          });
        }
      }

      clearTimeout(timeoutId);

      // Filter and return unique matches with high similarity
      const uniqueMatches = Array.from(new Set(matches));
      return uniqueMatches.filter(matchName => 
        stringSimilarity(query, matchName.toLowerCase()) >= minConfidenceThreshold
      );

    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Internet API request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
  }
}

// Export singleton instance
export const productNameFilterService = new ProductNameFilterService();
export default productNameFilterService;