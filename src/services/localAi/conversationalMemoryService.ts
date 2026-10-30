/**
 * Persistent Customer Conversational Memory Service
 *
 * Provides SQLite-backed session tracking, multi-turn message history,
 * and structured context persistence for the Conversational AI Agent.
 *
 * Guarantees:
 * - Durable: Context survives server restarts and process crashes.
 * - Customer Isolation: Sessions are partitioned strictly by normalized phone / customer_id.
 * - Multi-turn sliding window: Preserves recent turns without context bloat.
 * - Audit Trail: Records every interaction, tool execution, and state transition.
 */

import { dbManager } from '../../database/connection.js';
import { validate10DigitPhone } from '../../utils/phoneValidation.js';

export type CustomerSessionState =
  | 'idle'
  | 'awaiting_clarification'
  | 'awaiting_confirmation'
  | 'executing'
  | 'completed'
  | 'pharmacist_review'
  | 'cancelled';

export interface CustomerConversationSession {
  id: string;
  channel: 'whatsapp' | 'portal' | 'in_app';
  customerId: number | null;
  customerName?: string | null;
  phone: string;
  language: 'en' | 'hi' | 'mr';
  sessionState: CustomerSessionState;
  activeIntent: string | null;
  contextData: Record<string, any>;
  lastActivityAt: string;
  createdAt: string;
}

export interface ConversationTurn {
  id?: number;
  sessionId: string;
  sender: 'customer' | 'assistant' | 'pharmacist' | 'system';
  messageText: string;
  toolCalls?: Record<string, any>[];
  tokensUsed?: number;
  createdAt?: string;
}

export interface MicroTaskRecord {
  id: string;
  action: string;
  summary: string;
  data?: Record<string, any>;
  timestamp: string;
  revertible: boolean;
}

export class ConversationalMemoryService {
  /**
   * Generates a stable session ID
   */
  public generateSessionId(channel: 'whatsapp' | 'portal' | 'in_app', phoneOrId: string | number): string {
    const raw = String(phoneOrId).replace(/\D/g, '');
    const cleanDigits = raw.length >= 10 ? raw.slice(-10) : raw;
    return `${channel}_${cleanDigits || 'guest'}`;
  }

