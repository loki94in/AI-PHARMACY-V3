// A refill medicine or special order is only settled once it is fulfilled/completed
// or billed at POS. Marking ready arms the collection notification workflow but does
// NOT hide the order from the store workflow until the customer transaction is handled!
type RefillLike = {
  status?: string | null;
  cart_store_name?: string | null;
  cart_product_code?: string | null;
  qa_cart_qty?: number | null;
  cart_status?: string | null;
  reminder_status?: string | null;
  last_refill_date?: string | null;
  is_ready?: number | boolean | null;
  in_live_cart?: boolean;
};

// Interval-aware lead days (floor(interval/3), min 1, capped at maxLead) so short-cycle
// refills (e.g. 8-day intervals) do not reappear immediately after fulfillment.
export const effectiveRefillLeadDays = (intervalDays?: number | null, maxLead = 7): number =>
  Math.min(maxLead, Math.max(1, Math.floor((Number(intervalDays) || 30) / 3)));

// Explicitly queued in QA waiting for final Add to Cart action
export const isRefillQaStaged = (m: RefillLike | undefined | null): boolean =>
  !!m && m.cart_status === 'qa_queued';

// True when a refill was explicitly selected/staged via CRM before the normal automated lead window
// (e.g. 10 November selection for a 27 November scheduled due date)
export const isEarlyCrmAddition = (m: {
  next_refill_date?: string | null;
  qa_staged_at?: string | null;
  refill_interval_days?: number | null;
  qa_cart_qty?: number | null;
  cart_status?: string | null;
  cart_cycle_due_date?: string | null;
  cart_store_name?: string | null;
  in_live_cart?: boolean;
  is_early_crm_addition?: boolean;
} | undefined | null): boolean => {
  if (!m) return false;
  if (typeof m.is_early_crm_addition === 'boolean') return m.is_early_crm_addition;
  const hasCrmSelection = isRefillQaStaged(m) || !!m.qa_staged_at || m.cart_status === 'added' || !!m.cart_cycle_due_date;
  if (!hasCrmSelection || !m.next_refill_date) return false;
  const dueStr = String(m.next_refill_date).slice(0, 10);
  const dueDt = new Date(`${dueStr}T00:00:00`);
  if (isNaN(dueDt.getTime())) return false;
  const baseStr = m.qa_staged_at ? String(m.qa_staged_at).slice(0, 10) : '';
  const baseDt = baseStr ? new Date(`${baseStr}T00:00:00`) : new Date();
  baseDt.setHours(0, 0, 0, 0);
  if (isNaN(baseDt.getTime())) return false;
  const diffDays = Math.round((dueDt.getTime() - baseDt.getTime()) / 86400000);
  return diffDays > effectiveRefillLeadDays(m.refill_interval_days, 7);
};

// True ONLY when genuinely fulfilled/completed/in cooldown (never returns true merely because next_refill_date is far future)
export const isRefillActuallyFulfilled = (med: {
  next_refill_date?: string | null;
  last_refill_date?: string | null;
  refill_interval_days?: number | null;
  status?: string | null;
}): boolean => {
  if (isRefillSettled(med) || isRefillFulfilledToday(med)) return true;
  if (!med.last_refill_date || !med.next_refill_date) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const lastDisp = new Date(med.last_refill_date);
  const nextDue = new Date(med.next_refill_date);
  if (isNaN(lastDisp.getTime()) || isNaN(nextDue.getTime())) return false;
  lastDisp.setHours(0, 0, 0, 0);
  nextDue.setHours(0, 0, 0, 0);
  const daysSinceDispense = Math.round((now.getTime() - lastDisp.getTime()) / 86400000);
  const diffDays = Math.round((nextDue.getTime() - now.getTime()) / 86400000);
  const intervalDays = Math.max(1, Number(med.refill_interval_days || 30));
  const leadDays = effectiveRefillLeadDays(intervalDays, 7);
  return diffDays > 0 && daysSinceDispense >= 0 && daysSinceDispense < Math.max(1, intervalDays - leadDays);
};

// Returns true if this refill medicine was fulfilled today in shop local time
export const isRefillFulfilledToday = (m: { last_refill_date?: string | null } | undefined | null): boolean => {
  if (!m || !m.last_refill_date) return false;
  const lastYmd = m.last_refill_date.slice(0, 10);
  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return lastYmd === todayYmd;
};

