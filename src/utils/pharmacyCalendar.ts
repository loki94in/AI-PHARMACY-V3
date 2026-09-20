import { dbManager } from '../database/connection.js';

export interface ClosedDayCheckResult {
  isClosed: boolean;
  isWeeklyOff: boolean;
  isHolidayClosed: boolean;
  reason?: string;
}

export interface AdvanceOpenDayResult {
  targetDate: Date;
  daysAdvanced: number;
  isSundayShift: boolean;
  isHolidayShift: boolean;
  shiftReason?: string;
  ymd: string;
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateYMD(dateObj: Date): string {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Check if a date string (YYYY-MM-DD) or Date object falls on a closed day (weekly off or holiday).
 */
export async function isClosedDay(
  dateOrYmd: Date | string,
  storeId: number = 1,
  dbInstance?: any
): Promise<ClosedDayCheckResult> {
  const db = dbInstance || (await dbManager.getConnection());
  let targetDate: Date;
  let ymd: string;

  if (typeof dateOrYmd === 'string') {
    ymd = dateOrYmd.slice(0, 10);
    const [y, m, d] = ymd.split('-').map(Number);
    targetDate = new Date(y, m - 1, d, 12, 0, 0);
  } else {
    targetDate = new Date(dateOrYmd);
    ymd = formatDateYMD(targetDate);
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[targetDate.getDay()];
  const isSunday = targetDate.getDay() === 0;

  // 1. Fetch weekly off and Sunday policy from app_settings
  const settingsRows = await db.all(
    `SELECT key, value FROM app_settings 
     WHERE key IN ('pharmacy_weekly_off', 'weekly_off', 'sunday_orders_enabled', 'sunday_delivery', 'holiday_delivery')`
  ).catch(() => []);

  const settingsMap = new Map<string, string>(settingsRows.map((r: any) => [String(r.key), String(r.value)]));
  const weeklyOff = (settingsMap.get('pharmacy_weekly_off') || settingsMap.get('weekly_off') || 'monday').toLowerCase().trim();
  const sundayAllowed = settingsMap.get('sunday_orders_enabled') === 'true' || settingsMap.get('sunday_delivery') === 'true';
  const holidayDelivery = settingsMap.get('holiday_delivery') === 'true';

  let isWeeklyOff = false;
  if (dayName === weeklyOff) {
    isWeeklyOff = true;
  } else if (isSunday && !sundayAllowed) {
    isWeeklyOff = true;
  }

  // 2. Fetch holiday status from pharmacy_holidays
  let holidayRow = null;
  try {
    holidayRow = await db.get(
      `SELECT holiday_name, name, is_closed FROM pharmacy_holidays 
       WHERE (store_id = ? OR store_id = 1) AND holiday_date = ? LIMIT 1`,
      [storeId, ymd]
    );
  } catch (_) {}

  const isHolidayClosed = Boolean(
    holidayRow &&
    (Number(holidayRow.is_closed) === 1 || holidayRow.is_closed === true) &&
    !holidayDelivery
  );

  const isClosed = isWeeklyOff || isHolidayClosed;
  let reason: string | undefined;

  if (isHolidayClosed) {
    reason = `Pharmacy closed for ${holidayRow?.holiday_name || holidayRow?.name || 'Public Holiday'}`;
  } else if (isWeeklyOff) {
    reason = isSunday ? 'Pharmacy closed on Sundays' : `Pharmacy closed on weekly off (${weeklyOff})`;
  }

  return {
    isClosed,
    isWeeklyOff,
    isHolidayClosed,
    reason
  };
}

/**
 * Calculates effective refill notice days: if due on a closed day (Sunday/holiday/weekly off),
 * adds 1 day lead time so patient and pharmacy are prepared in advance.
 */
export async function effectiveNoticeDays(
  noticeDays: number,
  dateYmd: string,
  storeId: number = 1,
  dbInstance?: any
): Promise<number> {
  const check = await isClosedDay(dateYmd, storeId, dbInstance);
  return check.isClosed ? noticeDays + 1 : noticeDays;
}

/**
 * Advance a date to the next valid operating open day (up to 14 days).
 */
export async function advanceToNextOpenDay(
  startDate: Date,
  options?: {
    storeId?: number;
    dbInstance?: any;
    advanceAtLeastOneDay?: boolean;
  }
): Promise<AdvanceOpenDayResult> {
  const storeId = options?.storeId || 1;
  const db = options?.dbInstance || (await dbManager.getConnection());
  const advanceAtLeastOne = options?.advanceAtLeastOneDay ?? false;

  let targetDate = new Date(startDate);
  let daysAdvanced = 0;
  let isSundayShift = false;
  let isHolidayShift = false;
  let primaryShiftReason: string | undefined;

  if (advanceAtLeastOne) {
    targetDate.setDate(targetDate.getDate() + 1);
    daysAdvanced++;
  }

  while (daysAdvanced < 14) {
    const ymd = formatDateYMD(targetDate);
    const check = await isClosedDay(ymd, storeId, db);

    if (check.isClosed) {
      if (check.isWeeklyOff) isSundayShift = true;
      if (check.isHolidayClosed) isHolidayShift = true;
      if (!primaryShiftReason && check.reason) {
        primaryShiftReason = check.reason;
      }
      targetDate.setDate(targetDate.getDate() + 1);
      daysAdvanced++;
      continue;
    }
    break;
  }

  return {
    targetDate,
    daysAdvanced,
    isSundayShift,
    isHolidayShift,
    shiftReason: primaryShiftReason,
    ymd: formatDateYMD(targetDate)
  };
}
