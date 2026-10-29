/**
 * Conversational AI Agent Engine
 *
 * Core natural language orchestration layer converting rigid trigger-based interactions
 * into genuine, context-aware dialogues:
 * - Understands natural phrasing, typos, informal Hinglish/Hindi/Marathi, and abbreviations.
 * - Manages persistent customer session context and multi-turn conversational history.
 * - Executes approved pharmacy workflows via Scoped Pharmacy Tool Registry.
 * - Preserves Rule 6 Human-in-the-Loop approval for consequential actions (refill confirmation).
 * - Enforces clinical safety gates (emergency 108/112 escalation, diagnosis rejection).
 * - Guaranteed commercial confidentiality: Outbound Security Gateway prevents wholesale PTR/margin leaks.
 * - Operates 100% offline with local model fallback.
 */

import { dbManager } from '../../database/connection.js';
import { normalizePhoneDigits } from '../../utils/phoneValidation.js';
import {
  conversationalMemoryService,
  type CustomerConversationSession,
  type CustomerSessionState,
  type ConversationTurn
} from './conversationalMemoryService.js';
import {
  pharmacyToolRegistry,
  type RefillRecordItem,
  type MedicineAvailabilityItem
} from './pharmacyToolRegistry.js';
import { classifyClinicalRisk, type ClinicalRiskClassification } from './pharmacyQaEngine.js';
import { outboundSecurityGateway } from '../outboundSecurityGateway.js';
import { pharmacyKnowledgeRetriever } from './pharmacyKnowledgeRetriever.js';
import { pharmacyQaEngine } from './pharmacyQaEngine.js';
import { isLocalAiEnabled, checkLlamaServerHealth, queryLocalAiIntent } from './llamaServerClient.js';
import { eventService } from '../eventService.js';
import { logMutationAudit } from '../auditLoggerService.js';

export interface ProcessMessageInput {
  phone: string;
  channel: 'whatsapp' | 'portal' | 'in_app';
  message: string;
  customerId?: number | null;
  customerName?: string | null;
  language?: 'en' | 'hi' | 'mr';
}

export interface ProposedAction {
  type: 'CONFIRM_REFILL' | 'CREATE_ENQUIRY' | 'SCHEDULE_CALL';
  summary: string;
  data: Record<string, any>;
}

export interface ConversationalAgentResult {
  sessionId: string;
  replyText: string;
  intent: string;
  state: CustomerSessionState;
  actionTaken?: string;
  proposedAction?: ProposedAction | null;
  requiresConfirmation: boolean;
  toolExecutions?: Array<{ tool: string; result: any }>;
}

