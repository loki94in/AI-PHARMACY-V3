import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate WhatsApp auth dir
process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-spam-shield-auth-'));

const enqueueMock = jest.fn((..._args: any[]) => Promise.resolve({ id: 1 }));
jest.unstable_mockModule('../src/services/whatsappQueueWorker.js', () => ({
  __esModule: true,
  whatsappQueueWorker: {
    enqueue: enqueueMock,
    forceNext: jest.fn(() => Promise.resolve())
  }
}));

jest.unstable_mockModule('../src/services/pharmarackCatalogCache.js', () => ({
  __esModule: true,
  searchCatalog: jest.fn(() => Promise.resolve([])),
  scoreProductName: jest.fn(() => 0),
  pharmarackCatalogCache: {
    syncCatalog: jest.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
    searchCatalog: jest.fn(() => Promise.resolve([]))
  },
  ensureCatalogSyncCron: jest.fn(),
  stopCatalogSyncCron: jest.fn()
}));

jest.unstable_mockModule('../src/services/scispacyClient.js', () => ({
  __esModule: true,
  queryScispacy: jest.fn(() => Promise.resolve(null)),
  startScispacySidecar: jest.fn(),
  stopScispacySidecar: jest.fn()
}));

import { ensureSchema } from '../src/database.js';

