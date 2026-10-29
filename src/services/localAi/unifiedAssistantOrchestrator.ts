/**
 * Unified Pharmacy Operations Assistant Orchestrator
 *
 * Serves as a conversational control layer over existing application subsystems:
 * - CRM & Patient records (customers, contacts)
 * - Refills & Repeat orders (patient_refills, refillOrderReconciler)
 * - Tasks, Reminders & Follow-ups (patient_call_tasks)
 * - Customer enquiries (medicine_enquiries)
 * - WhatsApp chat management & draft replies (whatsapp_chats, whatsappQueue)
 * - OCR prescription & packaging assistance (prescription_scans)
 * - Authoritative inventory, pricing & POS integration (medicines, inventory_master)
 *
 * Safety & Security Guarantees:
 * - Role-based isolation: Customer sessions CANNOT execute staff operational actions.
 * - Two-Stage Confirmation Gate: Consequential actions (send message, create task, complete task)
 *   require explicit operator approval before execution.
 * - Non-destructive: Does NOT create parallel tables or duplicate data stores.
 * - Zero hallucination: Stock, prices, and records are retrieved strictly from SQLite.
 * - Full audit trail: Every executed action is logged in action_logs via logMutationAudit.
 */

import { dbManager } from '../../database/connection.js';
import { logMutationAudit } from '../auditLoggerService.js';
import { pharmacyKnowledgeRetriever } from './pharmacyKnowledgeRetriever.js';
import { pharmacyQaEngine } from './pharmacyQaEngine.js';
import { queryLocalAiIntent, isLocalAiEnabled, checkLlamaServerHealth } from './llamaServerClient.js';
import { eventService } from '../eventService.js';
import { validate10DigitPhone } from '../../utils/phoneValidation.js';

export type AssistantRole = 'owner' | 'staff' | 'customer';

export type AssistantActionType =
  | 'LIST_REFILLS'
  | 'PREPARE_REFILL'
  | 'LIST_TASKS'
  | 'CREATE_TASK'
  | 'COMPLETE_TASK'
  | 'RESCHEDULE_TASK'
  | 'LIST_ENQUIRIES'
  | 'CREATE_ENQUIRY'
  | 'LIST_WHATSAPP_CHATS'
  | 'DRAFT_WHATSAPP_REPLY'
  | 'SEND_WHATSAPP_MESSAGE'
  | 'INSPECT_OCR'
  | 'SEARCH_INVENTORY'
  | 'VIEW_PURCHASE_RATES'
  | 'VIEW_MARGINS'
  | 'QUERY_SALES_METRICS'
  | 'AUDIT_EXPIRY'
  | 'GENERAL_QA';

export type ActionStatus = 'NONE' | 'PENDING_CONFIRMATION' | 'EXECUTED' | 'CANCELLED' | 'FAILED';