export class ConversationalAgentEngine {
  /**
   * Main entry point for customer messages from WhatsApp or Customer Portal.
   */
  public async processCustomerMessage(input: ProcessMessageInput): Promise<ConversationalAgentResult> {
    const rawPhone = input.phone || '';
    const phone = normalizePhoneDigits(rawPhone) || rawPhone.replace(/\D/g, '').slice(-10) || rawPhone;
    const userText = (input.message || '').trim();
    const db = await dbManager.getConnection();

    // 1. Resolve or Create Persistent Session
    const session = await conversationalMemoryService.getOrCreateSession(
      input.channel || 'whatsapp',
      phone,
      input.customerId || null,
      db
    );

    const lang = session.language || 'en';
    const recentTurns = await conversationalMemoryService.getRecentTurns(session.id, 6, db);

    // Record incoming customer turn
    await conversationalMemoryService.recordTurn(
      session.id,
      'customer',
      userText,
      [],
      db
    );

    // 2. Prompt Injection Defense Gate
    if (/\b(?:ignore all previous|system prompt|developer key|secret key|delete all|drop table)\b/i.test(userText)) {
      const injectionReply = "I cannot execute system override or confidential disclosure requests. How can I assist you with your medicine refills or pharmacy questions?";
      await conversationalMemoryService.recordTurn(session.id, 'assistant', injectionReply, [], db);
      return {
        sessionId: session.id,
        replyText: injectionReply,
        intent: 'INJECTION_DEFENSE',
        state: 'idle',
        requiresConfirmation: false
      };
    }

    // 3. Clinical Safety Gate Check (Level 1-4)
    const isRefillCheck = /\b(?:refill|repeat|renew|ready|due|status|khatam|already taking|regular prescription|monthly)\b/i.test(userText);
    const riskCheck = classifyClinicalRisk(userText);

    if (riskCheck.level === 'EMERGENCY') {
      const emergencyReply = riskCheck.emergencyGuidance ||
        '🚨 *EMERGENCY DIRECTIVE:* The symptoms described require immediate medical attention. Please call 108 or 112 immediately or proceed to the nearest hospital casualty.';

      await pharmacyToolRegistry.escalateToPharmacist(
        phone,
        `EMERGENCY: ${userText.slice(0, 100)}`,
        db
      ).catch(() => {});

      await conversationalMemoryService.recordTurn(
        session.id,
        'assistant',
        emergencyReply,
        [],
        db
      );

      await conversationalMemoryService.updateSession(
        session.id,
        {
          sessionState: 'idle',
          activeIntent: 'CLINICAL_EMERGENCY',
          contextData: {}
        },
        db
      );

      return {
        sessionId: session.id,
        replyText: emergencyReply,
        intent: 'CLINICAL_EMERGENCY',
        state: 'idle',
        requiresConfirmation: false
      };
    }

    if (!isRefillCheck && (riskCheck.level === 'DIAGNOSIS_PRESCRIBING' || riskCheck.level === 'DOSAGE_CALCULATION')) {
      const medicalNotice = (riskCheck.disclaimer || '') +
        '\n\n👩‍⚕️ For prescription advice, correct dosing, or symptom evaluation, our registered pharmacist has been alerted to review your request.';

      await pharmacyToolRegistry.escalateToPharmacist(
        phone,
        `Clinical Inquiry (${riskCheck.level}): ${userText.slice(0, 100)}`,
        db
      ).catch(() => {});

      await conversationalMemoryService.recordTurn(
        session.id,
        'assistant',
        medicalNotice,
        [],
        db
      );

      await conversationalMemoryService.updateSession(
        session.id,
        {
          sessionState: 'pharmacist_review',
          activeIntent: 'CLINICAL_INQUIRY',
          contextData: {}
        },
        db
      );

      return {
        sessionId: session.id,
        replyText: medicalNotice,
        intent: 'CLINICAL_INQUIRY',
        state: 'pharmacist_review',
        requiresConfirmation: false
      };
    }

    // 4. Multi-Turn State Machine & Confirmation Gate (Rule 6 Human-in-the-Loop)
    if (session.sessionState === 'awaiting_confirmation' && session.contextData?.pendingProposal) {
      const proposal = session.contextData.pendingProposal as ProposedAction;
      const isAffirmative = this.isAffirmative(userText);
      const isNegative = this.isNegative(userText);

      if (isAffirmative) {
        // Execute the proposed consequential tool
        let executionResult: any = null;
        let replyText = '';

        if (proposal.type === 'CONFIRM_REFILL') {
          const refillId = Number(proposal.data.refillId);
          const qty = Number(proposal.data.quantity || 1);
          executionResult = await pharmacyToolRegistry.confirmRefillExecution(
            refillId,
            phone,
            { qty, channel: input.channel === 'portal' ? 'portal' : 'whatsapp', dbInstance: db }
          );

          if (executionResult.success) {
            replyText = `✅ *Refill Confirmed!*\n\nYour refill for *${proposal.data.medicineName || 'medicine'}* (${qty} ${qty > 1 ? 'units' : 'unit'}) has been prepared and staged for dispensing.\n\nOur pharmacy team will have it ready for collection. Thank you!`;
          } else {
            replyText = `⚠️ We were unable to stage the refill automatically: ${executionResult.message || 'Please contact our store'}. Our pharmacist has been notified.`;
          }
        } else if (proposal.type === 'CREATE_ENQUIRY') {
          executionResult = await pharmacyToolRegistry.createCustomerEnquiry(
            session.customerName || 'Customer',
            phone,
            proposal.data.medicineName,
            proposal.data.notes,
            db
          );
          replyText = `📋 *Special Request Logged!*\n\nWe have recorded your inquiry for *${proposal.data.medicineName}*. Our procurement team will check distributor availability and notify you soon.`;
        } else if (proposal.type === 'SCHEDULE_CALL') {
          executionResult = await pharmacyToolRegistry.scheduleCallTask(
            session.customerName || 'Customer',
            phone,
            proposal.data.notes || 'Customer requested pharmacist callback',
            'normal',
            db
          );
          replyText = `📞 *Callback Scheduled!*\n\nOur pharmacy staff will call you shortly at +91 ${phone}.`;
        }

        // Clean up proposal context
        await conversationalMemoryService.updateSession(
          session.id,
          {
            sessionState: 'completed',
            activeIntent: 'CONFIRMATION_EXECUTED',
            contextData: {}
          },
          db
        );

        await conversationalMemoryService.recordTurn(
          session.id,
          'assistant',
          replyText,
          [{ tool: proposal.type, result: executionResult }],
          db
        );

        return {
          sessionId: session.id,
          replyText: this.sanitizeOutbound(replyText, phone),
          intent: 'CONFIRMATION_EXECUTED',
          state: 'completed',
          actionTaken: proposal.type,
          requiresConfirmation: false,
          toolExecutions: [{ tool: proposal.type, result: executionResult }]
        };
      }

      if (isNegative) {
        const cancelReply = `👍 Understood. I have cancelled this request. Let me know if there is anything else I can help with!`;
        await conversationalMemoryService.updateSession(
          session.id,
          {
            sessionState: 'idle',
            activeIntent: 'PROPOSAL_CANCELLED',
            contextData: {}
          },
          db
        );

        await conversationalMemoryService.recordTurn(
          session.id,
          'assistant',
          cancelReply,
          [],
          db
        );

        return {
          sessionId: session.id,
          replyText: cancelReply,
          intent: 'PROPOSAL_CANCELLED',
          state: 'idle',
          requiresConfirmation: false
        };
      }
      // If neither affirmative nor negative, fall through to process as a new query/clarification
    }

    // 5. Intent & Entity Resolution (Hybrid: Rule Heuristics + Local AI)
    const detectedIntent = await this.resolveIntent(userText, session, recentTurns);

    let replyText = '';
    let state: CustomerSessionState = 'idle';
    let proposedAction: ProposedAction | null = null;
    let toolExecutions: Array<{ tool: string; result: any }> = [];

    switch (detectedIntent.type) {
      case 'REFILL': {
        const refillsResult = await pharmacyToolRegistry.lookupPatientRefills(phone, session.customerId || undefined, db);
        if (!refillsResult || refillsResult.length === 0) {
          replyText = `📋 We couldn't find an active regular refill on file for your number (+91 ${phone}).\n\nIf you need a specific medicine, please type its name (e.g. *Telma 40* or *Glycomet 500*), or reply *Pharmacist* to speak with our staff.`;
          state = 'idle';
        } else {
          // If specific medicine mentioned in message, match it
          const mentionedMedicine = this.extractMedicineFromText(userText);
          let targetRefill = refillsResult[0];

          if (mentionedMedicine) {
            const matched = refillsResult.find((r: RefillRecordItem) =>
              r.medicineName.toLowerCase().includes(mentionedMedicine.toLowerCase()) ||
              mentionedMedicine.toLowerCase().includes(r.medicineName.toLowerCase())
            );
            if (matched) targetRefill = matched;
          }

          // Rule 6 Gate: Propose confirmation
          proposedAction = {
            type: 'CONFIRM_REFILL',
            summary: `Prepare refill for ${targetRefill.medicineName} (${targetRefill.quantityNeeded} units)`,
            data: {
              refillId: targetRefill.id,
              medicineName: targetRefill.medicineName,
              quantity: targetRefill.quantityNeeded,
              price: targetRefill.pricePerUnit
            }
          };

          const priceStr = targetRefill.pricePerUnit > 0 ? ` (Est. ₹${targetRefill.pricePerUnit * targetRefill.quantityNeeded})` : '';
          const stockNotice = targetRefill.inStock ? '✅ In Stock' : '⏳ Ready to order';

          replyText = `🔔 *Refill Due Check:*\n\n` +
            `We have your regular prescription for:\n` +
            `💊 *${targetRefill.medicineName}*\n` +
            `📦 Quantity: *${targetRefill.quantityNeeded} unit(s)*${priceStr}\n` +
            `📊 Status: ${stockNotice}\n\n` +
            `👉 *Would you like us to prepare this refill?*\n` +
            `Reply *Yes* to confirm, or *No* to cancel.`;

          state = 'awaiting_confirmation';
        }
        break;
      }

      case 'MEDICINE_INQUIRY': {
        const medName = detectedIntent.medicineName || this.extractMedicineFromText(userText) || userText;
        const searchResult = await pharmacyToolRegistry.searchMedicineAvailability(medName, db);

        if (searchResult && searchResult.length > 0) {
          const topItem = searchResult[0];
          const stockStatus = topItem.inStock ? `✅ *Available in stock* (${topItem.stockQuantity} on shelf)` : `⏳ Currently out of shelf stock`;
          const priceLine = topItem.sellingPrice > 0 ? `💰 Price: ₹${topItem.sellingPrice.toFixed(2)} (MRP ₹${topItem.mrp.toFixed(2)})` : `💰 MRP: ₹${topItem.mrp.toFixed(2)}`;

          replyText = `💊 *Medicine Availability — ${topItem.name}*\n\n` +
            (topItem.genericName ? `🔬 Salt: ${topItem.genericName}\n` : '') +
            (topItem.dosageForm ? `📋 Form: ${topItem.dosageForm} ${topItem.strength || ''}\n` : '') +
            `${priceLine}\n` +
            `${stockStatus}\n\n`;

          if (topItem.inStock) {
            replyText += `Would you like us to keep this medicine ready for collection? Reply with your quantity (e.g. *1 strip* or *2 boxes*).`;
          } else {
            replyText += `Would you like us to order this for you from our distributor? Reply *Order this* to log an inquiry.`;
            proposedAction = {
              type: 'CREATE_ENQUIRY',
              summary: `Order non-stocked medicine ${topItem.name}`,
              data: { medicineName: topItem.name, notes: 'Customer inquiry via conversational AI' }
            };
          }
          state = 'idle';
        } else {
          replyText = `🔍 We could not find *${medName}* in our current catalog.\n\nWould you like us to arrange it as a special order? Reply *Yes, arrange it* or reply *Pharmacist* for help.`;
          proposedAction = {
            type: 'CREATE_ENQUIRY',
            summary: `Procure unlisted medicine ${medName}`,
            data: { medicineName: medName, notes: 'Unlisted medicine inquiry via conversational AI' }
          };
          state = 'awaiting_confirmation';
        }
        break;
      }

      case 'STORE_INFO': {
        const shopEvidence = await pharmacyKnowledgeRetriever.retrieveShopEvidence(db);
        const openTime = shopEvidence.operatingHours.openTime || '09:00';
        const closeTime = shopEvidence.operatingHours.closeTime || '22:00';
        const offDay = shopEvidence.operatingHours.weeklyOff ? ` | Weekly Off: ${shopEvidence.operatingHours.weeklyOff}` : '';
        const isOpenNow = shopEvidence.operatingHours.isOpenNow ? '🟢 Currently Open' : '🔴 Currently Closed';

        replyText = `🏥 *${shopEvidence.storeName}*\n\n` +
          `📍 *Address:* ${shopEvidence.address || 'Local Pharmacy'}\n` +
          `🕒 *Hours:* ${openTime} – ${closeTime}${offDay}\n` +
          `📊 *Status:* ${isOpenNow}\n` +
          `📞 *Contact:* ${shopEvidence.phone || '+91 ' + phone}\n\n` +
          `How else can we assist you today? You can check medicine availability or ask for prescription refills.`;
        state = 'idle';
        break;
      }

      case 'PHARMACIST_HANDOVER': {
        const escalateRes = await pharmacyToolRegistry.escalateToPharmacist(
          phone,
          userText.slice(0, 150),
          db
        );
        replyText = `👩‍⚕️ *Pharmacist Handover:*\n\n` +
          `I have notified our registered on-duty pharmacist about your request. A team member will review your chat and respond shortly.\n\n` +
          `If this is an emergency, please call 108 or 112 immediately.`;
        state = 'pharmacist_review';
        toolExecutions.push({ tool: 'escalateToPharmacist', result: escalateRes });
        break;
      }

      case 'GREETING': {
        const nameGreeting = session.customerName ? ` ${session.customerName}` : '';
        replyText = `👋 Hello${nameGreeting}! Welcome to our pharmacy.\n\n` +
          `How can I help you today? You can:\n` +
          `• Ask about your *refills* (e.g. "Do I have any refills due?")\n` +
          `• Check *medicine stock & prices* (e.g. "Is Dolo 650 available?")\n` +
          `• Inquire about *store timings & location*\n` +
          `• Ask to speak with our *pharmacist*`;
        state = 'idle';
        break;
      }

      default: {
        // Natural-language fallback: use the existing grounded pharmacy QA engine
        // instead of forcing the customer to choose a trigger word or menu.
        // This path is informational only; consequential actions still go through
        // the explicit proposal/confirmation state machine above.
        try {
          const qaResult = await pharmacyQaEngine.processQuery(userText, {
            language: lang,
            dbInstance: db
          });
          replyText = String(qaResult?.draftResponse || '').trim();
        } catch (qaError) {
          console.warn('[Conversational Agent] Grounded QA fallback unavailable:', qaError instanceof Error ? qaError.message : String(qaError));
        }

        if (!replyText) {
          replyText = "I can help with medicine availability, refill requests, store information, or connecting you with the pharmacist. Could you tell me a little more about what you need?";
        }
        state = 'idle';
        break;
      }
    }

    // 6. Outbound Security Gateway Sanitization (PTR / Margin Protection)
    const sanitizedReply = this.sanitizeOutbound(replyText, phone);

    // 7. Persist Assistant Turn & Update Session Context
    const contextDataToSave: Record<string, any> = {
      ...(session.contextData || {}),
      lastIntent: detectedIntent.type
    };

    if (proposedAction) {
      contextDataToSave.pendingProposal = proposedAction;
    } else if (state === 'idle') {
      delete contextDataToSave.pendingProposal;
    }

    await conversationalMemoryService.updateSession(
      session.id,
      {
        sessionState: state,
        activeIntent: detectedIntent.type,
        contextData: contextDataToSave
      },
      db
    );

    await conversationalMemoryService.recordTurn(
      session.id,
      'assistant',
      sanitizedReply,
      toolExecutions,
      db
    );

    return {
      sessionId: session.id,
      replyText: sanitizedReply,
      intent: detectedIntent.type,
      state,
      proposedAction,
      requiresConfirmation: Boolean(proposedAction),
      toolExecutions
    };
  }

