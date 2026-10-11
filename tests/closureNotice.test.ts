import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { getShopTimingNow, buildShopTimingNote, getRefillScheduleOpts } from '../src/utils/closureNotice.js';

function makeDb() {
  const raw = new Database(':memory:');
  raw.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE pharmacy_holidays (store_id INTEGER, holiday_date TEXT, holiday_name TEXT, name TEXT, is_closed INTEGER);`);
  return {
    raw,
    set: (k: string, v: string) => raw.prepare('INSERT OR REPLACE INTO app_settings VALUES (?,?)').run(k, v),
    run: async (sql: string, p: any[] = []) => raw.prepare(sql).run(...p),
    get: async (sql: string, p: any[] = []) => raw.prepare(sql).get(...p),
    all: async (sql: string, p: any[] = []) => raw.prepare(sql).all(...p),
  };
}

// Times are interpreted in Asia/Kolkata by the helper; 2026-10-11 is a Sunday.
const at = (iso: string) => jest.setSystemTime(new Date(iso));

describe('closureNotice', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval'] });
    db = makeDb();
    db.set('pharmacy_weekly_off', 'Monday');
    db.set('pharmacy_open_time', '09:00');
    db.set('pharmacy_close_time', '22:00');
  });
  afterEach(() => jest.useRealTimers());

  it('is silent while the shop is open', async () => {
    at('2026-10-13T06:30:00Z'); // Tue 12:00 IST
    expect(await getShopTimingNow(db)).toBeNull();
  });

  it('Sunday (sunday orders off) is closed today and reopens Tuesday (Monday weekly off)', async () => {
    at('2026-10-11T06:30:00Z'); // Sun 12:00 IST
    const info = await getShopTimingNow(db);
    expect(info?.closedToday).toBe(true);
    expect(info?.reopenLabel).toMatch(/Tue/);
    expect(buildShopTimingNote(info, 'en', 'pickup')).toContain('closed today');
  });

  it('a holiday during open hours is reported with its name and the next open day', async () => {
    db.set('sunday_orders_enabled', 'true');
    db.raw.prepare(`INSERT INTO pharmacy_holidays VALUES (1,'2026-10-13','Diwali','Diwali',1)`).run();
    at('2026-10-13T06:30:00Z'); // Tue 12:00 IST, inside normal hours
    const info = await getShopTimingNow(db);
    expect(info?.closedToday).toBe(true);
    expect(info?.reason).toContain('Diwali');
    expect(buildShopTimingNote(info, 'en', 'booking')).toContain('Diwali');
  });

  it('market closure counts as closed', async () => {
    db.set('pharmacy_market_closure_config', JSON.stringify({ enabled: true, startDate: '2026-10-13', endDate: '2026-10-14', reason: 'Wholesale Market Closure' }));
    at('2026-10-13T06:30:00Z');
    expect((await getShopTimingNow(db))?.closedToday).toBe(true);
  });

  it('after closing time on an open day reopens tomorrow', async () => {
    at('2026-10-13T17:30:00Z'); // Tue 23:00 IST
    const info = await getShopTimingNow(db);
    expect(info?.closedToday).toBe(false);
    expect(info?.reopenLabel).toContain('tomorrow');
  });

  it('refill options flag a holiday that is tomorrow, not just the weekly off', async () => {
    db.set('sunday_orders_enabled', 'true');
    db.raw.prepare(`INSERT INTO pharmacy_holidays VALUES (1,'2026-10-14','Festival','Festival',1)`).run();
    at('2026-10-13T06:30:00Z');
    const opts = await getRefillScheduleOpts(db, { openTime: '09:00', closeTime: '22:00', weeklyOff: 'Monday' });
    expect(opts.isOffDayUpcoming).toBe(true);
    expect(opts.closedLabel).toContain('Festival');
  });

  it('hindi and marathi notes are produced', () => {
    const info = { closedToday: true, reopenLabel: 'tomorrow (Mon, 12 Oct)', openTime12: '9:00 AM', closeTime12: '10:00 PM' };
    expect(buildShopTimingNote(info, 'hi', 'booking')).toContain('दुकान');
    expect(buildShopTimingNote(info, 'mr', 'pickup')).toContain('दुकान');
  });
});