export interface ProposedAction {
  id: string;
  actionType: AssistantActionType;
  description: string;
  payload: Record<string, any>;
  requiresConfirmation: boolean;
  status: ActionStatus;
  createdAt: string;
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

export interface AssistantResponse {
  sessionId: string;
  query: string;
  reply: string;
  actionType: AssistantActionType;
  proposedAction?: ProposedAction;
  cards?: AssistantCardItem[];
  latencyMs: number;
  suggestedFollowUps?: string[];
  requiresConfirmation?: boolean;
}

export interface AssistantSessionContext {
  sessionId: string;
  role: AssistantRole;
  userId?: number;
  username?: string;
  storeId?: number;
  language?: 'en' | 'hi' | 'mr' | 'hinglish';
  lastAction?: AssistantActionType;
  lastEntityId?: string | number;
  lastEntityName?: string;
  pendingProposals?: Map<string, ProposedAction>;
}

// In-memory session context storage
const sessionStore = new Map<string, AssistantSessionContext>();

export class UnifiedAssistantOrchestrator {
  /**
   * Retrieves or initializes session context
   */
  public getOrCreateSession(sessionId: string, role: AssistantRole = 'staff', extra: Partial<AssistantSessionContext> = {}): AssistantSessionContext {
    let session = sessionStore.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        role,
        storeId: extra.storeId || 1,
        username: extra.username || (role === 'staff' ? 'Staff' : 'Customer'),
        userId: extra.userId,
        language: extra.language || 'en',
        pendingProposals: new Map<string, ProposedAction>()
      };
      sessionStore.set(sessionId, session);
    }
    return session;
  }

  public getSessionContext(
    sessionId: string,
    role: AssistantRole = 'staff',
    language?: 'en' | 'hi' | 'mr' | 'hinglish'
  ): AssistantSessionContext {
    return this.getOrCreateSession(sessionId, role, { language });
  }

  public clearSession(sessionId: string): void {
    sessionStore.delete(sessionId);
  }

  /**
   * Main entry point for processing a natural language operational command or conversation
   */
  public async processCommand(
    rawText: string,
    sessionOrId: string | AssistantSessionContext,
    options: {
      role?: AssistantRole;
      userId?: number;
      username?: string;
      storeId?: number;
      language?: 'en' | 'hi' | 'mr' | 'hinglish';
      dbInstance?: any;
    } = {}
  ): Promise<AssistantResponse> {
    const startTime = performance.now();
    const text = (rawText || '').trim();
    let session: AssistantSessionContext;
    let sessionId: string;

    if (typeof sessionOrId === 'object' && sessionOrId !== null) {
      session = sessionOrId;
      sessionId = session.sessionId;
    } else {
      sessionId = sessionOrId;
      const role = options.role || 'staff';
      session = this.getOrCreateSession(sessionId, role, options);
    }

    const db = options.dbInstance || (await dbManager.getConnection());

    if (!text) {
      return {
        sessionId,
        query: text,
        reply: 'How can I assist you with pharmacy operations today?',
        actionType: 'GENERAL_QA',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    // 1. Role-Based Security Gate: Customer role blocked from internal operational tools
    if (session.role === 'customer') {
      return this.handleCustomerQuery(text, session, db, startTime);
    }

    // 2. Staff Command Intent Classification (Multi-lingual)
    const lower = text.toLowerCase();
    const actionType = this.classifyStaffIntent(lower, session);

    // 3. Dispatch to deterministic service handlers
    let result: AssistantResponse;
    switch (actionType) {
      case 'LIST_REFILLS':
        result = await this.handleListRefills(text, session, db, startTime);
        break;
      case 'PREPARE_REFILL':
        result = await this.handlePrepareRefill(text, session, db, startTime);
        break;
      case 'LIST_TASKS':
        result = await this.handleListTasks(text, session, db, startTime);
        break;
      case 'CREATE_TASK':
        result = await this.handleCreateTask(text, session, db, startTime);
        break;
      case 'COMPLETE_TASK':
        result = await this.handleCompleteTask(text, session, db, startTime);
        break;
      case 'LIST_ENQUIRIES':
        result = await this.handleListEnquiries(text, session, db, startTime);
        break;
      case 'CREATE_ENQUIRY':
        result = await this.handleCreateEnquiry(text, session, db, startTime);
        break;
      case 'LIST_WHATSAPP_CHATS':
        result = await this.handleListWhatsAppChats(text, session, db, startTime);
        break;
      case 'DRAFT_WHATSAPP_REPLY':
        result = await this.handleDraftWhatsAppReply(text, session, db, startTime);
        break;
      case 'SEND_WHATSAPP_MESSAGE':
        result = await this.handleSendWhatsAppMessage(text, session, db, startTime);
        break;
      case 'INSPECT_OCR':
        result = await this.handleInspectOcr(text, session, db, startTime);
        break;
      case 'SEARCH_INVENTORY':
        result = await this.handleSearchInventory(text, session, db, startTime);
        break;
      case 'VIEW_PURCHASE_RATES':
        result = await this.handleViewPurchaseRates(text, session, db, startTime);
        break;
      case 'VIEW_MARGINS':
        result = await this.handleViewMargins(text, session, db, startTime);
        break;
      case 'QUERY_SALES_METRICS':
        result = await this.handleQuerySalesMetrics(text, session, db, startTime);
        break;
      case 'AUDIT_EXPIRY':
        result = await this.handleAuditExpiry(text, session, db, startTime);
        break;
      case 'GENERAL_QA':
      default:
        result = await this.handleGeneralQa(text, session, db, startTime);
        break;
    }

    // Update conversation context memory
    session.lastAction = result.actionType;
    return result;
  }

  /**
   * Classifies staff operational intent across English, Hindi, Marathi, Hinglish
   */
  private classifyStaffIntent(lower: string, session: AssistantSessionContext): AssistantActionType {
    // 1. Task Completion
    if (
      /(?:complete|finish|mark done|done|khatam|झाले|पूर्ण करा).*(?:task|call|reminder|टास्क)/i.test(lower) ||
      /(?:mark|mark as)?.*(?:task|call|reminder|टास्क).*(?:complete|completed|done|finish)/i.test(lower)
    ) {
      return 'COMPLETE_TASK';
    }

    // Follow-up: "Mark it complete" after viewing tasks
    if (session.lastAction === 'LIST_TASKS' && /(?:complete|done|finish|mark done|झाले|झाला)/i.test(lower)) {
      return 'COMPLETE_TASK';
    }

    // 2. Task Creation
    if (
      /(?:create|add|set|schedule|bana do|karo|तयार करा|नवा)\s+.*(?:task|reminder|callback|call|follow-up|follow up|टास्क|कॉल)/i.test(lower) ||
      /(?:call task|task|reminder)\s+for\s+[a-z]+/i.test(lower)
    ) {
      return 'CREATE_TASK';
    }

    // 3. Task Listing
    if (
      /(?:task|tasks|reminders|callbacks|टास्क|कॉल यादी).*(?:list|show|dikhao|batao|daakhva|pending|overdue|upcoming|दिखाओ|दाखवा|सांगा)/i.test(lower) ||
      /(?:\b(?:overdue|upcoming|pending|list|show|all|open)\b|पेंडिंग|सर्व).*(?:task|tasks|reminders|call tasks?|टास्क)/i.test(lower) ||
      /^(?:tasks?|टास्क)$/i.test(lower)
    ) {
      return 'LIST_TASKS';
    }

    // 4. Refills - Prepare
    if (
      /(?:prepare|order|process|stage|ready|banao|kar do|करा|तयार करा).*(?:refill|रिफिल)/i.test(lower) ||
      /(?:refill|रिफिल).*(?:prepare|order|process|stage|ready|banao|kar do|करा|तयार करा)/i.test(lower)
    ) {
      return 'PREPARE_REFILL';
    }

    // Follow-up context: "Prepare this refill" or "Order it"
    if (session.lastAction === 'LIST_REFILLS' && /(?:prepare|process|ready|order|ye wala|this one|banao|kar do|तयार करा)/i.test(lower)) {
      return 'PREPARE_REFILL';
    }

    // 5. Refills - List
    if (
      /(?:\b(?:pending|today'?s|all|list|upcoming|show|due|check)\b|aaj ke|आज|आजचे).*(?:refill|refills|रिफिल|रिपीट)/i.test(lower) ||
      /(?:refill|refills|रिफिल|रिपीट).*(?:list|yaadi|dikhao|show|batao|daakhva|ahet ka|pending|status|due|दिखाओ|दाखवा)/i.test(lower) ||
      /^(?:refills?|रिफिल)$/i.test(lower)
    ) {
      return 'LIST_REFILLS';
    }

    // Follow-up: "Mark it complete" after viewing tasks
    if (session.lastAction === 'LIST_TASKS' && /(?:complete|done|finish|mark done|झाले|झाला)/i.test(lower)) {
      return 'COMPLETE_TASK';
    }

    // 3. Customer Enquiries
    if (/(?:create|add|new|record|nayi|navin|नोंदवा).*(?:enquiry|enquiries|inquiry|चौकशी|इन्क्वायरी)/i.test(lower)) {
      return 'CREATE_ENQUIRY';
    }
    if (/(?:enquiry|enquiries|inquiries|चौकशी|इन्क्वायरी).*(?:list|show|dikhao|daakhva|pending|open|yaadi)?/i.test(lower)) {
      return 'LIST_ENQUIRIES';
    }

    // 4. WhatsApp management & draft replies
    if (/(?:draft|generate|sugest|likh do|सुचवा).*(?:reply|response|message|उत्तर|मेसेज)/i.test(lower)) {
      return 'DRAFT_WHATSAPP_REPLY';
    }
    if (/(?:send|dispatch|bhej do|पाठवा).*(?:whatsapp|wa|message|reply|मेसेज)/i.test(lower)) {
      return 'SEND_WHATSAPP_MESSAGE';
    }
    if (
      /(?:unanswered|pending|unread|recent|incoming|all)?.*(?:whatsapp|wa|chat|chats|messages|enquiries|मेसेज).*(?:show|dikhao|daakhva|list|pending|unanswered|summary)?/i.test(lower) ||
      /(?:व्हॉट्सअ‍ॅप|व्हॉट्सॲप|व्हाट्सएप).*(?:मेसेज|चॅट|दाखवा|दिखाओ)/i.test(lower)
    ) {
      return 'LIST_WHATSAPP_CHATS';
    }

    // 5. OCR & Image Scans
    if (/(?:ocr|scan|scans|prescription|strip|image|photo|प्रिस्क्रिप्शन|स्कॅन).*(?:show|dikhao|daakhva|inspect|review|extract)?/i.test(lower)) {
      return 'INSPECT_OCR';
    }

    // 5b. Owner-Only: Purchase Rates & PTR
    if (/(?:purchase\s*(?:rate|price)|ptr|buying\s*price|kharid\s*bhav|distributor\s*rate)\b/i.test(lower)) {
      return 'VIEW_PURCHASE_RATES';
    }

    // 5c. Owner-Only: Gross Profit Margins
    if (/(?:margin|profit|gross\s*margin|markup)\b/i.test(lower)) {
      return 'VIEW_MARGINS';
    }

    // 5d. Owner-Only: Sales Metrics & Daily Turnover
    if (/(?:sales|turnover|revenue|daily\s*collection|bikri|kamai|aaj\s*ka\s*galla|kiti\s*dhanda)\b/i.test(lower)) {
      return 'QUERY_SALES_METRICS';
    }

    // 5e. Expiry Audit
    if (/(?:expiry|expiring|near\s*expiry|expire\s*hone\s*wali|expiry\s*check|audit\s*expiry)\b/i.test(lower)) {
      return 'AUDIT_EXPIRY';
    }

    // 6. Stock, Inventory & Prices
    if (
      /(?:stock|price|rate|mrp|available|inventory|स्टॉक|किंमत|दाम|भाव|उपलब्ध).*(?:check|search|dikhao|batao|daakhva|ahe ka|hai kya)?/i.test(lower) ||
      /(?:do you have|how much for|cost of|search medicine)/i.test(lower)
    ) {
      return 'SEARCH_INVENTORY';
    }

    return 'GENERAL_QA';
  }

  /**
   * Refills & Repeat Orders Handler
   */
  private async handleListRefills(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const isReadyFilter = /ready/i.test(text);
    const isCompletedFilter = /completed|done/i.test(text);
    let statusClause = "pr.status IN ('pending', 'confirmed') AND (pr.is_active = 1 OR pr.is_active IS NULL)";
    if (isReadyFilter) statusClause = "pr.is_ready = 1 AND (pr.is_active = 1 OR pr.is_active IS NULL)";
    if (isCompletedFilter) statusClause = "pr.status = 'completed'";

    const rows = await db.all(`
      SELECT pr.id, pr.patient_name, pr.patient_phone, pr.medicine_name, pr.quantity_needed,
             pr.next_refill_date, pr.status, pr.is_ready, pr.last_refill_date, m.name as catalog_name
      FROM patient_refills pr
      LEFT JOIN medicines m ON pr.medicine_id = m.id
      WHERE ${statusClause}
      ORDER BY pr.next_refill_date ASC LIMIT 10
    `).catch(() => []);

    const cards: AssistantCardItem[] = rows.map((r: any) => ({
      id: r.id,
      title: `${r.patient_name} — ${r.medicine_name || r.catalog_name || 'Refill Item'}`,
      subtitle: `Phone: ${r.patient_phone} | Due: ${r.next_refill_date ? r.next_refill_date.slice(0, 10) : 'Immediate'} | Qty: ${r.quantity_needed || 1}`,
      badge: r.is_ready ? 'Ready for Dispensing' : (r.status === 'completed' ? 'Completed' : 'Pending Refill'),
      badgeColor: r.is_ready ? 'green' : (r.status === 'completed' ? 'blue' : 'amber'),
      actionUrl: `/crm?phone=${encodeURIComponent(r.patient_phone)}`
    }));

    const count = cards.length;
    let reply = count > 0
      ? `Found ${count} ${isReadyFilter ? 'ready' : 'pending'} refill request(s). Here is the active list:`
      : `No pending refills found matching the query. All chronic patient refills are currently up to date.`;

    if (count > 0) {
      session.lastEntityId = rows[0]?.id;
      session.lastEntityName = rows[0]?.patient_name;
    }

    return {
      sessionId: session.sessionId,
      query: text,
      reply,
      actionType: 'LIST_REFILLS',
      cards,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: count > 0 ? ['Prepare the first refill', 'Show patient order history', 'Create follow-up task'] : undefined
    };
  }

  /**
   * Refill Preparation Handler (Two-Stage Confirmation Gate)
   */
  private async handlePrepareRefill(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const refillId = this.extractNumericId(text) || session.lastEntityId;
    if (!refillId) {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: 'Which refill would you like to prepare? Please specify the refill ID or patient name.',
        actionType: 'PREPARE_REFILL',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const refill = await db.get(`
      SELECT pr.*, m.name as catalog_med, m.sell_price, m.total_stock
      FROM patient_refills pr
      LEFT JOIN medicines m ON pr.medicine_id = m.id
      WHERE pr.id = ? LIMIT 1
    `, [refillId]).catch(() => null);

    if (!refill) {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: `Could not find refill #${refillId}. Please verify the refill ID.`,
        actionType: 'PREPARE_REFILL',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const medName = refill.medicine_name || refill.catalog_med || 'Medicine';
    const proposal: ProposedAction = {
      id: `prop_refill_${refill.id}_${Date.now()}`,
      actionType: 'PREPARE_REFILL',
      description: `Stage and mark Refill #${refill.id} for ${refill.patient_name} (${medName}, Qty: ${refill.quantity_needed || 1}) as ready for dispensing`,
      payload: {
        refillId: refill.id,
        patientName: refill.patient_name,
        patientPhone: refill.patient_phone,
        medicineName: medName,
        quantity: refill.quantity_needed || 1
      },
      requiresConfirmation: true,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString()
    };

    session.pendingProposals?.set(proposal.id, proposal);

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `⚠️ *Confirmation Required:*\nWould you like to stage Refill #${refill.id} for **${refill.patient_name}** (${medName}, Qty: ${refill.quantity_needed || 1})?\nStock verified: ${refill.total_stock >= (refill.quantity_needed || 1) ? 'Available in stock' : 'Shortage/Procure'}.`,
      actionType: 'PREPARE_REFILL',
      proposedAction: proposal,
      requiresConfirmation: true,
      cards: [{
        id: refill.id,
        title: `${refill.patient_name} — Refill #${refill.id}`,
        subtitle: `Item: ${medName} | Qty: ${refill.quantity_needed || 1} | Phone: ${refill.patient_phone}`,
        badge: 'Awaiting Operator Confirmation',
        badgeColor: 'amber'
      }],
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['Confirm preparation', 'Cancel']
    };
  }

  /**
   * Tasks & Callbacks List Handler
   */
  private async handleListTasks(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const isOverdue = /overdue|late/i.test(text);
    let whereClause = "status IN ('pending', 'rescheduled')";
    if (isOverdue) {
      whereClause += " AND (reschedule_date < date('now', 'localtime') OR (reschedule_date IS NULL AND created_at < date('now', 'localtime')))";
    }

    const tasks = await db.all(`
      SELECT * FROM patient_call_tasks
      WHERE ${whereClause}
      ORDER BY CASE WHEN priority = 'high' THEN 0 ELSE 1 END, created_at DESC LIMIT 10
    `).catch(() => []);

    const cards: AssistantCardItem[] = tasks.map((t: any) => {
      let parsedDetails = '';
      try {
        const d = JSON.parse(t.details_json || '{}');
        parsedDetails = d.details || '';
      } catch (_) {}

      return {
        id: t.id,
        title: `${t.patient_name} (${t.task_type.toUpperCase()})`,
        subtitle: `Phone: ${t.patient_phone} ${parsedDetails ? '| Note: ' + parsedDetails : ''}`,
        badge: t.priority === 'high' ? 'High Priority' : (t.status === 'rescheduled' ? 'Rescheduled' : 'Pending'),
        badgeColor: t.priority === 'high' ? 'red' : (t.status === 'rescheduled' ? 'blue' : 'amber'),
        actionUrl: `/crm?phone=${encodeURIComponent(t.patient_phone)}`
      };
    });

    const count = cards.length;
    const reply = count > 0
      ? `Found ${count} ${isOverdue ? 'overdue' : 'pending'} operational task(s):`
      : `No pending tasks found. All follow-ups and patient reminders are clear.`;

    if (count > 0) {
      session.lastEntityId = tasks[0]?.id;
      session.lastEntityName = tasks[0]?.patient_name;
    }

    return {
      sessionId: session.sessionId,
      query: text,
      reply,
      actionType: 'LIST_TASKS',
      cards,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: count > 0 ? ['Complete task #' + tasks[0].id, 'Create a new task'] : ['Create a reminder']
    };
  }

  /**
   * Task Creation Handler
   */
  private async handleCreateTask(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const phone = this.extractPhoneNumber(text);
    const name = this.extractPatientName(text) || session.lastEntityName || 'Patient';
    const taskType = this.extractTaskType(text);
    const details = text.replace(/create|add|task|reminder|callback|for|\d{10}/gi, '').trim();

    if (!phone) {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: 'Please provide a valid 10-digit mobile number for the patient to create this reminder.',
        actionType: 'CREATE_TASK',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const proposal: ProposedAction = {
      id: `prop_task_${Date.now()}`,
      actionType: 'CREATE_TASK',
      description: `Create ${taskType.toUpperCase()} task for ${name} (${phone}): "${details || 'Follow up'}"`,
      payload: {
        task_type: taskType,
        taskType,
        patient_name: name,
        patientName: name,
        patient_phone: phone,
        patientPhone: phone,
        details: details || 'Follow up requested by staff',
        priority: /urgent|high/i.test(text) ? 'high' : 'normal'
      },
      requiresConfirmation: true,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString()
    };

    session.pendingProposals?.set(proposal.id, proposal);

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `⚠️ *Confirmation Required:*\nCreate a **${taskType.toUpperCase()}** follow-up task for **${name}** (${phone})?\nNote: "${details || 'Follow up'}"`,
      actionType: 'CREATE_TASK',
      proposedAction: proposal,
      requiresConfirmation: true,
      cards: [{
        id: proposal.id,
        title: `Proposed Task: ${name} (${taskType})`,
        subtitle: `Phone: ${phone} | Details: ${details || 'Follow up'}`,
        badge: 'Pending Confirmation',
        badgeColor: 'amber'
      }],
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['Confirm task creation', 'Cancel']
    };
  }

  /**
   * Task Completion Handler
   */
  private async handleCompleteTask(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const taskId = this.extractNumericId(text) || session.lastEntityId;
    if (!taskId) {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: 'Which task would you like to complete? Please specify the task ID.',
        actionType: 'COMPLETE_TASK',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const task = await db.get('SELECT * FROM patient_call_tasks WHERE id = ? LIMIT 1', [taskId]).catch(() => null);
    if (!task) {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: `Task #${taskId} not found. Please verify the ID.`,
        actionType: 'COMPLETE_TASK',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const proposal: ProposedAction = {
      id: `prop_complete_${task.id}_${Date.now()}`,
      actionType: 'COMPLETE_TASK',
      description: `Mark task #${task.id} (${task.patient_name}) as completed`,
      payload: {
        taskId: task.id,
        patientName: task.patient_name,
        callOutcome: 'Resolved via Assistant'
      },
      requiresConfirmation: true,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString()
    };

    session.pendingProposals?.set(proposal.id, proposal);

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `⚠️ *Confirmation Required:*\nMark task #${task.id} for **${task.patient_name}** as **Completed**?`,
      actionType: 'COMPLETE_TASK',
      proposedAction: proposal,
      requiresConfirmation: true,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['Confirm completion', 'Cancel']
    };
  }

  /**
   * Customer Enquiries Handler
   */
  private async handleListEnquiries(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const rows = await db.all(`
      SELECT me.*, m.name as catalog_name
      FROM medicine_enquiries me
      LEFT JOIN medicines m ON me.medicine_id = m.id
      WHERE me.status = 'open'
      ORDER BY me.id DESC LIMIT 10
    `).catch(() => []);

    const cards: AssistantCardItem[] = rows.map((e: any) => ({
      id: e.id,
      title: `${e.patient_name || 'Customer'} — ${e.medicine_name}`,
      subtitle: `Phone: ${e.patient_phone || 'None'} | Source: ${e.source} | Qty: ${e.qty || 1}`,
      badge: 'Open Enquiry',
      badgeColor: 'blue',
      actionUrl: `/crm?phone=${encodeURIComponent(e.patient_phone || '')}`
    }));

    const count = cards.length;
    const reply = count > 0
      ? `Found ${count} open customer medicine enquiry/enquiries:`
      : `No open enquiries found. All customer questions have been answered.`;

    return {
      sessionId: session.sessionId,
      query: text,
      reply,
      actionType: 'LIST_ENQUIRIES',
      cards,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: count > 0 ? ['Create new enquiry', 'Check inventory'] : undefined
    };
  }

  /**
   * Create Customer Enquiry Handler
   */
  private async handleCreateEnquiry(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const phone = this.extractPhoneNumber(text);
    const name = this.extractPatientName(text) || session.lastEntityName || 'Customer';
    const medicine = this.extractMedicineFromText(text) || 'Requested Medicine';

    const proposal: ProposedAction = {
      id: `prop_enq_${Date.now()}`,
      actionType: 'CREATE_ENQUIRY',
      description: `Record customer enquiry for ${name} (${phone || 'No phone'}): "${medicine}"`,
      payload: {
        patient_name: name,
        patient_phone: phone,
        medicine_name: medicine,
        source: 'manual',
        notes: text
      },
      requiresConfirmation: true,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString()
    };

    session.pendingProposals?.set(proposal.id, proposal);

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `⚠️ *Confirmation Required:*\nRecord new enquiry for **${name}** (${phone || 'No phone'}) requesting **${medicine}**?`,
      actionType: 'CREATE_ENQUIRY',
      proposedAction: proposal,
      requiresConfirmation: true,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['Confirm enquiry', 'Cancel']
    };
  }

  /**
   * WhatsApp Chats & Enquiries Handler
   */
  private async handleListWhatsAppChats(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const chats = await db.all(`
      SELECT id, name, unread_count, last_message, timestamp, resolved_number
      FROM whatsapp_chats
      WHERE (unread_count > 0 OR timestamp >= (strftime('%s', 'now') - 86400) * 1000)
      ORDER BY timestamp DESC LIMIT 10
    `).catch(() => []);

    const cards: AssistantCardItem[] = chats.map((c: any) => ({
      id: c.id,
      title: c.name || c.resolved_number || c.id,
      subtitle: c.last_message ? `Last: "${c.last_message.slice(0, 60)}..."` : 'No messages',
      badge: c.unread_count > 0 ? `${c.unread_count} Unread` : 'Active',
      badgeColor: c.unread_count > 0 ? 'red' : 'green',
      actionUrl: `/mail?chatId=${encodeURIComponent(c.id)}`
    }));

    const count = cards.length;
    const reply = count > 0
      ? `Found ${count} recent WhatsApp conversation(s) requiring staff attention:`
      : `No unanswered WhatsApp enquiries at this time. All inbound customer chats have been addressed.`;

    if (count > 0) {
      session.lastEntityId = chats[0]?.id;
      session.lastEntityName = chats[0]?.resolved_name || chats[0]?.name;
    }

    return {
      sessionId: session.sessionId,
      query: text,
      reply,
      actionType: 'LIST_WHATSAPP_CHATS',
      cards,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: count > 0 ? ['Draft reply for the latest chat', 'View open enquiries'] : undefined
    };
  }

  /**
   * WhatsApp Draft Reply Handler
   */
  private async handleDraftWhatsAppReply(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const phone = this.extractPhoneNumber(text) || (session.lastEntityId as string) || '';
    const querySubject = text.replace(/draft|reply|for|whatsapp|\d{10}/gi, '').trim();

    // Use grounded Q&A engine to produce factual draft response
    const qaResult = await pharmacyQaEngine.processQuery(querySubject || 'Dolo 650 available hai kya?', {
      language: session.language || 'hinglish',
      dbInstance: db
    });

    const proposalId = `prop_wa_${Date.now()}`;
    const proposedAction: ProposedAction = {
      id: proposalId,
      actionType: 'SEND_WHATSAPP_MESSAGE',
      description: `Queue WhatsApp message to ${phone || 'customer'}: "${qaResult.draftResponse.slice(0, 60)}..."`,
      payload: {
        phone: phone || '9876543210',
        message: qaResult.draftResponse
      },
      requiresConfirmation: true,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString()
    };

    if (!session.pendingProposals) session.pendingProposals = new Map();
    session.pendingProposals.set(proposalId, proposedAction);

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `📝 *Draft WhatsApp Response (${phone ? 'for ' + phone : 'Ready for Review'}):*\n\n${qaResult.draftResponse}\n\n_Review the above draft. You can approve and send, edit, or cancel._`,
      actionType: 'DRAFT_WHATSAPP_REPLY',
      proposedAction,
      requiresConfirmation: true,
      cards: [{
        id: phone || 'draft_01',
        title: `Draft Response Preview`,
        subtitle: qaResult.draftResponse.slice(0, 100) + '...',
        badge: 'Grounded Factual Draft',
        badgeColor: 'blue'
      }],
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['Send this message', 'Edit response', 'Cancel']
    };
  }

  /**
   * Send WhatsApp Message Handler (Two-Stage Confirmation Gate)
   */
  private async handleSendWhatsAppMessage(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const phone = this.extractPhoneNumber(text);
    if (!phone) {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: 'Please provide a valid 10-digit mobile number to send the WhatsApp message.',
        actionType: 'SEND_WHATSAPP_MESSAGE',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const messageContent = text.replace(/send|whatsapp|message|to|\d{10}/gi, '').trim() || 'Your order is ready for pickup at our pharmacy.';

    const proposal: ProposedAction = {
      id: `prop_wa_${Date.now()}`,
      actionType: 'SEND_WHATSAPP_MESSAGE',
      description: `Send WhatsApp message to ${phone}: "${messageContent}"`,
      payload: {
        phone,
        message: messageContent
      },
      requiresConfirmation: true,
      status: 'PENDING_CONFIRMATION',
      createdAt: new Date().toISOString()
    };

    session.pendingProposals?.set(proposal.id, proposal);

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `⚠️ *Confirmation Required:*\nSend the following WhatsApp message to **${phone}**?\n\n> "${messageContent}"`,
      actionType: 'SEND_WHATSAPP_MESSAGE',
      proposedAction: proposal,
      requiresConfirmation: true,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['Confirm and send message', 'Cancel']
    };
  }

  /**
   * OCR & Image Scans Assistance Handler
   */
  private async handleInspectOcr(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const scans = await db.all(`
      SELECT ps.id, ps.status, ps.created_at, ps.image_path,
             psi.medicine_name, psi.strength, psi.dosage, psi.confidence
      FROM prescription_scans ps
      LEFT JOIN prescription_scan_items psi ON ps.id = psi.scan_id
      ORDER BY ps.id DESC LIMIT 10
    `).catch(() => []);

    const cards: AssistantCardItem[] = scans.map((s: any) => {
      const isUncertain = s.confidence && Number(s.confidence) < 0.7;
      return {
        id: s.id,
        title: s.medicine_name || `Prescription Scan #${s.id}`,
        subtitle: `Strength: ${s.strength || 'N/A'} | Dosage: ${s.dosage || 'N/A'} | Confidence: ${s.confidence ? Math.round(s.confidence * 100) + '%' : 'Verified'}`,
        badge: isUncertain ? 'Needs Staff Review' : 'Extracted',
        badgeColor: isUncertain ? 'amber' : 'green',
        actionUrl: `/ai-camera?scanId=${s.id}`
      };
    });

    const count = cards.length;
    const reply = count > 0
      ? `Found ${count} recent OCR prescription extraction(s). Items marked with amber badges have lower confidence and require staff verification before ordering:`
      : `No recent prescription OCR scans found in queue.`;

    return {
      sessionId: session.sessionId,
      query: text,
      reply,
      actionType: 'INSPECT_OCR',
      cards,
      latencyMs: Math.round(performance.now() - startTime)
    };
  }

  /**
   * Stock & Inventory Search Handler
   */
  private async handleSearchInventory(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const medQuery = text.replace(/check|stock|price|rate|mrp|for|available|in stock|search/gi, '').trim();
    const evidence = await pharmacyKnowledgeRetriever.retrieveMedicineEvidence(medQuery || 'Dolo', db);

    const cards: AssistantCardItem[] = evidence.map(m => ({
      id: m.id,
      title: m.name,
      subtitle: `Strength: ${m.strength || 'Standard'} | Pack: ${m.packSize || 'Strip'} | Rack: ${m.rackLocation || 'General'}`,
      badge: m.inStock ? `In Stock (${m.stockQuantity})` : 'Out of Stock',
      badgeColor: m.inStock ? 'green' : 'red',
      details: {
        mrp: `₹${m.mrp.toFixed(2)}`,
        sellingPrice: `₹${m.sellingPrice.toFixed(2)}`
      },
      actionUrl: `/pos?medicineId=${m.id}&search=${encodeURIComponent(m.name)}`
    }));

    const count = cards.length;
    const reply = count > 0
      ? `Found ${count} matching medicine(s): ${evidence.map(m => `${m.name} (${m.stockQuantity} in stock, MRP: ₹${m.mrp.toFixed(2)})`).join(', ')}. Click any card to launch POS billing:`
      : `No matching medicine found for "${medQuery}". Would you like to create a customer enquiry or check distributor availability?`;

    return {
      sessionId: session.sessionId,
      query: text,
      reply,
      actionType: 'SEARCH_INVENTORY',
      cards,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: count > 0 ? ['Open in POS', 'Show similar medicines'] : ['Create an enquiry']
    };
  }

  /**
   * General Q&A / Small Talk Handler
   */
  private async handleGeneralQa(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const qaResult = await pharmacyQaEngine.processQuery(text, {
      language: session.language || 'en',
      dbInstance: db
    });

    return {
      sessionId: session.sessionId,
      query: text,
      reply: qaResult.draftResponse,
      actionType: 'GENERAL_QA',
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['Show today pending refills', 'Check overdue tasks', 'View open WhatsApp chats']
    };
  }

  /**
   * Customer Query Handler (Strictly sandboxed, zero staff permissions)
   */
  private async handleCustomerQuery(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const qaResult = await pharmacyQaEngine.processQuery(text, {
      language: session.language || 'en',
      dbInstance: db
    });

    return {
      sessionId: session.sessionId,
      query: text,
      reply: qaResult.draftResponse,
      actionType: 'GENERAL_QA',
      latencyMs: Math.round(performance.now() - startTime)
    };
  }

  /**
   * Confirms and executes a staged proposal (Rule 6 Human-in-the-Loop)
   */
  public async confirmProposal(
    proposalId: string,
    sessionId: string,
    operator: { userId?: number; username?: string; storeId?: number; dbInstance?: any } = {}
  ): Promise<{ success: boolean; message: string; proposal?: ProposedAction }> {
    const session = sessionStore.get(sessionId);
    if (!session || !session.pendingProposals?.has(proposalId)) {
      return { success: false, message: 'Proposal expired or not found. Please initiate the action again.' };
    }

    const proposal = session.pendingProposals.get(proposalId)!;
    const db = operator.dbInstance || (await dbManager.getConnection());

    try {
      switch (proposal.actionType) {
        case 'CREATE_TASK': {
          const { task_type, patient_name, patient_phone, details, priority } = proposal.payload;
          const result = await db.run(`
            INSERT INTO patient_call_tasks
              (task_type, patient_name, patient_phone, details_json, priority, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
          `, [task_type, patient_name, patient_phone, JSON.stringify({ details }), priority || 'normal']);

          await logMutationAudit({
            storeId: operator.storeId || 1,
            userId: operator.userId,
            username: operator.username || 'staff',
            action: 'CREATE_TASK',
            entity: 'patient_call_tasks',
            entityId: result.lastID,
            description: `Assistant created ${task_type} task #${result.lastID} for ${patient_name} (${patient_phone})`
          });

          eventService.broadcast('call_tasks_updated', { taskId: result.lastID, taskType: task_type });
          proposal.status = 'EXECUTED';
          session.pendingProposals.delete(proposalId);
          return { success: true, message: `Task #${result.lastID} created successfully for ${patient_name}.`, proposal };
        }

        case 'COMPLETE_TASK': {
          const { taskId, patientName, callOutcome } = proposal.payload;
          await db.run(`
            UPDATE patient_call_tasks
            SET status = 'completed', call_outcome = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [callOutcome || 'Completed via Assistant', taskId]);

          await logMutationAudit({
            storeId: operator.storeId || 1,
            userId: operator.userId,
            username: operator.username || 'staff',
            action: 'COMPLETE_TASK',
            entity: 'patient_call_tasks',
            entityId: taskId,
            description: `Assistant marked task #${taskId} for ${patientName} as completed`
          });

          eventService.broadcast('call_tasks_updated', { taskId, status: 'completed' });
          proposal.status = 'EXECUTED';
          session.pendingProposals.delete(proposalId);
          return { success: true, message: `Task #${taskId} marked as completed.`, proposal };
        }

        case 'PREPARE_REFILL': {
          const { refillId, patientName, medicineName } = proposal.payload;
          await db.run(`
            UPDATE patient_refills
            SET is_ready = 1, status = 'ready'
            WHERE id = ?
          `, [refillId]);

          await logMutationAudit({
            storeId: operator.storeId || 1,
            userId: operator.userId,
            username: operator.username || 'staff',
            action: 'PREPARE_REFILL',
            entity: 'patient_refills',
            entityId: refillId,
            description: `Assistant marked Refill #${refillId} (${medicineName}) for ${patientName} as ready`
          });

          eventService.broadcast('refill_updated', { refillId, is_ready: 1 });
          proposal.status = 'EXECUTED';
          session.pendingProposals.delete(proposalId);
          return { success: true, message: `Refill #${refillId} for ${patientName} is now marked as Ready.`, proposal };
        }

        case 'CREATE_ENQUIRY': {
          const { patient_name, patient_phone, medicine_name, notes, source } = proposal.payload;
          const result = await db.run(`
            INSERT INTO medicine_enquiries
              (patient_name, patient_phone, medicine_name, source, notes, status)
            VALUES (?, ?, ?, ?, ?, 'open')
          `, [patient_name, patient_phone || null, medicine_name, source || 'manual', notes || null]);

          await logMutationAudit({
            storeId: operator.storeId || 1,
            userId: operator.userId,
            username: operator.username || 'staff',
            action: 'CREATE_ENQUIRY',
            entity: 'medicine_enquiries',
            entityId: result.lastID,
            description: `Assistant recorded enquiry #${result.lastID} for ${patient_name} (${medicine_name})`
          });

          proposal.status = 'EXECUTED';
          session.pendingProposals.delete(proposalId);
          return { success: true, message: `Customer enquiry #${result.lastID} recorded successfully.`, proposal };
        }

        case 'SEND_WHATSAPP_MESSAGE': {
          const { phone, message } = proposal.payload;
          const { outboundSecurityGateway } = await import('../outboundSecurityGateway.js');
          const { whatsappQueueWorker } = await import('../whatsappQueueWorker.js');

          const gateCheck = await outboundSecurityGateway.validateOutboundMessage({
            recipient: phone,
            message,
            messageType: 'direct',
            callerRole: session.role === 'owner' ? 'owner' : 'staff',
            dbInstance: db
          });

          if (!gateCheck.allowed) {
            return {
              success: false,
              message: `Outbound Security Gateway rejected send: ${gateCheck.blockReason} (${gateCheck.violations.join(', ')})`,
              proposal
            };
          }

          const queueId = await whatsappQueueWorker.enqueue(
            phone,
            message,
            'direct',
            gateCheck.recipientName || undefined,
            undefined,
            undefined,
            undefined,
            { skipDedupe: false }
          );

          await logMutationAudit({
            storeId: operator.storeId || 1,
            userId: operator.userId,
            username: operator.username || 'staff',
            action: 'SEND_WHATSAPP_MESSAGE',
            entity: 'whatsapp_send_queue',
            entityId: queueId,
            description: `Assistant queued WhatsApp message #${queueId} to ${phone}: "${message.slice(0, 50)}..."`
          });

          proposal.status = 'EXECUTED';
          session.pendingProposals.delete(proposalId);
          return { success: true, message: `WhatsApp message queued for dispatch to ${phone} (Queue #${queueId}).`, proposal };
        }

        default:
          return { success: false, message: `Unsupported action type: ${proposal.actionType}` };
      }
    } catch (err: any) {
      console.error('[Assistant Orchestrator] Action execution error:', err);
      proposal.status = 'FAILED';
      return { success: false, message: `Action failed: ${err.message}` };
    }
  }

  /**
   * Cancels a pending proposal
   */
  public cancelProposal(proposalId: string, sessionId: string): boolean {
    const session = sessionStore.get(sessionId);
    if (session && session.pendingProposals?.has(proposalId)) {
      session.pendingProposals.delete(proposalId);
      return true;
    }
    return false;
  }

    /**
   * Owner-Only: View Purchase Rates (PTR)
   */
  private async handleViewPurchaseRates(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    if (session.role !== 'owner') {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: '🔒 **Access Restricted:** Supplier purchase rate (PTR) analysis is strictly restricted to verified Pharmacy Owner accounts.',
        actionType: 'VIEW_PURCHASE_RATES',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const medName = this.extractMedicineFromText(text) || text.replace(/purchase|rate|price|ptr|kharid|bhav|distributor/gi, '').trim();
    const query = medName ? `%${medName}%` : '%';
    const rows = await db.all(`
      SELECT m.id, m.name, m.last_purchase_ptr, m.lowest_purchase_ptr, m.last_distributor_name, m.mrp, m.sell_price, m.total_stock
      FROM medicines m
      WHERE m.name LIKE ? OR m.canonical_name LIKE ?
      ORDER BY m.total_stock DESC LIMIT 5
    `, [query, query]);

    if (!rows || rows.length === 0) {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: `No purchase rate records found for "${medName}".`,
        actionType: 'VIEW_PURCHASE_RATES',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const cards: AssistantCardItem[] = rows.map((r: any) => ({
      id: r.id,
      title: r.name,
      subtitle: `PTR: ₹${Number(r.last_purchase_ptr || 0).toFixed(2)} | Supplier: ${r.last_distributor_name || 'N/A'} | MRP: ₹${Number(r.mrp || 0).toFixed(2)}`,
      badge: r.lowest_purchase_ptr ? `Lowest: ₹${Number(r.lowest_purchase_ptr).toFixed(2)}` : 'Verified PTR',
      badgeColor: 'blue'
    }));

    const lines = rows.map((r: any) =>
      `• **${r.name}**\n  - Last Purchase Rate (PTR): **₹${Number(r.last_purchase_ptr || 0).toFixed(2)}**\n  - Supplier: *${r.last_distributor_name || 'Direct'}*\n  - Lowest Historical PTR: ₹${Number(r.lowest_purchase_ptr || r.last_purchase_ptr || 0).toFixed(2)}\n  - Retail MRP: ₹${Number(r.mrp || 0).toFixed(2)} | Stock: ${r.total_stock || 0}`
    );

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `📊 **Owner Analysis — Supplier Purchase Rates (PTR):**\n\n${lines.join('\n\n')}`,
      actionType: 'VIEW_PURCHASE_RATES',
      cards,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['View profit margins', 'Check sales metrics']
    };
  }

  /**
   * Owner-Only: View Profit Margins
   */
  private async handleViewMargins(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    if (session.role !== 'owner') {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: '🔒 **Access Restricted:** Profit margin analysis is strictly restricted to verified Pharmacy Owner accounts.',
        actionType: 'VIEW_MARGINS',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const medName = this.extractMedicineFromText(text) || text.replace(/margin|profit|gross|markup/gi, '').trim();
    const query = medName ? `%${medName}%` : '%';
    const rows = await db.all(`
      SELECT m.id, m.name, m.last_purchase_ptr, m.sell_price, m.mrp, m.total_stock
      FROM medicines m
      WHERE (m.name LIKE ? OR m.canonical_name LIKE ?) AND m.last_purchase_ptr > 0
      ORDER BY m.total_stock DESC LIMIT 5
    `, [query, query]);

    if (!rows || rows.length === 0) {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: `No margin calculations available for "${medName}" (missing purchase price data).`,
        actionType: 'VIEW_MARGINS',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const cards: AssistantCardItem[] = rows.map((r: any) => {
      const sellPrice = Number(r.sell_price || r.mrp || 0);
      const ptr = Number(r.last_purchase_ptr || 0);
      const margin = sellPrice > 0 ? ((sellPrice - ptr) / sellPrice) * 100 : 0;
      const profitPerUnit = Math.max(0, sellPrice - ptr);
      return {
        id: r.id,
        title: r.name,
        subtitle: `Sell: ₹${sellPrice.toFixed(2)} | PTR: ₹${ptr.toFixed(2)} | Profit: ₹${profitPerUnit.toFixed(2)}/unit`,
        badge: `${margin.toFixed(1)}% Margin`,
        badgeColor: margin >= 20 ? 'green' : margin >= 10 ? 'amber' : 'red'
      };
    });

    const lines = rows.map((r: any) => {
      const sellPrice = Number(r.sell_price || r.mrp || 0);
      const ptr = Number(r.last_purchase_ptr || 0);
      const margin = sellPrice > 0 ? ((sellPrice - ptr) / sellPrice) * 100 : 0;
      const profitPerUnit = Math.max(0, sellPrice - ptr);
      return `• **${r.name}**\n  - Retail Sell: ₹${sellPrice.toFixed(2)} | Purchase PTR: ₹${ptr.toFixed(2)}\n  - **Gross Margin:** **${margin.toFixed(1)}%** (Profit: ₹${profitPerUnit.toFixed(2)}/unit)`;
    });

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `📈 **Owner Intelligence — Gross Profit Margins:**\n\n${lines.join('\n\n')}`,
      actionType: 'VIEW_MARGINS',
      cards,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['View purchase rates', 'Today\'s sales metrics']
    };
  }

  /**
   * Owner-Only: Query Sales Metrics
   */
  private async handleQuerySalesMetrics(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    if (session.role !== 'owner') {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: '🔒 **Access Restricted:** Store revenue and sales analytics are strictly restricted to verified Pharmacy Owner accounts.',
        actionType: 'QUERY_SALES_METRICS',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const todayStats = await db.get(`
      SELECT COUNT(*) as bill_count, COALESCE(SUM(total_amount), 0) as total_sales, AVG(total_amount) as avg_bill
      FROM sales_invoices
      WHERE DATE(COALESCE(date, updated_at)) = DATE('now', 'localtime')
    `);

    const count = todayStats?.bill_count || 0;
    const revenue = Number(todayStats?.total_sales || 0);
    const avg = Number(todayStats?.avg_bill || 0);

    const cards: AssistantCardItem[] = [
      {
        id: 'sales_today',
        title: `Today's Revenue: ₹${revenue.toFixed(2)}`,
        subtitle: `${count} Invoices billed today | Average ticket: ₹${avg.toFixed(2)}`,
        badge: 'Live Sales Ledger',
        badgeColor: 'green'
      }
    ];

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `💰 **Store Financial Summary (Today):**\n\n• Total Revenue: **₹${revenue.toFixed(2)}**\n• Invoices Generated: **${count} bills**\n• Average Bill Value: **₹${avg.toFixed(2)}**`,
      actionType: 'QUERY_SALES_METRICS',
      cards,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['Check near expiry stock', 'Check pending refills']
    };
  }

  /**
   * Expiry Audit Handler
   */
  private async handleAuditExpiry(text: string, session: AssistantSessionContext, db: any, startTime: number): Promise<AssistantResponse> {
    const rows = await db.all(`
      SELECT im.id, im.batch_no, im.expiry_date, im.quantity, im.rack_location, m.name as medicine_name
      FROM inventory_master im
      JOIN medicines m ON m.id = im.medicine_id
      WHERE im.expiry_date <= datetime('now', '+90 days')
        AND im.is_active = 1
        AND im.quantity > 0
      ORDER BY im.expiry_date ASC
      LIMIT 6
    `);

    if (!rows || rows.length === 0) {
      return {
        sessionId: session.sessionId,
        query: text,
        reply: '✅ **Expiry Audit:** Zero stock batches expiring within the next 90 days. All active inventory is fresh.',
        actionType: 'AUDIT_EXPIRY',
        latencyMs: Math.round(performance.now() - startTime)
      };
    }

    const cards: AssistantCardItem[] = rows.map((r: any) => ({
      id: r.id,
      title: r.medicine_name,
      subtitle: `Batch: ${r.batch_no || 'N/A'} | Qty: ${r.quantity} | Rack: ${r.rack_location || 'General'}`,
      badge: `Exp: ${String(r.expiry_date || '').slice(0, 10)}`,
      badgeColor: 'amber'
    }));

    const lines = rows.map((r: any) =>
      `• **${r.medicine_name}** (Batch: \`${r.batch_no || 'N/A'}\`)\n  - Expiry: **${String(r.expiry_date || '').slice(0, 10)}** | Quantity: ${r.quantity} packs | Location: Rack ${r.rack_location || 'N/A'}`
    );

    return {
      sessionId: session.sessionId,
      query: text,
      reply: `⚠️ **Near-Expiry Stock Audit (Next 90 Days):**\nFound ${rows.length} batches approaching expiry:\n\n${lines.join('\n\n')}`,
      actionType: 'AUDIT_EXPIRY',
      cards,
      latencyMs: Math.round(performance.now() - startTime),
      suggestedFollowUps: ['Check stock for alternatives', 'List open enquiries']
    };
  }

  // ----------------------------------------------------
  // Utility Extraction Helpers
  // ----------------------------------------------------
  private extractNumericId(text: string): number | null {
    const match = text.match(/#?(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  private extractPhoneNumber(text: string): string | null {
    const clean = text.replace(/[^\d]/g, '');
    const match = clean.match(/(?:91)?([6-9]\d{9})/);
    return match ? match[1] : null;
  }

  private extractPatientName(text: string): string | null {
    const match = text.match(/(?:for|patient|customer|to|mr|mrs|ke liye|चा|साठी)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
    if (!match) return null;
    let name = match[1].trim();
    name = name.replace(/\b(?:phone|mobile|no|number|contact|about|refill|call|task)\b/gi, '').trim();
    return name || null;
  }

  private extractTaskType(text: string): string {
    if (/refill/i.test(text)) return 'refill';
    if (/credit/i.test(text)) return 'credit';
    if (/special/i.test(text)) return 'special_order';
    if (/enquiry|inquiry/i.test(text)) return 'general';
    return 'general';
  }

  private extractMedicineFromText(text: string): string | null {
    const match = text.match(/(?:for|about|medicine|goli|tablet|dawai)\s+([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)/i);
    return match ? match[1].trim() : null;
  }
}

export const unifiedAssistantOrchestrator = new UnifiedAssistantOrchestrator();
