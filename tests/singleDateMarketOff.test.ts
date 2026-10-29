import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { isClosedDay, advanceToNextOpenDay } from '../src/utils/pharmacyCalendar.js';
import { getShopTimingNow } from '../src/utils/closureNotice.js';
import { OrderScheduleService } from '../src/services/orderScheduleService.js';

function makeDb() {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pharmacy_holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER DEFAULT 1,
      holiday_date TEXT NOT NULL,
      holiday_name TEXT NOT NULL,
      name TEXT,
      is_closed INTEGER DEFAULT 1,
      custom_window_start TEXT,
      custom_window_end TEXT,
      open_time TEXT,
      close_time TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE special_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER DEFAULT 1,
      product TEXT,
      requester TEXT,
      phone TEXT,
      qty INTEGER DEFAULT 1,
      status TEXT DEFAULT 'Pending',
      date TEXT,
      scheduled_processing_at DATETIME,
      estimated_delivery_start DATETIME,
      estimated_delivery_end DATETIME,
      cutoff_at DATETIME,
      pharmacy_timezone TEXT,
      schedule_status TEXT DEFAULT 'standard',
      schedule_reason TEXT,
      schedule_version INTEGER DEFAULT 1,
      schedule_calculated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return {
    raw,
    set: (k: string, v: string) => raw.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?,?)').run(k, v),
    run: async (sql: string, p: any[] = []) => raw.prepare(sql).run(...p),
    get: async (sql: string, p: any[] = []) => raw.prepare(sql).get(...p),
    all: async (sql: string, p: any[] = []) => raw.prepare(sql).all(...p),
  };
}

const at = (iso: string) => jest.setSystemTime(new Date(iso));

describe('Single-Date Market Off and Store Close Isolation', () => {
  let db: ReturnType<typeof makeDb>;
  let orderScheduleService: OrderScheduleService;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval'] });
    db = makeDb();
    db.set('pharmacy_weekly_off', 'none');
    db.set('pharmacy_open_time', '09:00');
    db.set('pharmacy_close_time', '22:00');
    db.set('pharmacy_cutoff_time', '23:00');
    db.set('delivery_window_start', '10:00');
    db.set('delivery_window_end', '13:00');
    db.set('sunday_orders_enabled', 'false');
    orderScheduleService = new OrderScheduleService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marking only date 23 as market off treats ONLY date 23 as market off, not 24, 25, 26', async () => {
    // 2026-10-23 is Friday. 2026-10-24 is Saturday.
    // Simulate user toggling date 23 as market closed (stored in pharmarack_paused_dispatch_dates & closure config)
    db.set('pharmarack_paused_dispatch_dates', JSON.stringify(['2026-10-23']));
    db.set('pharmacy_market_closure_config', JSON.stringify({
      enabled: true,
      type: 'market_closed',
      startDate: '2026-10-23',
      endDate: '2026-10-23',
      reason: 'Wholesale Market Closed'
    }));

    // Date 23: Market dispatch is closed, but store is open for customers
    const check23 = await isClosedDay('2026-10-23', 1, db);
    expect(check23.isMarketClosed).toBe(true);
    expect(check23.isPausedDispatch).toBe(true);
    expect(check23.isDispatchClosed).toBe(true);
    expect(check23.isStoreClosed).toBe(false);
    expect(check23.isClosed).toBe(false);

    // Date 24: Saturday - market is OPEN, dispatch is OPEN, store is OPEN
    const check24 = await isClosedDay('2026-10-24', 1, db);
    expect(check24.isMarketClosed).toBe(false);
    expect(check24.isPausedDispatch).toBe(false);
    expect(check24.isDispatchClosed).toBe(false);
    expect(check24.isStoreClosed).toBe(false);
    expect(check24.isClosed).toBe(false);

    // Date 26: Monday - market is OPEN, dispatch is OPEN, store is OPEN
    const check26 = await isClosedDay('2026-10-26', 1, db);
    expect(check26.isMarketClosed).toBe(false);
    expect(check26.isDispatchClosed).toBe(false);
    expect(check26.isStoreClosed).toBe(false);
    expect(check26.isClosed).toBe(false);
  });

  it('delivery advances from date 23 directly to date 24 without skipping upcoming days', async () => {
    db.set('pharmarack_paused_dispatch_dates', JSON.stringify(['2026-10-23']));
    db.set('pharmacy_market_closure_config', JSON.stringify({
      enabled: true,
      type: 'market_closed',
      startDate: '2026-10-23',
      endDate: '2026-10-23',
      reason: 'Wholesale Market Closed'
    }));

    const nextOpen = await advanceToNextOpenDay(new Date('2026-10-23T10:00:00+05:30'), {
      dbInstance: db,
      advanceAtLeastOneDay: true,
      forDelivery: true
    });

    // Must deliver on Saturday 2026-10-24, NOT skipping past 24 to 25/26/27
    expect(nextOpen.ymd).toBe('2026-10-24');
    expect(nextOpen.daysAdvanced).toBe(1);
  });

  it('an order placed on market-off date 23 calculates delivery for date 24 with holiday/market shift', async () => {
    db.set('pharmarack_paused_dispatch_dates', JSON.stringify(['2026-10-23']));
    db.set('pharmacy_market_closure_config', JSON.stringify({
      enabled: true,
      type: 'market_closed',
      startDate: '2026-10-23',
      endDate: '2026-10-23',
      reason: 'Wholesale Market Closed'
    }));

    // Placed at 11:00 AM on Friday 2026-10-23
    const orderTime = new Date('2026-10-23T11:00:00+05:30');
    const schedule = await orderScheduleService.calculateOrderSchedule(orderTime, 1, db);

    expect(schedule.scheduleStatus).toBe('holiday_shift');
    const deliveryDate = new Date(schedule.estimatedDeliveryStart);
    // 2026-10-24 is Saturday (day 6)
    expect(deliveryDate.getDay()).toBe(6);
    expect(deliveryDate.toISOString().slice(0, 10)).toBe('2026-10-24');
  });

  it('getShopTimingNow does not claim the pharmacy is closed when only wholesale market is closed', async () => {
    db.set('pharmarack_paused_dispatch_dates', JSON.stringify(['2026-10-23']));
    db.set('pharmacy_market_closure_config', JSON.stringify({
      enabled: true,
      type: 'market_closed',
      startDate: '2026-10-23',
      endDate: '2026-10-23',
      reason: 'Wholesale Market Closed'
    }));

    at('2026-10-23T06:30:00Z'); // 12:00 PM IST on Friday (open hours)
    const timing = await getShopTimingNow(db);
    // Since store is open for walk-ins/orders, timing notice must be null (not closed)
    expect(timing).toBeNull();
  });
});