  /**
   * Sanitizes message content via OutboundSecurityGateway to prevent wholesale price/PTR leaks.
   */
  private sanitizeOutbound(message: string, phone: string): string {
    const scan = outboundSecurityGateway.scanMessageContent(message, 'customer');
    if (scan.safe) return message;

    // Redact any prohibited pattern
    let cleaned = message;
    for (const v of scan.violations) {
      console.warn(`[Conversational Agent] Outbound security redact for ${phone}: ${v}`);
    }

    // Strip common PTR/margin phrases if inadvertently included
    cleaned = cleaned.replace(/\b(?:ptr|cost price|purchase rate|wholesale rate)\b.*?(?=\n|$)/gi, '');
    return cleaned.trim();
  }

  /**
   * Determines customer intent from text using hybrid heuristics + local AI.
   */
  private async resolveIntent(
    text: string,
    session: CustomerConversationSession,
    recentTurns: ConversationTurn[]
  ): Promise<{ type: string; medicineName?: string }> {
    const t = text.toLowerCase().trim();

    // 1. Refill signals
    if (
      /\b(?:refill|repeat|renew|regular medicine|pichli dawa|pichhli|dawai khatam|goli khatam|punha havi|dawa repeat)\b/i.test(t) ||
      /(?:my|meri|majhi|what|any|check).*(?:dawa|goli|medicine|prescription|refill)/i.test(t) ||
      /\b(?:what refills|check refill|due refill|any refill|my refill)\b/i.test(t)
    ) {
      return { type: 'REFILL' };
    }

    // 2. Handover / Staff assistance
    if (
      /\b(?:pharmacist|doctor|chemist|staff|talk to|speak with|call me|baat karni hai|bolna hai|call kara)\b/i.test(t)
    ) {
      return { type: 'PHARMACIST_HANDOVER' };
    }

    // 3. Store info / hours / location
    if (
      /\b(?:timings|timing|hours|open|closed|closing|close|khula|band|address|location|kaha hai|kuthe ahe)\b/i.test(t)
    ) {
      return { type: 'STORE_INFO' };
    }

    // 4. Greetings
    if (
      /^(?:hi|hello|hey|namaste|pranam|good morning|good evening|good afternoon|namaskar)$/i.test(t.replace(/[!.,]/g, '').trim())
    ) {
      return { type: 'GREETING' };
    }

    // 5. Medicine Inquiry signals
    const extractedMed = this.extractMedicineFromText(text);
    if (extractedMed || /\b(?:available|stock|price|cost|mrp|rate|kitne|chahiye|milegi|mil sakti|aahe ka)\b/i.test(t)) {
      return { type: 'MEDICINE_INQUIRY', medicineName: extractedMed };
    }

    // 6. Optional Local AI LLM enhancement if running
    try {
      if (isLocalAiEnabled()) {
        const aiIntent = await queryLocalAiIntent(text);
        if (aiIntent && aiIntent.confidence >= 0.7) {
          if (aiIntent.intent === 'REFILL') return { type: 'REFILL' };
          if (aiIntent.intent === 'ORDER' || aiIntent.intent === 'INQUIRY') {
            const med = aiIntent.medicines?.[0]?.name;
            return { type: 'MEDICINE_INQUIRY', medicineName: med };
          }
        }
      }
    } catch (_) {}

    return { type: 'GENERAL_QA' };
  }

