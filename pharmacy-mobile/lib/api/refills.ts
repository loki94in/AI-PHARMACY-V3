import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './client';

export interface CreateRefillPayload {
  patient_name: string;
  patient_phone: string;
  medicine_id: number;
  medicine_name?: string;
  refill_interval_days?: number;
  language?: string;
  timestamp?: string;
}

const OFFLINE_REFILLS_KEY = 'offline_refills_queue';

export async function getOfflineRefillsQueue(): Promise<CreateRefillPayload[]> {
  try {
    const data = await AsyncStorage.getItem(OFFLINE_REFILLS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to get offline refills queue:', e);
    return [];
  }
}

export async function queueOfflineRefill(payload: CreateRefillPayload): Promise<void> {
  try {
    const current = await getOfflineRefillsQueue();
    current.push({ ...payload, timestamp: new Date().toISOString() });
    await AsyncStorage.setItem(OFFLINE_REFILLS_KEY, JSON.stringify(current));
  } catch (e) {
    console.error('Failed to queue offline refill:', e);
  }
}

export async function clearOfflineRefillsQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OFFLINE_REFILLS_KEY);
  } catch (e) {
    console.error('Failed to clear offline refills queue:', e);
  }
}

// ─── Refills (view + full management) ──────────────────────────────────────

export interface RefillMedicine {
  id: number;
  medicine_id: number;
  medicine_name: string;
  quantity_needed: number;
  refill_interval_days: number;
  in_stock_qty: number;
  is_active: number;
  status: string;
  is_ready: number;
  hold_for_stock?: number;
  reminder_status?: string;
  next_refill_date?: string;
  inventory_id?: number | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  mrp?: number;
  unit_price?: number;
  pack_size?: number;
  packaging?: string | null;
}

export interface RefillPatientGroup {
  customer_id?: number | null;
  patient_name: string;
  patient_phone: string;
  language?: string;
  next_refill_date: string;
  reminder_status?: string;
  medicines: RefillMedicine[];
}

export async function getRefillsPanel(): Promise<RefillPatientGroup[]> {
  try {
    const groups = await request<RefillPatientGroup[]>('/refills/panel');
    return Array.isArray(groups) ? groups : [];
  } catch (err) {
    console.warn('Failed to fetch refills panel:', err);
    throw err;
  }
}

export function toggleRefillPause(id: number) {
  return request<{ success: boolean }>(`/refills/${id}/toggle-pause`, { method: 'POST' });
}

export function cancelRefill(id: number) {
  return request<{ success: boolean }>(`/refills/${id}/cancel`, { method: 'POST' });
}

export function deleteRefill(id: number) {
  return request<{ success: boolean }>(`/refills/${id}`, { method: 'DELETE' });
}

export function updateRefillFrequency(id: number, refillIntervalDays: number, updateAll = true) {
  return request<{ success: boolean }>(`/refills/${id}/frequency`, {
    method: 'PUT',
    body: JSON.stringify({ refill_interval_days: refillIntervalDays, update_all: updateAll }),
  });
}

export function fulfillRefill(id: number) {
  return request<{ success: boolean }>(`/refills/${id}/fulfill`, { method: 'POST' });
}

export function fulfillAllRefills(phone: string, refillIds?: number[]) {
  return request<{ success: boolean; message?: string }>(`/refills/patient/${encodeURIComponent(phone)}/fulfill-all`, {
    method: 'POST',
    body: JSON.stringify(refillIds ? { refill_ids: refillIds } : {}),
  });
}

export function sendRefillReminderNow(patientPhone: string) {
  return request<{ success: boolean; message?: string }>('/refills/send-reminder-now', {
    method: 'POST',
    body: JSON.stringify({ patient_phone: patientPhone }),
  });
}

export interface PatientProfilePayload {
  customer_id?: number | null;
  original_phone?: string;
  patient_name: string;
  patient_phone: string;
  language?: string;
  next_refill_date?: string;
}

export function updatePatientProfile(payload: PatientProfilePayload) {
  return request<{ success: boolean }>('/refills/patient-profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deletePatientRefills(phone: string) {
  return request<{ success: boolean }>(`/refills/patient/${encodeURIComponent(phone)}`, { method: 'DELETE' });
}

export async function createRefill(payload: CreateRefillPayload): Promise<{ success: boolean; isOffline?: boolean; id?: number; message?: string }> {
  try {
    const res = await request<any>('/refills', {
      method: 'POST',
      body: JSON.stringify({
        patient_name: payload.patient_name,
        patient_phone: payload.patient_phone,
        medicine_id: payload.medicine_id,
        refill_interval_days: payload.refill_interval_days || 30,
        language: payload.language || 'en',
      }),
    });
    return { success: true, isOffline: false, id: res.id, message: res.message };
  } catch (err: any) {
    console.warn('Online create refill failed, queueing offline:', err);
    await queueOfflineRefill(payload);
    return { success: true, isOffline: true, message: `Refill for ${payload.medicine_name || 'medicine'} queued offline` };
  }
}

