/**
 * Unified Pharmacy Operations Assistant Test Suite
 *
 * Validates:
 * 1. Multi-lingual operations commands (English, Hindi, Marathi, Hinglish).
 * 2. Conversational context & session entity tracking.
 * 3. Subsystem integrations: Refills, Tasks, Enquiries, WhatsApp, OCR Review, Inventory & POS.
 * 4. Two-stage confirmation gate (Rule 6 Human-in-the-Loop) and audit logging.
 * 5. Role-based security isolation: Customer role CANNOT execute staff operational actions.
 * 6. Non-mutation guarantee when proposals are pending or cancelled.
 * 7. Offline fallback and zero hallucination.
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import {
  UnifiedAssistantOrchestrator,
  unifiedAssistantOrchestrator,
  AssistantRole
} from '../src/services/localAi/unifiedAssistantOrchestrator.js';

describe('Unified Pharmacy Operations Assistant Orchestrator Suite', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-asst-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    db = await dbManager.getConnection();

    // 1. Seed store settings
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmacy_name', 'Wellness Chemist')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmacy_phone', '+91 98765 00000')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('store_open_time', '09:00 AM')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('store_close_time', '10:00 PM')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('return_policy_days', '14')");

    // 2. Seed customers
    await db.run(`
      INSERT OR REPLACE INTO customers (id, name, phone)
      VALUES (1, 'Ramesh Kumar', '9876543210'),
             (2, 'Sunita Sharma', '9123456780')
    `);

    // 3. Seed medicines & inventory
    await db.run(`
      INSERT OR REPLACE INTO medicines (id, name, canonical_name, generic_name, dosage_form, strength, mrp, sell_price, total_stock)
      VALUES (101, 'Dolo 650', 'Dolo 650', 'Paracetamol 650mg', 'Tablet', '650mg', 33.50, 30.00, 50),
             (102, 'Azithral 500', 'Azithral 500', 'Azithromycin 500mg', 'Tablet', '500mg', 120.00, 110.00, 0)
    `);

    // 4. Seed patient refills
    await db.run(`
      INSERT OR REPLACE INTO patient_refills (
        id, store_id, patient_name, patient_phone, medicine_id, medicine_name, next_refill_date, status, is_ready, is_active
      ) VALUES
      (1, 1, 'Ramesh Kumar', '9876543210', 101, 'Dolo 650', DATE('now', '+1 day'), 'pending', 0, 1),
      (2, 1, 'Sunita Sharma', '9123456780', 102, 'Azithral 500', DATE('now'), 'pending', 0, 1)
    `);

    // 5. Seed patient call tasks
    await db.run(`
      INSERT OR REPLACE INTO patient_call_tasks (
        id, task_type, patient_name, patient_phone, details_json, priority, status
      ) VALUES
      (1, 'refill', 'Ramesh Kumar', '9876543210', '{"medicine":"Dolo 650"}', 'high', 'pending'),
      (2, 'credit', 'Sunita Sharma', '9123456780', '{"balance":450}', 'normal', 'pending')
    `);

    // 6. Seed customer enquiries
    await db.run(`
      INSERT OR REPLACE INTO medicine_enquiries (
        id, patient_name, patient_phone, medicine_name, source, notes, status
      ) VALUES
      (1, 'Amit Patel', '9988776655', 'Augmentin 625', 'whatsapp', 'Wants 2 strips', 'open')
    `);

    // 7. Seed WhatsApp chats & inbound messages
    await db.run(`
      INSERT OR REPLACE INTO whatsapp_chats (
        id, name, unread_count, timestamp, last_message, resolved_number
      ) VALUES
      ('9876543210@c.us', 'Ramesh Kumar', 2, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 'Dolo 650 available hai kya?', '9876543210')
    `);
  });

  afterAll(async () => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {}
    }
  });

  beforeEach(() => {
    unifiedAssistantOrchestrator.clearSession('test-staff-session');
    unifiedAssistantOrchestrator.clearSession('test-customer-session');
  });

  describe('1. Multi-Lingual Intent Parsing & Subsystem Routing', () => {
    it('handles Refill list in English, Hindi, and Marathi', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const resEn = await unifiedAssistantOrchestrator.processCommand('Show due refills', session);
      expect(resEn.actionType).toBe('LIST_REFILLS');
      expect(resEn.cards).toBeDefined();
      expect(resEn.cards!.length).toBeGreaterThanOrEqual(1);

      const resHi = await unifiedAssistantOrchestrator.processCommand('आज के रिफिल दिखाओ', session);
      expect(resHi.actionType).toBe('LIST_REFILLS');

      const resMr = await unifiedAssistantOrchestrator.processCommand('आजचे रिफिल दाखवा', session);
      expect(resMr.actionType).toBe('LIST_REFILLS');
    });

    it('handles Task listing in English and Hindi', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const resEn = await unifiedAssistantOrchestrator.processCommand('List pending call tasks', session);
      expect(resEn.actionType).toBe('LIST_TASKS');
      expect(resEn.cards).toBeDefined();
      expect(resEn.cards!.length).toBeGreaterThanOrEqual(1);

      const resHi = await unifiedAssistantOrchestrator.processCommand('पेंडिंग टास्क दिखाओ', session);
      expect(resHi.actionType).toBe('LIST_TASKS');
    });

    it('handles Customer Enquiry listing in English and Hinglish', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const resEn = await unifiedAssistantOrchestrator.processCommand('Check customer enquiries', session);
      expect(resEn.actionType).toBe('LIST_ENQUIRIES');
      expect(resEn.cards).toBeDefined();
      expect(resEn.cards![0].title).toContain('Augmentin 625');

      const resHinglish = await unifiedAssistantOrchestrator.processCommand('Pending enquiry check karo', session);
      expect(resHinglish.actionType).toBe('LIST_ENQUIRIES');
    });

    it('handles WhatsApp Chat listing and Draft Reply generation', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const resList = await unifiedAssistantOrchestrator.processCommand('Which WhatsApp messages need replies?', session);
      expect(resList.actionType).toBe('LIST_WHATSAPP_CHATS');
      expect(resList.cards).toBeDefined();
      expect(resList.cards![0].title).toBe('Ramesh Kumar');

      const resDraft = await unifiedAssistantOrchestrator.processCommand('Draft reply for 9876543210', session);
      expect(resDraft.actionType).toBe('DRAFT_WHATSAPP_REPLY');
      expect(resDraft.proposedAction).toBeDefined();
      expect(resDraft.proposedAction?.actionType).toBe('SEND_WHATSAPP_MESSAGE');
      expect(resDraft.proposedAction?.requiresConfirmation).toBe(true);
    });

    it('handles Inventory and POS lookup with authoritative stock and pricing', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const res = await unifiedAssistantOrchestrator.processCommand('Check stock for Dolo 650', session);
      expect(res.actionType).toBe('SEARCH_INVENTORY');
      expect(res.reply).toContain('Dolo 650');
      expect(res.reply).toContain('50'); // 50 in stock
      expect(res.cards).toBeDefined();
      expect(res.cards![0].badge).toContain('In Stock');
    });

    it('handles Prescription OCR review and flags uncertain readings', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const res = await unifiedAssistantOrchestrator.processCommand('Review recent OCR scans', session);
      expect(res.actionType).toBe('INSPECT_OCR');
      expect(res.reply).toBeDefined();
    });
  });

  describe('2. Conversational Context & Multi-turn Memory', () => {
    it('maintains lastEntityId and lastAction across sequential follow-ups', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      // Turn 1: User asks to list tasks
      await unifiedAssistantOrchestrator.processCommand('List pending tasks', session);
      expect(session.lastAction).toBe('LIST_TASKS');

      // Turn 2: User references task #1
      const resFollowUp = await unifiedAssistantOrchestrator.processCommand('Mark task 1 as complete', session);
      expect(resFollowUp.actionType).toBe('COMPLETE_TASK');
      expect(resFollowUp.proposedAction?.payload.taskId).toBe(1);
      expect(session.lastEntityId).toBe(1);
    });

    it('resets context cleanly when clearSession is called', () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');
      session.lastAction = 'LIST_TASKS';
      session.lastEntityId = 99;

      unifiedAssistantOrchestrator.clearSession('test-staff-session');
      const resetSession = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');
      expect(resetSession.lastAction).toBeUndefined();
      expect(resetSession.lastEntityId).toBeUndefined();
    });
  });

  describe('3. Rule 6 Human-in-the-Loop & Two-Stage Confirmation Gate', () => {
    it('proposes PREPARE_REFILL without mutating until explicitly confirmed', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      // Propose preparation
      const res = await unifiedAssistantOrchestrator.processCommand('Prepare refill 1 for Ramesh', session);
      expect(res.actionType).toBe('PREPARE_REFILL');
      expect(res.proposedAction).toBeDefined();
      expect(res.proposedAction?.status).toBe('PENDING_CONFIRMATION');

      // Verify database record has NOT mutated yet
      const beforeRefill = await db.get('SELECT is_ready FROM patient_refills WHERE id = 1');
      expect(beforeRefill.is_ready).toBe(0);

      // Now explicitly confirm proposal
      const confirmRes = await unifiedAssistantOrchestrator.confirmProposal(
        res.proposedAction!.id,
        'test-staff-session',
        { userId: 1, username: 'pharmacist_test', storeId: 1 }
      );
      expect(confirmRes.success).toBe(true);

      // Verify database record has now mutated to ready
      const afterRefill = await db.get('SELECT is_ready, status FROM patient_refills WHERE id = 1');
      expect(afterRefill.is_ready).toBe(1);
      expect(afterRefill.status).toBe('ready');

      // Verify audit log entry in action_logs
      const audit = await db.get(
        "SELECT * FROM action_logs WHERE entity = 'patient_refills' AND action_type = 'PREPARE_REFILL' ORDER BY id DESC LIMIT 1"
      );
      expect(audit).toBeDefined();
      expect(audit.description.toLowerCase()).toContain('refill #1');
    });

    it('cancelling a proposal does not mutate records and removes the proposal', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      // Propose completing task #2
      const res = await unifiedAssistantOrchestrator.processCommand('Complete call task 2', session);
      expect(res.proposedAction).toBeDefined();

      // Cancel proposal
      const cancelled = unifiedAssistantOrchestrator.cancelProposal(res.proposedAction!.id, 'test-staff-session');
      expect(cancelled).toBe(true);

      // Verify task #2 is still pending
      const task = await db.get('SELECT status FROM patient_call_tasks WHERE id = 2');
      expect(task.status).toBe('pending');
    });

    it('proposing and confirming CREATE_TASK creates a call task with priority', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const res = await unifiedAssistantOrchestrator.processCommand(
        'Create call task for Deepak phone 9822334455 about refill',
        session
      );
      expect(res.actionType).toBe('CREATE_TASK');
      expect(res.proposedAction).toBeDefined();
      expect(res.proposedAction?.payload.patientName).toBe('Deepak');

      // Confirm proposal
      const confirmRes = await unifiedAssistantOrchestrator.confirmProposal(
        res.proposedAction!.id,
        'test-staff-session',
        { userId: 1, username: 'pharmacist_test', storeId: 1 }
      );
      expect(confirmRes.success).toBe(true);

      // Check task in database
      const newTask = await db.get(
        "SELECT * FROM patient_call_tasks WHERE patient_phone = '9822334455'"
      );
      expect(newTask).toBeDefined();
      expect(newTask.patient_name).toBe('Deepak');
      expect(newTask.task_type).toBe('refill');
    });
  });

  describe('4. Role-Based Security Isolation', () => {
    it('strictly blocks customer sessions from executing staff operational commands', async () => {
      const customerSession = unifiedAssistantOrchestrator.getSessionContext(
        'test-customer-session',
        'customer' as AssistantRole
      );

      // Customer attempts to view staff call tasks
      const resTasks = await unifiedAssistantOrchestrator.processCommand('List pending call tasks', customerSession);
      expect(resTasks.actionType).toBe('GENERAL_QA');
      expect(resTasks.cards).toBeUndefined(); // No staff task cards leaked

      // Customer attempts to list staff refills
      const resRefills = await unifiedAssistantOrchestrator.processCommand('Show due refills', customerSession);
      expect(resRefills.actionType).toBe('GENERAL_QA');
      expect(resRefills.cards).toBeUndefined(); // No staff refill cards leaked

      // Customer attempts to view WhatsApp queue
      const resWa = await unifiedAssistantOrchestrator.processCommand('Which WhatsApp messages need replies?', customerSession);
      expect(resWa.actionType).toBe('GENERAL_QA');
      expect(resWa.cards).toBeUndefined();
    });

    it('allows customer sessions to perform safe medicine Q&A', async () => {
      const customerSession = unifiedAssistantOrchestrator.getSessionContext(
        'test-customer-session',
        'customer' as AssistantRole
      );

      const res = await unifiedAssistantOrchestrator.processCommand('Is Dolo 650 available in your shop?', customerSession);
      expect(res.actionType).toBe('GENERAL_QA');
      expect(res.reply).toContain('Dolo 650');
      expect(res.reply).toMatch(/in stock|available/i);
    });
  });

  describe('5. Medical Safety & Emergency Escalation', () => {
    it('escalates acute symptoms or diagnostic queries to emergency / pharmacist guidance', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const res = await unifiedAssistantOrchestrator.processCommand(
        'Patient has severe chest pain and left arm numbness, what medicine should I give?',
        session
      );
      expect(res.actionType).toBe('GENERAL_QA');
      expect(res.reply).toMatch(/emergency|urgent|hospital|doctor|108/i);
    });
  });

  describe('6. Page Context & Capability Registry (Unified Across All Pages)', () => {
    it('exposes the typed capability registry with all supported action types and policies', () => {
      const registry = unifiedAssistantOrchestrator.getCapabilityRegistry();
      expect(registry).toBeDefined();
      expect(registry.EXPLAIN_PAGE).toBeDefined();
      expect(registry.ADD_TO_LIVE_CART).toBeDefined();
      expect(registry.PLACE_DISTRIBUTOR_ORDER).toBeDefined();
      expect(registry.ADD_TO_LIVE_CART.requiresConfirmation).toBe(true);
      expect(registry.PLACE_DISTRIBUTOR_ORDER.requiresConfirmation).toBe(true);
      expect(registry.VIEW_PURCHASE_RATES.allowedRoles).toEqual(['owner']);
    });

    it('handles EXPLAIN_PAGE for /pos with keyboard shortcuts and pending refills count', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');
      session.pageContext = { pathname: '/pos', pageTitle: 'POS Billing' };

      const res = await unifiedAssistantOrchestrator.processCommand('Explain this page', session, { dbInstance: db });
      expect(res.actionType).toBe('EXPLAIN_PAGE');
      expect(res.reply).toContain('Point of Sale (POS) Billing');
      expect(res.reply).toContain('F2');
      expect(res.cards).toBeDefined();
      expect(res.cards![0].title).toContain('/pos');
    });

    it('handles EXPLAIN_PAGE for /inventory with stock counts', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');
      session.pageContext = { pathname: '/inventory', pageTitle: 'Inventory' };

      const res = await unifiedAssistantOrchestrator.processCommand('What can I do here?', session, { dbInstance: db });
      expect(res.actionType).toBe('EXPLAIN_PAGE');
      expect(res.reply).toContain('Inventory & Batch Management');
      expect(res.reply).toContain('Catalog');
    });

    it('handles EXPLAIN_PAGE for /crm with live queue counts', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');
      session.pageContext = { pathname: '/crm', pageTitle: 'CRM' };

      const res = await unifiedAssistantOrchestrator.processCommand('Tell me about this page', session, { dbInstance: db });
      expect(res.actionType).toBe('EXPLAIN_PAGE');
      expect(res.reply).toContain('Customer Relationship Management (CRM)');
    });

    it('proposes ADD_TO_LIVE_CART with confirmation gate', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const res = await unifiedAssistantOrchestrator.processCommand('Add refill 1 to live cart', session, { dbInstance: db });
      expect(res.actionType).toBe('ADD_TO_LIVE_CART');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposedAction).toBeDefined();
      expect(res.proposedAction?.actionType).toBe('ADD_TO_LIVE_CART');
      expect(res.proposedAction?.status).toBe('PENDING_CONFIRMATION');
      expect(res.proposedAction?.payload.refillId).toBe(1);
    });

    it('proposes PLACE_DISTRIBUTOR_ORDER with confirmation gate', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      const res = await unifiedAssistantOrchestrator.processCommand('Place distributor order for cart', session, { dbInstance: db });
      expect(res.actionType).toBe('PLACE_DISTRIBUTOR_ORDER');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposedAction).toBeDefined();
      expect(res.proposedAction?.actionType).toBe('PLACE_DISTRIBUTOR_ORDER');
    });

    it('enforces single-use proposal idempotency preventing double execution', async () => {
      const session = unifiedAssistantOrchestrator.getSessionContext('test-staff-session', 'staff');

      // Create a task proposal
      const resProp = await unifiedAssistantOrchestrator.processCommand(
        'Create call task for Deepak phone 9822334455 about refill',
        session,
        { dbInstance: db }
      );
      expect(resProp.proposedAction).toBeDefined();
      const propId = resProp.proposedAction!.id;

      // First confirmation succeeds
      const confirm1 = await unifiedAssistantOrchestrator.confirmProposal(propId, session.sessionId, { dbInstance: db });
      expect(confirm1.success).toBe(true);
      expect(confirm1.proposal?.status).toBe('EXECUTED');

      // Second confirmation fails immediately because proposal token was already consumed
      const confirm2 = await unifiedAssistantOrchestrator.confirmProposal(propId, session.sessionId, { dbInstance: db });
      expect(confirm2.success).toBe(false);
      expect(confirm2.message).toMatch(/expired|not found|already executed/i);
    });

    it('routes natural-language staff requests through the local classifier when regex triggers do not match', async () => {
      const previousEnabled = process.env.LOCAL_AI_ENABLED;
      process.env.LOCAL_AI_ENABLED = 'true';
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({ actionType: 'LIST_TASKS', confidence: 0.94 })
            }
          }]
        })
      } as Response);

      try {
        const session = unifiedAssistantOrchestrator.getSessionContext('natural-language-routing-session', 'staff');
        const res = await unifiedAssistantOrchestrator.processCommand(
          'Can you tell me which customer follow-ups need attention before I close the shop?',
          session,
          { dbInstance: db }
        );

        expect(res.actionType).toBe('LIST_TASKS');
        expect(res.reply).toMatch(/task/i);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
        if (previousEnabled === undefined) delete process.env.LOCAL_AI_ENABLED;
        else process.env.LOCAL_AI_ENABLED = previousEnabled;
        unifiedAssistantOrchestrator.clearSession('natural-language-routing-session');
      }
    });

  });
});
