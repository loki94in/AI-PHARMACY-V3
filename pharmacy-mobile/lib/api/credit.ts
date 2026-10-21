import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './client';

export interface CreditCustomerItem {
  id: number;
  name: string;
  phone: string;
  address?: string;
  language?: string;
  credit_balance: number;
  credit_due_date?: string;
  credit_enabled: number; // 1 = Credit allowed / unlocked, 0 = Credit blocked
  unpaid_bills_count: number;
  last_sale_date?: string;
}

export interface CreditPaymentPayload {
  customer_id: number;
  amount: number;
  customer_name?: string;
  timestamp?: string;
}

const CREDIT_CUSTOMERS_CACHE_KEY = 'cached_credit_customers';
const OFFLINE_CREDIT_PAYMENTS_KEY = 'offline_credit_payments_queue';

// ─── Offline Queue for Credit Payments ────────────────────────────────────────

export async function getOfflineCreditPaymentsQueue(): Promise<CreditPaymentPayload[]> {
  try {
    const data = await AsyncStorage.getItem(OFFLINE_CREDIT_PAYMENTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to get offline credit payments queue:', e);
    return [];
  }
}

export async function queueOfflineCreditPayment(payload: CreditPaymentPayload): Promise<void> {
  try {
    const current = await getOfflineCreditPaymentsQueue();
    current.push({ ...payload, timestamp: new Date().toISOString() });
    await AsyncStorage.setItem(OFFLINE_CREDIT_PAYMENTS_KEY, JSON.stringify(current));
  } catch (e) {
    console.error('Failed to queue offline credit payment:', e);
  }
}

export async function clearOfflineCreditPaymentsQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OFFLINE_CREDIT_PAYMENTS_KEY);
  } catch (e) {
    console.error('Failed to clear offline credit payments queue:', e);
  }
}

// ─── Credit Ledger API ────────────────────────────────────────────────────────

export async function getCreditCustomers(): Promise<CreditCustomerItem[]> {
  try {
    const data = await request<CreditCustomerItem[]>('/crm/credit-customers');
    const list = Array.isArray(data) ? data : [];
    await AsyncStorage.setItem(CREDIT_CUSTOMERS_CACHE_KEY, JSON.stringify(list)).catch(() => {});
    return list;
  } catch (err) {
    console.log('Online fetch credit customers failed, fallback to local cache:', err);
    try {
      const cached = await AsyncStorage.getItem(CREDIT_CUSTOMERS_CACHE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  }
}

export async function payCreditBalance(customerId: number, amount: number, customerName?: string): Promise<{ success: boolean; isOffline?: boolean; message?: string }> {
  try {
    const res = await request<{ success: boolean; message?: string }>('/crm/ledger/pay', {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId, amount }),
    });
    return { success: true, isOffline: false, message: res.message };
  } catch (err) {
    console.warn('Online credit payment failed, queueing offline:', err);
    await queueOfflineCreditPayment({ customer_id: customerId, amount, customer_name: customerName });
    return { success: true, isOffline: true, message: `Payment of ₹${amount.toFixed(2)} queued offline` };
  }
}

export async function toggleCustomerCredit(customerId: number, creditEnabled: boolean): Promise<{ success: boolean; credit_enabled: number; message?: string }> {
  return request<{ success: boolean; credit_enabled: number; message?: string }>(`/crm/credit-customers/${customerId}/toggle-credit`, {
    method: 'PUT',
    body: JSON.stringify({ credit_enabled: creditEnabled }),
  });
}

export async function updateCreditDueDate(customerId: number, dueDate: string | null): Promise<{ success: boolean; message?: string }> {
  return request<{ success: boolean; message?: string }>(`/crm/credit-customers/${customerId}/due-date`, {
    method: 'PUT',
    body: JSON.stringify({ due_date: dueDate }),
  });
}
