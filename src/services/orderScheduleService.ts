import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { advanceToNextOpenDay, isClosedDay } from '../utils/pharmacyCalendar.js';

export interface PharmacyTimingConfig {
  orderCutoffTime: string;          // e.g. "23:00"
  sameDayDeliveryEnabled: boolean;  // true
  deliveryStartTime: string;        // e.g. "19:00"
  deliveryEndTime: string;          // e.g. "21:00"
  operatesSunday: boolean;          // false
  sundayDelivery: boolean;          // false
  sundayWindowStart: string;        // "10:00"
  sundayWindowEnd: string;          // "14:00"
  holidayDelivery: boolean;         // false
  holidayHandling: string;          // "next_available_day"
  is24Hours: boolean;               // false
  pharmacyTimezone: string;         // "Asia/Kolkata"
  returnWindowDays: number;         // 15
  refillPauseAffectsDate: boolean;  // true
}

export interface PharmacyHolidayRecord {
  id?: number;
  store_id: number;
  holiday_date: string; // YYYY-MM-DD
  holiday_name?: string;
  name?: string;
  is_closed: number | boolean; // 1 = fully closed, 0 = reduced hours
  custom_window_start?: string | null;
  custom_window_end?: string | null;
  open_time?: string | null;
  close_time?: string | null;
}

export type ScheduleStatusType = 
  | 'standard'
  | 'post_cutoff'
  | 'sunday_shift'
  | 'holiday_shift'
  | 'overridden'
  | 'custom_override'
  | string;

export interface OrderScheduleResult {
  // CamelCase properties (for tests & orders.ts / customerPortal.ts)
  isNextDayCutoff: boolean;
  isSundayShift: boolean;
  isHolidayShift: boolean;
  cutoffTime: string;
  estimatedDeliveryWindowFormatted: string;
  scheduledProcessingAt: string;
  estimatedDeliveryStart: string;
  estimatedDeliveryEnd: string;
  cutoffAt: string;
  timezone: string;
  scheduleStatus: ScheduleStatusType;
  scheduleReason: string | null;
  scheduleVersion: number;
  calculatedAt: string;

  // Snake_case properties (for websiteOrders.ts & DB columns)
  is_next_day_cutoff: boolean;
  is_sunday_shift: boolean;
  is_holiday_shift: boolean;
  is_same_day: boolean;
  scheduled_processing_at: string;
  estimated_delivery_start: string;
  estimated_delivery_end: string;
  cutoff_at: string;
  cutoff_passed: boolean;
  is_holiday: boolean;
  is_sunday: boolean;
  pharmacy_timezone: string;
  schedule_status: ScheduleStatusType;
  schedule_reason: string | null;
  schedule_version: number;
  schedule_calculated_at: string;
  formatted_window: string;
}

export interface IncompleteOrderCustomerSummary {
  phone: string;
  name: string;
  sourceType: 'special_order' | 'refill' | 'online_order';
  orderIds: number[];
  medicines: Array<{
    id?: number;
    name: string;
    qty: number;
    unit?: string;
  }>;
  firstOrderDate: string;
  elapsedHours: number;
  classification: 'overdue' | 'market_paused';
  pauseReason?: string;
  resumedWorkingDate?: string;
  resumedDeliveryWindow?: string;
  status: string;
}

export interface IncompleteOrdersAuditResult {
  overdue: IncompleteOrderCustomerSummary[];
  marketPaused: IncompleteOrderCustomerSummary[];
  stats: {
    totalOverdueCount: number;
    totalPausedCount: number;
    totalOverdueMedicines: number;
    totalPausedMedicines: number;
  };
}

