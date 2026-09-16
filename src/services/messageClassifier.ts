/**
 * messageClassifier.ts
 *
 * Email message relevance classifier for promotional / business message filtering.
 *
 * Reuses the existing `isPromotionalOrBroadcastMessage` from intentKeywords.ts
 * and adds business-signal scoring so that emails from known distributors that
 * contain promotional content are still correctly classified as PROMOTIONAL, while
 * transactional emails (invoices, dispatch notices) are marked DISTRIBUTOR_BUSINESS.
 *
 * INSERTION POINT: Called from emailService.ts syncNewEmailsFromIMAP() after
 * email is parsed and before notifyMailArrival() is called.
 */

import { isPromotionalOrBroadcastMessage } from './intentKeywords.js';

export type MessageClassification =
  | 'CUSTOMER'
  | 'DISTRIBUTOR_BUSINESS'
  | 'PROMOTIONAL'
  | 'UNKNOWN';

export interface ClassificationResult {
  classification: MessageClassification;
  reason: string;
  confidence: number; // 0–1
}

// ─── Business signal tokens (weighted) ────────────────────────────────────────
// These indicate a genuine transactional business communication.
const BUSINESS_SIGNALS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\binvoice\b/i, weight: 3 },
  { pattern: /\binvoice\s*#?\s*\d+/i, weight: 4 },
  { pattern: /\bpurchase\s*order\b|\bPO\b/i, weight: 3 },
  { pattern: /\bdispatch(ed)?\b/i, weight: 3 },
  { pattern: /\bshipment\b|\bshipped?\b/i, weight: 2 },
  { pattern: /\bdelivery\b|\bdelivered\b/i, weight: 2 },
  { pattern: /\bpayment\b|\bpaid\b/i, weight: 2 },
  { pattern: /\bcredit\s*(note|statement)?\b/i, weight: 2 },
  { pattern: /\bstatement\b/i, weight: 2 },
  { pattern: /\bstock\s*(availability|shortage|update)\b/i, weight: 2 },
  { pattern: /\bshortage\b/i, weight: 2 },
  { pattern: /\bquantity\b|\bqty\b/i, weight: 1 },
  { pattern: /\bbatch\b/i, weight: 1 },
  { pattern: /\bexpiry\b|\bexp\.?\s*date\b/i, weight: 1 },
  { pattern: /\bmrp\b|\brate\b/i, weight: 1 },
  { pattern: /\bgst\b|\bsgst\b|\bcgst\b/i, weight: 2 },
  { pattern: /\bprescription\b/i, weight: 2 },
  { pattern: /\brefill\b/i, weight: 2 },
  { pattern: /\border\s*(placed|confirmed|received)\b/i, weight: 3 },
  { pattern: /\btracking\b|\btrack\b/i, weight: 2 },
];

// ─── Customer signal tokens ────────────────────────────────────────────────────
const CUSTOMER_SIGNALS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\bmy\s*order\b|\border\s*status\b/i, weight: 3 },
  { pattern: /\brefill\b/i, weight: 2 },
  { pattern: /\bprescription\b/i, weight: 2 },
  { pattern: /\bwhen\s*(will|can)\b/i, weight: 2 },
  { pattern: /\bavailable\b/i, weight: 1 },
  { pattern: /\bpickup\b/i, weight: 2 },
  { pattern: /\bdelivery\s*time\b|\bwhen.*deliver\b/i, weight: 2 },
  { pattern: /\bbill\b|\binvoice\b/i, weight: 1 },
];

// ─── Strong promotional overrides (presence alone = PROMOTIONAL if high weight) ─
const STRONG_PROMO_SIGNALS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\bunsubscribe\b/i, weight: 5 },
  { pattern: /\bopt[- ]?out\b/i, weight: 5 },
  { pattern: /\bclick here to unsubscribe\b/i, weight: 6 },
  { pattern: /\bnewsletter\b/i, weight: 4 },
  { pattern: /\bexclusive offer\b/i, weight: 4 },
  { pattern: /\blimited[- ]time\s*(offer|deal)\b/i, weight: 4 },
  { pattern: /\bspecial\s*(offer|deal|discount)\b/i, weight: 3 },
  { pattern: /\b\d+%\s*off\b|\b\d+%\s*discount\b/i, weight: 3 },
  { pattern: /\bcashback\b/i, weight: 3 },
  { pattern: /\bbuy\s*now\b/i, weight: 3 },
  { pattern: /\bcoupon\b|\bvoucher\b/i, weight: 3 },
  { pattern: /\bflash\s*sale\b/i, weight: 4 },
  { pattern: /\bfestival\s*(sale|offer)\b/i, weight: 4 },
  { pattern: /\bmarketing\b/i, weight: 2 },
  { pattern: /\bcampaign\b/i, weight: 2 },
  { pattern: /\bno[- ]?reply@/i, weight: 2 }, // matches noreply@ in from_addr
  { pattern: /\bmailer@|@newsletter\.|@marketing\./i, weight: 3 },
];

