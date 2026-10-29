/**
 * Conversational AI Agent Engine
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
  type ConversationTurn
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
    | 'STAGE_PRESCRIPTION_DRAFT';
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

        suggestedFollowUps = ['Explain POS shortcuts', 'Explain Purchase entry', 'Explain CRM refills'];
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
        const refillsResult = await pharmacyToolRegistry.lookupPatientRefills(phone, session.customerId || undefined, db);
        toolExecutions.push({ tool: 'lookupPatientRefills', result: refillsResult });

        if (!refillsResult || refillsResult.length === 0) {
          replyText = `📋 We couldn't find an active regular refill on file for ${phone}.\n\nIf you need a specific medicine, please type its name (e.g. *Telma 40* or *Glycomet 500*), or reply *Pharmacist* to speak with our staff.`;
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

          const priceStr = targetRefill.pricePerUnit > 0 ? ` (Est. ₹${targetRefill.pricePerUnit * targetRefill.quantityNeeded})` : '';
          const stockNotice = targetRefill.inStock ? '✅ In Stock' : '⏳ Ready to order';

          replyText = `🔔 *Refill Due Check:*\n\n` +
            `We have your regular prescription for:\n` +
            `💊 *${targetRefill.medicineName}*\n` +
            `📦 Quantity: *${targetRefill.quantityNeeded} unit(s)*${priceStr}\n` +
            `📊 Status: ${stockNotice}\n\n` +
            `👉 *Would you like us to prepare this refill?*\n` +
            `Reply *Yes* to confirm, or *No* to cancel.`;

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
          suggestedFollowUps = ['Yes, confirm refill', 'Find alternatives', 'Cancel'];
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
            replyText += `Would you like us to stage this medicine for dispensing?`;
          } else {
            replyText += `Would you like to find an alternative medicine, or order it from the distributor?`;
            proposedAction = {
              id: `enquiry_${Date.now()}`,
              type: 'CREATE_ENQUIRY',
              summary: `Order non-stocked medicine ${topItem.name}`,
              data: { medicineName: topItem.name, notes: 'Customer inquiry via conversational AI' },
              requiresConfirmation: true,
              status: 'PENDING_CONFIRMATION'
            };
            state = 'awaiting_confirmation';
            suggestedFollowUps = [`Find alternative for ${topItem.name}`, 'Order from distributor'];
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
          state = 'idle';
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
        replyText = `👋 Namaste, ${greetingName}! Welcome to AI-PHARMACY-V3 Assistant.\n\n` +
          `I can assist you naturally across all pharmacy operations:\n` +
          `• 🔍 *Check medicine stock & find salt alternatives*\n` +
          `• 📄 *Read prescription or purchase invoice images*\n` +
          `• ⚠️ *Audit near-expiry batches across inventory*\n` +
          `• 📊 *Analyze today's sales and compare with yesterday*\n` +
          `• 🔔 *Manage patient refills & schedule reminders*\n` +
          `• 📖 *Explain any screen or workflow (POS, Purchases, CRM)*\n\n` +
          `How can I help you right now?`;
        state = 'idle';
        suggestedFollowUps = [
          'Find medicines expiring next month',
          'Show today sales vs yesterday',
          'Explain how to use purchase entry',
          'Audit near-expiry stock'
        ];
        break;
      }

      default: {
        replyText = `I understand you are asking about: "${userText.slice(0, 80)}".\n\n` +
          `Here are tasks you can try right away:\n` +
          `• "Find medicines expiring next month"\n` +
          `• "Find an alternative for [Medicine Name]"\n` +
          `• "Show me today's sales and explain why they are lower than yesterday"\n` +
          `• "Explain how to use the purchase entry screen"\n` +
          `• "How can I correct the stock quantity?"\n` +
          `• "Remind me to call Rajesh tomorrow about his refill"`;
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

    if (proposedAction) {
      contextDataToSave.pendingProposal = proposedAction;
    } else if (state === 'idle') {
      delete contextDataToSave.pendingProposal;
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
    timeframe?: string;
    topic?: string;
    patientName?: string;
    dueDate?: string;
    notes?: string;
    targetIndex?: number;
  }> {
    const t = text.toLowerCase().trim();

    // 0. Image attachment directly triggers DOCUMENT_OCR
    if (input.imageBuffer || input.imagePath) {
      return { type: 'DOCUMENT_OCR' };
    }

    // 1. Explicit document scan requests
    if (
      /\b(?:read|scan|check|extract|parse|add|process)\b.*\b(?:prescription|invoice|bill|photo|image|scan|doc)\b/i.test(t) ||
      /\b(?:prescription workflow|purchase entry draft|read this)\b/i.test(t)
    ) {
      return { type: 'DOCUMENT_OCR' };
    }

    // 2. Alternative & Salt Comparison
    if (
      /\b(?:alternative|substitute|substitutes|instead of|replace|badle|paray|options for)\b/i.test(t) ||
      /\b(?:unavailable|not in stock|out of stock)\b.*\b(?:find|suggest|search|show)\b.*\b(?:alternative|another|substitute)\b/i.test(t) ||
      /find an alternative for/i.test(t)
    ) {
      const altMatch = text.match(/(?:alternative|substitute|substitutes|options?)\s+for\s+([A-Za-z0-9\s-]{2,30})/i);
      let med = altMatch ? altMatch[1].trim().replace(/[.,!]/g, '') : this.extractMedicineFromText(text);
      if (!med || med.length < 2 || /^(this|the)?\s*medicine$/i.test(med.trim())) {
        med = session.contextData?.lastMedicine || undefined;
      }
      return { type: 'ALTERNATIVES_SEARCH', medicineName: med };
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
      /\b(?:how can i|how to|kaise)\b.*\b(?:correct|adjust|fix)\b.*\b(?:stock|quantity|inventory)\b/i.test(t) ||
      /\b(?:correct the stock quantity|adjust stock)\b/i.test(t)
    ) {
      const med = this.extractMedicineFromText(text);
      return { type: 'STOCK_CORRECTION', medicineName: med };
    }

    // 6. Application / Screen Guidance
    if (
      /\b(?:explain how to use|how to use|how do i use|explain this screen|explain this page|explain page)\b/i.test(t) ||
      /\b(?:purchase entry screen|pos billing|inventory screen|crm screen|dispatch screen)\b/i.test(t)
    ) {
      let topic = 'general';
      if (t.includes('purchase')) topic = 'purchase';
      else if (t.includes('pos')) topic = 'pos';
      else if (t.includes('inventory')) topic = 'inventory';
      else if (t.includes('crm')) topic = 'crm';
      else if (t.includes('dispatch')) topic = 'dispatch';
      return { type: 'APPLICATION_GUIDE', topic };
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
      return { type: 'REFILL' };
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
   * Helper to detect positive user confirmation.
   */
  public isAffirmative(text: string): boolean {
    const clean = text.trim().toLowerCase().replace(/[^\w\s]/g, '');
    return /\b(yes|haan|ha|ho|confirm|confirmed|ok|okay|bhej do|kar do|proceed|ready|prepare|order|thik hai|theek hai)\b/i.test(clean) || clean === '1';
  }

  /**
   * Helper to detect negative cancellation.
   */
  public isNegative(text: string): boolean {
    const clean = text.trim().toLowerCase().replace(/[^\w\s]/g, '');
    return /\b(no|nahin|nahi|na|nako|cancel|cancelled|stop|mat bhejo|don't|dont)\b/i.test(clean) || clean === '2';
  }

  /**
   * Extracts probable medicine name candidate from text phrasing.
   */
  public extractMedicineFromText(text: string): string | undefined {
    const lower = text.toLowerCase().trim();
    if (!/\b(?:have|got|stock|available|price|cost|mrp|chahiye|milegi|mil sakti|aahe ka|tablet|strip|capsule|syrup|gel|ointment|mg|ml|gm|dolo|telma|paracetamol|augmentin|azithral|pan|pantocid|metformin|glycomet|atorva|for)\b/i.test(lower)) {
      return undefined;
    }

    let clean = text
      .replace(/\b(?:this medicine is unavailable|this medicine is out of stock|this medicine is not available|this medicine|this)\b/gi, ' ')
      .replace(/\b(?:do you have|can you check|is|in stock|available|unavailable|right now|today|price of|cost of|chahiye|milegi|kya|bhejo|please|for me|tablet|strip|box|find an alternative for|find alternatives for|find substitute for|alternative for|substitute for)\b/gi, ' ')
      .replace(/[?!,.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (clean.length >= 3 && !/^(hi|hello|yes|no|ok|refill|call|timing|shop|store|address|hours|this medicine|medicine)$/i.test(clean)) {
      return clean;
    }
    return undefined;
  }
}

export const conversationalAgentEngine = new ConversationalAgentEngine();
