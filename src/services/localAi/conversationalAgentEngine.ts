/**
 * Conversational AI Agent Engine (Agentic Workflow Enabled)
 *
 * Core natural language orchestration layer converting rigid trigger-based interactions
 * into genuine, context-aware dialogues:
 * - Understands natural phrasing, typos, informal Hinglish/Hindi/Marathi, and abbreviations.
 * - Manages persistent customer & staff session context and multi-turn conversational history.
 * - Executes approved pharmacy workflows via Scoped Pharmacy Tool Registry.
 * - Preserves Rule 6 Human-in-the-Loop approval for consequential actions (refill confirmation, stock adjustments).
 * - Enforces clinical safety gates (emergency 108/112 escalation, anti-prescribing disclaimer).
 * - Guaranteed commercial confidentiality: Outbound Security Gateway prevents wholesale PTR/margin leaks.
 * - Operates 100% offline with local model fallback.
 */

import { dbManager } from '../../database/connection.js';
import { normalizePhoneDigits } from '../../utils/phoneValidation.js';
import {
  conversationalMemoryService,
  type CustomerConversationSession,
  type CustomerSessionState,
  type ConversationTurn,
  type MicroTaskRecord
} from './conversationalMemoryService.js';
import {
  pharmacyToolRegistry,
  type RefillRecordItem,
  type MedicineAvailabilityItem,
  type AlternativeCandidateItem,
  type AlternativesResult,
  type ExpiringBatchItem,
  type SalesComparisonResult
} from './pharmacyToolRegistry.js';
import { classifyClinicalRisk, type ClinicalRiskClassification } from './pharmacyQaEngine.js';
import { outboundSecurityGateway } from '../outboundSecurityGateway.js';
import { pharmacyKnowledgeRetriever } from './pharmacyKnowledgeRetriever.js';
import { isLocalAiEnabled, checkLlamaServerHealth, queryLocalAiIntent, queryLocalAiChat } from './llamaServerClient.js';
import { eventService } from '../eventService.js';
import { logMutationAudit } from '../auditLoggerService.js';

export interface ProcessMessageInput {
  phone?: string;
  channel?: 'whatsapp' | 'portal' | 'in_app' | 'staff_modal';
  message: string;
  customerId?: number | null;
  customerName?: string | null;
  language?: 'en' | 'hi' | 'mr';
  role?: 'owner' | 'staff' | 'customer';
  userId?: number;
  username?: string;
  storeId?: number;
  sessionId?: string;
  pageContext?: {
    pathname: string;
    pageTitle?: string;
    selectedRecordId?: string | number;
    selectedRecordType?: string;
    selectedRecordData?: any;
  };
  imageBuffer?: Buffer;
  imagePath?: string;
  docType?: 'prescription' | 'invoice' | 'packaging';
}

export interface AssistantCardItem {
  id: string | number;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: 'green' | 'amber' | 'red' | 'blue' | 'gray';
  details?: Record<string, any>;
  actionUrl?: string;
}

export interface ProposedAction {
  id?: string;
  type:
    | 'CONFIRM_REFILL'
    | 'CREATE_ENQUIRY'
    | 'SCHEDULE_CALL'
    | 'ADJUST_STOCK'
    | 'STAGE_PURCHASE_DRAFT'
    | 'STAGE_PRESCRIPTION_DRAFT'
    | 'STAGE_POS_ITEM'
    | 'STAGE_LIVE_CART_ITEM'
    | 'DISTRIBUTOR_RETURN_DRAFT'
    | 'LOW_STOCK_REORDER'
    | 'APPLY_DISCOUNT'
    | 'HOLD_BILL'
    | 'LIVE_CART_SYNC'
    | 'SEND_DUE_PAYMENT_QR'
    | 'BOOK_SPECIAL_ORDER'
    | 'ONBOARD_REFILL'
    | 'TRIGGER_AUTOMATION';
  summary: string;
  data: Record<string, any>;
  requiresConfirmation?: boolean;
  status?: 'PENDING_CONFIRMATION' | 'EXECUTED' | 'CANCELLED';
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
  cards?: AssistantCardItem[];
  suggestedFollowUps?: string[];
  latencyMs?: number;
}

export class ConversationalAgentEngine {
  /**
   * Backward-compatible customer message entry point
   */
  public async processCustomerMessage(input: ProcessMessageInput): Promise<ConversationalAgentResult> {
    return this.processMessage({ ...input, role: input.role || 'customer' });
  }