export const isRefillOrdered = (m: RefillLike) => m.status === 'ordered' || !!m.cart_store_name || !!m.cart_product_code || m.in_live_cart === true;
export const isRefillReminded = (m: RefillLike) => m.reminder_status === 'SENT' || m.status === 'notified';
export const isRefillReady = (m: RefillLike) =>
  isRefillReminded(m) || m.status === 'ready';
export const isRefillSettled = (m: RefillLike) =>
  m.status === 'completed' || m.status === 'fulfilled' || m.status === 'canceled' || isRefillFulfilledToday(m);

// True when the patient has medicines and every one is settled — nothing left to act on.
export const isPatientRefillsSettled = (meds: RefillLike[] | undefined | null) =>
  !!meds && meds.length > 0 && meds.every(isRefillSettled);

// Simplified refill workflow (Quick Assist + CRM, owner rule 2026-10):
// Stage A 'upcoming' — not yet marked ready or ordered → [Mark Ready] [Add to Cart] [Already Added] [POS] [Edit]
// Stage B 'ordered' — ordered but not yet marked ready → [Mark Ready] [Complete] [POS] [Edit]
// Stage C 'ready' / 'reminded' — marked ready (awaiting collection) → [Re-Send Reminder] [Complete] [POS]
export type RefillStage = 'upcoming' | 'ordered' | 'reminded';
export const getRefillStage = (meds: RefillLike[] | undefined | null): RefillStage => {
  if (!meds || meds.length === 0) return 'upcoming';
  if (meds.some(isRefillReady)) return 'reminded';
  const orderedCount = meds.filter(isRefillOrdered).length;
  if (orderedCount > 0) return 'ordered';
  return 'upcoming';
};

// Special orders and online orders: settled once completed, fulfilled, or cancelled
type OrderItemLike = { status?: string | null; notification_count?: number | null };
export const isOrderItemSettled = (i: OrderItemLike) => {
  const s = (i.status || '').toLowerCase().trim();
  return s === 'completed' || s === 'fulfilled' || s === 'cancelled';
};
export const isOrderGroupSettled = (items: OrderItemLike[] | undefined | null) =>
  !!items && items.length > 0 && items.every(isOrderItemSettled);

export interface RefillCycleBookingStatus {
  canBook: boolean;
  isEarly: boolean;
  daysEarly: number;
  alreadyDispensed: boolean;
  lastDispensedDate: string | null;
  nextDueDate: string | null;
  message?: string;
}

/**
 * Checks whether a single refill medicine can be booked for the current cycle:
 * 1. Blocks re-booking if the current running cycle was already dispensed today in shop time.
 * 2. Allows early booking if next_refill_date is in the upcoming 7-day window.
 * 3. Allows direct booking if due now or overdue.
 * 4. Marks cycle dormant (alreadyDispensed = true) if more than 7 days away from next due date.
 */
