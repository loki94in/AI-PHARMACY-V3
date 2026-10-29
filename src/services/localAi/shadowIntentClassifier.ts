/**
 * Non-Blocking Shadow Intent Classifier for Ambiguous WhatsApp Text
 *
 * Safety Guarantees:
 * 1. Non-blocking: Executes fire-and-forget; never delays WhatsApp response delivery.
 * 2. Strict Bypass: Immediately skips confirmations, media messages, repeat orders, and explicit IDs.
 * 3. Authoritative Isolation: The existing deterministic parser and business workflows remain authoritative.
 * 4. Zero Business Impact: No order, cart, inventory, pricing, CRM, POS, OCR, or distributor action is driven by model output.
 */

import fs from 'fs';
import path from 'path';
import {
  isRepeatRequest,
  isRefillConfirmationResponse,
  isAffirmativeResponse,
  isNegativeResponse
} from '../intentKeywords.js';
import { isLocalAiEnabled, queryLocalAiIntent } from './llamaServerClient.js';
import type { ShadowClassificationResult, StructuredIntentResult } from './types.js';

export interface ShadowEvaluationContext {
  phone?: string;
  body: string;
  hasMedia: boolean;
  isRepeat?: boolean;
  isConfirmation?: boolean;
  isExplicitId?: boolean;
}

export interface ShadowBypassDecision {
  shouldRun: boolean;
  reason?: 'LOCAL_AI_DISABLED' | 'MEDIA_BYPASS' | 'CONFIRMATION_BYPASS' | 'REPEAT_BYPASS' | 'EXPLICIT_ID_BYPASS' | 'EMPTY_TEXT';
}

// In-memory circular buffer for recent shadow classifications (observability)
const MAX_SHADOW_LOG_ENTRIES = 50;
const recentShadowLogs: ShadowClassificationResult[] = [];

/**
 * Checks whether the incoming message should be evaluated by the shadow classifier.
 * Strictly enforces confirmation, media, repeat, and explicit ID bypasses.
 */
export function evaluateShadowEligibility(ctx: ShadowEvaluationContext): ShadowBypassDecision {
  if (!isLocalAiEnabled()) {
    return { shouldRun: false, reason: 'LOCAL_AI_DISABLED' };
  }

  if (ctx.hasMedia) {
    return { shouldRun: false, reason: 'MEDIA_BYPASS' };
  }

  const rawText = (ctx.body || '').trim();
  if (!rawText) {
    return { shouldRun: false, reason: 'EMPTY_TEXT' };
  }

  // Explicit confirmation flag or single-digit menu choice ("1", "2", "y", "n")
  if (ctx.isConfirmation || /^(?:1|2|y|n)$/i.test(rawText)) {
    return { shouldRun: false, reason: 'CONFIRMATION_BYPASS' };
  }

  if (rawText.length < 2) {
    return { shouldRun: false, reason: 'EMPTY_TEXT' };
  }

  // 1. Repeat / Refill request bypass ("same", "wahi", refill requests) — evaluated first
  if (ctx.isRepeat || isRepeatRequest(rawText) || /\brefill\b/i.test(rawText)) {
    return { shouldRun: false, reason: 'REPEAT_BYPASS' };
  }

  // 2. Explicit ID bypass ("#4512", "med 4512")
  if (ctx.isExplicitId || /^(?:#|id\s*#?|med(?:icine)?\s*#?|order\s*#?)\d{1,7}/i.test(rawText)) {
    return { shouldRun: false, reason: 'EXPLICIT_ID_BYPASS' };
  }

  // 3. Confirmation bypass ("YES", "haan", "NO", "cancel", "1", "2", etc.)
  const wordCount = rawText.split(/\s+/).length;
  const isShortReply = wordCount <= 4;
  if (
    ctx.isConfirmation ||
    (isShortReply && (
      isRefillConfirmationResponse(rawText) ||
      isAffirmativeResponse(rawText) ||
      isNegativeResponse(rawText) ||
      /^(yes|haan|ha|ho|ok|okay|confirm|confirmed|no|nahi|nhi|cancel|1|2)$/i.test(rawText)
    ))
  ) {
    return { shouldRun: false, reason: 'CONFIRMATION_BYPASS' };
  }

  return { shouldRun: true };
}

/**
 * Records a completed shadow classification into memory and shadow log file.
 */
function recordShadowLog(result: ShadowClassificationResult): void {
  recentShadowLogs.unshift(result);
  if (recentShadowLogs.length > MAX_SHADOW_LOG_ENTRIES) {
    recentShadowLogs.pop();
  }

  try {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (fs.existsSync(dataDir)) {
      const logFile = path.join(dataDir, 'shadow_intent.log');
      fs.appendFileSync(logFile, JSON.stringify(result) + '\n', 'utf8');
    }
  } catch (_) {
    // Non-blocking logging — never throw
  }
}

/**
 * Returns recent in-memory shadow classifications.
 */
export function getRecentShadowClassifications(): ShadowClassificationResult[] {
  return [...recentShadowLogs];
}

/**
 * Clears in-memory shadow classifications (useful for tests).
 */
export function clearRecentShadowClassifications(): void {
  recentShadowLogs.length = 0;
}

/**
 * Asynchronously runs shadow classification for an eligible message.
 * Completely non-blocking and isolated.
 */
export async function runShadowClassification(
  ctx: ShadowEvaluationContext,
  deterministicResult: {
    isMedicineRequest: boolean;
    candidateNames: string[];
  }
): Promise<ShadowClassificationResult> {
  const start = Date.now();
  const eligibility = evaluateShadowEligibility(ctx);

  if (!eligibility.shouldRun) {
    const skippedRecord: ShadowClassificationResult = {
      timestamp: new Date().toISOString(),
      phone: ctx.phone || '',
      messageBody: ctx.body,
      shouldRun: false,
      bypassReason: eligibility.reason,
      deterministicResult,
      shadowModelResult: null,
      latencyMs: Date.now() - start
    };
    recordShadowLog(skippedRecord);
    return skippedRecord;
  }

  let modelResult: StructuredIntentResult | null = null;
  try {
    modelResult = await queryLocalAiIntent(ctx.body);
  } catch {
    modelResult = null;
  }

  const modelIsMedicineOrder = modelResult?.intent === 'ORDER' || modelResult?.intent === 'REFILL';
  const agreement = Boolean(deterministicResult.isMedicineRequest === modelIsMedicineOrder);

  const finalRecord: ShadowClassificationResult = {
    timestamp: new Date().toISOString(),
    phone: ctx.phone || '',
    messageBody: ctx.body,
    shouldRun: true,
    deterministicResult,
    shadowModelResult: modelResult,
    agreement,
    latencyMs: Date.now() - start
  };

  recordShadowLog(finalRecord);
  return finalRecord;
}

/**
 * Fire-and-forget trigger for shadow classification in WhatsApp message flows.
 * Guaranteed to return immediately without blocking.
 */
export function triggerShadowClassificationNonBlocking(
  ctx: ShadowEvaluationContext,
  deterministicResult: {
    isMedicineRequest: boolean;
    candidateNames: string[];
  }
): void {
  // Execute async in background without awaiting
  Promise.resolve()
    .then(() => runShadowClassification(ctx, deterministicResult))
    .catch((err) => {
      console.warn('[Local AI Shadow] Background classification error:', err instanceof Error ? err.message : err);
    });
}
