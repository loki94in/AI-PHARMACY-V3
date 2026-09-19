import type { SpecialOrder } from '../types/api';

// Sources that count as an "online order" — placed remotely by the customer,
// as opposed to an in-store/manual pharmacist-entered special request.
const ONLINE_ORDER_SOURCES = new Set(['website', 'website_refill', 'whatsapp']);

export function isOnlineOrder(order: Partial<SpecialOrder> & { notes?: string | null }): boolean {
  const src = order.customer_order_source || order.source || '';
  if (ONLINE_ORDER_SOURCES.has(src)) return true;
  if (order.prescription_url) return true;
  const notes = order.notes || '';
  return notes.startsWith('[Website Order]') || notes.startsWith('[Refill Collection');
}