export const checkRefillCycleBooking = (med: {
  next_refill_date?: string | null;
  last_refill_date?: string | null;
  refill_interval_days?: number | null;
  status?: string | null;
  cart_store_name?: string | null;
  cart_product_code?: string | null;
  qa_cart_qty?: number | null;
  cart_status?: string | null;
  in_live_cart?: boolean;
}): RefillCycleBookingStatus => {
  const intervalDays = Math.max(1, Number(med.refill_interval_days || 30));
  const leadDays = effectiveRefillLeadDays(intervalDays, 7);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const nextDueDate = med.next_refill_date || null;
  const lastDispensedDate = med.last_refill_date || null;

  if (isRefillFulfilledToday(med)) {
    return {
      canBook: false,
      isEarly: false,
      daysEarly: 0,
      alreadyDispensed: true,
      lastDispensedDate,
      nextDueDate,
      message: 'This refill cycle was already dispensed today.'
    };
  }

  const nextDue = nextDueDate ? new Date(nextDueDate) : null;
  const lastDisp = lastDispensedDate ? new Date(lastDispensedDate) : null;

  let daysSinceDispense: number | null = null;
  if (lastDisp) {
    const lastDispDay = new Date(lastDisp);
    lastDispDay.setHours(0, 0, 0, 0);
    daysSinceDispense = Math.round((now.getTime() - lastDispDay.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceDispense === 0) {
      const lastDispFormatted = lastDisp.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const nextDueFormatted = nextDue ? nextDue.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
      return {
        canBook: false,
        isEarly: false,
        daysEarly: 0,
        alreadyDispensed: true,
        lastDispensedDate,
        nextDueDate,
        message: `Refill already dispensed for this cycle on ${lastDispFormatted}. Next refill is due on ${nextDueFormatted}.`
      };
    }
  }

  if (nextDue) {
    const nextDueDay = new Date(nextDue);
    nextDueDay.setHours(0, 0, 0, 0);
    const diffDays = Math.round((nextDueDay.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    const isOrderedOrInCart = isRefillOrdered(med as any) || isRefillQaStaged(med as any) || !!med.cart_store_name || !!med.cart_product_code || med.in_live_cart === true;
    const inCooldown = daysSinceDispense !== null && diffDays > 0 && daysSinceDispense < Math.max(1, intervalDays - leadDays) && !isOrderedOrInCart;

    // Active & actionable interval-aware refill lead-time window, OR item is already staged/ordered/in live cart
    if (!inCooldown && (diffDays <= leadDays || isOrderedOrInCart)) {
      if (diffDays > 0) {
        const nextDueFormatted = nextDue.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        return {
          canBook: true,
          isEarly: true,
          daysEarly: diffDays,
          alreadyDispensed: false,
          lastDispensedDate,
          nextDueDate,
          message: `This refill is due in ${diffDays} day(s) on ${nextDueFormatted}. Allow early booking?`
        };
      }
      return {
        canBook: true,
        isEarly: false,
        daysEarly: 0,
        alreadyDispensed: false,
        lastDispensedDate,
        nextDueDate
      };
    }

    // Beyond lead window or still inside cycle cooldown: cycle is dormant
    const nextDueFormatted = nextDue.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    return {
      canBook: false,
      isEarly: true,
      daysEarly: diffDays,
      alreadyDispensed: true,
      lastDispensedDate,
      nextDueDate,
      message: `Cycle is dormant. Next refill is due on ${nextDueFormatted} (in ${diffDays} days).`
    };
  }

  return {
    canBook: true,
    isEarly: false,
    daysEarly: 0,
    alreadyDispensed: false,
    lastDispensedDate,
    nextDueDate
  };
};

/**
 * Checks whether an entire patient's refill group can be booked:
 * Returns alreadyDispensed if all active medicines are fulfilled for this cycle.
 * Flags isEarly if any bookable medicine is due in the future.
 */
export const checkPatientRefillCycleBooking = (meds: Array<{
  next_refill_date?: string | null;
  last_refill_date?: string | null;
  refill_interval_days?: number | null;
  status?: string | null;
  is_active?: number | null;
  cart_store_name?: string | null;
  cart_product_code?: string | null;
  qa_cart_qty?: number | null;
  cart_status?: string | null;
  in_live_cart?: boolean;
}> | undefined | null): RefillCycleBookingStatus => {
  if (!meds || meds.length === 0) {
    return {
      canBook: false,
      isEarly: false,
      daysEarly: 0,
      alreadyDispensed: false,
      lastDispensedDate: null,
      nextDueDate: null,
      message: 'No medicines in refill schedule.'
    };
  }

  const activeMeds = meds.filter(m => m.is_active !== 0 && m.status !== 'canceled');
  if (activeMeds.length === 0) {
    return {
      canBook: false,
      isEarly: false,
      daysEarly: 0,
      alreadyDispensed: false,
      lastDispensedDate: null,
      nextDueDate: null,
      message: 'No active prescribed medicines.'
    };
  }

  const statuses = activeMeds.map(checkRefillCycleBooking);

  if (statuses.every(s => s.alreadyDispensed)) {
    return statuses[0];
  }

  const bookable = statuses.filter(s => s.canBook);
  if (bookable.length === 0) {
    return statuses[0];
  }

  const earlyStatuses = bookable.filter(s => s.isEarly);
  if (earlyStatuses.length > 0) {
    const maxEarly = earlyStatuses.reduce((prev, curr) => (curr.daysEarly > prev.daysEarly ? curr : prev), earlyStatuses[0]);
    return {
      canBook: true,
      isEarly: true,
      daysEarly: maxEarly.daysEarly,
      alreadyDispensed: false,
      lastDispensedDate: maxEarly.lastDispensedDate,
      nextDueDate: maxEarly.nextDueDate,
      message: maxEarly.message
    };
  }

  return {
    canBook: true,
    isEarly: false,
    daysEarly: 0,
    alreadyDispensed: false,
    lastDispensedDate: bookable[0].lastDispensedDate,
    nextDueDate: bookable[0].nextDueDate
  };
};