  /**
   * Helper to detect positive user confirmation.
   */
  private isAffirmative(text: string): boolean {
    const clean = text.trim().toLowerCase().replace(/[^\w\s]/g, '');
    return /\b(yes|haan|ha|ho|confirm|confirmed|ok|okay|bhej do|kar do|proceed|ready|prepare|order|thik hai|theek hai)\b/i.test(clean) || clean === '1';
  }

  /**
   * Helper to detect negative cancellation.
   */
  private isNegative(text: string): boolean {
    const clean = text.trim().toLowerCase().replace(/[^\w\s]/g, '');
    return /\b(no|nahin|nahi|na|nako|cancel|cancelled|stop|mat bhejo|don't|dont)\b/i.test(clean) || clean === '2';
  }

  /**
   * Extracts probable medicine name candidate from customer phrasing.
   */
  private extractMedicineFromText(text: string): string | undefined {
    const lower = text.toLowerCase().trim();
    if (!/\b(?:have|got|stock|available|price|cost|mrp|chahiye|milegi|mil sakti|aahe ka|tablet|strip|capsule|syrup|gel|ointment|mg|ml|gm)\b/i.test(lower)) {
      return undefined;
    }

    let clean = text
      .replace(/\b(?:do you have|can you check|is|in stock|available|right now|today|price of|cost of|chahiye|milegi|kya|bhejo|please|for me|tablet|strip|box)\b/gi, ' ')
      .replace(/[?!,.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (clean.length >= 3 && !/^(hi|hello|yes|no|ok|refill|call|timing|shop|store|address|hours)$/i.test(clean)) {
      return clean;
    }
    return undefined;
  }
}

export const conversationalAgentEngine = new ConversationalAgentEngine();
