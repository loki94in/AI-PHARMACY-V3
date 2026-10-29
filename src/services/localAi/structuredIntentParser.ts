/**
 * Structured Intent Parser for Qwen3-1.7B Q4_K_M
 * Extracts and strictly validates bounded intent schemas from raw model output.
 * Guarantees domain safety: filters out non-medicine health conditions (e.g. "BP")
 * and strictly prevents invented medicines, packaging, or quantities.
 */

import type { LocalAiIntentType, MedicineItem, StructuredIntentResult } from './types.js';

export const MAX_MEDICINE_ITEMS = 5;
export const MAX_NAME_LENGTH = 100;
export const MAX_UNIT_LENGTH = 20;
export const MAX_EXPLANATION_LENGTH = 200;
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 100;

const VALID_INTENTS: Set<LocalAiIntentType> = new Set(['ORDER', 'REFILL', 'INQUIRY', 'CHITCHAT', 'UNKNOWN']);

/**
 * Catalog of health conditions, symptoms, and generic medicine placeholders.
 * These are NOT specific pharmaceutical products and must NEVER be extracted as medicine items.
 */
export const NON_MEDICINE_TERMS: Set<string> = new Set([
  'bp',
  'blood pressure',
  'high bp',
  'low bp',
  'sugar',
  'diabetes',
  'fever',
  'bukhar',
  'bukhar ki dawai',
  'cold',
  'sardi',
  'cough',
  'khansi',
  'headache',
  'sar dard',
  'sir dard',
  'pain',
  'dard',
  'body pain',
  'bodyache',
  'pet dard',
  'stomach ache',
  'stomach pain',
  'chest pain',
  'acidity',
  'gas',
  'loose motion',
  'diarrhea',
  'vomiting',
  'ultee',
  'ulti',
  'allergy',
  'infection',
  'asthma',
  'thyroid',
  'cholesterol',
  'cancer',
  'heart',
  'dawai',
  'dawa',
  'dawayi',
  'medicine',
  'medicines',
  'med',
  'meds',
  'goli',
  'tablet',
  'tablets',
  'capsule',
  'capsules',
  'syrup',
  'injection',
  'regular dawai',
  'purani dawai',
  'same medicine',
  'regular medicine',
  'regular dawa',
  'prescription'
]);

/**
 * Known command / script / SQL injection patterns to strictly reject.
 */
const FORBIDDEN_SYNTAX_REGEX = /<script\b|javascript:|cmd\.exe|powershell\b|rm\s+-rf|DROP\s+TABLE|UNION\s+SELECT|exec\s*\(|eval\s*\(/i;

/**
 * Normalizes and clamps intent to valid enum.
 */
export function normalizeIntent(rawIntent: unknown): LocalAiIntentType {
  if (typeof rawIntent !== 'string') return 'UNKNOWN';
  const upper = rawIntent.trim().toUpperCase();
  if (VALID_INTENTS.has(upper as LocalAiIntentType)) {
    return upper as LocalAiIntentType;
  }
  if (upper === 'GREETING' || upper === 'CONVERSATION' || upper === 'CHAT') return 'CHITCHAT';
  if (upper === 'ENQUIRY' || upper === 'QUESTION' || upper === 'INFO') return 'INQUIRY';
  if (upper === 'PURCHASE' || upper === 'BUY') return 'ORDER';
  if (upper === 'REPEAT') return 'REFILL';
  return 'UNKNOWN';
}

/**
 * Normalizes confidence score, clamping strictly to [0.0, 1.0].
 */
export function normalizeConfidence(rawConfidence: unknown): number {
  if (typeof rawConfidence === 'string') {
    const parsed = parseFloat(rawConfidence);
    return normalizeConfidence(parsed);
  }
  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence) || Number.isNaN(rawConfidence)) {
    return 0.0;
  }
  let val = rawConfidence;
  // If model returned percentage (2 to 100), convert to [0.0, 1.0]
  if (val >= 2.0 && val <= 100.0) {
    val = val / 100.0;
  }
  return Math.max(0.0, Math.min(1.0, Math.round(val * 100) / 100));
}

/**
 * Cleans string, stripping HTML/control characters and trimming length.
 */
