/**
 * Operational Intent Schema for Qwen3-1.7B
 *
 * Defines bounded operational intent schemas and safe parsing routines
 * for the natural-language pharmacy operating assistant.
 */

export type OperationalIntent =
  | 'CART_STAGING'
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
  quantity?: number;
  unit?: string;
  destination?: 'live_cart' | 'pos_cart';
  targetPage?: string;
  targetTab?: string;
  actionRequested?: 'QUERY' | 'DRAFT' | 'CONFIRM' | 'CANCEL';
  targetId?: string | number;
  explanation: string;
}

const VALID_INTENTS = new Set<OperationalIntent>([
  'CART_STAGING',
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
  return `You are the expert clinical and operational copilot for AI Pharmacy OS.
Your goal is to guide the user, explain any screen or setting, and parse pharmacy operations into structured actions.

APPLICATION ARCHITECTURE & SITEMAP:
- /live-cart & /pharmarack-cart: Order Hub & Live Cart. Shows distributor cart, auto-order thresholds, Pharmarack integration.
- /settings: System configuration.
  • Tab 'integrations': Pharmarack distributor login credentials, retailer ID, Order Hub connection.
  • Tab 'whatsapp': WhatsApp Web QR connection, inbound bot sleep timers.
  • Tab 'order_timing': Distributor order windows and delivery cutoff schedules.
  • Tab 'triggers': Automated background schedules, token refresh heartbeat.
  • Tab 'hardware' or printer: Receipt thermal printers, cash drawer setup.
  • Tab 'store': Pharmacy business info, Drug License (DL 20B/21B), GSTIN, bill headers.
  • Tab 'backups': SQLite backup drills, automated snapshot scheduling.
  • Tab 'staff': Staff accounts, roles, access PINs.
- /pos: Fast counter billing. Keyboard shortcuts: F2 search, Ctrl+P print, Alt+N new customer.
- /purchases: Inward distributor invoices, scan bills via OCR, track PTR/cost.
- /inventory: Stock ledger, rack locations, batch expiries, physical count corrections.
- /crm: Chronic patient profiles, repeat refills, WhatsApp reminders.
- /returns: Supplier returns, near-expiry debit memos.
- /dispatch: Delivery boy assignments, home delivery dispatch.
- /sells & /reports: Daily turnover, profit margin, GST tax summary.
- /investigation & /audit: Full database audit ledger, mutation traceability.

Classify the user intent into exactly one of:
- PAGE_GUIDANCE: Explain current screen, application settings, Order Hub setup, or keyboard shortcuts (e.g. "where are order hub settings?", "how to connect Pharmarack", "explain POS shortcuts", "how do I configure printers?", "how does this app work?")
- CART_STAGING: Adding medicine to the billing cart or distributor Live Cart (e.g. "add 6 strip Dolo 650 to live cart", "put 2 Pan-D in bill")
- REFILL_MANAGEMENT: Checking, preparing, or confirming patient prescription refills (e.g. "check Rajesh refill due", "prepare monthly refill")
- EXPIRY_AUDIT: Check expiring or expired medicine batches across store inventory
- DISTRIBUTOR_RETURN_DRAFT: Prepare or show distributor return memo for expiring medicines
- LOW_STOCK_REORDER: Check fast-moving low stock shortages or draft reorders
- SALES_SUMMARY: Query sales turnover, tickets, today vs yesterday comparisons
- PURCHASE_QUERY: Inquire about purchase rates, supplier invoices, or PTR
- DELIVERY_STATUS: Inquire about home delivery runs or delivery agents
- STOCK_ADJUSTMENT: Correct physical stock quantities in inventory
- CUSTOMER_ENQUIRY: Record customer medicine procurement enquiry
- CHITCHAT: Greeting or general conversational remarks
- UNKNOWN: Request cannot be classified

Respond ONLY with a valid JSON object matching:
{
  "intent": "PAGE_GUIDANCE" | "CART_STAGING" | "REFILL_MANAGEMENT" | "EXPIRY_AUDIT" | "DISTRIBUTOR_RETURN_DRAFT" | "LOW_STOCK_REORDER" | "SALES_SUMMARY" | "PURCHASE_QUERY" | "DELIVERY_STATUS" | "STOCK_ADJUSTMENT" | "CUSTOMER_ENQUIRY" | "CHITCHAT" | "UNKNOWN",
  "confidence": 0.0 to 1.0,
  "targetPage": string or null (e.g. "/settings", "/live-cart", "/pos", "/purchases", "/crm", "/inventory"),
  "targetTab": string or null (e.g. "integrations", "whatsapp", "order_timing", "hardware", "store", "backups"),
  "medicineName": string or null (clean medicine brand name only, without 'the', numbers, or cart words),
  "quantity": number or null (e.g. 6),
  "unit": string or null (e.g. "strip", "tablet", "box", "bottle"),
  "destination": "live_cart" | "pos_cart" | null,
  "timeframeDays": number or null,
  "distributorName": string or null,
  "actionRequested": "QUERY" | "DRAFT" | "CONFIRM" | "CANCEL",
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
      let med = parsed.medicineName.trim().replace(/^the\s+/i, '');
      if (med.length >= 2 && med.length <= 100) medicineName = med;
    }

    let quantity: number | undefined;
    if (parsed.quantity != null && !isNaN(Number(parsed.quantity))) {
      quantity = Math.max(1, Math.min(1000, Math.round(Number(parsed.quantity))));
    }

    let unit: string | undefined;
    if (parsed.unit && typeof parsed.unit === 'string') {
      unit = parsed.unit.trim().toLowerCase();
    }

    let destination: 'live_cart' | 'pos_cart' | undefined;
    if (parsed.destination && typeof parsed.destination === 'string') {
      const d = parsed.destination.toLowerCase().trim();
      if (d === 'live_cart' || d === 'pharmarack' || d.includes('live')) {
        destination = 'live_cart';
      } else if (d === 'pos_cart' || d === 'pos' || d.includes('bill') || d.includes('pos')) {
        destination = 'pos_cart';
      }
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

    let targetPage: string | undefined;
    if (parsed.targetPage && typeof parsed.targetPage === 'string') {
      const p = parsed.targetPage.trim();
      if (p.startsWith('/')) targetPage = p;
    }

    let targetTab: string | undefined;
    if (parsed.targetTab && typeof parsed.targetTab === 'string') {
      targetTab = parsed.targetTab.trim().toLowerCase();
    }

    return {
      intent,
      confidence,
      timeframeDays,
      medicineName,
      distributorName,
      quantity,
      unit,
      destination,
      targetPage,
      targetTab,
      actionRequested,
      targetId,
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation.slice(0, 200) : ''
    };
  } catch {
    return fallback;
  }
}