function scoreSignals(
  text: string,
  signals: Array<{ pattern: RegExp; weight: number }>
): number {
  let score = 0;
  for (const s of signals) {
    if (s.pattern.test(text)) {
      score += s.weight;
    }
  }
  return score;
}

/**
 * Classify an incoming email message.
 *
 * Conservative: when uncertain, returns UNKNOWN → existing processing continues.
 *
 * @param from        Email `from` address string
 * @param subject     Email subject line
 * @param body        Email plain-text body
 * @param isKnownDistributor  Whether the sender is in the pharmacy's distributor list
 */
export function classifyEmailMessage(
  from: string,
  subject: string,
  body: string,
  isKnownDistributor: boolean
): ClassificationResult {
  const combined = `${from} ${subject} ${body}`;
  const subjectBody = `${subject} ${body}`;

  try {
    // ── Step 1: Strong promo signals (overrides sender identity) ──────────────
    const strongPromoScore = scoreSignals(combined, STRONG_PROMO_SIGNALS);

    // ── Step 2: WhatsApp-compatible promotional classifier (text signals) ─────
    const isWaPromo = isPromotionalOrBroadcastMessage(subjectBody);

    // ── Step 3: Business & customer signals ───────────────────────────────────
    const businessScore = scoreSignals(subjectBody, BUSINESS_SIGNALS);
    const customerScore = scoreSignals(subjectBody, CUSTOMER_SIGNALS);

    // ── Decision logic ────────────────────────────────────────────────────────
    //
    // PROMOTIONAL if:
    //   - strong promo score >= 5, OR
    //   - isWaPromo AND (business score is low or promo signals dominate), OR
    //   - isWaPromo AND businessScore < 4 (not a genuine transaction)
    //
    // DISTRIBUTOR_BUSINESS if:
    //   - isKnownDistributor AND businessScore >= 4
    //   - even with some discount language (e.g. "invoice with 10% CD") the business
    //     score will dominate because invoice+quantity+batch signals are present
    //
    // CUSTOMER if:
    //   - customerScore >= 4 AND not promotional
    //
    // UNKNOWN: conservative fallback

    if (strongPromoScore >= 5) {
      const confidence = Math.min(strongPromoScore / 10, 0.99);
      return {
        classification: 'PROMOTIONAL',
        reason: `Strong promotional signals detected (score=${strongPromoScore})`,
        confidence,
      };
    }

    if (isWaPromo && businessScore < 4) {
      return {
        classification: 'PROMOTIONAL',
        reason: `Promotional language detected (keyword classifier), low business context (businessScore=${businessScore})`,
        confidence: 0.82,
      };
    }

    if (isKnownDistributor && businessScore >= 4) {
      return {
        classification: 'DISTRIBUTOR_BUSINESS',
        reason: `Known distributor sender with strong business signals (score=${businessScore})`,
        confidence: Math.min(0.6 + businessScore * 0.05, 0.98),
      };
    }

    if (!isKnownDistributor && businessScore >= 5) {
      return {
        classification: 'DISTRIBUTOR_BUSINESS',
        reason: `Strong business/transactional signals from unknown sender (score=${businessScore})`,
        confidence: Math.min(0.5 + businessScore * 0.04, 0.90),
      };
    }

    if (customerScore >= 4) {
      return {
        classification: 'CUSTOMER',
        reason: `Customer inquiry/order signals detected (score=${customerScore})`,
        confidence: Math.min(0.5 + customerScore * 0.06, 0.90),
      };
    }

    // Conservative fallback — do NOT discard unknown messages
    return {
      classification: 'UNKNOWN',
      reason: `Insufficient signals for confident classification (business=${businessScore}, customer=${customerScore}, strongPromo=${strongPromoScore})`,
      confidence: 0,
    };
  } catch (err) {
    // Classification error → safe fallback: UNKNOWN → existing processing continues
    return {
      classification: 'UNKNOWN',
      reason: `Classification error: ${err instanceof Error ? err.message : 'unknown'}`,
      confidence: 0,
    };
  }
}