export function sanitizeString(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, '') // strip HTML
    .replace(/[\r\n\t]+/g, ' ') // collapse control chars
    .replace(/[;&|`$]+/g, ' ') // neutralize shell operators
    .trim()
    .slice(0, maxLength);
}

/**
 * Checks if a string represents a generic condition, symptom, or non-medicine word.
 */
export function isNonMedicineCondition(rawName: string): boolean {
  if (!rawName) return true;
  const cleaned = rawName.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
  if (NON_MEDICINE_TERMS.has(cleaned)) return true;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length <= 2 && tokens.every(t => NON_MEDICINE_TERMS.has(t))) {
    return true;
  }
  return false;
}

/**
 * Validates and bounds a single medicine item.
 * Strictly filters out health conditions, symptoms, and code injection attempts.
 */
export function normalizeMedicineItem(rawItem: unknown): MedicineItem | null {
  if (!rawItem || typeof rawItem !== 'object') return null;
  const item = rawItem as Record<string, unknown>;

  const rawName = item.name || item.medicine || item.medicineName;
  if (typeof rawName !== 'string') return null;

  // Security check: reject code execution / command injection syntax
  if (FORBIDDEN_SYNTAX_REGEX.test(rawName)) {
    return null;
  }

  const name = sanitizeString(rawName, MAX_NAME_LENGTH);
  if (!name || name.length < 2) return null;

  // Domain gate: reject medical conditions, symptoms, and generic terms
  if (isNonMedicineCondition(name)) {
    return null;
  }

  // Must contain valid alphanumeric medicine characters
  if (!/^[a-zA-Z0-9\s\-\+\/\.\(\)%]{2,}$/.test(name)) {
    return null;
  }

  let qty = 1;
  const rawQty = item.quantity ?? item.qty;
  if (typeof rawQty === 'number' && Number.isFinite(rawQty)) {
    qty = Math.floor(rawQty);
  } else if (typeof rawQty === 'string') {
    const parsed = parseInt(rawQty, 10);
    if (!Number.isNaN(parsed)) qty = parsed;
  }
  // Enforce bounds: [MIN_QUANTITY, MAX_QUANTITY]
  const boundedQty = Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, qty));

  let unit = sanitizeString(item.unit || item.packaging, MAX_UNIT_LENGTH).toLowerCase();
  if (FORBIDDEN_SYNTAX_REGEX.test(unit) || !unit) {
    unit = 'strip';
  }

  return {
    name,
    quantity: boundedQty,
    unit
  };
}

/**
 * Extracts JSON text from raw LLM output which might contain markdown code blocks or surrounding prose.
 */
export function extractJsonString(rawOutput: string): string | null {
  if (!rawOutput || typeof rawOutput !== 'string') return null;
  const trimmed = rawOutput.trim();

  // Case 1: Markdown code block (```json ... ``` or ``` ...)
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }

  // Case 2: Direct or embedded JSON object {...}
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1) {
    if (lastBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1).trim();
    }
    // Return unclosed JSON string so JSON.parse can report parse failure
    return trimmed.slice(firstBrace).trim();
  }

  return null;
}

/**
 * Structured intent parser for Qwen3-1.7B Q4_K_M.
 * Never throws — always returns a safe, fully bounded StructuredIntentResult.
 */
export function parseStructuredIntent(rawOutput: string | null | undefined): StructuredIntentResult {
  const fallbackResult: StructuredIntentResult = {
    intent: 'UNKNOWN',
    confidence: 0.0,
    medicines: [],
    explanation: 'Fallback: No valid model output',
    rawResponse: typeof rawOutput === 'string' ? rawOutput.slice(0, 500) : ''
  };

  if (!rawOutput || typeof rawOutput !== 'string' || !rawOutput.trim()) {
    return fallbackResult;
  }

  const trimmed = rawOutput.trim();

  // If output is an array root, reject immediately as invalid schema root
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return {
          ...fallbackResult,
          explanation: 'Fallback: JSON root is not an object'
        };
      }
    } catch (_) {}
  }

  const jsonStr = extractJsonString(rawOutput);
  if (!jsonStr) {
    return {
      ...fallbackResult,
      explanation: 'Fallback: No JSON object found in output'
    };
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ...fallbackResult,
        explanation: 'Fallback: JSON root is not an object'
      };
    }

    const intent = normalizeIntent(parsed.intent);
    const confidence = normalizeConfidence(parsed.confidence ?? (intent === 'UNKNOWN' ? 0.0 : 0.8));

    // Bounded medicines list (max MAX_MEDICINE_ITEMS)
    const medicines: MedicineItem[] = [];
    const rawList = Array.isArray(parsed.medicines)
      ? parsed.medicines
      : (Array.isArray(parsed.items) ? parsed.items : []);

    for (const rawItem of rawList) {
      if (medicines.length >= MAX_MEDICINE_ITEMS) break;
      const normalized = normalizeMedicineItem(rawItem);
      if (normalized) {
        medicines.push(normalized);
      }
    }

    const explanation = sanitizeString(parsed.explanation || parsed.reason, MAX_EXPLANATION_LENGTH) ||
      `Classified as ${intent} with ${medicines.length} medicine(s)`;

    return {
      intent,
      confidence,
      medicines,
      explanation,
      rawResponse: rawOutput.slice(0, 1000)
    };
  } catch (err) {
    return {
      ...fallbackResult,
      explanation: `Fallback: JSON parse failed (${err instanceof Error ? err.message : 'Syntax error'})`
    };
  }
}
