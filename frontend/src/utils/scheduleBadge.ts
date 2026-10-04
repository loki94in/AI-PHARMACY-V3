import { getCompactInventoryCache } from '../services/api';

export type RestrictedSchedule = 'H' | 'H1' | 'X';

/** Maps medicines.schedule_type (H / H1 / 'Schedule H1' / X) to a restricted class; anything else is not restricted. */
export const toRestrictedSchedule = (raw?: string | null): RestrictedSchedule | null => {
  const v = String(raw || '').trim().toUpperCase().replace(/^SCHEDULE\s+/, '');
  return v === 'H' || v === 'H1' || v === 'X' ? v : null;
};

let indexedFrom: unknown = null;
let scheduleByMedicine = new Map<number, RestrictedSchedule>();

/** Restricted schedule for a medicine, from the already-loaded compact inventory (zero network). */
export const getMedicineSchedule = (medicineId?: number | string | null): RestrictedSchedule | null => {
  const id = Number(medicineId);
  if (!id) return null;
  const cache = getCompactInventoryCache();
  if (cache !== indexedFrom) {
    indexedFrom = cache;
    scheduleByMedicine = new Map();
    for (const it of cache) {
      const s = toRestrictedSchedule(it.schedule_type);
      if (s) scheduleByMedicine.set(Number(it.medicine_id), s);
    }
  }
  return scheduleByMedicine.get(id) ?? null;
};

export const SCHEDULE_LABEL: Record<RestrictedSchedule, string> = {
  H: 'Schedule H',
  H1: 'Schedule H1',
  X: 'Schedule X',
};
