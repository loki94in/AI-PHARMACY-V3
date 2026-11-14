import { jest } from '@jest/globals';
import { isPromotionalOrBroadcastMessage } from '../src/services/intentKeywords.js';
import { notifyAdminOfUnmatchedQuery } from '../src/services/waAdminEscalationService.js';
import { dbManager } from '../src/database/connection.js';
import { whatsappQueueWorker } from '../src/services/whatsappQueueWorker.js';

describe('Promotional Spam & Owner Forwarding Escalation Guard', () => {
  let db: any;
  let enqueuedMessages: any[] = [];

  beforeAll(async () => {
    db = await dbManager.getConnection();
    // Configure admin phone setting for testing
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('admin_whatsapp_number', '919130558910')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('wa_auto_share_admin', 'true')");
  });

  beforeEach(() => {
    enqueuedMessages = [];
    jest.spyOn(whatsappQueueWorker, 'enqueue').mockImplementation(async (...args: any[]) => {
      enqueuedMessages.push(args);
      return { queueId: 123, status: 'QUEUED' } as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isPromotionalOrBroadcastMessage', () => {
    test('detects real-world Jio Set-Top Box marketing broadcast', () => {
      const jioText = `🤯 *Did you know? Only your Jio Set-Top Box can do this!* 👇

_Switch on your Jio Set-Top Box and enjoy:_
📡 *LiveTV* : Get a whole lot more than DTH
🎬 *7+ additional entertainment apps* with JioTV+
💻 *JioPC Welcome Offer* on Jio Set-Top box for *FREE*

👉 Turn on your Jio Set-Top Box now and get more....

_💬 Thinking what to watch on JioHome?_ 
*Follow our WhatsApp Channel for the latest shows, movies & updates👇*`;

      expect(isPromotionalOrBroadcastMessage(jioText)).toBe(true);
    });

    test('detects Domino wallet update promotional text', () => {
      const walletText = `*Wallet Update* Dear Customer, Your wallet has been credited successfully.   Expires *in 7 days*  Thanks for choosing Domino's!`;
      expect(isPromotionalOrBroadcastMessage(walletText)).toBe(true);
    });

    test('detects SEBI investor awareness broadcast with link', () => {
      const sebiText = `For investor awareness and grievance redressal, visit investor.sebi.gov.in/ssis saa₹thi app`;
      expect(isPromotionalOrBroadcastMessage(sebiText)).toBe(true);
    });

    test('detects JioCare support promo link', () => {
      const linkText = `For any support related queries, please chat with JioCare (7000770007) by tapping on the link below. https://t.jio/waof2ca`;
      expect(isPromotionalOrBroadcastMessage(linkText)).toBe(true);
    });

    test('does NOT flag legitimate medicine order in Marathi/Hinglish', () => {
      expect(isPromotionalOrBroadcastMessage('Dolcinac mr gel 1 strip chahiye')).toBe(false);
      expect(isPromotionalOrBroadcastMessage('Sir order pathava')).toBe(false);
      expect(isPromotionalOrBroadcastMessage('Drotaverine 40mg 2 strip bhej do')).toBe(false);
      expect(isPromotionalOrBroadcastMessage('Dolo 650 available ahe ka')).toBe(false);
    });
  });

  describe('notifyAdminOfUnmatchedQuery Guardrails', () => {
    test('strictly suppresses promotional broadcast from escalating to owner', async () => {
      await notifyAdminOfUnmatchedQuery({
        customer: { id: 101, name: 'Spam Sender', phone: '8799936000' },
        medicineName: 'enjoy',
        quantity: 1,
        messageBody: 'Switch on your Jio Set-Top Box and enjoy LiveTV for FREE',
        source: 'text',
        phone: '8799936000'
      });

      expect(enqueuedMessages.length).toBe(0);
    });

    test('strictly suppresses non-pharmaceutical appliance (aata maker) from escalating to owner', async () => {
      await notifyAdminOfUnmatchedQuery({
        customer: { id: 102, name: 'Caller', phone: '9867834727' },
        medicineName: 'aata maker',
        quantity: 1,
        messageBody: 'Aata maker',
        source: 'text',
        phone: '9867834727'
      });

      expect(enqueuedMessages.length).toBe(0);
    });

    test('permits legitimate unmatched medicine query with medicine intent to escalate to owner', async () => {
      const testPhone = '9999988888';
      await db.run('DELETE FROM wa_admin_escalations WHERE customer_phone = ?', [testPhone]);

      await notifyAdminOfUnmatchedQuery({
        customer: { id: 103, name: 'Real Patient', phone: testPhone },
        medicineName: 'SuperRareMedicine',
        quantity: 2,
        unit: 'strip',
        messageBody: 'Bhaiya SuperRareMedicine 500mg tablet 2 strip chahiye urgent',
        source: 'text',
        phone: testPhone
      });

      expect(enqueuedMessages.length).toBe(1);
      const [adminRecipient, messageText, actionType] = enqueuedMessages[0];
      expect(adminRecipient).toBe('919130558910');
      expect(actionType).toBe('admin_escalation_unmatched');
      expect(messageText).toContain('SuperRareMedicine');
      expect(messageText).toContain('Real Patient');
    });
  });
});
