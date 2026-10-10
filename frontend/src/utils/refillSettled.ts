// A refill medicine or special order is only settled once it is fulfilled/completed
// or billed at POS. Marking ready arms the collection notification workflow but does
// NOT hide the order from the store workflow until the customer transaction is handled!
type RefillLike = { status?: string | null; cart_store_name?: string | null; reminder_status?: string | null };

export const isRefillOrdered = (m: RefillLike) => m.status === 'ordered' || !!m.cart_store_name;
export const isRefillReminded = (m: RefillLike) => m.reminder_status === 'SENT' || m.status === 'notified';
export const isRefillSettled = (m: RefillLike) =>
  m.status === 'completed' || m.status === 'fulfilled' || m.status === 'canceled';

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

