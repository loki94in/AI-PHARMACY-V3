// A refill medicine is "settled" for the pending/action lists once it has been ordered
// (marked Ordered or sitting in the live cart) AND the patient reminder was sent.
// The server keeps cart_store_name after status flips ordered -> notified, so it stays a reliable ordered flag.
type RefillLike = { status?: string | null; cart_store_name?: string | null; reminder_status?: string | null };

export const isRefillOrdered = (m: RefillLike) => m.status === 'ordered' || !!m.cart_store_name;
export const isRefillReminded = (m: RefillLike) => m.reminder_status === 'SENT' || m.status === 'notified';
export const isRefillSettled = (m: RefillLike) => isRefillOrdered(m) && isRefillReminded(m);

// True when the patient has medicines and every one is settled — nothing left to act on.
export const isPatientRefillsSettled = (meds: RefillLike[] | undefined | null) =>
  !!meds && meds.length > 0 && meds.every(isRefillSettled);

// Simplified 3-button refill workflow (Quick Assist + CRM, owner rule 2026-10):
// Stage A 'upcoming' — no medicine ordered yet → [Add to Cart] [Already Added] [Edit]
// Stage B 'ordered' — ordered but not yet reminded → [Send Collection Reminder] [POS] [Edit]
// Stage C 'reminded' — ordered AND reminded → [Re-Send Reminder] [POS] (no Edit on card)
export type RefillStage = 'upcoming' | 'ordered' | 'reminded';
export const getRefillStage = (meds: RefillLike[] | undefined | null): RefillStage => {
  if (!meds || meds.length === 0) return 'upcoming';
  const orderedCount = meds.filter(isRefillOrdered).length;
  if (orderedCount === 0) return 'upcoming';
  if (meds.every(isRefillSettled)) return 'reminded';
  return 'ordered';
};

// Special orders and online orders: settled once ordered (or arrived/Ready) AND the customer message was sent
// (notification_count counts the sent arrival WhatsApp, written only by the user-clicked send).
type OrderItemLike = { status?: string | null; notification_count?: number | null };
export const isOrderItemSettled = (i: OrderItemLike) =>
  (i.status === 'Ordered' || i.status === 'Ready') && Number(i.notification_count || 0) > 0;
export const isOrderGroupSettled = (items: OrderItemLike[] | undefined | null) =>
  !!items && items.length > 0 && items.every(isOrderItemSettled);
