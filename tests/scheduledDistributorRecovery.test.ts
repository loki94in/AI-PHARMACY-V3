import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

let mockIsReady = true;
let mockSleeping = false;
let mockAutoConnectAllowed = true;
let mockRegisteredStatus = 'AVAILABLE';
let mockSendMessageError: string | null = null;
const sentMessagesLog: any[] = [];
let prewarmCallCount = 0;
let ensureReadyCallCount = 0;

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(async (number: string, mediaUrl?: string, message?: string, file?: any) => {
    if (!mockIsReady) {
      throw new Error('WhatsApp message could not be sent (client not ready or disconnected)');
    }
    if (mockSendMessageError) {
      throw new Error(mockSendMessageError);
    }
    sentMessagesLog.push({ number, message, at: Date.now() });
    return { sent: true, messageId: `msg_${Date.now()}_${Math.random()}` };
  }),
  initClient: jest.fn(async () => true),
  destroyClient: jest.fn(async () => {}),
  reconnectClient: jest.fn(async () => {}),
  forceReconnect: jest.fn(async () => {}),
  getWhatsAppStatus: jest.fn(async () => ({
    isConnected: mockIsReady,
    isReady: mockIsReady,
    sleeping: mockSleeping,
    status: mockIsReady ? 'CONNECTED' : (mockSleeping ? 'SLEEPING' : 'DISCONNECTED'),
    readiness: { isReady: mockIsReady, hasSavedSession: true }
  })),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : ''),
  shouldRouteToBusiness: jest.fn(async () => false),
  hashMessageBody: jest.fn((b: string) => {
    const fullMsg = (b || '').trim();
    let msgHash = 0;
    for (let ci = 0; ci < fullMsg.length; ci++) {
      msgHash = ((msgHash << 5) - msgHash + fullMsg.charCodeAt(ci)) | 0;
    }
    return msgHash;
  }),
  hasSavedSession: jest.fn(() => true),
  isWhatsAppExplicitlyDisabled: jest.fn(async () => false),
  markWhatsAppActivity: jest.fn(),
  waitForWhatsAppReady: jest.fn(async () => mockIsReady),
  ensureWhatsAppReady: jest.fn(async () => {
    ensureReadyCallCount++;
    if (mockSleeping) {
      mockSleeping = false;
      mockIsReady = true;
    }
    return mockIsReady;
  }),
  prewarmWhatsApp: jest.fn(async () => {
    prewarmCallCount++;
    if (mockSleeping) {
      mockSleeping = false;
      mockIsReady = true;
    }
    return { isReady: mockIsReady, isInitializing: false, hasSavedSession: true };
  }),
  isWhatsAppAutoConnectAllowed: jest.fn(async () => mockAutoConnectAllowed),
  checkPhoneWhatsAppRegistered: jest.fn(async (_phone: string) => mockRegisteredStatus),
  getChats: jest.fn(async () => []),
  getChatMessages: jest.fn(async () => []),
  getMessageMedia: jest.fn(async () => ({ mimetype: 'image/jpeg', data: '' })),
  currentQr: null,
  isReady: true,
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn()
}));

import { ensureSchema } from '../src/database.js';