export class OrderScheduleService {
  /**
   * Load store/pharmacy timing configuration from app_settings and store_settings.
   */
  async getTimingConfig(dbOrStoreId?: any, storeIdOrDb?: any): Promise<PharmacyTimingConfig> {
    let db: any;
    let storeId = 1;

    if (dbOrStoreId && typeof dbOrStoreId.all === 'function') {
      db = dbOrStoreId;
      if (typeof storeIdOrDb === 'number') storeId = storeIdOrDb;
    } else if (typeof dbOrStoreId === 'number') {
      storeId = dbOrStoreId;
      if (storeIdOrDb && typeof storeIdOrDb.all === 'function') {
        db = storeIdOrDb;
      }
    } else {
      db = await dbManager.getConnection();
    }

    try {
      const rows = await db.all('SELECT key, value FROM app_settings');
      const settingsMap: Record<string, string> = {};
      for (const r of rows) {
        settingsMap[r.key] = r.value;
      }

      // Check store-specific overrides if applicable
      if (storeId > 0) {
        try {
          const storeRows = await db.all('SELECT key, value FROM store_settings WHERE store_id = ?', [storeId]);
          for (const sr of storeRows) {
            settingsMap[sr.key] = sr.value;
          }
        } catch (_) {}
      }

      return {
        orderCutoffTime: settingsMap['pharmacy_cutoff_time'] || settingsMap['order_cutoff_time'] || '23:00',
        sameDayDeliveryEnabled: settingsMap['same_day_delivery_enabled'] !== 'false',
        deliveryStartTime: settingsMap['delivery_window_start'] || settingsMap['delivery_start_time'] || '19:00',
        deliveryEndTime: settingsMap['delivery_window_end'] || settingsMap['delivery_end_time'] || '21:00',
        operatesSunday: settingsMap['sunday_orders_enabled'] === 'true' || settingsMap['operates_sunday'] === 'true' || settingsMap['sunday_delivery'] === 'true',
        sundayDelivery: settingsMap['sunday_orders_enabled'] === 'true' || settingsMap['sunday_delivery'] === 'true',
        sundayWindowStart: settingsMap['sunday_window_start'] || '10:00',
        sundayWindowEnd: settingsMap['sunday_window_end'] || '14:00',
        holidayDelivery: settingsMap['holiday_delivery_enabled'] === 'true' || settingsMap['holiday_delivery'] === 'true',
        holidayHandling: settingsMap['holiday_handling'] || 'next_available_day',
        is24Hours: settingsMap['is_24_hours'] === 'true',
        pharmacyTimezone: settingsMap['pharmacy_timezone'] || 'Asia/Kolkata',
        returnWindowDays: parseInt(settingsMap['return_window_days'] || '15', 10) || 15,
        refillPauseAffectsDate: settingsMap['refill_pause_recalculation_enabled'] !== 'false' && settingsMap['refill_pause_affects_date'] !== 'false'
      };
    } catch (err) {
      console.warn('[OrderScheduleService] Error fetching timing config, using defaults:', err);
      return {
        orderCutoffTime: '23:00',
        sameDayDeliveryEnabled: true,
        deliveryStartTime: '19:00',
        deliveryEndTime: '21:00',
        operatesSunday: false,
        sundayDelivery: false,
        sundayWindowStart: '10:00',
        sundayWindowEnd: '14:00',
        holidayDelivery: false,
        holidayHandling: 'next_available_day',
        is24Hours: false,
        pharmacyTimezone: 'Asia/Kolkata',
        returnWindowDays: 15,
        refillPauseAffectsDate: true
      };
    }
  }

