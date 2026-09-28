/** Module-level page caches for instant remount — cleared on settings/contact writes. */

export interface CachedDeliveryBoy {
  id: number;
  name: string;
  whatsapp_number?: string;
  is_active: number;
}

let cachedDispatchOrders: unknown[] | null = null;
let cachedDispatchDeliveryBoys: CachedDeliveryBoy[] | null = null;
let cachedDispatchReminders: unknown[] | null = null;

export function getDispatchOrdersCache(): unknown[] | null {
  return cachedDispatchOrders;
}

export function setDispatchOrdersCache(orders: unknown[] | null): void {
  cachedDispatchOrders = orders;
}

export function getDispatchDeliveryBoysCache(): CachedDeliveryBoy[] | null {
  return cachedDispatchDeliveryBoys;
}

export function setDispatchDeliveryBoysCache(boys: CachedDeliveryBoy[] | null): void {
  cachedDispatchDeliveryBoys = boys;
}

export function getDispatchRemindersCache(): unknown[] | null {
  return cachedDispatchReminders;
}

export function setDispatchRemindersCache(reminders: unknown[] | null): void {
  cachedDispatchReminders = reminders;
}

export function clearDispatchPageCache(): void {
  cachedDispatchOrders = null;
  cachedDispatchDeliveryBoys = null;
  cachedDispatchReminders = null;
}

