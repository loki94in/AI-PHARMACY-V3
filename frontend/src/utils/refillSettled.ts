// A refill medicine or special order is only settled once it is fulfilled/completed
// or billed at POS. Marking ready arms the collection notification workflow but does
// NOT hide the order from the store workflow until the customer transaction is handled!
type RefillLike = {
  status?: string | null;
  cart_store_name?: string | null;
  reminder_status?: string | null;
  last_refill_date?: string | null;
};

// Returns true if this refill medicine was fulfilled today in shop local time
export const isRefillFulfilledToday = (m: { last_refill_date?: string | null } | undefined | null): boolean => {
  if (!m || !m.last_refill_date) return false;
  const lastYmd = m.last_refill_date.slice(0, 10);
  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return lastYmd === todayYmd;
};

export const isRefillOrdered = (m: RefillLike) => m.status === 'ordered' || !!m.cart_store_name;
export const isRefillReminded = (m: RefillLike) => m.reminder_status === 'SENT' || m.status === 'notified';
export const isRefillSettled = (m: RefillLike) =>
  m.status === 'completed' || m.status === 'fulfilled' || m.status === 'canceled' || isRefillFulfilledToday(m);

// Returns true if this refill medicine is considered handled/settled today (either fulfilled today or status completed/fulfilled)
export const isRefillHandledToday = (m: RefillLike | undefined | null): boolean => {
  if (!m) return false;
  return isRefillFulfilledToday(m) || m.status === 'completed' || m.status === 'fulfilled';
};

export const isPatientHandledToday = (meds: RefillLike[] | undefined | null): boolean => {
  if (!meds || meds.length === 0) return false;
  return meds.some(isRefillHandledToday);
};

// Shared comparator/sort helper: handled-today groups sorted LAST, active groups sorted by diffDays ascending
export function compareRefillGroups<T extends { diffDays?: number; handled?: boolean }>(a: T, b: T): number {
  const handledA = a.handled ? 1 : 0;
  const handledB = b.handled ? 1 : 0;
  if (handledA !== handledB) {
    return handledA - handledB; // 0 (unhandled/active) first, 1 (handled) last
  }
  return (a.diffDays || 0) - (b.diffDays || 0);
}

export function sortRefillGroups<T extends { diffDays?: number; handled?: boolean }>(list: T[]): T[] {
  return [...list].sort(compareRefillGroups);
}

// True when the patient has medicines and every one is settled — nothing left to act on.
export const isPatientRefillsSettled = (meds: RefillLike[] | undefined | null) =>
  !!meds && meds.length > 0 && meds.every(isRefillSettled);

// Simplified 3-button refill workflow (Quick Assist + CRM, owner rule 2026-10):
// Stage A 'upcoming' — no medicine ordered yet → [Add to Cart] [Already Added] [Edit]
// Stage B 'ordered' — ordered but not yet marked ready → [Mark Ready] [POS] [Edit]
// Stage C 'ready' / 'reminded' — marked ready (awaiting collection) → [Re-Send Reminder] [POS]
export type RefillStage = 'upcoming' | 'ordered' | 'reminded';
export const getRefillStage = (meds: RefillLike[] | undefined | null): RefillStage => {
  if (!meds || meds.length === 0) return 'upcoming';
  const orderedCount = meds.filter(isRefillOrdered).length;
  if (orderedCount === 0) return 'upcoming';
  if (meds.some(m => isRefillReminded(m) || (m as any).is_ready === 1)) return 'reminded';
  return 'ordered';
};

// Special orders and online orders: settled once completed, fulfilled, or cancelled
type OrderItemLike = { status?: string | null; notification_count?: number | null };
export const isOrderItemSettled = (i: OrderItemLike) =>
  i.status === 'Completed' || i.status === 'Fulfilled' || i.status === 'Cancelled';
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
 * 1. Blocks re-booking if the current running cycle was already dispensed (last_refill_date within cycle).
 * 2. Flags early booking if next_refill_date is in the future.
 * 3. Allows direct booking if due now or overdue.
 */
export const checkRefillCycleBooking = (med: {
  next_refill_date?: string | null;
  last_refill_date?: string | null;
  refill_interval_days?: number | null;
  status?: string | null;
}): RefillCycleBookingStatus => {
  const intervalDays = Number(med.refill_interval_days || 30);
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

  if (lastDisp) {
    const lastDispDay = new Date(lastDisp);
    lastDispDay.setHours(0, 0, 0, 0);
    const daysSinceDispense = Math.round((now.getTime() - lastDispDay.getTime()) / (1000 * 60 * 60 * 24));
    const minCycleDays = Math.max(7, Math.floor(intervalDays * 0.6));

    if (daysSinceDispense === 0 || (nextDue && nextDue.getTime() > now.getTime() && daysSinceDispense < minCycleDays)) {
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