  /**
   * Helper to format time strings (e.g. "19:00" -> "7:00 PM")
   */
  formatTime12h(timeStr: string): string {
    const [hStr, mStr] = (timeStr || '00:00').split(':');
    let h = parseInt(hStr, 10) || 0;
    const m = parseInt(mStr, 10) || 0;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const mDisplay = m > 0 ? `:${m < 10 ? '0' : ''}${m}` : ':00';
    return `${h}${mDisplay} ${ampm}`;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  formatDateYMD(dateObj: Date): string {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Helper to decompose a date into year, month, day, hour, minute, dayOfWeek for the pharmacy timezone.
   */
  getTimezoneParts(date: Date, timeZone: string = 'Asia/Kolkata') {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short'
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }
    const year = parseInt(map.year, 10);
    const month = parseInt(map.month, 10);
    const day = parseInt(map.day, 10);
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    const minute = parseInt(map.minute, 10);
    const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = weekdayMap[map.weekday] ?? 0;

    return { year, month, day, hour, minute, ymd, dayOfWeek };
  }

  /**
   * Helper to format YYYY-MM-DD and HH:mm with IST timezone into ISO string.
   */
  combineYmdAndTime(ymd: string, timeStr: string, timeZone: string = 'Asia/Kolkata'): string {
    const [hStr, mStr] = (timeStr || '00:00').split(':');
    const h = String(parseInt(hStr, 10) || 0).padStart(2, '0');
    const m = String(parseInt(mStr, 10) || 0).padStart(2, '0');
    // Asia/Kolkata is UTC+05:30
    return new Date(`${ymd}T${h}:${m}:00+05:30`).toISOString();
  }

  /**
   * Core Single Scheduling Engine:
   * Supports both positional args: calculateOrderSchedule(orderTime, storeId, db)
   * and object options: calculateOrderSchedule({ storeId, orderCreatedAt, dbInstance })
   */
  async calculateOrderSchedule(
    orderCreatedAtOrOpts?: Date | string | {
      storeId?: number;
      orderCreatedAt?: Date | string;
      orderType?: string;
      dbInstance?: any;
    },
    storeIdArg?: number,
    dbInstanceArg?: any
  ): Promise<OrderScheduleResult> {
    let storeId = 1;
    let orderCreatedAt: Date | string = new Date();
    let db: any = null;

    if (orderCreatedAtOrOpts instanceof Date || typeof orderCreatedAtOrOpts === 'string') {
      orderCreatedAt = orderCreatedAtOrOpts;
      if (typeof storeIdArg === 'number') {
        storeId = storeIdArg;
      }
      if (dbInstanceArg) {
        db = dbInstanceArg;
      }
    } else if (orderCreatedAtOrOpts && typeof orderCreatedAtOrOpts === 'object') {
      if (orderCreatedAtOrOpts.storeId !== undefined) storeId = orderCreatedAtOrOpts.storeId;
      if (orderCreatedAtOrOpts.orderCreatedAt !== undefined) orderCreatedAt = orderCreatedAtOrOpts.orderCreatedAt;
      if (orderCreatedAtOrOpts.dbInstance !== undefined) db = orderCreatedAtOrOpts.dbInstance;
    } else if (typeof storeIdArg === 'number') {
      storeId = storeIdArg;
      if (dbInstanceArg) db = dbInstanceArg;
    }

    if (!db) {
      db = await dbManager.getConnection();
    }

    const config = await this.getTimingConfig(db, storeId);
    const now = orderCreatedAt ? new Date(orderCreatedAt) : new Date();
    const nowIso = now.toISOString();

    // Fetch upcoming holidays for this store
    let holidays: PharmacyHolidayRecord[] = [];
    try {
      holidays = await db.all(
        `SELECT * FROM pharmacy_holidays 
         WHERE (store_id = ? OR store_id = 1)
         ORDER BY holiday_date ASC`,
        [storeId]
      );
    } catch (_) {}

    const holidayMap = new Map<string, PharmacyHolidayRecord>();
    for (const h of holidays) {
      holidayMap.set(h.holiday_date, h);
    }

    const currentTzParts = this.getTimezoneParts(now, config.pharmacyTimezone);
    const todayYmd = currentTzParts.ymd;
    const isTodaySunday = currentTzParts.dayOfWeek === 0;
    const todayHoliday = holidayMap.get(todayYmd);
    const isTodayHoliday = Boolean(todayHoliday);

    // Calculate Cutoff for today
    const [cutoffH, cutoffM] = config.orderCutoffTime.split(':').map(x => parseInt(x, 10));
    const cutoffPassed = !config.is24Hours && (
      currentTzParts.hour > cutoffH || (currentTzParts.hour === cutoffH && currentTzParts.minute >= cutoffM)
    );

    const sundayAllowed = config.operatesSunday || config.sundayDelivery;
    const isTodayHolidayClosed = Boolean(
      todayHoliday && (Number(todayHoliday.is_closed) === 1 || todayHoliday.is_closed === true) && !config.holidayDelivery
    );

    let isNextDayCutoff = false;
    let isSundayShift = false;
    let isHolidayShift = false;
    let scheduleStatus: ScheduleStatusType = 'standard';
    let primaryShiftReason: string | null = null;

    if (cutoffPassed) {
      isNextDayCutoff = true;
      scheduleStatus = 'post_cutoff';
      primaryShiftReason = `Order placed after ${this.formatTime12h(config.orderCutoffTime)} cutoff (post-cutoff rollover)`;
    } else if (isTodaySunday && !sundayAllowed) {
      isSundayShift = true;
      scheduleStatus = 'sunday_shift';
      primaryShiftReason = 'Pharmacy closed on Sundays (Sunday rollover)';
    } else if (isTodayHolidayClosed) {
      isHolidayShift = true;
      const hName = todayHoliday?.holiday_name || todayHoliday?.name || 'Public Holiday';
      scheduleStatus = 'holiday_shift';
      primaryShiftReason = `Pharmacy closed for ${hName}`;
    }

    let isSameDay = false;
    // We start looking from current date in IST
    let targetDate = new Date(now);
    let daysAdvanced = 0;

    if (!isNextDayCutoff && !isSundayShift && !isHolidayShift) {
      isSameDay = true;
      scheduleStatus = 'standard';
      primaryShiftReason = null;
    } else {
      // Advance to next valid operating day via shared pharmacyCalendar util
      const shiftResult = await advanceToNextOpenDay(now, {
        storeId,
        dbInstance: db,
        advanceAtLeastOneDay: true
      });
      targetDate = shiftResult.targetDate;
      daysAdvanced = shiftResult.daysAdvanced;
      if (shiftResult.isSundayShift) isSundayShift = true;
      if (shiftResult.isHolidayShift) isHolidayShift = true;
      if (!primaryShiftReason && shiftResult.shiftReason) {
        primaryShiftReason = shiftResult.shiftReason;
      }
    }

    const targetParts = this.getTimezoneParts(targetDate, config.pharmacyTimezone);
    const isTargetSunday = targetParts.dayOfWeek === 0;
    const targetHoliday = holidayMap.get(targetParts.ymd);

    let deliveryStartTime = config.deliveryStartTime;
    let deliveryEndTime = config.deliveryEndTime;

    if (isTargetSunday && sundayAllowed) {
      deliveryStartTime = config.sundayWindowStart || '10:00';
      deliveryEndTime = config.sundayWindowEnd || '14:00';
    } else if (targetHoliday && (Number(targetHoliday.is_closed) === 0 || targetHoliday.is_closed === false)) {
      if (targetHoliday.custom_window_start || targetHoliday.open_time) {
        deliveryStartTime = targetHoliday.custom_window_start || targetHoliday.open_time || deliveryStartTime;
      }
      if (targetHoliday.custom_window_end || targetHoliday.close_time) {
        deliveryEndTime = targetHoliday.custom_window_end || targetHoliday.close_time || deliveryEndTime;
      }
    }

    const estimatedDeliveryStart = this.combineYmdAndTime(targetParts.ymd, deliveryStartTime, config.pharmacyTimezone);
    const estimatedDeliveryEnd = this.combineYmdAndTime(targetParts.ymd, deliveryEndTime, config.pharmacyTimezone);
    const scheduledProcessingAt = this.combineYmdAndTime(targetParts.ymd, '08:00', config.pharmacyTimezone);
    const cutoffAt = this.combineYmdAndTime(currentTzParts.ymd, config.orderCutoffTime, config.pharmacyTimezone);

    // Format human-friendly delivery window
    const dayLabel = isSameDay
      ? 'Today'
      : (daysAdvanced === 1 ? 'Tomorrow' : new Intl.DateTimeFormat('en-IN', { timeZone: config.pharmacyTimezone, weekday: 'short', month: 'short', day: 'numeric' }).format(targetDate));
    const formattedWindow = `${dayLabel}, ${this.formatTime12h(deliveryStartTime)} – ${this.formatTime12h(deliveryEndTime)}`;

    return {
      // CamelCase
      isNextDayCutoff,
      isSundayShift,
      isHolidayShift,
      cutoffTime: config.orderCutoffTime,
      estimatedDeliveryWindowFormatted: formattedWindow,
      scheduledProcessingAt,
      estimatedDeliveryStart,
      estimatedDeliveryEnd,
      cutoffAt,
      timezone: config.pharmacyTimezone,
      scheduleStatus,
      scheduleReason: primaryShiftReason,
      scheduleVersion: 1,
      calculatedAt: nowIso,

      // Snake_case
      is_next_day_cutoff: isNextDayCutoff,
      is_sunday_shift: isSundayShift,
      is_holiday_shift: isHolidayShift,
      is_same_day: isSameDay,
      scheduled_processing_at: scheduledProcessingAt,
      estimated_delivery_start: estimatedDeliveryStart,
      estimated_delivery_end: estimatedDeliveryEnd,
      cutoff_at: cutoffAt,
      cutoff_passed: cutoffPassed,
      is_holiday: isTodayHoliday,
      is_sunday: isTodaySunday,
      pharmacy_timezone: config.pharmacyTimezone,
      schedule_status: scheduleStatus,
      schedule_reason: primaryShiftReason,
      schedule_version: 1,
      schedule_calculated_at: nowIso,
      formatted_window: formattedWindow
    };
  }

  /**
   * Persists the calculated schedule directly into special_orders.
   */
  async persistOrderSchedule(orderId: number, schedule: OrderScheduleResult, dbInstance?: any): Promise<void> {
    const db = dbInstance || (await dbManager.getConnection());
    await db.run(
      `UPDATE special_orders
       SET scheduled_processing_at = ?,
           estimated_delivery_start = ?,
           estimated_delivery_end = ?,
           cutoff_at = ?,
           pharmacy_timezone = ?,
           schedule_status = ?,
           schedule_reason = ?,
           schedule_version = ?,
           schedule_calculated_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        schedule.scheduled_processing_at,
        schedule.estimated_delivery_start,
        schedule.estimated_delivery_end,
        schedule.cutoff_at,
        schedule.pharmacy_timezone,
        schedule.schedule_status,
        schedule.schedule_reason,
        schedule.schedule_version,
        schedule.schedule_calculated_at,
        orderId
      ]
    );

    // Record tracking event
    const reasonText = schedule.schedule_reason ? ` (Reason: ${schedule.schedule_reason})` : '';
    try {
      await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
         VALUES (?, 'schedule_calculated', ?, 'system', CURRENT_TIMESTAMP)`,
        [orderId, `Estimated delivery: ${schedule.formatted_window}${reasonText}`]
      );
    } catch (_) {}
  }