describe('WhatsApp Onboarding, Spam Shield & Escalation Integration Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let handleInbound: any;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-onboard-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    db = await dbManager.getConnection();

    // Configure admin phone for escalation
    await db.run(
      `INSERT INTO app_settings (key, value) VALUES ('admin_whatsapp', '919800000000')
       ON CONFLICT(key) DO UPDATE SET value = '919800000000'`
    );

    handleInbound = (await import('../src/services/whatsappIntentService.js')).handleInbound;
  }, 60000);

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    enqueueMock.mockClear();
  });

  // ── TEST 1: Silent reaction filter (Emojis) ─────────────────────────────────
  test('1. Emoji-only reactions (thumbs up, prayer, heart) are silently handled without bot replies', async () => {
    const phone = '918000000001';
    const mockMsg = {
      from: `${phone}@c.us`,
      body: '👍',
      id: { _serialized: 'msg-emoji-01' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 400));

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  // ── TEST 2: Casual fillers filter ──────────────────────────────────────────
  test('2. Casual chat fillers ("acha", "hmm", "samjha", "mast") do not trigger bot menus', async () => {
    const phone = '918000000002';
    const mockMsg = {
      from: `${phone}@c.us`,
      body: 'accha',
      id: { _serialized: 'msg-filler-01' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 400));

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  // ── TEST 3: Unknown sender onboarding (Ask for name first) ───────────────────
  test('3. Unknown sender with unparsed message is prompted for name first; original query preserved', async () => {
    const phone = '918000000003';
    const rawQuery = 'hello sir how are you doing today please';
    const mockMsg = {
      from: `${phone}@c.us`,
      body: rawQuery,
      id: { _serialized: 'msg-onboard-01' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 500));

    // Verify bot queued an ask-name greeting
    const greetingCall = (enqueueMock.mock.calls as any[][]).find(c => c[2] === 'customer_greeting');
    expect(greetingCall).toBeDefined();
    expect(String(greetingCall?.[1])).toContain('Welcome');
    expect(String(greetingCall?.[1]).toLowerCase()).toContain('name');

    // Verify session state is awaiting_customer_name
    const session = await db.get(
      `SELECT step, original_query FROM wa_pending_clarifications WHERE phone = ?`,
      ['8000000003']
    );
    expect(session).toBeDefined();
    expect(session.step).toBe('awaiting_customer_name');
    expect(session.original_query).toBe(rawQuery);
  });

  // ── TEST 4: Customer provides name -> Welcome menu + awaiting_order_type ────
  test('4. Customer replies with name -> Saves customer and presents 4-choice Quick-Start Guide', async () => {
    const phone = '918000000003';
    const mockMsg = {
      from: `${phone}@c.us`,
      body: 'Rajesh Patil',
      id: { _serialized: 'msg-onboard-02' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 500));

    // Verify customer record created/updated
    const cust = await db.get(`SELECT name FROM customers WHERE phone LIKE '%8000000003'`);
    expect(cust).toBeDefined();
    expect(cust.name).toBe('Rajesh Patil');

    // Verify welcome menu queued with 4 options
    const menuCall = (enqueueMock.mock.calls as any[][]).find(c => String(c[1]).includes('1️⃣ Single Medicine'));
    expect(menuCall).toBeDefined();
    const sentText = String(menuCall?.[1] || '');
    expect(sentText).toContain('Rajesh Patil');
    expect(sentText).toContain('1️⃣ Single Medicine');
    expect(sentText).toContain('2️⃣ Multiple Medicines');
    expect(sentText).toContain('3️⃣ Refill');
    expect(sentText).toContain('4️⃣ Store Hours');

    // Verify state transitioned to awaiting_order_type
    const session = await db.get(
      `SELECT step, customer_name FROM wa_pending_clarifications WHERE phone = ?`,
      ['8000000003']
    );
    expect(session.step).toBe('awaiting_order_type');
    expect(session.customer_name).toBe('Rajesh Patil');
  });

  // ── TEST 5: Option 4 (Store info, hours, pharmacist phone) ──────────────────
  test('5. Customer selects Option 4 -> Returns store info and keeps session active for ordering', async () => {
    const phone = '918000000003';
    const mockMsg = {
      from: `${phone}@c.us`,
      body: '4',
      id: { _serialized: 'msg-onboard-03' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 500));

    const infoCall = (enqueueMock.mock.calls as any[][]).find(c => c[2] === 'customer_medicine_clarification');
    expect(infoCall).toBeDefined();
    const sentText = String(infoCall?.[1] || '');
    expect(sentText).toContain('Store Info');
    expect(sentText).toContain('Hours');

    // Session must remain awaiting_order_type
    const session = await db.get(
      `SELECT step FROM wa_pending_clarifications WHERE phone = ?`,
      ['8000000003']
    );
    expect(session.step).toBe('awaiting_order_type');
  });

  // ── TEST 6: Strike 1 - Compact reminder (No full menu spam) ─────────────────
  test('6. Unrecognized message during active session sends compact 1-line prompt, not full menu', async () => {
    const phone = '918000000003';
    const mockMsg = {
      from: `${phone}@c.us`,
      body: 'what is this system?',
      id: { _serialized: 'msg-strike-01' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 500));

    const promptCall = (enqueueMock.mock.calls as any[][]).find(c => c[2] === 'customer_medicine_clarification');
    expect(promptCall).toBeDefined();
    const sentText = String(promptCall?.[1] || '');
    // Must be compact gentle reminder, NOT the full 15-line welcomeMenu with step 1, 2, 3
    expect(sentText).toContain('Would you like to *order a medicine*');
    expect(sentText).not.toContain('Step 2: We show you options');

    // unrecognized_count incremented to 1
    const session = await db.get(
      `SELECT unrecognized_count FROM wa_pending_clarifications WHERE phone = ?`,
      ['8000000003']
    );
    expect(Number(session.unrecognized_count)).toBe(1);
  });

  // ── TEST 7: Strike 2 - Silence session and alert store pharmacist ────────────
  test('7. Second unrecognized message triggers Strike 2 silence and owner escalation', async () => {
    const phone = '918000000003';
    const mockMsg = {
      from: `${phone}@c.us`,
      body: 'still confused tell me',
      id: { _serialized: 'msg-strike-02' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 500));

    // Customer should receive pharmacist handover notice
    const customerNoticeCall = (enqueueMock.mock.calls as any[][]).find(
      c => c[2] === 'customer_medicine_clarification' && String(c[1]).includes('counter pharmacist')
    );
    expect(customerNoticeCall).toBeDefined();

    // Owner should receive admin escalation WhatsApp message
    const ownerEscalationCall = (enqueueMock.mock.calls as any[][]).find(c => c[2] === 'admin_escalation');
    expect(ownerEscalationCall).toBeDefined();
    const escalationText = String(ownerEscalationCall?.[1] || '');
    expect(escalationText).toContain('Bot Escalation');
    expect(escalationText).toContain('Rajesh Patil');
    expect(escalationText).toContain('still confused');

    // Pending clarification session cleared/silenced
    const session = await db.get(
      `SELECT step FROM wa_pending_clarifications WHERE phone = ?`,
      ['8000000003']
    );
    expect(session).toBeUndefined();
  });

  // ── TEST 8: Human-in-the-loop manual session suppresses bot replies ─────────
  test('8. When chat is in manual mode (pharmacist takeover), bot stays silent', async () => {
    const phone = '918000000008';
    const chatId = `${phone}@c.us`;

    // Put chat into manual mode
    const untilMs = Date.now() + 2 * 3600 * 1000;
    await db.run(
      `INSERT INTO whatsapp_chats (id, name, session_mode, manual_active_until)
       VALUES (?, 'Manual User', 'manual', ?)
       ON CONFLICT(id) DO UPDATE SET session_mode = 'manual', manual_active_until = ?`,
      [chatId, untilMs, untilMs]
    );

    const mockMsg = {
      from: chatId,
      body: 'Can I speak to someone please?',
      id: { _serialized: 'msg-manual-01' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 400));

    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
