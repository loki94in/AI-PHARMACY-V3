import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { OrderScheduleService } from '../src/services/orderScheduleService.js';
import { ReturnWindowService } from '../src/services/returnWindowService.js';

describe('OrderScheduleService & Fulfilment Timing Engine', () => {
  let db: Database;
  let scheduleService: OrderScheduleService;
  let returnService: ReturnWindowService;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE pharmacy_holidays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        holiday_date TEXT NOT NULL,
        holiday_name TEXT NOT NULL,
        is_closed INTEGER DEFAULT 1,
        custom_window_start TEXT,
        custom_window_end TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store_id, holiday_date)
      );

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
        scheduled_processing_at DATETIME,
        estimated_delivery_start DATETIME,
        estimated_delivery_end DATETIME,
        cutoff_at DATETIME,
        pharmacy_timezone TEXT,
        schedule_status TEXT DEFAULT 'standard',
        schedule_reason TEXT,
        schedule_version INTEGER DEFAULT 1,
        schedule_calculated_at DATETIME,
        schedule_overridden_by TEXT,
        schedule_overridden_at DATETIME,
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

      CREATE TABLE patient_refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        patient_name TEXT,
        patient_phone TEXT,
        medicine_id INTEGER,
        refill_interval_days INTEGER DEFAULT 30,
        quantity_needed INTEGER DEFAULT 1,
        last_refill_date TEXT,
        next_refill_date TEXT,
        is_active INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active',
        paused_at DATETIME,
        pause_reason TEXT,
        resume_at DATETIME,
        pause_duration_seconds INTEGER DEFAULT 0,
        refill_schedule_version INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default timing settings
    await db.exec(`
      INSERT INTO app_settings (key, value) VALUES
        ('pharmacy_cutoff_time', '23:00'),
        ('delivery_window_start', '19:00'),
        ('delivery_window_end', '21:00'),
        ('sunday_orders_enabled', 'false'),
        ('sunday_window_start', '10:00'),
        ('sunday_window_end', '14:00'),
        ('holiday_delivery_enabled', 'false'),
        ('return_window_days', '15'),
        ('refill_pause_recalculation_enabled', 'true');
    `);

    scheduleService = new OrderScheduleService();
    returnService = new ReturnWindowService();
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('schedules same-day delivery window for order placed before 11:00 PM cutoff', async () => {
    // Wednesday 2:00 PM (14:00) IST
    const orderTime = new Date('2026-09-02T14:00:00+05:30');
    const schedule = await scheduleService.calculateOrderSchedule(orderTime, 1, db);

    expect(schedule.isNextDayCutoff).toBe(false);
    expect(schedule.isSundayShift).toBe(false);
    expect(schedule.isHolidayShift).toBe(false);
    expect(schedule.cutoffTime).toBe('23:00');
    expect(schedule.estimatedDeliveryWindowFormatted).toContain('7:00 PM – 9:00 PM');
    expect(schedule.scheduleStatus).toBe('standard');
  });

  it('rolls over to next operating day when order is placed after 11:00 PM cutoff', async () => {
    // Wednesday 11:15 PM (23:15) IST
    const orderTime = new Date('2026-09-02T23:15:00+05:30');
    const schedule = await scheduleService.calculateOrderSchedule(orderTime, 1, db);

    expect(schedule.isNextDayCutoff).toBe(true);
    expect(schedule.scheduleReason).toContain('post-cutoff');
    // Processing date should be Thursday
    const processingDate = new Date(schedule.scheduledProcessingAt);
    expect(processingDate.getDate()).toBe(3); // 3rd Sept 2026
  });

  it('shifts Sunday orders to Monday when Sunday deliveries are closed', async () => {
    // Sunday 11:00 AM IST
    const sundayOrderTime = new Date('2026-09-06T11:00:00+05:30'); // Sept 6, 2026 is Sunday
    const schedule = await scheduleService.calculateOrderSchedule(sundayOrderTime, 1, db);

    expect(schedule.isSundayShift).toBe(true);
    expect(schedule.scheduleReason).toContain('Sunday');
    const deliveryDate = new Date(schedule.estimatedDeliveryStart);
    // Should be Monday Sept 7, 2026
    expect(deliveryDate.getDay()).toBe(1); // Monday
  });

  it('honors Sunday operating hours when Sunday orders are explicitly enabled', async () => {
    await db.run(`UPDATE app_settings SET value = 'true' WHERE key = 'sunday_orders_enabled'`);
    await db.run(`UPDATE app_settings SET value = '10:00' WHERE key = 'sunday_window_start'`);
    await db.run(`UPDATE app_settings SET value = '14:00' WHERE key = 'sunday_window_end'`);

    const sundayMorning = new Date('2026-09-06T09:00:00+05:30'); // Sunday before 10 AM
    const schedule = await scheduleService.calculateOrderSchedule(sundayMorning, 1, db);

    expect(schedule.isSundayShift).toBe(false);
    expect(schedule.estimatedDeliveryWindowFormatted).toContain('10:00 AM – 2:00 PM');
  });

  it('shifts delivery past closed calendar holidays to next operating day', async () => {
    // Add Gandhi Jayanti on Friday Oct 2, 2026
    await db.run(
      `INSERT INTO pharmacy_holidays (store_id, holiday_date, holiday_name, is_closed)
       VALUES (1, '2026-10-02', 'Gandhi Jayanti', 1)`
    );

    // Place order on Oct 2 at 10:00 AM
    const holidayOrderTime = new Date('2026-10-02T10:00:00+05:30');
    const schedule = await scheduleService.calculateOrderSchedule(holidayOrderTime, 1, db);

    expect(schedule.isHolidayShift).toBe(true);
    expect(schedule.scheduleReason).toContain('Gandhi Jayanti');
    const deliveryDate = new Date(schedule.estimatedDeliveryStart);
    // Next day Saturday Oct 3, 2026
    expect(deliveryDate.getDate()).toBe(3);
  });

  it('supports staff manual ETA overrides', async () => {
    const res = await db.run(
      `INSERT INTO special_orders (product, requester, status) VALUES ('Paracetamol 650', 'Anita', 'Pending')`
    );
    const orderId = Number(res.lastID);

    const overriddenStart = '2026-09-05T20:00:00+05:30';
    const overriddenEnd = '2026-09-05T21:30:00+05:30';
    const updated = await scheduleService.overrideOrderSchedule(orderId, {
      estimatedDeliveryStart: overriddenStart,
      estimatedDeliveryEnd: overriddenEnd,
      reason: 'Customer requested 8:00 PM delivery',
      overrideBy: 'Dr. Sharma'
    }, db);

    expect(updated).not.toBeNull();
    expect(updated.schedule_status).toBe('overridden');
    expect(updated.schedule_reason).toBe('Customer requested 8:00 PM delivery');
    expect(updated.schedule_overridden_by).toBe('Dr. Sharma');

    const orderRow = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    expect(orderRow.schedule_status).toBe('overridden');
    expect(orderRow.schedule_overridden_by).toBe('Dr. Sharma');
  });

  it('evaluates return window dynamically according to configured return_window_days (15 days default)', async () => {
    const configuredDays = await returnService.getConfiguredReturnWindowDays(1, db);
    expect(configuredDays).toBe(15);

    const deliveredAt = new Date('2026-09-01T12:00:00.000Z');
    const deadline = returnService.calculateReturnWindowUntil(deliveredAt, configuredDays);
    const deadlineDate = new Date(deadline);

    // Difference must be exactly 15 days in milliseconds
    const expectedDiffMs = 15 * 24 * 60 * 60 * 1000;
    expect(deadlineDate.getTime() - deliveredAt.getTime()).toBe(expectedDiffMs);
    expect(deadlineDate.toISOString()).toBe('2026-09-16T12:00:00.000Z');
  });

  it('adjusts return window dynamically when return_window_days is updated in settings', async () => {
    await db.run(`UPDATE app_settings SET value = '30' WHERE key = 'return_window_days'`);
    const configuredDays = await returnService.getConfiguredReturnWindowDays(1, db);
    expect(configuredDays).toBe(30);

    const deliveredAt = new Date('2026-09-01T12:00:00.000Z');
    const deadline = returnService.calculateReturnWindowUntil(deliveredAt, configuredDays);
    const deadlineDate = new Date(deadline);

    const expectedDiffMs = 30 * 24 * 60 * 60 * 1000;
    expect(deadlineDate.getTime() - deliveredAt.getTime()).toBe(expectedDiffMs);
  });
});
