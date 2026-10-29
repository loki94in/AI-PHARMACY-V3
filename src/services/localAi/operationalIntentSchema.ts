/**
 * Operational Intent Schema for Qwen3-1.7B
 *
 * Defines bounded operational intent schemas and safe parsing routines
 * for the natural-language pharmacy operating assistant.
 */

export type OperationalIntent =
  | 'EXPIRY_AUDIT'
  | 'DISTRIBUTOR_RETURN_DRAFT'
  | 'LOW_STOCK_REORDER'
  | 'SALES_SUMMARY'
  | 'PURCHASE_QUERY'
  | 'DELIVERY_STATUS'
  | 'REFILL_MANAGEMENT'
  | 'STOCK_ADJUSTMENT'
  | 'CUSTOMER_ENQUIRY'
  | 'PAGE_GUIDANCE'
  | 'CHITCHAT'
  | 'UNKNOWN';

export interface OperationalModelOutput {
  intent: OperationalIntent;
  confidence: number;
  timeframeDays?: number;
  medicineName?: string;
  distributorName?: string;
  actionRequested?: 'QUERY' | 'DRAFT' | 'CONFIRM' | 'CANCEL';
  targetId?: string | number;
  explanation: string;
}

const VALID_INTENTS = new Set<OperationalIntent>([
  'EXPIRY_AUDIT',
  'DISTRIBUTOR_RETURN_DRAFT',
  'LOW_STOCK_REORDER',
  'SALES_SUMMARY',
  'PURCHASE_QUERY',
  'DELIVERY_STATUS',
  'REFILL_MANAGEMENT',
  'STOCK_ADJUSTMENT',
  'CUSTOMER_ENQUIRY',
  'PAGE_GUIDANCE',
  'CHITCHAT',
  'UNKNOWN'
]);

/**
 * Builds standard operational system prompt for Qwen3-1.7B.
 */
export function buildOperationalSystemPrompt(): string {
  return `You are the natural-language operating assistant for AI Pharmacy OS.
Given instructions from the store owner, pharmacist, or patient, classify the operational intent into one of:
- EXPIRY_AUDIT: Check expiring or expired medicine batches
- DISTRIBUTOR_RETURN_DRAFT: Prepare, draft, or show distributor return lists for expiring medicines
- LOW_STOCK_REORDER: Check fast-moving low stock or draft reorders
- SALES_SUMMARY: Query today's or historical sales turnover, tickets, or comparisons
- PURCHASE_QUERY: Inquire about purchase rates, supplier invoices, or PTR
- DELIVERY_STATUS: Inquire about pending home deliveries or delivery boys
- REFILL_MANAGEMENT: Inquire about, prepare, or confirm patient prescription refills
- STOCK_ADJUSTMENT: Request stock correction or physical inventory adjustments
- CUSTOMER_ENQUIRY: Record or list customer medicine inquiries
- PAGE_GUIDANCE: Explain current screen, shortcut keys, or workflow instructions
- CHITCHAT: Casual conversation, greeting, or sign-off
- UNKNOWN: Request cannot be classified

Respond ONLY with a valid JSON object:
{
  "intent": "EXPIRY_AUDIT" | "DISTRIBUTOR_RETURN_DRAFT" | "LOW_STOCK_REORDER" | "SALES_SUMMARY" | "PURCHASE_QUERY" | "DELIVERY_STATUS" | "REFILL_MANAGEMENT" | "STOCK_ADJUSTMENT" | "CUSTOMER_ENQUIRY" | "PAGE_GUIDANCE" | "CHITCHAT" | "UNKNOWN",
  "confidence": 0.0 to 1.0,
  "timeframeDays": number or null,
  "medicineName": string or null,
  "distributorName": string or null,
  "actionRequested": "QUERY" | "DRAFT" | "CONFIRM" | "CANCEL",
  "targetId": string or null,
  "explanation": "Brief explanation"
}`;
}

/**
 * Safely parses raw model output string into a validated OperationalModelOutput.
 * Never throws — always returns safe bounded structure.
 */
export function parseOperationalIntent(raw: string): OperationalModelOutput {
  const fallback: OperationalModelOutput = {
    intent: 'UNKNOWN',
    confidence: 0,
    actionRequested: 'QUERY',
    explanation: 'Fallback unparsed or invalid output'
  };

  if (!raw || typeof raw !== 'string') return fallback;

  try {
    let clean = raw.trim();
    // Strip markdown code fences if model enclosed in ```json ... ```
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return fallback;
    }

    const parsed = JSON.parse(clean.substring(firstBrace, lastBrace + 1));
    if (!parsed || typeof parsed !== 'object') return fallback;

    let intent: OperationalIntent = 'UNKNOWN';
    if (parsed.intent && typeof parsed.intent === 'string') {
      const normalized = parsed.intent.toUpperCase().trim() as OperationalIntent;
      if (VALID_INTENTS.has(normalized)) {
        intent = normalized;
      }
    }

    let confidence = Number(parsed.confidence);
    if (isNaN(confidence) || confidence < 0) confidence = 0;
    if (confidence > 1) confidence = 1;

    let timeframeDays: number | undefined;
    if (parsed.timeframeDays != null && !isNaN(Number(parsed.timeframeDays))) {
      timeframeDays = Math.max(1, Math.min(365, Math.round(Number(parsed.timeframeDays))));
    }

    let medicineName: string | undefined;
    if (parsed.medicineName && typeof parsed.medicineName === 'string') {
      const med = parsed.medicineName.trim();
      if (med.length >= 2 && med.length <= 100) medicineName = med;
    }

    let distributorName: string | undefined;
    if (parsed.distributorName && typeof parsed.distributorName === 'string') {
      const dist = parsed.distributorName.trim();
      if (dist.length >= 2 && dist.length <= 100) distributorName = dist;
    }

    let actionRequested: 'QUERY' | 'DRAFT' | 'CONFIRM' | 'CANCEL' = 'QUERY';
    if (parsed.actionRequested && typeof parsed.actionRequested === 'string') {
      const act = parsed.actionRequested.toUpperCase().trim();
      if (act === 'DRAFT' || act === 'CONFIRM' || act === 'CANCEL') {
        actionRequested = act;
      }
    }

    let targetId: string | number | undefined;
    if (parsed.targetId != null) {
      targetId = String(parsed.targetId).trim().slice(0, 50);
    }

    return {
      intent,
      confidence,
      timeframeDays,
      medicineName,
      distributorName,
      actionRequested,
      targetId,
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation.slice(0, 200) : ''
    };
  } catch {
    return fallback;
  }
}
