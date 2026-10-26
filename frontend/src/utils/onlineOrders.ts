import type { SpecialOrder } from '../types/api';

// Sources that count as an "online order" — placed remotely by the customer,
// as opposed to an in-store/manual pharmacist-entered special request.
// NOTE: Refill batches are strictly managed in the Refills pipeline and QA Refill Panel;
// per architecture contract they are NEVER routed to the Online Orders app.
const ONLINE_ORDER_SOURCES = new Set(['website', 'whatsapp', 'manual_phone_order', 'pharmacy_assisted']);

export function isOnlineOrder(order: Partial<SpecialOrder> & { notes?: string | null }): boolean {
  // Explicit gate: refill orders/batches are NEVER routed to Online Orders app
  const orderType = (order as any).order_type || '';
  if (orderType === 'REFILL') return false;
  const src = order.customer_order_source || order.source || '';
  if (src === 'website_refill' || src === 'refill') return false;

  const notes = order.notes || '';
  if (notes.startsWith('[Refill Collection') || notes.includes('[Website Refill Request')) return false;

  if (ONLINE_ORDER_SOURCES.has(src)) return true;
  if (order.prescription_url) return true;
  return notes.startsWith('[Website Order]');
}

