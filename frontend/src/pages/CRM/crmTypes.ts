export interface RefillPatient {
  customer_id?: number;
  patient_name: string;
  patient_phone: string;
  language?: string;
  reminder_mode?: 'auto' | 'manual';
  next_refill_date: string;
  reminder_status?: string;
  reminder_sent_at?: string | null;
  medicines: {
    id: number;
    medicine_id?: number;
    medicine_name: string;
    quantity_needed: number;
    refill_interval_days?: number;
    reminder_mode?: 'auto' | 'manual';
    in_stock_qty: number;
    is_ready: number;
    acknowledged: number;
    hold_for_stock: number;
    is_active?: number;
    status: string;
    quick_bill_id: number | null;
    inventory_id?: number;
    batch_no?: string;
    expiry_date?: string;
    mrp?: number;
    sell_price?: number;
    unit_price?: number;
    packaging?: string;
    pack_size?: number;
    batch_quantity?: number;
    batch_loose_quantity?: number;
    stock_verified_override?: number;
    reminder_status?: string;
    reminder_sent_at?: string | null;
    patient_confirmed?: number;
    confirmed_at?: string | null;
    cart_store_name?: string | null;
    cart_qty?: number | null;
    in_live_cart?: boolean;
    linked_distributors?: string[];
  }[];
}

export interface AutomationLog {
  id: number;
  type: string;
  status: string;
  recipient: string;
  message: string;
  created_at: string;
  sent_at?: string;
  error?: string;
}

export type RefillLanguage = 'en' | 'hi' | 'mr';

export type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

export interface RefillFulfillmentRow {
  fulfilled_at?: string;
  created_at?: string;
  medicine_name?: string;
  quantity_fulfilled?: number;
  linked_invoice_no?: string;
  invoice_no?: string;
  fulfilled_via?: string;
  next_due_date?: string;
}

export interface SalesHistoryItemLine {
  id?: number;
  medicine_id?: number;
  name?: string;
  medicine_name?: string;
  inventory_id?: number;
  batch_no?: string;
  batch_number?: string;
  expiry_date?: string;
  quantity: number;
  loose_qty?: number;
  unit_price: number;
  mrp?: number;
  sell_price?: number | null;
  discount_per?: number;
  discount?: number;
  pack_size?: number;
}

export interface SalesHistoryInvoice {
  id: number;
  invoice_no?: string;
  date?: string;
  items?: SalesHistoryItemLine[];
  item_count?: number;
  payment_medium?: string;
  payment_status?: string;
  total_amount?: number;
  customer_name?: string;
  customer_phone?: string;
  doctor_name?: string;
}

export interface OcrParsedPayload {
  items?: { name?: string; medicine_name?: string; text?: string }[];
  text?: string;
}

export interface MedicineSearchRow {
  id: number;
  name: string;
  manufacturer?: string;
  mrp?: number;
  sell_price?: number;
  last_purchase_mrp?: number;
}

export interface PharmarackSearchResult {
  name: string;
  stock?: number;
  distributor?: string;
  rate?: number | null;
  mrp?: number | null;
  mapped?: boolean;
  scheme?: string;
  productId?: string | number;
  storeId?: string | number;
  productCode?: string;
  company?: string;
  packaging?: string;
}

export function formatTs(ts: number | string) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function futureDateLabel(daysAhead: number, opts: Intl.DateTimeFormatOptions): string {
  return new Date(Date.now() + daysAhead * 86400000).toLocaleDateString('en-IN', opts);
}

export function formatDate(dateStr: string | undefined) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

/** Silent retry for cold-boot transient failures — toast only after retries exhausted */
export async function withSilentRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

export interface MedicineSuggestion {
  id: number;
  name: string;
  manufacturer?: string;
  mrp?: number;
  in_stock_qty?: number;
  location?: string;
}

export interface MedicineRow {
  medicineId: number | null;
  medicineName: string;
  manufacturer?: string;
  mrp?: number;
  inStockQty?: number;
  quantity_needed: number;
  searchTerm: string;
  suggestions: MedicineSuggestion[];
  isOpen: boolean;
  loadingSuggestions?: boolean;
}

export const emptyRow = (): MedicineRow => ({
  medicineId: null,
  medicineName: '',
  quantity_needed: 3,
  searchTerm: '',
  suggestions: [],
  isOpen: false,
  loadingSuggestions: false
});