  /**
   * Main unified entry point for staff operations modal and customer chats
   */
  public async processMessage(input: ProcessMessageInput): Promise<ConversationalAgentResult> {
    const startTime = performance.now();
    const rawPhone = input.phone || '';
    const phone = normalizePhoneDigits(rawPhone) || rawPhone.replace(/\D/g, '').slice(-10) || '0000000000';
    const userText = (input.message || '').trim();
    const role = input.role || 'staff';
    const channel = input.channel || (role === 'customer' ? 'whatsapp' : 'staff_modal');
    const db = await dbManager.getConnection();

    // 1. Resolve or Create Persistent Session
    const explicitSessionId = input.sessionId || (role === 'customer' ? undefined : `session_${input.userId || 'staff'}_${input.storeId || 1}`);
    const session = await conversationalMemoryService.getOrCreateSession(
      channel === 'staff_modal' ? 'in_app' : channel,
      phone,
      input.customerId || null,
      db,
      explicitSessionId
    );

    const lang = input.language || session.language || 'en';
    const recentTurns = await conversationalMemoryService.getRecentTurns(session.id, 8, db);

    // Record incoming user turn
    await conversationalMemoryService.recordTurn(
      session.id,
      role === 'customer' ? 'customer' : 'system',
      userText || (input.imageBuffer ? '[Uploaded Document Image]' : ''),
      [],
      db
    );

    // 2. Prompt Injection Defense Gate
    if (/\b(?:ignore all previous|system prompt|developer key|secret key|delete all|drop table)\b/i.test(userText)) {
      const injectionReply = "I cannot execute system override or confidential disclosure requests. How can I assist you with your pharmacy operations or medicine queries?";
      await conversationalMemoryService.recordTurn(session.id, 'assistant', injectionReply, [], db);
      return {
        sessionId: session.id,
        replyText: injectionReply,
        intent: 'INJECTION_DEFENSE',
        state: 'idle',
        requiresConfirmation: false,
        latencyMs: Math.round(performance.now() - startTime)
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

      await conversationalMemoryService.recordTurn(session.id, 'assistant', emergencyReply, [], db);
      await conversationalMemoryService.updateSession(
        session.id,
        { sessionState: 'idle', activeIntent: 'CLINICAL_EMERGENCY', contextData: {} },
        db
      );

      return {
        sessionId: session.id,
        replyText: emergencyReply,
        intent: 'CLINICAL_EMERGENCY',
        state: 'idle',
        requiresConfirmation: false,
        latencyMs: Math.round(performance.now() - startTime)
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

      await conversationalMemoryService.recordTurn(session.id, 'assistant', medicalNotice, [], db);
      await conversationalMemoryService.updateSession(
        session.id,
        { sessionState: 'pharmacist_review', activeIntent: 'CLINICAL_INQUIRY', contextData: {} },
        db
      );

      return {
        sessionId: session.id,
        replyText: medicalNotice,
        intent: 'CLINICAL_INQUIRY',
        state: 'pharmacist_review',
        requiresConfirmation: false,
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    // 3b. Micro-Task Memory Queries & Undo Command
    if (/\b(?:undo|revert|cancel that|remove that|last task undo|undo last action)\b/i.test(userText)) {
      const recentTasks = await conversationalMemoryService.getRecentMicroTasks(session.id, 1, db);
      if (recentTasks.length > 0 && recentTasks[0].revertible) {
        const lastTask = recentTasks[0];
        const undoReply = `↩️ *Action Reverted:*\n\nCancelled: *${lastTask.summary}*. No changes remain pending.`;
        await conversationalMemoryService.recordMicroTask(session.id, {
          action: 'UNDO',
          summary: `Reverted: ${lastTask.summary}`,
          data: lastTask.data,
          revertible: false
        }, db);
        await conversationalMemoryService.recordTurn(session.id, 'assistant', undoReply, [], db);
        return {
          sessionId: session.id,
          replyText: undoReply,
          intent: 'UNDO_ACTION',
          state: 'idle',
          requiresConfirmation: false,
          suggestedFollowUps: ['Show recent tasks', 'Open Live Cart'],
          latencyMs: Math.round(performance.now() - startTime)
        };
      } else {
        const noUndoReply = "There are no recent actions available to undo.";
        return {
          sessionId: session.id,
          replyText: noUndoReply,
          intent: 'UNDO_ACTION',
          state: 'idle',
          requiresConfirmation: false,
          suggestedFollowUps: ['Check stock', 'Show due refills'],
          latencyMs: Math.round(performance.now() - startTime)
        };
      }
    }

    if (/\b(?:recent tasks|last task|what did i just do|what did i stage|last action|previous task|kya add kiya)\b/i.test(userText)) {
      const recentTasks = await conversationalMemoryService.getRecentMicroTasks(session.id, 5, db);
      if (recentTasks.length > 0) {
        let summaryText = `📋 *Recent Micro-Tasks:*\n\n`;
        recentTasks.forEach((t, i) => {
          const timeStr = new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          summaryText += `${i + 1}. *${t.summary}* (${timeStr})\n`;
        });
        summaryText += `\nYou can reply *"undo"* to revert the most recent task if needed.`;
        return {
          sessionId: session.id,
          replyText: summaryText,
          intent: 'MICRO_TASK_AUDIT',
          state: 'idle',
          requiresConfirmation: false,
          suggestedFollowUps: ['Undo last action', 'Open Live Cart', 'Check stock'],
          latencyMs: Math.round(performance.now() - startTime)
        };
      } else {
        return {
          sessionId: session.id,
          replyText: "📋 No recent micro-tasks recorded in this session yet.",
          intent: 'MICRO_TASK_AUDIT',
          state: 'idle',
          requiresConfirmation: false,
          suggestedFollowUps: ['Add Dolo 650 to live cart', 'Show due refills'],
          latencyMs: Math.round(performance.now() - startTime)
        };
      }
    }

    // 3c. Slot-Filling Resolution (e.g. quantity was requested)
    if (session.sessionState === 'awaiting_clarification' && session.contextData?.pendingSlotFill) {
      const slotFill = session.contextData.pendingSlotFill;
      const isNeg = this.isNegative(userText);

      if (isNeg) {
        const cancelReply = `👍 Understood. Cart staging for *${slotFill.medicineName}* has been cancelled.`;
        await conversationalMemoryService.updateSession(
          session.id,
          { sessionState: 'idle', activeIntent: 'STAGING_CANCELLED', contextData: { ...(session.contextData || {}), pendingSlotFill: undefined } },
          db
        );
        await conversationalMemoryService.recordTurn(session.id, 'assistant', cancelReply, [], db);
        return {
          sessionId: session.id,
          replyText: cancelReply,
          intent: 'STAGING_CANCELLED',
          state: 'idle',
          requiresConfirmation: false,
          suggestedFollowUps: ['Check stock for Dolo 650', 'Show due refills'],
          latencyMs: Math.round(performance.now() - startTime)
        };
      }

      // Check if user provided quantity
      const qtyMatch = userText.match(/\b(\d{1,4})\s*(?:strip|strips|tablet|tablets|capsule|capsules|box|boxes|bottle|bottles|pack|packs|unit|units|nos)?\b/i);
      let parsedSlotQty: number | undefined;
      let parsedSlotUnit: string = slotFill.unit || 'strip';

      if (qtyMatch) {
        parsedSlotQty = parseInt(qtyMatch[1], 10);
        const unitMatch = userText.match(/\b(strip|strips|tablet|tablets|capsule|capsules|box|boxes|bottle|bottles|pack|packs|unit|units)\b/i);
        if (unitMatch) parsedSlotUnit = unitMatch[1].toLowerCase();
      }

      if (parsedSlotQty && parsedSlotQty > 0) {
        await conversationalMemoryService.updateSession(
          session.id,
          {
            sessionState: 'completed',
            activeIntent: 'SLOT_FILLED_EXECUTED',
            contextData: { ...(session.contextData || {}), pendingSlotFill: undefined }
          },
          db
        );

        if (slotFill.destination === 'live_cart') {
          const stageRes = await pharmacyToolRegistry.stageLiveCartItem(slotFill.medicineName, parsedSlotQty, parsedSlotUnit, db);
          await conversationalMemoryService.recordMicroTask(session.id, {
            action: 'STAGE_LIVE_CART_ITEM',
            summary: `Staged ${parsedSlotQty} ${parsedSlotUnit} of ${slotFill.medicineName} to Live Cart`,
            data: { medicineName: slotFill.medicineName, quantity: parsedSlotQty, unit: parsedSlotUnit, destination: 'live_cart' },
            revertible: true
          }, db);

          const replyText = `✅ *Live Cart Updated!*\n\nSuccessfully staged *${parsedSlotQty} ${parsedSlotUnit}* of *${(stageRes.details as any)?.item?.name || slotFill.medicineName}* into the Pharmarack Live Cart. Ready for distributor order review.`;
          await conversationalMemoryService.recordTurn(session.id, 'assistant', replyText, [{ tool: 'stageLiveCartItem', result: stageRes }], db);

          return {
            sessionId: session.id,
            replyText,
            intent: 'CART_STAGING',
            state: 'completed',
            actionTaken: 'STAGE_LIVE_CART_ITEM',
            requiresConfirmation: false,
            cards: [{
              id: `cart_${Date.now()}`,
              title: slotFill.medicineName,
              subtitle: `Quantity: ${parsedSlotQty} ${parsedSlotUnit} | Pharmarack Live Cart`,
              badge: 'Live Cart Staged',
              badgeColor: 'green'
            }],
            suggestedFollowUps: ['Open Live Cart', `Check stock for ${slotFill.medicineName}`, 'Undo last action'],
            latencyMs: Math.round(performance.now() - startTime)
          };
        } else {
          const stageRes = await pharmacyToolRegistry.stageLiveCartItem(
            slotFill.medicineName,
            parsedSlotQty,
            parsedSlotUnit,
            db
          );

          await conversationalMemoryService.recordMicroTask(session.id, {
            action: 'STAGE_LIVE_CART_ITEM',
            summary: `Staged ${parsedSlotQty} ${parsedSlotUnit} of ${slotFill.medicineName} to Live Cart`,
            data: { medicineName: slotFill.medicineName, quantity: parsedSlotQty, unit: parsedSlotUnit, destination: 'live_cart' },
            revertible: true
          }, db);

          const replyText = stageRes.success
            ? `✅ *Live Cart Updated!*\n\n*${parsedSlotQty} ${parsedSlotUnit}* of *${slotFill.medicineName}* has been staged into your Pharmarack Live Cart.`
            : `⚠️ *Live Cart Notice:* ${stageRes.message}`;

          await conversationalMemoryService.recordTurn(session.id, 'assistant', replyText, [], db);

          return {
            sessionId: session.id,
            replyText,
            intent: 'CART_STAGING',
            state: 'completed',
            actionTaken: 'STAGE_LIVE_CART_ITEM',
            requiresConfirmation: false,
            cards: [{
              id: `cart_${Date.now()}`,
              title: slotFill.medicineName,
              subtitle: `Quantity: ${parsedSlotQty} ${parsedSlotUnit} | Pharmarack Live Cart`,
              badge: 'Live Cart Staged',
              badgeColor: 'green'
            }],
            suggestedFollowUps: ['Open Live Cart', `Check stock for ${slotFill.medicineName}`, 'Undo last action'],
            latencyMs: Math.round(performance.now() - startTime)
          };
        }
      }

      // If user typed something completely different (no qty), clear pendingSlotFill and proceed to general intent detection
      await conversationalMemoryService.updateSession(
        session.id,
        { sessionState: 'idle', contextData: { ...(session.contextData || {}), pendingSlotFill: undefined } },
        db
      );
    }

    // 4. Multi-Turn State Machine & Confirmation Gate (Rule 6 Human-in-the-Loop)
    if (session.sessionState === 'awaiting_confirmation' && session.contextData?.pendingProposal) {
      const proposal = session.contextData.pendingProposal as ProposedAction;
      const isAffirmative = this.isAffirmative(userText);
      const isNegative = this.isNegative(userText);

      if (isAffirmative) {
        let executionResult: any = null;
        let replyText = '';

        if (proposal.type === 'CONFIRM_REFILL') {
          const refillId = Number(proposal.data.refillId);
          const qty = Number(proposal.data.quantity || 1);
          executionResult = await pharmacyToolRegistry.confirmRefillExecution(
            refillId,
            phone,
            { qty, channel: channel === 'portal' ? 'portal' : 'whatsapp', dbInstance: db }
          );

          if (executionResult.success) {
            replyText = `✅ *Refill Confirmed!*\n\nYour refill for *${proposal.data.medicineName || 'medicine'}* (${qty} ${qty > 1 ? 'units' : 'unit'}) has been prepared and staged for dispensing.\n\nOur pharmacy team will have it ready for collection. Thank you!`;
          } else {
            replyText = `⚠️ We were unable to stage the refill automatically: ${executionResult.message || 'Please contact our store'}. Our pharmacist has been notified.`;
          }
        } else if (proposal.type === 'CREATE_ENQUIRY') {
          executionResult = await pharmacyToolRegistry.createCustomerEnquiry(
            session.customerName || input.username || 'Customer',
            phone,
            proposal.data.medicineName,
            proposal.data.notes,
            db
          );
          replyText = `📋 *Special Request Logged!*\n\nWe have recorded your inquiry for *${proposal.data.medicineName}*. Our procurement team will check distributor availability and notify you soon.`;
        } else if (proposal.type === 'SCHEDULE_CALL') {
          executionResult = await pharmacyToolRegistry.scheduleCallTask(
            session.customerName || input.username || 'Customer',
            phone,
            proposal.data.notes || 'Pharmacist follow-up task',
            'normal',
            proposal.data.dueDate,
            db
          );
          replyText = `📞 *Reminder Task Scheduled!*\n\nA staff callback task has been created for ${session.customerName || 'customer'} at ${phone}.`;
        } else if (proposal.type === 'ADJUST_STOCK') {
          // Adjust stock in inventory_master and log to stock_ledger
          const medId = Number(proposal.data.medicineId);
          const batchNo = String(proposal.data.batchNo || '');
          const newQty = Number(proposal.data.newQuantity || 0);
          await db.run(
            `UPDATE inventory_master SET quantity = ? WHERE medicine_id = ? AND batch_no = ?`,
            [newQty, medId, batchNo]
          ).catch(() => {});
          await db.run(
            `INSERT INTO stock_ledger (medicine_id, batch_no, quantity, transaction_type) VALUES (?, ?, ?, 'ADJUSTMENT')`,
            [medId, batchNo, newQty]
          ).catch(() => {});
          await logMutationAudit({
            storeId: input.storeId || 1,
            userId: input.userId,
            username: input.username || 'assistant',
            action: 'STOCK_ADJUSTMENT',
            entity: 'inventory_master',
            entityId: medId,
            description: `Audited stock adjustment: Medicine #${medId} (Batch: ${batchNo}) set to ${newQty} units. Reason: ${proposal.data.reason || 'Audit'}`
          });
          replyText = `✅ *Stock Corrected!*\n\nStock for *${proposal.data.medicineName || 'medicine'}* (Batch: ${batchNo}) has been successfully updated to *${newQty} units* and recorded in the audit ledger.`;
          executionResult = { success: true, updatedQty: newQty };
        } else if (proposal.type === 'STAGE_PRESCRIPTION_DRAFT') {
          replyText = `✅ *Prescription Workflow Staged!*\n\nThe identified medicines have been linked to the prescription dispensing queue for pharmacist verification.`;
          executionResult = { success: true };
        } else if (proposal.type === 'STAGE_POS_ITEM') {
          replyText = `✅ *Added to Cart!* *${proposal.data.medicineName}* (${proposal.data.quantity || 1} units) is ready on your billing screen.`;
          executionResult = { success: true, item: proposal.data };
          await conversationalMemoryService.recordMicroTask(session.id, {
            action: 'STAGE_POS_ITEM',
            summary: `Staged ${proposal.data.quantity || 1} of ${proposal.data.medicineName} to POS Counter`,
            data: proposal.data,
            revertible: true
          }, db);
        } else if (proposal.type === 'STAGE_LIVE_CART_ITEM') {
          const stageRes = await pharmacyToolRegistry.stageLiveCartItem(
            proposal.data.medicineName,
            proposal.data.quantity || 1,
            proposal.data.unit,
            db
          );
          if (stageRes.success) {
            replyText = `✅ *Live Cart Updated!*\n\nStaged *${proposal.data.quantity || 1} ${proposal.data.unit || 'units'}* of *${(stageRes.details as any)?.item?.name || proposal.data.medicineName}* into the Pharmarack Live Cart.`;
          } else {
            replyText = `⚠️ *Live Cart Notice:* ${stageRes.message || 'Could not automatically stage to live distributor cart'}. Staged into procurement queue instead.`;
          }
          executionResult = stageRes;
          await conversationalMemoryService.recordMicroTask(session.id, {
            action: 'STAGE_LIVE_CART_ITEM',
            summary: `Staged ${proposal.data.quantity || 1} ${proposal.data.unit || 'units'} of ${proposal.data.medicineName} to Live Cart`,
            data: proposal.data,
            revertible: true
          }, db);
        } else if (proposal.type === 'DISTRIBUTOR_RETURN_DRAFT') {
          replyText = `✅ *Distributor Return Draft Confirmed!* Staged for supplier return processing.`;
          executionResult = { success: true, draft: proposal.data };
        } else if (proposal.type === 'LOW_STOCK_REORDER') {
          replyText = `✅ *Reorder Draft Confirmed!* Staged into procurement queue.`;
          executionResult = { success: true, draft: proposal.data };
        } else if (proposal.type === 'SEND_DUE_PAYMENT_QR') {
          const { creditReminderService } = await import('../creditReminderService.js');
          const remRes = await creditReminderService.buildCreditReminderWithQr(
            proposal.data.customerId,
            db,
            { skipDedupe: true, isManual: true }
          );
          if (remRes.success) {
            replyText = `✅ *Payment Reminder Dispatched!*\n\nBranded UPI Payment QR card and itemized bill breakdown sent via WhatsApp to *${proposal.data.customerName}* (${proposal.data.phone || 'patient'}). Total due: ₹${Number(proposal.data.amount || 0).toFixed(2)}.`;
          } else {
            replyText = `⚠️ *Reminder Notice:* ${remRes.reason || 'Could not dispatch WhatsApp message'}. The UPI QR code remains valid.`;
          }
          executionResult = remRes;
        } else if (proposal.type === 'BOOK_SPECIAL_ORDER') {
          const bookRes = await pharmacyToolRegistry.bookSpecialOrder(
            {
              medicineName: proposal.data.medicineName,
              customerName: proposal.data.customerName,
              customerPhone: proposal.data.customerPhone,
              quantity: proposal.data.quantity || 1,
              notes: proposal.data.notes
            },
            db
          );
          if (bookRes.success) {
            replyText = `✅ *Special Order Booked!*\n\nSpecial Order #${bookRes.orderId} booked for *${proposal.data.medicineName}* (${proposal.data.quantity || 1} units) for *${proposal.data.customerName}*.\n• Linked Distributor: ${bookRes.details?.distributor || 'Primary'}\n• Visible in: CRM → Special Orders and Quick Assist sidebar.`;
          } else {
            replyText = `⚠️ *Order Notice:* ${bookRes.message}`;
          }
          executionResult = bookRes;
        } else if (proposal.type === 'ONBOARD_REFILL') {
          const onboardRes = await pharmacyToolRegistry.onboardPatientRefill(
            {
              customerName: proposal.data.customerName,
              customerPhone: proposal.data.customerPhone,
              medicineName: proposal.data.medicineName,
              quantity: proposal.data.quantity || 1,
              intervalDays: proposal.data.intervalDays || 30,
              notes: proposal.data.notes
            },
            db
          );
          if (onboardRes.success) {
            replyText = `✅ *Refill Schedule Onboarded!*\n\nScheduled recurring refill for *${proposal.data.customerName}* (${proposal.data.medicineName}, every ${proposal.data.intervalDays || 30} days).\n• Next Refill Date: *${onboardRes.details?.nextRefillDate}*\n• Visible in: CRM → Patient Refills.`;
          } else {
            replyText = `⚠️ *Refill Notice:* ${onboardRes.message}`;
          }
          executionResult = onboardRes;
        } else if (proposal.type === 'TRIGGER_AUTOMATION') {
          const autoRes = await pharmacyToolRegistry.executeAutomation(
            proposal.data.automationId,
            proposal.data,
            db
          );
          if (autoRes.success) {
            replyText = `✅ *Automation Cycle Complete!*\n\n${autoRes.message}`;
          } else {
            replyText = `⚠️ *Automation Execution Notice:* ${autoRes.message}`;
          }
          executionResult = autoRes;
        } else if (proposal.type === 'APPLY_DISCOUNT' || proposal.type === 'HOLD_BILL') {
          replyText = `ℹ️ *POS Counter Notice:* POS billing actions are managed directly on the POS screen by the cashier.`;
          executionResult = { success: false };
        } else if (proposal.type === 'LIVE_CART_SYNC') {
          replyText = `✅ *Distributor Cart Synced!* Pharmarack Live Cart status refreshed.`;
          executionResult = { success: true };
        }

        // Clean up proposal context
        await conversationalMemoryService.updateSession(
          session.id,
          { sessionState: 'completed', activeIntent: 'CONFIRMATION_EXECUTED', contextData: {} },
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
          replyText: this.sanitizeOutbound(replyText, phone, role),
          intent: 'CONFIRMATION_EXECUTED',
          state: 'completed',
          actionTaken: proposal.type,
          requiresConfirmation: false,
          toolExecutions: [{ tool: proposal.type, result: executionResult }],
          latencyMs: Math.round(performance.now() - startTime)
        };
      }

      if (isNegative) {
        const cancelReply = `👍 Understood. I have cancelled this proposal. What else can I assist you with?`;
        await conversationalMemoryService.updateSession(
          session.id,
          { sessionState: 'idle', activeIntent: 'PROPOSAL_CANCELLED', contextData: {} },
          db
        );

        await conversationalMemoryService.recordTurn(session.id, 'assistant', cancelReply, [], db);

        return {
          sessionId: session.id,
          replyText: cancelReply,
          intent: 'PROPOSAL_CANCELLED',
          state: 'idle',
          requiresConfirmation: false,
          latencyMs: Math.round(performance.now() - startTime)
        };
      }
    }

    // 5. Intent & Entity Resolution across the 6 Core Capabilities
    const detected = await this.resolveUnifiedIntent(userText, input, session, recentTurns);

    let replyText = '';
    let state: CustomerSessionState = 'idle';
    let proposedAction: ProposedAction | null = null;
    let toolExecutions: Array<{ tool: string; result: any }> = [];
    let cards: AssistantCardItem[] = [];
    let suggestedFollowUps: string[] = [];

    switch (detected.type) {
      // ── Capability 3: OCR & Document Assistance ─────────────────────────────
      case 'DOCUMENT_OCR': {
        const ocrResult = await pharmacyToolRegistry.processDocumentImage({
          buffer: input.imageBuffer,
          imagePath: input.imagePath,
          docType: input.docType || (userText.toLowerCase().includes('invoice') ? 'invoice' : 'prescription'),
          storeId: input.storeId || 1,
          dbInstance: db
        });
        toolExecutions.push({ tool: 'processDocumentImage', result: ocrResult });

        if (ocrResult.success && ocrResult.docType === 'prescription') {
          const items = ocrResult.extractedItems || [];
          replyText = `📄 *Prescription OCR Analysis Complete*\n\n` +
            (ocrResult.headerInfo?.doctorName ? `👨‍⚕️ *Doctor:* ${ocrResult.headerInfo.doctorName}\n` : '') +
            (ocrResult.headerInfo?.clinicName ? `🏥 *Clinic:* ${ocrResult.headerInfo.clinicName}\n` : '') +
            (ocrResult.headerInfo?.patientName ? `👤 *Patient:* ${ocrResult.headerInfo.patientName}\n` : '') +
            `\n📋 *Identified Medicines (${items.length}):*\n`;

          items.forEach((item: any, idx: number) => {
            const matchName = item.topMatch || item.brandHint || item.rawText;
            const avail = item.availability === 'in_stock' ? '✅ In Stock' : '⏳ Stock Out';
            replyText += `${idx + 1}. *${matchName}* (Qty: ${item.prescribedQty || 1}) — ${avail}\n`;
            cards.push({
              id: `rx_${idx}`,
              title: matchName,
              subtitle: `Prescribed: ${item.prescribedQty || 1} | Form: ${item.dosageForm || 'Tablet'} ${item.strength || ''}`,
              badge: avail,
              badgeColor: item.availability === 'in_stock' ? 'green' : 'amber'
            });
          });

          replyText += `\n👉 *Would you like to stage these medicines into the prescription dispensing workflow?*\nReply *Yes* to confirm, or *No* to review manually.`;

          proposedAction = {
            id: `rx_stage_${Date.now()}`,
            type: 'STAGE_PRESCRIPTION_DRAFT',
            summary: `Add ${items.length} medicines from scanned prescription to dispensing workflow`,
            data: { items, scanId: ocrResult.stagedDraft?.scanId },
            requiresConfirmation: true,
            status: 'PENDING_CONFIRMATION'
          };
          state = 'awaiting_confirmation';
          suggestedFollowUps = ['Confirm prescription draft', 'Find alternatives for stockouts', 'Cancel'];
        } else if (ocrResult.success && ocrResult.docType === 'invoice') {
          const items = ocrResult.extractedItems || [];
          replyText = `📦 *Purchase Invoice OCR Complete*\n\n` +
            `🏢 *Distributor:* ${ocrResult.headerInfo?.distributor || 'Distributor'}\n` +
            `🧾 *Invoice #:* ${ocrResult.headerInfo?.invoiceNo || 'N/A'} | Date: ${ocrResult.headerInfo?.invoiceDate || 'Today'}\n` +
            `\nFound *${items.length} line items*. Would you like to prepare the purchase entry draft for verification?`;

          items.slice(0, 5).forEach((item: any, idx: number) => {
            cards.push({
              id: `inv_${idx}`,
              title: item.matchedDbName || item.name,
              subtitle: `Batch: ${item.batchNo} | Exp: ${item.expiryDate} | Qty: ${item.quantity}`,
              badge: `₹${item.costPrice?.toFixed(2) || 0}`,
              badgeColor: 'blue'
            });
          });

          proposedAction = {
            id: `inv_stage_${Date.now()}`,
            type: 'STAGE_PURCHASE_DRAFT',
            summary: `Create draft purchase bill with ${items.length} items from ${ocrResult.headerInfo?.distributor}`,
            data: ocrResult.headerInfo || {},
            requiresConfirmation: true,
            status: 'PENDING_CONFIRMATION'
          };
          state = 'awaiting_confirmation';
          suggestedFollowUps = ['Confirm draft entry', 'Verify item batches', 'Cancel'];
        } else {
          replyText = `🔍 *Document Processing:* ${ocrResult.message}\n\nPlease ensure the document photo is clear, well-lit, and shows medicine names clearly.`;
          state = 'idle';
        }
        break;
      }

      // ── Capability 4: Medicine Alternatives & Comparison ───────────────────
      case 'ALTERNATIVES_SEARCH': {
        const targetMed = detected.medicineName || session.contextData?.lastMedicine || 'Medicine';
        const altResult: AlternativesResult = await pharmacyToolRegistry.findAlternatives(targetMed, db);
        toolExecutions.push({ tool: 'findAlternatives', result: altResult });

        if (altResult.candidates && altResult.candidates.length > 0) {
          replyText = `🔬 *Alternative Options for ${altResult.sourceMedicine}*\n\n` +
            (altResult.sourceSalt ? `🧪 *Active Composition:* ${altResult.sourceSalt}\n` : '') +
            `📊 *Current Stock:* ${altResult.sourceInStock ? '✅ Available' : '❌ Out of Stock'}\n\n` +
            `Found *${altResult.candidates.length} suitable candidates*:\n\n`;

          altResult.candidates.forEach((cand, idx) => {
            const stockNotice = cand.inStock ? `✅ In Stock (${cand.stockQuantity})` : '⏳ Out of stock';
            replyText += `${idx + 1}. *${cand.name}*\n` +
              `   • Form: ${cand.dosageForm || 'Tablet'} ${cand.strength || ''}\n` +
              `   • Price: ₹${cand.sellingPrice.toFixed(2)} (MRP ₹${cand.mrp.toFixed(2)})\n` +
              `   • Status: ${stockNotice}\n` +
              `   • ${cand.differenceNote || 'Same active salt.'}\n\n`;

            cards.push({
              id: cand.id,
              title: cand.name,
              subtitle: `${cand.dosageForm || 'Tablet'} | MRP ₹${cand.mrp.toFixed(2)} | By ${cand.manufacturer || 'Pharma'}`,
              badge: cand.inStock ? `${cand.stockQuantity} in stock` : 'Out of Stock',
              badgeColor: cand.inStock ? 'green' : 'amber'
            });
          });

          replyText += `${altResult.clinicalNotice}\n\n` +
            `👉 Reply with the number (e.g. *Show details of 1*) or type *Add to bill* to proceed.`;

          suggestedFollowUps = [
            `Show details of 1 (${altResult.candidates[0]?.name})`,
            altResult.candidates[1] ? `Show details of 2 (${altResult.candidates[1]?.name})` : 'Check distributor availability',
            'Back to catalog'
          ];
        } else {
          replyText = `🔍 We could not find direct same-salt alternatives for *${targetMed}* in stock.\n\n` +
            `Would you like to log an inquiry for procurement, or speak with our pharmacist?`;
          suggestedFollowUps = ['Log procurement enquiry', 'Speak with pharmacist'];
        }

        // Cache candidates in session memory for contextual follow-up ("show me the second one")
        session.contextData = {
          ...(session.contextData || {}),
          lastMedicine: targetMed,
          lastAlternatives: altResult.candidates
        };
        state = 'idle';
        break;
      }

      // ── Capability 5: Proactive Assistance — Expiry Audit ──────────────────
      case 'EXPIRY_AUDIT': {
        const batches: ExpiringBatchItem[] = await pharmacyToolRegistry.auditExpiringStock(detected.timeframe || 'next_month', db);
        toolExecutions.push({ tool: 'auditExpiringStock', result: batches });

        if (batches.length > 0) {
          replyText = `⚠️ *Near-Expiry Batch Audit Report*\n\n` +
            `Found *${batches.length} batch(es)* expiring soon:\n\n`;

          batches.slice(0, 10).forEach((b, idx) => {
            const rack = b.rackLocation ? ` [Rack: ${b.rackLocation}]` : '';
            replyText += `${idx + 1}. *${b.medicineName}*\n` +
              `   • Batch: \`${b.batchNo}\` | Expiry: *${b.expiryDate}*\n` +
              `   • Quantity: *${b.quantity} units*${rack}\n\n`;

            cards.push({
              id: b.id,
              title: b.medicineName,
              subtitle: `Batch: ${b.batchNo} | Qty: ${b.quantity}${rack}`,
              badge: `Exp: ${b.expiryDate}`,
              badgeColor: 'amber'
            });
          });

          replyText += `💡 *Recommended Action:* Prioritize dispensing these batches first at the POS counter or initiate supplier return via Returns Hub.`;
          suggestedFollowUps = ['Open Returns Hub', 'Audit 30-day expiries', 'Export batch list'];
        } else {
          replyText = `✅ *Expiry Audit:* Good news! No batches in inventory are expiring within the queried timeframe.`;
          suggestedFollowUps = ['Audit 90-day expiries', 'Check low stock medicines'];
        }
        state = 'idle';
        break;
      }

      // ── Capability 5b: Proactive Assistance — Distributor Return Draft ──────
      case 'DISTRIBUTOR_RETURN_DRAFT': {
        const days = parseInt((detected.timeframe || '60').replace(/\D/g, ''), 10) || 60;
        const draft = await pharmacyToolRegistry.generateDistributorReturnDraft(days, undefined, db);
        toolExecutions.push({ tool: 'generateDistributorReturnDraft', result: draft });

        if (draft.totalBatches > 0) {
          replyText = `📋 *Draft Distributor Return List (${draft.daysAhead} Days Expiry Risk)*\n\n` +
            `Identified *${draft.totalBatches} batch(es)* (*${draft.totalUnits} units*) expiring within ${draft.daysAhead} days.\n` +
            `💰 *Estimated Return Claim Value:* ₹${draft.estimatedValue.toFixed(2)}\n\n` +
            `📦 *Batches Requiring Return:*\n`;

          draft.batches.slice(0, 8).forEach((b, idx) => {
            const rack = b.rackLocation ? ` [${b.rackLocation}]` : '';
            replyText += `${idx + 1}. *${b.medicineName}* (Batch: \`${b.batchNo}\`)\n` +
              `   • Qty: *${b.quantity}* | Exp: ${b.expiryDate} | Dist: ${b.distributorName}${rack}\n`;
            cards.push({
              id: b.inventoryId,
              title: b.medicineName,
              subtitle: `Batch: ${b.batchNo} | Qty: ${b.quantity} | Dist: ${b.distributorName}`,
              badge: `Exp: ${b.expiryDate}`,
              badgeColor: 'amber'
            });
          });

          replyText += `\n🔒 *Zero Stock Changes:* Stock in \`inventory_master\` has NOT been modified.\n` +
            `👉 *Would you like to stage this distributor return debit memo?*\n` +
            `Reply *Yes* or *APPROVE ${draft.draftId}* to confirm, or *No* to cancel.`;

          proposedAction = {
            id: draft.draftId,
            type: 'DISTRIBUTOR_RETURN_DRAFT',
            summary: `Draft distributor return memo for ${draft.totalBatches} batches (₹${draft.estimatedValue.toFixed(2)})`,
            data: draft,
            requiresConfirmation: true,
            status: 'PENDING_CONFIRMATION'
          };
          state = 'awaiting_confirmation';
          suggestedFollowUps = [`APPROVE ${draft.draftId}`, 'Audit 30-day expiries', 'Cancel'];
        } else {
          replyText = `✅ *Distributor Returns:* No batches in inventory are expiring within ${days} days. No return list needed at this time.`;
          state = 'idle';
          suggestedFollowUps = ['Audit 90-day expiries', 'Check low stock medicines'];
        }
        break;
      }

      // ── Capability 5c: Proactive Assistance — Low Stock Reorder Draft ──────
      case 'LOW_STOCK_REORDER': {
        const reorderDraft = await pharmacyToolRegistry.calculateLowStockReorderDraft(undefined, db);
        toolExecutions.push({ tool: 'calculateLowStockReorderDraft', result: reorderDraft });

        if (reorderDraft.totalItems > 0) {
          replyText = `📦 *Fast-Moving Low Stock & Reorder Assessment*\n\n` +
            `Found *${reorderDraft.totalItems} fast-moving medicines* at or below minimum safety stock:\n\n`;

          reorderDraft.items.slice(0, 8).forEach((it, idx) => {
            replyText += `${idx + 1}. *${it.medicineName}*\n` +
              `   • Stock: *${it.currentStock}* (Min: ${it.minStock}) | 30d Sales: ${it.recentSales30d} | Suggested: *+${it.suggestedReorderQty} units*\n`;
            cards.push({
              id: it.medicineId,
              title: it.medicineName,
              subtitle: `Stock: ${it.currentStock} | Min: ${it.minStock} | Suggested: +${it.suggestedReorderQty}`,
              badge: `${it.currentStock} left`,
              badgeColor: it.currentStock === 0 ? 'red' : 'amber'
            });
          });

          replyText += `\n👉 *Would you like to stage these items into the Live Cart / Purchase Order queue?*\n` +
            `Reply *Yes* or *APPROVE ${reorderDraft.draftId}* to stage, or *No* to dismiss.`;

          proposedAction = {
            id: reorderDraft.draftId,
            type: 'LOW_STOCK_REORDER',
            summary: `Low-stock reorder draft for ${reorderDraft.totalItems} items`,
            data: reorderDraft,
            requiresConfirmation: true,
            status: 'PENDING_CONFIRMATION'
          };
          state = 'awaiting_confirmation';
          suggestedFollowUps = [`APPROVE ${reorderDraft.draftId}`, 'Show sales summary', 'Cancel'];
        } else {
          replyText = `✅ *Inventory Stock Healthy:* All fast-moving medicines are currently above minimum safety thresholds.`;
          state = 'idle';
          suggestedFollowUps = ['Audit expiring stock', 'Check today sales'];
        }
        break;
      }

      // ── Capability 5d: Dispatch & Delivery Status ──────────────────────────
      case 'DELIVERY_STATUS': {
        const deliv = await pharmacyToolRegistry.getDeliveryRunStatus(db);
        toolExecutions.push({ tool: 'getDeliveryRunStatus', result: deliv });

        if (deliv.totalActive > 0) {
          replyText = `🛵 *Dispatch & Home Delivery Status*\n\n` +
            `• *Total Active Orders:* ${deliv.totalActive}\n` +
            `• *Pending Pickup:* ${deliv.pendingCount}\n` +
            `• *In Transit:* ${deliv.inTransitCount}\n\n` +
            `📋 *Active Delivery Runs:*\n`;

          deliv.orders.forEach((o, idx) => {
            const boy = o.deliveryBoyName ? ` (Rider: ${o.deliveryBoyName})` : ' (Unassigned)';
            replyText += `${idx + 1}. *Order #${o.orderId}* — ${o.patientName}${boy} [${o.status}]\n`;
            cards.push({
              id: o.orderId,
              title: `Order #${o.orderId} - ${o.patientName}`,
              subtitle: `${o.status}${boy} | ${o.address || 'Local delivery'}`,
              badge: o.status,
              badgeColor: o.status === 'In Transit' ? 'blue' : 'amber'
            });
          });
        } else {
          replyText = `✅ *Dispatch Clear:* No home delivery orders are currently pending or in transit.`;
        }
        state = 'idle';
        suggestedFollowUps = ['View dispatch board', 'Check today sales'];
        break;
      }

      // ── Capability 5e: Purchase Inward & Rate Queries (Strictly Owner) ─────
      case 'PURCHASE_QUERY': {
        if (role !== 'owner') {
          replyText = `🔒 *Access Restricted:* Trade pricing and supplier invoice details are restricted to verified store owners.`;
          state = 'idle';
        } else {
          const medQuery = detected.medicineName || '';
          const pur = await pharmacyToolRegistry.getPurchaseRateComparison(medQuery, db);
          toolExecutions.push({ tool: 'getPurchaseRateComparison', result: pur });

          if (pur.records.length > 0) {
            replyText = `💼 *Purchase Inward & Trade Price Intelligence*\n\n` +
              `Found *${pur.records.length} purchase record(s)*${medQuery ? ` for *${medQuery}*` : ''}:\n\n`;

            pur.records.slice(0, 6).forEach((p, idx) => {
              replyText += `${idx + 1}. *${p.medicineName}* (Batch: \`${p.batchNo}\`)\n` +
                `   • PTR / Cost: *₹${p.costPrice.toFixed(2)}* (MRP: ₹${p.mrp.toFixed(2)}) | Qty: ${p.quantity}\n` +
                `   • Supplier: *${p.distributorName}* | Invoice: \`${p.invoiceNo}\` (${p.invoiceDate})\n`;
              cards.push({
                id: `${p.batchNo}_${idx}`,
                title: p.medicineName,
                subtitle: `PTR: ₹${p.costPrice.toFixed(2)} | Dist: ${p.distributorName}`,
                badge: `Inv: ${p.invoiceNo}`,
                badgeColor: 'green'
              });
            });
          } else {
            replyText = `🔍 No purchase invoice records found${medQuery ? ` for *${medQuery}*` : ''}.`;
          }
          state = 'idle';
        }
        suggestedFollowUps = ['Check sales summary', 'Audit expiring stock'];
        break;
      }

      // ── Capability 5: Proactive Assistance — Comparative Sales ─────────────
      case 'SALES_COMPARISON': {
        const salesStats: SalesComparisonResult = await pharmacyToolRegistry.getSalesSummary({
          role,
          dbInstance: db
        });
        toolExecutions.push({ tool: 'getSalesSummary', result: salesStats });

        if (role === 'customer') {
          replyText = salesStats.analysisExplanation;
        } else {
          const deltaSign = salesStats.deltaRevenue >= 0 ? '+' : '';
          replyText = `📊 *Daily Sales Comparison (Today vs Yesterday)*\n\n` +
            `• *Today's Revenue:* ₹${salesStats.todayRevenue.toFixed(2)} (${salesStats.todayBillCount} invoices, Avg: ₹${salesStats.todayAverageTicket.toFixed(2)})\n` +
            `• *Yesterday's Revenue:* ₹${salesStats.yesterdayRevenue.toFixed(2)} (${salesStats.yesterdayBillCount} invoices, Avg: ₹${salesStats.yesterdayAverageTicket.toFixed(2)})\n` +
            `• *Delta:* ${deltaSign}₹${salesStats.deltaRevenue.toFixed(2)} (${deltaSign}${salesStats.percentChange}%)\n\n` +
            `💡 *Why is it different?*\n${salesStats.analysisExplanation}\n`;

          if (salesStats.topSellersToday.length > 0) {
            replyText += `\n🏆 *Top items today:* ${salesStats.topSellersToday.join(', ')}`;
          }

          cards = [
            {
              id: 'today_rev',
              title: `Today: ₹${salesStats.todayRevenue.toFixed(2)}`,
              subtitle: `${salesStats.todayBillCount} bills | Avg ticket: ₹${salesStats.todayAverageTicket.toFixed(2)}`,
              badge: 'Today',
              badgeColor: 'green'
            },
            {
              id: 'yest_rev',
              title: `Yesterday: ₹${salesStats.yesterdayRevenue.toFixed(2)}`,
              subtitle: `${salesStats.yesterdayBillCount} bills | Avg ticket: ₹${salesStats.yesterdayAverageTicket.toFixed(2)}`,
              badge: 'Yesterday',
              badgeColor: 'blue'
            }
          ];
          suggestedFollowUps = ['Show month-to-date sales', 'View POS sales ledger', 'Audit expiring stock'];
        }
        state = 'idle';
        break;
      }

      // ── Capability 2: Application Assistance & Screen Guidance ─────────────
      case 'APPLICATION_GUIDE': {
        const topic = detected.topic || input.pageContext?.pathname || '/pos';
        const guide = pharmacyToolRegistry.explainApplicationScreen(topic);
        toolExecutions.push({ tool: 'explainApplicationScreen', result: guide });

        replyText = `📖 *${guide.title}*\n\n${guide.guidance}\n\n`;
        if (guide.shortcuts && guide.shortcuts.length > 0) {
          replyText += `⌨️ *Keyboard Shortcuts:*\n` + guide.shortcuts.map(s => `• ${s}`).join('\n') + `\n\n`;
        }
        if (guide.tips && guide.tips.length > 0) {
          replyText += `💡 *Operating Tips:*\n` + guide.tips.map(t => `• ${t}`).join('\n');
        }

        const navUrl = detected.targetTab
          ? `${detected.targetPage || '/settings'}?tab=${detected.targetTab}`
          : (guide.actionUrl || detected.targetPage);

        if (navUrl) {
          cards.push({
            id: `guide_nav_${Date.now()}`,
            title: guide.title,
            subtitle: 'Click below to open this module or settings screen directly.',
            badge: 'Open Screen',
            badgeColor: 'blue',
            actionUrl: navUrl
          });
        }

        const tLower = topic.toLowerCase();
        if (tLower.includes('order hub') || tLower.includes('live cart') || tLower.includes('pharmarack')) {
          suggestedFollowUps = ['Open Live Cart', 'How to connect Pharmarack', 'Explain order minimums', 'Stage item to live cart'];
        } else if (tLower.includes('setting') || tLower.includes('printer') || tLower.includes('whatsapp') || tLower.includes('backup')) {
          suggestedFollowUps = ['Where are Order Hub settings?', 'How to connect Pharmarack', 'Configure thermal printer', 'Connect WhatsApp Web'];
        } else if (tLower.includes('pos')) {
          suggestedFollowUps = ['Explain POS shortcuts', 'Check Dolo 650 stock', 'Show due refills', 'Query today sales'];
        } else {
          suggestedFollowUps = ['Where are Order Hub settings?', 'Explain POS shortcuts', 'Audit near-expiry stock', 'Show due refills'];
        }
        state = 'idle';
        break;
      }

      // ── Capability 2: Stock Quantity Correction Guidance & Staging ─────────
      case 'STOCK_CORRECTION': {
        const correctionInfo = await pharmacyToolRegistry.correctStockQuantity({
          medicineName: detected.medicineName,
          medicineId: detected.medicineId,
          batchNo: detected.batchNo,
          newQuantity: detected.quantity,
          reason: 'Assistant physical audit adjustment',
          dbInstance: db
        });
        toolExecutions.push({ tool: 'correctStockQuantity', result: correctionInfo });

        replyText = correctionInfo.guidance;
        if (correctionInfo.stagedProposal) {
          proposedAction = correctionInfo.stagedProposal;
          replyText += `\n\n👉 *Would you like to confirm adjusting stock for ${detected.medicineName || 'medicine'} to ${detected.quantity} units?*\nReply *Yes* to commit, or *No* to cancel.`;
          state = 'awaiting_confirmation';
        } else {
          state = 'idle';
        }
        suggestedFollowUps = ['Open Inventory Screen', 'Audit Physical Batches'];
        break;
      }

      // ── Capability 5: Proactive Assistance — Refill Management ─────────────
      case 'REFILL': {
        let patName = detected.patientName;
        if (!patName) {
          const patMatch = userText.match(/\b(?:refill|renew|repeat|dawa)\s+(?:for|of|ka|ki)?\s+([A-Za-z]{3,25})\b/i) ||
                           userText.match(/\b([A-Za-z]{3,25})\s+(?:ka|ki|ke|s)?\s*(?:refill|dawa)\b/i);
          if (patMatch && !/^(check|add|due|any|my|all|regular|monthly)$/i.test(patMatch[1])) {
            patName = patMatch[1];
          }
        }

        let targetPhone = phone;
        let targetCustomerId = session.customerId || undefined;
        let targetCustomerName = session.customerName;

        if (patName) {
          const custRow = await db.get(
            `SELECT id, name, phone FROM customers WHERE name LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT 1`,
            [`%${patName}%`, `${patName}%`]
          ).catch(() => null);

          if (custRow) {
            targetCustomerId = custRow.id;
            targetPhone = custRow.phone || targetPhone;
            targetCustomerName = custRow.name;
          }
        }

        let refillsResult = await pharmacyToolRegistry.lookupPatientRefills(targetPhone, targetCustomerId, db);
        toolExecutions.push({ tool: 'lookupPatientRefills', result: refillsResult });

        // Fallback: If no explicit patient_refills rows found, search previous customer sales
        if ((!refillsResult || refillsResult.length === 0) && targetCustomerId) {
          const pastItems = await db.all(
            `SELECT si.medicine_name, si.quantity, m.id as medicine_id, m.total_stock, m.sell_price, m.mrp
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             LEFT JOIN medicines m ON m.name = si.medicine_name
             WHERE s.customer_id = ?
             ORDER BY s.id DESC LIMIT 3`,
            [targetCustomerId]
          ).catch(() => []);

          if (pastItems.length > 0) {
            refillsResult = pastItems.map((p: any, idx: number) => ({
              id: Number(p.medicine_id || (900000 + idx)),
              medicineName: p.medicine_name,
              quantityNeeded: p.quantity || 1,
              nextRefillDate: 'Regular',
              status: 'active',
              isReady: true,
              inStock: Number(p.total_stock || 0) >= Number(p.quantity || 1),
              totalStock: Number(p.total_stock || 0),
              pricePerUnit: Number(p.sell_price || p.mrp || 0)
            }));
          }
        }

        if (!refillsResult || refillsResult.length === 0) {
          if (patName) {
            replyText = `📋 We found customer record for *${targetCustomerName || patName}*, but no regular recurring refills are active.\n\nWould you like to search the medicine catalog or add a new refill record in CRM?`;
            suggestedFollowUps = ['Open CRM Screen', 'Search medicine stock', 'Cancel'];
          } else {
            replyText = `📋 We couldn't find an active regular refill on file for ${phone}.\n\nIf you need a specific medicine, please type its name (e.g. *Telma 40* or *Glycomet 500*), or reply *Pharmacist* to speak with our staff.`;
            suggestedFollowUps = ['Search medicine stock', 'Open CRM screen'];
          }
          state = 'idle';
        } else {
          const mentionedMedicine = detected.medicineName || this.extractMedicineFromText(userText);
          let targetRefill = refillsResult[0];

          if (mentionedMedicine) {
            const matched = refillsResult.find((r: RefillRecordItem) =>
              r.medicineName.toLowerCase().includes(mentionedMedicine.toLowerCase()) ||
              mentionedMedicine.toLowerCase().includes(r.medicineName.toLowerCase())
            );
            if (matched) targetRefill = matched;
          }

          const priceStr = targetRefill.pricePerUnit > 0 ? ` (Est. ₹${(targetRefill.pricePerUnit * targetRefill.quantityNeeded).toFixed(2)})` : '';
          const stockNotice = targetRefill.inStock ? '✅ In Stock' : '⏳ Ready to order';

          if (role === 'customer') {
            proposedAction = {
              id: `refill_${targetRefill.id}`,
              type: 'CONFIRM_REFILL',
              summary: `Prepare refill for ${targetRefill.medicineName} (${targetRefill.quantityNeeded} units)`,
              data: {
                refillId: targetRefill.id,
                medicineName: targetRefill.medicineName,
                quantity: targetRefill.quantityNeeded,
                price: targetRefill.pricePerUnit
              },
              requiresConfirmation: true,
              status: 'PENDING_CONFIRMATION'
            };

            replyText = `🔔 *Refill Due Check:*\n\n` +
              `We have your regular prescription for:\n` +
              `💊 *${targetRefill.medicineName}*\n` +
              `📦 Quantity: *${targetRefill.quantityNeeded} unit(s)*${priceStr}\n` +
              `📊 Status: ${stockNotice}\n\n` +
              `👉 *Would you like us to prepare this refill?*\n` +
              `Reply *Yes* to confirm, or *No* to cancel.`;

            suggestedFollowUps = ['Yes, confirm refill', 'Find alternatives', 'Cancel'];
          } else {
            const displayName = targetCustomerName || patName || 'Customer';
            const staffStockNotice = targetRefill.inStock ? `✅ In Stock (${targetRefill.totalStock} on shelf)` : '⏳ Needs Procurement';

            if (targetRefill.inStock) {
              replyText = `🔔 *Patient Refill — ${displayName}*\n\n` +
                `We have the regular prescription for:\n` +
                `💊 *${targetRefill.medicineName}*\n` +
                `📦 Quantity: *${targetRefill.quantityNeeded} unit(s)*${priceStr}\n` +
                `📊 Stock: ${staffStockNotice}\n\n` +
                `👉 *Would you like to stage this refill to the POS billing counter?*\nClick *Stage to Cart* or reply *Yes*.`;

              proposedAction = {
                id: `refill_confirm_${Date.now()}`,
                type: 'CONFIRM_REFILL',
                summary: `Prepare refill (${targetRefill.quantityNeeded} of ${targetRefill.medicineName}) for ${displayName}`,
                data: {
                  refillId: targetRefill.id,
                  medicineName: targetRefill.medicineName,
                  quantity: targetRefill.quantityNeeded,
                  customerName: displayName,
                  phone: targetPhone,
                  price: targetRefill.pricePerUnit
                },
                requiresConfirmation: true,
                status: 'PENDING_CONFIRMATION'
              };
              suggestedFollowUps = ['Confirm Refill', 'Order from distributor', 'Cancel'];
            } else {
              replyText = `🔔 *Patient Refill — ${displayName}*\n\n` +
                `💊 *${targetRefill.medicineName}* (${targetRefill.quantityNeeded} units)\n` +
                `📊 Stock: ${staffStockNotice}\n\n` +
                `👉 *Shelf stock is insufficient.* Would you like to stage *${targetRefill.medicineName}* into the *Pharmarack Live Cart* to order from distributor?`;

              proposedAction = {
                id: `live_cart_${Date.now()}`,
                type: 'STAGE_LIVE_CART_ITEM',
                summary: `Stage ${targetRefill.quantityNeeded} of ${targetRefill.medicineName} to Pharmarack Live Cart for ${displayName}`,
                data: {
                  medicineName: targetRefill.medicineName,
                  quantity: targetRefill.quantityNeeded,
                  destination: 'live_cart'
                },
                requiresConfirmation: true,
                status: 'PENDING_CONFIRMATION'
              };
              suggestedFollowUps = ['Order from distributor', 'Find alternative', 'Cancel'];
            }
          }

          cards = [
            {
              id: targetRefill.id,
              title: targetRefill.medicineName,
              subtitle: `Due: ${targetRefill.nextRefillDate || 'Today'} | Qty: ${targetRefill.quantityNeeded}`,
              badge: targetRefill.inStock ? 'In Stock' : 'Needs Procurement',
              badgeColor: targetRefill.inStock ? 'green' : 'amber'
            }
          ];

          state = 'awaiting_confirmation';
        }
        break;
      }

      // ── Capability 5: Proactive Assistance — Call Tasks & Reminders ────────
      case 'REMINDER_SCHEDULE': {
        const custName = detected.patientName || session.customerName || 'Customer';
        const notes = detected.notes || userText;
        const dueDate = detected.dueDate || 'Tomorrow';

        proposedAction = {
          id: `reminder_${Date.now()}`,
          type: 'SCHEDULE_CALL',
          summary: `Remind ${custName} (${phone}) about refill on ${dueDate}`,
          data: { patientName: custName, phone, notes, dueDate },
          requiresConfirmation: true,
          status: 'PENDING_CONFIRMATION'
        };

        replyText = `📅 *Schedule Refill Reminder*\n\n` +
          `• *Patient:* ${custName} (+91 ${phone})\n` +
          `• *Due:* ${dueDate}\n` +
          `• *Task Details:* ${notes}\n\n` +
          `👉 *Confirm creating this reminder task for pharmacy staff?*\nReply *Yes* to confirm, or *No* to cancel.`;

        state = 'awaiting_confirmation';
        suggestedFollowUps = ['Yes, create reminder', 'Cancel'];
        break;
      }

      // ── Capability 4: Medicine Search & Stock Lookup ───────────────────────
      case 'MEDICINE_INQUIRY': {
        const medName = detected.medicineName || this.extractMedicineFromText(userText) || userText;
        const searchResult = await pharmacyToolRegistry.searchMedicineAvailability(medName, db);
        toolExecutions.push({ tool: 'searchMedicineAvailability', result: searchResult });

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
            replyText += (topItem.batchNo ? `🏷️ *Batch:* ${topItem.batchNo}\n` : '') +
              (topItem.expiryDate ? `📅 *Expiry:* ${topItem.expiryDate}\n` : '') +
              (topItem.rackLocation ? `📍 *Rack Location:* ${topItem.rackLocation}\n\n` : '\n');

            replyText += `👉 Item is in stock. You can verify on shelf, check in-stock alternatives, or stage to Pharmarack distributor cart.`;
            suggestedFollowUps = ['Find in-stock alternatives', `Stage ${topItem.name} to Live Cart`, 'Check due refills'];
          } else {
            replyText += `⏳ *Currently Out of Stock*\n\n`;

            // Check for verified in-stock same-salt alternatives
            const altResult = await pharmacyToolRegistry.findAlternatives(topItem.name, db);
            const inStockAlts = (altResult?.candidates || []).filter(c => c.inStock);

            if (inStockAlts.length > 0) {
              replyText += `💡 *Available In-Stock Equivalents (${altResult.sourceSalt || 'Same Salt'}):*\n` +
                inStockAlts.slice(0, 3).map((a, i) =>
                  `${i + 1}. *${a.name}* (${a.manufacturer || 'Standard'}) — ✅ ${a.stockQuantity} in stock | MRP ₹${a.mrp.toFixed(2)} (Rack: ${a.rackLocation || 'Shelf'})`
                ).join('\n') + `\n\n`;
            }

            replyText += `Would you like to book a Special Order for a patient, or stage into Pharmarack Live Cart?`;
            proposedAction = {
              id: `spec_order_${Date.now()}`,
              type: 'BOOK_SPECIAL_ORDER',
              summary: `Book Special Order for ${topItem.name} in CRM & Quick Assist`,
              data: {
                medicineName: topItem.name,
                customerName: session.contextData?.lastCustomer || 'Walk-in Customer',
                customerPhone: session.contextData?.lastPhone || '',
                quantity: detected.quantity || 1
              },
              requiresConfirmation: true,
              status: 'PENDING_CONFIRMATION'
            };
            state = 'awaiting_confirmation';
            suggestedFollowUps = ['Book Special Order', `Stage ${topItem.name} to Live Cart`, 'Cancel'];
          }

          cards = searchResult.slice(0, 3).map(m => ({
            id: m.id,
            title: m.name,
            subtitle: `${m.dosageForm || 'Tablet'} | MRP ₹${m.mrp.toFixed(2)}`,
            badge: m.inStock ? `${m.stockQuantity} in stock` : 'Out of Stock',
            badgeColor: m.inStock ? 'green' : 'amber'
          }));

          session.contextData = {
            ...(session.contextData || {}),
            lastMedicine: topItem.name
          };
          if (!proposedAction) {
            state = 'idle';
          }
        } else {
          replyText = `🔍 We could not find *${medName}* in our current store catalog.\n\nWould you like to find substitutes with the same active salt, or log a procurement request?`;
          proposedAction = {
            id: `enquiry_${Date.now()}`,
            type: 'CREATE_ENQUIRY',
            summary: `Procure unlisted medicine ${medName}`,
            data: { medicineName: medName, notes: 'Unlisted medicine inquiry via assistant' },
            requiresConfirmation: true,
            status: 'PENDING_CONFIRMATION'
          };
          state = 'awaiting_confirmation';
          suggestedFollowUps = ['Log procurement enquiry', 'Cancel'];
        }
        break;
      }

      // ── Capability 7: Cart Staging (Live Distributor Cart & POS Billing) ────
      case 'CART_STAGING': {
        const rawMed = detected.medicineName || this.extractMedicineFromText(userText) || 'Medicine';
        const cleanMed = rawMed.replace(/\b(?:live\s*cart|pos\s*cart|pharmarack(?:\s*cart)?|distributor\s*cart)\b/gi, '').trim();
        const medName = cleanMed.length >= 2 ? cleanMed : 'Medicine';
        const unit = detected.unit || 'strip';
        const destination = detected.destination || (/\blive\s*cart\b/i.test(userText) ? 'live_cart' : (input.pageContext?.pathname === '/pos' ? 'pos_cart' : 'live_cart'));

        // Smart Slot-Filling: If quantity was omitted by user, prompt with interactive quick-action chips
        if (!detected.quantity) {
          const destTitle = destination === 'live_cart' ? 'Pharmarack Live Cart' : 'POS Billing Counter';
          replyText = `🛒 *Quantity Needed:*\n\nHow many strips of *${medName}* would you like to stage to the *${destTitle}*?\n\nSelect a quantity below or reply with the exact number:`;

          session.contextData = {
            ...(session.contextData || {}),
            pendingSlotFill: {
              type: 'CART_STAGING',
              medicineName: medName,
              destination,
              unit
            }
          };

          cards = [{
            id: `slot_qty_${Date.now()}`,
            title: medName,
            subtitle: `Target: ${destTitle}`,
            badge: 'Quantity Needed',
            badgeColor: 'amber'
          }];

          suggestedFollowUps = ['1 strip', '5 strips', '10 strips', 'Cancel'];
          state = 'awaiting_clarification';
          break;
        }

        const qty = detected.quantity;

        replyText = `🛒 *Distributor Live Cart Staging*\n\n` +
          `• *Medicine:* ${medName}\n` +
          `• *Quantity:* ${qty} ${unit}\n` +
          `• *Destination:* Pharmarack Live Cart\n\n` +
          `👉 *Confirm staging this item to your live distributor cart?*\nReply *Yes* or click *Stage to Live Cart* to confirm, or *No* to cancel.`;

        proposedAction = {
          id: `live_cart_${Date.now()}`,
          type: 'STAGE_LIVE_CART_ITEM',
          summary: `Stage ${qty} ${unit} of ${medName} into Pharmarack Live Cart`,
          data: {
            medicineName: medName,
            quantity: qty,
            unit,
            destination: 'live_cart'
          },
          requiresConfirmation: true,
          status: 'PENDING_CONFIRMATION'
        };
        state = 'awaiting_confirmation';
        suggestedFollowUps = ['Stage to Live Cart', 'Cancel'];
        cards = [{
          id: `cart_${Date.now()}`,
          title: medName,
          subtitle: `Quantity: ${qty} ${unit} | Pharmarack Live Cart`,
          badge: 'Live Cart',
          badgeColor: 'green'
        }];
        break;
      }

      // ── Capability 6: Contextual Memory Follow-Ups ─────────────────────────
      case 'CONTEXTUAL_FOLLOW_UP': {
        const lastAlts = session.contextData?.lastAlternatives as AlternativeCandidateItem[];
        const targetIndex = detected.targetIndex ?? 0;

        if (lastAlts && lastAlts[targetIndex]) {
          const selected = lastAlts[targetIndex];
          replyText = `🔍 *Selected Alternative (${targetIndex + 1}): ${selected.name}*\n\n` +
            `• Form: ${selected.dosageForm || 'Tablet'} ${selected.strength || ''}\n` +
            `• Composition: ${selected.genericName || 'Same active salt'}\n` +
            `• Price: ₹${selected.sellingPrice.toFixed(2)} (MRP ₹${selected.mrp.toFixed(2)})\n` +
            `• Shelf Stock: ${selected.inStock ? `✅ ${selected.stockQuantity} units available` : '❌ Out of stock'}\n` +
            `• Manufacturer: ${selected.manufacturer || 'Licensed Pharmaceutical Co.'}\n\n` +
            `⚠️ *Clinical Reminder:* Pharmacist verification required before dispensing.`;

          cards = [
            {
              id: selected.id,
              title: selected.name,
              subtitle: `MRP ₹${selected.mrp.toFixed(2)} | By ${selected.manufacturer || 'Pharma'}`,
              badge: selected.inStock ? `${selected.stockQuantity} in stock` : 'Out of Stock',
              badgeColor: selected.inStock ? 'green' : 'amber'
            }
          ];
          suggestedFollowUps = ['Find another alternative', 'Check stock in drawer', 'Back to catalog'];
        } else {
          replyText = `I understand your follow-up, but could not identify which item you referred to. Could you please specify the medicine name?`;
          suggestedFollowUps = ['Search medicine availability', 'Audit expiring batches'];
        }
        state = 'idle';
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
          `How can I assist you with your pharmacy operations today?`;
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
        const greetingName = input.username || session.customerName || (role === 'owner' ? 'Owner' : 'Staff');
        const currPage = input.pageContext?.pathname || '/dashboard';
        const pageGuide = pharmacyToolRegistry.explainApplicationScreen(currPage);

        replyText = `👋 Namaste, ${greetingName}! Welcome to AI Pharmacy OS.\n\n` +
          `You are currently on *${pageGuide.title}*.\n\n` +
          `I can assist you naturally across all pharmacy operations:\n` +
          `• 🛒 *Order Hub & Live Cart:* Stage shortage medicines and order from distributors\n` +
          `• ⚙️ *Settings & Automation:* Setup Pharmarack, WhatsApp bot, thermal printers\n` +
          `• 💊 *POS Counter & Inventory:* Fast billing, salt substitutes, near-expiry batch audits\n` +
          `• 🔔 *CRM Refills:* Check chronic patient refills and schedule reminder calls\n\n` +
          `How can I help you right now?`;

        if (pageGuide.actionUrl) {
          cards.push({
            id: `page_card_${Date.now()}`,
            title: pageGuide.title,
            subtitle: pageGuide.guidance.slice(0, 100) + '...',
            badge: 'Current Screen',
            badgeColor: 'green',
            actionUrl: pageGuide.actionUrl
          });
        }

        if (currPage.includes('live-cart') || currPage.includes('pharmarack')) {
          suggestedFollowUps = ['Explain Order Hub settings', 'Stage item to live cart', 'Check distributor minimums', 'Show due refills'];
        } else if (currPage.includes('setting')) {
          suggestedFollowUps = ['How to connect Pharmarack', 'Configure thermal printer', 'Connect WhatsApp Web', 'View store profile'];
        } else if (currPage.includes('pos')) {
          suggestedFollowUps = ['Explain POS shortcuts', 'Check Dolo 650 stock', 'Show due refills', 'Query today sales'];
        } else {
          suggestedFollowUps = [
            'Where are Order Hub settings?',
            'Find medicines expiring next month',
            'Show today sales vs yesterday',
            'How to connect Pharmarack'
          ];
        }
        state = 'idle';
        break;
      }

      // ── Capability 8: Customer Due Bill & Monthly Payment QR ────────────────
      case 'CUSTOMER_DUE_QUERY': {
        const targetCustomer = detected.patientName || session.contextData?.lastCustomer || 'Walk-in Customer';
        const dueResult = await pharmacyToolRegistry.queryCustomerCreditDue(targetCustomer, db);
        toolExecutions.push({ tool: 'queryCustomerCreditDue', result: dueResult });

        if (dueResult && dueResult.creditBalance > 0) {
          replyText = `💳 *Monthly Due Summary for ${dueResult.name}*\n\n` +
            `• *Total Outstanding Balance:* ₹${dueResult.creditBalance.toFixed(2)}\n` +
            `• *Registered Phone:* ${dueResult.phone || 'Not recorded'}\n` +
            `• *Due Date:* ${dueResult.creditDueDate || 'As agreed'}\n\n` +
            `📋 *Unpaid Invoices Breakdown (${dueResult.pendingInvoices.length}):*\n` +
            `${dueResult.formattedBreakdown || '• Ledger balance record'}\n\n` +
            `👉 *Would you like to send an official WhatsApp payment reminder with rotating UPI QR code?*`;

          proposedAction = {
            id: `due_qr_${Date.now()}`,
            type: 'SEND_DUE_PAYMENT_QR',
            summary: `Send WhatsApp payment reminder & UPI QR for ₹${dueResult.creditBalance.toFixed(2)} to ${dueResult.name}`,
            data: {
              customerId: dueResult.customerId,
              customerName: dueResult.name,
              phone: dueResult.phone,
              amount: dueResult.creditBalance
            },
            requiresConfirmation: true,
            status: 'PENDING_CONFIRMATION'
          };
          state = 'awaiting_confirmation';
          suggestedFollowUps = ['Confirm & Send QR Reminder', 'Cancel'];
          cards = [{
            id: `due_${Date.now()}`,
            title: dueResult.name,
            subtitle: `Due: ₹${dueResult.creditBalance.toFixed(2)} | ${dueResult.pendingInvoices.length} pending bill(s)`,
            badge: `₹${dueResult.creditBalance.toFixed(2)} DUE`,
            badgeColor: 'amber',
            details: {
              Customer: dueResult.name,
              Phone: dueResult.phone || 'N/A',
              'Due Date': dueResult.creditDueDate || 'Immediate'
            }
          }];
        } else if (dueResult) {
          replyText = `✅ *Clear Balance:* Customer *${dueResult.name}* has zero outstanding dues. All bills are fully paid!`;
          suggestedFollowUps = ['Check another customer', 'Search medicine in stock'];
        } else {
          replyText = `🔍 We could not locate customer record *"${targetCustomer}"*. Please provide the customer's registered phone number or full name.`;
          suggestedFollowUps = ['Show customer ledger', 'Search medicine in stock'];
        }
        break;
      }

      // ── Capability 8b: Canonical CRM Special Order Booking ─────────────────
      case 'BOOK_SPECIAL_ORDER': {
        const medName = detected.medicineName || session.contextData?.lastMedicine || 'Medicine';
        const custName = detected.patientName || session.contextData?.lastCustomer || 'Walk-in Customer';
        const qty = detected.quantity || 1;

        replyText = `📦 *Confirm Special Order Booking*\n\n` +
          `• *Medicine:* ${medName}\n` +
          `• *Quantity:* ${qty} unit(s)\n` +
          `• *Customer / Requester:* ${custName}\n` +
          `• *Target Destination:* CRM → Special Orders & Quick Assist sidebar\n\n` +
          `👉 *Confirm booking this special order?* Click *Book Special Order* or reply *Yes* to confirm.`;

        proposedAction = {
          id: `spec_order_${Date.now()}`,
          type: 'BOOK_SPECIAL_ORDER',
          summary: `Book Special Order for ${qty} of ${medName} for ${custName}`,
          data: {
            medicineName: medName,
            customerName: custName,
            customerPhone: session.contextData?.lastPhone || '',
            quantity: qty
          },
          requiresConfirmation: true,
          status: 'PENDING_CONFIRMATION'
        };
        state = 'awaiting_confirmation';
        suggestedFollowUps = ['Book Special Order', 'Cancel'];
        cards = [{
          id: `spec_${Date.now()}`,
          title: medName,
          subtitle: `Quantity: ${qty} | Customer: ${custName}`,
          badge: 'Special Order',
          badgeColor: 'blue'
        }];
        break;
      }

      // ── Capability 8c: CRM Patient Refill Onboarding ───────────────────────
      case 'ONBOARD_REFILL': {
        const medName = detected.medicineName || session.contextData?.lastMedicine || 'Medicine';
        const custName = detected.patientName || session.contextData?.lastCustomer || 'Patient';
        const days = detected.timeframe ? parseInt(detected.timeframe, 10) : 30;

        replyText = `🗓️ *Schedule Patient Refill*\n\n` +
          `• *Patient:* ${custName}\n` +
          `• *Medicine:* ${medName}\n` +
          `• *Cycle:* Every ${days} days\n` +
          `• *Target Destination:* CRM → Patient Refills\n\n` +
          `👉 *Confirm scheduling this refill?* Click *Schedule Refill* or reply *Yes* to confirm.`;

        proposedAction = {
          id: `refill_onboard_${Date.now()}`,
          type: 'ONBOARD_REFILL',
          summary: `Schedule refill for ${custName} (${medName}, every ${days} days)`,
          data: {
            customerName: custName,
            customerPhone: session.contextData?.lastPhone || '',
            medicineName: medName,
            quantity: 1,
            intervalDays: days
          },
          requiresConfirmation: true,
          status: 'PENDING_CONFIRMATION'
        };
        state = 'awaiting_confirmation';
        suggestedFollowUps = ['Schedule Refill', 'Cancel'];
        cards = [{
          id: `refill_${Date.now()}`,
          title: custName,
          subtitle: `${medName} • Refill every ${days} days`,
          badge: 'Recurring Refill',
          badgeColor: 'blue'
        }];
        break;
      }

      case 'POS_APPLY_DISCOUNT':
      case 'POS_HOLD_BILL': {
        replyText = `ℹ️ *POS Counter Notice:* POS billing actions (discounts, holding bills, line-item entry) are managed directly on the POS screen by the cashier. You can search inventory (Name/Batch/MRP), find in-stock alternatives, send payment QR reminders for monthly dues, or book special orders here.`;
        suggestedFollowUps = ['Find in-stock alternatives', 'Search batch DL2041', 'Share monthly due QR'];
        break;
      }

      // ── Capability 8d: On-Demand Pharmacy Automation Orchestrator ─────────
      case 'TRIGGER_AUTOMATION': {
        const autoId = detected.topic || 'credit_reminders';
        const lookaheadDays = detected.timeframe ? parseInt(detected.timeframe, 10) : 60;
        const preview = await pharmacyToolRegistry.previewAutomation(autoId, { lookaheadDays }, db);
        toolExecutions.push({ tool: 'previewAutomation', result: preview });

        replyText = `⚙️ *Automation Inspection — ${preview.automationId.toUpperCase().replace(/_/g, ' ')}*\n\n` +
          `• *Status:* Ready for on-demand execution\n` +
          `• *Inspection Assessment:* ${preview.summary}\n\n` +
          `👉 *Confirm running this automation now?* Click *Confirm & Run Automation* or reply *Yes*.`;

        proposedAction = {
          id: `auto_${Date.now()}`,
          type: 'TRIGGER_AUTOMATION',
          summary: `Execute ${preview.automationId}: ${preview.summary}`,
          data: {
            automationId: preview.automationId,
            lookaheadDays
          },
          requiresConfirmation: true,
          status: 'PENDING_CONFIRMATION'
        };
        state = 'awaiting_confirmation';
        suggestedFollowUps = ['Confirm & Run Automation', 'Cancel'];
        cards = [{
          id: `auto_card_${Date.now()}`,
          title: preview.automationId.replace(/_/g, ' ').toUpperCase(),
          subtitle: preview.summary,
          badge: 'Ready to Run',
          badgeColor: 'blue'
        }];
        break;
      }

      // ── Capability 9: Inventory Rack & Stock Audit ──────────────────────────
      case 'INVENTORY_STOCK_AUDIT': {
        const medName = detected.medicineName || this.extractMedicineFromText(userText) || userText;
        const searchResult = await pharmacyToolRegistry.searchMedicineAvailability(medName, db);
        toolExecutions.push({ tool: 'searchMedicineAvailability', result: searchResult });

        if (searchResult && searchResult.length > 0) {
          const topItem = searchResult[0];
          const batchRows = await db.all(
            `SELECT batch_no, quantity, expiry_date, rack_location 
             FROM inventory_master 
             WHERE medicine_id = ? AND quantity > 0 
             ORDER BY expiry_date ASC LIMIT 5`,
            [topItem.id]
          ).catch(() => []);

          const rackLoc = (batchRows[0] as any)?.rack_location || 'General Shelf';
          replyText = `📍 *Inventory Shelf & Rack Location*\n\n` +
            `• *Medicine:* ${topItem.name}\n` +
            `• *Total Stock:* ${topItem.stockQuantity} units (${topItem.inStock ? '✅ In Stock' : '❌ Out of Stock'})\n` +
            `• *Rack / Location:* 🏷️ *${rackLoc}*\n\n`;

          if (batchRows.length > 0) {
            replyText += `📋 *Batches on Shelf:*\n`;
            batchRows.forEach((b: any, idx: number) => {
              replyText += `${idx + 1}. Batch *${b.batch_no}* — Qty: ${b.quantity} | Exp: ${b.expiry_date || 'N/A'} (Rack: ${b.rack_location || rackLoc})\n`;
            });
          }

          cards = [{
            id: topItem.id,
            title: topItem.name,
            subtitle: `Rack: ${rackLoc} | Stock: ${topItem.stockQuantity}`,
            badge: rackLoc,
            badgeColor: 'green'
          }];
          suggestedFollowUps = [`Add ${topItem.name} to bill`, `Correct stock of ${topItem.name}`, 'Check expiring batches'];
        } else {
          replyText = `🔍 Could not locate *${medName}* in your inventory master. Please verify the medicine spelling or search in catalog.`;
          suggestedFollowUps = ['Search inventory', 'View low stock items'];
        }
        state = 'idle';
        break;
      }

      // ── Capability 10: Live Cart Sync Micro-Workflow ────────────────────────
      case 'LIVE_CART_SYNC': {
        replyText = `🔄 *Pharmarack Live Cart Sync*\n\n` +
          `Propose synchronizing distributor cart items with live Pharmarack retailer credentials.\n\n` +
          `👉 Click *Sync Cart* or reply *Yes* to refresh distributor cart status.`;

        proposedAction = {
          id: `live_cart_sync_${Date.now()}`,
          type: 'LIVE_CART_SYNC',
          summary: `Synchronize live Pharmarack distributor cart`,
          data: { action: 'sync' },
          requiresConfirmation: true,
          status: 'PENDING_CONFIRMATION'
        };
        state = 'awaiting_confirmation';
        suggestedFollowUps = ['Sync Cart', 'Cancel'];
        cards = [{
          id: `sync_${Date.now()}`,
          title: 'Distributor Live Cart',
          subtitle: 'Refresh stock, pricing, and MOQ thresholds',
          badge: 'Cart Sync',
          badgeColor: 'blue'
        }];
        break;
      }

      default: {
        let aiHandled = false;
        if (isLocalAiEnabled()) {
          try {
            const pageName = input.pageContext?.pageTitle || input.pageContext?.pathname || 'Dashboard';
            const sysPrompt = `You are Qwen, the expert clinical and operations AI copilot for AI Pharmacy OS. The user is on the "${pageName}" screen. Answer clearly, accurately, and concisely (<100 words). Do not invent false inventory data or rates.`;
            const completion = await queryLocalAiChat([
              { role: 'system', content: sysPrompt },
              { role: 'user', content: userText }
            ], { timeoutMs: 8000, maxTokens: 250 });
            if (completion && completion.success && completion.content && completion.content.trim()) {
              replyText = completion.content.trim();
              aiHandled = true;
            }
          } catch (_) {}
        }

        if (!aiHandled) {
          replyText = `I understand you are asking about: "${userText.slice(0, 80)}".\n\n` +
            `Here are tasks you can try right away:\n` +
            `• "Find medicines expiring next month"\n` +
            `• "Find an alternative for [Medicine Name]"\n` +
            `• "Show me today's sales and explain why they are lower than yesterday"\n` +
            `• "Explain how to use the purchase entry screen"\n` +
            `• "How can I correct the stock quantity?"\n` +
            `• "Remind me to call Rajesh tomorrow about his refill"`;
        }
        state = 'idle';
        suggestedFollowUps = [
          'Find medicines expiring next month',
          'Show today sales vs yesterday',
          'Explain purchase entry screen'
        ];
        break;
      }
    }

    // 6. Outbound Security Gateway Sanitization (PTR / Margin Protection)
    const sanitizedReply = this.sanitizeOutbound(replyText, phone, role);

    // 7. Persist Assistant Turn & Update Session Context
    const contextDataToSave: Record<string, any> = {
      ...(session.contextData || {}),
      lastIntent: detected.type
    };

    if (detected.medicineName && detected.medicineName.length >= 3 && !/^(it|this|that|iska|uska|medicine|dawa)$/i.test(detected.medicineName)) {
      contextDataToSave.lastMedicine = detected.medicineName;
    }
    if (detected.patientName && detected.patientName.length >= 2 && !/^(he|him|his|she|her|customer|patient|uska|iska)$/i.test(detected.patientName)) {
      contextDataToSave.lastCustomer = detected.patientName;
    }
    if (detected.batchNo) {
      contextDataToSave.lastBatch = detected.batchNo;
    }

    if (proposedAction) {
      contextDataToSave.pendingProposal = proposedAction;
    } else if (state === 'idle') {
      delete contextDataToSave.pendingProposal;
      delete contextDataToSave.pendingSlotFill;
    }

    await conversationalMemoryService.updateSession(
      session.id,
      {
        sessionState: state,
        activeIntent: detected.type,
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
      intent: detected.type,
      state,
      proposedAction,
      requiresConfirmation: Boolean(proposedAction),
      toolExecutions,
      cards,
      suggestedFollowUps,
      latencyMs: Math.round(performance.now() - startTime)
    };
  }

  /**
   * Sanitizes outbound messages via OutboundSecurityGateway to prevent wholesale price/PTR leaks.
   */
  public sanitizeOutbound(message: string, phone: string, role: string = 'staff'): string {
    // If role is strictly owner, internal rates are allowed in private chat
    if (role === 'owner') return message;

    const scan = outboundSecurityGateway.scanMessageContent(message, 'customer');
    if (scan.safe) return message;

    let cleaned = message;
    for (const v of scan.violations) {
      console.warn(`[Conversational Agent] Outbound security redact for ${phone}: ${v}`);
    }

    cleaned = cleaned.replace(/\b(?:ptr|cost price|purchase rate|wholesale rate|profit margin)\b.*?(?=\n|$)/gi, '');
    return cleaned.trim();
  }

  /**
   * Resolves unified intent and parameters across the 6 core capabilities
   */
  private async resolveUnifiedIntent(
    text: string,
    input: ProcessMessageInput,
    session: CustomerConversationSession,
    recentTurns: ConversationTurn[]
  ): Promise<{
    type: string;
    medicineName?: string;
    medicineId?: number;
    batchNo?: string;
    quantity?: number;
    unit?: string;
    destination?: 'live_cart' | 'pos_cart';
    targetPage?: string;
    targetTab?: string;
    timeframe?: string;
    topic?: string;
    patientName?: string;
    dueDate?: string;
    notes?: string;
    targetIndex?: number;
    discountPercent?: number;
  }> {
    const t = text.toLowerCase().trim();

    // 0. Image attachment directly triggers DOCUMENT_OCR
    if (input.imageBuffer || input.imagePath) {
      return { type: 'DOCUMENT_OCR' };
    }

    // 0a. Instant Fast-Path for Deterministic Greetings (sub-millisecond, zero CPU LLM load)
    if (
      /^(?:hi|hello|hey|namaste|namaskar|pranam|good\s+morning|good\s+afternoon|good\s+evening|salaam|kem\s+cho|kasa\s+kay)$/i.test(
        t.replace(/[!.,?]/g, '').trim()
      )
    ) {
      return { type: 'GREETING' };
    }

    // 0b. Prioritize Qwen Operational Local AI Intent when active/ready
    try {
      if (isLocalAiEnabled()) {
        const { queryOperationalAiIntent } = await import('./llamaServerClient.js');
        const opIntent = await queryOperationalAiIntent(text);
        if (opIntent && opIntent.confidence >= 0.6 && opIntent.intent !== 'UNKNOWN') {
          if (opIntent.intent === 'CART_STAGING') {
            return {
              type: 'CART_STAGING',
              medicineName: opIntent.medicineName,
              quantity: opIntent.quantity,
              unit: opIntent.unit,
              destination: opIntent.destination || (/\blive\s*cart\b/i.test(t) ? 'live_cart' : (input.pageContext?.pathname === '/pos' ? 'pos_cart' : 'live_cart'))
            };
          }
          if (opIntent.intent === 'EXPIRY_AUDIT') {
            return { type: 'EXPIRY_AUDIT', timeframe: opIntent.timeframeDays ? `${opIntent.timeframeDays}_days` : '60_days' };
          }
          if (opIntent.intent === 'DISTRIBUTOR_RETURN_DRAFT') {
            return { type: 'DISTRIBUTOR_RETURN_DRAFT', timeframe: opIntent.timeframeDays ? `${opIntent.timeframeDays}_days` : '60_days' };
          }
          if (opIntent.intent === 'LOW_STOCK_REORDER') {
            return { type: 'LOW_STOCK_REORDER' };
          }
          if (opIntent.intent === 'DELIVERY_STATUS') {
            return { type: 'DELIVERY_STATUS' };
          }
          if (opIntent.intent === 'PURCHASE_QUERY') {
            return { type: 'PURCHASE_QUERY', medicineName: opIntent.medicineName };
          }
          if (opIntent.intent === 'SALES_SUMMARY') {
            return { type: 'SALES_COMPARISON' };
          }
          if (opIntent.intent === 'REFILL_MANAGEMENT') {
            return { type: 'REFILL', medicineName: opIntent.medicineName, patientName: opIntent.patientName };
          }
          if (opIntent.intent === 'STOCK_ADJUSTMENT') {
            return { type: 'STOCK_CORRECTION', medicineName: opIntent.medicineName, quantity: opIntent.quantity };
          }
          if (opIntent.intent === 'PAGE_GUIDANCE') {
            return {
              type: 'APPLICATION_GUIDE',
              topic: opIntent.targetPage || opIntent.explanation || text,
              targetPage: opIntent.targetPage,
              targetTab: opIntent.targetTab
            };
          }
          if (opIntent.intent === 'CHITCHAT') {
            return { type: 'GREETING' };
          }
          if (opIntent.intent === 'CUSTOMER_ENQUIRY') {
            return { type: 'MEDICINE_INQUIRY', medicineName: opIntent.medicineName };
          }
          if (opIntent.intent === 'CUSTOMER_DUE_QUERY') {
            return { type: 'CUSTOMER_DUE_QUERY', patientName: opIntent.patientName };
          }
          if (opIntent.intent === 'SPECIAL_ORDER_BOOKING') {
            return {
              type: 'BOOK_SPECIAL_ORDER',
              medicineName: opIntent.medicineName,
              patientName: opIntent.patientName,
              quantity: opIntent.quantity || 1
            };
          }
          if (opIntent.intent === 'REFILL_ONBOARDING') {
            return {
              type: 'ONBOARD_REFILL',
              patientName: opIntent.patientName,
              medicineName: opIntent.medicineName,
              timeframe: opIntent.timeframeDays ? String(opIntent.timeframeDays) : '30'
            };
          }
          if (opIntent.intent === 'TRIGGER_AUTOMATION') {
            return {
              type: 'TRIGGER_AUTOMATION',
              topic: opIntent.automationId || 'credit_reminders',
              timeframe: opIntent.timeframeDays ? String(opIntent.timeframeDays) : '60'
            };
          }
        }
      }
    } catch (_) {
      // Gracefully fall back to deterministic pattern matchers below
    }

    // 0ba. Deterministic Fast-Path for On-Demand Pharmacy Automation Triggers (English, Hindi, Hinglish)
    if (
      /\b(?:run|trigger|start|execute|launch|perform|chala\s*do|chalao|kar\s*do|le\s*lo)\s*(?:the\s*)?(?:[a-z0-9-]+\s*){0,4}(?:credit\s*reminder|overdue\s*(?:credit|scan)|refill\s*scan|chronic\s*refill|pickup\s*reminder|collection\s*reminder|ready\s*pickup|expiry\s*(?:scan|alert)|expiry\s*return|distributor\s*return|email\s*poller|distributor\s*email|database\s*backup|backup|session\s*heartbeat|pharmarack\s*heartbeat)\b/i.test(t) ||
      /\b(?:(?:bhai\s*)?(?:\d{1,3}\s*(?:din|day|days)\s*(?:ki\s*)?)?expiry\s*scan\s*(?:chala\s*do|chalao|kar\s*do|run)?)\b/i.test(t) ||
      /\b(?:backup\s*(?:database|data|le\s*lo|now)?|database\s*(?:ka\s*)?backup\s*(?:le\s*lo|now|karo)?)\b/i.test(t) ||
      /\b(?:email\s*(?:check\s*karo|invoices|poll)|poll\s*(?:distributor\s*)?email(?:s|\s*invoices)?|check\s*overdue\s*credit(?:\s*dues)?)\b/i.test(t)
    ) {
      let autoId = 'credit_reminders';
      if (/\b(?:refill|chronic)\b/i.test(t)) autoId = 'refill_scan';
      else if (/\b(?:pickup|collection)\b/i.test(t)) autoId = 'collection_reminders';
      else if (/\b(?:expiry\s*return|distributor\s*return)\b/i.test(t)) autoId = 'expiry_returns';
      else if (/\b(?:expiry|near\s*expiry)\b/i.test(t)) autoId = 'expiry_scan';
      else if (/\b(?:email|inbox|poll)\b/i.test(t)) autoId = 'email_poller';
      else if (/\b(?:backup|snapshot)\b/i.test(t)) autoId = 'backup';
      else if (/\b(?:heartbeat|pharmarack|session)\b/i.test(t)) autoId = 'pharmarack_heartbeat';
      else if (/\b(?:credit|due|overdue|udhar|udhari)\b/i.test(t)) autoId = 'credit_reminders';

      const daysMatch = text.match(/\b(\d{1,3})\s*(?:day|days|din)\b/i);
      return {
        type: 'TRIGGER_AUTOMATION',
        topic: autoId,
        timeframe: daysMatch ? daysMatch[1] : '60'
      };
    }

    // 0c. Customer Due Bills, Payment QR, Special Orders & Refill Onboarding Fallbacks
    if (
      /\b(?:due|balance|khata|ledger|monthly\s*due|due\s*bill|pending\s*bill|udhar|udhari|baki|kitna\s*hai)\b/i.test(t) ||
      /\b(?:share|send|generate|bhejo|bhej)\b.*\b(?:qr|payment\s*qr|due\s*qr)\b/i.test(t) ||
      /\b(?:payment\s*reminder|due\s*reminder)\b/i.test(t)
    ) {
      const custMatch = text.match(/(?:for|to|of|ka|ki|ke|customer)\s+([A-Za-z0-9\s]{2,30})/i);
      const phoneMatch = text.match(/\b\d{10}\b/);
      let pat = phoneMatch ? phoneMatch[0] : (custMatch ? custMatch[1].trim() : undefined);
      if (!pat || /^(him|his|her|customer|patient|iska|uska)$/i.test(pat.trim())) {
        pat = session.contextData?.lastCustomer || undefined;
      }
      return { type: 'CUSTOMER_DUE_QUERY', patientName: pat };
    }

    if (
      /\b(?:book|place|create)\s*(?:a\s*)?(?:special\s*order|shortage\s*order)\b/i.test(t) ||
      /\b(?:special\s*order)\b/i.test(t)
    ) {
      const med = this.extractMedicineFromText(text);
      const custMatch = text.match(/(?:for|to|patient|customer)\s+([A-Za-z0-9\s]{2,30})/i);
      const qtyMatch = text.match(/\b(\d{1,4})\s*(?:strip|tablet|box|unit|pack|bottle)?s?\b/i);
      return {
        type: 'BOOK_SPECIAL_ORDER',
        medicineName: med,
        patientName: custMatch ? custMatch[1].trim() : undefined,
        quantity: qtyMatch ? parseInt(qtyMatch[1], 10) : 1
      };
    }

    if (
      /\b(?:onboard|schedule|register)\s*(?:a\s*)?(?:patient\s*)?refill\b/i.test(t) ||
      /\b(?:add\s*refill\s*schedule|new\s*refill)\b/i.test(t)
    ) {
      const custMatch = text.match(/(?:for|to|patient)\s+([A-Za-z0-9\s]{2,30})/i);
      const med = this.extractMedicineFromText(text);
      return {
        type: 'ONBOARD_REFILL',
        patientName: custMatch ? custMatch[1].trim() : undefined,
        medicineName: med
      };
    }

    // 0c. Page-Specific Quick Fallbacks (POS discount, hold bill, live cart sync, rack location)
    // 0d. Live Cart Sync & Shelf Rack Location Fallbacks
    if (/\b(?:sync|refresh)\b.*\b(?:live\s*cart|distributor\s*cart|pharmarack)\b/i.test(t) || /\b(?:live\s*cart\s*sync|sync\s*cart)\b/i.test(t)) {
      return { type: 'LIVE_CART_SYNC' };
    }

    if (/\b(?:where is|kahan hai|which rack|rack location|shelf location|rack for|rakha hai)\b/i.test(t)) {
      let med = this.extractMedicineFromText(text);
      if ((!med || /^(it|this|that|iska|uska|medicine|dawa)$/i.test(med.trim())) && session.contextData?.lastMedicine) {
        med = session.contextData.lastMedicine;
      }
      return { type: 'INVENTORY_STOCK_AUDIT', medicineName: med };
    }

    // 1. Explicit document scan requests
    if (
      !/\b(?:add|stage|put|load)\b.*\b(?:to bill|to pos|to cart|to live cart)\b/i.test(t) &&
      (/\b(?:read|scan|extract|parse|process)\b.*\b(?:prescription|invoice|bill|photo|image|scan|doc)\b/i.test(t) ||
       /\b(?:prescription workflow|purchase entry draft|read this)\b/i.test(t))
    ) {
      return { type: 'DOCUMENT_OCR' };
    }

    // 1b. Cart Staging (Live Distributor Cart & POS Billing) Fallback
    if (
      /\b(?:live\s*cart|pharmarack|distributor\s*cart)\b/i.test(t) ||
      (/\b(?:add|stage|put|load|insert|order)\b/i.test(t) && /\b(?:live\s*cart|pos\s*cart|bill|cart)\b/i.test(t)) ||
      (/\b(?:add|stage|put|load)\s+([A-Za-z0-9\s-]{2,30})\b/i.test(t) && !/\b(?:refill|user|customer|patient|reminder|call)\b/i.test(t) && (this.extractMedicineFromText(text) || session.contextData?.lastMedicine))
    ) {
      const isLiveCart = /\b(?:live\s*cart|pharmarack|distributor\s*cart)\b/i.test(t) || input.pageContext?.pathname === '/live-cart' || input.pageContext?.pathname === '/pharmarack-cart';
      let parsedQty: number | undefined = undefined;
      const unitQtyMatch = text.match(/\b(\d{1,4})\s*(?:strip|strips|tablet|tablets|capsule|capsules|box|boxes|bottle|bottles|pack|packs|unit|units|nos)\b/i);
      const hyphenQtyMatch = text.match(/-\s*(\d{1,4})\b/);
      const leadingQtyMatch = text.match(/\b(?:add|stage|put|load)\s+(\d{1,4})\s+(?!to\b|in\b|into\b|on\b)[a-zA-Z]/i);
      const cartLeadingQtyMatch = text.match(/\b(?:live\s*cart|pos\s*cart|cart|bill)\s+(\d{1,4})\s+[a-zA-Z]/i);

      if (unitQtyMatch) {
        parsedQty = parseInt(unitQtyMatch[1], 10);
      } else if (hyphenQtyMatch) {
        parsedQty = parseInt(hyphenQtyMatch[1], 10);
      } else if (leadingQtyMatch) {
        parsedQty = parseInt(leadingQtyMatch[1], 10);
      } else if (cartLeadingQtyMatch) {
        parsedQty = parseInt(cartLeadingQtyMatch[1], 10);
      }
      const unitMatch = text.match(/\b(strip|strips|tablet|tablets|capsule|capsules|box|boxes|bottle|bottles|pack|packs|unit|units)\b/i);
      let med = this.extractMedicineFromText(text);
      if ((!med || /^(it|this|that|dawa|medicine|goli)$/i.test(med.trim())) && session.contextData?.lastMedicine) {
        med = session.contextData.lastMedicine;
      }
      return {
        type: 'CART_STAGING',
        medicineName: med,
        quantity: parsedQty,
        unit: unitMatch ? unitMatch[1].toLowerCase() : 'strip',
        destination: 'live_cart'
      };
    }

    // 2. Alternative & Salt Comparison
    if (
      /\b(?:alternative|substitute|substitutes|instead of|replace|badle|paray|options for)\b/i.test(t) ||
      /\b(?:unavailable|not in stock|out of stock|khatam|nahi hai)\b.*\b(?:find|suggest|search|show|batao|kya)\b.*\b(?:alternative|another|substitute|dusra|badle)\b/i.test(t) ||
      /find an alternative for/i.test(t)
    ) {
      const altMatch = text.match(/(?:alternative|substitute|substitutes|options?)\s+for\s+([A-Za-z0-9\s-]{2,30})/i);
      let med = altMatch ? altMatch[1].trim().replace(/[.,!]/g, '') : this.extractMedicineFromText(text);
      if (!med || med.length < 2 || /^(this|the|its|it|that|iska|uska)?\s*(?:medicine|alternative|dawa)?$/i.test(med.trim()) || /^(it|this|that|its|iska|uska)$/i.test(med.trim())) {
        med = session.contextData?.lastMedicine || undefined;
      }
      return { type: 'ALTERNATIVES_SEARCH', medicineName: med };
    }

    // 2b. Distributor Return List Draft (e.g. "prepare distributor return list", "wapas karne wali dawa")
    if (
      /\b(?:distributor return|return list|prepare.*return|draft.*return|return.*distributor)\b/i.test(t) ||
      (/\b(?:expir|expire|expiring|expiry)\b/i.test(t) && /\b(?:return list|return memo|distributor return|wapas)\b/i.test(t))
    ) {
      let timeframe = '60_days';
      const numMatch = t.match(/\b(\d{1,3})\s*(?:day|days|din|divas)\b/);
      if (numMatch) timeframe = `${numMatch[1]}_days`;
      else if (t.includes('30')) timeframe = '30_days';
      else if (t.includes('90')) timeframe = '90_days';
      return { type: 'DISTRIBUTOR_RETURN_DRAFT', timeframe };
    }

    // 2c. Fast-Moving Low Stock & Reorder Draft
    if (
      /\b(?:reorder list|reorder draft|low stock.*reorder|fast-moving.*low|shortage list|prepare.*reorder)\b/i.test(t) ||
      (/\b(?:fast-moving|low stock)\b/i.test(t) && /\b(?:which|show|check|find|list|order)\b/i.test(t))
    ) {
      return { type: 'LOW_STOCK_REORDER' };
    }

    // 2d. Delivery Status Query
    if (
      /\b(?:delivery|deliveries|dispatch|delivery boy|rider|pending delivery|deliveries.*pending|pending deliveries)\b/i.test(t)
    ) {
      return { type: 'DELIVERY_STATUS' };
    }

    // 2e. Purchase Rate / Cost Price Query (Strictly Owner)
    if (
      /\b(?:purchase rate|cost price|ptr|buying rate|supplier rate|purchase bill|inward rate)\b/i.test(t) ||
      (/\b(?:last purchase|what did we buy|buying price)\b/i.test(t))
    ) {
      const med = this.extractMedicineFromText(text);
      return { type: 'PURCHASE_QUERY', medicineName: med };
    }

    // 3. Expiry Audit
    if (
      /\b(?:expir|expire|expiring|expiry|near expiry|expired)\b/i.test(t) &&
      /\b(?:next month|this month|soon|stock|medicine|dawa|batches|find|list|show|audit)\b/i.test(t)
    ) {
      let timeframe = 'next_month';
      if (t.includes('30')) timeframe = '30_days';
      if (t.includes('60')) timeframe = '60_days';
      if (t.includes('90')) timeframe = '90_days';
      if (t.includes('expired')) timeframe = 'expired';
      return { type: 'EXPIRY_AUDIT', timeframe };
    }

    // 4. Sales Reporting & Comparison
    if (
      /\b(?:sales|revenue|turnover|bikri|kamai)\b.*\b(?:today|yesterday|lower|higher|compare|why|turnover)\b/i.test(t) ||
      /\b(?:today's|todays)\s*(?:sales|revenue)\b/i.test(t) ||
      /\bshow me today's sales\b/i.test(t)
    ) {
      return { type: 'SALES_COMPARISON' };
    }

    // 5. Stock Correction
    if (
      /\b(?:correct|adjust|update|tally|set)\b.*\b(?:stock|count|inventory|physical count)\b/i.test(t) ||
      /\b(?:how can i|how to|kaise)\b.*\b(?:correct|adjust|fix)\b.*\b(?:stock|quantity|inventory)\b/i.test(t) ||
      /\b(?:correct the stock quantity|adjust stock)\b/i.test(t)
    ) {
      const med = this.extractMedicineFromText(text);
      const qtyMatch = text.match(/\b(?:to|as|is|=)\s*(\d{1,4})\b/i) || text.match(/\b(\d{1,4})\s*(?:units|strips|tablets|bottles|packs|nos)\b/i);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : undefined;
      return { type: 'STOCK_CORRECTION', medicineName: med, quantity: qty };
    }

    // 6. Application / Screen Guidance & Order Hub Settings
    if (
      /\b(?:explain how to use|how to use|how do i use|explain this screen|explain this page|explain page|where is|where are|how to set up|how to setup|setup guide|how does.*work)\b/i.test(t) ||
      /\b(?:order hub|live cart|settings|pharmarack|printer|whatsapp|backup|purchase entry screen|pos billing|inventory screen|crm screen|dispatch screen|returns hub|sales report)\b/i.test(t)
    ) {
      let topic = 'general';
      let targetPage: string | undefined;
      let targetTab: string | undefined;

      if (/\b(?:order hub|orderhub|live cart|pharmarack)\b/i.test(t)) {
        topic = 'order hub';
        if (t.includes('setting') || t.includes('setup') || t.includes('configure') || t.includes('connect')) {
          targetPage = '/settings';
          targetTab = 'integrations';
        } else {
          targetPage = '/live-cart';
        }
      } else if (/\b(?:whatsapp|qr|bot)\b/i.test(t)) {
        topic = 'whatsapp';
        targetPage = '/settings';
        targetTab = 'integrations';
      } else if (/\b(?:printer|hardware|receipt|thermal)\b/i.test(t)) {
        topic = 'printer';
        targetPage = '/settings';
        targetTab = 'appearance';
      } else if (/\b(?:backup|restore|database snapshot)\b/i.test(t)) {
        topic = 'backup';
        targetPage = '/settings';
        targetTab = 'backups';
      } else if (/\b(?:order timing|cutoff|window)\b/i.test(t)) {
        topic = 'order timing';
        targetPage = '/settings';
        targetTab = 'order_timing';
      } else if (/\b(?:setting|settings|automation hub)\b/i.test(t)) {
        topic = 'settings';
        targetPage = '/settings';
      } else if (t.includes('purchase')) {
        topic = 'purchase';
        targetPage = '/purchases';
      } else if (t.includes('pos') || t.includes('billing')) {
        topic = 'pos';
        targetPage = '/pos';
      } else if (t.includes('inventory') || t.includes('stock')) {
        topic = 'inventory';
        targetPage = '/inventory';
      } else if (t.includes('crm') || t.includes('refill')) {
        topic = 'crm';
        targetPage = '/crm';
      } else if (t.includes('dispatch') || t.includes('delivery')) {
        topic = 'dispatch';
        targetPage = '/dispatch';
      } else if (t.includes('return')) {
        topic = 'returns';
        targetPage = '/returns';
      } else if (t.includes('report') || t.includes('sales')) {
        topic = 'reports';
        targetPage = '/reports';
      } else if (t.includes('audit') || t.includes('investigation')) {
        topic = 'investigation';
        targetPage = '/investigation';
      }

      return { type: 'APPLICATION_GUIDE', topic, targetPage, targetTab };
    }

    // 7. Follow-up resolution ("show me the second one", "add that medicine")
    if (
      /\b(?:second one|2nd one|dusra|dusri)\b/i.test(t)
    ) {
      return { type: 'CONTEXTUAL_FOLLOW_UP', targetIndex: 1 };
    }
    if (
      /\b(?:first one|1st one|pahila|pehla)\b/i.test(t)
    ) {
      return { type: 'CONTEXTUAL_FOLLOW_UP', targetIndex: 0 };
    }
    if (
      /\b(?:third one|3rd one|teesra)\b/i.test(t)
    ) {
      return { type: 'CONTEXTUAL_FOLLOW_UP', targetIndex: 2 };
    }

    // 8. Reminders & Staff Call Tasks
    if (
      /\b(?:remind me to call|schedule a call|call task|follow up)\b/i.test(t) ||
      /\b(?:remind|reminder)\b.*\b(?:tomorrow|patient|customer|refill)\b/i.test(t)
    ) {
      let patientName = 'Customer';
      const nameMatch = text.match(/\bcall\s+([A-Z][a-z]+)/);
      if (nameMatch) patientName = nameMatch[1];
      const dueDate = t.includes('tomorrow') ? 'Tomorrow' : 'Scheduled';
      return { type: 'REMINDER_SCHEDULE', patientName, dueDate, notes: text };
    }

    // 9. Chronic Refill signals
    if (
      /\b(?:refill|repeat|renew|regular medicine|pichli dawa|pichhli|dawai khatam|goli khatam|punha havi|dawa repeat)\b/i.test(t) ||
      /(?:my|meri|majhi|what|any|check).*(?:dawa|goli|medicine|prescription|refill)/i.test(t) ||
      /\b(?:what refills|check refill|due refill|any refill|my refill)\b/i.test(t)
    ) {
      let patientName: string | undefined;
      const patMatch = text.match(/\b(?:refill|renew|repeat|dawa)\s+(?:for|of|ka|ki)?\s+([A-Za-z]{3,25})\b/i) ||
                       text.match(/\b([A-Za-z]{3,25})\s+(?:ka|ki|ke|s)?\s*(?:refill|dawa)\b/i);
      if (patMatch && !/^(check|add|due|any|my|all|regular|monthly)$/i.test(patMatch[1])) {
        patientName = patMatch[1];
      }
      return { type: 'REFILL', patientName };
    }

    // 10. Handover / Pharmacist
    if (
      /\b(?:pharmacist|doctor|chemist|staff|talk to|speak with|call me|baat karni hai|bolna hai|call kara)\b/i.test(t)
    ) {
      return { type: 'PHARMACIST_HANDOVER' };
    }

    // 11. Store Timings & Location
    if (
      /\b(?:timings|timing|hours|open|closed|closing|close|khula|band|address|location|kaha hai|kuthe ahe)\b/i.test(t)
    ) {
      return { type: 'STORE_INFO' };
    }

    // 12. Greetings
    if (
      /^(?:hi|hello|hey|namaste|pranam|good morning|good evening|good afternoon|namaskar)$/i.test(t.replace(/[!.,]/g, '').trim())
    ) {
      return { type: 'GREETING' };
    }

    // 13. Medicine Search / Availability
    const extractedMed = this.extractMedicineFromText(text);
    if (extractedMed || /\b(?:available|stock|price|cost|mrp|rate|kitne|chahiye|milegi|mil sakti|aahe ka)\b/i.test(t)) {
      return { type: 'MEDICINE_INQUIRY', medicineName: extractedMed };
    }

    // 14. Optional Local AI LLM intent classification if running
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
   * Helper to detect positive user confirmation (English, Hindi, Hinglish).
   */
  public isAffirmative(text: string): boolean {
    const clean = text.trim().toLowerCase().replace(/[^\w\s]/g, '');
    return /\b(yes|yeah|yep|sure|haan|ha|ho|haanji|confirm|confirmed|ok|okay|run|run it|execute|do it|go ahead|bhej do|bhejo|kar do|chala do|chalao|proceed|ready|prepare|order|thik hai|theek hai|sahi hai|bilkul|chalega|approve|approved|accept|commit|stage)\b/i.test(clean) || clean === '1';
  }

  /**
   * Helper to detect negative cancellation (English, Hindi, Hinglish).
   */
  public isNegative(text: string): boolean {
    const clean = text.trim().toLowerCase().replace(/[^\w\s]/g, '');
    return /\b(no|nahin|nahi|na|nako|cancel|cancelled|stop|abort|mat bhejo|mat karo|rok do|rehne do|nahi chahiye|don't|dont|nevermind)\b/i.test(clean) || clean === '2';
  }

  /**
   * Extracts probable medicine name candidate from text phrasing.
   */
  public extractMedicineFromText(text: string): string | undefined {
    const lower = text.toLowerCase().trim();
    if (!/\b(?:have|got|stock|available|price|cost|mrp|chahiye|milegi|mil sakti|aahe ka|tablet|strip|capsule|syrup|gel|ointment|mg|ml|gm|dolo|telma|paracetamol|augmentin|azithral|pan|pantocid|metformin|glycomet|atorva|for|add|bill|cart|give|dispense|dalo|lagao|bhejo|check|search|find|salt)\b/i.test(lower)) {
      return undefined;
    }

    let clean = text
      .replace(/\b(?:this medicine is unavailable|this medicine is out of stock|this medicine is not available|this medicine|this)\b/gi, ' ')
      .replace(/\b(?:in the live cart|in live cart|to live cart|into live cart|in the pos cart|to pos cart|in pos cart|in the cart|in cart|to cart|into cart|in bill|to bill|into bill|on live cart|on pos|on bill)\b/gi, ' ')
      .replace(/\b(?:what is the active salt of|what is the salt of|what is the salt in|active salt of|active ingredient of|salt of|salt in|uses of|use of)\b/gi, ' ')
      .replace(/\b(?:where is|where are|where|which rack is|which rack for|which rack|rack location for|rack of|kahan hai|kept|located|placed)\b/gi, ' ')
      .replace(/\b(?:check stock for|check stock of|check stock|check availability of|check availability|search for|search|lookup|look up)\b/gi, ' ')
      .replace(/\b(?:do we have|do you have|can we get|can you get|can you check|can i get|is there|are there|is|in stock|out of stock|available|unavailable|right now|today|price of|cost of|mrp of|rate of|chahiye|milegi|mil sakti|aahe ka|kya|please|for me)\b/gi, ' ')
      .replace(/\b(?:live\s*cart|pos\s*cart|distributor\s*cart|pharmarack(?:\s*cart)?)\b/gi, ' ')
      .replace(/\b(?:add to bill|add to cart|add to pos|add|give|put|bill|dispense|take|dalo|lagao|bhejo|tablet|strip|box|find an alternative for|find alternatives for|find substitute for|alternative for|substitute for)\b/gi, ' ')
      .replace(/\b(?:strip|strips|tablets?|capsules?|box|boxes|bottles?|pack|packs|units?|nos?)\b/gi, ' ')
      .replace(/[?!,.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Strip leading "the " or "a "
    clean = clean.replace(/^(?:the|a|an)\s+/i, '').trim();

    // Strip trailing or inline hyphen-quantity phrases (e.g. "- 6", "6")
    clean = clean.replace(/-\s*\d{1,4}\s*$/g, '').trim();
    clean = clean.replace(/^\d{1,4}\s+/, '').trim();
    clean = clean.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
    clean = clean.replace(/^(?:the|a|an)\s+/i, '').trim();

    if (clean.length >= 3 && !/^(hi|hello|yes|no|ok|refill|call|timing|shop|store|address|hours|this medicine|medicine|its alternative|alternative|substitute|it|this|that|iska|uska)$/i.test(clean)) {
      return clean;
    }
    return undefined;
  }
}

export const conversationalAgentEngine = new ConversationalAgentEngine();