  /**
   * Retrieves or initializes a persistent customer session
   */
  public async getOrCreateSession(
    channel: 'whatsapp' | 'portal' | 'in_app',
    phone: string,
    customerId?: number | null,
    dbInstance?: any,
    customSessionId?: string
  ): Promise<CustomerConversationSession> {
    const db = dbInstance || (await dbManager.getConnection());
    const rawDigits = String(phone || '').replace(/\D/g, '');
    const cleanPhone = rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
    const sessionId = customSessionId || this.generateSessionId(channel, cleanPhone || String(customerId || 'unknown'));

    // 1. Try to find existing session
    const row = await db.get(
      `SELECT s.*, c.name as customer_name
       FROM customer_conversation_sessions s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? LIMIT 1`,
      [sessionId]
    ).catch(() => null);

    if (row) {
      let contextData: Record<string, any> = {};
      try {
        if (row.context_data_json) contextData = JSON.parse(row.context_data_json);
      } catch (_) {}

      return {
        id: row.id,
        channel: row.channel,
        customerId: row.customer_id ? Number(row.customer_id) : null,
        customerName: row.customer_name || null,
        phone: row.phone,
        language: (row.language === 'hi' || row.language === 'mr') ? row.language : 'en',
        sessionState: (row.session_state as CustomerSessionState) || 'idle',
        activeIntent: row.active_intent || null,
        contextData,
        lastActivityAt: row.last_activity_at,
        createdAt: row.created_at
      };
    }

    // 2. Resolve customer identity from customers table if customerId wasn't passed
    let resolvedCustomerId = customerId ? Number(customerId) : null;
    let resolvedName: string | null = null;
    let resolvedLanguage: 'en' | 'hi' | 'mr' = 'en';

    if (cleanPhone && cleanPhone.length === 10) {
      const custRow = await db.get(
        `SELECT id, name, preferred_language, language FROM customers WHERE phone LIKE ? OR phone = ? LIMIT 1`,
        [`%${cleanPhone}`, cleanPhone]
      ).catch(() => null);

      if (custRow) {
        resolvedCustomerId = Number(custRow.id);
        resolvedName = custRow.name;
        const l = custRow.preferred_language || custRow.language;
        if (l === 'hi' || l === 'mr') resolvedLanguage = l;
      }
    }

    // 3. Insert new persistent session
    await db.run(
      `INSERT INTO customer_conversation_sessions
         (id, channel, customer_id, phone, language, session_state, active_intent, context_data_json, last_activity_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'idle', NULL, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO NOTHING`,
      [sessionId, channel, resolvedCustomerId, cleanPhone, resolvedLanguage]
    ).catch(() => {});

    return {
      id: sessionId,
      channel,
      customerId: resolvedCustomerId,
      customerName: resolvedName,
      phone: cleanPhone,
      language: resolvedLanguage,
      sessionState: 'idle',
      activeIntent: null,
      contextData: {},
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Retrieves an existing session by ID
   */
  public async getSession(sessionId: string, dbInstance?: any): Promise<CustomerConversationSession | null> {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get(
      `SELECT s.*, c.name as customer_name
       FROM customer_conversation_sessions s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ? LIMIT 1`,
      [sessionId]
    ).catch(() => null);

    if (!row) return null;

    let contextData: Record<string, any> = {};
    try {
      if (row.context_data_json) contextData = JSON.parse(row.context_data_json);
    } catch (_) {}

    return {
      id: row.id,
      channel: row.channel,
      customerId: row.customer_id ? Number(row.customer_id) : null,
      customerName: row.customer_name || null,
      phone: row.phone,
      language: (row.language === 'hi' || row.language === 'mr') ? row.language : 'en',
      sessionState: (row.session_state as CustomerSessionState) || 'idle',
      activeIntent: row.active_intent || null,
      contextData,
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at
    };
  }

  /**
   * Updates state, active intent, and structured context for an active session
   */
  public async updateSession(
    sessionId: string,
    updates: Partial<{
      sessionState: CustomerSessionState;
      activeIntent: string | null;
      contextData: Record<string, any>;
      language: 'en' | 'hi' | 'mr';
      customerId: number | null;
    }>,
    dbInstance?: any
  ): Promise<void> {
    const db = dbInstance || (await dbManager.getConnection());
    const sets: string[] = ['last_activity_at = CURRENT_TIMESTAMP'];
    const params: any[] = [];

    if (updates.sessionState !== undefined) {
      sets.push('session_state = ?');
      params.push(updates.sessionState);
    }
    if (updates.activeIntent !== undefined) {
      sets.push('active_intent = ?');
      params.push(updates.activeIntent);
    }
    if (updates.contextData !== undefined) {
      sets.push('context_data_json = ?');
      params.push(JSON.stringify(updates.contextData));
    }
    if (updates.language !== undefined) {
      sets.push('language = ?');
      params.push(updates.language);
    }
    if (updates.customerId !== undefined) {
      sets.push('customer_id = ?');
      params.push(updates.customerId);
    }

    params.push(sessionId);
    await db.run(
      `UPDATE customer_conversation_sessions SET ${sets.join(', ')} WHERE id = ?`,
      params
    ).catch((err: any) => {
      console.warn('[ConversationalMemory] Failed to update session:', err?.message || err);
    });
  }

  /**
   * Records a dialogue turn into persistent SQLite history
   */
  public async recordTurn(
    sessionId: string,
    sender: 'customer' | 'assistant' | 'pharmacist' | 'system',
    messageText: string,
    toolCalls: Record<string, any>[] = [],
    dbInstance?: any
  ): Promise<void> {
    const db = dbInstance || (await dbManager.getConnection());
    const toolJson = toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;

    await db.run(
      `INSERT INTO customer_conversation_turns
         (session_id, sender, message_text, tool_calls_json, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [sessionId, sender, messageText.trim(), toolJson]
    ).catch((err: any) => {
      console.warn('[ConversationalMemory] Failed to record turn:', err?.message || err);
    });

    // Touch session activity timestamp
    await db.run(
      `UPDATE customer_conversation_sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [sessionId]
    ).catch(() => {});
  }

  /**
   * Retrieves recent message turns for the session in chronological order
   */
  public async getRecentTurns(
    sessionId: string,
    limit: number = 6,
    dbInstance?: any
  ): Promise<ConversationTurn[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const rows = await db.all(
      `SELECT id, session_id, sender, message_text, tool_calls_json, created_at
       FROM customer_conversation_turns
       WHERE session_id = ?
       ORDER BY id DESC LIMIT ?`,
      [sessionId, limit]
    ).catch(() => []);

    // Reverse descending order to chronological order (oldest to newest)
    return rows.reverse().map((r: any) => {
      let toolCalls: Record<string, any>[] = [];
      try {
        if (r.tool_calls_json) toolCalls = JSON.parse(r.tool_calls_json);
      } catch (_) {}

      return {
        id: r.id,
        sessionId: r.session_id,
        sender: r.sender,
        messageText: r.message_text,
        toolCalls,
        createdAt: r.created_at
      };
    });
  }

  /**
   * Records a compact micro-task into session context memory (retains last 5 items)
   */
  public async recordMicroTask(
    sessionId: string,
    task: Omit<MicroTaskRecord, 'id' | 'timestamp'>,
    dbInstance?: any
  ): Promise<MicroTaskRecord> {
    const session = await this.getSession(sessionId, dbInstance);
    const existing = (session?.contextData?.recentMicroTasks || []) as MicroTaskRecord[];
    const newTask: MicroTaskRecord = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      action: task.action,
      summary: task.summary,
      data: task.data,
      timestamp: new Date().toISOString(),
      revertible: task.revertible ?? false
    };

    const updatedTasks = [newTask, ...existing].slice(0, 5);
    const updatedContext = {
      ...(session?.contextData || {}),
      recentMicroTasks: updatedTasks
    };

    await this.updateSession(sessionId, { contextData: updatedContext }, dbInstance);
    return newTask;
  }

  /**
   * Retrieves recent micro-tasks for a session
   */
  public async getRecentMicroTasks(
    sessionId: string,
    limit = 5,
    dbInstance?: any
  ): Promise<MicroTaskRecord[]> {
    const session = await this.getSession(sessionId, dbInstance);
    const tasks = (session?.contextData?.recentMicroTasks || []) as MicroTaskRecord[];
    return tasks.slice(0, limit);
  }

  /**
   * Formats a tiny 1-line prompt context summarizing recent completed actions
   */
  public formatMicroTasksPromptHeader(tasks: MicroTaskRecord[]): string {
    if (!tasks || tasks.length === 0) return '';
    const summaries = tasks.slice(0, 2).map(t => t.summary).join('; ');
    return `[Recent actions: ${summaries}]`;
  }

  /**
   * Resets conversational memory for a session (e.g. user requests reset or session ends)
   */
  public async clearSessionContext(sessionId: string, dbInstance?: any): Promise<void> {
    const db = dbInstance || (await dbManager.getConnection());
    await db.run(
      `UPDATE customer_conversation_sessions
       SET session_state = 'idle', active_intent = NULL, context_data_json = '{}', last_activity_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sessionId]
    ).catch(() => {});
  }
}

export const conversationalMemoryService = new ConversationalMemoryService();
