import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { ReturnWindowService, RETURN_WINDOW_MS } from '../src/services/returnWindowService.js';

describe('14-Day Return Window Lifecycle & Human Override', () => {
  let db: Database;
  let service: ReturnWindowService;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        product TEXT,
        requester TEXT,
        phone TEXT,
        qty INTEGER DEFAULT 1,
        status TEXT DEFAULT 'Pending',
        delivery_status TEXT DEFAULT 'pending',
        delivered_at DATETIME,
        return_window_until DATETIME,
        return_status TEXT DEFAULT 'none',
        return_override_reason TEXT,
        return_override_by TEXT,
        return_override_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE order_tracking_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        event_type TEXT,
        event_detail TEXT,
        performed_by TEXT,
        performed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_type TEXT,
        description TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    service = new ReturnWindowService();
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('accurately calculates return_window_until as exactly 14 days after delivered_at', () => {
    const deliveredAt = new Date('2026-09-01T10:00:00.000Z');
    const deadlineStr = service.calculateReturnWindowUntil(deliveredAt);
    const deadline = new Date(deadlineStr);

    const diffMs = deadline.getTime() - deliveredAt.getTime();
    expect(diffMs).toBe(RETURN_WINDOW_MS);
    expect(deadline.toISOString()).toBe('2026-09-15T10:00:00.000Z');
  });

  it('marks an order delivered and starts the 14-day eligibility window', async () => {
    const res = await db.run(
      `INSERT INTO special_orders (product, requester, status, delivery_status) VALUES ('Metformin 500mg', 'Charlie', 'Pending', 'pending')`
    );
    const orderId = Number(res.lastID);

    const deliveryTime = new Date('2026-09-01T12:00:00Z');
    const returnInfo = await service.markDelivered(orderId, deliveryTime, db);

    expect(returnInfo.deliveryStatus).toBe('delivered');
    expect(returnInfo.returnStatus).toBe('eligible');
    expect(returnInfo.isEligible).toBe(true);
    expect(returnInfo.returnWindowUntil).toBe('2026-09-15T12:00:00.000Z');

    const updated = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    expect(updated.delivery_status).toBe('delivered');
    expect(updated.return_status).toBe('eligible');
    expect(updated.return_window_until).toBe('2026-09-15T12:00:00.000Z');
  });

  it('auto-closes expired return windows without deleting records or corrupting history', async () => {
    // Insert order delivered 20 days ago (expired window)
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

    const res1 = await db.run(
      `INSERT INTO special_orders (product, requester, delivery_status, delivered_at, return_window_until, return_status)
       VALUES ('Old Medicine', 'Dave', 'delivered', ?, ?, 'eligible')`,
      [twentyDaysAgo, sixDaysAgo]
    );

    // Insert order delivered 2 days ago (active window)
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const twelveDaysFuture = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString();

    const res2 = await db.run(
      `INSERT INTO special_orders (product, requester, delivery_status, delivered_at, return_window_until, return_status)
       VALUES ('Fresh Medicine', 'Eve', 'delivered', ?, ?, 'eligible')`,
      [twoDaysAgo, twelveDaysFuture]
    );

    const closedCount = await service.checkAndCloseExpiredReturnWindows(db);
    expect(closedCount).toBe(1);

    const expiredOrder = await db.get('SELECT * FROM special_orders WHERE id = ?', [Number(res1.lastID)]);
    expect(expiredOrder.return_status).toBe('expired');

    const activeOrder = await db.get('SELECT * FROM special_orders WHERE id = ?', [Number(res2.lastID)]);
    expect(activeOrder.return_status).toBe('eligible');
  });

  it('allows human exception override with immutable audit logging', async () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

    const res = await db.run(
      `INSERT INTO special_orders (product, requester, delivery_status, delivered_at, return_window_until, return_status)
       VALUES ('Prescription Inhaler', 'Frank', 'delivered', ?, ?, 'expired')`,
      [twentyDaysAgo, sixDaysAgo]
    );
    const orderId = Number(res.lastID);

    // Apply human override by Head Pharmacist
    const overrideResult = await service.applyReturnOverride(
      orderId,
      { overrideBy: 'Pharmacist Dr. Sharma', reason: 'Defective inhaler nozzle confirmed by manufacturer recall' },
      db
    );

    expect(overrideResult.returnStatus).toBe('override_approved');
    expect(overrideResult.isEligible).toBe(true);
    expect(overrideResult.overrideBy).toBe('Pharmacist Dr. Sharma');

    // Verify audit logs
    const actionLog = await db.get('SELECT * FROM action_logs WHERE action_type = "return_override"');
    expect(actionLog).toBeDefined();
    expect(actionLog.description).toContain('Dr. Sharma');

    const trackingEvent = await db.get('SELECT * FROM order_tracking_events WHERE event_type = "return_override"');
    expect(trackingEvent).toBeDefined();
    expect(trackingEvent.performed_by).toBe('Pharmacist Dr. Sharma');
  });
});