  /**
   * Staff manual override for delivery schedule.
   */
  async overrideOrderSchedule(
    orderId: number,
    opts: {
      estimatedDeliveryStart?: string;
      estimatedDeliveryEnd?: string;
      newDeliveryStart?: string;
      newDeliveryEnd?: string;
      reason: string;
      overrideBy?: string;
      staffName?: string;
    },
    dbInstance?: any
  ): Promise<any> {
    const db = dbInstance || (await dbManager.getConnection());
    const staff = (opts.overrideBy || opts.staffName || 'Pharmacist Admin').trim();
    const reason = (opts.reason || 'Manual schedule adjustment').trim();
    const start = opts.estimatedDeliveryStart || opts.newDeliveryStart;
    const end = opts.estimatedDeliveryEnd || opts.newDeliveryEnd;

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) {
      return null;
    }

    const currentVersion = (order.schedule_version || 1) + 1;

    await db.run(
      `UPDATE special_orders
       SET estimated_delivery_start = ?,
           estimated_delivery_end = ?,
           schedule_status = 'overridden',
           schedule_reason = ?,
           schedule_version = ?,
           schedule_overridden_by = ?,
           schedule_overridden_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        start,
        end,
        reason,
        currentVersion,
        staff,
        orderId
      ]
    );

    try {
      await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
         VALUES (?, 'schedule_overridden', ?, ?, CURRENT_TIMESTAMP)`,
        [orderId, `Delivery ETA overridden by ${staff}. New window: ${start} to ${end}. Reason: ${reason}`, staff]
      );
    } catch (_) {}

    try {
      eventService.broadcast('order_updated', { at: Date.now(), orderId, action: 'schedule_overridden' });
    } catch (_) {}

    const updated = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    return updated;
  }

  /**
   * Find the next open working date by scanning forward day-by-day (skipping closed days,
   * paused dispatch dates, market closures, and weekly offs).
   */
  async getNextAvailableWorkingDate(
    startDateOrYmd?: Date | string,
    options?: { storeId?: number; dbInstance?: any; advanceAtLeastOneDay?: boolean }
  ): Promise<{ date: Date; ymd: string; formatted: string; shiftReason?: string }> {
    const db = options?.dbInstance || (await dbManager.getConnection());
    const storeId = options?.storeId || 1;
    let baseDate: Date;
    if (!startDateOrYmd) {
      baseDate = new Date();
    } else if (typeof startDateOrYmd === 'string') {
      const [y, m, d] = startDateOrYmd.slice(0, 10).split('-').map(Number);
      baseDate = new Date(y, m - 1, d, 12, 0, 0);
    } else {
      baseDate = new Date(startDateOrYmd);
    }

    const res = await advanceToNextOpenDay(baseDate, {
      storeId,
      dbInstance: db,
      advanceAtLeastOneDay: options?.advanceAtLeastOneDay ?? true
    });

    const dayFormatter = new Intl.DateTimeFormat('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short'
    });
    const formatted = dayFormatter.format(res.targetDate);

    return {
      date: res.targetDate,
      ymd: res.ymd,
      formatted,
      shiftReason: res.shiftReason
    };
  }

  /**
   * Calendar-Aware Evaluation of Incomplete Orders & Refills (>24h SLA)
   * Distinguishes true store SLA failure (open hours) from market-closure/paused-dispatch holds.
   */
  async evaluateIncompleteOrders24hSLA(
    options?: { storeId?: number; dbInstance?: any; cutoffHours?: number }
  ): Promise<IncompleteOrdersAuditResult> {
    const db = options?.dbInstance || (await dbManager.getConnection());
    const storeId = options?.storeId || 1;
    const cutoffHours = options?.cutoffHours || 24;
    const nowMs = Date.now();

    // Check snoozed orders map from app_settings
    let snoozedMap: Record<string, number> = {};
    try {
      const row = await db.get("SELECT value FROM app_settings WHERE key = 'snoozed_24h_order_ids'").catch(() => null);
      if (row?.value) snoozedMap = JSON.parse(row.value);
    } catch (_) {}

    // Check store & market closure status for today
    const todayClosedCheck = await isClosedDay(new Date(), storeId, db);
    let nextResumed: { date: Date; ymd: string; formatted: string; shiftReason?: string } | null = null;
    if (todayClosedCheck.isClosed) {
      nextResumed = await this.getNextAvailableWorkingDate(new Date(), { dbInstance: db, storeId });
    }

    let defaultWindow = '11:00 AM - 01:00 PM';
    try {
      const { getDeliverySchedules } = await import('./storeSettingsService.js');
      const schedules = await getDeliverySchedules(db);
      if (schedules && schedules.length > 0 && schedules[0].deliveryWindow) {
        defaultWindow = schedules[0].deliveryWindow;
      }
    } catch (_) {}

    // 1. Fetch unfulfilled special/online orders
    const specialRows = await db.all(`
      SELECT id, requester, phone, product, medicine_name, qty, status, customer_order_source,
             COALESCE(created_at, date, datetime('now', 'localtime')) as order_time
      FROM special_orders
      WHERE status IN ('Pending', 'Confirmed', 'Waiting')
      ORDER BY id DESC
      LIMIT 150
    `).catch(() => []);

    // 2. Fetch pending patient refills that were due yesterday or earlier
    const refillRows = await db.all(`
      SELECT pr.id, pr.patient_name, pr.quantity_needed, pr.next_refill_date, pr.status,
             COALESCE(pr.created_at, pr.next_refill_date) as order_time,
             m.name as medicine_name,
             COALESCE(c.phone, '') as customer_phone
      FROM patient_refills pr
      JOIN medicines m ON pr.medicine_id = m.id
      LEFT JOIN customers c ON (c.name = pr.patient_name OR c.id = pr.customer_id)
      WHERE pr.is_active = 1
        AND pr.status IN ('pending', 'notified', 'staged')
        AND DATE(pr.next_refill_date) <= DATE('now', 'localtime', '-1 day')
      ORDER BY pr.id DESC
      LIMIT 150
    `).catch(() => []);

    const customerMap = new Map<string, IncompleteOrderCustomerSummary>();

    const processItem = (item: {
      id: number;
      name: string;
      phone: string;
      productName: string;
      qty: number;
      orderTimeStr: string;
      source: 'special_order' | 'refill' | 'online_order';
      status: string;
    }) => {
      // Check snooze
      const snoozeKey = `${item.source}_${item.id}`;
      if (snoozedMap[snoozeKey] && snoozedMap[snoozeKey] > nowMs) {
        return; // Snoozed
      }

      const orderDate = new Date(item.orderTimeStr);
      const elapsedMs = nowMs - (isNaN(orderDate.getTime()) ? nowMs : orderDate.getTime());
      const elapsedHrs = Math.max(1, Math.round(elapsedMs / (1000 * 60 * 60)));

      if (elapsedHrs < cutoffHours) {
        return; // Has not reached cutoff threshold
      }

      const custKey = (item.phone || item.name || `unknown_${item.id}`).trim().toLowerCase();
      const existing = customerMap.get(custKey);

      // Determine classification
      const isPaused = todayClosedCheck.isClosed;
      const pauseReason = todayClosedCheck.reason;
      const classification: 'overdue' | 'market_paused' = isPaused ? 'market_paused' : 'overdue';

      if (!existing) {
        customerMap.set(custKey, {
          phone: item.phone || '',
          name: item.name || 'Valued Customer',
          sourceType: item.source,
          orderIds: [item.id],
          medicines: [{
            id: item.id,
            name: item.productName || 'Prescribed Medicine',
            qty: item.qty || 1
          }],
          firstOrderDate: item.orderTimeStr,
          elapsedHours: elapsedHrs,
          classification,
          pauseReason: isPaused ? pauseReason : undefined,
          resumedWorkingDate: nextResumed?.formatted,
          resumedDeliveryWindow: defaultWindow,
          status: item.status
        });
      } else {
        existing.orderIds.push(item.id);
        existing.medicines.push({
          id: item.id,
          name: item.productName || 'Prescribed Medicine',
          qty: item.qty || 1
        });
        existing.elapsedHours = Math.max(existing.elapsedHours, elapsedHrs);
        if (classification === 'overdue') {
          existing.classification = 'overdue';
        }
      }
    };

    for (const row of specialRows) {
      const srcRaw = (row.customer_order_source || '').toLowerCase();
      let src: 'special_order' | 'refill' | 'online_order' = 'special_order';
      if (srcRaw.includes('online') || srcRaw.includes('web')) src = 'online_order';

      processItem({
        id: Number(row.id),
        name: String(row.requester || 'Customer'),
        phone: String(row.phone || ''),
        productName: String(row.product || row.medicine_name || 'Medicine'),
        qty: Number(row.qty) || 1,
        orderTimeStr: String(row.order_time),
        source: src,
        status: String(row.status || 'Pending')
      });
    }

    for (const row of refillRows) {
      processItem({
        id: Number(row.id),
        name: String(row.patient_name || 'Refill Patient'),
        phone: String(row.customer_phone || ''),
        productName: String(row.medicine_name || 'Refill Medicine'),
        qty: Number(row.quantity_needed) || 1,
        orderTimeStr: String(row.order_time),
        source: 'refill',
        status: String(row.status || 'pending')
      });
    }

    const overdue: IncompleteOrderCustomerSummary[] = [];
    const marketPaused: IncompleteOrderCustomerSummary[] = [];

    for (const summary of customerMap.values()) {
      if (summary.classification === 'overdue') {
        overdue.push(summary);
      } else {
        marketPaused.push(summary);
      }
    }

    // Sort by largest elapsed hours descending
    overdue.sort((a, b) => b.elapsedHours - a.elapsedHours);
    marketPaused.sort((a, b) => b.elapsedHours - a.elapsedHours);

    const totalOverdueMedicines = overdue.reduce((acc, c) => acc + c.medicines.length, 0);
    const totalPausedMedicines = marketPaused.reduce((acc, c) => acc + c.medicines.length, 0);

    return {
      overdue,
      marketPaused,
      stats: {
        totalOverdueCount: overdue.length,
        totalPausedCount: marketPaused.length,
        totalOverdueMedicines,
        totalPausedMedicines
      }
    };
  }
}

export const orderScheduleService = new OrderScheduleService();


