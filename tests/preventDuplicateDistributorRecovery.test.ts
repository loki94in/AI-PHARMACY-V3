import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import { toLocalSqlDateTime } from '../src/utils/localTime.js';
import { notificationService } from '../src/services/notificationService.js';
import { recoverTodayUnnotifiedOrders } from '../src/services/pharmarackOrderSyncService.js';
import { outboundSecurityGateway } from '../src/services/outboundSecurityGateway.js';

describe('Prevent Duplicate Distributor Dispatch on Boot Recovery Tests', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duplicate-dist-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    await ensureSchema(dbPath);
    const db = await dbManager.getConnection();

    // Seed master distributor and phone mapping
    await db.run(
      `INSERT INTO distributors (id, name, phone, email) VALUES (?, ?, ?, ?)`,
      [546, 'AMIT MEDICO', '9960016973', 'amit@example.com']
    );
    await db.run(
      `INSERT OR REPLACE INTO pharmarack_distributor_mappings (store_name, phone) VALUES (?, ?)`,
      ['AMIT MEDICO', '9960016973']
    );

    // Seed delivery boy
    await db.run(
      `INSERT INTO delivery_boys (name, whatsapp_number, is_active) VALUES (?, ?, 1)`,
      ['om route', '919673494959']
    );
  });

  afterAll(async () => {
    try {
      await dbManager.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('Outbound Security Gateway resolves distributor role from pharmarack_distributor_mappings', async () => {
    const db = await dbManager.getConnection();
    const roleInfo = await outboundSecurityGateway.resolveRecipientRole('9960016973', db);
    expect(roleInfo.role).toBe('distributor');
    expect(roleInfo.name).toBe('AMIT MEDICO');
  });

  test('Manual send updates pharmarack_synced_orders.announced_at', async () => {
    const db = await dbManager.getConnection();
    const today = toLocalSqlDateTime().slice(0, 10);

    // Create a synced order for today
    await db.run(
      `INSERT INTO pharmarack_synced_orders (order_no, store_name, order_date, order_amount, announced_at, first_seen_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      ['UOV414', 'AMIT MEDICO', today, 500, Date.now()]
    );

    // Create reminder row
    const insRem = await db.run(
      `INSERT INTO distributor_dispatch_reminders (distributor_id, distributor_name, distributor_phone, date, status, auto_remind)
       VALUES (?, ?, ?, ?, 'Pending', 1)`,
      [546, 'AMIT MEDICO', '9960016973', today]
    );

    // Trigger manual send
    const res = await notificationService.sendDistributorDispatchReminder(
      insRem.lastID!,
      undefined,
      undefined,
      { userClicked: true, orderNos: ['UOV414'] }
    );

    expect(res.ok).toBe(true);

    // Verify pharmarack_synced_orders was stamped with announced_at
    const orderRow = await db.get(
      'SELECT announced_at, announce_result FROM pharmarack_synced_orders WHERE order_no = ?',
      ['UOV414']
    );
    expect(orderRow.announced_at).not.toBeNull();
    expect(orderRow.announce_result).toBe('user_clicked_send');
  });

  test('recoverTodayUnnotifiedOrders suppresses duplicate send when order exists in whatsapp_send_queue or sent_register', async () => {
    const db = await dbManager.getConnection();
    const today = toLocalSqlDateTime().slice(0, 10);

    // Create an unannounced order record
    await db.run(
      `INSERT INTO pharmarack_synced_orders (order_no, store_name, order_date, order_amount, announced_at, first_seen_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      ['ARJ2126363', 'Arjas', today, 1200, Date.now()]
    );

    // Simulate that the message was already recorded in permanent sent register earlier today
    await db.run(
      `INSERT INTO whatsapp_sent_register (phone, phone_last10, message, message_hash, type, sent_at)
       VALUES (?, ?, ?, 'hash_arj', 'distributor_dispatch_reminder', ?)`,
      ['919545547363', '9545547363', '📦 Pharmarack order #ARJ2126363 — has it been dispatched or collected by om route (+91 96734 94959)? - TANAMAY MEDICAL', Date.now()]
    );

    const initialQueueCount = await db.get(
      `SELECT count(*) as c FROM whatsapp_send_queue WHERE message LIKE '%ARJ2126363%'`
    );
    expect(initialQueueCount.c).toBe(0);

    // Run recovery
    const recoveryResult = await recoverTodayUnnotifiedOrders();

    // Verify recovery suppressed sending and enqueued 0 new items
    const postQueueCount = await db.get(
      `SELECT count(*) as c FROM whatsapp_send_queue WHERE message LIKE '%ARJ2126363%'`
    );
    expect(postQueueCount.c).toBe(0);

    // Verify announced_at was healed
    const healedOrder = await db.get(
      'SELECT announced_at, announce_result FROM pharmarack_synced_orders WHERE order_no = ?',
      ['ARJ2126363']
    );
    expect(healedOrder.announced_at).not.toBeNull();
    expect(healedOrder.announce_result).toBe('healed_from_sent_history');
  });
});
