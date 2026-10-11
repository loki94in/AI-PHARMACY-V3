/**
 * One source for "is the shop closed / when do we reopen" wording in customer messages.
 * Uses the full closed-day check (weekly off, Sunday policy, holidays, custom closed dates,
 * paused dispatch, market closure) from pharmacyCalendar, plus open/close hours.
 * Every customer-facing order / refill message (booking, ready-for-pickup, refill reminder,
 * refill confirmation, online order pickup) appends this so a closure is never missed.
 */
import { dbManager } from '../database/connection.js';
import { isClosedDay, advanceToNextOpenDay } from './pharmacyCalendar.js';

export interface ShopTimingNow {
  closedToday: boolean;
  /** Why today is closed (holiday/market/custom). Not set for a plain weekly off. */
  reason?: string;
  /** 'today' | 'tomorrow' | 'Mon, 13 Oct' — when the shop is next open. */
  reopenLabel: string;
  openTime12: string;
  closeTime12: string;
}

export type TimingNoteKind = 'booking' | 'pickup';

export function formatTime12h(time24: string): string {
  const [hh, mm] = String(time24 || '09:00').split(':');
  let h = parseInt(hh, 10);
  if (isNaN(h)) h = 9;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${(mm || '00').padStart(2, '0')} ${ampm}`;
}

const istNow = (): Date => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

export function formatDayLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

async function readHours(db: any): Promise<{ open: string; close: string }> {
  const rows = await db.all(`SELECT key, value FROM app_settings WHERE key IN ('pharmacy_open_time','pharmacy_close_time')`).catch(() => []);
  const m = new Map<string, string>((rows || []).map((r: any) => [String(r.key), String(r.value)]));
  return { open: m.get('pharmacy_open_time') || '09:00', close: m.get('pharmacy_close_time') || '22:00' };
}

function relativeLabel(target: Date, now: Date): string {
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((t - n) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return `tomorrow (${formatDayLabel(target)})`;
  return formatDayLabel(target);
}

/** null = shop is open right now. */
export async function getShopTimingNow(dbInstance?: any): Promise<ShopTimingNow | null> {
  const db = dbInstance || (await dbManager.getConnection());
  const now = istNow();
  const { open, close } = await readHours(db);
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const openMin = (oh || 9) * 60 + (om || 0);
  const closeMin = (ch || 22) * 60 + (cm || 0);

  const today = await isClosedDay(now, 1, db);
  const base = { openTime12: formatTime12h(open), closeTime12: formatTime12h(close) };

  if (today.isClosed) {
    const next = await advanceToNextOpenDay(now, { dbInstance: db, advanceAtLeastOneDay: true });
    return { ...base, closedToday: true, reason: today.isWeeklyOff ? undefined : today.reason, reopenLabel: relativeLabel(next.targetDate, now) };
  }
  if (cur < openMin) return { ...base, closedToday: false, reopenLabel: 'today' };
  if (cur >= closeMin) {
    const next = await advanceToNextOpenDay(now, { dbInstance: db, advanceAtLeastOneDay: true });
    return { ...base, closedToday: false, reopenLabel: relativeLabel(next.targetDate, now) };
  }
  return null;
}

export function buildShopTimingNote(info: ShopTimingNow | null, lang: string = 'en', kind: TimingNoteKind = 'booking'): string {
  if (!info) return '';
  const why = info.reason ? ` (${info.reason})` : '';
  const l = (lang || 'en').toLowerCase();
  if (l === 'hi') {
    const state = info.closedToday ? `हमारी दुकान आज बंद है${why}।` : 'हमारी दुकान अभी बंद है।';
    const when = info.reopenLabel === 'today' ? `हम आज ${info.openTime12} पर खुलेंगे।` : `हम ${info.reopenLabel} को ${info.openTime12} पर फिर खुलेंगे।`;
    const tail = kind === 'pickup' ? ' कृपया तब दवाई ले जाएं।' : ' आपका ऑर्डर सुरक्षित दर्ज है।';
    return `\n\n🕒 *सूचना:* ${state} ${when}${tail}`;
  }
  if (l === 'mr') {
    const state = info.closedToday ? `आमचे दुकान आज बंद आहे${why}.` : 'आमचे दुकान सध्या बंद आहे.';
    const when = info.reopenLabel === 'today' ? `आम्ही आज ${info.openTime12} वाजता उघडू.` : `आम्ही ${info.reopenLabel} रोजी ${info.openTime12} वाजता पुन्हा उघडू.`;
    const tail = kind === 'pickup' ? ' कृपया तेव्हा औषध घेऊन जा.' : ' आपली ऑर्डर सुरक्षित नोंदवली आहे.';
    return `\n\n🕒 *सूचना:* ${state} ${when}${tail}`;
  }
  const state = info.closedToday ? `Our pharmacy is closed today${why}.` : 'Our pharmacy is closed right now.';
  const when = info.reopenLabel === 'today' ? `We open today at ${info.openTime12}.` : `We reopen ${info.reopenLabel} at ${info.openTime12}.`;
  const tail = kind === 'pickup' ? ' Please collect your medicine then.' : ' Your request is safely booked.';
  return `\n\n🕒 *Note:* ${state} ${when}${tail}`;
}

/** Never throws: a failed lookup must not block a customer message. */
export async function getShopTimingNote(dbInstance: any, lang: string = 'en', kind: TimingNoteKind = 'booking'): Promise<string> {
  try {
    return buildShopTimingNote(await getShopTimingNow(dbInstance), lang, kind);
  } catch {
    return '';
  }
}

export interface RefillScheduleOpts {
  openTime?: string;
  closeTime?: string;
  weeklyOff?: string;
  isOffDayUpcoming?: boolean;
  /** Names the actual closed day ("Sun, 12 Oct", "Tue, 21 Oct (Diwali)") for the reminder. */
  closedLabel?: string;
}

/**
 * Schedule options for refill reminders. Looks at today, tomorrow and the due date and
 * reports the first one that is closed for ANY reason (not just the weekly off).
 */
export async function getRefillScheduleOpts(
  dbInstance: any,
  sched: { openTime: string; closeTime: string; weeklyOff: string },
  dueDate?: Date | string | null
): Promise<RefillScheduleOpts> {
  const opts: RefillScheduleOpts = { openTime: sched.openTime, closeTime: sched.closeTime, weeklyOff: sched.weeklyOff, isOffDayUpcoming: false };
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const now = istNow();
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const candidates: Date[] = [now, tomorrow];
    if (dueDate) {
      const d = typeof dueDate === 'string' ? new Date(dueDate.slice(0, 10) + 'T12:00:00') : new Date(dueDate);
      if (!isNaN(d.getTime())) candidates.push(d);
    }
    const seen = new Set<string>();
    for (const c of candidates) {
      const key = c.toDateString();
      if (seen.has(key)) continue;
      seen.add(key);
      const chk = await isClosedDay(c, 1, db);
      if (chk.isClosed) {
        opts.isOffDayUpcoming = true;
        opts.closedLabel = `${formatDayLabel(c)}${chk.isWeeklyOff || !chk.reason ? '' : ` (${chk.reason})`}`;
        break;
      }
    }
  } catch { /* keep weekly-off defaults */ }
  return opts;
}