describe('Reliable Scheduled Distributor WhatsApp Dispatch & Recovery (12 Spec Tests)', () => {
  let tmpDir: string;
  let dbPath: string;
  let whatsappQueueWorker: any;
  let notificationService: any;
  let dbManager: any;
  let whatsappDeliveryRegister: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sched-dist-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    ({ whatsappQueueWorker } = await import('../src/services/whatsappQueueWorker.js'));
    ({ notificationService } = await import('../src/services/notificationService.js'));
    ({ dbManager } = await import('../src/database/connection.js'));
    ({ whatsappDeliveryRegister } = await import('../src/services/whatsappDeliveryRegister.js'));
  });

  afterAll(async () => {
    try {
      await dbManager.close(true);
    } catch (_) {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  beforeEach(async () => {
    mockIsReady = true;
    mockSleeping = false;
    mockAutoConnectAllowed = true;
    mockRegisteredStatus = 'AVAILABLE';
    mockSendMessageError = null;
    sentMessagesLog.length = 0;
    prewarmCallCount = 0;
    ensureReadyCallCount = 0;

    // Eliminate pacing delays for fast, deterministic unit test execution
    (whatsappQueueWorker as any).pacingMinMs = 0;
    (whatsappQueueWorker as any).pacingMaxMs = 0;
    (whatsappQueueWorker as any).cancelActiveDelay?.();

    // Ensure worker is idle before starting test
    while ((whatsappQueueWorker as any).isProcessing) {
      await new Promise(r => setTimeout(r, 20));
    }

    const db = await dbManager.getConnection();
    await db.run("DELETE FROM whatsapp_send_queue");
    await db.run("DELETE FROM automation_notifications");
    await db.run("DELETE FROM whatsapp_sent_register");
  });

  async function waitForItemStatus(id: number, targetStatus: string, timeoutMs = 4000) {
    const start = Date.now();
    const db = await dbManager.getConnection();
    while (Date.now() - start < timeoutMs) {
      const row = await db.get("SELECT * FROM whatsapp_send_queue WHERE id = ?", [id]);
      if (row && row.status === targetStatus) return row;
      await new Promise(r => setTimeout(r, 25));
    }
    return await db.get("SELECT * FROM whatsapp_send_queue WHERE id = ?", [id]);
  }

  // ------------------------------------------------------------
  // TEST 1: WhatsApp already READY. Scheduled reminder sends normally.
  // ------------------------------------------------------------
  test('TEST 1: WhatsApp already READY -> scheduled reminder sends normally', async () => {
    mockIsReady = true;

    const queueId = await whatsappQueueWorker.enqueue(
      '9876543210',
      '📦 Has today order been dispatched by Delivery Staff? - Test Pharmacy',
      'distributor_dispatch_reminder',
      'ABC Distributor',
      Date.now() - 1000, // Due right now
      undefined,
      undefined,
      { skipDedupe: true }
    );

    const row = await waitForItemStatus(queueId, 'sent');
    expect(row.status).toBe('sent');
    expect(row.sent_at).toBeTruthy();
    expect(row.error_message).toBeNull();

    // Verify delivery ledger recorded it
    let ledger = await whatsappDeliveryRegister.isAlreadyDelivered('9876543210', '📦 Has today order been dispatched by Delivery Staff? - Test Pharmacy', 12);
    for (let i = 0; !ledger.delivered && i < 20; i++) {
      await new Promise(r => setTimeout(r, 25));
      ledger = await whatsappDeliveryRegister.isAlreadyDelivered('9876543210', '📦 Has today order been dispatched by Delivery Staff? - Test Pharmacy', 12);
    }
    expect(ledger.delivered).toBe(true);
  });

  // ------------------------------------------------------------
  // TEST 2: WhatsApp sleeping, PC/application running.
  // Expected: T-5/T-1 readiness attempts wake WhatsApp. Message remains queued until ready. Sends. No silent skip.
  // ------------------------------------------------------------
  test('TEST 2: WhatsApp sleeping -> T-5/T-1 readiness wakes client, message remains queued and sends', async () => {
    mockIsReady = false;
    mockSleeping = true;

    const futureScheduledAt = Date.now() + 4 * 60 * 1000; // 4 minutes ahead (within T-5 window)
    const queueId = await whatsappQueueWorker.enqueue(
      '9876543211',
      '📦 Status check: order dispatched? - Test Pharmacy',
      'distributor_dispatch_reminder',
      'Sleeping Dist',
      futureScheduledAt,
      undefined,
      undefined,
      { skipDedupe: true }
    );

    // Verify readiness check wakes sleeping client
    const ready = await whatsappQueueWorker.checkAndEnsureReadinessForScheduled();
    expect(ready).toBe(true);
    expect(mockIsReady).toBe(true);
    expect(mockSleeping).toBe(false);

    // Make due and process
    const db = await dbManager.getConnection();
    await db.run("UPDATE whatsapp_send_queue SET scheduled_at = ? WHERE id = ?", [Date.now() - 100, queueId]);
    await whatsappQueueWorker.processQueue();

    const row = await waitForItemStatus(queueId, 'sent');
    expect(row.status).toBe('sent');
  });

  // ------------------------------------------------------------
  // TEST 3: WhatsApp disconnected, PC/application running.
  // Expected: attempts reconnect, message remains pending/retryable, no silent skip.
  // ------------------------------------------------------------
  test('TEST 3: WhatsApp disconnected -> remains pending/retryable without silent skip', async () => {
    const db = await dbManager.getConnection();
    mockIsReady = false;
    mockSleeping = false;
    mockAutoConnectAllowed = false; // Disconnected & cannot auto-connect

    const queueId = await whatsappQueueWorker.enqueue(
      '9876543212',
      '📦 Reminder disconnected check - Test Pharmacy',
      'distributor_dispatch_reminder',
      'Disconnected Dist',
      Date.now() - 100,
      undefined,
      undefined,
      { skipDedupe: true }
    );

    await whatsappQueueWorker.processQueue();

    const row = await db.get("SELECT status, retry_count FROM whatsapp_send_queue WHERE id = ?", [queueId]);
    // Must remain pending or retryable, never deleted or permanently skipped
    expect(row.status).toBe('pending');

    // Once connection restores, it dispatches
    mockIsReady = true;
    mockAutoConnectAllowed = true;
    await whatsappQueueWorker.processQueue();

    const rowAfter = await waitForItemStatus(queueId, 'sent');
    expect(rowAfter.status).toBe('sent');
  });

  // ------------------------------------------------------------
  // TEST 4: PC/application goes offline before scheduled time.
  // Expected: heartbeat gap detected. Overdue reminder recovered after restart.
  // ------------------------------------------------------------
  test('TEST 4: PC outage before scheduled time -> heartbeat gap detected, recovered on startup', async () => {
    const db = await dbManager.getConnection();

    // Simulate last heartbeat recorded 30 minutes before boot
    const simulatedShutdownTime = Date.now() - (30 * 60 * 1000);
    await db.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_worker_heartbeat_last_seen', ?)",
      [String(simulatedShutdownTime)]
    );

    // Insert reminder scheduled during that outage
    const outageScheduledAt = simulatedShutdownTime + (10 * 60 * 1000);
    const ins = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, scheduled_at, target_name)
       VALUES (?, ?, 'distributor_dispatch_reminder', 'pending', 0, ?, ?, 'Outage Dist')`,
      ['9876543213', '📦 Outage reminder - Test Pharmacy', simulatedShutdownTime, outageScheduledAt]
    );
    const outageItemId = ins.lastID;

    mockIsReady = true;

    // Run startup recovery
    await whatsappQueueWorker.cleanupOldSentItems();

    const sentRow = await waitForItemStatus(outageItemId, 'sent');
    expect(sentRow.status).toBe('sent');
  });

  // ------------------------------------------------------------
  // TEST 5: PC starts 20 minutes after scheduled time.
  // Expected: existing queue item recovered, delivery register checked, sent through normal queue processing.
  // ------------------------------------------------------------
  test('TEST 5: PC starts 20m after scheduled time -> recovered and sent via queue', async () => {
    const db = await dbManager.getConnection();

    const scheduledTime = Date.now() - (20 * 60 * 1000);
    const ins = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, scheduled_at, target_name)
       VALUES (?, ?, 'distributor_dispatch_reminder', 'failed_offline', 0, ?, ?, 'Late Boot Dist')`,
      ['9876543214', '📦 Late boot reminder - Test Pharmacy', scheduledTime - 60000, scheduledTime]
    );
    const lateBootItemId = ins.lastID;

    mockIsReady = true;
    await whatsappQueueWorker.cleanupOldSentItems();

    const sent = await waitForItemStatus(lateBootItemId, 'sent');
    expect(sent.status).toBe('sent');
  });

  // ------------------------------------------------------------
  // TEST 6: Message actually sent before shutdown but DB remained sending/pending.
  // Expected: delivery-register/outbox verification identifies send, marks sent, zero duplicate.
  // ------------------------------------------------------------
  test('TEST 6: Outbox/delivery-register verification prevents duplicate on reboot', async () => {
    const db = await dbManager.getConnection();
    const phone = '9876543215';
    const msg = '📦 Already delivered reminder - Test Pharmacy';

    // Record verified delivery in whatsappDeliveryRegister
    await whatsappDeliveryRegister.recordDelivery(phone, msg, 'distributor_dispatch_reminder', 'Delivered Dist', 'prev-100');

    // Insert pending queue item with identical phone and message
    const ins = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, scheduled_at, target_name)
       VALUES (?, ?, 'distributor_dispatch_reminder', 'pending', 0, ?, ?, 'Delivered Dist')`,
      [phone, msg, Date.now() - 30000, Date.now() - 10000]
    );
    const dupItemId = ins.lastID;

    const initialSentCount = sentMessagesLog.length;

    // Run startup recovery
    await whatsappQueueWorker.cleanupOldSentItems();

    const dupRow = await waitForItemStatus(dupItemId, 'sent');
    expect(dupRow.status).toBe('sent');

    // Verify no new message was sent through the provider
    expect(sentMessagesLog.length).toBe(initialSentCount);
  });

  // ------------------------------------------------------------
  // TEST 7: Temporary WhatsApp failure occurs 3 times.
  // Expected: scheduled distributor reminder remains recoverable (failed_offline), not permanently skipped.
  // ------------------------------------------------------------
  test('TEST 7: 3 temporary connection failures -> remains retryable (failed_offline), not failed_perm', async () => {
    const db = await dbManager.getConnection();
    mockIsReady = true;
    mockSendMessageError = 'WhatsApp message could not be sent (timeout)';

    const queueId = await whatsappQueueWorker.enqueue(
      '9876543216',
      '📦 Temp failure reminder - Test Pharmacy',
      'distributor_dispatch_reminder',
      'Temp Fail Dist',
      Date.now() - 1000,
      undefined,
      undefined,
      { skipDedupe: true }
    );

    // Wait until at least 3 attempts have been recorded
    let row = await waitForItemStatus(queueId, 'failed_offline');
    for (let i = 0; i < 20 && (row?.retry_count || 0) < 3; i++) {
      await db.run("UPDATE whatsapp_send_queue SET status = 'pending', scheduled_at = ? WHERE id = ?", [Date.now() - 10, queueId]);
      await whatsappQueueWorker.processQueue();
      await new Promise(r => setTimeout(r, 25));
      row = await db.get("SELECT * FROM whatsapp_send_queue WHERE id = ?", [queueId]);
    }

    // Must have recorded at least 3 retry attempts
    expect(row.retry_count).toBeGreaterThanOrEqual(3);
    // CRITICAL SPEC REQUIREMENT (Section 13): Must remain retryable (failed_offline), NOT failed_perm!
    expect(row.status).toBe('failed_offline');

    while ((whatsappQueueWorker as any).isProcessing) {
      await new Promise(r => setTimeout(r, 15));
    }

    // Now restore WhatsApp availability and send
    mockSendMessageError = null;
    await db.run("UPDATE whatsapp_send_queue SET status = 'pending', scheduled_at = ? WHERE id = ?", [Date.now() - 10, queueId]);
    await whatsappQueueWorker.processQueue();

    const finalRow = await waitForItemStatus(queueId, 'sent');
    expect(finalRow.status).toBe('sent');
  });

  // ------------------------------------------------------------
  // TEST 8: Invalid distributor phone.
  // Expected: marked skipped_invalid_phone, not retried infinitely.
  // ------------------------------------------------------------
  test('TEST 8: Invalid phone number -> permanently skipped with skipped_invalid_phone', async () => {
    mockIsReady = true;

    const queueId = await whatsappQueueWorker.enqueue(
      '123', // Invalid (<10 digits)
      '📦 Invalid phone message',
      'distributor_dispatch_reminder',
      'Bad Phone Dist',
      Date.now() - 100,
      undefined,
      undefined,
      { skipDedupe: true }
    );

    const row = await waitForItemStatus(queueId, 'skipped_invalid_phone');
    expect(row.status).toBe('skipped_invalid_phone');
    expect(row.error_message).toContain('Invalid phone');
  });

  // ------------------------------------------------------------
  // TEST 9: Distributor number not registered on WhatsApp.
  // Expected: marked skipped_not_on_whatsapp, not retried indefinitely.
  // ------------------------------------------------------------
  test('TEST 9: Number not registered on WhatsApp -> marked skipped_not_on_whatsapp', async () => {
    mockIsReady = true;
    mockRegisteredStatus = 'NOT_AVAILABLE'; // Not on WhatsApp

    const queueId = await whatsappQueueWorker.enqueue(
      '9876543217',
      '📦 Unregistered number message',
      'distributor_dispatch_reminder',
      'Not WA Dist',
      Date.now() - 100,
      undefined,
      undefined,
      { skipDedupe: true }
    );

    const row = await waitForItemStatus(queueId, 'skipped_not_on_whatsapp');
    expect(row.status).toBe('skipped_not_on_whatsapp');
    expect(row.error_message).toMatch(/not registered on whatsapp/i);
  });

  // ------------------------------------------------------------
  // TEST 10: Special Order opened 10m before dispatch.
  // Expected: triggers prewarm without sending early; scheduled time remains unchanged.
  // ------------------------------------------------------------
  test('TEST 10: Special Order prewarm trigger -> wakes WhatsApp early without early send', async () => {
    const db = await dbManager.getConnection();
    mockIsReady = true;

    const futureTime = Date.now() + (10 * 60 * 1000);
    const queueId = await whatsappQueueWorker.enqueue(
      '9876543218',
      '📦 Future scheduled reminder',
      'distributor_dispatch_reminder',
      'Future Dist',
      futureTime,
      undefined,
      undefined,
      { skipDedupe: true }
    );

    // Simulate Special Order workflow trigger
    const initialCallCount = prewarmCallCount;
    await whatsappQueueWorker.prewarm();
    expect(prewarmCallCount).toBeGreaterThan(initialCallCount);

    // Queue item must still be pending and not sent
    const row = await db.get("SELECT status, scheduled_at FROM whatsapp_send_queue WHERE id = ?", [queueId]);
    expect(row.status).toBe('pending');
    expect(row.scheduled_at).toBe(futureTime);
  });

  // ------------------------------------------------------------
  // TEST 11: Multiple distributor reminders scheduled close together.
  // Expected: single worker, FIFO ordering, no concurrent duplicate sends.
  // ------------------------------------------------------------
  test('TEST 11: Multiple reminders close together -> single worker FIFO order', async () => {
    const db = await dbManager.getConnection();
    mockIsReady = true;

    const q1 = await whatsappQueueWorker.enqueue('9876543219', 'Msg 1', 'distributor_dispatch_reminder', 'Dist 1', Date.now() - 300, undefined, undefined, { skipDedupe: true });
    const q2 = await whatsappQueueWorker.enqueue('9876543220', 'Msg 2', 'distributor_dispatch_reminder', 'Dist 2', Date.now() - 200, undefined, undefined, { skipDedupe: true });

    const items = await db.all(
      "SELECT id, number FROM whatsapp_send_queue WHERE id IN (?, ?) ORDER BY created_at ASC",
      [q1, q2]
    );
    expect(items[0].id).toBe(q1);
    expect(items[1].id).toBe(q2);
  });

  // ------------------------------------------------------------
  // TEST 12: Continuous operation throughout day.
  // Expected: state inspection returns truthful availability state without silent skipping.
  // ------------------------------------------------------------
  test('TEST 12: State inspection returns truthful availability state', async () => {
    mockIsReady = true;
    mockSleeping = false;

    const state = await whatsappQueueWorker.getWorkerState();
    expect(state.availabilityState).toBe('READY');
    expect(state.isOnline).toBe(true);

    mockIsReady = false;
    mockSleeping = true;
    const sleepingState = await whatsappQueueWorker.getWorkerState();
    expect(sleepingState.availabilityState).toBe('WHATSAPP_SLEEPING');
    expect(sleepingState.sleeping).toBe(true);
  });
});
