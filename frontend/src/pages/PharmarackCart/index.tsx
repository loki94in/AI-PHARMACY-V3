import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { RotateCw, RotateCcw, ExternalLink, ShoppingCart, Package, AlertCircle, AlertTriangle, Truck, Clock, Send, Building2, MessageSquare, Phone, Search, Edit2, X, Plus, Check, Calendar, TrendingUp, TrendingDown, ArrowDown, Layers, Trash2, ArrowLeftRight, ArrowRight, ChevronDown, ChevronUp, ChevronRight, Folder, FolderOpen, CheckCircle2, WifiOff, Store, Zap, Loader2, BookOpen, Star, Globe } from 'lucide-react';
import { formatDisplayDate, getTodayString } from '../../utils/date';
import { api, apiClient, type SpecialOrder, type Refill, type ReorderSuggestion, type BatchLastPurchaseResult, type ReorderRecentItem } from '../../services/api';
import { toastEvent, liveCartAddEvent, specialOrdersEvent, whatsappQueueEvent, messageSendEvent } from '../../services/events';
import { findBestCartMatchForOrder } from '../../utils/orderFuzzyMatcher';
import { isStrictSameProduct } from '../../utils/strictProductName';
import { isRefillFulfilledToday } from '../../utils/refillSettled';

import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { sanitizePhoneInput } from '../../utils/phone';
import { PharmarackCartCalendar } from '../../components/PharmarackCartCalendar';
import { usePageActive } from '../../lib/keepAlive/PageActiveContext';
import { broadcastContactDataChanged } from '../../utils/settingsSync';
import { formatPackagingAndUnit } from '../../utils/packagingMatcher';
import { useModalEscape } from '../../services/keyboardShortcuts';
import { CartPurchaseHistoryModal } from './CartPurchaseHistoryModal';
import { BatchDispatchModal } from './BatchDispatchModal';
import { SingleDispatchModal } from './SingleDispatchModal';
import { SingleOrderConfirmModal } from './SingleOrderConfirmModal';
import { MedicineLinkModal } from '../../components/MedicineLinkModal';

interface CartLineItem {
  productId: number | null;
  storeId: number;
  productCode: string;
  productName: string;
  company: string;
  packaging: string;
  qty: number;
  ptr: number;
  mrp: number;
  scheme: string;
  stock: number | null;
  amount: number;
  cartSource: string;
  isChecked: boolean;
  createdDate: string;
}

// ── Silent Cart Deletion Configuration ──
export const PHARMARACK_DELETE_BUFFER_MS = 800;      // Base silent buffer: 800ms (backend mutex serializes)
export const PHARMARACK_DELETE_RETRY_STEP_MS = 1000; // +1s per retry: 1.8s, 2.8s
export const PHARMARACK_DELETE_MAX_RETRIES = 3;      // Max 3 tries
const CART_CACHE_MAX_AGE_MS = 15 * 60 * 1000;        // 15-minute freshness TTL for local cart line cache

interface Distributor {
  storeId: number;
  storeName: string;
  lineTotal: number;
  deliveryPersons: { name: string; code: string }[];
  items: CartLineItem[];
  // Limits from Pharmarack; null/undefined = unknown (never assumed 0), 0 = no restriction
  minAmountLimit?: number | null;
  minItemLimit?: number | null;
  maxItemLimit?: number | null;
  maxAmountLimit?: number | null;
  isUnpricedStore?: boolean;
}

function getCartLineItemValue(item: { amount?: number; ptr?: number; rate?: number; qty?: number; quantity?: number }): number {
  if (typeof item.amount === 'number' && item.amount > 0) return item.amount;
  const rate = item.ptr || item.rate || 0;
  const qty = item.qty || item.quantity || 1;
  return rate * qty;
}

function isLineItemStocked(item: CartLineItem): boolean {
  if (item.stock === null || item.stock === undefined || String(item.stock).toLowerCase() === 'offline') {
    return false;
  }
  const n = Number(item.stock);
  return Number.isFinite(n) && n > 0 && (item.qty || 1) > 0;
}

function getDistributorEffectiveTotal(
  dist: Distributor,
  isIncluded?: (item: CartLineItem, dist: Distributor) => boolean
): number {
  const activeItems = (dist.items || []).filter(i => isIncluded ? isIncluded(i, dist) : (i.isChecked !== false));
  const computedTotal = activeItems.reduce((sum, item) => sum + getCartLineItemValue(item), 0);
  if (activeItems.length === (dist.items || []).length) {
    return Math.max(dist.lineTotal || 0, computedTotal);
  }
  return computedTotal;
}

// Human-readable reasons Pharmarack would reject this store's cart; empty = eligible / nothing known to block.
// Evaluates active/checked items and confirmed positive stock to match Pharmarack's ordering rules.
function getOrderLimitIssues(
  dist: Distributor,
  isIncluded?: (item: CartLineItem, dist: Distributor) => boolean
): string[] {
  const issues: string[] = [];
  const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const activeItems = (dist.items || []).filter(i => isIncluded ? isIncluded(i, dist) : (i.isChecked !== false));
  const total = getDistributorEffectiveTotal(dist, isIncluded);
  const stockedCount = activeItems.filter(isLineItemStocked).length;
  const minAmt = dist.minAmountLimit ?? 0;
  const minItems = dist.minItemLimit ?? 0;
  const maxAmt = dist.maxAmountLimit ?? 0;
  const maxItems = dist.maxItemLimit ?? 0;

  // On Pharmarack website, unpriced inquiry orders (where all items have no live PTR or local price,
  // showing as PTR: - and Total: ₹0.00) are exempt from monetary minimum amount requirements.
  const hasPricedItems = activeItems.some(i => (i.ptr || 0) > 0 || (i.amount || 0) > 0);

  if (minAmt > 0 && hasPricedItems && total < minAmt) {
    issues.push(`Minimum Order amount is set Rs. ${fmt(minAmt)} for the ${dist.storeName} store (short by ₹${fmt(minAmt - total)})`);
  }
  if (minItems > 0 && stockedCount < minItems) {
    issues.push(`${dist.storeName} - Minimum line items for above store with stock is ${minItems} (need ${minItems - stockedCount} more)`);
  }
  if (maxAmt > 0 && total > maxAmt) {
    issues.push(`Maximum Order amount is Rs. ${fmt(maxAmt)} for the ${dist.storeName} store (over by ₹${fmt(total - maxAmt)})`);
  }
  if (maxItems > 0 && activeItems.length > maxItems) {
    issues.push(`${dist.storeName} - Maximum line items is ${maxItems} (remove ${activeItems.length - maxItems})`);
  }
  return issues;
}

function isDistributorCandidateMatch(
  r: ReorderRecentItem,
  dist: Distributor,
  distributorMappings?: Record<string, { distributorId: number | null; phone: string; deliveryBoyId?: number | null }>
): boolean {
  // 1. Direct storeId numeric match
  if (r.storeId != null && dist.storeId != null && Number(r.storeId) === Number(dist.storeId)) {
    return true;
  }

  const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const rStore = norm(r.storeName || r.lastDistributorName);
  const targetStore = norm(dist.storeName);

  // 2. Exact normalized string match
  if (rStore && targetStore && rStore === targetStore) {
    return true;
  }

  // 3. Match via distributorMappings bridge (local distributorId <-> Pharmarack store)
  if (distributorMappings) {
    let mappedDistId = distributorMappings[targetStore]?.distributorId;
    if (!mappedDistId) {
      const matchKey = Object.keys(distributorMappings).find(k => k === targetStore || targetStore.includes(k) || k.includes(targetStore));
      if (matchKey) mappedDistId = distributorMappings[matchKey]?.distributorId;
    }
    if (mappedDistId && r.distributorId != null && Number(r.distributorId) === Number(mappedDistId)) {
      return true;
    }
  }

  // 4. Substring inclusion if sufficiently long (at least 5 characters)
  if (rStore && targetStore && (rStore.length >= 5 && targetStore.length >= 5)) {
    if (rStore.includes(targetStore) || targetStore.includes(rStore)) {
      return true;
    }
  }

  // 5. Significant word token overlap (e.g. "shree ganesh" matching "shree ganesh pharma")
  const tokenize = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length >= 3 && !['agency', 'agencies', 'pharma', 'pharmaceuticals', 'enterprises', 'distributor', 'distributors', 'pvt', 'ltd'].includes(w));
  const rTokens = tokenize(r.storeName || r.lastDistributorName);
  const targetTokens = tokenize(dist.storeName);
  if (rTokens.length > 0 && targetTokens.length > 0) {
    const common = rTokens.filter(t => targetTokens.includes(t));
    if (common.length >= 1) {
      return true;
    }
  }

  return false;
}

// Medicines already ordered from this distributor (prioritizing real purchase bills history with real PTR) that would cover a
// minimum-amount or minimum-items shortfall. Shows 4 medicines at a time; user can skip to see another. Hidden when there is no shortfall.
function getDistributorShortfallDeficit(
  dist: Distributor,
  isIncluded?: (item: CartLineItem, dist: Distributor) => boolean
): { itemShortfall: number; amtShortfall: number; minItems: number; minAmt: number } {
  const minAmt = dist.minAmountLimit ?? 0;
  const minItems = dist.minItemLimit ?? 0;
  const activeItems = (dist.items || []).filter(i => isIncluded ? isIncluded(i, dist) : (i.isChecked !== false));
  const total = getDistributorEffectiveTotal(dist, isIncluded);
  const stockedCount = activeItems.filter(isLineItemStocked).length;
  const hasPricedItems = activeItems.some(i => (i.ptr || 0) > 0 || (i.amount || 0) > 0);

  const amtShortfall = (minAmt > 0 && hasPricedItems) ? Math.max(0, minAmt - total) : 0;
  const itemShortfall = minItems > 0 ? Math.max(0, minItems - stockedCount) : 0;
  return { itemShortfall, amtShortfall, minItems, minAmt };
}

function getDistributorShortfallFillers(
  dist: Distributor,
  purchaseHistory: ReorderRecentItem[],
  recentOrders: ReorderRecentItem[],
  skippedKeys?: Set<string>,
  distributorMappings?: Record<string, { distributorId: number | null; phone: string; deliveryBoyId?: number | null }>,
  isIncluded?: (item: CartLineItem, dist: Distributor) => boolean
): { item: ReorderRecentItem; qty: number; amount: number }[] {
  const { amtShortfall, itemShortfall } = getDistributorShortfallDeficit(dist, isIncluded);

  if (amtShortfall <= 0 && itemShortfall <= 0) return [];

  const maxAmt = dist.maxAmountLimit ?? 0;
  const maxItems = dist.maxItemLimit ?? 0;
  const currentTotal = getDistributorEffectiveTotal(dist, isIncluded);
  const activeItems = (dist.items || []).filter(i => isIncluded ? isIncluded(i, dist) : (i.isChecked !== false));
  if (maxItems > 0 && activeItems.length >= maxItems) return [];
  if (maxAmt > 0 && currentTotal >= maxAmt) return [];

  const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanMedKey = (s?: string) => norm(s).replace(/(tablet|tablets|tab|capsule|capsules|cap|injection|inj|syrup|syr|drops|suspension|susp|cream|ointment|gel|lotion|\d+s|\d+tab|\d+cap)/g, '');

  // Set of medicines already present in the live cart for this distributor
  const inCartNames = new Set((dist.items || []).map(i => norm(i.productName)).filter(Boolean));
  const inCartCleanNames = new Set((dist.items || []).map(i => cleanMedKey(i.productName)).filter(Boolean));
  const inCartCodes = new Set((dist.items || []).map(i => norm(i.productCode)).filter(Boolean));

  const isAlreadyInCart = (r: ReorderRecentItem) => {
    if (r.productCode && inCartCodes.has(norm(r.productCode))) return true;
    const rKey = norm(r.medicineName);
    if (!rKey) return false;
    if (inCartNames.has(rKey)) return true;
    const rClean = cleanMedKey(r.medicineName);
    if (rClean && inCartCleanNames.has(rClean)) return true;
    for (const cn of inCartNames) {
      if (cn && (cn.includes(rKey) || rKey.includes(cn)) && Math.min(cn.length, rKey.length) >= 4) {
        return true;
      }
    }
    for (const cn of inCartCleanNames) {
      if (cn && rClean && (cn.includes(rClean) || rClean.includes(cn)) && Math.min(cn.length, rClean.length) >= 4) {
        return true;
      }
    }
    return false;
  };

  const combined = [...purchaseHistory, ...recentOrders];
  // Strict de-duplication: Keyed by canonical medicine ID or normalized name for this distributor
  const seenMeds = new Set<string>();

  const candidates = combined
    .filter(r => {
      if (!isDistributorCandidateMatch(r, dist, distributorMappings)) return false;
      if (isAlreadyInCart(r)) return false;

      // User constraint: Never automatch unlinked medicines. Suggestions for this distributor
      // must strictly carry verified productCode and (productId or mapped: true).
      const hasVerifiedProduct = Boolean(r.productCode && (r.productId || r.mapped));
      if (!hasVerifiedProduct) return false;

      const mKey = r.productCode ? `code_${dist.storeId}_${r.productCode}` : (r.medicineId ? `id_${r.medicineId}` : `name_${norm(r.medicineName)}`);
      if (seenMeds.has(mKey)) return false;
      if (skippedKeys && skippedKeys.has(norm(r.medicineName))) return false;
      seenMeds.add(mKey);
      return true;
    })
    .sort((a, b) => {
      // Prioritize items already mapped/linked with verified product code
      const aMapped = a.mapped || Boolean(a.productCode && a.productId);
      const bMapped = b.mapped || Boolean(b.productCode && b.productId);
      if (aMapped !== bMapped) return aMapped ? -1 : 1;
      return (Number(b.billCount || 0) - Number(a.billCount || 0)) || (b.lastOrderedDate || '').localeCompare(a.lastOrderedDate || '');
    });

  const picks: { item: ReorderRecentItem; qty: number; amount: number }[] = [];
  let count = 0;
  let runningTotal = currentTotal;

  for (const r of candidates) {
    const qty = 1; // Default to 1 unit to fill minimum requirements without inflating order
    const amount = (r.ptr || r.lastRate || 0) * qty;

    // Do not exceed distributor max ordering limits
    if (maxAmt > 0 && (runningTotal + amount) > maxAmt) continue;
    if (maxItems > 0 && (activeItems.length + picks.length) >= maxItems) break;

    picks.push({ item: r, qty, amount });
    runningTotal += amount;
    count += 1;
    if (count >= 4) break; // Display 4 medicines at a time
  }

  return picks;
}

interface SentPopupRow { key: string; name: string; qty: number; storeId: number; storeName: string }
const SentSelectionPopup: React.FC<{
  rows: Array<SentPopupRow & { item: LocalSentOrderItem }>;
  busy: boolean;
  onQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onChangeDistributor: (row: SentPopupRow & { item: LocalSentOrderItem }) => void;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ rows, busy, onQty, onRemove, onChangeDistributor, onConfirm, onClose }) => {
  useModalEscape(true, onClose);
  return (
    <div className="fixed inset-0 z-modal bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="relative bg-bg border border-border rounded-2xl w-[95vw] max-w-md max-h-[80vh] flex flex-col shadow-[0_4px_24px_rgba(0,0,0,0.12)] text-text">
        <div className="p-4 border-b border-border bg-bg2 rounded-t-2xl">
          <h3 className="text-sm font-bold">Re-order selected medicines</h3>
          <p className="text-[11px] text-muted mt-0.5">Each medicine goes to the live cart of the distributor shown. Change a quantity, or pick a different distributor.</p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {rows.length === 0 && <p className="text-xs text-muted italic text-center py-6">No medicines left in this list.</p>}
          {rows.map(r => (
            <div key={r.key} className="flex items-center gap-2 bg-bg2 border border-glass-border/40 rounded-xl p-2.5">
              <span className="flex-1 min-w-0 text-xs font-semibold" title={r.name}><span className="block truncate">{r.name}</span><span className="block text-[10px] font-normal text-muted truncate">{r.storeName}</span></span>
              {(r.item.packaging || r.item.Packing) ? <span className="text-[10px] font-mono text-muted shrink-0">{String(r.item.packaging || r.item.Packing)}</span> : null}
              <input
                type="number"
                min={1}
                value={r.qty}
                onChange={e => onQty(r.key, Number(e.target.value))}
                className="w-16 bg-bg border border-border rounded-lg px-2 py-1 text-xs text-text font-mono text-center focus:outline-none focus:border-primary"
                aria-label={`Quantity for ${r.name}`}
              />
              <button type="button" onClick={() => onChangeDistributor(r)} className="px-2 py-1 rounded-lg bg-bg3 border border-border text-[10px] font-bold text-text hover:bg-bg cursor-pointer" title="Search every distributor for this medicine">
                Change distributor
              </button>
              <button type="button" onClick={() => onRemove(r.key)} className="px-1.5 py-1 rounded-lg text-muted hover:text-text text-xs cursor-pointer" aria-label={`Remove ${r.name}`}>✕</button>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-border bg-bg2 rounded-b-2xl flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-xl border border-border text-xs font-medium text-muted hover:text-text hover:bg-bg3 cursor-pointer">Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || rows.length === 0}
            className="px-4 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            {busy ? 'Adding…' : `Add ${rows.length} to cart`}
          </button>
        </div>
      </div>
    </div>
  );
};

interface CartItemQtyEditorProps {
  qty: number;
  onCommit: (newQty: number) => void;
  isUpdating: boolean;
  disabled?: boolean;
}

const CartItemQtyEditor: React.FC<CartItemQtyEditorProps> = React.memo(({ qty, onCommit, isUpdating, disabled }) => {
  const [localVal, setLocalVal] = useState<string>(() => String(qty || 1));
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from props only when user is NOT actively typing/focused
  useEffect(() => {
    if (!isFocused) {
      setLocalVal(String(qty || 1));
    }
  }, [qty, isFocused]);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const triggerCommit = (valStr: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const parsed = parseInt(valStr.replace(/\D/g, ''), 10);
    if (!isNaN(parsed) && parsed >= 1) {
      if (parsed !== qty) {
        onCommit(parsed);
      }
    } else {
      // Revert if empty or invalid
      setLocalVal(String(qty || 1));
    }
  };

  const scheduleDebouncedCommit = (valStr: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      triggerCommit(valStr);
    }, 1200); // 1.2s safe debounce as requested by user
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow empty string so user can clear & retype, or allow only digits
    const cleaned = raw.replace(/\D/g, '');
    setLocalVal(cleaned);
    scheduleDebouncedCommit(cleaned);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      triggerCommit(localVal);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      setLocalVal(String(qty || 1));
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    triggerCommit(localVal);
  };

  const handleStep = (delta: number) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const cur = parseInt(localVal.replace(/\D/g, ''), 10);
    const base = isNaN(cur) || cur < 1 ? qty : cur;
    const next = Math.max(1, base + delta);
    setLocalVal(String(next));
    onCommit(next);
  };

  return (
    <div className="flex items-center justify-center gap-1 flex-nowrap shrink-0">
      <button
        type="button"
        onClick={() => handleStep(-1)}
        disabled={disabled || (qty <= 1 && (!localVal || Number(localVal) <= 1))}
        className="w-5 h-5 rounded bg-bg3 border border-glass-border hover:bg-bg2 hover:text-text text-muted flex items-center justify-center font-bold text-xs disabled:opacity-40 transition-all shrink-0 cursor-pointer"
        aria-label="Decrease quantity"
        title="Decrease quantity"
      >
        -
      </button>
      <div className="relative">
        <input
          type="text"
          pattern="[0-9]*"
          value={localVal}
          onFocus={(e) => {
            setIsFocused(true);
            e.target.select();
          }}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="1"
          className={`w-10 text-center font-black text-text font-mono bg-bg border rounded py-0.5 text-xs focus:outline-none transition-colors shrink-0 ${
            isUpdating ? 'border-primary/60 ring-1 ring-primary/20' : 'border-glass-border focus:border-primary'
          }`}
          aria-label="Medicine quantity"
        />
        {isUpdating && (
          <span className="absolute -top-1 -right-1 flex h-2 w-2 pointer-events-none">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => handleStep(1)}
        disabled={disabled}
        className="w-5 h-5 rounded bg-bg3 border border-glass-border hover:bg-bg2 hover:text-text text-muted flex items-center justify-center font-bold text-xs disabled:opacity-40 transition-all shrink-0 cursor-pointer"
        aria-label="Increase quantity"
        title="Increase quantity"
      >
        +
      </button>
    </div>
  );
});
CartItemQtyEditor.displayName = 'CartItemQtyEditor';

interface LocalPriceHistoryRow {
  date?: string;
  invoice_date?: string;
  invoice_no?: string;
  distributor_name?: string;
  batch_no?: string | null;
  expiry_date?: string | null;
  rate: number;
  mrp: number;
  quantity?: number;
  free_qty?: number;
  cd_rs: number;
  cd_per?: number;
  net_rate: number;
}

interface LocalDistributorRecord {
  id?: number;
  name?: string;
  phone?: string;
  mobile?: string;
  whatsapp?: string;
  contact?: string;
  delivery_boy_id?: number | null;
}

interface LocalSentOrderItem {
  productCode?: string;
  productId?: number | null;
  productName?: string;
  product?: string;
  name?: string;
  qty?: number;
  quantity?: number;
  rate?: number;
  ptr?: number;
  mrp?: number;
  company?: string;
  packaging?: string;
  Packing?: string;
  storeId?: number;
  storeName?: string;
  amount?: number;
  placedAt?: number;
}

interface LocalSentOrder {
  id: number;
  order_date?: string;
  store_id?: number;
  store_name?: string;
  order_no?: string | null;
  pharmarack_order_nos?: string[];
  items: LocalSentOrderItem[];
  placed_at?: number;
  batch_sent?: boolean;
  batch_sent_at?: number | null;
  source?: string;
}

type LocalSentMapEntry = { storeId: number | null; storeName: string; placedAt: number; items: LocalSentOrderItem[] };

interface LocalSwitchCatalogItem {
  productId?: number;
  productCode?: string;
  productName?: string;
  name?: string;
  storeId: string | number;
  storeName: string;
  company?: string;
  packaging?: string;
  rate?: number;
  mrp?: number;
  scheme?: string;
  mapped?: boolean;
  stock?: string;
}

interface LocalReorderSameCard {
  medicineName: string;
  medicineId?: number;
  company?: string;
  mrp?: number;
  packaging?: string;
  ptr?: number;
  currentStock: number;
  minStock: number;
  suggestedQty: number;
  hasPreviousPurchase?: boolean;
  previousPurchase?: {
    supplierName?: string;
    quantity?: number;
    price?: number;
    mrp?: number;
    purchaseDate?: string;
  };
}

interface LocalRefillPanelPatient {
  patient_name: string;
  patient_phone: string;
  next_refill_date: string;
  medicines?: Array<{
    id: number;
    medicine_id?: number;
    medicine_name?: string;
    status?: string;
    is_active?: number;
    quantity_needed?: number | string;
    in_stock_qty?: number | string;
    hold_for_stock?: number;
    refill_interval_days?: number;
    reminder_status?: Refill['reminder_status'];
    reminder_sent_at?: string | null;
  }>;
}

type LocalDeliveryBoyRow = { id?: number; name: string; whatsapp_number: string; is_active?: number };

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };
type LocalLiveSearchRow = {
  name?: string; shortName?: string; fullName?: string; packaging?: string; company?: string;
  rate?: number | null; mrp?: number | null; productCode?: string; productId?: number; storeId?: number;
  isOffline?: boolean; isLocalPharmacy?: boolean;
};

const CART_CACHE_STORAGE_KEY = 'pharmarack_cart_cache_v1';
const MAX_PRICE_HISTORY_CACHE_ENTRIES = 200;

interface PersistedCartCache {
  distributors: Distributor[];
  priceHistory: Record<string, LocalPriceHistoryRow[]>;
  savedAt: number;
}

const loadPersistedCartCache = (): { distributors: Distributor[]; priceHistory: Record<string, LocalPriceHistoryRow[]> } => {
  try {
    const raw = localStorage.getItem(CART_CACHE_STORAGE_KEY);
    if (raw) {
      const parsed: PersistedCartCache = JSON.parse(raw);
      const isFresh = parsed && typeof parsed.savedAt === 'number' && (Date.now() - parsed.savedAt < CART_CACHE_MAX_AGE_MS);
      if (parsed && Array.isArray(parsed.distributors) && isFresh) {
        const sorted = [...parsed.distributors]
          .map(d => ({
            ...d,
            items: [...(d.items || [])].sort((a, b) =>
              (a.productName || '').localeCompare(b.productName || '', undefined, { sensitivity: 'base' })
            )
          }))
          .sort((a, b) =>
            (a.storeName || '').localeCompare(b.storeName || '', undefined, { sensitivity: 'base' })
          );
        return {
          distributors: sorted,
          priceHistory: (parsed.priceHistory && typeof parsed.priceHistory === 'object') ? parsed.priceHistory : {}
        };
      } else if (parsed && typeof parsed.priceHistory === 'object') {
        return { distributors: [], priceHistory: parsed.priceHistory };
      }
    }
  } catch (_) { }
  return { distributors: [], priceHistory: {} };
};

const persistCartCache = (distributors: Distributor[], priceHistory: Record<string, LocalPriceHistoryRow[]>) => {
  try {
    const keys = Object.keys(priceHistory);
    const trimmedHistory: Record<string, LocalPriceHistoryRow[]> = {};
    const keysToKeep = keys.slice(-MAX_PRICE_HISTORY_CACHE_ENTRIES);
    for (const k of keysToKeep) {
      trimmedHistory[k] = priceHistory[k];
    }
    const payload: PersistedCartCache = {
      distributors,
      priceHistory: trimmedHistory,
      savedAt: Date.now()
    };
    localStorage.setItem(CART_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch (_) { }
};

const mergeItemIntoDistributors = (
  prev: Distributor[],
  item: {
    productId?: number | null;
    storeId: number;
    productCode?: string;
    productName: string;
    company?: string;
    packaging?: string;
    qty: number;
    ptr?: number;
    rate?: number;
    mrp?: number;
    scheme?: string;
    stock?: number | null;
    storeName?: string;
    isChecked?: boolean;
  }
): Distributor[] => {
  const itemRate = item.ptr !== undefined ? item.ptr : (item.rate || 0);
  const itemStock = item.stock !== undefined && item.stock !== null && Number(item.stock) > 0 ? Number(item.stock) : 100;
  const lineItem: CartLineItem = {
    productId: item.productId ?? null,
    storeId: item.storeId,
    productCode: item.productCode || '',
    productName: item.productName,
    company: item.company || '',
    packaging: item.packaging || '',
    qty: item.qty || 1,
    ptr: itemRate,
    mrp: item.mrp || 0,
    scheme: item.scheme || '',
    stock: itemStock,
    amount: itemRate * (item.qty || 1),
    cartSource: 'manual',
    isChecked: item.isChecked ?? true,
    createdDate: new Date().toISOString()
  };

  const storeIdx = prev.findIndex(d => d.storeId === item.storeId);
  if (storeIdx === -1) {
    const newDist: Distributor = {
      storeId: item.storeId,
      storeName: item.storeName || 'Distributor',
      lineTotal: lineItem.amount,
      deliveryPersons: [],
      items: [lineItem]
    };
    return [newDist, ...prev].sort((a, b) =>
      (a.storeName || '').localeCompare(b.storeName || '', undefined, { sensitivity: 'base' })
    );
  }

  const dist = prev[storeIdx];
  // Same product = same Pharmarack code / id. Two pack variants share a name, so a name match counts only
  // when neither side carries an identity AND packaging and MRP (when both are known) agree.
  const itemIdx = dist.items.findIndex(it => {
    if (item.productCode && it.productCode) return it.productCode === item.productCode;
    if (item.productId && it.productId) return it.productId === item.productId;
    if (it.productName.toLowerCase() !== item.productName.toLowerCase()) return false;
    const samePack = !item.packaging || !it.packaging || item.packaging.trim().toLowerCase() === it.packaging.trim().toLowerCase();
    const sameMrp = !item.mrp || !it.mrp || Math.abs(item.mrp - it.mrp) < 0.5;
    return samePack && sameMrp;
  });

  let updatedItems: CartLineItem[];
  if (itemIdx >= 0) {
    const existing = dist.items[itemIdx];
    const newQty = (existing.qty || 0) + (item.qty || 1);
    const updatedLineItem: CartLineItem = {
      ...existing,
      qty: newQty,
      amount: (existing.ptr || 0) * newQty
    };
    updatedItems = [...dist.items];
    updatedItems[itemIdx] = updatedLineItem;
  } else {
    updatedItems = [lineItem, ...dist.items];
  }

  // Sort items alphabetically
  updatedItems.sort((a, b) =>
    (a.productName || '').localeCompare(b.productName || '', undefined, { sensitivity: 'base' })
  );

  const newLineTotal = updatedItems.reduce((s, it) => s + (it.amount || 0), 0);
  const updatedDist: Distributor = {
    ...dist,
    items: updatedItems,
    lineTotal: newLineTotal
  };

  const next = [...prev];
  next[storeIdx] = updatedDist;
  return next.sort((a, b) =>
    (a.storeName || '').localeCompare(b.storeName || '', undefined, { sensitivity: 'base' })
  );
};

const initialPersistedCache = loadPersistedCartCache();

// Module-level cache to persist data across page navigation (unmount/remount)
let cachedDistributors: Distributor[] = initialPersistedCache.distributors;
let cachedPendingOrders: SpecialOrder[] = [];
let cachedPendingRefills: Refill[] = [];
let cachedPriceHistory: Record<string, LocalPriceHistoryRow[]> = initialPersistedCache.priceHistory;
let cachedLastFetched: Date | null = initialPersistedCache.distributors.length > 0 ? new Date() : null;
let cachedSentDates: string[] = [];
let cachedSelectedSentDate: string = '';
const MAX_CACHED_SENT_DATES = 5;
const cachedSentOrdersDates: string[] = [];
const cachedSentOrdersMap: Record<string, LocalSentOrder[]> = {};

function touchCachedSentOrders(dateStr: string) {
  if (!dateStr || !cachedSentOrdersMap[dateStr]) return;
  const idx = cachedSentOrdersDates.indexOf(dateStr);
  if (idx !== -1) cachedSentOrdersDates.splice(idx, 1);
  cachedSentOrdersDates.push(dateStr);
}

function setCachedSentOrders(dateStr: string, orders: LocalSentOrder[]) {
  if (!dateStr) return;
  cachedSentOrdersMap[dateStr] = orders;
  const idx = cachedSentOrdersDates.indexOf(dateStr);
  if (idx !== -1) cachedSentOrdersDates.splice(idx, 1);
  cachedSentOrdersDates.push(dateStr);
  while (cachedSentOrdersDates.length > MAX_CACHED_SENT_DATES) {
    const oldestDate = cachedSentOrdersDates.shift();
    if (oldestDate && oldestDate !== cachedSelectedSentDate) {
      delete cachedSentOrdersMap[oldestDate];
    }
  }
}

function evictCachedSentOrders(dateStr: string) {
  if (!dateStr) return;
  delete cachedSentOrdersMap[dateStr];
  const idx = cachedSentOrdersDates.indexOf(dateStr);
  if (idx !== -1) cachedSentOrdersDates.splice(idx, 1);
}

// Module-level delete queue and pending keys to survive background navigation or page transitions
let globalDeleteQueue: Array<{
  item: CartLineItem;
  storeName: string;
  key: string;
  attempt: number;
}> = [];
let globalIsProcessingDeleteQueue = false;
const globalPendingDeleteKeys = new Set<string>();

const USER_CHECK_STORAGE_KEY = 'pharmacart_user_check_overrides_v1';
const getTodayDateKey = () => new Date().toISOString().slice(0, 10);

const loadUserCheckOverrides = (): Record<string, boolean> => {
  try {
    const saved = localStorage.getItem(USER_CHECK_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.data === 'object' && parsed.date === getTodayDateKey()) {
        return parsed.data;
      }
    }
  } catch (_) { }
  return {};
};

const saveUserCheckOverrides = (overrides: Record<string, boolean>) => {
  try {
    localStorage.setItem(USER_CHECK_STORAGE_KEY, JSON.stringify({
      date: getTodayDateKey(),
      timestamp: Date.now(),
      data: overrides
    }));
  } catch (_) { }
};

const getItemCheckKey = (storeId: number, item: { productCode?: string; productId?: number | string | null; productName?: string; product?: string; name?: string }): string => {
  const code = item.productCode || (item.productId !== null && item.productId !== undefined ? String(item.productId) : '');
  const name = (item.productName || item.product || item.name || '').toLowerCase().trim();
  return `${storeId}::${code}::${name}`;
};

let waWindowRef: Window | null = null;

function toWaDigits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

function openOrReuseWhatsappTab(url: string, phone?: string, text?: string) {
  // Convert web.whatsapp.com/send to api.whatsapp.com/send for 100% reliable loading
  let targetUrl = url;
  if (phone) {
    const cleanDigits = toWaDigits(phone);
    const encodedText = encodeURIComponent(text || '');
    targetUrl = `https://api.whatsapp.com/send?phone=${cleanDigits}&text=${encodedText}`;
  } else if (url.includes('web.whatsapp.com/send')) {
    targetUrl = url.replace('web.whatsapp.com/send', 'api.whatsapp.com/send');
  }

  // 1. Dispatch custom events and window.postMessage for Chrome / WhatsApp Web Extensions
  try {
    window.postMessage({
      type: 'WHATSAPP_WEB_EXTENSION_SEND',
      source: 'AI_PHARMACY',
      phone: phone || '',
      text: text || '',
      url: targetUrl
    }, '*');

    document.dispatchEvent(new CustomEvent('WHATSAPP_WEB_EXTENSION_SEND', {
      detail: { phone: phone || '', text: text || '', url: targetUrl }
    }));
  } catch (err) {
    console.warn('WhatsApp Extension dispatch warning:', err);
  }

  // 2. Reuse existing WhatsApp Web window or open a target tab reliably
  try {
    if (waWindowRef && !waWindowRef.closed) {
      waWindowRef.location.href = targetUrl;
      waWindowRef.focus();
      return;
    }
  } catch (err) {
    console.warn('Could not navigate existing WhatsApp Web window handle:', err);
  }

  waWindowRef = window.open(targetUrl, '_blank');
  if (waWindowRef) {
    try {
      waWindowRef.focus();
    } catch (_) { }
  } else {
    // Fallback if browser blocked popups: direct navigate current tab
    window.location.href = targetUrl;
  }
}

export default function PharmarackCart() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentTab = searchParams.get('tab') || 'cart';
  const [distributors, setDistributors] = useState<Distributor[]>(() => cachedDistributors);
  const [userCheckOverrides, setUserCheckOverrides] = useState<Record<string, boolean>>(() => loadUserCheckOverrides());
  const userCheckOverridesRef = useRef(userCheckOverrides);
  userCheckOverridesRef.current = userCheckOverrides;

  // ── Silent Sequential Delete Queue & Priority Pre-emption State ──
  const deleteQueueRef = useRef<Array<{
    item: CartLineItem;
    storeName: string;
    key: string;
    attempt: number;
  }>>(globalDeleteQueue);
  deleteQueueRef.current = globalDeleteQueue;
  const isProcessingDeleteQueueRef = useRef<boolean>(globalIsProcessingDeleteQueue);
  const pendingDeleteKeysRef = useRef<Set<string>>(globalPendingDeleteKeys);
  pendingDeleteKeysRef.current = globalPendingDeleteKeys;
  // In-flight optimistic quantity tracker: preserves user clicks during background sync settling
  const pendingQtyMapRef = useRef<Map<string, { qty: number; timestamp: number }>>(new Map());
  const highPriorityActiveRef = useRef<boolean>(false);
  const pauseDeleteResolveRef = useRef<(() => void) | null>(null);
  const cancelSleepRef = useRef<(() => void) | null>(null);

  const beginHighPriorityAction = () => {
    highPriorityActiveRef.current = true;
    if (cancelSleepRef.current) {
      cancelSleepRef.current();
    }
  };

  const endHighPriorityAction = () => {
    highPriorityActiveRef.current = false;
    if (pauseDeleteResolveRef.current) {
      const resolve = pauseDeleteResolveRef.current;
      pauseDeleteResolveRef.current = null;
      resolve();
    }
  };

  const waitIfHighPriority = async () => {
    while (highPriorityActiveRef.current) {
      await new Promise<void>(resolve => {
        pauseDeleteResolveRef.current = resolve;
      });
    }
  };

  const interruptibleSleep = (ms: number): Promise<boolean> => {
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onCancel = () => {
        if (timer) clearTimeout(timer);
        cancelSleepRef.current = null;
        resolve(false);
      };
      cancelSleepRef.current = onCancel;
      timer = setTimeout(() => {
        cancelSleepRef.current = null;
        resolve(true);
      }, ms);
    });
  };

  const [loading, setLoading] = useState(() => cachedDistributors.length === 0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(() => cachedLastFetched);
  const [sessionStatus, setSessionStatus] = useState<'active' | 'restoring' | 'expired' | 'connection_issue' | null>(null);
  const [sessionDaysLeft, setSessionDaysLeft] = useState<number | null>(null);
  const [isCartFromCache, setIsCartFromCache] = useState<boolean>(() => cachedDistributors.length > 0);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [priceHistoryCache, setPriceHistoryCache] = useState<Record<string, LocalPriceHistoryRow[]>>(() => cachedPriceHistory);
  const [sendingNotifId, setSendingNotifId] = useState<number | null>(null);
  const [pendingOrders, setPendingOrders] = useState<SpecialOrder[]>(() => cachedPendingOrders);
  const [allOnlineOrders, setAllOnlineOrders] = useState<SpecialOrder[]>([]);
  const [pendingRefills, setPendingRefills] = useState<Refill[]>(() => cachedPendingRefills);
  const [todaySoldMeds, setTodaySoldMeds] = useState<Set<string>>(() => new Set());

  const location = useLocation();
  useEffect(() => {
    setEditingDistributor(null);
    setSwitchModalTarget(null);
    setReorderSameModalTarget(null);
  }, [location.pathname]);

  const isSoldAtPOSToday = useCallback((medName?: string): boolean => {
    if (!medName) return false;
    const clean = medName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!clean) return false;
    const cleanMedKey = clean.replace(/(tablet|tablets|tab|capsule|capsules|cap|injection|inj|syrup|syr|drops|suspension|susp|cream|ointment|gel|lotion|\d+s|\d+tab|\d+cap)/g, '');
    for (const sold of todaySoldMeds) {
      if (sold === clean || (cleanMedKey && sold.includes(cleanMedKey)) || (cleanMedKey && cleanMedKey.includes(sold))) {
        return true;
      }
    }
    return false;
  }, [todaySoldMeds]);

  const fetchTodaySoldMedicines = useCallback(async () => {
    try {
      const res = await api.getTodaySoldMedicines();
      if (res && res.success && Array.isArray(res.medicines)) {
        const soldSet = new Set<string>();
        res.medicines.forEach((m: any) => {
          if (m.clean_name) soldSet.add(m.clean_name);
        });
        setTodaySoldMeds(soldSet);
      }
    } catch (err) {
      console.warn('Failed to fetch today sold medicines:', err);
    }
  }, []);

  const [autoReconciledItems, setAutoReconciledItems] = useState<any[]>([]);
  const [showAddedItems] = useState<boolean>(false);
  const [reorderBannerCollapsed, setReorderBannerCollapsed] = useState<boolean>(false);

  const [reorderSuggestions, setReorderSuggestions] = useState<ReorderSuggestion[]>([]);
  const [, setSuggestionsLoading] = useState<boolean>(false);
  const [reorderRecentItems, setReorderRecentItems] = useState<ReorderRecentItem[]>([]);
  const [reorderWindowMonths, setReorderWindowMonths] = useState<number>(2);
  const [reorderSearchQuery, setReorderSearchQuery] = useState<string>('');
  const [reorderQuantities, setReorderQuantities] = useState<Record<string, number>>({});

  const getReorderItemQty = (itemKey: string, defaultQty: number) => {
    return reorderQuantities[itemKey] ?? defaultQty ?? 1;
  };

  const setReorderItemQty = (itemKey: string, qty: number) => {
    setReorderQuantities(prev => ({
      ...prev,
      [itemKey]: Math.max(1, qty)
    }));
  };

  const [checkingStockMed, setCheckingStockMed] = useState<string | null>(null);
  const [checkedStockMap, setCheckedStockMap] = useState<Record<string, {
    highestStockDistributor: { storeId: number; storeName: string; productName: string; availability: number; ptr: number } | null;
    alternateDistributors: Array<{ storeId: number; storeName: string; productName: string; availability: number; ptr: number }>;
    checkedAt: number;
  }>>({});

  const handleCheckStock = async (medicineName: string) => {
    if (!medicineName || checkingStockMed === medicineName) return;
    setCheckingStockMed(medicineName);
    try {
      const res = await api.checkMedicineStock(medicineName);
      if (res && res.success) {
        setCheckedStockMap(prev => ({
          ...prev,
          [medicineName]: {
            highestStockDistributor: res.highestStockDistributor,
            alternateDistributors: res.alternateDistributors || [],
            checkedAt: Date.now()
          }
        }));
        if (res.highestStockDistributor) {
          toastEvent.trigger(`Found ${res.highestStockDistributor.availability} in stock at ${res.highestStockDistributor.storeName}!`, 'success');
        } else {
          toastEvent.trigger(`No alternate stock found for "${medicineName}"`, 'info');
        }
      }
    } catch (err: unknown) {
      console.warn('Failed to check stock for medicine:', err);
      toastEvent.trigger('Failed to check live stock', 'error');
    } finally {
      setCheckingStockMed(null);
    }
  };

  const fetchReorderSuggestions = async () => {
    setSuggestionsLoading(true);
    try {
      const res = await api.getSalesReorderSuggestions();
      if (res && res.success && Array.isArray(res.items)) {
        setReorderSuggestions(res.items);
      }
    } catch (err) {
      console.warn('Failed to load sales reorder suggestions:', err);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const fetchReorderRecentItems = async () => {
    try {
      const res = await api.getPharmarackReorderRecent();
      if (res && res.success && Array.isArray(res.items)) {
        setReorderRecentItems(res.items);
      }
    } catch (err) {
      console.warn('Failed to load recently reordered items:', err);
    }
  };

  const [sentDates, setSentDates] = useState<string[]>(() => cachedSentDates);
  const [selectedSentDate, setSelectedSentDate] = useState<string>(() => cachedSelectedSentDate || (cachedSentDates[0] || ''));
  const [sentOrders, setSentOrders] = useState<LocalSentOrder[]>(() => {
    const initDate = cachedSelectedSentDate || cachedSentDates[0];
    if (initDate && cachedSentOrdersMap[initDate]) {
      touchCachedSentOrders(initDate);
      return cachedSentOrdersMap[initDate];
    }
    return [];
  });
  const [sentOrdersLoading, setSentOrdersLoading] = useState<boolean>(false);
  const [readdingSentItems, setReaddingSentItems] = useState<boolean>(false);
  const [sendingDispatchOrderId, setSendingDispatchOrderId] = useState<number | null>(null);
  // Sent History: tick medicines (any orders), press the ONE Re-order button, finalize in a small popup (qty + distributor change).
  const [sentPopup, setSentPopup] = useState<{ rows: Array<{ key: string; item: LocalSentOrderItem; name: string; qty: number; storeId: number; storeName: string }> } | null>(null);
  const [sentSelection, setSentSelection] = useState<Record<string, boolean>>({});
  const [sentDateSearchQuery, setSentDateSearchQuery] = useState<string>('');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set<string>());
  const userExpandedMonthsRef = useRef<Set<string>>(new Set<string>());

  // Group sentDates into:
  // 1. Recent (Last 7 days): flat list, always expanded
  // 2. Older history: grouped by month YYYY-MM, collapsed by default
  const { recentDates, olderMonthGroups } = React.useMemo(() => {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    const filteredDates = sentDateSearchQuery.trim()
      ? sentDates.filter(d => {
          const q = sentDateSearchQuery.trim().toLowerCase();
          if (d.toLowerCase().includes(q)) return true;
          const dateObj = new Date(d);
          if (!isNaN(dateObj.getTime())) {
            const formatted = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' }).toLowerCase();
            if (formatted.includes(q)) return true;
          }
          return false;
        })
      : sentDates;

    const recent: string[] = [];
    const olderByMonth = new Map<string, { monthKey: string; monthLabel: string; dates: string[] }>();

    filteredDates.forEach(d => {
      const parts = d.split('-');
      let dateMidnight = 0;
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        dateMidnight = new Date(y, m, day).getTime();
      } else {
        dateMidnight = new Date(d).getTime();
      }

      const diff = todayMidnight - dateMidnight;
      // Within last 7 days (including today and future date skew)
      if (diff <= SEVEN_DAYS_MS && diff >= -86400000) {
        recent.push(d);
      } else {
        const monthKey = d.slice(0, 7); // YYYY-MM
        if (!olderByMonth.has(monthKey)) {
          let monthLabel = monthKey;
          if (parts.length >= 2) {
            const monthDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
            if (!isNaN(monthDate.getTime())) {
              monthLabel = monthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            }
          }
          olderByMonth.set(monthKey, {
            monthKey,
            monthLabel,
            dates: []
          });
        }
        olderByMonth.get(monthKey)!.dates.push(d);
      }
    });

    const monthGroups = Array.from(olderByMonth.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    return { recentDates: recent, olderMonthGroups: monthGroups };
  }, [sentDates, sentDateSearchQuery]);

  // Auto-expand all matching month groups when searching; restore user collapsed state when search cleared
  useEffect(() => {
    if (sentDateSearchQuery.trim()) {
      setExpandedMonths(new Set(olderMonthGroups.map(g => g.monthKey)));
    } else {
      setExpandedMonths(new Set(userExpandedMonthsRef.current));
    }
  }, [sentDateSearchQuery, olderMonthGroups]);

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
        userExpandedMonthsRef.current.delete(monthKey);
      } else {
        next.add(monthKey);
        userExpandedMonthsRef.current.add(monthKey);
      }
      return next;
    });
  };

  const renderSentDateButton = (d: string, isIndented = false) => {
    const isToday = d === getTodayString();
    const isSelected = d === selectedSentDate;
    const dateObj = new Date(d);
    const formattedDisplay = isNaN(dateObj.getTime())
      ? d
      : dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });

    return (
      <button
        key={d}
        type="button"
        onClick={() => handleSelectSentDate(d)}
        className={`w-full text-left p-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-2 border ${
          isSelected
            ? 'bg-primary/15 border-primary/40 text-text shadow-xs shadow-primary/5'
            : 'bg-bg2/50 border-glass-border/40 text-muted hover:text-text hover:bg-bg2/90'
        } ${isIndented ? 'text-xs' : ''}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Clock size={13} className={isSelected ? 'text-primary shrink-0' : 'text-muted/60 shrink-0'} />
          <div className="min-w-0">
            <div className={`text-xs font-bold truncate ${isSelected ? 'text-text font-black' : 'text-text/85'}`}>
              {formattedDisplay}
            </div>
            <div className="text-[9px] text-muted font-mono">{d}</div>
          </div>
        </div>
        {isToday && (
          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
            Today
          </span>
        )}
      </button>
    );
  };

  // ── Online Orders Split-Pane Date & Management State ──
  const [onlineDateSearchQuery, setOnlineDateSearchQuery] = useState<string>('');
  const [onlineOrderSearchQuery, setOnlineOrderSearchQuery] = useState<string>('');
  const [onlineStatusFilter, setOnlineStatusFilter] = useState<'All' | 'Pending' | 'Ready' | 'Fulfilled'>('All');
  const [onlineCategory, setOnlineCategory] = useState<'today' | 'all' | 'online' | 'refills' | 'special'>('today');
  const [selectedOnlineOrderDate, setSelectedOnlineOrderDate] = useState<string>(() => getTodayString());
  const [expandedOnlineMonths, setExpandedOnlineMonths] = useState<Set<string>>(() => new Set<string>());
  const userExpandedOnlineMonthsRef = useRef<Set<string>>(new Set<string>());

  const getOrderDateKey = (order: SpecialOrder): string => {
    const raw = order.date || (order as any).created_at || '';
    if (!raw) return getTodayString();
    const match = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return getTodayString();
  };

  const { onlineOrderDateMap, onlineOrderDates } = React.useMemo(() => {
    const map: Record<string, SpecialOrder[]> = {};
    allOnlineOrders.forEach(order => {
      const dKey = getOrderDateKey(order);
      if (!map[dKey]) map[dKey] = [];
      map[dKey].push(order);
    });

    // Ensure today's date exists even if 0 orders
    const today = getTodayString();
    if (!map[today]) {
      map[today] = [];
    }

    const sortedDates = Object.keys(map).sort((a, b) => b.localeCompare(a));
    return { onlineOrderDateMap: map, onlineOrderDates: sortedDates };
  }, [allOnlineOrders]);

  // Keep selectedOnlineOrderDate valid
  useEffect(() => {
    if (onlineOrderDates.length > 0 && !onlineOrderDates.includes(selectedOnlineOrderDate)) {
      setSelectedOnlineOrderDate(onlineOrderDates.includes(getTodayString()) ? getTodayString() : onlineOrderDates[0]);
    }
  }, [onlineOrderDates, selectedOnlineOrderDate]);

  // Group onlineOrderDates into Recent (Last 7 Days) and Older Monthly groups
  const { recentOnlineDates, olderOnlineMonthGroups } = React.useMemo(() => {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    const filteredDates = onlineDateSearchQuery.trim()
      ? onlineOrderDates.filter(d => {
          const q = onlineDateSearchQuery.trim().toLowerCase();
          if (d.toLowerCase().includes(q)) return true;
          const dateObj = new Date(d);
          if (!isNaN(dateObj.getTime())) {
            const formatted = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' }).toLowerCase();
            if (formatted.includes(q)) return true;
          }
          return false;
        })
      : onlineOrderDates;

    const recent: string[] = [];
    const olderByMonth = new Map<string, { monthKey: string; monthLabel: string; dates: string[] }>();

    filteredDates.forEach(d => {
      const parts = d.split('-');
      let dateMidnight = 0;
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        dateMidnight = new Date(y, m, day).getTime();
      } else {
        dateMidnight = new Date(d).getTime();
      }

      const diff = todayMidnight - dateMidnight;
      if (diff <= SEVEN_DAYS_MS && diff >= -86400000) {
        recent.push(d);
      } else {
        const monthKey = d.slice(0, 7); // YYYY-MM
        if (!olderByMonth.has(monthKey)) {
          let monthLabel = monthKey;
          if (parts.length >= 2) {
            const monthDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
            if (!isNaN(monthDate.getTime())) {
              monthLabel = monthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            }
          }
          olderByMonth.set(monthKey, {
            monthKey,
            monthLabel,
            dates: []
          });
        }
        olderByMonth.get(monthKey)!.dates.push(d);
      }
    });

    const monthGroups = Array.from(olderByMonth.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
    return { recentOnlineDates: recent, olderOnlineMonthGroups: monthGroups };
  }, [onlineOrderDates, onlineDateSearchQuery]);

  useEffect(() => {
    if (onlineDateSearchQuery.trim()) {
      setExpandedOnlineMonths(new Set(olderOnlineMonthGroups.map(g => g.monthKey)));
    } else {
      setExpandedOnlineMonths(new Set(userExpandedOnlineMonthsRef.current));
    }
  }, [onlineDateSearchQuery, olderOnlineMonthGroups]);

  const toggleOnlineMonth = (monthKey: string) => {
    setExpandedOnlineMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
        userExpandedOnlineMonthsRef.current.delete(monthKey);
      } else {
        next.add(monthKey);
        userExpandedOnlineMonthsRef.current.add(monthKey);
      }
      return next;
    });
  };

  const handleSelectOnlineDate = (d: string) => {
    setSelectedOnlineOrderDate(d);
    if (d === getTodayString()) {
      setOnlineCategory('today');
    } else if (onlineCategory === 'today') {
      setOnlineCategory('all');
    }
  };

  const renderOnlineDateButton = (d: string, isIndented = false) => {
    const isToday = d === getTodayString();
    const isSelected = d === selectedOnlineOrderDate;
    const dateObj = new Date(d);
    const formattedDisplay = isNaN(dateObj.getTime())
      ? d
      : dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });
    const count = (onlineOrderDateMap[d] || []).length;

    return (
      <button
        key={d}
        type="button"
        onClick={() => handleSelectOnlineDate(d)}
        className={`w-full text-left p-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-2 border ${
          isSelected
            ? 'bg-primary/15 border-primary/40 text-text shadow-xs shadow-primary/5'
            : 'bg-bg2/50 border-glass-border/40 text-muted hover:text-text hover:bg-bg2/90'
        } ${isIndented ? 'text-xs' : ''}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Globe size={13} className={isSelected ? 'text-primary shrink-0' : 'text-muted/60 shrink-0'} />
          <div className="min-w-0">
            <div className={`text-xs font-bold truncate ${isSelected ? 'text-text font-black' : 'text-text/85'}`}>
              {formattedDisplay}
            </div>
            <div className="text-[9px] text-muted font-mono">{d}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {count > 0 && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-primary text-white' : 'bg-bg3 text-muted border border-glass-border'}`}>
              {count}
            </span>
          )}
          {isToday && (
            <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Today
            </span>
          )}
        </div>
      </button>
    );
  };

  const currentOnlineOrders = React.useMemo(() => {
    let orders = onlineOrderDateMap[selectedOnlineOrderDate] || [];
    if (onlineStatusFilter !== 'All') {
      orders = orders.filter(o => {
        if (onlineStatusFilter === 'Pending') {
          return ['Pending', 'Confirmed', 'Waiting'].includes(o.status);
        }
        return (o.status || '').toLowerCase() === onlineStatusFilter.toLowerCase();
      });
    }
    if (onlineOrderSearchQuery.trim()) {
      const q = onlineOrderSearchQuery.trim().toLowerCase();
      orders = orders.filter(o => 
        (o.product && o.product.toLowerCase().includes(q)) ||
        (o.requester && o.requester.toLowerCase().includes(q)) ||
        (o.phone && o.phone.toLowerCase().includes(q)) ||
        String(o.id).includes(q)
      );
    }
    return orders;
  }, [onlineOrderDateMap, selectedOnlineOrderDate, onlineStatusFilter, onlineOrderSearchQuery]);

  // Filter patient refills matching selected date (or all pending refills if viewing today)
  const filteredRefills = React.useMemo(() => {
    const isSelectedDateToday = selectedOnlineOrderDate === getTodayString();
    let list = pendingRefills.filter(r => {
      if (isSelectedDateToday) return true;
      const rDate = r.next_refill_date ? r.next_refill_date.slice(0, 10) : '';
      return rDate === selectedOnlineOrderDate;
    });

    if (onlineOrderSearchQuery.trim()) {
      const q = onlineOrderSearchQuery.trim().toLowerCase();
      list = list.filter(r => 
        (r.medicine_name && r.medicine_name.toLowerCase().includes(q)) ||
        (r.patient_name && r.patient_name.toLowerCase().includes(q)) ||
        (r.patient_phone && r.patient_phone.toLowerCase().includes(q)) ||
        String(r.id).includes(q)
      );
    }
    return list;
  }, [pendingRefills, selectedOnlineOrderDate, onlineOrderSearchQuery]);

  // Split currentOnlineOrders into 3 channels
  const { onlineWebsiteOrders, webRefillOrders, specialShortageOrders } = React.useMemo(() => {
    const website: SpecialOrder[] = [];
    const webRefill: SpecialOrder[] = [];
    const shortage: SpecialOrder[] = [];

    currentOnlineOrders.forEach(order => {
      if (order.customer_order_source === 'website_refill') {
        webRefill.push(order);
      } else if (order.customer_order_source === 'website' || order.customer_order_source === 'whatsapp') {
        website.push(order);
      } else {
        shortage.push(order);
      }
    });

    return { onlineWebsiteOrders: website, webRefillOrders: webRefill, specialShortageOrders: shortage };
  }, [currentOnlineOrders]);

  // Aggregate category counts
  const todayTotalOrdersCount = React.useMemo(() => {
    const todayOrders = onlineOrderDateMap[getTodayString()] || [];
    return todayOrders.length + pendingRefills.length;
  }, [onlineOrderDateMap, pendingRefills]);

  const onlineCategoryCount = onlineWebsiteOrders.length;
  const refillsCategoryCount = webRefillOrders.length + filteredRefills.length;
  const specialCategoryCount = specialShortageOrders.length;
  const totalSelectedCount = onlineCategoryCount + refillsCategoryCount + specialCategoryCount;

  const handleUpdateOrderStatus = async (orderId: number, newStatus: string) => {
    try {
      const res = await api.updateOrder(orderId, { status: newStatus as any });
      if (res && res.success) {
        toastEvent.trigger(`Order #${orderId} marked as ${newStatus}`, 'success');
        setAllOnlineOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
        setPendingOrders(prev => {
          if (['Fulfilled', 'Completed', 'Cancelled', 'Ready'].includes(newStatus)) {
            return prev.filter(o => o.id !== orderId);
          }
          return prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o);
        });
        fetchPendingOrders();
      } else {
        toastEvent.trigger(res?.message || 'Failed to update order status', 'error');
      }
    } catch (err) {
      console.error('Failed to update order status:', err);
      toastEvent.trigger('Failed to update order status', 'error');
    }
  };

  const handleWhatsAppCustomer = (order: SpecialOrder) => {
    if (!order.phone) {
      toastEvent.trigger('No customer phone number available', 'info');
      return;
    }
    const statusMsg = order.status === 'Ready' 
      ? 'is packed and ready for pickup' 
      : order.status === 'Fulfilled' 
        ? 'has been fulfilled' 
        : 'is confirmed and being prepared';
    const text = `Hello ${order.requester || 'Customer'}, your order for ${order.product} (Qty: ${order.qty || 1}) ${statusMsg} at our pharmacy. Thank you!`;
    openOrReuseWhatsappTab('', order.phone, text);
  };

  // Switch Supplier Modal State
  const [switchModalTarget, setSwitchModalTarget] = useState<{ item: CartLineItem; dist: Distributor } | null>(null);
  const [switchCatalogResults, setSwitchCatalogResults] = useState<LocalSwitchCatalogItem[]>([]);
  const [switchSearching, setSwitchSearching] = useState<boolean>(false);
  const [switchingDistributor, setSwitchingDistributor] = useState<boolean>(false);
  const [switchSearchQuery, setSwitchSearchQuery] = useState<string>('');

  // Batch Last Purchase Intelligence Map
  const [lastPurchaseMap, setLastPurchaseMap] = useState<Record<string, BatchLastPurchaseResult>>({});
  const [, setLastPurchaseLoading] = useState<boolean>(false);

  // Reorder Same Medicine Confirmation Modal State
  const [reorderSameModalTarget, setReorderSameModalTarget] = useState<LocalReorderSameCard | null>(null);
  const [reorderModalQty, setReorderModalQty] = useState<number>(1);
  const [reorderModalSupplierId, setReorderModalSupplierId] = useState<number | null>(null);

  // Purchase History Modal State
  const [purchaseHistoryModalTarget, setPurchaseHistoryModalTarget] = useState<{ medicineName: string; loading: boolean; history: LocalPriceHistoryRow[] } | null>(null);

  // Purchase Bills History for Reorder Hub & Shortfalls
  const [purchaseHistoryItems, setPurchaseHistoryItems] = useState<ReorderRecentItem[]>([]);
  const [purchaseHistoryLoading, setPurchaseHistoryLoading] = useState<boolean>(false);

  const fetchPurchaseHistoryItems = async () => {
    try {
      setPurchaseHistoryLoading(true);
      const res = await api.getPurchaseReorderHistory({ months: 6, limit: 500 });
      if (res && res.success && Array.isArray(res.items)) {
        setPurchaseHistoryItems(res.items);
      }
    } catch (err) {
      console.warn('Failed to load purchase reorder history:', err);
    } finally {
      setPurchaseHistoryLoading(false);
    }
  };

  // Verified deduplicated medicines per distributor (up to 300 items)
  const [distributorProductsMap, setDistributorProductsMap] = useState<Record<number, ReorderRecentItem[]>>({});
  const [syncingExternalOrders, setSyncingExternalOrders] = useState<boolean>(false);
  const fetchedDistributorStoreIdsRef = useRef<Set<number>>(new Set());

  const fetchDistributorProducts = useCallback(async (storeId: number) => {
    if (!storeId || fetchedDistributorStoreIdsRef.current.has(storeId)) return;
    fetchedDistributorStoreIdsRef.current.add(storeId);
    try {
      const res = await api.getDistributorMedicines(storeId, 300);
      if (res && res.success && Array.isArray(res.items)) {
        const mapped: ReorderRecentItem[] = res.items.map(it => ({
          medicineName: it.productName,
          storeId: it.storeId,
          storeName: '',
          productCode: it.productCode,
          productId: it.productId ? Number(it.productId) : undefined,
          ptr: it.ptr,
          mrp: it.mrp,
          packaging: it.packaging,
          lastOrderedDate: it.lastOrderDate || '',
          lastQty: 1,
          lastDistributorName: '',
          manufacturer: it.company || '',
          mapped: true
        }));
        setDistributorProductsMap(prev => ({ ...prev, [storeId]: mapped }));
      }
    } catch (err) {
      fetchedDistributorStoreIdsRef.current.delete(storeId);
      console.warn(`Failed to load distributor medicines for store ${storeId}:`, err);
    }
  }, []);

  useEffect(() => {
    distributors.forEach(d => {
      if (d.storeId && !fetchedDistributorStoreIdsRef.current.has(d.storeId)) {
        fetchDistributorProducts(d.storeId);
      }
    });
  }, [distributors, fetchDistributorProducts]);

  const handleSyncExternalOrders = async () => {
    if (syncingExternalOrders) return;
    setSyncingExternalOrders(true);
    try {
      toastEvent.trigger("Syncing today's orders from Pharmarack portal...", 'info');
      const res = await api.syncPharmarackOrders();
      if (res && res.ok) {
        toastEvent.trigger(`Sync complete: ${res.fetched} fetched, ${res.newOrders} new recorded.`, 'success');
        const todayStr = getTodayDateKey();
        evictCachedSentOrders(todayStr);
        if (selectedSentDate) {
          evictCachedSentOrders(selectedSentDate);
        }
        cachedSentDates = [];
        await loadSentDates();
        fetchCart(false);
        fetchPendingOrders();
        fetchLatestSentMap();
      } else if (res?.skipped === 'session_expired' || res?.skipped === 'no_session') {
        toastEvent.trigger('Pharmarack session expired or not logged in. Please re-authenticate.', 'error');
      } else if (res?.skipped === 'throttled') {
        toastEvent.trigger('Sync throttled. Please wait a moment before trying again.', 'info');
      } else {
        toastEvent.trigger(res?.error || 'Failed to sync orders from Pharmarack', 'error');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Sync failed', 'error');
    } finally {
      setSyncingExternalOrders(false);
    }
  };

  // Skipped shortfall fillers per distributor storeId to allow cycling / suggesting alternative medicines
  const [skippedFillerKeys, setSkippedFillerKeys] = useState<Record<number, Set<string>>>({});

  // Target for MedicineLinkModal when linking a medicine from live cart or shortfall suggestions
  const [linkModalTarget, setLinkModalTarget] = useState<{ medicineId: number; medicineName: string; storeId?: number; storeName?: string } | null>(null);

  const handleSkipFiller = (storeId: number, medName: string) => {
    const key = (medName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    setSkippedFillerKeys(prev => {
      const current = new Set(prev[storeId] || []);
      current.add(key);
      return { ...prev, [storeId]: current };
    });
  };

  const handleResetSkippedFillers = (storeId: number) => {
    setSkippedFillerKeys(prev => {
      const next = { ...prev };
      delete next[storeId];
      return next;
    });
  };

  // Helper to highlight matched query text in medicine names
  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query || !query.trim() || !text) return text;
    const q = query.trim();
    const lowerText = text.toLowerCase();
    const lowerQuery = q.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);
    if (idx !== -1) {
      return (
        <span>
          {text.slice(0, idx)}
          <mark className="bg-amber-400/35 text-amber-300 font-black rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
          {text.slice(idx + q.length)}
        </span>
      );
    }
    // Word-prefix search ("muchatac ocea"): mark the start of each typed word.
    const tokens = lowerQuery.split(/[^a-z0-9]+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (tokens.length === 0) return text;
    const re = new RegExp(`\\b(${tokens.join('|')})`, 'gi');
    const out: React.ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      out.push(text.slice(last, i));
      out.push(<mark key={i} className="bg-amber-400/35 text-amber-300 font-black rounded px-0.5">{m[0]}</mark>);
      last = i + m[0].length;
    }
    if (out.length === 0) return text;
    out.push(text.slice(last));
    return <span>{out}</span>;
  };

  // Shortages Hub Subtab State (includes 'all_matches' for unified search across all 5 categories)
  const [shortagesSubTab, setShortagesSubTab] = useState<'all_matches' | 'requests' | 'refills' | 'sales_suggestions' | 'ordered_recently' | 'past_purchases'>('requests');

  // Latest sent order history map by store ID / store name
  const [latestSentMap, setLatestSentMap] = useState<Record<string, LocalSentMapEntry>>({});

  const fetchLatestSentMap = async () => {
    try {
      const res = await api.getPharmarackLatestSentMap();
      if (res && res.success && res.sentMap) {
        setLatestSentMap(res.sentMap as unknown as Record<string, LocalSentMapEntry>);
      }
    } catch (err) {
      console.warn('Failed to load latest sent map:', err);
    }
  };

  interface PastOrderedInfo {
    isPastOrdered: boolean;
    placedAt: number;
    placedDateStr: string;
    isToday: boolean;
    isYesterday: boolean;
  }

  const getPastOrderedInfo = (item: CartLineItem, dist: Distributor): PastOrderedInfo => {
    const storeKey = dist.storeId ? String(dist.storeId) : (dist.storeName || '').toLowerCase().trim();
    const normDistName = (dist.storeName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    let sentInfo = latestSentMap[storeKey] || latestSentMap[(dist.storeName || '').toLowerCase().trim()] || latestSentMap[normDistName];
    if (!sentInfo && normDistName) {
      const matchKey = Object.keys(latestSentMap).find(k => {
        const normK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normK && (normK === normDistName || (normK.length >= 4 && normDistName.length >= 4 && (normK.includes(normDistName) || normDistName.includes(normK))));
      });
      if (matchKey) sentInfo = latestSentMap[matchKey];
    }

    if (!sentInfo) {
      return { isPastOrdered: false, placedAt: 0, placedDateStr: '', isToday: false, isYesterday: false };
    }

    let matchedSentItem: LocalSentOrderItem | null | undefined = null;
    if (Array.isArray(sentInfo.items) && sentInfo.items.length > 0) {
      const normItemName = item.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
      matchedSentItem = sentInfo.items.find((sentItem) => {
        if (item.productCode && sentItem.productCode && item.productCode === sentItem.productCode) {
          return true;
        }
        if (item.productId && sentItem.productId && Number(item.productId) === Number(sentItem.productId)) {
          return true;
        }
        const normSentName = (sentItem.productName || sentItem.product || sentItem.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return normItemName && normSentName && normItemName === normSentName;
      });
    }

    if (!matchedSentItem) {
      return { isPastOrdered: false, placedAt: 0, placedDateStr: '', isToday: false, isYesterday: false };
    }

    const placedTimestamp = Number(matchedSentItem.placedAt || sentInfo.placedAt || 0);
    if (!placedTimestamp || isNaN(placedTimestamp)) {
      return { isPastOrdered: false, placedAt: 0, placedDateStr: '', isToday: false, isYesterday: false };
    }

    const placedDate = new Date(placedTimestamp);
    const now = new Date();

    // Check past orders within the last 1 day only (24 hours)
    const ONE_DAY_MS = 1 * 24 * 60 * 60 * 1000;
    if (now.getTime() - placedTimestamp > ONE_DAY_MS) {
      return { isPastOrdered: false, placedAt: 0, placedDateStr: '', isToday: false, isYesterday: false };
    }

    const isToday = placedDate.getFullYear() === now.getFullYear() &&
      placedDate.getMonth() === now.getMonth() &&
      placedDate.getDate() === now.getDate();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = placedDate.getFullYear() === yesterday.getFullYear() &&
      placedDate.getMonth() === yesterday.getMonth() &&
      placedDate.getDate() === yesterday.getDate();

    const placedDateStr = placedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

    return {
      isPastOrdered: true,
      placedAt: placedTimestamp,
      placedDateStr,
      isToday,
      isYesterday
    };
  };

  const isItemAlreadySent = (item: CartLineItem, dist: Distributor): boolean => {
    const pastInfo = getPastOrderedInfo(item, dist);
    // Only treat as already sent if THIS specific item was placed TODAY
    if (pastInfo.isPastOrdered && pastInfo.isToday) {
      return true;
    }

    return false;
  };

  const isItemIncludedInDispatch = (item: CartLineItem, dist: Distributor): boolean => {
    // User's manual tick/untick always wins, regardless of sent status.
    const key = getItemCheckKey(dist.storeId, item);
    if (typeof userCheckOverridesRef.current[key] === 'boolean') {
      return userCheckOverridesRef.current[key];
    }

    const pastInfo = getPastOrderedInfo(item, dist);
    if (pastInfo.isPastOrdered) {
      // If already sent TODAY, exclude by default so duplicate orders are avoided
      if (pastInfo.isToday) {
        return false;
      }
      // Previous order (ordered 1 day ago / yesterday): DO NOT unselect.
      // Keep selected by default so user can review the highlighted alert and untick if desired.
      return true;
    }
    return true; // Fresh medicine, never sent — included by default
  };

  const handleToggleItemCheck = (storeId: number, itemOrKey: CartLineItem | string, isChecked: boolean) => {
    let key = '';
    if (typeof itemOrKey === 'object' && itemOrKey !== null) {
      key = getItemCheckKey(storeId, itemOrKey);
    } else {
      const productKey = String(itemOrKey);
      const targetDist = distributors.find(d => d.storeId === storeId);
      const targetItem = targetDist?.items.find(i => (i.productCode && i.productCode === productKey) || i.productName === productKey);
      key = targetItem ? getItemCheckKey(storeId, targetItem) : `${storeId}::${productKey}::${productKey.toLowerCase().trim()}`;
    }

    setUserCheckOverrides(prev => {
      const next = { ...prev, [key]: isChecked };
      userCheckOverridesRef.current = next;
      saveUserCheckOverrides(next);
      return next;
    });

    setDistributors(prev => {
      const next = prev.map(dist => {
        if (dist.storeId !== storeId) return dist;
        return {
          ...dist,
          items: dist.items.map(item => {
            const itKey = getItemCheckKey(dist.storeId, item);
            const legacyKey = item.productCode || item.productName;
            if (itKey === key || legacyKey === itemOrKey || item.productCode === itemOrKey || item.productName === itemOrKey) {
              return { ...item, isChecked };
            }
            return item;
          })
        };
      });
      cachedDistributors = next;
      return next;
    });
  };

  const handleToggleSelectAllInDist = (storeId: number, isChecked: boolean) => {
    const updatedOverrides: Record<string, boolean> = {};

    setDistributors(prev => {
      const next = prev.map(dist => {
        if (dist.storeId !== storeId) return dist;
        return {
          ...dist,
          items: dist.items.map(item => {
            const key = getItemCheckKey(dist.storeId, item);
            updatedOverrides[key] = isChecked;
            return { ...item, isChecked };
          })
        };
      });
      cachedDistributors = next;
      return next;
    });

    setUserCheckOverrides(prev => {
      const next = { ...prev, ...updatedOverrides };
      userCheckOverridesRef.current = next;
      saveUserCheckOverrides(next);
      return next;
    });
  };

  // Toggle ALL previous-ordered items across ALL distributors at once (for the reorder banner).
  const handleToggleAllPreviousItems = (isChecked: boolean) => {
    const updatedOverrides: Record<string, boolean> = {};

    setDistributors(prev => {
      const next = prev.map(dist => ({
        ...dist,
        items: dist.items.map(item => {
          const pastInfo = getPastOrderedInfo(item, dist);
          if (pastInfo.isPastOrdered && !pastInfo.isToday) {
            const key = getItemCheckKey(dist.storeId, item);
            updatedOverrides[key] = isChecked;
            return { ...item, isChecked };
          }
          return item;
        })
      }));
      cachedDistributors = next;
      return next;
    });

    setUserCheckOverrides(prev => {
      const next = { ...prev, ...updatedOverrides };
      userCheckOverridesRef.current = next;
      saveUserCheckOverrides(next);
      return next;
    });
  };

  const loadSentDates = async () => {
    try {
      const res = await api.getPharmarackSentDates();
      if (res && res.success && Array.isArray(res.dates)) {
        setSentDates(res.dates);
        cachedSentDates = res.dates;
        if (res.dates.length > 0) {
          const targetDate = (!selectedSentDate || !res.dates.includes(selectedSentDate)) ? res.dates[0] : selectedSentDate;
          setSelectedSentDate(targetDate);
          cachedSelectedSentDate = targetDate;
          if (cachedSentOrdersMap[targetDate]) {
            touchCachedSentOrders(targetDate);
            setSentOrders(cachedSentOrdersMap[targetDate]);
          }
          loadSentOrdersForDate(targetDate);
        }
      }
    } catch (err) {
      console.error('Failed to load sent dates:', err);
    }
  };

  const loadSentOrdersForDate = async (dateStr: string) => {
    if (!dateStr) return;
    if (!cachedSentOrdersMap[dateStr] || cachedSentOrdersMap[dateStr].length === 0) {
      setSentOrdersLoading(true);
    }
    try {
      const res = await api.getPharmarackSentOrders(dateStr);
      if (res && res.success && Array.isArray(res.orders)) {
        const orders = res.orders as unknown as LocalSentOrder[];
        setSentOrders(orders);
        setCachedSentOrders(dateStr, orders);
      }
    } catch (err) {
      console.error('Failed to load sent orders for date:', err);
    } finally {
      setSentOrdersLoading(false);
    }
  };

  const handleSelectSentDate = (dateStr: string) => {
    setSelectedSentDate(dateStr);
    cachedSelectedSentDate = dateStr;
    if (cachedSentOrdersMap[dateStr]) {
      touchCachedSentOrders(dateStr);
      setSentOrders(cachedSentOrdersMap[dateStr]);
    }
    loadSentOrdersForDate(dateStr);
  };

  useEffect(() => {
    if (currentTab === 'sent-history') {
      const todayStr = getTodayDateKey();
      evictCachedSentOrders(todayStr);
      cachedSentDates = [];
      loadSentDates();
    }
  }, [currentTab]);

  const [isSendingBatchWhatsApp, setIsSendingBatchWhatsApp] = useState(false);
  const isSendingBatchRef = useRef(false);
  const waitingForManualOrderSyncRef = useRef(false);
  const pendingMissingContactDistributorsRef = useRef<Distributor[]>([]);
  const [sendingWaDistributorId, setSendingWaDistributorId] = useState<number | null>(null);

  // Persistent WhatsApp sent status map by storeId (preserves history across reloads & sessions, scoped to TODAY)
  const getTodayDateKey = () => new Date().toISOString().slice(0, 10);

  const [sentWaStatusMap, setSentWaStatusMap] = useState<Record<number, 'success' | 'queued' | 'sending' | 'error'>>(() => {
    try {
      const saved = localStorage.getItem('pharmacart_sent_wa_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.data === 'object' && parsed.date === getTodayDateKey()) {
          return parsed.data;
        }
      }
    } catch (_) { }
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem('pharmacart_sent_wa_history', JSON.stringify({
        date: getTodayDateKey(),
        timestamp: Date.now(),
        data: sentWaStatusMap
      }));
    } catch (_) { }
  }, [sentWaStatusMap]);

  const pageActive = usePageActive();

  // Poll WhatsApp queue status to dynamically sync distributor order badges (queued -> sending -> success / error)
  useEffect(() => {
    if (!pageActive) return;
    let isMounted = true;
    const syncQueueStatus = async () => {
      try {
        const qStatus = await api.getWhatsAppQueueStatus();
        if (!qStatus || !qStatus.recentItems || !isMounted) return;

        const recentItems = qStatus.recentItems;
        const updatedStatus: Record<number, 'queued' | 'sending' | 'success' | 'error'> = {};
        const updatedTimes: Record<number, string> = {};

        distributors.forEach(dist => {
          const phoneNum = getDistributorPhoneNumber(dist);
          const cleanPhone = toWaDigits(phoneNum);

          const distName = (dist.storeName || '').toLowerCase().trim();
          const matchingItem = recentItems.find((item) => {
            const itemPhone = (item.number || '').replace(/\D/g, '');
            const matchPhone = itemPhone.length >= 7 && cleanPhone.length >= 7
              && (itemPhone.endsWith(cleanPhone.slice(-10)) || cleanPhone.endsWith(itemPhone.slice(-10)));
            const itemName = (item.target_name || '').toLowerCase().trim();
            const matchName = distName.length > 0 && itemName.length > 0
              && (itemName === distName || itemName.includes(distName) || distName.includes(itemName));
            if (matchPhone && matchName) return true;
            if (matchPhone && !itemName) return true;
            if (matchName && !itemPhone) return true;
            return matchPhone || matchName;
          });

          if (matchingItem) {
            if (matchingItem.status === 'sending') {
              updatedStatus[dist.storeId] = 'sending';
            } else if (matchingItem.status === 'sent') {
              updatedStatus[dist.storeId] = 'success';
              if (matchingItem.sent_at) {
                const timeStr = new Date(matchingItem.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                updatedTimes[dist.storeId] = timeStr;
              }
            } else if (matchingItem.status === 'failed_perm' || (matchingItem.status === 'failed_offline' && matchingItem.retry_count >= 3)) {
              updatedStatus[dist.storeId] = 'error';
            } else if (matchingItem.status === 'pending' || matchingItem.status === 'failed_offline') {
              updatedStatus[dist.storeId] = 'queued';
            }
          }
        });

        if (Object.keys(updatedStatus).length > 0 && isMounted) {
          setSentWaStatusMap(prev => ({ ...prev, ...updatedStatus }));
        }
        if (Object.keys(updatedTimes).length > 0 && isMounted) {
          setLastSentWaTimeMap(prev => {
            const next = { ...prev, ...updatedTimes };
            try { localStorage.setItem('pharmarack_last_sent_wa_time_map', JSON.stringify(next)); } catch (_) { }
            return next;
          });
        }
      } catch (_) { }
    };

    syncQueueStatus();
    // P1 "events, not timers": sync on SSE queue pushes + focus — no fixed interval.
    const handleSseQueue = () => syncQueueStatus();
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        syncQueueStatus();
        if (waitingForManualOrderSyncRef.current) {
          waitingForManualOrderSyncRef.current = false;
          handleSyncExternalOrders();
        }
      }
    };
    window.addEventListener('sse-wa-queue-updated', handleSseQueue);
    window.addEventListener('focus', handleFocus);
    return () => {
      isMounted = false;
      window.removeEventListener('sse-wa-queue-updated', handleSseQueue);
      window.removeEventListener('focus', handleFocus);
    };
  }, [distributors, pageActive]);

  useEffect(() => {
    // Proactively pre-warm WhatsApp and Pharmarack session for instant PO dispatch
    api.prewarmWhatsApp().catch(() => { });
    api.warmupPharmarackSession().catch(() => { });
  }, []);

  // Saved distributor contacts, delivery boys, and store settings
  const [storeInfo, setStoreInfo] = useState<{ name: string; phone: string; address: string; email: string; adminPhone: string; deliveryBoyName1: string; deliveryBoyPhone: string; deliveryBoyName2: string; deliveryBoyPhone2: string; invoiceFileFormat: string }>({
    name: 'AI Pharmacy',
    phone: '',
    address: '',
    email: '',
    adminPhone: '',
    deliveryBoyName1: '',
    deliveryBoyPhone: '',
    deliveryBoyName2: '',
    deliveryBoyPhone2: '',
    invoiceFileFormat: 'CSV File Format'
  });

  // Track last sent WhatsApp message timestamps
  const [lastBatchSentTime, setLastBatchSentTime] = useState<string>(() => {
    try {
      return localStorage.getItem('pharmarack_last_batch_sent_time') || '';
    } catch (_) { return ''; }
  });

  const [lastSentWaTimeMap, setLastSentWaTimeMap] = useState<Record<number, string>>(() => {
    try {
      const saved = localStorage.getItem('pharmarack_last_sent_wa_time_map');
      return saved ? JSON.parse(saved) : {};
    } catch (_) { return {}; }
  });

  const [deliveryBoysList, setDeliveryBoysList] = useState<{ id?: number; name: string; whatsapp_number: string; is_active?: number }[]>([]);
  const [savedDistributorsList, setSavedDistributorsList] = useState<LocalDistributorRecord[]>([]);
  const [distributorMappings, setDistributorMappings] = useState<Record<string, { distributorId: number | null; phone: string; deliveryBoyId?: number | null }>>({});
  const [modalDeliveryBoyId, setModalDeliveryBoyId] = useState<number | null>(null);
  const [overwriteDistributorName, setOverwriteDistributorName] = useState(true);

  const fetchSavedDistributors = async () => {
    try {
      const res = await apiClient.get('/distributors');
      if (res.data && Array.isArray(res.data)) {
        setSavedDistributorsList(res.data);
      }
    } catch (err) {
      console.warn('Failed to load saved distributors list:', err);
    }
  };

  const fetchDistributorMappings = async () => {
    try {
      const res = await apiClient.get('/pharmarack/distributor-mappings');
      if (res.data && Array.isArray(res.data.mappings)) {
        const mapObj: Record<string, { distributorId: number | null; phone: string; deliveryBoyId?: number | null }> = {};
        res.data.mappings.forEach((m: { store_name?: string; distributor_id?: number | null; distributor_phone?: string; phone?: string; delivery_boy_id?: number | null }) => {
          if (m.store_name) {
            mapObj[m.store_name.toLowerCase().trim()] = {
              distributorId: m.distributor_id || null,
              phone: m.distributor_phone || m.phone || '',
              deliveryBoyId: m.delivery_boy_id ? Number(m.delivery_boy_id) : null
            };
          }
        });
        setDistributorMappings(mapObj);
      }
    } catch (err) {
      console.warn('Failed to load distributor mappings:', err);
    }
  };

  const fetchDeliveryBoys = async () => {
    try {
      const res = await apiClient.get('/dispatch/delivery-boys');
      if (Array.isArray(res.data)) {
        const active = res.data.filter((b: LocalDeliveryBoyRow) => b.is_active !== 0);
        setDeliveryBoysList(active);
        return active as { id?: number; name: string; whatsapp_number: string; is_active?: number }[];
      }
    } catch (err) {
      console.warn('Failed to load delivery boys list for WhatsApp template:', err);
    }
    return [];
  };

  const fetchStoreInfo = async (boys?: { id?: number; name: string; whatsapp_number: string; is_active?: number }[]) => {
    const activeBoys = boys ?? deliveryBoysList;
    try {
      const res = await apiClient.get('/settings');
      if (res.data) {
        const s = res.data;
        const windowVal = parseInt(s.pharmarack_reorder_window_months || '2', 10);
        if ([2, 4, 6, 8].includes(windowVal)) setReorderWindowMonths(windowVal);

        setStoreInfo({
          name: s.pharmacy_name || s.shop_name || s.store_name || s.medical_name || s.name || '',
          phone: s.phone || s.shop_phone || s.store_phone || s.whatsapp_number || s.owner_whatsapp_number || '',
          address: s.address || s.shop_address || s.store_address || '',
          email: s.email || '',
          adminPhone: s.admin_whatsapp || s.admin_phone || s.owner_whatsapp_number || '',
          deliveryBoyName1: activeBoys[0]?.name || '',
          deliveryBoyPhone: activeBoys[0]?.whatsapp_number || '',
          deliveryBoyName2: activeBoys[1]?.name || '',
          deliveryBoyPhone2: activeBoys[1]?.whatsapp_number || '',
          invoiceFileFormat: s.distributor_invoice_file_format || 'CSV File Format'
        });
      }
    } catch (err) {
      console.warn('Failed to load store settings for WhatsApp template:', err);
    }
  };

  const loadContactData = async () => {
    const boys = await fetchDeliveryBoys();
    await fetchStoreInfo(boys);
  };

  const hasPharmacySettings = () => {
    return Boolean(
      storeInfo.name && storeInfo.name.trim().length > 0 &&
      storeInfo.phone && storeInfo.phone.trim().length > 0
    );
  };

  useEffect(() => {
    fetchSavedDistributors();
    fetchDistributorMappings();
    loadContactData();
    fetchReorderSuggestions();
    fetchReorderRecentItems();
    fetchPurchaseHistoryItems();

    const handlePhoneUpdate = () => {
      fetchSavedDistributors();
      fetchDistributorMappings();
      loadContactData();
      fetchReorderSuggestions();
      fetchReorderRecentItems();
      fetchPurchaseHistoryItems();
    };

    const handleClearSentHistory = () => {
      setSentWaStatusMap({});
      setLastSentWaTimeMap({});
      setLastBatchSentTime('');
      setLatestSentMap({});
      setSentOrders([]);
      setDistributors([]);
      setPendingOrders([]);
      setPendingRefills([]);
      cachedDistributors = [];
      cachedPendingOrders = [];
      cachedPendingRefills = [];
      cachedPriceHistory = {};
      cachedLastFetched = null;
      try {
        localStorage.removeItem(CART_CACHE_STORAGE_KEY);
        localStorage.removeItem('pharmacart_sent_wa_history');
        localStorage.removeItem('pharmarack_last_sent_wa_time_map');
        localStorage.removeItem('pharmarack_last_batch_sent_time');
        localStorage.removeItem('pharmarack_sent_history');
        localStorage.removeItem('pharmarack_latest_sent_map');
      } catch (_) { }
    };

    const handleSentOrdersUpdate = () => {
      const todayStr = getTodayDateKey();
      delete cachedSentOrdersMap[todayStr];
      cachedSentDates = [];
      loadSentDates();
    };

    window.addEventListener('phone-numbers-updated', handlePhoneUpdate);
    window.addEventListener('settings-updated', handlePhoneUpdate);
    window.addEventListener('clear-sent-history', handleClearSentHistory);
    window.addEventListener('clear-app-cache', handleClearSentHistory);
    window.addEventListener('refresh-sent-orders', handleSentOrdersUpdate);
    return () => {
      window.removeEventListener('phone-numbers-updated', handlePhoneUpdate);
      window.removeEventListener('settings-updated', handlePhoneUpdate);
      window.removeEventListener('clear-sent-history', handleClearSentHistory);
      window.removeEventListener('clear-app-cache', handleClearSentHistory);
      window.removeEventListener('refresh-sent-orders', handleSentOrdersUpdate);
    };
  }, []);

  // Session custom phone number override map by storeId (transient in-memory fallback)
  const [customDistributorPhones, setCustomDistributorPhones] = useState<Record<number, string>>({});

  useEffect(() => {
    // Permanently purge stale localStorage phone overrides so latest database numbers are always used
    try {
      localStorage.removeItem('custom_distributor_phones');
    } catch (_) { }
  }, []);

  const isValidPhoneNumber = (rawPhone: string): boolean => {
    if (!rawPhone) return false;
    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length === 10) return /^[6789]\d{9}$/.test(digits);
    if (digits.length === 12 && digits.startsWith('91')) return /^91[6789]\d{9}$/.test(digits);
    return false;
  };

  // Distributor filter sub-tab state ('active' | 'all' | 'success' | 'failed' | 'unmapped')
  const [distributorFilterTab, setDistributorFilterTab] = useState<'active' | 'unsent' | 'sent' | 'all' | 'success' | 'failed' | 'unmapped'>(() => {
    const f = searchParams.get('filter');
    if (f === 'unmapped' || f === 'active' || f === 'unsent' || f === 'sent' || f === 'all' || f === 'success' || f === 'failed') {
      return f;
    }
    return 'active';
  });

  // Synchronize distributorFilterTab with URL search params (e.g. ?filter=unmapped)
  useEffect(() => {
    const f = searchParams.get('filter');
    if (f === 'unmapped' || f === 'active' || f === 'unsent' || f === 'sent' || f === 'all' || f === 'success' || f === 'failed') {
      setDistributorFilterTab(f);
      if (f === 'unmapped') {
        setIsResolutionHubCollapsed(false);
      }
    }
  }, [searchParams]);

  // Inline Fast-Fill Phone Resolution Hub state (Concept 2)
  const [inlinePhones, setInlinePhones] = useState<Record<number, string>>({});
  const [inlineSavingStoreId, setInlineSavingStoreId] = useState<number | null>(null);
  const [isResolutionHubCollapsed, setIsResolutionHubCollapsed] = useState(false);
  const [sessionResolvedCount, setSessionResolvedCount] = useState(0);

  const [editingDistributor, setEditingDistributor] = useState<Distributor | null>(null);
  const [, setModalSearchTerm] = useState('');
  const [modalPhoneInput, setModalPhoneInput] = useState('');
  const [selectedSavedDistId, setSelectedSavedDistId] = useState<number | null>(null);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [phoneDuplicateWarning, setPhoneDuplicateWarning] = useState<string | null>(null);
  const [checkingPhoneDuplicate, setCheckingPhoneDuplicate] = useState(false);
  const [duplicateConfirmNotice, setDuplicateConfirmNotice] = useState<{ message: string; cleanPhone: string } | null>(null);

  // New distributor inline creation state inside modal
  const [isAddingNewDistributor, setIsAddingNewDistributor] = useState(false);
  const [newDistNameInput, setNewDistNameInput] = useState('');

  // Missing delivery boy validation prompt state
  const [, setShowMissingBoyModal] = useState(false);
  const [, setPendingTargetDistributor] = useState<Distributor | 'ALL' | null>(null);

  // Batch WhatsApp order confirmation popup state
  const [showConfirmBatchModal, setShowConfirmBatchModal] = useState(false);
  const [isValidatingBeforeSend, setIsValidatingBeforeSend] = useState(false);
  const [selectedBatchDeliveryBoys, setSelectedBatchDeliveryBoys] = useState<Record<number, number | null>>({});
  const [bulkApplyDeliveryBoyId, setBulkApplyDeliveryBoyId] = useState<string>('');
  const [includeMedicineListInBatch, setIncludeMedicineListInBatch] = useState<boolean>(false);
  const [selectedBatchStoreIds, setSelectedBatchStoreIds] = useState<Set<number>>(new Set());
  // Single WhatsApp order dispatch modal state
  const [singleDispatchTarget, setSingleDispatchTarget] = useState<Distributor | null>(null);
  const [singleDispatchBoyId, setSingleDispatchBoyId] = useState<number | null>(null);
  const [singleDispatchOrderNo, setSingleDispatchOrderNo] = useState<string>('');
  // Single Pharmarack order placement modal state
  const [placeOrderTargetDist, setPlaceOrderTargetDist] = useState<Distributor | null>(null);
  const [isPlacingSingleOrder, setIsPlacingSingleOrder] = useState<boolean>(false);
  // Debounced check for duplicate distributor phone numbers
  useEffect(() => {
    const clean = modalPhoneInput.replace(/\D/g, '');
    if (clean.length === 10) {
      setCheckingPhoneDuplicate(true);
      const timer = setTimeout(async () => {
        try {
          const res = await api.checkDuplicateDistributorPhone(
            clean,
            selectedSavedDistId || undefined,
            editingDistributor?.storeName || undefined
          );
          if (res.isDuplicate) {
            setPhoneDuplicateWarning(res.message || 'This phone number is already assigned.');
          } else {
            setPhoneDuplicateWarning(null);
          }
        } catch {
          setPhoneDuplicateWarning(null);
        } finally {
          setCheckingPhoneDuplicate(false);
        }
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setPhoneDuplicateWarning(null);
      setCheckingPhoneDuplicate(false);
      setDuplicateConfirmNotice(null);
    }
  }, [modalPhoneInput, selectedSavedDistId, editingDistributor?.storeName]);

  const handleOpenConfirmBatchModal = async () => {
    if (isSendingBatchWhatsApp || isValidatingBeforeSend) return;

    // Default select all available cart distributors
    setSelectedBatchStoreIds(new Set(distributors.map(d => d.storeId)));
    setIsValidatingBeforeSend(true);
    let shouldOpenConfirm = false;
    try {
      // 1. Force a live round-trip fresh fetch from upstream Pharmarack (?fresh=true)
      await fetchCart(true);
      await fetchLatestSentMap();
      const freshBoys = await fetchDeliveryBoys();
      await fetchDistributorMappings();
      // Brief settling pause to ensure state reconciles and paint settles cleanly
      await new Promise(r => setTimeout(r, 250));

      const currentList = cachedDistributors.length > 0 ? cachedDistributors : distributors;

      // Pre-fill initial delivery boy assignment per distributor
      const initialMap: Record<number, number | null> = {};
      currentList.forEach(d => {
        initialMap[d.storeId] = resolveInitialDeliveryBoyId(d, undefined, freshBoys);
      });
      setSelectedBatchDeliveryBoys(initialMap);
      setBulkApplyDeliveryBoyId('');
      // Refresh selected stores to include all post-refresh distributors
      setSelectedBatchStoreIds(new Set(currentList.map(d => d.storeId)));

      // Validate that EVERY distributor in the cart with items has a valid 10-digit phone
      const unmapped = currentList.filter(d => (d.items || []).length > 0 && !isDistributorMapped(d));
      if (unmapped.length > 0) {
        pendingMissingContactDistributorsRef.current = unmapped;
        const firstMissing = unmapped[0];
        toastEvent.trigger(
          `⚠️ Missing 10-digit contact for ${firstMissing.storeName} (${unmapped.length} distributor${unmapped.length > 1 ? 's' : ''} remaining). Please save mobile number before checkout.`,
          'info'
        );
        handleOpenEditModal(firstMissing);
        return;
      }

      shouldOpenConfirm = true;
    } catch (err) {
      console.warn('Pre-send live cart sync failed:', err);
      const currentList = cachedDistributors.length > 0 ? cachedDistributors : distributors;
      const unmapped = currentList.filter(d => (d.items || []).length > 0 && !isDistributorMapped(d));
      if (unmapped.length > 0) {
        pendingMissingContactDistributorsRef.current = unmapped;
        const firstMissing = unmapped[0];
        toastEvent.trigger(
          `⚠️ Missing 10-digit contact for ${firstMissing.storeName} (${unmapped.length} distributor${unmapped.length > 1 ? 's' : ''} remaining). Please save mobile number before checkout.`,
          'info'
        );
        handleOpenEditModal(firstMissing);
        return;
      }
      shouldOpenConfirm = true;
    } finally {
      setIsValidatingBeforeSend(false);
      if (shouldOpenConfirm) {
        // 2. Open confirmation modal with guaranteed up-to-date counts & distributor list
        setShowConfirmBatchModal(true);
      }
    }
  };

  const hasDeliveryBoyContacts = () => {
    const hasActiveBoys = deliveryBoysList.some(b => b.name && b.whatsapp_number && b.whatsapp_number.trim().length > 0);
    const hasSettingsBoys = Boolean(
      (storeInfo.deliveryBoyPhone && storeInfo.deliveryBoyPhone.trim().length > 0) ||
      (storeInfo.deliveryBoyPhone2 && storeInfo.deliveryBoyPhone2.trim().length > 0)
    );
    return hasActiveBoys || hasSettingsBoys;
  };

  // Universal Escape key dismissal for Pharmarack Cart modals
  useModalEscape(!!editingDistributor, () => {
    if (pendingMissingContactDistributorsRef.current.length > 0) {
      pendingMissingContactDistributorsRef.current = [];
      toastEvent.trigger('Batch order setup cancelled.', 'info');
    }
    setEditingDistributor(null);
  });
  useModalEscape(!!switchModalTarget, () => setSwitchModalTarget(null));
  useModalEscape(!!reorderSameModalTarget, () => setReorderSameModalTarget(null));
  useModalEscape(!!purchaseHistoryModalTarget, () => setPurchaseHistoryModalTarget(null));
  useModalEscape(showConfirmBatchModal, () => setShowConfirmBatchModal(false));
  useModalEscape(Boolean(singleDispatchTarget), () => setSingleDispatchTarget(null));

  const normalizeDistName = (rawName: string): string => {
    if (!rawName) return '';
    return rawName
      .toLowerCase()
      .trim()
      .replace(/\(.*?\)/g, '')
      .replace(/pvt|ltd|limited|private|distributors|distributor|pharma|pharmaceuticals|agency|agencies|medicals|medical|co|and|llp|delivery|surgical|surgicals|generic/gi, '')
      .replace(/[^a-z0-9]/g, '');
  };

  const findSavedDistributorMatch = (distName: string) => {
    if (!distName || !Array.isArray(savedDistributorsList)) return null;

    const normCart = normalizeDistName(distName);
    const rawCartNorm = distName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normCart && !rawCartNorm) return null;

    const getPhone = (d: LocalDistributorRecord) => {
      const p = d.phone || d.mobile || d.whatsapp || d.contact || '';
      return p.trim();
    };

    // 1. Highest Priority: EXACT match WITH a non-empty phone number
    const exactWithPhone = savedDistributorsList.find((d) => {
      if (!d || !d.name || !getPhone(d)) return false;
      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (rawCartNorm && rawCartNorm === rawSavedNorm) || (normCart && normSaved && normCart === normSaved);
    });
    if (exactWithPhone) return exactWithPhone;

    // 2. Second Priority: EXACT match ANY record (even if phone not yet set)
    const exactAny = savedDistributorsList.find((d) => {
      if (!d || !d.name) return false;
      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (rawCartNorm && rawCartNorm === rawSavedNorm) || (normCart && normSaved && normCart === normSaved);
    });
    if (exactAny) return exactAny;

    // 3. Third Priority: Fuzzy substring match WITH a non-empty phone number
    const fuzzyWithPhone = savedDistributorsList.find((d) => {
      if (!d || !d.name || !getPhone(d)) return false;
      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        (normCart && normSaved && normSaved.length >= 4 && normCart.length >= 4 && (normCart.includes(normSaved) || normSaved.includes(normCart))) ||
        (rawCartNorm && rawSavedNorm && rawSavedNorm.length >= 5 && rawCartNorm.length >= 5 && (rawCartNorm.includes(rawSavedNorm) || rawSavedNorm.includes(rawCartNorm)))
      );
    });
    if (fuzzyWithPhone) return fuzzyWithPhone;

    // 4. Fourth Priority: Any fuzzy match fallback
    return savedDistributorsList.find((d) => {
      if (!d || !d.name) return false;
      const normSaved = normalizeDistName(d.name);
      const rawSavedNorm = d.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        (normCart && normSaved && normSaved.length >= 4 && normCart.length >= 4 && (normCart.includes(normSaved) || normSaved.includes(normCart))) ||
        (rawCartNorm && rawSavedNorm && rawSavedNorm.length >= 5 && rawCartNorm.length >= 5 && (rawCartNorm.includes(rawSavedNorm) || rawSavedNorm.includes(rawCartNorm)))
      );
    });
  };

  const resolveInitialDeliveryBoyId = (
    dist: Distributor,
    mappings?: Record<string, { distributorId: number | null; phone: string; deliveryBoyId?: number | null }>,
    boys?: { id?: number; name: string; whatsapp_number: string; is_active?: number }[]
  ): number | null => {
    const activeBoys = boys && boys.length > 0 ? boys : deliveryBoysList;
    const activeMappings = mappings || distributorMappings;
    const normName = normalizeDistName(dist.storeName);
    const rawTrim = dist.storeName ? dist.storeName.toLowerCase().trim() : '';

    // 1. Check saved distributor mapping
    const cleanStoreNorm = dist.storeName ? dist.storeName.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const mapped = (activeMappings && (activeMappings[normName] || activeMappings[rawTrim] || activeMappings[cleanStoreNorm])) || null;
    if (mapped?.deliveryBoyId !== undefined && mapped?.deliveryBoyId !== null) {
      if (mapped.deliveryBoyId === 0) return 0;
      if (activeBoys.some(b => b.id === mapped.deliveryBoyId)) {
        return mapped.deliveryBoyId;
      }
    }

    // 2. Check saved distributors list
    const savedMatch = findSavedDistributorMatch(dist.storeName);
    if (savedMatch?.delivery_boy_id !== undefined && savedMatch?.delivery_boy_id !== null) {
      if (savedMatch.delivery_boy_id === 0) return 0;
      if (activeBoys.some(b => b.id === savedMatch.delivery_boy_id)) {
        return savedMatch.delivery_boy_id;
      }
    }

    // 3. Check dist.deliveryPersons matched by name
    if (dist.deliveryPersons && dist.deliveryPersons.length > 0 && dist.deliveryPersons[0].name && dist.deliveryPersons[0].name !== 'Not assigned yet') {
      const match = activeBoys.find(b => b.name && b.name.toLowerCase().includes(dist.deliveryPersons[0].name.toLowerCase()));
      if (match?.id) return match.id;
    }

    // 4. Do not silently pick a delivery boy - return null so the explicit badge prompts assignment
    return null;
  };

  const getDistributorPhoneNumber = (dist: Distributor): string => {
    // 1. Primary priority: Transient memory session override (user explicitly edited/saved number in modal)
    const custom = customDistributorPhones[dist.storeId];
    if (custom && custom.trim().length > 0) return custom.trim();

    // 2. Persistent store-to-distributor mapping from SQLite DB
    const normName = dist.storeName ? dist.storeName.toLowerCase().trim() : '';
    const cleanStoreNorm = dist.storeName ? dist.storeName.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

    let mapping = normName ? distributorMappings[normName] : null;
    if (!mapping && cleanStoreNorm) {
      const matchKey = Object.keys(distributorMappings).find(k => {
        const kNorm = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        return kNorm === cleanStoreNorm;
      });
      if (matchKey) {
        mapping = distributorMappings[matchKey];
      }
    }

    if (mapping) {
      if (mapping.distributorId) {
        const found = savedDistributorsList.find((d) => d.id === mapping.distributorId);
        const latestPhone = found?.phone || found?.mobile || found?.whatsapp || found?.contact || '';
        if (latestPhone && latestPhone.trim().length > 0) {
          return latestPhone.trim();
        }
      }
      if (mapping.phone && mapping.phone.trim().length > 0) {
        return mapping.phone.trim();
      }
    }

    // 3. Central Database (distributors table) match
    const matched = findSavedDistributorMatch(dist.storeName);
    const dbPhone = matched?.phone || matched?.mobile || matched?.whatsapp || matched?.contact || '';
    if (dbPhone && dbPhone.trim().length > 0) return dbPhone.trim();

    return '';
  };

  const isDistributorMapped = (dist: Distributor) => {
    return isValidPhoneNumber(getDistributorPhoneNumber(dist).replace(/\D/g, ''));
  };

  const getCartItemAmount = (item: { amount?: number; ptr?: number; rate?: number; qty?: number; quantity?: number }): number => {
    if (typeof item.amount === 'number' && item.amount > 0) return item.amount;
    const rate = item.ptr || item.rate || 0;
    const qty = item.qty || item.quantity || 1;
    return rate * qty;
  };

  const getDistributorCheckedTotal = (dist: Distributor): number => {
    return (dist.items || [])
      .filter(item => isItemIncludedInDispatch(item, dist))
      .reduce((sum, item) => sum + getCartItemAmount(item), 0);
  };

  const getDistributorFullTotal = (dist: Distributor): number => {
    return (dist.items || [])
      .reduce((sum, item) => sum + getCartItemAmount(item), 0);
  };

  const failedDistributors = React.useMemo(() => {
    return distributors
      .map(dist => ({
        ...dist,
        lineTotal: getDistributorCheckedTotal(dist)
      }))
      .filter(d => sentWaStatusMap[d.storeId] === 'error');
  }, [distributors, sentWaStatusMap, userCheckOverrides, latestSentMap]);

  const unmappedDistributors = React.useMemo(() => {
    return distributors
      .map(dist => ({
        ...dist,
        lineTotal: getDistributorCheckedTotal(dist)
      }))
      .filter(d => !isDistributorMapped(d));
  }, [distributors, customDistributorPhones, savedDistributorsList, distributorMappings, userCheckOverrides, latestSentMap]);

  const unsentCartDistributors = React.useMemo(() => {
    return distributors.map(dist => {
      const checkedTotal = getDistributorCheckedTotal(dist);
      return {
        ...dist,
        lineTotal: checkedTotal
      };
    }).filter(dist => {
      if (!dist.items || dist.items.length === 0) return false;
      // If there is ANY item in this distributor's cart that was NOT sent today, it belongs in Unsent Cart Orders!
      const hasUnsentItems = dist.items.some(i => !isItemAlreadySent(i, dist));
      if (hasUnsentItems) return true;
      // Or if the user manually checked any item to be included in dispatch
      const hasCheckedItems = dist.items.some(i => isItemIncludedInDispatch(i, dist));
      if (hasCheckedItems) return true;
      // If all items were already sent today and none are checked, only then filter out
      return sentWaStatusMap[dist.storeId] !== 'success';
    });
  }, [distributors, sentWaStatusMap, userCheckOverrides, latestSentMap]);

  const sentCartDistributors = React.useMemo(() => {
    return distributors.map(dist => {
      const sentItems = dist.items.filter(item => isItemAlreadySent(item, dist));
      const computedTotal = sentItems.reduce((sum, item) => sum + getCartItemAmount(item), 0);
      return {
        ...dist,
        items: sentItems.length > 0 ? sentItems : dist.items,
        lineTotal: computedTotal
      };
    }).filter(dist => dist.items.length > 0 && dist.items.some(i => isItemAlreadySent(i, dist)));
  }, [distributors, latestSentMap, sentWaStatusMap]);

  const activeCartDistributors = React.useMemo(() => {
    return distributors.map(dist => {
      const fullTotal = getDistributorFullTotal(dist);
      return {
        ...dist,
        lineTotal: fullTotal
      };
    }).filter(dist => dist.items.length > 0);
  }, [distributors]);

  const readyToSendDistributors = React.useMemo(() => {
    return distributors.filter(d =>
      isDistributorMapped(d) &&
      (d.items || []).some(i => isItemIncludedInDispatch(i, d)) &&
      sentWaStatusMap[d.storeId] !== 'success'
    );
  }, [distributors, customDistributorPhones, savedDistributorsList, distributorMappings, sentWaStatusMap, userCheckOverrides, latestSentMap]);

  const filteredDistributorList = React.useMemo(() => {
    let list: Distributor[] = [];
    if (distributorFilterTab === 'unsent' || distributorFilterTab === 'active') list = unsentCartDistributors;
    else if (distributorFilterTab === 'sent' || distributorFilterTab === 'success') list = sentCartDistributors;
    else if (distributorFilterTab === 'failed') list = failedDistributors;
    else if (distributorFilterTab === 'unmapped') list = unmappedDistributors;
    else if (distributorFilterTab === 'all') list = activeCartDistributors;
    else list = unsentCartDistributors;

    // Always guarantee distributors and their items are rendered in alphabetical order
    return [...list]
      .map(dist => ({
        ...dist,
        items: [...(dist.items || [])].sort((a, b) =>
          (a.productName || '').localeCompare(b.productName || '', undefined, { sensitivity: 'base' })
        )
      }))
      .sort((a, b) =>
        (a.storeName || '').localeCompare(b.storeName || '', undefined, { sensitivity: 'base' })
      );
  }, [distributorFilterTab, unsentCartDistributors, sentCartDistributors, failedDistributors, unmappedDistributors, activeCartDistributors]);

  // Order summary per distributor for the WhatsApp dispatch confirmation popup
  const batchSummaryList = React.useMemo(() => {
    return distributors.map(dist => {
      const itemsForBatch = (dist.items || []).filter(item => isItemIncludedInDispatch(item, dist));
      const activeItems = itemsForBatch.length > 0 ? itemsForBatch : (dist.items || []);
      const qty = activeItems.reduce((sum, i) => sum + (i.qty || 1), 0);
      const amount = activeItems.reduce((sum, i) => sum + getCartItemAmount(i), 0);
      const isMapped = isDistributorMapped(dist);
      return {
        storeId: dist.storeId,
        storeName: dist.storeName,
        totalQty: qty,
        totalAmount: amount,
        isMapped,
      };
    }).filter(d => d.totalQty > 0);
  }, [distributors, customDistributorPhones, savedDistributorsList, distributorMappings, userCheckOverrides, latestSentMap]);

  const finalBatchTotalQty = React.useMemo(() => {
    return batchSummaryList.reduce((sum, d) => sum + d.totalQty, 0);
  }, [batchSummaryList]);

  const finalBatchTotalAmount = React.useMemo(() => {
    return batchSummaryList.reduce((sum, d) => sum + d.totalAmount, 0);
  }, [batchSummaryList]);

  // Aggregate all previous-ordered items (yesterday/past) from the current cart for the reorder banner.
  // Uses existing getPastOrderedInfo + isItemIncludedInDispatch — no new data fetching.
  const previousOrderItemsInfo = React.useMemo(() => {
    const result: { dist: Distributor; item: CartLineItem; isChecked: boolean; placedDateStr: string; isYesterday: boolean }[] = [];
    for (const dist of distributors) {
      for (const item of dist.items) {
        const pastInfo = getPastOrderedInfo(item, dist);
        if (pastInfo.isPastOrdered && !pastInfo.isToday) {
          result.push({
            dist,
            item,
            isChecked: isItemIncludedInDispatch(item, dist),
            placedDateStr: pastInfo.placedDateStr,
            isYesterday: pastInfo.isYesterday
          });
        }
      }
    }
    return result;
  }, [distributors, latestSentMap, userCheckOverrides]);

  // ponytail: delivery boy data comes exclusively from /dispatch/delivery-boys (delivery_boys table)
  // Store info (name, phone, address) comes from /settings. No delivery boy keys read from app_settings.

  const fetchPendingRefills = async () => {
    try {
      const res = await apiClient.get('/refills/panel');
      if (res.data && Array.isArray(res.data)) {
        const refillList: Refill[] = [];
        const today = new Date();

        res.data.forEach((patient: LocalRefillPanelPatient) => {
          if (!patient.medicines || !Array.isArray(patient.medicines)) return;

          patient.medicines.forEach((m) => {
            if (m.status === 'canceled' || m.status === 'ordered' || m.status === 'completed' || m.status === 'fulfilled' || m.is_active === 0) return;
            if (isRefillFulfilledToday(m as any)) return;
            if (isSoldAtPOSToday(m.medicine_name)) return;

            const dueDate = new Date(patient.next_refill_date);
            const diffMs = dueDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            const reqQty = Number(m.quantity_needed || 1);
            const stockQty = Number(m.in_stock_qty || 0);

            // Show in actionable ordering if due within 7 days (today -> next 7 days)
            if (diffDays <= 7) {
              refillList.push({
                id: m.id,
                patient_name: patient.patient_name,
                patient_phone: patient.patient_phone,
                medicine_id: m.medicine_id || m.id,
                medicine_name: m.medicine_name,
                refill_interval_days: m.refill_interval_days || 30,
                last_refill_date: '',
                next_refill_date: patient.next_refill_date,
                status: m.status || 'active',
                hold_for_stock: m.hold_for_stock || 0,
                is_active: m.is_active !== undefined ? m.is_active : 1,
                quantity_needed: reqQty,
                in_stock_qty: stockQty,
                reminder_status: m.reminder_status || 'NOT_SENT',
                reminder_sent_at: m.reminder_sent_at || null
              });
            }
          });
        });

        setPendingRefills(refillList);
        cachedPendingRefills = refillList;
        return;
      }
    } catch (err) {
      console.warn('Failed to fetch refill panel for Quick Assist, trying fallback:', err);
    }

    try {
      const data = await api.getRefills();
      if (Array.isArray(data)) {
        const filtered = data.filter(r => 
          r.is_active !== 0 && 
          r.status !== 'canceled' && 
          r.status !== 'ordered' && 
          r.status !== 'completed' && 
          r.status !== 'fulfilled' && 
          !isRefillFulfilledToday(r) && 
          !isSoldAtPOSToday(r.medicine_name)
        );
        setPendingRefills(filtered);
        cachedPendingRefills = filtered;
      }
    } catch (err) {
      console.error('Failed to fetch pending refills:', err);
    }
  };

  const getRefillItemInCart = (refill: Refill) => {
    const refillName = refill.medicine_name || '';
    if (!refillName) return null;
    const { matchedItem, result } = findBestCartMatchForOrder({ product: refillName }, distributors);
    if (result && result.isMatch) {
      return matchedItem;
    }
    return null;
  };

  const fetchPendingOrders = async () => {
    try {
      const data = await api.getOrders();
      if (Array.isArray(data)) {
        setAllOnlineOrders(data);
        // Show pending, confirmed, or waiting requests (placed orders are hidden from pending list)
        const filtered = data.filter(o => 
          ['Pending', 'Confirmed', 'Waiting'].includes(o.status) && 
          !['Ordered', 'Fulfilled', 'Completed', 'Cancelled', 'Ready'].includes(o.status) &&
          !isSoldAtPOSToday(o.product)
        );
        setPendingOrders(filtered);
        cachedPendingOrders = filtered;
      }
    } catch (err) {
      console.error('Failed to fetch pending special orders:', err);
    }
  };

  const getOrderCartMatch = (order: SpecialOrder) => {
    const { matchedItem, candidateItem, result } = findBestCartMatchForOrder(order, distributors);
    if (result && result.score >= 75) {
      return { item: matchedItem, candidateItem: matchedItem, result, isHighMatch: true, isPartialMatch: false };
    }
    if (result && result.score >= 40 && candidateItem) {
      return { item: null, candidateItem, result, isHighMatch: false, isPartialMatch: true };
    }
    return null;
  };

  const getOrderItemInCart = (order: SpecialOrder) => {
    const match = getOrderCartMatch(order);
    return match ? match.item : null;
  };

  const isMedicineInAnyCart = React.useCallback((medName?: string): boolean => {
    if (!medName) return false;
    const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanMedKey = (s?: string) => norm(s).replace(/(tablet|tablets|tab|capsule|capsules|cap|injection|inj|syrup|syr|drops|suspension|susp|cream|ointment|gel|lotion|\d+s|\d+tab|\d+cap)/g, '');
    const targetKey = cleanMedKey(medName);
    if (!targetKey) return false;
    for (const d of distributors) {
      for (const item of (d.items || [])) {
        const itemKey = cleanMedKey(item.productName);
        if (itemKey === targetKey) return true;
        if (targetKey.length >= 4 && itemKey.length >= 4 && (itemKey.includes(targetKey) || targetKey.includes(itemKey))) {
          return true;
        }
      }
    }
    return false;
  }, [distributors]);

  const isMedicineInSentPO = React.useCallback((medName?: string): boolean => {
    if (!medName) return false;
    const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanMedKey = (s?: string) => norm(s).replace(/(tablet|tablets|tab|capsule|capsules|cap|injection|inj|syrup|syr|drops|suspension|susp|cream|ointment|gel|lotion|\d+s|\d+tab|\d+cap)/g, '');
    const targetKey = cleanMedKey(medName);
    if (!targetKey) return false;

    for (const sentInfo of Object.values(latestSentMap)) {
      if (sentInfo && Array.isArray(sentInfo.items)) {
        for (const it of sentInfo.items) {
          const itKey = cleanMedKey(it.productName || it.product || it.name);
          if (itKey === targetKey || (targetKey.length >= 4 && itKey.length >= 4 && (itKey.includes(targetKey) || targetKey.includes(itKey)))) {
            return true;
          }
        }
      }
    }
    return false;
  }, [latestSentMap]);

  // Single source of truth for the "Req"/"Refills" tab badge counts, so they match what
  // the "Show Added" toggle actually leaves visible in the list below instead of the raw,
  // unfiltered pending counts. Placed PO items are completely hidden.
  const visiblePendingOrders = React.useMemo(() => {
    return pendingOrders.filter(order => {
      if (order.status === 'Ordered' || order.status === 'Fulfilled' || order.status === 'Completed' || order.status === 'Cancelled' || order.status === 'Ready') return false;
      if (isMedicineInSentPO(order.product)) return false;
      if (isSoldAtPOSToday(order.product)) return false;
      return showAddedItems ? true : !getOrderItemInCart(order);
    });
  }, [pendingOrders, showAddedItems, isMedicineInSentPO, isSoldAtPOSToday]);

  const visiblePendingRefills = React.useMemo(() => {
    return pendingRefills.filter(refill => {
      if (refill.status === 'ordered' || refill.status === 'completed' || refill.status === 'fulfilled' || refill.status === 'canceled') return false;
      if (isRefillFulfilledToday(refill)) return false;
      if (isMedicineInSentPO(refill.medicine_name)) return false;
      if (isSoldAtPOSToday(refill.medicine_name)) return false;
      return showAddedItems ? true : !getRefillItemInCart(refill);
    });
  }, [pendingRefills, showAddedItems, isMedicineInSentPO, isSoldAtPOSToday]);

  // Reorder Hub search = the MEDICINE the user typed, nothing else. Every typed word must start a word of
  // the medicine name ("muchatac ocea" -> MUCHATAC OCEAN ...); a contiguous substring still matches.
  // Distributor / manufacturer / requester text no longer pulls in unrelated medicines. A digits-only
  // query additionally matches a request / order id.
  const reorderQueryNorm = React.useMemo(() => reorderSearchQuery.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), [reorderSearchQuery]);
  const reorderQueryTokens = React.useMemo(() => reorderQueryNorm.split(' ').filter(Boolean), [reorderQueryNorm]);
  const queryIsIdOnly = /^\d+$/.test(reorderQueryNorm);
  const medicineNameMatches = React.useCallback((name?: string | null): boolean => {
    if (reorderQueryTokens.length === 0) return true;
    const n = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!n) return false;
    if (n.includes(reorderQueryNorm)) return true;
    const words = n.split(' ');
    return reorderQueryTokens.every(t => words.some(w => w.startsWith(t)));
  }, [reorderQueryNorm, reorderQueryTokens]);

  const filteredPendingOrders = React.useMemo(() => {
    if (!reorderQueryNorm) return visiblePendingOrders;
    return visiblePendingOrders.filter(order =>
      medicineNameMatches(order.product) || (queryIsIdOnly && String(order.id) === reorderQueryNorm)
    );
  }, [visiblePendingOrders, reorderQueryNorm, queryIsIdOnly, medicineNameMatches]);

  const filteredPendingRefills = React.useMemo(() => {
    if (!reorderQueryNorm) return visiblePendingRefills;
    return visiblePendingRefills.filter(refill =>
      medicineNameMatches(refill.medicine_name) || (queryIsIdOnly && String(refill.id) === reorderQueryNorm)
    );
  }, [visiblePendingRefills, reorderQueryNorm, queryIsIdOnly, medicineNameMatches]);

  const filteredReorderSuggestions = React.useMemo(() => {
    if (!reorderQueryNorm) return reorderSuggestions;
    return reorderSuggestions.filter(sug => medicineNameMatches(sug.medicineName));
  }, [reorderSuggestions, reorderQueryNorm, medicineNameMatches]);

  const filteredReorderRecentItems = React.useMemo(() => {
    if (!reorderQueryNorm) return reorderRecentItems;
    return reorderRecentItems.filter(item =>
      medicineNameMatches(item.medicineName) ||
      (queryIsIdOnly && (String(item.orderId || '') === reorderQueryNorm || (item.receivedInvoiceNo || '').toLowerCase().includes(reorderQueryNorm)))
    );
  }, [reorderRecentItems, reorderQueryNorm, queryIsIdOnly, medicineNameMatches]);

  const filteredPurchaseHistoryItems = React.useMemo(() => {
    if (!reorderQueryNorm) return purchaseHistoryItems;
    return purchaseHistoryItems.filter(item => medicineNameMatches(item.medicineName));
  }, [purchaseHistoryItems, reorderQueryNorm, medicineNameMatches]);

  const totalReorderMatchesCount =
    filteredPendingOrders.length +
    filteredPendingRefills.length +
    filteredReorderSuggestions.length +
    filteredReorderRecentItems.length +
    filteredPurchaseHistoryItems.length;

  const [sendingDeliveryBoyNotifId, setSendingDeliveryBoyNotifId] = useState<number | null>(null);

  const handleSendDeliveryBoyNotification = async (dist: Distributor) => {
    setSendingDeliveryBoyNotifId(dist.storeId);
    try {
      messageSendEvent.triggerSendProgress(dist.storeName, `Dispatching Delivery Boy notification for ${dist.storeName}...`, 10);
      const checkedItems = dist.items.filter(item => item.isChecked !== false);
      const itemsToSend = checkedItems.length > 0 ? checkedItems : dist.items;
      const res = await api.sendManualCartNotification({
        storeId: dist.storeId,
        storeName: dist.storeName,
        deliveryPersons: dist.deliveryPersons,
        items: itemsToSend
      });
      if (res && res.success) {
        toastEvent.trigger(`Delivery Boy notification sent via WhatsApp for ${dist.storeName}!`, 'success');
        // Persist sent status so it reflects immediately and across reloads
        setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
      } else {
        toastEvent.trigger(res?.error || 'Failed to send delivery boy notification.', 'error');
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      console.error('Failed to send delivery boy notification:', err);
      toastEvent.trigger(apiErr?.response?.data?.error || 'Failed to send delivery boy notification.', 'error');
    } finally {
      setSendingDeliveryBoyNotifId(null);
    }
  };

  const handleSendManualNotification = async (dist: Distributor) => {
    const limitIssues = getOrderLimitIssues(dist, isItemIncludedInDispatch);
    if (limitIssues.length > 0) {
      toastEvent.trigger(limitIssues.join(' | '), 'error');
      return;
    }
    setSendingNotifId(dist.storeId);
    try {
      messageSendEvent.triggerSendProgress(dist.storeName, `Sending WhatsApp notification to ${dist.storeName}...`, 10);
      const checkedItems = dist.items.filter(item => item.isChecked !== false);
      const itemsToSend = checkedItems.length > 0 ? checkedItems : dist.items;
      const res = await api.sendManualCartNotification({
        storeId: dist.storeId,
        storeName: dist.storeName,
        deliveryPersons: dist.deliveryPersons,
        items: itemsToSend
      });
      if (res && res.success) {
        toastEvent.trigger(res.message || 'Notification sent successfully!', 'success');
        setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
      } else {
        toastEvent.trigger(res?.error || 'Failed to send notifications.', 'error');
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      console.error('Failed to send notifications:', err);
      toastEvent.trigger(apiErr?.response?.data?.error || 'Failed to send notifications.', 'error');
    } finally {
      setSendingNotifId(null);
    }
  };

  // ponytail: accepts optional pre-resolved boy so Send All can pass the live-fetched boy
  // without relying on stale React state closure from deliveryBoysList
  const buildDistributorOrderMessage = (
    dist: Distributor,
    resolvedBoy?: { name: string; whatsapp_number: string } | null,
    customOrderNo?: string
  ) => {
    const formatPhone = (raw: string) => {
      if (!raw) return '';
      const clean = raw.replace(/\D/g, '');
      if (clean.length === 10) return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
      if (clean.startsWith('91') && clean.length === 12) return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
      if (clean.length > 0) return `+${clean}`;
      return raw;
    };

    // Resolve registered delivery boy — prefer pre-resolved arg to avoid stale closure
    let boyName = 'Not assigned yet';
    let boyPhone = 'N/A';

    // 0. Use pre-resolved boy passed in from the send handler (live-fetched, not stale state)
    if (resolvedBoy?.name && resolvedBoy?.whatsapp_number) {
      boyName = resolvedBoy.name;
      boyPhone = formatPhone(resolvedBoy.whatsapp_number);
    } else if (resolvedBoy === null) {
      // Explicitly marked as Unassigned / Admin Fallback
      if (storeInfo.adminPhone || storeInfo.phone) {
        boyName = 'Admin / Store Owner';
        boyPhone = formatPhone(storeInfo.adminPhone || storeInfo.phone);
      }
    }

    // 0.5. Check persistent distributor mapping or saved distributors list
    if (boyName === 'Not assigned yet' || boyPhone === 'N/A') {
      const normName = normalizeDistName(dist.storeName);
      const rawTrim = dist.storeName ? dist.storeName.toLowerCase().trim() : '';
      const mappedBoyId = distributorMappings[normName]?.deliveryBoyId || distributorMappings[rawTrim]?.deliveryBoyId;
      if (mappedBoyId) {
        const match = deliveryBoysList.find(b => b.id === mappedBoyId);
        if (match?.name && match?.whatsapp_number) {
          boyName = match.name;
          boyPhone = formatPhone(match.whatsapp_number);
        }
      }
    }

    // 1. Check dist.deliveryPersons first if it has a matched delivery boy in deliveryBoysList
    if ((boyName === 'Not assigned yet' || boyPhone === 'N/A') && dist.deliveryPersons && dist.deliveryPersons.length > 0 && dist.deliveryPersons[0].name && dist.deliveryPersons[0].name !== 'Not assigned yet') {
      const match = deliveryBoysList.find(b => b.name && b.name.toLowerCase().includes(dist.deliveryPersons[0].name.toLowerCase()));
      if (match) {
        boyName = match.name;
        boyPhone = formatPhone(match.whatsapp_number);
      } else {
        boyName = dist.deliveryPersons[0].name;
      }
    }

    // 2. Fallback to Store Admin/Owner phone if no active delivery boy was assigned
    if (boyName === 'Not assigned yet' || boyPhone === 'N/A') {
      if (storeInfo.adminPhone || storeInfo.phone) {
        boyName = 'Admin / Store Owner';
        boyPhone = formatPhone(storeInfo.adminPhone || storeInfo.phone);
      }
    }

    const storeName = storeInfo.name || 'AI Pharmacy';
    const address = storeInfo.address || 'N/A';
    const email = storeInfo.email || 'N/A';
    const fileFormat = storeInfo.invoiceFileFormat ? storeInfo.invoiceFileFormat.replace(' File Format', '') : 'CSV';
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const storePhone = storeInfo.phone || storeInfo.adminPhone || '';
    const formattedStorePhone = storePhone ? formatPhone(storePhone) : 'N/A';

    // Resolve order ID / PO number if known (all of today's IDs: #old + #new in one reminder)
    // ponytail: customOrderNo may be a comma list — normalize each token to #id, dedupe
    let orderIdText = '';
    const givenNo = (customOrderNo || '').trim();
    if (givenNo) {
      const seen = new Set<string>();
      orderIdText = givenNo.split(',').map(s => s.trim().replace(/^#+/, '')).filter(n => n && !seen.has(n) && (seen.add(n), true)).map(n => `#${n}`).join(', ');
    } else {
      const matchSent = sentOrders.find(so =>
        (dist.storeId && so.store_id === dist.storeId) ||
        (so.store_name && dist.storeName && so.store_name.toLowerCase().trim() === dist.storeName.toLowerCase().trim())
      );
      if (matchSent?.pharmarack_order_nos && matchSent.pharmarack_order_nos.length > 0) {
        const seenIds = new Set<string>();
        orderIdText = matchSent.pharmarack_order_nos.map((no: string) => String(no).trim().replace(/^#+/, '')).filter(n => n && !seenIds.has(n) && (seenIds.add(n), true)).map(n => `#${n}`).join(', ');
      } else if (matchSent?.id) {
        orderIdText = `#${matchSent.id}`;
      }
    }

    // Pure dispatch reminder format (omits verbose medicine list for official PO flow)
    let msg = '';
    if (orderIdText) {
      msg = `📦 *Pharmarack Order ${orderIdText}* has been placed.\n`;
    } else {
      msg = `📦 *Pharmarack Order* has been placed.\n`;
    }
    msg += `Please pack and dispatch as soon as possible.\n\n`;
    msg += `🚚 *Delivery / Pickup Staff:*\n`;
    msg += `  👤 *${boyName}*\n`;
    msg += `  📞 *${boyPhone || 'N/A'}*\n\n`;
    msg += `🏥 *${storeName}*\n`;
    if (address && address !== 'N/A') msg += `📍 *Delivery Location:* ${address}\n`;
    msg += `📞 *Pharmacy Contact:* ${formattedStorePhone}\n`;
    if (dateStr) msg += `📅 *Order Date:* ${dateStr}\n\n`;
    msg += `📝 *Note:* Please send invoice bill (${fileFormat}) to ${email}.`;

    return msg.trim();
  };

  const handleOpenPlaceOrderModal = (dist: Distributor) => {
    setPlaceOrderTargetDist(dist);
  };

  const handleConfirmPlaceSingleOrder = async () => {
    if (!placeOrderTargetDist) return;
    const dist = placeOrderTargetDist;
    setIsPlacingSingleOrder(true);
    try {
      const itemsToOrder = dist.items.filter(item => isItemIncludedInDispatch(item, dist));
      const finalItems = itemsToOrder.length > 0 ? itemsToOrder : dist.items;

      toastEvent.trigger(`⚡ Placing official order for ${dist.storeName} on Pharmarack...`, 'info');

      const res = await api.placeOfficialPharmarackOrders({
        targetStoreNames: [dist.storeName],
        targetStoreIds: [dist.storeId],
        orders: [{
          storeName: dist.storeName,
          storeId: dist.storeId,
          items: finalItems
        }],
        skipWhatsAppQueue: true
      });

      if (res && res.success) {
        const placed = res.orders?.find(o => o.status === 'placed' && o.orderNo) || res.orders?.[0];
        const orderNo = placed?.orderNo;

        toastEvent.trigger(
          orderNo
            ? `✅ Official order placed on Pharmarack! Order ID: #${orderNo}`
            : `✅ Official order placed on Pharmarack for ${dist.storeName}!`,
          'success'
        );

        setPlaceOrderTargetDist(null);

        // Instantly reload cart so placed distributor items clear from the screen
        fetchCart(false);

        // Update history in background
        Promise.allSettled([
          fetchPendingOrders(),
          fetchLatestSentMap(),
          loadSentDates()
        ]).catch(() => {});
      } else {
        toastEvent.trigger(res?.error || res?.message || 'Failed to place order on Pharmarack', 'error');
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      console.error('Failed to place single Pharmarack order:', err);
      toastEvent.trigger(apiErr?.response?.data?.error || apiErr?.message || 'Failed to place order on Pharmarack', 'error');
    } finally {
      setIsPlacingSingleOrder(false);
    }
  };

  const handleOpenSingleDispatchModal = (dist: Distributor) => {
    setSingleDispatchTarget(dist);
    const initialBoyId = resolveInitialDeliveryBoyId(dist, distributorMappings, deliveryBoysList);
    setSingleDispatchBoyId(initialBoyId);
    // Find matching order numbers from sentOrders
    // If the cart has unsent items, this is a fresh dispatch batch: leave blank so new PO ID can be entered.
    // Only pre-fill previous PO ID if all cart items were already sent.
    const hasUnsentItems = dist.items.some(i => !isItemAlreadySent(i, dist));
    let detectedOrderNo = '';
    if (!hasUnsentItems) {
      const matchSent = sentOrders.find(so =>
        (dist.storeId && so.store_id === dist.storeId) ||
        (so.store_name && dist.storeName && so.store_name.toLowerCase().trim() === dist.storeName.toLowerCase().trim())
      );
      detectedOrderNo = Array.isArray(matchSent?.pharmarack_order_nos) && matchSent.pharmarack_order_nos.length > 0
        ? Array.from(new Set(matchSent.pharmarack_order_nos.map((n: string) => String(n).trim().replace(/^#+/, '')).filter(Boolean))).join(', ')
        : (matchSent?.order_no ? String(matchSent.order_no).trim().replace(/^#+/, '') : '');
    }
    setSingleDispatchOrderNo(detectedOrderNo);
  };

  const handleConfirmSingleDispatch = async () => {
    if (!singleDispatchTarget) return;
    const dist = singleDispatchTarget;
    const boyId = singleDispatchBoyId;
    const resolvedBoy = deliveryBoysList.find(b => b.id === boyId) || null;
    const orderNo = singleDispatchOrderNo;

    if (dist.storeName && boyId) {
      const normName = dist.storeName.toLowerCase().trim();
      setDistributorMappings(prev => {
        const existing = prev[normName];
        return {
          ...prev,
          [normName]: {
            distributorId: existing?.distributorId ?? null,
            phone: existing?.phone ?? '',
            deliveryBoyId: boyId
          }
        };
      });
      try {
        await apiClient.post('/pharmarack/distributor-mappings', {
          store_name: dist.storeName,
          delivery_boy_id: boyId
        });
      } catch (_) { }
    }

    setSingleDispatchTarget(null);
    await handleSendWhatsAppOrder(dist, false, false, 'both', resolvedBoy, orderNo);
  };

  const handleSendWhatsAppOrder = async (
    dist: Distributor,
    bypassMissingBoyCheck = false,
    forceResend = false,
    targetMode: 'distributor_only' | 'both' = 'both',
    resolvedBoy?: { name: string; whatsapp_number: string } | null,
    customOrderNo?: string
  ) => {
    if (!hasPharmacySettings()) {
      toastEvent.trigger('Pharmacy Name and Contact Phone are required in Settings before sending orders.', 'error');
      navigate('/settings?missing=pharmacy_details');
      return;
    }

    if (!bypassMissingBoyCheck && targetMode === 'both' && !hasDeliveryBoyContacts()) {
      setPendingTargetDistributor(dist);
      setShowMissingBoyModal(true);
      return;
    }

    const limitIssues = getOrderLimitIssues(dist, isItemIncludedInDispatch);
    if (limitIssues.length > 0) {
      toastEvent.trigger(limitIssues.join(' | '), 'error');
      return;
    }

    const itemsToOrder = dist.items.filter(item => isItemIncludedInDispatch(item, dist));

    if (itemsToOrder.length === 0) {
      toastEvent.trigger(`No items selected for ${dist.storeName}. Please check at least 1 item to send.`, 'info');
      return;
    }

    const phoneNum = getDistributorPhoneNumber(dist);

    const cleanPhone = toWaDigits(phoneNum);
    if (!cleanPhone || !isValidPhoneNumber(cleanPhone)) {
      setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'error' }));
      toastEvent.trigger(`Invalid phone number "${phoneNum || 'missing'}" for ${dist.storeName}. Please enter a valid 10-digit number.`, 'error');
      handleOpenEditModal(dist);
      return;
    }

    const msg = buildDistributorOrderMessage(dist, resolvedBoy, customOrderNo);

    setSendingWaDistributorId(dist.storeId);
    try {
      // 1. Send silently via backend API (100% background delivery, no popups)
      const res = await apiClient.post('/messaging/send', {
        number: cleanPhone,
        message: msg,
        target_name: dist.storeName,
        type: 'pharmarack_distributor_order'
      });

      if (res?.status === 202 || res?.data?.queued) {
        setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'queued' }));
        toastEvent.trigger(`WhatsApp order queued for background delivery (${dist.storeName})`, 'info');
      } else if (res?.data?.success) {
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
        setLastSentWaTimeMap(prev => {
          const next = { ...prev, [dist.storeId]: timeNow };
          try { localStorage.setItem('pharmarack_last_sent_wa_time_map', JSON.stringify(next)); } catch (_) { }
          return next;
        });
        toastEvent.trigger(
          forceResend
            ? `Resent WhatsApp order to ${dist.storeName}${targetMode === 'both' ? ' & Delivery Boy' : ' (Distributor Only)'}!`
            : `WhatsApp order sent and verified for ${dist.storeName}!`,
          'success'
        );
      } else {
        throw new Error(res?.data?.error || 'Silent send failed');
      }

      // Also trigger backend notification to Delivery Boys ONLY if targetMode is 'both'
      // Pass skipDistributor: true to avoid sending a duplicate order message to the distributor
      const effectiveDeliveryPersons = resolvedBoy
        ? [{ name: resolvedBoy.name, phone: resolvedBoy.whatsapp_number, id: (resolvedBoy as any).id }]
        : dist.deliveryPersons;

      if (targetMode === 'both') {
        try {
          await apiClient.post('/pharmarack/cart/notify-manual', {
            storeId: dist.storeId,
            storeName: dist.storeName,
            deliveryPersons: effectiveDeliveryPersons,
            items: itemsToOrder,
            skipDistributor: true,
            orderNo: customOrderNo
          });
        } catch (distErr) {
          console.warn('Could not notify delivery boys via backend route:', distErr);
        }
      }

      // Log placed order to DB history
      try {
        const itemsToLog = itemsToOrder;
        await api.logPharmarackPlacedOrder({
          store_id: dist.storeId,
          store_name: dist.storeName,
          items: itemsToLog,
          delivery_persons: effectiveDeliveryPersons,
          order_no: customOrderNo || null,
          delivery_boy_id: resolvedBoy ? (resolvedBoy as any).id : null,
          delivery_boy_notified: targetMode === 'both' ? 1 : 0
        });
        setHasUnreadSentHistory(true);
        specialOrdersEvent.triggerUpdated();
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));
        // Refresh orders and sent dates asynchronously in background without blocking UI
        Promise.allSettled([
          fetchPendingOrders(),
          fetchLatestSentMap(),
          loadSentDates()
        ]).catch(() => { });
      } catch (logErr) {
        console.warn('Could not log placed order:', logErr);
      }
    } catch (err: unknown) {
      console.warn('Silent WhatsApp send fallback to Web tab:', err);

      // Copy order message to clipboard for instant manual paste if needed
      try {
        await navigator.clipboard.writeText(msg);
      } catch (_) { }

      // Fallback: open/reuse WhatsApp Web tab with pre-filled order message
      const encodedMsg = encodeURIComponent(msg);
      const waWebUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMsg}`;
      openOrReuseWhatsappTab(waWebUrl, cleanPhone, msg);

      const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'success' }));
      setLastSentWaTimeMap(prev => {
        const next = { ...prev, [dist.storeId]: timeNow };
        try { localStorage.setItem('pharmarack_last_sent_wa_time_map', JSON.stringify(next)); } catch (_) { }
        return next;
      });

      toastEvent.trigger(`Opened WhatsApp Web for ${dist.storeName}! (Order message pre-filled)`, 'success');

      // Log placed order to DB history on tab fallback
      try {
        const freshItems = dist.items.filter(item => !isItemAlreadySent(item, dist));
        const itemsToLog = freshItems.length > 0 ? freshItems : dist.items;
        await api.logPharmarackPlacedOrder({
          store_id: dist.storeId,
          store_name: dist.storeName,
          items: itemsToLog,
          delivery_persons: dist.deliveryPersons,
          order_no: customOrderNo || null
        });
        setHasUnreadSentHistory(true);
        specialOrdersEvent.triggerUpdated();
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));
        // Refresh orders and sent dates asynchronously in background without blocking UI
        Promise.allSettled([
          fetchPendingOrders(),
          fetchLatestSentMap(),
          loadSentDates()
        ]).catch(() => { });
      } catch (logErr) {
        console.warn('Could not log placed order:', logErr);
      }
    } finally {
      setSendingWaDistributorId(null);
    }
  };

  const handleSendAllWhatsAppOrders = async (
    bypassMissingBoyCheck = false,
    customDeliveryBoys?: Record<number, number | null>,
    includeMedicineList = false,
    targetStoreIds?: number[]
  ) => {
    if (isSendingBatchRef.current) {
      toastEvent.trigger('A WhatsApp batch send is already in progress.', 'info');
      return;
    }

    isSendingBatchRef.current = true;
    setIsSendingBatchWhatsApp(true);

    if (!hasPharmacySettings()) {
      isSendingBatchRef.current = false;
      setIsSendingBatchWhatsApp(false);
      toastEvent.trigger('Pharmacy Name and Contact Phone are required in Settings before sending orders.', 'error');
      navigate('/settings?missing=pharmacy_details');
      return;
    }

    if (!bypassMissingBoyCheck && !hasDeliveryBoyContacts()) {
      isSendingBatchRef.current = false;
      setIsSendingBatchWhatsApp(false);
      setPendingTargetDistributor('ALL');
      setShowMissingBoyModal(true);
      return;
    }

    const activeStoreIdSet = targetStoreIds && targetStoreIds.length > 0
      ? new Set(targetStoreIds)
      : null;

    const targetDistributors = activeStoreIdSet
      ? distributors.filter(d => activeStoreIdSet.has(d.storeId))
      : distributors;

    if (targetDistributors.length === 0) {
      isSendingBatchRef.current = false;
      setIsSendingBatchWhatsApp(false);
      toastEvent.trigger('No distributors selected to order.', 'error');
      return;
    }

    const mapped = targetDistributors.filter(d => isDistributorMapped(d));
    const unmapped = targetDistributors.filter(d => !isDistributorMapped(d));

    // Block the batch only if any SELECTED unsent store fails its ordering limits
    const belowLimit = targetDistributors.filter(d => sentWaStatusMap[d.storeId] !== 'success' && getOrderLimitIssues(d, isItemIncludedInDispatch).length > 0);
    if (belowLimit.length > 0) {
      isSendingBatchRef.current = false;
      setIsSendingBatchWhatsApp(false);
      toastEvent.trigger(`Send blocked for selected stores — fix these first: ${belowLimit.flatMap(d => getOrderLimitIssues(d, isItemIncludedInDispatch)).join(' | ')}`, 'error');
      return;
    }

    if (unmapped.length > 0) {
      isSendingBatchRef.current = false;
      setIsSendingBatchWhatsApp(false);
      pendingMissingContactDistributorsRef.current = unmapped;
      const firstMissing = unmapped[0];
      toastEvent.trigger(
        `⚠️ Missing 10-digit contact for ${firstMissing.storeName} (${unmapped.length} distributor${unmapped.length > 1 ? 's' : ''} remaining). Please save mobile number before placing orders.`,
        'info'
      );
      handleOpenEditModal(firstMissing);
      return;
    }

    try {
      // Resolve primary delivery boy FIRST — re-fetch live to avoid stale React state closure
      let liveBoys = deliveryBoysList;
      if (liveBoys.length === 0) {
        try {
          const freshRes = await apiClient.get('/dispatch/delivery-boys');
          if (Array.isArray(freshRes.data)) {
            liveBoys = freshRes.data.filter((b: LocalDeliveryBoyRow) => b.is_active !== 0);
            setDeliveryBoysList(liveBoys);
          }
        } catch (_) { }
      }
      const primaryBoy = liveBoys.find(b => b.name && b.whatsapp_number && b.whatsapp_number.trim().length > 0);
      const deliveryBoyPhone = primaryBoy?.whatsapp_number || storeInfo.deliveryBoyPhone || storeInfo.adminPhone || '';
      const deliveryBoyName = primaryBoy?.name || 'Delivery Staff';

      const ordersPayload: { storeName: string; storeId: number; phone: string; message: string; lineTotal?: number; items: CartLineItem[]; deliveryBoyId?: number | null; deliveryBoyName?: string; deliveryBoyPhone?: string }[] = [];

      for (const dist of mapped) {
        const itemsForBatch = dist.items.filter(item => isItemIncludedInDispatch(item, dist));
        if (itemsForBatch.length === 0) {
          toastEvent.trigger(`Skipped ${dist.storeName}: No items selected.`, 'info');
          continue;
        }

        const phoneNum = getDistributorPhoneNumber(dist);
        const cleanPhone = toWaDigits(phoneNum);
        if (!cleanPhone || !isValidPhoneNumber(cleanPhone)) {
          setSentWaStatusMap(prev => ({ ...prev, [dist.storeId]: 'error' }));
          toastEvent.trigger(`Skipped ${dist.storeName}: Invalid phone number "${phoneNum || 'missing'}"`, 'error');
          continue;
        }

        const effectiveBoyMap = customDeliveryBoys || selectedBatchDeliveryBoys;
        const assignedBoyId = effectiveBoyMap[dist.storeId];
        let assignedBoy: { id?: number; name: string; whatsapp_number: string } | null = null;
        if (assignedBoyId === 0) {
          assignedBoy = {
            id: 0,
            name: 'Admin / Store Owner',
            whatsapp_number: storeInfo.adminPhone || storeInfo.phone || ''
          };
        } else if (assignedBoyId) {
          assignedBoy = liveBoys.find(b => b.id === assignedBoyId) ?? null;
        }

        // Persist distributor mapping choice if selected in batch modal so system remembers next time
        if (assignedBoyId !== undefined && assignedBoyId !== null) {
          apiClient.post('/pharmarack/distributor-mappings', {
            store_name: dist.storeName,
            delivery_boy_id: assignedBoyId
          }).catch(() => { });
        }

        const msg = buildDistributorOrderMessage(dist, assignedBoy);
        ordersPayload.push({
          storeName: dist.storeName,
          storeId: dist.storeId,
          phone: cleanPhone,
          message: msg,
          lineTotal: itemsForBatch.reduce((sum, item) => sum + (item.ptr > 0 ? item.ptr * item.qty : item.amount), 0),
          items: itemsForBatch,
          deliveryBoyId: assignedBoy?.id ?? null,
          deliveryBoyName: assignedBoy?.name,
          deliveryBoyPhone: assignedBoy?.whatsapp_number
        });
      }

      if (ordersPayload.length === 0) {
        toastEvent.trigger('No valid distributor phone numbers found to enqueue.', 'error');
        return;
      }

      // 1. PLACE OFFICIAL ORDERS DIRECTLY ON PHARMARACK & QUEUE CLEAN DISPATCH
      messageSendEvent.triggerSendProgress('Pharmarack Batch Orders', `Executing paced order placement (notifying delivery staff, processing cart, capturing Order IDs)...`, 20);
      const res = await api.placeOfficialPharmarackOrders({
        targetStoreNames: mapped.map(d => d.storeName),
        orders: ordersPayload,
        deliveryBoyPhone,
        deliveryBoyName,
        storeInfo,
        bypassShortfallCheck: false
      });

      if (res && res.success) {
        const batchTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastBatchSentTime(batchTimeStr);
        try { localStorage.setItem('pharmarack_last_batch_sent_time', batchTimeStr); } catch (_) { }

        // Mark all mapped distributors as queued in local status map
        const statusUpdates: Record<number, 'queued'> = {};
        mapped.forEach(d => {
          statusUpdates[d.storeId] = 'queued';
        });

        setSentWaStatusMap(prev => ({ ...prev, ...statusUpdates }));

        setHasUnreadSentHistory(true);
        specialOrdersEvent.triggerUpdated();
        whatsappQueueEvent.triggerUpdated();
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));
        window.dispatchEvent(new CustomEvent('sse-dispatch-updated'));

        toastEvent.trigger(
          `⚡ Official orders placed on Pharmarack (${res.placedCount} placed)! Delivery staff notified & confirmed Order IDs shared with distributors.`,
          'info'
        );

        // Resume UI immediately without waiting for background data refreshes
        isSendingBatchRef.current = false;
        setIsSendingBatchWhatsApp(false);

        // Refresh live cart so newly placed orders disappear from the cart page
        fetchCart(false);

        // Refresh orders and sent dates asynchronously in background without blocking UI
        Promise.allSettled([
          fetchPendingOrders(),
          fetchLatestSentMap(),
          loadSentDates()
        ]).catch(() => { });
      } else {
        throw new Error(res?.error || res?.message || 'Failed to place official orders on Pharmarack');
      }

      if (unmapped.length > 0) {
        toastEvent.trigger(`⚠️ ${unmapped.length} supplier(s) missing WhatsApp numbers. Opening editor for ${unmapped[0].storeName}...`, 'info');
        handleOpenEditModal(unmapped[0]);
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      console.warn('Batch WhatsApp send error:', err);

      // Truthful verify-before-fallback check: check if orders were actually placed on Pharmarack
      try {
        const verifyRes = await api.syncPharmarackPostCheckout({
          targetStoreNames: mapped.map(m => m.storeName),
          targetStoreIds: mapped.map(m => m.storeId)
        });

        const targetNames = mapped.map(m => m.storeName.toLowerCase().trim());
        const reallySynced = (verifyRes?.orders || []).filter(o => {
          const sName = (o.store_name || '').toLowerCase().trim();
          return targetNames.some(tn => tn.includes(sName) || sName.includes(tn));
        });

        const isCartEmptyForTargets = verifyRes?.cartEmptyForTargets ?? (
          !verifyRes?.remaining || verifyRes.remaining.length === 0
        );

        if (isCartEmptyForTargets && reallySynced.length > 0) {
          // Success! Orders were placed on Pharmarack and cart was cleared.
          const orderNumbersStr = reallySynced.map(o => `#${o.order_no}`).join(', ');
          toastEvent.trigger(
            `✅ Official order(s) placed on Pharmarack (${orderNumbersStr})! Cart is clear. Delivery staff notified & confirmed Order IDs shared.`,
            'info'
          );

          const batchTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setLastBatchSentTime(batchTimeStr);
          try { localStorage.setItem('pharmarack_last_batch_sent_time', batchTimeStr); } catch (_) { }

          const statusUpdates: Record<number, 'queued'> = {};
          mapped.forEach(d => { statusUpdates[d.storeId] = 'queued'; });
          setSentWaStatusMap(prev => ({ ...prev, ...statusUpdates }));

          setHasUnreadSentHistory(true);
          specialOrdersEvent.triggerUpdated();
          whatsappQueueEvent.triggerUpdated();
          window.dispatchEvent(new CustomEvent('refresh-special-orders'));
          window.dispatchEvent(new CustomEvent('sse-dispatch-updated'));

          fetchCart(false);
          Promise.allSettled([
            fetchPendingOrders(),
            fetchLatestSentMap(),
            loadSentDates()
          ]).catch(() => { });

          return; // DO NOT OPEN FALLBACK WINDOW!
        }

        if (verifyRes?.remaining && verifyRes.remaining.length > 0) {
          // Leftovers remain in the cart for target stores.
          fetchCart(false);
          toastEvent.trigger(
            `⚠️ Some items remained unplaced in live cart (${verifyRes.remainingCount || verifyRes.remaining.length} items). Opening live cart window for remaining items...`,
            'error'
          );
          api.openOfficialPharmarackCartWindow().catch(() => {});
          waitingForManualOrderSyncRef.current = true;
          return;
        }
      } catch (verifyErr) {
        console.warn('[PharmarackCart] Verify-before-fallback failed, proceeding to standard fallback:', verifyErr);
      }

      toastEvent.trigger(apiErr?.message || 'Automated placement encountered an issue. Opening live cart window...', 'error');

      // Fallback: If automated order placement encounters an issue, provide direct access to authenticated cart window
      try {
        api.openOfficialPharmarackCartWindow().catch(() => {});
        waitingForManualOrderSyncRef.current = true;
        toastEvent.trigger('Opened live cart window for 1-click manual verification / completion.', 'info');
      } catch (tabErr) {
        console.warn('Tab fallback error:', tabErr);
      }
    } finally {
      isSendingBatchRef.current = false;
      setIsSendingBatchWhatsApp(false);
    }
  };

  const handleOpenEditModal = (dist: Distributor) => {
    setEditingDistributor(dist);
    setIsSavingContact(false);
    setPhoneDuplicateWarning(null);
    setCheckingPhoneDuplicate(false);
    setDuplicateConfirmNotice(null);
    setModalSearchTerm(dist.storeName || '');
    setIsAddingNewDistributor(false);
    setNewDistNameInput(dist.storeName || '');
    setOverwriteDistributorName(true);

    const normName = dist.storeName ? dist.storeName.toLowerCase().trim() : '';
    const storedMap = distributorMappings[normName];

    if (storedMap && storedMap.distributorId) {
      setSelectedSavedDistId(storedMap.distributorId);
      setModalPhoneInput(storedMap.phone || '');
    } else {
      const custom = customDistributorPhones[dist.storeId];
      const matched = findSavedDistributorMatch(dist.storeName);

      if (custom) {
        setModalPhoneInput(custom);
        setSelectedSavedDistId(matched?.id || null);
      } else if (matched?.phone || matched?.mobile || matched?.whatsapp) {
        setModalPhoneInput(matched.phone || matched.mobile || matched.whatsapp || '');
        setSelectedSavedDistId(matched.id as number | null);
      } else {
        setModalPhoneInput('');
        setSelectedSavedDistId(null);
      }
    }

    const matchedDist = findSavedDistributorMatch(dist.storeName);
    const currentBoyId = (storedMap?.deliveryBoyId !== undefined && storedMap?.deliveryBoyId !== null)
      ? storedMap.deliveryBoyId
      : ((matchedDist?.delivery_boy_id !== undefined && matchedDist?.delivery_boy_id !== null)
        ? matchedDist.delivery_boy_id
        : (dist.deliveryPersons && dist.deliveryPersons.length > 0
          ? deliveryBoysList.find(b => b.name && b.name.toLowerCase().includes(dist.deliveryPersons[0].name.toLowerCase()))?.id ?? null
          : null));
    setModalDeliveryBoyId(currentBoyId);
  };

  const handleSaveDistributorContact = async (bypassDuplicateCheck = false) => {
    if (!editingDistributor || isSavingContact) return;
    const rawInput = modalPhoneInput.trim();
    let cleanPhone = rawInput.replace(/\D/g, '');
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      cleanPhone = cleanPhone.slice(2);
    } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.slice(1);
    }

    if (cleanPhone.length !== 10 || !isValidPhoneNumber(cleanPhone)) {
      toastEvent.trigger('Please enter a valid 10-digit mobile number (starts with 6, 7, 8, or 9).', 'error');
      return;
    }

    if (!bypassDuplicateCheck) {
      try {
        const dupCheck = await api.checkDuplicateDistributorPhone(
          cleanPhone,
          selectedSavedDistId || undefined,
          editingDistributor.storeName || undefined
        );
        if (dupCheck.isDuplicate) {
          const warnMsg = dupCheck.message || 'This phone number is already assigned.';
          setPhoneDuplicateWarning(warnMsg);
          setDuplicateConfirmNotice({ message: warnMsg, cleanPhone });
          return;
        }
      } catch (err) {
        console.warn('Duplicate check warning:', err);
      }
    }

    setDuplicateConfirmNotice(null);
    setIsSavingContact(true);

    const wasInBatchQueue = pendingMissingContactDistributorsRef.current.length > 0;
    const storeId = editingDistributor.storeId;
    const distName = editingDistributor.storeName;
    const distSnapshot = editingDistributor;

    // 1. Immediately update UI state & close modal for instant zero-latency feedback
    setCustomDistributorPhones(prev => ({
      ...prev,
      [storeId]: cleanPhone
    }));
    if (distName) {
      const normName = distName.toLowerCase().trim();
      setDistributorMappings(prev => ({
        ...prev,
        [normName]: {
          distributorId: selectedSavedDistId,
          phone: cleanPhone,
          deliveryBoyId: modalDeliveryBoyId ?? null
        }
      }));
    }
    toastEvent.trigger(`Saved WhatsApp contact for ${distName}`, 'success');
    setEditingDistributor(null);
    setIsSavingContact(false);

    // If part of batch setup queue, advance sequentially or open final modal
    if (wasInBatchQueue) {
      const nextRemaining = pendingMissingContactDistributorsRef.current.filter(d => {
        if (d.storeId === storeId) return false;
        const curPhone = customDistributorPhones[d.storeId] || getDistributorPhoneNumber(d);
        return !isValidPhoneNumber((curPhone || '').replace(/\D/g, ''));
      });
      pendingMissingContactDistributorsRef.current = nextRemaining;

      if (nextRemaining.length > 0) {
        const nextDist = nextRemaining[0];
        toastEvent.trigger(
          `✅ Saved for ${distName}. Next: Please save 10-digit contact for ${nextDist.storeName} (${nextRemaining.length} remaining).`,
          'info'
        );
        setTimeout(() => {
          handleOpenEditModal(nextDist);
        }, 150);
      } else {
        toastEvent.trigger('✅ All distributor contacts saved! Opening final order confirmation...', 'success');
        setTimeout(() => {
          handleOpenConfirmBatchModal();
        }, 200);
      }
    }

    // 2. Persist to database in background
    try {
      let targetDistId = selectedSavedDistId;

      if (isAddingNewDistributor && newDistNameInput.trim()) {
        // User clicked '+' to create a brand new distributor in AI Learning DB
        const createRes = await apiClient.post('/distributors', {
          name: newDistNameInput.trim(),
          phone: cleanPhone
        });
        if (createRes.data && createRes.data.id) {
          targetDistId = createRes.data.id;
        }
      } else if (selectedSavedDistId) {
        // Updating an existing selected distributor from directory
        const foundSaved = savedDistributorsList.find((d) => d.id === selectedSavedDistId);
        const targetName = (overwriteDistributorName && distName) ? distName : (foundSaved?.name || distName);
        try {
          const updateRes = await apiClient.put(`/distributors/${selectedSavedDistId}`, {
            name: targetName,
            phone: cleanPhone
          });
          if (updateRes.data && updateRes.data.id) {
            targetDistId = updateRes.data.id;
          }
        } catch (e) {
          console.warn('PUT distributor by ID failed, falling back to post upsert:', e);
          const fallbackRes = await apiClient.post('/distributors', {
            name: targetName,
            phone: cleanPhone
          });
          if (fallbackRes.data && fallbackRes.data.id) {
            targetDistId = fallbackRes.data.id;
          }
        }
        if (overwriteDistributorName && distName) {
          setSavedDistributorsList(prev => prev.map(d => d.id === selectedSavedDistId ? { ...d, name: distName } : d));
        }
      } else if (cleanPhone) {
        // Direct mobile number without directory selection -> create/upsert distributor for this store
        const createRes = await apiClient.post('/distributors', {
          name: distName,
          phone: cleanPhone
        });
        if (createRes.data && createRes.data.id) {
          targetDistId = createRes.data.id;
        }
      }

      // Save persistent store-to-distributor mapping in SQLite
      if (distName) {
        await apiClient.post('/pharmarack/distributor-mappings', {
          store_name: distName,
          distributor_id: targetDistId || null,
          phone: cleanPhone,
          delivery_boy_id: modalDeliveryBoyId ?? null,
          overwrite_distributor_name: overwriteDistributorName
        });
      }

      // Save to unified contacts master table
      try {
        await api.saveContact({
          name: isAddingNewDistributor && newDistNameInput.trim() ? newDistNameInput.trim() : distName,
          type: 'distributor',
          phone: cleanPhone
        });
      } catch (_) { }

      await broadcastContactDataChanged();

      // Dispatch refresh so topbar countdown & header pill update immediately
      window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));

      // 3. Auto-enqueue order WhatsApp directly to this newly added distributor only (skip if in batch setup queue)
      if (!wasInBatchQueue && cleanPhone && cleanPhone.replace(/\D/g, '').length >= 10 && distSnapshot && distSnapshot.items && distSnapshot.items.length > 0) {
        try {
          const itemsToSend = distSnapshot.items.filter(item => isItemIncludedInDispatch(item, distSnapshot));
          if (itemsToSend.length > 0) {
            messageSendEvent.triggerSendProgress(distName, `Dispatching order to ${distName}...`, 10);
            const msg = buildDistributorOrderMessage({ ...distSnapshot, storeName: distName });
            await apiClient.post('/messaging/enqueue-single-distributor-order', {
              storeId: distSnapshot.storeId,
              storeName: distName,
              phone: cleanPhone,
              message: msg,
              items: itemsToSend
            });
            setSentWaStatusMap(prev => ({ ...prev, [distSnapshot.storeId]: 'queued' }));
            toastEvent.trigger(`⚡ WhatsApp order automatically queued for ${distName}!`, 'success');
            whatsappQueueEvent.triggerUpdated();
            window.dispatchEvent(new CustomEvent('sse-dispatch-updated'));
          }
        } catch (enqueueErr) {
          console.warn('Auto-enqueue for newly saved distributor failed:', enqueueErr);
        }
      }
    } catch (err: unknown) {
      console.warn('Background save distributor contact error:', err);
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleInlineSavePhone = async (dist: Distributor) => {
    const rawExisting = (getDistributorPhoneNumber(dist) || '').replace(/\D/g, '').slice(-10);
    const rawVal = inlinePhones[dist.storeId] !== undefined ? inlinePhones[dist.storeId] : rawExisting;
    const cleanPhone = (rawVal || '').replace(/\D/g, '');
    if (!isValidPhoneNumber(cleanPhone)) {
      toastEvent.trigger('Please enter a valid 10-digit mobile number (starts with 6, 7, 8, or 9)', 'error');
      return;
    }
    if (inlineSavingStoreId === dist.storeId) return;
    setInlineSavingStoreId(dist.storeId);

    const distName = dist.storeName;
    const storeId = dist.storeId;

    // 1. Immediately update UI state for instant zero-latency feedback
    setCustomDistributorPhones(prev => ({
      ...prev,
      [storeId]: cleanPhone
    }));
    if (distName) {
      const normName = distName.toLowerCase().trim();
      setDistributorMappings(prev => ({
        ...prev,
        [normName]: {
          distributorId: null,
          phone: cleanPhone
        }
      }));
    }
    setSessionResolvedCount(prev => prev + 1);
    toastEvent.trigger(`✓ Saved WhatsApp contact for ${distName}`, 'success');

    // 2. Persist to database in background
    try {
      let targetDistId: number | null = null;
      const matched = findSavedDistributorMatch(distName);
      if (matched?.id) {
        targetDistId = matched.id;
        try {
          await apiClient.put(`/distributors/${matched.id}`, {
            name: matched.name || distName,
            phone: cleanPhone
          });
        } catch (_) {
          await apiClient.post('/distributors', {
            name: matched.name || distName,
            phone: cleanPhone
          });
        }
      } else {
        const createRes = await apiClient.post('/distributors', {
          name: distName,
          phone: cleanPhone
        });
        if (createRes?.data?.id) {
          targetDistId = createRes.data.id;
        }
      }

      // Save persistent store-to-distributor mapping in SQLite
      if (distName) {
        await apiClient.post('/pharmarack/distributor-mappings', {
          store_name: distName,
          distributor_id: targetDistId || null,
          phone: cleanPhone
        });
      }

      // Save to unified contacts master table
      try {
        await api.saveContact({
          name: distName,
          type: 'distributor',
          phone: cleanPhone
        });
      } catch (_) { }

      await broadcastContactDataChanged();

      // Dispatch refresh so topbar countdown & cache update
      window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));

      // If batch setup queue was active, advance queue
      if (pendingMissingContactDistributorsRef.current.length > 0) {
        const nextRemaining = pendingMissingContactDistributorsRef.current.filter(d => {
          if (d.storeId === storeId) return false;
          const curPhone = customDistributorPhones[d.storeId] || getDistributorPhoneNumber(d);
          return !isValidPhoneNumber((curPhone || '').replace(/\D/g, ''));
        });
        pendingMissingContactDistributorsRef.current = nextRemaining;
        if (nextRemaining.length === 0) {
          toastEvent.trigger('✅ All distributor contacts saved! Opening final order confirmation...', 'success');
          setTimeout(() => {
            handleOpenConfirmBatchModal();
          }, 200);
        }
      }
    } catch (err) {
      console.error('Failed to persist distributor contact inline:', err);
      toastEvent.trigger('Failed to persist contact to database', 'error');
    } finally {
      setInlineSavingStoreId(null);
    }
  };

  const fetchPriceHistories = async (currDistributors: Distributor[]) => {
    const uniqueNames = Array.from(
      new Set(currDistributors.flatMap(d => d.items.map(it => it.productName)))
    ).filter(Boolean);

    setPriceHistoryCache(prevCache => {
      const namesToFetch = uniqueNames.filter(name => !prevCache[name]);
      if (namesToFetch.length > 0) {
        // Firing one request per unique cart item at once can burst into 15-20+ parallel
        // calls; each is a potentially expensive fuzzy-match lookup on the backend, and
        // piling them up on Node's single thread stalls the whole app, not just this page.
        // Throttle to a small concurrency window instead of Promise.all-ing everything.
        const CONCURRENCY = 4;
        const results: Array<{ name: string; data: LocalPriceHistoryRow[] }> = [];
        let nextIndex = 0;
        const worker = async () => {
          while (nextIndex < namesToFetch.length) {
            const name = namesToFetch[nextIndex++];
            try {
              const res = await api.getMedicinePriceHistory(name);
              results.push({ name, data: res?.data || [] });
            } catch (_e) {
              results.push({ name, data: [] });
            }
          }
        };
        Promise.all(Array.from({ length: Math.min(CONCURRENCY, namesToFetch.length) }, worker)).then(() => {
          setPriceHistoryCache(current => {
            const next = { ...current };
            results.forEach(r => {
              next[r.name] = r.data;
            });
            cachedPriceHistory = next;
            persistCartCache(cachedDistributors, next);
            return next;
          });
        });
      }
      return prevCache;
    });
  };

  const getDuplicateItemInCart = (currentItem: CartLineItem) => {
    const normName = currentItem.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const dist of distributors) {
      if (dist.storeId === currentItem.storeId) continue;
      for (const it of dist.items) {
        const itNormName = it.productName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normName === itNormName && Math.abs(currentItem.mrp - it.mrp) < 0.01) {
          return {
            storeName: dist.storeName,
            qty: it.qty
          };
        }
      }
    }
    return null;
  };

  const normalizeItemsWithCheckStatus = (
    rawList: Distributor[],
    overrides: Record<string, boolean> = userCheckOverridesRef.current
  ): Distributor[] => {
    return rawList.map(dist => {
      const updatedItems = (dist.items || []).map(item => {
        const key = getItemCheckKey(dist.storeId, item);
        // 1. User manual override has highest priority!
        if (typeof overrides[key] === 'boolean') {
          return { ...item, isChecked: overrides[key] };
        }

        // 2. Default logic:
        const pastInfo = getPastOrderedInfo(item, dist);
        // Default to false (unchecked) if ordered today (already sent) or ordered yesterday (reorder needed)
        // Default to true (checked) if genuinely fresh / newly added item
        const defaultChecked = !pastInfo.isPastOrdered;
        return {
          ...item,
          isChecked: defaultChecked
        };
      });

      return {
        ...dist,
        items: updatedItems
      };
    });
  };

  const applyCartDiff = (
    current: Distributor[],
    incoming: Distributor[],
    overrides: Record<string, boolean> = userCheckOverridesRef.current
  ): Distributor[] => {
    const normalizedIncoming = normalizeItemsWithCheckStatus(incoming, overrides);

    // Safeguard: Never restore items that are currently pending deletion in background
    const filteredIncoming = normalizedIncoming.map(dist => ({
      ...dist,
      items: dist.items.filter(it => !pendingDeleteKeysRef.current.has(getItemCheckKey(dist.storeId, it)) && !globalPendingDeleteKeys.has(getItemCheckKey(dist.storeId, it)))
    })).filter(dist => dist.items.length > 0);

    const currentItemMap = new Map<string, CartLineItem>();
    for (const d of current) {
      for (const it of d.items) {
        currentItemMap.set(getItemCheckKey(d.storeId, it), it);
      }
    }

    const merged = filteredIncoming.map(dist => {
      const mergedItems = dist.items.map(incItem => {
        const key = getItemCheckKey(dist.storeId, incItem);
        // Safeguard: If user recently changed quantity within last 4 seconds, preserve optimistic quantity
        const pendingQty = pendingQtyMapRef.current.get(key);
        if (pendingQty && Date.now() - pendingQty.timestamp < 4000) {
          incItem = {
            ...incItem,
            qty: pendingQty.qty,
            amount: (incItem.ptr || 0) * pendingQty.qty
          };
        }

        const existing = currentItemMap.get(key);
        if (
          existing &&
          existing.qty === incItem.qty &&
          existing.ptr === incItem.ptr &&
          existing.amount === incItem.amount &&
          existing.isChecked === incItem.isChecked &&
          existing.productName === incItem.productName &&
          existing.productCode === incItem.productCode &&
          existing.productId === incItem.productId
        ) {
          return existing;
        }
        return incItem;
      });

      const sortedItems = [...mergedItems].sort((a, b) =>
        (a.productName || '').localeCompare(b.productName || '', undefined, { sensitivity: 'base' })
      );

      const computedLineTotal = sortedItems.reduce((sum, item) => {
        const amt = typeof item.amount === 'number' && item.amount > 0 ? item.amount : ((item.ptr || 0) * (item.qty || 1));
        return sum + amt;
      }, 0);

      return {
        ...dist,
        lineTotal: Math.max(dist.lineTotal || 0, computedLineTotal),
        items: sortedItems
      };
    });

    return merged.sort((a, b) =>
      (a.storeName || '').localeCompare(b.storeName || '', undefined, { sensitivity: 'base' })
    );
  };

  const cartSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleCartSync = (delayMs = 1500) => {
    if (cartSyncTimerRef.current) {
      clearTimeout(cartSyncTimerRef.current);
    }
    cartSyncTimerRef.current = setTimeout(() => {
      fetchCartSilent();
    }, delayMs);
  };

  const checkSession = useCallback(async () => {
    try {
      const data = await api.checkPharmarackSession();
      if (typeof data.daysLeft === 'number') {
        setSessionDaysLeft(data.daysLeft);
      }
      if (data.healthy) {
        setSessionStatus('active');
      } else if (data.isRefreshing) {
        setSessionStatus('restoring');
      } else if (data.reason === 'NETWORK_ERROR' || data.reason === 'SERVER_ERROR') {
        setSessionStatus('connection_issue');
      } else {
        setSessionStatus('expired');
      }
    } catch {
      setSessionStatus('connection_issue');
    }
  }, []);

  const handleReconnect = useCallback(async () => {
    try {
      toastEvent.trigger('Opening Pharmarack Login window...', 'info');
      await api.launchPharmarackLoginWindow();
      setSessionStatus('restoring');
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      toastEvent.trigger(apiErr?.response?.data?.error || 'Failed to launch login window', 'error');
    }
  }, []);

  const fetchCart = async (forceFresh?: unknown) => {
    const isFresh = forceFresh === true;
    // Only show loading spinner on cold cache (first visit)
    if (cachedDistributors.length === 0) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await (apiClient.get(`/pharmarack/cart${isFresh ? '?fresh=true' : ''}`).then(res => res.data));
      if (data && data.success) {
        setIsCartFromCache(Boolean(data.cached));
        if (!data.cached) {
          setSessionStatus('active');
        }
        const rawList = data.distributors || [];
        setDistributors(prev => {
          const list = applyCartDiff(prev, rawList, userCheckOverridesRef.current);
          cachedDistributors = list;
          persistCartCache(list, cachedPriceHistory);
          return list;
        });

        // Clean up confirmed deleted keys if verified absent from incoming live cart and queue is idle
        if (deleteQueueRef.current.length === 0 && pendingDeleteKeysRef.current.size > 0) {
          const liveKeys = new Set<string>();
          rawList.forEach((d: any) => {
            (d.items || []).forEach((it: any) => {
              liveKeys.add(getItemCheckKey(d.storeId, it));
            });
          });
          for (const k of Array.from(pendingDeleteKeysRef.current)) {
            if (!liveKeys.has(k)) {
              pendingDeleteKeysRef.current.delete(k);
              globalPendingDeleteKeys.delete(k);
            }
          }
        }
        const now = new Date();
        setLastFetched(now);
        cachedLastFetched = now;
        setTimeout(() => {
          fetchPriceHistories(rawList);
          fetchLatestSentMap();
        }, 0);
      } else {
        setError('Failed to retrieve cart details.');
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      console.error('Failed to fetch Pharmarack cart:', err);
      if (cachedDistributors.length > 0) {
        setIsCartFromCache(true);
      }
      setError(apiErr?.response?.data?.error || 'Failed to fetch cart. Please check server logs or verify your session.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchCart(true);
      await checkSession();
      await new Promise(r => setTimeout(r, 600));
    } finally {
      setIsRefreshing(false);
    }
  };

  const fetchCartSilent = async () => {
    // If user is currently updating an item quantity, postpone silent sync to prevent race conditions
    if (updatingItemId || highPriorityActiveRef.current) {
      scheduleCartSync(2000);
      return;
    }
    try {
      const data = await api.getPharmarackCart();
      if (data && data.success) {
        setIsCartFromCache(false);
        if (data.reconciledItems && Array.isArray(data.reconciledItems) && data.reconciledItems.length > 0) {
          setAutoReconciledItems(data.reconciledItems);
        }
        const rawList = data.distributors || [];
        setDistributors(prev => {
          const list = applyCartDiff(prev, rawList, userCheckOverridesRef.current);
          cachedDistributors = list;
          persistCartCache(list, cachedPriceHistory);
          return list;
        });

        if (deleteQueueRef.current.length === 0 && pendingDeleteKeysRef.current.size > 0) {
          const liveKeys = new Set<string>();
          rawList.forEach((d: any) => {
            (d.items || []).forEach((it: any) => {
              liveKeys.add(getItemCheckKey(d.storeId, it));
            });
          });
          for (const k of Array.from(pendingDeleteKeysRef.current)) {
            if (!liveKeys.has(k)) {
              pendingDeleteKeysRef.current.delete(k);
              globalPendingDeleteKeys.delete(k);
            }
          }
        }
        const now = new Date();
        setLastFetched(now);
        cachedLastFetched = now;
        setTimeout(() => {
          fetchPriceHistories(rawList);
        }, 0);
      }
    } catch (err) {
      console.error('Failed silent cart refresh:', err);
      if (cachedDistributors.length > 0) {
        setIsCartFromCache(true);
      }
    }
  };

  const handleUpdateQty = async (item: CartLineItem, newQty: number) => {
    if (newQty < 1) {
      handleDeleteItem(item);
      return;
    }

    // Cancel pending delete if user is adjusting quantity on this medicine
    const itemKey = getItemCheckKey(item.storeId, item);
    if (pendingDeleteKeysRef.current.has(itemKey) || globalPendingDeleteKeys.has(itemKey)) {
      pendingDeleteKeysRef.current.delete(itemKey);
      globalPendingDeleteKeys.delete(itemKey);
      deleteQueueRef.current = deleteQueueRef.current.filter(q => q.key !== itemKey);
      globalDeleteQueue = globalDeleteQueue.filter(q => q.key !== itemKey);
    }

    // 1. Optimistic UI Update (< 5ms perception, instant response)
    setDistributors(prev => {
      const updated = prev.map(dist => {
        if (dist.storeId !== item.storeId) return dist;

        const updatedItems = dist.items.map(i => {
          if (i.productCode !== item.productCode) return i;
          const rateVal = i.ptr || 0;
          return {
            ...i,
            qty: newQty,
            amount: rateVal * newQty
          };
        });

        return {
          ...dist,
          items: updatedItems,
          lineTotal: updatedItems.reduce((sum, it) => sum + it.amount, 0)
        };
      });
      cachedDistributors = updated;
      persistCartCache(updated, cachedPriceHistory);
      return updated;
    });

    setUpdatingItemId(item.productCode);
    beginHighPriorityAction(); // Priority lock: pause background delete worker immediately

    // Track recently updated quantities so background syncs within settling period cannot revert this edit
    const updateTs = Date.now();
    pendingQtyMapRef.current.set(itemKey, { qty: newQty, timestamp: updateTs });

    // 2. High Priority Background API Sync
    try {
      const storeName = distributors.find(d => d.storeId === item.storeId)?.storeName || '';
      const payload = [{
        productId: item.productId || 0,
        storeId: item.storeId,
        qty: newQty,
        productCode: item.productCode,
        productName: item.productName,
        company: item.company,
        packaging: item.packaging,
        rate: item.ptr,
        mrp: item.mrp,
        storeName: storeName,
        mapped: true,
        isUpdate: true,
        mode: 'set'
      }];

      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        toastEvent.trigger('Quantity updated in Pharmarack live cart', 'success');
        scheduleCartSync(1500);
      } else {
        toastEvent.trigger(res?.error || 'Failed to update quantity on Pharmarack', 'error');
        scheduleCartSync(500);
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      console.error('Failed to update quantity:', err);
      toastEvent.trigger(apiErr?.response?.data?.error || 'Failed to update quantity', 'error');
      scheduleCartSync(500);
    } finally {
      setUpdatingItemId(null);
      endHighPriorityAction(); // Release priority lock: allow background delete worker to resume
      setTimeout(() => {
        if (pendingQtyMapRef.current.get(itemKey)?.timestamp === updateTs) {
          pendingQtyMapRef.current.delete(itemKey);
        }
      }, 3000);
    }
  };

  const processDeleteQueue = async () => {
    if (isProcessingDeleteQueueRef.current || globalIsProcessingDeleteQueue) return;
    isProcessingDeleteQueueRef.current = true;
    globalIsProcessingDeleteQueue = true;

    try {
      while (deleteQueueRef.current.length > 0) {
        // 1. Yield immediately if a high-priority operation (Add product / Qty update) is in flight
        await waitIfHighPriority();

        if (deleteQueueRef.current.length === 0) break;
        const currentTask = deleteQueueRef.current[0];

        // 2. Perform live deletion attempt
        let isSuccess = false;
        let errorMsg = '';
        try {
          const res = await api.deletePharmarackCartItem({
            storeId: currentTask.item.storeId,
            productId: currentTask.item.productId,
            productCode: currentTask.item.productCode,
            productName: currentTask.item.productName,
            company: currentTask.item.company,
            packaging: currentTask.item.packaging,
            ptr: currentTask.item.ptr,
            mrp: currentTask.item.mrp,
            storeName: currentTask.storeName
          });
          if (res && res.success) {
            isSuccess = true;
          } else {
            errorMsg = res?.error || 'Server reported failure';
          }
        } catch (err: unknown) {
          const apiErr = err as LocalApiError;
          errorMsg = apiErr?.response?.data?.error || apiErr?.message || 'Network error';
        }

        // 3. Handle result & 3-try incremental retry loop (+2s per retry)
        if (isSuccess) {
          // Success: remove item from queue
          deleteQueueRef.current.shift();
          toastEvent.trigger(`Removed "${currentTask.item.productName}" from live cart`, 'success');

          // If more items remain in queue, wait the base buffer before next request
          if (deleteQueueRef.current.length > 0) {
            await interruptibleSleep(PHARMARACK_DELETE_BUFFER_MS);
          }
        } else {
          // Failure: check retry count (max 3 tries)
          if (currentTask.attempt < PHARMARACK_DELETE_MAX_RETRIES) {
            const nextAttempt = currentTask.attempt + 1;
            currentTask.attempt = nextAttempt;
            const retryDelayMs = PHARMARACK_DELETE_BUFFER_MS + ((nextAttempt - 1) * PHARMARACK_DELETE_RETRY_STEP_MS);

            toastEvent.trigger(
              `Retrying removal of "${currentTask.item.productName}" (Attempt ${nextAttempt} of ${PHARMARACK_DELETE_MAX_RETRIES} in ${Math.round(retryDelayMs / 1000)}s)...`,
              'info'
            );

            // Wait backoff time (1.8s, 2.8s), yielding immediately if user performs a high-priority action
            await interruptibleSleep(retryDelayMs);
          } else {
            // All 3 tries exhausted
            deleteQueueRef.current.shift();
            pendingDeleteKeysRef.current.delete(currentTask.key);
            globalPendingDeleteKeys.delete(currentTask.key);
            toastEvent.trigger(
              `Could not remove "${currentTask.item.productName}" from live cart after ${PHARMARACK_DELETE_MAX_RETRIES} attempts. (${errorMsg})`,
              'error'
            );
          }
        }
      }
    } finally {
      isProcessingDeleteQueueRef.current = false;
      globalIsProcessingDeleteQueue = false;
      // When the entire queue finishes, trigger a silent verified sync to ensure state accuracy
      scheduleCartSync(1000);
    }
  };

  const handleDeleteItem = async (item: CartLineItem) => {
    const itemKey = getItemCheckKey(item.storeId, item);
    pendingDeleteKeysRef.current.add(itemKey);
    globalPendingDeleteKeys.add(itemKey);

    // 1. Optimistic UI update (immediately remove item from UI state & update totals in < 5ms)
    setDistributors(prev => {
      const updated = prev.map(dist => {
        if (dist.storeId !== item.storeId) return dist;
        const remainingItems = dist.items.filter(i => getItemCheckKey(dist.storeId, i) !== itemKey);
        const newLineTotal = remainingItems.reduce((sum, it) => sum + it.amount, 0);
        return {
          ...dist,
          items: remainingItems,
          lineTotal: newLineTotal
        };
      }).filter(dist => dist.items.length > 0);

      cachedDistributors = updated;
      persistCartCache(updated, cachedPriceHistory);
      return updated;
    });

    const storeName = distributors.find(d => d.storeId === item.storeId)?.storeName || '';
    toastEvent.trigger(`Removing "${item.productName}" in background...`, 'info');

    // 2. Enqueue item for silent sequential deletion (Attempt 1)
    deleteQueueRef.current.push({
      item,
      storeName,
      key: itemKey,
      attempt: 1
    });

    // 3. Process queue sequentially
    processDeleteQueue();
  };

  const handleReorderDirect = async (
    item: ReorderRecentItem,
    targetQty: number,
    targetStoreId?: number,
    targetStoreName?: string
  ) => {
    const storeId = targetStoreId ?? (item.storeId as number) ?? 0;
    const storeName = targetStoreName ?? item.storeName ?? item.lastDistributorName ?? '';
    const medName = item.medicineName;

    if (!storeId && !storeName) {
      liveCartAddEvent.triggerOpen(medName, targetQty);
      return;
    }

    let productCode = item.productCode || '';
    let productId = item.productId || 0;
    let packaging = item.packaging || '';
    let company = item.manufacturer || '';
    let rate = item.ptr || item.lastRate || 0;
    let mrp = item.mrp || 0;

    // Resolve Pharmarack ids ONLY by strict same-product equality (Plus/DS/M/H variants never match).
    if ((!productCode || !productId) && storeId) {
      const storeProducts = distributorProductsMap[storeId] || [];
      const match = storeProducts.find(p => isStrictSameProduct(p.medicineName, medName));
      if (match) {
        productCode = match.productCode || productCode;
        productId = Number(match.productId) || productId;
        packaging = packaging || match.packaging || '';
        company = company || match.manufacturer || '';
        rate = rate || match.ptr || 0;
        mrp = mrp || match.mrp || 0;
      }
    }

    setReaddingSentItems(true);
    beginHighPriorityAction();
    try {
      // Still no ids: ONE live search scoped to THIS distributor; auto-add only when exactly one of
      // its products is the same medicine. Otherwise the picker opens limited to this store.
      if ((!productCode || !productId) && storeId) {
        const live = await api.searchPharmarack(medName, storeId).catch(() => null);
        const hits = (Array.isArray(live) ? live : []).filter((r: LocalLiveSearchRow) =>
          !r.isOffline && !r.isLocalPharmacy && r.productCode && r.productId &&
          Number(r.storeId) === Number(storeId) && isStrictSameProduct(r.fullName || r.shortName || r.name, medName));
        if (hits.length === 1) {
          const h = hits[0];
          productCode = String(h.productCode);
          productId = Number(h.productId) || 0;
          packaging = packaging || h.packaging || '';
          company = company || h.company || '';
          rate = h.rate ?? rate;
          mrp = h.mrp ?? mrp;
        }
      }

      if (!productCode || !productId) {
        liveCartAddEvent.triggerOpen(medName, targetQty, undefined, undefined, storeId ? Number(storeId) : undefined);
        return;
      }

      const payload = [{
        productId: productId || 0,
        storeId: Number(storeId) || 0,
        qty: targetQty,
        productCode: productCode || '',
        productName: medName,
        company: company || '',
        packaging: packaging || '',
        rate: rate || undefined,
        mrp: mrp || undefined,
        storeName: storeName,
        mapped: item.mapped ?? true,
        medicineId: item.medicineId || undefined
      }];

      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        // Verify the line really is in THIS distributor's live cart before claiming success.
        const cart = await api.getPharmarackCart().catch(() => null);
        if (cart && Array.isArray(cart.distributors)) {
          const dist = cart.distributors.find((d: { storeId?: number }) => Number(d.storeId) === Number(storeId));
          const present = (dist?.items || []).some((it: { productCode?: string; productName?: string }) =>
            (it.productCode && String(it.productCode) === String(productCode)) || isStrictSameProduct(it.productName, medName));
          if (!present) {
            toastEvent.trigger(`${medName} was not confirmed in ${storeName}'s live cart. Please check the cart before ordering.`, 'error');
            window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
            return;
          }
        }
        setDistributors(prev => {
          let updated = prev;
          for (const it of payload) {
            updated = mergeItemIntoDistributors(updated, it);
          }
          cachedDistributors = updated;
          persistCartCache(updated, cachedPriceHistory);
          return updated;
        });
        toastEvent.trigger(`Added ${medName} (x${targetQty}) to ${storeName} live cart!`, 'success');
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
      } else {
        const errDetail = res?.details || res?.error || 'Failed to add item to live cart';
        toastEvent.trigger(errDetail, 'error');
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      console.error('Failed to direct reorder:', err);
      toastEvent.trigger('Failed to reorder: ' + (apiErr?.message || 'Error'), 'error');
    } finally {
      setReaddingSentItems(false);
      endHighPriorityAction();
    }
  };

  const sentKey = (order: LocalSentOrder, item: LocalSentOrderItem) => `${order.id}:${order.items.indexOf(item)}`;

  const sentSelectedCount = sentOrders.reduce((n, o) => n + (Array.isArray(o.items) ? o.items.filter(it => sentSelection[sentKey(o, it)]).length : 0), 0);

  const openSentPopup = () => {
    const rows: Array<{ key: string; item: LocalSentOrderItem; name: string; qty: number; storeId: number; storeName: string }> = [];
    for (const order of sentOrders) {
      for (const item of (Array.isArray(order.items) ? order.items : [])) {
        const key = sentKey(order, item);
        const name = String(item.productName || item.product || item.name || '');
        if (!name || !sentSelection[key]) continue;
        const q = Number(item.qty || item.quantity);
        rows.push({ key, item, name, qty: q > 0 ? q : 1, storeId: order.store_id || item.storeId || 0, storeName: order.store_name || '' });
      }
    }
    if (rows.length === 0) return;
    setSentPopup({ rows });
  };

  const handleAddSelectedSent = async () => {
    if (!sentPopup || sentPopup.rows.length === 0) return;
    const { rows } = sentPopup;
    setReaddingSentItems(true);
    beginHighPriorityAction();
    try {
      const payload = rows.map(r => ({
        productId: r.item.productId || 0,
        storeId: r.storeId,
        qty: Math.max(1, Math.floor(r.qty) || 1),
        productCode: r.item.productCode || '',
        productName: r.name,
        company: r.item.company || '',
        packaging: r.item.packaging || r.item.Packing || '',
        rate: r.item.ptr || r.item.rate || 0,
        mrp: r.item.mrp || 0,
        storeName: r.storeName,
        mapped: true
      }));
      const res = await api.addPharmarackCart(payload);
      if (res && res.success) {
        setDistributors(prev => {
          let updated = prev;
          for (const it of payload) updated = mergeItemIntoDistributors(updated, it);
          cachedDistributors = updated;
          persistCartCache(updated, cachedPriceHistory);
          return updated;
        });
        setSentPopup(null);
        setSentSelection(prev => {
          const next = { ...prev };
          rows.forEach(r => { delete next[r.key]; });
          return next;
        });
        toastEvent.trigger(`Added ${payload.length} item${payload.length > 1 ? 's' : ''} to the live cart.`, 'success');
        window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
      } else {
        toastEvent.trigger(res?.error || 'Failed to add the selected items to the live cart', 'error');
      }
    } catch (err: unknown) {
      toastEvent.trigger('Failed to add selected items: ' + ((err as LocalApiError)?.message || 'Error'), 'error');
    } finally {
      setReaddingSentItems(false);
      endHighPriorityAction();
    }
  };

  const handleSendSentOrderDispatch = async (order: LocalSentOrder) => {
    if (!order.id) return;
    setSendingDispatchOrderId(order.id);
    try {
      const res = await api.sendSentOrderDispatch(order.id);
      if (res?.action === 'released') {
        toastEvent.trigger(`Released — sending dispatch message to ${order.store_name} now`, 'success');
      } else if (res?.action === 'resent') {
        toastEvent.trigger(`Earlier reminder went out today — re-sent to ${order.store_name}`, 'success');
      } else {
        toastEvent.trigger(res?.message || `Queued dispatch message for ${order.store_name} in seconds`, 'success');
      }
    } catch (err: any) {
      const errMsg = err?.response?.data?.error || err?.message || 'Failed to send dispatch message';
      toastEvent.trigger(errMsg, 'error');
    } finally {
      setSendingDispatchOrderId(null);
    }
  };

  const handleOpenSwitchModal = async (item: CartLineItem, dist: Distributor) => {
    setSwitchModalTarget({ item, dist });
    setSwitchSearchQuery(item.productName);
    setSwitchSearching(true);
    setSwitchCatalogResults([]);
    try {
      const res = await api.searchPharmarack(item.productName);
      const items = Array.isArray(res) ? res : (res?.products || []);
      setSwitchCatalogResults(items);
      if (!priceHistoryCache[item.productName]) {
        fetchPriceHistories([{ items: [item] } as Distributor]);
      }
    } catch (err) {
      console.warn('Failed to search suppliers for switch:', err);
    } finally {
      setSwitchSearching(false);
    }
  };

  const handleSearchSwitchCatalog = async (query: string) => {
    setSwitchSearchQuery(query);
    if (!query || query.trim().length < 2) return;
    setSwitchSearching(true);
    try {
      const res = await api.searchPharmarack(query);
      const items = Array.isArray(res) ? res : (res?.products || []);
      setSwitchCatalogResults(items);
    } catch (err) {
      console.warn('Failed to search catalog for switch query:', err);
    } finally {
      setSwitchSearching(false);
    }
  };

  const handleConfirmSwitchSupplier = async (targetSupplier: LocalSwitchCatalogItem) => {
    if (!switchModalTarget) return;
    const { item, dist: currentDist } = switchModalTarget;
    setSwitchingDistributor(true);
    beginHighPriorityAction();
    try {
      const addRes = await api.addPharmarackCart([{
        productId: targetSupplier.productId || 0,
        storeId: targetSupplier.storeId,
        qty: item.qty || 1,
        rate: targetSupplier.rate !== undefined ? targetSupplier.rate : undefined,
        mrp: targetSupplier.mrp !== undefined ? targetSupplier.mrp : undefined,
        scheme: targetSupplier.scheme || undefined,
        productCode: targetSupplier.productCode || undefined,
        company: targetSupplier.company || item.company,
        productName: targetSupplier.name || targetSupplier.productName || item.productName,
        storeName: targetSupplier.storeName,
        packaging: targetSupplier.packaging || item.packaging,
        mapped: targetSupplier.mapped ?? true
      }]);

      if (addRes && addRes.success) {
        if (targetSupplier.storeId) {
          setSentWaStatusMap(prev => {
            const next = { ...prev };
            delete next[targetSupplier.storeId as number];
            return next;
          });
        }
        if (currentDist.storeId !== targetSupplier.storeId) {
          try {
            await handleDeleteItem(item);
          } catch (_) { }
        }
        setDistributors(prev => {
          const updated = mergeItemIntoDistributors(prev, {
            productId: targetSupplier.productId || 0,
            storeId: targetSupplier.storeId as number,
            qty: item.qty || 1,
            ptr: targetSupplier.rate !== undefined ? targetSupplier.rate : undefined,
            mrp: targetSupplier.mrp !== undefined ? targetSupplier.mrp : undefined,
            scheme: targetSupplier.scheme || undefined,
            productCode: targetSupplier.productCode || undefined,
            company: targetSupplier.company || item.company,
            productName: targetSupplier.name || targetSupplier.productName || item.productName,
            storeName: targetSupplier.storeName,
            packaging: targetSupplier.packaging || item.packaging,
            isChecked: true
          });
          cachedDistributors = updated;
          persistCartCache(updated, cachedPriceHistory);
          return updated;
        });
        toastEvent.trigger(`Switched "${item.productName}" to ${targetSupplier.storeName || 'new distributor'}!`, 'success');
        setSwitchModalTarget(null);
        scheduleCartSync(1500);
      } else {
        toastEvent.trigger(addRes?.error || 'Failed to switch supplier', 'error');
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      toastEvent.trigger(apiErr?.message || 'Error switching supplier', 'error');
    } finally {
      setSwitchingDistributor(false);
      endHighPriorityAction();
    }
  };

  // ponytail: stagger initial mount fetches — the live cart (plus its "already sent" badge
  // map) is the primary visible data, so it loads immediately. Pending special orders/refills
  // load shortly after, and sales reorder suggestions (lowest priority, sidebar-only) load last.
  // This 3-tier order (cart -> pending -> suggestions) avoids saturating the network with 5+
  // parallel requests on mount and gets the cart interactive sooner.
  const [showPendingTier, setShowPendingTier] = useState(false);
  const [showSuggestionsTier, setShowSuggestionsTier] = useState(false);

  useEffect(() => {
    checkSession();
    if (cachedDistributors.length === 0) {
      fetchCart();
    } else {
      fetchCartSilent();
    }
    fetchLatestSentMap();
  }, [checkSession]);

  // Auto-refresh on every RETURN to this page: KeepAlive keeps us mounted forever,
  // so switching away and back used to show the stale list until a manual refresh.
  // One silent sync per activation (cached paint stays up, data updates underneath)
  // keeps the cart current with zero spinners. Changes made WHILE the page is
  // visible arrive via the global SSE bridge ('refresh-pharmarack-cart' below).
  const pageActiveRef = useRef(pageActive);
  useEffect(() => {
    const wasActive = pageActiveRef.current;
    pageActiveRef.current = pageActive;
    if (!pageActive || wasActive) return;
    checkSession();
    fetchCartSilent();
    fetchLatestSentMap();
    fetchTodaySoldMedicines();
  }, [pageActive, checkSession, fetchTodaySoldMedicines]);

  // Auto-refresh when switching internal sub-tabs back to the 'cart' tab
  const prevTabRef = useRef(currentTab);
  useEffect(() => {
    const prevTab = prevTabRef.current;
    prevTabRef.current = currentTab;
    if (currentTab === 'cart' && prevTab !== 'cart' && pageActive) {
      fetchCartSilent();
      fetchLatestSentMap();
      fetchTodaySoldMedicines();
    }
  }, [currentTab, pageActive, fetchTodaySoldMedicines]);

  useEffect(() => {
    const timer = setTimeout(() => setShowPendingTier(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowSuggestionsTier(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showPendingTier) return;
    fetchPendingOrders();
    fetchPendingRefills();
    fetchTodaySoldMedicines();
  }, [showPendingTier, fetchTodaySoldMedicines]);

  useEffect(() => {
    if (!showSuggestionsTier) return;
    fetchReorderSuggestions();
    fetchReorderRecentItems();
    fetchPurchaseHistoryItems();
    apiClient.get('/settings').then(res => {
      const val = parseInt(res.data?.pharmarack_reorder_window_months || '2', 10);
      if ([2, 4, 6, 8].includes(val)) setReorderWindowMonths(val);
    }).catch(() => { });
  }, [showSuggestionsTier]);

  // Card quantity overrides
  // Load batch last purchase info for candidate names
  const inFlightBatchNamesRef = useRef<Set<string>>(new Set());
  const fetchBatchLastPurchases = async (names: string[]) => {
    if (!names || names.length === 0) return;
    const missingNames = names.filter(n => {
      const clean = (n || '').toLowerCase().trim();
      return clean && !lastPurchaseMap[n] && !lastPurchaseMap[clean] && !inFlightBatchNamesRef.current.has(clean);
    });
    if (missingNames.length === 0) return;

    missingNames.forEach(n => inFlightBatchNamesRef.current.add((n || '').toLowerCase().trim()));
    setLastPurchaseLoading(true);
    try {
      const payload = missingNames.slice(0, 100).map(name => ({ name }));
      const res = await api.getBatchLastPurchase(payload);
      if (Array.isArray(res)) {
        const nextMap = { ...lastPurchaseMap };
        for (const item of res) {
          if (item && item.query) {
            nextMap[item.query] = item;
            nextMap[item.query.toLowerCase().trim()] = item;
            if (item.medicine_name) {
              nextMap[item.medicine_name] = item;
              nextMap[item.medicine_name.toLowerCase().trim()] = item;
            }
          }
        }
        setLastPurchaseMap(nextMap);
      }
    } catch (err) {
      console.warn('Failed to load batch last purchase info:', err);
    } finally {
      missingNames.forEach(n => inFlightBatchNamesRef.current.delete((n || '').toLowerCase().trim()));
      setLastPurchaseLoading(false);
    }
  };

  useEffect(() => {
    const candidateNames = [
      ...distributors.flatMap(d => d.items.map(i => i.productName)),
      ...reorderSuggestions.map(s => s.medicineName),
      ...pendingOrders.map(o => o.product),
      ...pendingRefills.map(r => r.medicine_name)
    ].filter(Boolean) as string[];

    if (candidateNames.length === 0) return;
    const timer = setTimeout(() => {
      fetchBatchLastPurchases(candidateNames);
    }, 400);
    return () => clearTimeout(timer);
  }, [distributors, reorderSuggestions, pendingOrders, pendingRefills]);


  // 1. Unified Reorder Cards Memo

  const handleConfirmReorderSame = async () => {
    if (!reorderSameModalTarget) return;
    const card = reorderSameModalTarget;
    const targetStoreId = reorderModalSupplierId || distributors[0]?.storeId || 0;
    const targetDist = distributors.find(d => d.storeId === targetStoreId) || distributors[0];

    beginHighPriorityAction();
    try {
      const rate = card.previousPurchase?.price || card.ptr || undefined;
      const addRes = await api.addPharmarackCart([{
        productId: card.medicineId || 0,
        storeId: targetStoreId,
        qty: reorderModalQty,
        rate: rate,
        mrp: card.mrp || card.previousPurchase?.mrp || undefined,
        company: card.company || '',
        productName: card.medicineName,
        storeName: targetDist?.storeName || 'Distributor',
        packaging: card.packaging || '',
        mapped: true
      }]);

      if (addRes && addRes.success) {
        toastEvent.trigger(`Added "${card.medicineName}" (x${reorderModalQty}) to ${targetDist?.storeName || 'Cart'}!`, 'success');
        if (targetStoreId) {
          setSentWaStatusMap(prev => {
            const next = { ...prev };
            delete next[targetStoreId];
            return next;
          });
        }
        setDistributors(prev => {
          const updated = mergeItemIntoDistributors(prev, {
            productId: card.medicineId || 0,
            storeId: targetStoreId,
            qty: reorderModalQty,
            ptr: rate,
            mrp: card.mrp || card.previousPurchase?.mrp || undefined,
            company: card.company || '',
            productName: card.medicineName,
            storeName: targetDist?.storeName || 'Distributor',
            packaging: card.packaging || '',
            isChecked: true
          });
          cachedDistributors = updated;
          persistCartCache(updated, cachedPriceHistory);
          return updated;
        });
        setReorderSameModalTarget(null);
        scheduleCartSync(1500);
      } else {
        toastEvent.trigger(addRes?.error || 'Opening Live Search to verify product...', 'info');
        liveCartAddEvent.triggerOpen(card.medicineName, reorderModalQty);
        setReorderSameModalTarget(null);
      }
    } catch (err: unknown) {
      const apiErr = err as LocalApiError;
      toastEvent.trigger(apiErr?.message || 'Failed to add reorder item', 'error');
    } finally {
      endHighPriorityAction();
    }
  };

  // Re-fetch pending special orders whenever any page creates/updates an order.
  // This clears the module-level cache so stale data is never shown.
  useEffect(() => {
    const unsub = specialOrdersEvent.subscribeUpdated(() => {
      cachedPendingOrders = [];
      fetchPendingOrders();
    });
    return unsub;
  }, []);

  // Listen to cross-page refresh events fired by QuickOrderModal, LiveCartAddModal, login/OTP completion, etc.
  // 'refresh-pharmarack-cart'    → schedule debounced verify sync so newly-added items appear without duplicate floods
  // 'pharmarack-auth-changed'     → re-fetch cart as soon as user enters OTP / session token updates
  // 'pharmarack-session-updated'  → re-fetch cart on session renewal
  // 'refresh-special-orders'     → re-fetch pending orders so the left sidebar count is up-to-date
  useEffect(() => {
    const handleCartRefresh = () => {
      checkSession();
      // Hidden kept-alive page must not background-fetch (P3 gating) — the
      // activation effect silently syncs the moment the user returns.
      if (!pageActiveRef.current) return;
      if (updatingItemId || highPriorityActiveRef.current) {
        scheduleCartSync(2000);
        return;
      }
      // If a silent delete queue is in progress, skip intermediate fetches to avoid cart churn
      if (deleteQueueRef.current.length > 0 || isProcessingDeleteQueueRef.current) {
        return;
      }
      scheduleCartSync(300);
      fetchLatestSentMap();
    };
    const handleOrdersRefresh = () => {
      cachedPendingOrders = [];
      fetchPendingOrders();
      fetchPendingRefills();
      fetchTodaySoldMedicines();
    };
    window.addEventListener('refresh-pharmarack-cart', handleCartRefresh);
    window.addEventListener('pharmarack-auth-changed', handleCartRefresh);
    window.addEventListener('pharmarack-session-updated', handleCartRefresh);
    window.addEventListener('sse-pharmarack-refreshed', handleCartRefresh);
    window.addEventListener('refresh-special-orders', handleOrdersRefresh);
    window.addEventListener('pharmarack_cart_changed', handleCartRefresh);
    window.addEventListener('refill_updated', handleOrdersRefresh);
    window.addEventListener('order_updated', handleOrdersRefresh);
    return () => {
      window.removeEventListener('refresh-pharmarack-cart', handleCartRefresh);
      window.removeEventListener('pharmarack-auth-changed', handleCartRefresh);
      window.removeEventListener('pharmarack-session-updated', handleCartRefresh);
      window.removeEventListener('sse-pharmarack-refreshed', handleCartRefresh);
      window.removeEventListener('refresh-special-orders', handleOrdersRefresh);
      window.removeEventListener('pharmarack_cart_changed', handleCartRefresh);
      window.removeEventListener('refill_updated', handleOrdersRefresh);
      window.removeEventListener('order_updated', handleOrdersRefresh);
    };
  }, []);


  const [hasUnreadSentHistory, setHasUnreadSentHistory] = useState<boolean>(false);

  useEffect(() => {
    if (currentTab === 'sent-history') {
      setHasUnreadSentHistory(false);
    }
  }, [currentTab]);

  const totalProducts = distributors.reduce((s, d) => s + d.items.length, 0);
  const totalQty = distributors.reduce((s, d) => s + d.items.reduce((q, i) => q + (i.qty || 1), 0), 0);
  const totalAmount = distributors.reduce((s, d) => s + d.items.reduce((a, i) => a + getCartItemAmount(i), 0), 0);

  const renderSpecialOrderCard = (order: SpecialOrder) => {
    const inCart = Boolean(getOrderItemInCart(order));
    const isWebsite = order.customer_order_source === 'website';
    const isRefill = order.customer_order_source === 'website_refill';
    const isWhatsApp = order.customer_order_source === 'whatsapp';

    return (
      <div key={order.id} className="p-4 rounded-2xl border border-glass-border/60 bg-bg/40 flex flex-col justify-between gap-3 shadow-md hover:border-glass-border transition-all">
        <div className="space-y-3">
          {/* Card Header: Customer & Source Badges */}
          <div className="flex items-center justify-between pb-2 border-b border-glass-border/30">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-extrabold text-text truncate">
                {order.requester || 'Customer'}
              </span>
              {order.phone && (
                <button
                  type="button"
                  onClick={() => handleWhatsAppCustomer(order)}
                  className="text-xs font-mono text-muted hover:text-emerald-400 flex items-center gap-1 transition-colors cursor-pointer"
                  title="Chat on WhatsApp"
                >
                  <Phone size={11} className="text-muted" />
                  <span>{order.phone}</span>
                </button>
              )}
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg3 text-muted border border-glass-border">
                #{order.id}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Source Badge */}
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono border ${
                isWebsite
                  ? 'bg-sky-500/20 text-sky-400 border-sky-500/30'
                  : isRefill
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : isWhatsApp
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
              }`}>
                {isWebsite ? '🌐 Website' : isRefill ? '🔄 Web Refill' : isWhatsApp ? '💬 WhatsApp' : '📋 Shortage'}
              </span>

              {/* Priority Badge */}
              {order.priority && order.priority !== 'Normal' && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  order.priority === 'Urgent'
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                    : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                }`}>
                  {order.priority}
                </span>
              )}

              {/* Status Chip */}
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                order.status === 'Fulfilled' || order.status === 'Completed'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : order.status === 'Ready'
                    ? 'bg-sky-500/20 text-sky-400 border-sky-500/30'
                    : order.status === 'Ordered'
                      ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                      : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              }`}>
                {order.status === 'Fulfilled' || order.status === 'Completed' ? '● Fulfilled' : order.status === 'Ready' ? '● Ready' : order.status === 'Ordered' ? '● In PO' : '○ Pending'}
              </span>
            </div>
          </div>

          {/* Medicine Name & Details */}
          <div className="space-y-1.5">
            <div className="text-sm font-extrabold text-text">
              {highlightMatch(order.product, onlineOrderSearchQuery)}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
              <span>Required Qty: <strong className="text-primary font-mono">{order.qty || 1}</strong></span>
              {order.advance_payment ? (
                <span>Advance: <strong className="text-emerald-400 font-mono">₹{order.advance_payment}</strong></span>
              ) : null}
              {order.pharmarack_distributor && (
                <span>Distributor: <strong className="text-text">{order.pharmarack_distributor}</strong></span>
              )}
            </div>
            {order.notes && (
              <div className="text-xs text-muted/85 italic bg-bg2/50 px-2.5 py-1.5 rounded-xl border border-glass-border/30">
                "{order.notes}"
              </div>
            )}
          </div>
        </div>

        {/* Bottom Action Controls */}
        <div className="pt-2.5 border-t border-glass-border/30 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {/* Add to Live Cart Button */}
            <button
              type="button"
              onClick={() => !inCart && liveCartAddEvent.triggerOpen(order.product, order.qty, order.id)}
              disabled={inCart}
              className={`py-1.5 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                inCart
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default'
                  : 'bg-primary text-white hover:bg-primary/80 active:scale-95 cursor-pointer shadow-xs'
              }`}
              title={inCart ? 'Already added to active cart' : 'Add to Pharmarack live cart'}
            >
              {inCart ? <CheckCircle2 size={13} className="text-emerald-400" /> : <ShoppingCart size={13} />}
              <span>{inCart ? '✓ In Live Cart' : 'Add to Cart'}</span>
            </button>

            {/* Open in POS Button */}
            <button
              type="button"
              onClick={() => navigate(`/pos?search=${encodeURIComponent(order.product)}`)}
              className="py-1.5 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-bg3 hover:bg-glass-bg border border-glass-border text-text transition-all active:scale-95 cursor-pointer"
              title="Search and bill this medicine in POS"
            >
              <Store size={13} className="text-primary" />
              <span>Open in POS</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* WhatsApp Button */}
            {order.phone && (
              <button
                type="button"
                onClick={() => handleWhatsAppCustomer(order)}
                className="py-1.5 px-2.5 rounded-xl text-xs font-bold flex items-center gap-1 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 transition-all active:scale-95 cursor-pointer"
                title="Message customer via WhatsApp"
              >
                <MessageSquare size={12} />
                <span>WhatsApp</span>
              </button>
            )}

            {/* Status Transition Button */}
            {order.status !== 'Fulfilled' && order.status !== 'Completed' ? (
              order.status === 'Ready' ? (
                <button
                  type="button"
                  onClick={() => handleUpdateOrderStatus(order.id, 'Fulfilled')}
                  className="py-1.5 px-2.5 rounded-xl text-xs font-bold flex items-center gap-1 bg-emerald-500 text-white hover:bg-emerald-600 transition-all active:scale-95 cursor-pointer shadow-xs"
                  title="Mark order as fulfilled and delivered"
                >
                  <Check size={12} />
                  <span>Fulfill</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleUpdateOrderStatus(order.id, 'Ready')}
                  className="py-1.5 px-2.5 rounded-xl text-xs font-bold flex items-center gap-1 bg-sky-500 text-white hover:bg-sky-600 transition-all active:scale-95 cursor-pointer shadow-xs"
                  title="Mark order as ready for pickup"
                >
                  <CheckCircle2 size={12} />
                  <span>Mark Ready</span>
                </button>
              )
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderRefillCard = (refill: Refill) => {
    const inCart = Boolean(getRefillItemInCart(refill));

    return (
      <div key={`refill-${refill.id}`} className="p-4 rounded-2xl border border-glass-border/60 bg-bg/40 flex flex-col justify-between gap-3 shadow-md hover:border-glass-border transition-all">
        <div className="space-y-3">
          {/* Card Header: Patient & Refill Badge */}
          <div className="flex items-center justify-between pb-2 border-b border-glass-border/30">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-extrabold text-text truncate">
                {refill.patient_name || 'Patient'}
              </span>
              {refill.patient_phone && (
                <button
                  type="button"
                  onClick={() => {
                    const text = `Hello ${refill.patient_name}, your refill for ${refill.medicine_name} is due at our pharmacy. Would you like us to keep it ready for you?`;
                    openOrReuseWhatsappTab('', refill.patient_phone, text);
                  }}
                  className="text-xs font-mono text-muted hover:text-emerald-400 flex items-center gap-1 transition-colors cursor-pointer"
                  title="Chat on WhatsApp"
                >
                  <Phone size={11} className="text-muted" />
                  <span>{refill.patient_phone}</span>
                </button>
              )}
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg3 text-muted border border-glass-border">
                Refill #{refill.id}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full font-mono border bg-amber-500/20 text-amber-400 border-amber-500/30">
                🔄 Patient Refill
              </span>
              <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
                Due: {refill.next_refill_date ? new Date(refill.next_refill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Soon'}
              </span>
            </div>
          </div>

          {/* Medicine Name & Details */}
          <div className="space-y-1.5">
            <div className="text-sm font-extrabold text-text">
              {highlightMatch(refill.medicine_name || '', onlineOrderSearchQuery)}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
              <span>Required Qty: <strong className="text-primary font-mono">{refill.quantity_needed || 1}</strong></span>
              <span>In Stock: <strong className="text-text font-mono">{refill.in_stock_qty || 0}</strong></span>
              {refill.refill_interval_days && (
                <span>Cycle: <strong className="text-muted font-mono">{refill.refill_interval_days}d</strong></span>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Controls */}
        <div className="pt-2.5 border-t border-glass-border/30 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !inCart && liveCartAddEvent.triggerOpen(refill.medicine_name, refill.quantity_needed || 1)}
              disabled={inCart}
              className={`py-1.5 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                inCart
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default'
                  : 'bg-primary text-white hover:bg-primary/80 active:scale-95 cursor-pointer shadow-xs'
              }`}
              title={inCart ? 'Already added to active cart' : 'Add to Pharmarack live cart'}
            >
              {inCart ? <CheckCircle2 size={13} className="text-emerald-400" /> : <ShoppingCart size={13} />}
              <span>{inCart ? '✓ In Live Cart' : 'Add to Cart'}</span>
            </button>

            <button
              type="button"
              onClick={() => navigate(`/pos?search=${encodeURIComponent(refill.medicine_name || '')}`)}
              className="py-1.5 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-bg3 hover:bg-glass-bg border border-glass-border text-text transition-all active:scale-95 cursor-pointer"
              title="Search and bill in POS"
            >
              <Store size={13} className="text-primary" />
              <span>Open in POS</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {refill.patient_phone && (
              <button
                type="button"
                onClick={() => {
                  const text = `Hello ${refill.patient_name}, your refill for ${refill.medicine_name} is due at our pharmacy. Would you like us to keep it ready for you?`;
                  openOrReuseWhatsappTab('', refill.patient_phone, text);
                }}
                className="py-1.5 px-2.5 rounded-xl text-xs font-bold flex items-center gap-1 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 transition-all active:scale-95 cursor-pointer"
                title="Message patient via WhatsApp"
              >
                <MessageSquare size={12} />
                <span>WhatsApp</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden text-text gap-1 p-1.5 sm:p-2 pb-2 relative w-full h-full">
      {/* Top Integrated Scheduler & Navigation Bar */}
      <PharmarackCartCalendar
        currentTab={currentTab}
        onTabChange={(tab) => {
          setSearchParams({ tab });
          if (tab === 'sent-history') setHasUnreadSentHistory(false);
        }}
        hasUnreadSentHistory={hasUnreadSentHistory}
        activeCount={distributors.reduce((acc, d) => acc + (d.items || []).filter(i => isItemIncludedInDispatch(i, d) && !isItemAlreadySent(i, d)).length, 0)}
        reorderCount={visiblePendingOrders.length + visiblePendingRefills.length + reorderSuggestions.length + reorderRecentItems.length + purchaseHistoryItems.length}
        onlineOrdersCount={todayTotalOrdersCount || (allOnlineOrders.length > 0 ? allOnlineOrders.filter(o => ['Pending', 'Confirmed', 'Waiting'].includes(o.status)).length : visiblePendingOrders.length)}
      />

      {currentTab === 'online-orders' ? (
        /* ── Split-Pane Online Orders Master-Detail View (Same UI/UX as Sent PO History) ── */
        <div className="flex-1 flex overflow-hidden bg-transparent border border-glass-border/40 rounded-3xl min-h-0">

          {/* Left Master Sidebar: Historical & Today Order Dates */}
          <div className="w-72 md:w-80 shrink-0 border-r border-glass-border/40 flex flex-col bg-bg3/20 overflow-hidden">
            <div className="p-4 border-b border-glass-border/40 flex items-center justify-between shrink-0 bg-transparent">
              <div className="flex items-center gap-2">
                <Globe size={16} className="text-primary" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-text">Order Dates</h4>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono">
                {onlineOrderDates.length} Days
              </span>
            </div>

            {/* Quick Button: All Today's Orders */}
            <div className="p-2.5 border-b border-glass-border/30 bg-bg2/20 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSelectedOnlineOrderDate(getTodayString());
                  setOnlineCategory('today');
                }}
                className={`w-full flex items-center justify-between p-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  selectedOnlineOrderDate === getTodayString() && onlineCategory === 'today'
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-xs'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-emerald-400" />
                  <span>🌟 All Today's Orders</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                  {todayTotalOrdersCount} Orders
                </span>
              </button>
            </div>

            {/* Quick Filter Search Bar */}
            {onlineOrderDates.length > 5 && (
              <div className="p-2.5 border-b border-glass-border/30 bg-bg2/20 shrink-0">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    type="text"
                    value={onlineDateSearchQuery}
                    onChange={e => setOnlineDateSearchQuery(e.target.value)}
                    placeholder="Filter dates (e.g. Oct, 24)..."
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-bg border border-glass-border/60 rounded-xl text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary/60 transition-all"
                  />
                  {onlineDateSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setOnlineDateSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 rounded-md cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Dates List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              {onlineOrderDates.length === 0 ? (
                <div className="text-center py-10 text-xs text-muted animate-pulse">
                  Loading order dates…
                </div>
              ) : recentOnlineDates.length === 0 && olderOnlineMonthGroups.length === 0 ? (
                <div className="text-center py-10 text-xs text-muted italic">
                  No dates found matching "{onlineDateSearchQuery}".
                </div>
              ) : (
                <>
                  {/* Recent (Last 7 Days) Section - Always Expanded */}
                  {recentOnlineDates.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between px-1 pb-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted flex items-center gap-1.5">
                          <Clock size={11} className="text-primary" />
                          Recent (Last 7 Days)
                        </span>
                        <span className="text-[9px] font-mono font-bold text-muted px-1.5 py-0.2 rounded bg-bg3 border border-glass-border">
                          {recentOnlineDates.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {recentOnlineDates.map(d => renderOnlineDateButton(d, false))}
                      </div>
                    </div>
                  )}

                  {/* Older History (Monthly Collapsible Accordions) */}
                  {olderOnlineMonthGroups.length > 0 && (
                    <div className="space-y-2 pt-1 border-t border-glass-border/30">
                      <div className="px-1 pb-0.5">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted flex items-center gap-1.5">
                          <Folder size={11} className="text-amber-500" />
                          Older History
                        </span>
                      </div>

                      {olderOnlineMonthGroups.map(group => {
                        const isExpanded = expandedOnlineMonths.has(group.monthKey);
                        const hasSelectedDate = group.dates.includes(selectedOnlineOrderDate);

                        return (
                          <div
                            key={group.monthKey}
                            className={`rounded-2xl border transition-all ${
                              hasSelectedDate
                                ? 'border-primary/40 bg-bg2/40'
                                : 'border-glass-border/50 bg-bg2/20 hover:border-glass-border'
                            } overflow-hidden`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleOnlineMonth(group.monthKey)}
                              className="w-full flex items-center justify-between p-2.5 text-xs font-bold text-text hover:bg-bg2/60 transition-colors cursor-pointer text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isExpanded ? (
                                  <FolderOpen size={13} className="text-amber-500 shrink-0" />
                                ) : (
                                  <Folder size={13} className="text-amber-500/70 shrink-0" />
                                )}
                                <span className="truncate">{group.monthLabel}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[9px] font-mono font-bold text-muted px-1.5 py-0.2 rounded bg-bg3 border border-glass-border">
                                  {group.dates.length}
                                </span>
                                {isExpanded ? (
                                  <ChevronUp size={12} className="text-muted" />
                                ) : (
                                  <ChevronDown size={12} className="text-muted" />
                                )}
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="px-2 pb-2.5 pt-1 space-y-1.5 border-t border-glass-border/20 bg-bg/20">
                                {group.dates.map(d => renderOnlineDateButton(d, true))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right Detail Panel: Online Orders for Selected Date */}
          <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-4 min-h-0 bg-glass-bg/20">
            {/* Top Bar: Title & Primary Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-glass-border/40 pb-3 shrink-0">
              <div>
                <h3 className="text-base font-bold text-text uppercase tracking-wide flex items-center gap-2">
                  <Globe size={18} className="text-primary" />
                  {onlineCategory === 'today' ? "🌟 All Today's Orders" : onlineCategory === 'online' ? "🌐 Online Orders" : onlineCategory === 'refills' ? "🔄 Refill Requests" : onlineCategory === 'special' ? "📋 Special Orders" : "All Orders"}: {selectedOnlineOrderDate ? (isNaN(new Date(selectedOnlineOrderDate).getTime()) ? selectedOnlineOrderDate : new Date(selectedOnlineOrderDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' })) : 'Select Date'}
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  {onlineCategory === 'today'
                    ? "Complete overview of all incoming customer orders, due refills, and shortage requests for today"
                    : `Customer website, WhatsApp, refills, and shortage orders recorded for ${selectedOnlineOrderDate}`}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {/* Search in Date */}
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    type="text"
                    value={onlineOrderSearchQuery}
                    onChange={e => setOnlineOrderSearchQuery(e.target.value)}
                    placeholder="Search medicine / customer..."
                    className="pl-7 pr-6 py-1.5 text-xs bg-bg border border-glass-border/60 rounded-xl text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary/60 transition-all w-44 sm:w-52"
                  />
                  {onlineOrderSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setOnlineOrderSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 rounded-md cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                {/* Status Filter */}
                <div className="flex items-center bg-bg border border-glass-border rounded-xl p-0.5 text-xs">
                  {(['All', 'Pending', 'Ready', 'Fulfilled'] as const).map(st => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setOnlineStatusFilter(st)}
                      className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                        onlineStatusFilter === st
                          ? 'bg-primary text-white shadow-xs'
                          : 'text-muted hover:text-text'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    fetchPendingOrders();
                    fetchPendingRefills();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg3 hover:bg-glass-bg border border-glass-border text-text text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
                  title="Refresh online orders & refills"
                >
                  <RotateCw size={12} className="text-muted" />
                  <span>Refresh</span>
                </button>

                <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-bg3 border border-glass-border text-text font-mono">
                  {totalSelectedCount} Total
                </span>
              </div>
            </div>

            {/* Dedicated Category Headers: All Today's Orders, Online, Refills, Special */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1.5 shrink-0 border-b border-glass-border/30">
              <button
                type="button"
                onClick={() => {
                  setSelectedOnlineOrderDate(getTodayString());
                  setOnlineCategory('today');
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  onlineCategory === 'today' && selectedOnlineOrderDate === getTodayString()
                    ? 'bg-emerald-500 text-white shadow-xs font-black'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20'
                }`}
                title="View all of today's incoming orders, refills, and shortage requests"
              >
                <span>🌟 All Today's Orders</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${onlineCategory === 'today' && selectedOnlineOrderDate === getTodayString() ? 'bg-emerald-600/80 text-white' : 'bg-emerald-500/20 text-emerald-300'}`}>
                  {todayTotalOrdersCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setOnlineCategory('online')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  onlineCategory === 'online'
                    ? 'bg-sky-500 text-white shadow-xs font-black'
                    : 'bg-sky-500/10 text-sky-400 border border-sky-500/25 hover:bg-sky-500/20'
                }`}
                title="View customer website and WhatsApp orders"
              >
                <Globe size={13} />
                <span>Online Orders</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${onlineCategory === 'online' ? 'bg-sky-600/80 text-white' : 'bg-sky-500/20 text-sky-300'}`}>
                  {onlineCategoryCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setOnlineCategory('refills')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  onlineCategory === 'refills'
                    ? 'bg-amber-500 text-white shadow-xs font-black'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20'
                }`}
                title="View patient refill requests and due refill reminders"
              >
                <RotateCw size={13} />
                <span>Refills</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${onlineCategory === 'refills' ? 'bg-amber-600/80 text-white' : 'bg-amber-500/20 text-amber-300'}`}>
                  {refillsCategoryCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setOnlineCategory('special')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  onlineCategory === 'special'
                    ? 'bg-purple-500 text-white shadow-xs font-black'
                    : 'bg-purple-500/10 text-purple-400 border border-purple-500/25 hover:bg-purple-500/20'
                }`}
                title="View in-shop customer shortage requests"
              >
                <Package size={13} />
                <span>Special Orders / Shortages</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${onlineCategory === 'special' ? 'bg-purple-600/80 text-white' : 'bg-purple-500/20 text-purple-300'}`}>
                  {specialCategoryCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setOnlineCategory('all')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  onlineCategory === 'all'
                    ? 'bg-primary text-white shadow-xs font-black'
                    : 'bg-bg2 text-muted hover:text-text border border-glass-border/40'
                }`}
                title="View all orders across all categories for this date"
              >
                <span>All ({selectedOnlineOrderDate === getTodayString() ? 'Today' : selectedOnlineOrderDate})</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${onlineCategory === 'all' ? 'bg-primary/80 text-white' : 'bg-bg3 text-muted'}`}>
                  {totalSelectedCount}
                </span>
              </button>
            </div>

            {/* Orders Area */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-6 custom-scrollbar">
              {/* Present Day Banner when today is selected */}
              {selectedOnlineOrderDate === getTodayString() && (
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-transparent border border-emerald-500/30 flex items-center justify-between gap-4 flex-wrap shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                      <Clock size={16} />
                    </div>
                    <div>
                      <h4 className="text-xs font-extrabold uppercase tracking-wide text-text flex items-center gap-2">
                        Present Day's Orders ({getTodayString()})
                        <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Active Today
                        </span>
                      </h4>
                      <p className="text-[11px] text-muted mt-0.5">
                        All active incoming customer orders, due refills, and shortage requests for today in one unified overview.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-mono text-muted">Online: <strong className="text-sky-400">{onlineWebsiteOrders.length}</strong></span>
                    <span className="text-muted/40">•</span>
                    <span className="font-mono text-muted">Refills: <strong className="text-amber-400">{refillsCategoryCount}</strong></span>
                    <span className="text-muted/40">•</span>
                    <span className="font-mono text-muted">Special: <strong className="text-purple-400">{specialCategoryCount}</strong></span>
                  </div>
                </div>
              )}

              {/* SECTION 1: Online Orders (Website & WhatsApp) */}
              {(onlineCategory === 'today' || onlineCategory === 'all' || onlineCategory === 'online') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-glass-border/30">
                    <div className="flex items-center gap-2">
                      <Globe size={14} className="text-sky-400" />
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-text">
                        Online Orders (Website & WhatsApp)
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30 font-mono">
                        {onlineWebsiteOrders.length}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted">Customer web shop and WhatsApp orders</span>
                  </div>

                  {onlineWebsiteOrders.length === 0 ? (
                    onlineCategory === 'online' ? (
                      <div className="text-center py-10 text-xs text-muted italic">
                        No online website or WhatsApp orders found for {selectedOnlineOrderDate}.
                      </div>
                    ) : null
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {onlineWebsiteOrders.map(renderSpecialOrderCard)}
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 2: Patient Refills */}
              {(onlineCategory === 'today' || onlineCategory === 'all' || onlineCategory === 'refills') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-glass-border/30">
                    <div className="flex items-center gap-2">
                      <RotateCw size={14} className="text-amber-400" />
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-text">
                        Patient Refills & Web Refill Requests
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono">
                        {webRefillOrders.length + filteredRefills.length}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted">Chronic prescription cycles and customer web refills</span>
                  </div>

                  {webRefillOrders.length === 0 && filteredRefills.length === 0 ? (
                    onlineCategory === 'refills' ? (
                      <div className="text-center py-10 text-xs text-muted italic">
                        No patient refill requests found for {selectedOnlineOrderDate}.
                      </div>
                    ) : null
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {webRefillOrders.map(renderSpecialOrderCard)}
                      {filteredRefills.map(renderRefillCard)}
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 3: Customer Special Orders & Shortages */}
              {(onlineCategory === 'today' || onlineCategory === 'all' || onlineCategory === 'special') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-glass-border/30">
                    <div className="flex items-center gap-2">
                      <Package size={14} className="text-purple-400" />
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-text">
                        Customer Special Orders & Shortage Requests
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 font-mono">
                        {specialShortageOrders.length}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted">In-shop customer shortage requests</span>
                  </div>

                  {specialShortageOrders.length === 0 ? (
                    onlineCategory === 'special' ? (
                      <div className="text-center py-10 text-xs text-muted italic">
                        No customer special shortage orders found for {selectedOnlineOrderDate}.
                      </div>
                    ) : null
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {specialShortageOrders.map(renderSpecialOrderCard)}
                    </div>
                  )}
                </div>
              )}

              {/* Overall empty state when all 3 sections are empty */}
              {onlineWebsiteOrders.length === 0 && webRefillOrders.length === 0 && filteredRefills.length === 0 && specialShortageOrders.length === 0 && (
                <div className="text-center py-20 text-xs text-muted italic select-none">
                  No orders or requests found for date {selectedOnlineOrderDate} with filter "{onlineCategory !== 'today' && onlineCategory !== 'all' ? onlineCategory : onlineStatusFilter}".
                </div>
              )}
            </div>
          </div>
        </div>
      ) : currentTab === 'sent-history' ? (
        /* ── Split-Pane Sent Orders History Master-Detail View ── */
        <div className="flex-1 flex overflow-hidden bg-transparent border border-glass-border/40 rounded-3xl min-h-0">

          {/* Left Master Sidebar: Historical Order Dates */}
          <div className="w-72 md:w-80 shrink-0 border-r border-glass-border/40 flex flex-col bg-bg3/20 overflow-hidden">
            <div className="p-4 border-b border-glass-border/40 flex items-center justify-between shrink-0 bg-transparent">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-primary" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-text">History Dates</h4>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono">
                {sentDates.length} Days
              </span>
            </div>

            {/* Quick Filter Search Bar */}
            {sentDates.length > 5 && (
              <div className="p-2.5 border-b border-glass-border/30 bg-bg2/20 shrink-0">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    type="text"
                    value={sentDateSearchQuery}
                    onChange={e => setSentDateSearchQuery(e.target.value)}
                    placeholder="Filter dates (e.g. Oct, 21)..."
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-bg border border-glass-border/60 rounded-xl text-text placeholder:text-muted/60 focus:outline-hidden focus:border-primary/60 transition-all"
                  />
                  {sentDateSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setSentDateSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text p-0.5 rounded-md cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Dates List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              {sentDates.length === 0 ? (
                <div className="text-center py-10 text-xs text-muted animate-pulse">
                  Loading history dates…
                </div>
              ) : recentDates.length === 0 && olderMonthGroups.length === 0 ? (
                <div className="text-center py-10 text-xs text-muted italic">
                  No dates found matching "{sentDateSearchQuery}".
                </div>
              ) : (
                <>
                  {/* Recent (Last 7 Days) Section - Always Expanded */}
                  {recentDates.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between px-1 pb-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted flex items-center gap-1.5">
                          <Clock size={11} className="text-primary" />
                          Recent (Last 7 Days)
                        </span>
                        <span className="text-[9px] font-mono font-bold text-muted px-1.5 py-0.2 rounded bg-bg3 border border-glass-border">
                          {recentDates.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {recentDates.map(d => renderSentDateButton(d, false))}
                      </div>
                    </div>
                  )}

                  {/* Older History (Monthly Collapsible Accordions) */}
                  {olderMonthGroups.length > 0 && (
                    <div className="space-y-2 pt-1 border-t border-glass-border/30">
                      <div className="px-1 pb-0.5">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted flex items-center gap-1.5">
                          <Folder size={11} className="text-amber-500" />
                          Older History
                        </span>
                      </div>

                      {olderMonthGroups.map(group => {
                        const isExpanded = expandedMonths.has(group.monthKey);
                        const hasSelectedDate = group.dates.includes(selectedSentDate);

                        return (
                          <div
                            key={group.monthKey}
                            className={`rounded-2xl border transition-all ${
                              hasSelectedDate
                                ? 'border-primary/40 bg-bg2/40'
                                : 'border-glass-border/50 bg-bg2/20 hover:border-glass-border'
                            } overflow-hidden`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleMonth(group.monthKey)}
                              className="w-full flex items-center justify-between p-2.5 text-xs font-bold text-text hover:bg-bg2/60 transition-colors cursor-pointer text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isExpanded ? (
                                  <ChevronDown size={14} className="text-primary shrink-0 transition-transform" />
                                ) : (
                                  <ChevronRight size={14} className="text-muted shrink-0 transition-transform" />
                                )}
                                {isExpanded ? (
                                  <FolderOpen size={13} className="text-primary shrink-0" />
                                ) : (
                                  <Folder size={13} className="text-muted shrink-0" />
                                )}
                                <span className="truncate text-xs">{group.monthLabel}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-bg3 text-muted border border-glass-border">
                                  {group.dates.length} Days
                                </span>
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="px-2 pb-2.5 pt-1 space-y-1.5 border-t border-glass-border/20 bg-bg/20">
                                {group.dates.map(d => renderSentDateButton(d, true))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right Detail Panel: Sent Orders for Selected Date */}
          <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-5 min-h-0 bg-glass-bg/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-glass-border/40 pb-4 shrink-0">
              <div>
                <h3 className="text-base font-bold text-text uppercase tracking-wide flex items-center gap-2">
                  <Send size={18} className="text-primary" />
                  Sent Orders: {selectedSentDate ? (isNaN(new Date(selectedSentDate).getTime()) ? selectedSentDate : new Date(selectedSentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })) : 'Select Date'}
                </h3>
                <p className="text-xs text-muted mt-1">
                  Distributor orders dispatched on {selectedSentDate}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSyncExternalOrders}
                  disabled={syncingExternalOrders}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-bg3 hover:bg-glass-bg border border-glass-border text-text text-xs font-bold shadow-xs transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title="Sync today's official Pharmarack portal orders and record new POs"
                >
                  <RotateCw size={12} className={syncingExternalOrders ? "animate-spin text-primary" : "text-muted"} />
                  <span>{syncingExternalOrders ? 'Syncing...' : 'Sync Pharmarack'}</span>
                </button>
                {selectedSentDate && (
                  <>
                    <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-bg3 border border-glass-border text-text font-mono">
                      {sentOrders.length} Order{sentOrders.length !== 1 ? 's' : ''} Sent
                    </span>
                    {sentOrders.reduce((n, o) => n + (Array.isArray(o.pharmarack_order_nos) ? o.pharmarack_order_nos.length : 0), 0) > 0 && (
                      <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-bg3 border border-glass-border text-text font-mono">
                        {sentOrders.reduce((n, o) => n + (Array.isArray(o.pharmarack_order_nos) ? o.pharmarack_order_nos.length : 0), 0)} PO ID{sentOrders.reduce((n, o) => n + (Array.isArray(o.pharmarack_order_nos) ? o.pharmarack_order_nos.length : 0), 0) !== 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={openSentPopup}
                      disabled={sentSelectedCount === 0 || readdingSentItems}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-xs transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      title="Tick medicines below, then press Re-order to review and add them to the live cart"
                    >
                      <RotateCw size={12} />
                      <span>Re-order{sentSelectedCount > 0 ? ` (${sentSelectedCount})` : ''}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Orders Grid / Cards */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-4 custom-scrollbar">
              {sentOrdersLoading && sentOrders.length === 0 ? (
                <div className="text-center py-16 text-xs text-muted font-bold tracking-wider uppercase animate-pulse">
                  Loading sent order history for {selectedSentDate || 'selected date'}…
                </div>
              ) : sentOrders.length === 0 ? (
                <div className="text-center py-20 text-xs text-muted italic select-none">
                  {selectedSentDate ? `No order dispatches found for date ${selectedSentDate}.` : 'Select a date from the left sidebar to view orders.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {sentOrders.slice().sort((a, b) => {
                    const nameCompare = (a.store_name || '').localeCompare(b.store_name || '', undefined, { sensitivity: 'base' });
                    if (nameCompare !== 0) return nameCompare;
                    return (a.placed_at || 0) - (b.placed_at || 0);
                  }).map((order) => (
                    <div key={order.order_no ? `${order.id}-${order.order_no}` : order.id} className="p-4 rounded-2xl border border-glass-border/60 bg-bg/40 flex flex-col justify-between gap-3 shadow-md hover:border-glass-border transition-all">
                      <div>
                        <div className="flex items-center justify-between pb-2 border-b border-glass-border/30">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-extrabold text-text truncate" title={order.store_name}>
                              {order.store_name}
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg3 text-muted border border-glass-border">
                              Order #{order.id}
                            </span>
                            {Array.isArray(order.pharmarack_order_nos) && order.pharmarack_order_nos.map((no: string) => (
                              <span key={no} className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                PO #{no.replace(/^#+/, '')}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            {order.source === 'pharmarack_sync' ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30 font-mono" title="Order synced from official Pharmarack portal/app">
                                Pharmarack Web/App
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono" title="Order placed from this app">
                                In-App Sent
                              </span>
                            )}
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${order.batch_sent ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                              {order.batch_sent ? '● Sent' : '○ Pending'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSendSentOrderDispatch(order)}
                              disabled={sendingDispatchOrderId === order.id}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary hover:bg-primary-hover text-white text-[11px] font-bold shadow-xs transition-all active:scale-[.98] disabled:opacity-50 cursor-pointer"
                              title="Send or re-send WhatsApp dispatch status reminder with confirmed PO number"
                            >
                              {sendingDispatchOrderId === order.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Send size={11} />
                              )}
                              <span>{sendingDispatchOrderId === order.id ? 'Sending…' : 'Send Dispatch Msg'}</span>
                            </button>
                          </div>
                        </div>

                        {/* Items List */}
                        <div className="space-y-2 mt-3">
                          {(!Array.isArray(order.items) || order.items.length === 0) && (
                            <p className="text-[11px] text-muted italic">Placed on the Pharmarack website — product lines not available yet.</p>
                          )}
                          {Array.isArray(order.items) && [...order.items].sort((a, b) => (a.productName || a.product || a.name || '').localeCompare(b.productName || b.product || b.name || '', undefined, { sensitivity: 'base' })).map((item, idx: number) => {
                            const medName = item.productName || item.product || item.name;
                            const itemQty = item.qty || item.quantity || 0;

                            return (
                              <div key={idx} className="flex justify-between items-center text-xs text-text bg-bg2/40 p-2.5 rounded-xl border border-glass-border/30 hover:border-glass-border transition-all">
                                <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                                  <input
                                    type="checkbox"
                                    checked={!!sentSelection[sentKey(order, item)]}
                                    onChange={() => setSentSelection(prev => ({ ...prev, [sentKey(order, item)]: !prev[sentKey(order, item)] }))}
                                    disabled={readdingSentItems}
                                    className="w-4 h-4 rounded cursor-pointer accent-emerald-500 shrink-0 disabled:opacity-50"
                                    title="Tick to select, then press Re-order at the top"
                                  />
                                  <span className="truncate font-semibold text-text" title={medName}>{medName}</span>
                                  {(item.packaging || item.Packing) && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg3 text-muted border border-glass-border shrink-0">{String(item.packaging || item.Packing)}</span>}
                                  {itemQty > 0 && <span className="font-mono font-extrabold text-primary shrink-0">x{itemQty}</span>}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={() => liveCartAddEvent.triggerOpen(medName, itemQty)}
                                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-glass-border text-muted hover:text-text text-[10px] font-bold transition-all active:scale-95 cursor-pointer"
                                    title="Search across all available distributors in Live Cart Add modal"
                                  >
                                    <Search size={11} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Footer Info */}
                      <div className="flex items-center justify-between mt-2 text-[10px] text-muted pt-2 border-t border-glass-border/20">
                        <span className="font-mono">
                          Sent at: {order.placed_at ? new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                        </span>
                        <span className="text-[9px] font-mono font-bold text-muted/70 uppercase">
                          {Array.isArray(order.items) ? order.items.length : 0} Item{Array.isArray(order.items) && order.items.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : currentTab === 'reorder' ? (
        /* ── Reorder Hub View ── */
        <div className="flex-1 flex flex-col overflow-hidden bg-glass-bg border border-glass-border rounded-3xl min-h-0">
          {/* Header */}
          <div className="h-16 border-b border-glass-border/40 px-6 flex items-center justify-between shrink-0 bg-glass-bg/10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Clock size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text tracking-wide uppercase leading-none flex items-center gap-2">
                  Reorder Hub
                  <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-amber-500/15 text-amber-400 border-amber-500/30 font-mono">
                    {reorderSearchQuery ? `${totalReorderMatchesCount} Matches` : `${visiblePendingOrders.length + visiblePendingRefills.length + reorderSuggestions.length + reorderRecentItems.length} Items`}
                  </span>
                </h3>
                <p className="text-[10px] text-muted tracking-wider mt-1">
                  Customer requests, refill reminders, sales-weighted restock suggestions, and recently ordered medicines.
                </p>
              </div>
            </div>

            {/* Sub-Tabs Selector */}
            <div className="flex items-center gap-1.5 bg-bg p-1 rounded-xl border border-glass-border overflow-x-auto">
              {reorderSearchQuery && (
                <button
                  type="button"
                  onClick={() => setShortagesSubTab('all_matches')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${shortagesSubTab === 'all_matches'
                    ? 'bg-amber-500/20 text-amber-400 font-black shadow-xs border border-amber-500/30'
                    : 'text-muted hover:text-text hover:bg-bg3'
                    }`}
                >
                  <Search size={12} />
                  <span>All Matches ({totalReorderMatchesCount})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShortagesSubTab('requests')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${shortagesSubTab === 'requests'
                  ? 'bg-bg2 text-primary font-black shadow-xs border border-border'
                  : 'text-muted hover:text-text hover:bg-bg3'
                  }`}
              >
                <Clock size={12} />
                <span>Special Requests ({filteredPendingOrders.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShortagesSubTab('refills')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${shortagesSubTab === 'refills'
                  ? 'bg-bg2 text-primary font-black shadow-xs border border-border'
                  : 'text-muted hover:text-text hover:bg-bg3'
                  }`}
              >
                <ShoppingCart size={12} />
                <span>Refills Due ({filteredPendingRefills.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShortagesSubTab('sales_suggestions')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${shortagesSubTab === 'sales_suggestions'
                  ? 'bg-emerald-500/20 text-emerald-400 font-black shadow-xs border border-emerald-500/30'
                  : 'text-muted hover:text-text hover:bg-bg3'
                  }`}
              >
                <TrendingUp size={12} />
                <span>Sales Restock ({filteredReorderSuggestions.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShortagesSubTab('ordered_recently')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${shortagesSubTab === 'ordered_recently'
                  ? 'bg-violet-500/20 text-violet-400 font-black shadow-xs border border-violet-500/30'
                  : 'text-muted hover:text-text hover:bg-bg3'
                  }`}
              >
                <RotateCw size={12} />
                <span>Ordered Recently ({filteredReorderRecentItems.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShortagesSubTab('past_purchases')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${shortagesSubTab === 'past_purchases'
                  ? 'bg-sky-500/20 text-sky-400 font-black shadow-xs border border-sky-500/30'
                  : 'text-muted hover:text-text hover:bg-bg3'
                  }`}
              >
                <BookOpen size={12} />
                <span>Past Purchase Bills ({filteredPurchaseHistoryItems.length})</span>
              </button>
            </div>
          </div>

          {/* Search Bar & Filter Strip */}
          <div className="px-6 py-3 border-b border-glass-border/40 bg-bg2/40 flex items-center gap-3 shrink-0">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={reorderSearchQuery}
                onChange={(e) => {
                  const val = e.target.value;
                  setReorderSearchQuery(val);
                  if (val.trim()) {
                    setShortagesSubTab('all_matches');
                  } else if (shortagesSubTab === 'all_matches') {
                    setShortagesSubTab('requests');
                  }
                }}
                placeholder="Search by medicine name (or a request / order number)..."
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-bg/80 border border-glass-border text-xs text-text placeholder:text-muted focus:outline-none focus:border-primary/50 transition-all font-medium"
              />
              {reorderSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setReorderSearchQuery('');
                    if (shortagesSubTab === 'all_matches') {
                      setShortagesSubTab('requests');
                    }
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text p-1 cursor-pointer"
                  title="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {reorderSearchQuery && (
              <div className="flex items-center gap-2 text-xs font-mono text-muted shrink-0">
                <span>Filtering: <strong className="text-primary font-bold">"{reorderSearchQuery}"</strong></span>
                <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-bold">
                  {totalReorderMatchesCount} Matches
                </span>
              </div>
            )}
          </div>

          {/* SubTab Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
            {/* All Matches Unified Search View */}
            {shortagesSubTab === 'all_matches' && (
              totalReorderMatchesCount === 0 ? (
                <div className="text-center py-16 flex flex-col items-center justify-center gap-2">
                  <AlertCircle size={32} className="text-muted/60" />
                  <p className="text-sm font-bold text-text">No medicines found matching "{reorderSearchQuery}"</p>
                  <p className="text-xs text-muted max-w-md">
                    Searched across Special Requests, Refills Due, Sales Restock, Recent Orders, and Past Purchase Bills. No matching records found.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setReorderSearchQuery('');
                      setShortagesSubTab('requests');
                    }}
                    className="mt-2 px-3.5 py-1.5 rounded-xl bg-bg2 hover:bg-bg3 border border-glass-border text-xs font-bold text-text cursor-pointer transition-all active:scale-95"
                  >
                    Clear Search
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Category 1: Special Shortage Requests */}
                  {filteredPendingOrders.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-1.5 border-b border-amber-500/20">
                        <Clock size={14} className="text-amber-400" />
                        <span className="text-xs font-black text-amber-400 uppercase tracking-wider">
                          Special Requests ({filteredPendingOrders.length})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredPendingOrders.map((order) => {
                          const inCart = Boolean(getOrderItemInCart(order));
                          return (
                            <div key={`all-order-${order.id}`} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-extrabold text-xs text-text">{highlightMatch(order.product, reorderSearchQuery)}</span>
                                  <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${order.priority === 'Urgent' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-bg3 text-muted border border-glass-border'}`}>
                                    {order.priority || 'Normal'}
                                  </span>
                                </div>
                                <div className="text-xs text-muted space-y-1">
                                  <div>Customer: <strong className="text-text">{order.requester}</strong> ({order.phone})</div>
                                  <div>Required Qty: <strong className="text-primary font-mono">{order.qty || 1}</strong></div>
                                  {order.advance_payment ? <div>Advance Paid: <strong className="text-emerald-400 font-mono">₹{order.advance_payment}</strong></div> : null}
                                  {order.pharmarack_distributor && <div>Assigned Dist: <strong className="text-text">{order.pharmarack_distributor}</strong></div>}
                                </div>
                              </div>
                              <div className="pt-2 border-t border-glass-border/30 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => !inCart && liveCartAddEvent.triggerOpen(order.product, order.qty, order.id)}
                                  disabled={inCart}
                                  className={`flex-1 py-1.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${inCart ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default' : 'bg-primary text-white hover:bg-primary/80 active:scale-95 cursor-pointer'}`}
                                >
                                  {inCart ? <CheckCircle2 size={14} className="text-emerald-400" /> : <ShoppingCart size={14} />}
                                  <span>{inCart ? '✓ In Live Cart' : 'Add to Cart'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Category 2: Refills Due */}
                  {filteredPendingRefills.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-1.5 border-b border-sky-500/20">
                        <ShoppingCart size={14} className="text-sky-400" />
                        <span className="text-xs font-black text-sky-400 uppercase tracking-wider">
                          Refills Due ({filteredPendingRefills.length})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredPendingRefills.map((refill) => {
                          const inCart = Boolean(getRefillItemInCart(refill));
                          return (
                            <div key={`all-refill-${refill.id}`} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="font-extrabold text-sm text-text">{highlightMatch(refill.medicine_name || '', reorderSearchQuery)}</span>
                                  <span className="text-[11px] font-mono font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
                                    Due: {refill.next_refill_date ? new Date(refill.next_refill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Soon'}
                                  </span>
                                </div>
                                <div className="text-sm text-muted space-y-1">
                                  <div>Patient: <strong className="text-text">{refill.patient_name}</strong> ({refill.patient_phone})</div>
                                  <div>Needed: <strong className="text-primary font-mono">{refill.quantity_needed || 1}</strong> | In Stock: <strong className="text-text font-mono">{refill.in_stock_qty || 0}</strong></div>
                                </div>
                              </div>
                              <div className="pt-2 border-t border-glass-border/30 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => !inCart && liveCartAddEvent.triggerOpen(refill.medicine_name, refill.quantity_needed || 1)}
                                  disabled={inCart}
                                  className={`flex-1 py-1.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${inCart ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default' : 'bg-primary text-white hover:bg-primary/80 active:scale-95 cursor-pointer'}`}
                                >
                                  {inCart ? <CheckCircle2 size={14} className="text-emerald-400" /> : <ShoppingCart size={14} />}
                                  <span>{inCart ? '✓ In Live Cart' : 'Add to Cart'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Category 3: Sales Restock Suggestions */}
                  {filteredReorderSuggestions.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-1.5 border-b border-emerald-500/20">
                        <TrendingUp size={14} className="text-emerald-400" />
                        <span className="text-xs font-black text-emerald-400 uppercase tracking-wider">
                          Sales Restock Suggestions ({filteredReorderSuggestions.length})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredReorderSuggestions.map((sug) => (
                          <div key={`all-sug-${sug.medicineId}`} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-extrabold text-xs text-text truncate">{highlightMatch(sug.medicineName, reorderSearchQuery)}</span>
                                  {sug.packaging && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-bg3 text-muted border border-glass-border/40 font-mono shrink-0">
                                      {sug.packaging}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                                  {sug.isHotMover ? '🔥 Hot Mover' : '⚠️ Low Stock'}
                                </span>
                              </div>
                              <div className="text-xs text-muted space-y-1">
                                <div>📊 Past {reorderWindowMonths} {reorderWindowMonths === 1 ? 'Month' : 'Months'} Sold: <strong className="text-text font-mono">{sug.twoMonthSales ?? sug.sixMonthTotalSales ?? 0}</strong> units</div>
                                <div>📦 Current Stock: <strong className="text-rose-400 font-mono">{sug.currentStock}</strong> strips</div>
                              </div>
                            </div>
                            <div className="pt-2 border-t border-glass-border/30 flex items-center justify-between gap-2">
                              <div className="text-xs font-bold text-muted">
                                Need: <strong className="text-emerald-400 font-mono text-xs">{sug.suggestedQty}</strong> qty
                              </div>
                              {(() => {
                                const inCart = isMedicineInAnyCart(sug.medicineName);
                                return (
                                  <button
                                    type="button"
                                    onClick={() => !inCart && liveCartAddEvent.triggerOpen(sug.medicineName, sug.suggestedQty)}
                                    disabled={inCart}
                                    className={`py-1 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all whitespace-nowrap ${inCart ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default' : 'bg-emerald-500 hover:bg-emerald-600 text-white active:scale-95 cursor-pointer shadow-xs'}`}
                                  >
                                    {inCart ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Plus size={13} />}
                                    <span>{inCart ? '✓ In Live Cart' : `+ Add (${sug.suggestedQty})`}</span>
                                  </button>
                                );
                              })()}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Category 4: Ordered Recently */}
                  {filteredReorderRecentItems.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-1.5 border-b border-violet-500/20">
                        <RotateCw size={14} className="text-violet-400" />
                        <span className="text-xs font-black text-violet-400 uppercase tracking-wider">
                          Ordered Recently ({filteredReorderRecentItems.length})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredReorderRecentItems.map((item, idx) => {
                          const itemKey = `all-recent-${item.medicineName}:::${item.storeId || item.storeName || idx}`;
                          const rawKey = `${item.medicineName}:::${item.storeId || item.storeName || idx}`;
                          const itemQty = getReorderItemQty(rawKey, 1);
                          return (
                            <div key={itemKey} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                              <div className="space-y-2.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-extrabold text-xs text-text truncate" title={item.medicineName}>
                                      {highlightMatch(item.medicineName, reorderSearchQuery)}
                                    </div>
                                    {item.packaging && (
                                      <span className="inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-bg3 text-muted border border-glass-border/40 font-mono">
                                        {item.packaging}
                                      </span>
                                    )}
                                  </div>
                                  {item.receiptStatus === 'RECEIVED' ? (
                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono shrink-0 flex items-center gap-1">
                                      <CheckCircle2 size={10} /> Received
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-mono shrink-0 flex items-center gap-1">
                                      <Clock size={10} /> In-Transit
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <Store size={12} className="text-violet-400 shrink-0" />
                                    <span className="truncate">Supplied by: <strong className="text-text font-bold">{item.storeName || item.lastDistributorName || 'Distributor'}</strong></span>
                                  </div>
                                </div>
                              </div>
                              <div className="pt-2.5 border-t border-glass-border/30 flex items-center justify-between gap-2">
                                <span className="text-xs text-muted font-bold">Qty: {itemQty}</span>
                                <button
                                  type="button"
                                  onClick={() => handleReorderDirect(item, itemQty, item.storeId ?? undefined, item.storeName || item.lastDistributorName)}
                                  disabled={readdingSentItems}
                                  className="py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer shadow-xs disabled:opacity-50"
                                >
                                  <ShoppingCart size={12} />
                                  <span>Reorder</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Category 5: Past Purchase Bills */}
                  {filteredPurchaseHistoryItems.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-1.5 border-b border-sky-500/20">
                        <BookOpen size={14} className="text-sky-400" />
                        <span className="text-xs font-black text-sky-400 uppercase tracking-wider">
                          Past Purchase Bills ({filteredPurchaseHistoryItems.length})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredPurchaseHistoryItems.map((item, idx) => {
                          const itemKey = `all-purchase:::${item.medicineId || item.medicineName}:::${item.storeId || item.storeName || idx}`;
                          const rawKey = `purchase:::${item.medicineId || item.medicineName}:::${item.storeId || item.storeName || idx}`;
                          const itemQty = getReorderItemQty(rawKey, 1);
                          return (
                            <div key={itemKey} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                              <div className="space-y-2.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-extrabold text-xs text-text truncate" title={item.medicineName}>
                                      {highlightMatch(item.medicineName, reorderSearchQuery)}
                                    </div>
                                    {item.manufacturer && (
                                      <p className="text-[10px] text-muted truncate mt-0.5">{item.manufacturer}</p>
                                    )}
                                  </div>
                                  {item.billCount && (
                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-mono shrink-0 flex items-center gap-1">
                                      <Star size={9} className="fill-amber-400" /> ×{item.billCount} bills
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <Store size={12} className="text-sky-400 shrink-0" />
                                    <span className="truncate">Distributor: <strong className="text-text font-bold">{item.lastDistributorName || item.storeName || 'Distributor'}</strong></span>
                                  </div>
                                </div>
                              </div>
                              <div className="pt-2.5 border-t border-glass-border/30 flex items-center justify-between gap-2">
                                <span className="text-xs text-muted font-bold">Qty: {itemQty}</span>
                                <button
                                  type="button"
                                  onClick={() => handleReorderDirect(item, itemQty, item.storeId ?? undefined, item.storeName || item.lastDistributorName)}
                                  disabled={readdingSentItems}
                                  className="py-1.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer shadow-xs disabled:opacity-50"
                                >
                                  <ShoppingCart size={12} />
                                  <span>Add to Cart</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}

            {/* Special Shortage Requests */}
            {shortagesSubTab === 'requests' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-2xl bg-primary/10 border border-primary/20 text-xs">
                  <div className="flex items-center gap-2 text-text font-bold">
                    <Globe size={15} className="text-primary" />
                    <span>Manage all online website and shortage requests in the Split-Pane view</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSearchParams({ tab: 'online-orders' })}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-primary text-white font-bold hover:bg-primary/80 transition-all cursor-pointer shadow-xs active:scale-95"
                  >
                    <span>Open Split-Pane View</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
                {filteredPendingOrders.length === 0 ? (
                  <div className="text-center py-16 text-xs text-muted italic">
                    {reorderSearchQuery ? `No special shortage requests matching "${reorderSearchQuery}".` : 'No pending customer special shortage orders found.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredPendingOrders.map((order) => {
                      const inCart = Boolean(getOrderItemInCart(order));
                      return (
                        <div key={order.id} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-xs text-text">{highlightMatch(order.product, reorderSearchQuery)}</span>
                              <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${order.priority === 'Urgent' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-bg3 text-muted border border-glass-border'
                                }`}>
                                {order.priority || 'Normal'}
                              </span>
                            </div>

                            <div className="text-xs text-muted space-y-1">
                              <div>Customer: <strong className="text-text">{order.requester}</strong> ({order.phone})</div>
                              <div>Required Qty: <strong className="text-primary font-mono">{order.qty || 1}</strong></div>
                              {order.advance_payment ? <div>Advance Paid: <strong className="text-emerald-400 font-mono">₹{order.advance_payment}</strong></div> : null}
                              {order.pharmarack_distributor && <div>Assigned Dist: <strong className="text-text">{order.pharmarack_distributor}</strong></div>}
                            </div>
                          </div>

                          <div className="pt-2 border-t border-glass-border/30 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => !inCart && liveCartAddEvent.triggerOpen(order.product, order.qty, order.id)}
                              disabled={inCart}
                              className={`flex-1 py-1.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${inCart ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default' : 'bg-primary text-white hover:bg-primary/80 active:scale-95 cursor-pointer'}`}
                            >
                              {inCart ? <CheckCircle2 size={14} className="text-emerald-400" /> : <ShoppingCart size={14} />}
                              <span>{inCart ? '✓ In Live Cart' : 'Add to Cart'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Refills Due */}
            {shortagesSubTab === 'refills' && (
              filteredPendingRefills.length === 0 ? (
                <div className="text-center py-16 text-sm text-muted italic">
                  {reorderSearchQuery ? `No refills matching "${reorderSearchQuery}".` : 'No patient refills due within the next 7 days.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredPendingRefills.map((refill) => {
                    const inCart = Boolean(getRefillItemInCart(refill));
                    return (
                      <div key={refill.id} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-sm text-text">{highlightMatch(refill.medicine_name || '', reorderSearchQuery)}</span>
                            <span className="text-[11px] font-mono font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
                              Due: {refill.next_refill_date ? new Date(refill.next_refill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Soon'}
                            </span>
                          </div>

                          <div className="text-sm text-muted space-y-1">
                            <div>Patient: <strong className="text-text">{refill.patient_name}</strong> ({refill.patient_phone})</div>
                            <div>Needed: <strong className="text-primary font-mono">{refill.quantity_needed || 1}</strong> | In Stock: <strong className="text-text font-mono">{refill.in_stock_qty || 0}</strong></div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-glass-border/30 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => !inCart && liveCartAddEvent.triggerOpen(refill.medicine_name, refill.quantity_needed || 1)}
                            disabled={inCart}
                            className={`flex-1 py-1.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${inCart ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default' : 'bg-primary text-white hover:bg-primary/80 active:scale-95 cursor-pointer'}`}
                          >
                            {inCart ? <CheckCircle2 size={14} className="text-emerald-400" /> : <ShoppingCart size={14} />}
                            <span>{inCart ? '✓ In Live Cart' : 'Add to Cart'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* Smart Sales Restock */}
            {shortagesSubTab === 'sales_suggestions' && (
              filteredReorderSuggestions.length === 0 ? (
                <div className="text-center py-16 text-xs text-muted italic">
                  {reorderSearchQuery ? `No sales restock suggestions matching "${reorderSearchQuery}".` : 'No sales reorder suggestions currently flagged.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredReorderSuggestions.map((sug) => (
                    <div key={sug.medicineId} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-extrabold text-xs text-text truncate">{highlightMatch(sug.medicineName, reorderSearchQuery)}</span>
                            {sug.packaging && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-bg3 text-muted border border-glass-border/40 font-mono shrink-0">
                                {sug.packaging}
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                            {sug.isHotMover ? '🔥 Hot Mover' : '⚠️ Low Stock'}
                          </span>
                        </div>

                        <div className="text-xs text-muted space-y-1">
                          <div>📊 Past {reorderWindowMonths} {reorderWindowMonths === 1 ? 'Month' : 'Months'} Sold: <strong className="text-text font-mono">{sug.twoMonthSales ?? sug.sixMonthTotalSales ?? 0}</strong> units</div>
                          <div>📦 Current Stock: <strong className="text-rose-400 font-mono">{sug.currentStock}</strong> strips</div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-glass-border/30 flex items-center justify-between gap-2">
                        <div className="text-xs font-bold text-muted">
                          Need: <strong className="text-emerald-400 font-mono text-xs">{sug.suggestedQty}</strong> qty
                        </div>

                        <div className="flex items-center gap-1.5">
                          <select
                            onChange={async (e) => {
                              const val = e.target.value;
                              if (!val) return;
                              const [days, type] = val === '7' ? [7, '7_days'] : val === '30' ? [30, '30_days'] : [3650, 'permanent'];
                              await api.snoozeReorderSuggestion(sug.medicineId, days as number, type as string);
                              fetchReorderSuggestions();
                              toastEvent.trigger(`Snoozed ${sug.medicineName}${type === 'permanent' ? ' permanently' : ` for ${days} days`}`, 'info');
                              e.target.value = '';
                            }}
                            defaultValue=""
                            className="py-1 px-2 rounded-xl bg-bg2 hover:bg-bg3 border border-glass-border text-muted hover:text-text text-[10px] font-medium transition-all cursor-pointer"
                            title="Ignore this suggestion"
                          >
                            <option value="" disabled>Ignore…</option>
                            <option value="7">7 days</option>
                            <option value="30">30 days</option>
                            <option value="permanent">Permanently</option>
                          </select>

                          {(() => {
                            const inCart = isMedicineInAnyCart(sug.medicineName);
                            return (
                              <button
                                type="button"
                                onClick={() => !inCart && liveCartAddEvent.triggerOpen(sug.medicineName, sug.suggestedQty)}
                                disabled={inCart}
                                className={`py-1 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all whitespace-nowrap ${inCart ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default' : 'bg-emerald-500 hover:bg-emerald-600 text-white active:scale-95 cursor-pointer shadow-xs'}`}
                              >
                                {inCart ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Plus size={13} />}
                                <span>{inCart ? '✓ In Live Cart' : `+ Add (${sug.suggestedQty})`}</span>
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Ordered Recently */}
            {shortagesSubTab === 'ordered_recently' && (
              filteredReorderRecentItems.length === 0 ? (
                <div className="text-center py-16 text-xs text-muted italic">
                  {reorderSearchQuery ? `No recently ordered medicines matching "${reorderSearchQuery}".` : 'No medicines ordered in the configured lookback window.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredReorderRecentItems.map((item, idx) => {
                    const itemKey = `${item.medicineName}:::${item.storeId || item.storeName || idx}`;
                    const itemQty = getReorderItemQty(itemKey, 1);
                    const stockInfo = checkedStockMap[item.medicineName];
                    const isCheckingStock = checkingStockMed === item.medicineName;
                    const highestStock = stockInfo?.highestStockDistributor || item.highestStockDistributor;
                    const hasHighStock = Boolean(highestStock && highestStock.availability > 0);
                    const isDiffDistributor = hasHighStock && highestStock?.storeId !== item.storeId;

                    return (
                      <div key={itemKey} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                        <div className="space-y-2.5">
                          {/* Medicine Title & Packaging */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-extrabold text-xs text-text truncate" title={item.medicineName}>
                                {highlightMatch(item.medicineName, reorderSearchQuery)}
                              </div>
                              {item.packaging && (
                                <span className="inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-bg3 text-muted border border-glass-border/40 font-mono">
                                  {item.packaging}
                                </span>
                              )}
                            </div>

                            {/* Inward / Receipt Status */}
                            {item.receiptStatus === 'RECEIVED' ? (
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono shrink-0 flex items-center gap-1" title={`Inwarded in Invoice ${item.receivedInvoiceNo || ''}`}>
                                <CheckCircle2 size={10} /> Received
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-mono shrink-0 flex items-center gap-1" title="Dispatched from distributor — awaiting store arrival">
                                <Clock size={10} /> In-Transit
                              </span>
                            )}
                          </div>

                          {/* Distributor Attribution & Order Reference */}
                          <div className="text-xs text-muted space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Store size={12} className="text-violet-400 shrink-0" />
                              <span className="truncate">Supplied by: <strong className="text-text font-bold">{item.storeName || item.lastDistributorName || 'Distributor'}</strong></span>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span>Last Ordered: <strong className="text-text font-mono">{item.lastOrderedDate}</strong></span>
                              {item.orderId && (
                                <span className="text-[10px] font-mono text-muted/80">Order #{item.orderId}</span>
                              )}
                            </div>
                            {item.ptr ? (
                              <div className="text-[11px]">
                                Last PTR: <strong className="text-emerald-400 font-mono">₹{item.ptr.toFixed(2)}</strong>
                                {item.mrp ? <span className="text-muted ml-1.5">MRP: ₹{item.mrp.toFixed(2)}</span> : null}
                              </div>
                            ) : null}
                          </div>

                          {/* On-Demand Stock Check Trigger / Results */}
                          {!stockInfo && !item.highestStockDistributor ? (
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() => handleCheckStock(item.medicineName)}
                                disabled={isCheckingStock}
                                className="w-full py-1.5 px-2.5 rounded-xl bg-bg2 hover:bg-bg3 border border-glass-border text-muted hover:text-text text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                                title="Check live stock only for this medicine"
                              >
                                {isCheckingStock ? (
                                  <>
                                    <Loader2 size={12} className="animate-spin text-primary" />
                                    <span>Checking live stock…</span>
                                  </>
                                ) : (
                                  <>
                                    <Zap size={11} className="text-amber-400" />
                                    <span>Check Highest Stock</span>
                                  </>
                                )}
                              </button>
                            </div>
                          ) : hasHighStock && highestStock ? (
                            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-[11px] text-text flex items-center justify-between gap-1">
                              <div className="min-w-0 flex items-center gap-1.5">
                                <Zap size={12} className="text-primary shrink-0" />
                                <span className="truncate">
                                  Highest Stock: <strong>{highestStock.storeName}</strong>
                                </span>
                              </div>
                              <span className="font-mono font-bold text-emerald-400 shrink-0">
                                {highestStock.availability} in stock
                              </span>
                            </div>
                          ) : (
                            <div className="p-1.5 rounded-xl bg-bg3/30 border border-glass-border/30 text-[10px] text-muted flex items-center gap-1.5">
                              <AlertCircle size={11} className="text-muted/60 shrink-0" />
                              <span>No alternate stock found in catalog</span>
                            </div>
                          )}
                        </div>

                        {/* Bottom: Inline Quantity Stepper + Reorder Actions */}
                        <div className="pt-2.5 border-t border-glass-border/30 space-y-2">
                          {/* Stepper */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-muted">Reorder Qty:</span>
                            <div className="flex items-center gap-1 bg-bg border border-glass-border rounded-xl p-0.5">
                              <button
                                type="button"
                                onClick={() => setReorderItemQty(itemKey, itemQty - 1)}
                                disabled={itemQty <= 1}
                                className="w-6 h-6 rounded-lg bg-bg2 hover:bg-bg3 text-muted hover:text-text flex items-center justify-center text-xs font-bold disabled:opacity-40 cursor-pointer"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="1"
                                value={itemQty}
                                onChange={(e) => setReorderItemQty(itemKey, parseInt(e.target.value, 10) || 1)}
                                className="w-10 text-center font-mono text-xs font-bold text-text bg-transparent focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => setReorderItemQty(itemKey, itemQty + 1)}
                                className="w-6 h-6 rounded-lg bg-bg2 hover:bg-bg3 text-muted hover:text-text flex items-center justify-center text-xs font-bold cursor-pointer"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1.5">
                            {(() => {
                              const inCart = isMedicineInAnyCart(item.medicineName);
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleReorderDirect(item, itemQty, item.storeId ?? undefined, item.storeName || item.lastDistributorName)}
                                  disabled={readdingSentItems || inCart}
                                  className={`flex-1 py-1.5 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs ${inCart ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default' : 'bg-purple-600 hover:bg-purple-700 text-white active:scale-95 cursor-pointer disabled:opacity-50'}`}
                                  title={inCart ? `${item.medicineName} is already in the live cart` : `Reorder from ${item.storeName || item.lastDistributorName}`}
                                >
                                  {inCart ? <CheckCircle2 size={12} className="text-emerald-400" /> : <ShoppingCart size={12} />}
                                  <span className="truncate">{inCart ? '✓ In Live Cart' : `Reorder (x{itemQty})`}</span>
                                </button>
                              );
                            })()}

                            {isDiffDistributor && highestStock && (
                              <button
                                type="button"
                                onClick={() => handleReorderDirect(item, itemQty, highestStock.storeId, highestStock.storeName)}
                                disabled={readdingSentItems}
                                className="py-1.5 px-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer shadow-xs whitespace-nowrap"
                                title={`Switch and reorder from ${highestStock.storeName} (${highestStock.availability} in stock)`}
                              >
                                <Zap size={11} />
                                <span>Highest Stock</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => liveCartAddEvent.triggerOpen(item.medicineName, itemQty)}
                              className="p-1.5 rounded-xl bg-bg2 hover:bg-bg3 border border-glass-border text-muted hover:text-text transition-all active:scale-95 cursor-pointer"
                              title="Search across all available distributors in modal"
                            >
                              <Search size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* Past Purchase Bills */}
            {shortagesSubTab === 'past_purchases' && (
              purchaseHistoryLoading && purchaseHistoryItems.length === 0 ? (
                <div className="text-center py-16 text-xs text-muted flex items-center justify-center gap-2">
                  <RotateCw size={15} className="animate-spin text-primary" />
                  <span>Loading past purchase bills history…</span>
                </div>
              ) : filteredPurchaseHistoryItems.length === 0 ? (
                <div className="text-center py-16 text-xs text-muted italic">
                  {reorderSearchQuery ? `No past purchase medicines matching "${reorderSearchQuery}".` : 'No purchase bills recorded in the past 6 months.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredPurchaseHistoryItems.map((item, idx) => {
                    const itemKey = `purchase:::${item.medicineId || item.medicineName}:::${item.storeId || item.storeName || idx}`;
                    const itemQty = getReorderItemQty(itemKey, 1);

                    return (
                      <div key={itemKey} className="p-4 rounded-2xl border border-glass-border/70 bg-bg2/40 flex flex-col justify-between gap-3 shadow-sm hover:border-glass-border transition-all">
                        <div className="space-y-2.5">
                          {/* Medicine Title & Frequency Badge */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-extrabold text-xs text-text truncate" title={item.medicineName}>
                                {highlightMatch(item.medicineName, reorderSearchQuery)}
                              </div>
                              {item.manufacturer && (
                                <p className="text-[10px] text-muted truncate mt-0.5">
                                  {item.manufacturer}
                                </p>
                              )}
                            </div>

                            {item.billCount && (
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-mono shrink-0 flex items-center gap-1" title={`Purchased in ${item.billCount} bills`}>
                                <Star size={9} className="fill-amber-400" /> ×{item.billCount} bills
                              </span>
                            )}
                          </div>

                          {/* Distributor Attribution & Pricing */}
                          <div className="text-xs text-muted space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Store size={12} className="text-sky-400 shrink-0" />
                              <span className="truncate">Distributor: <strong className="text-text font-bold">{item.lastDistributorName || item.storeName || 'Distributor'}</strong></span>
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <span>Last Invoice Date: <strong className="text-text font-mono">{item.lastOrderedDate || 'N/A'}</strong></span>
                            </div>
                            {item.ptr ? (
                              <div className="text-[11px]">
                                Last PTR: <strong className="text-emerald-400 font-mono">₹{item.ptr.toFixed(2)}</strong>
                                {item.mrp ? <span className="text-muted ml-1.5">MRP: ₹{item.mrp.toFixed(2)}</span> : null}
                              </div>
                            ) : null}
                          </div>

                          {/* Quantity Controls */}
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs text-muted">Order Qty:</span>
                            <div className="flex items-center gap-1 bg-bg3/60 rounded-xl p-1 border border-glass-border/40">
                              <button
                                type="button"
                                onClick={() => setReorderItemQty(itemKey, Math.max(1, itemQty - 1))}
                                className="w-6 h-6 rounded-lg bg-bg2 hover:bg-bg border border-glass-border flex items-center justify-center text-xs font-bold text-muted hover:text-text cursor-pointer transition-all active:scale-95"
                              >
                                -
                              </button>
                              <span className="w-8 text-center font-mono font-bold text-xs text-text">{itemQty}</span>
                              <button
                                type="button"
                                onClick={() => setReorderItemQty(itemKey, itemQty + 1)}
                                className="w-6 h-6 rounded-lg bg-bg2 hover:bg-bg border border-glass-border flex items-center justify-center text-xs font-bold text-muted hover:text-text cursor-pointer transition-all active:scale-95"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1.5">
                            {(() => {
                              const inCart = isMedicineInAnyCart(item.medicineName);
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleReorderDirect(item, itemQty, item.storeId ?? undefined, item.storeName || item.lastDistributorName)}
                                  disabled={readdingSentItems || inCart}
                                  className={`flex-1 py-1.5 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs ${inCart ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 opacity-80 cursor-default' : 'bg-sky-600 hover:bg-sky-500 text-white active:scale-95 cursor-pointer disabled:opacity-50'}`}
                                  title={inCart ? `${item.medicineName} is already in the live cart` : `Add to live cart of ${item.storeName || item.lastDistributorName}`}
                                >
                                  {inCart ? <CheckCircle2 size={12} className="text-emerald-400" /> : <ShoppingCart size={12} />}
                                  <span className="truncate">{inCart ? '✓ In Live Cart' : `Add to Cart (x${itemQty})`}</span>
                                </button>
                              );
                            })()}

                            <button
                              type="button"
                              onClick={() => liveCartAddEvent.triggerOpen(item.medicineName, itemQty)}
                              className="p-1.5 rounded-xl bg-bg2 hover:bg-bg3 border border-glass-border text-muted hover:text-text transition-all active:scale-95 cursor-pointer"
                              title="Search across all available distributors in modal"
                            >
                              <Search size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden bg-transparent border border-glass-border/40 rounded-3xl min-h-0">
          {/* ── Top Header ── */}
          <div className="h-16 border-b border-glass-border/40 px-6 flex items-center justify-between shrink-0 bg-transparent">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <ShoppingCart size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text tracking-wide uppercase leading-none flex items-center gap-2">
                  Pharmarack Cart
                  {isCartFromCache && (
                    <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/30">
                      ● CACHED
                    </span>
                  )}
                  {sessionStatus === 'active' && (
                    <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                      ● LIVE READY{typeof sessionDaysLeft === 'number' ? ` (${sessionDaysLeft}d left)` : ''}
                    </span>
                  )}
                  {sessionStatus === 'restoring' && (
                    <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-400 border-blue-500/30 flex items-center gap-1">
                      <Loader2 size={10} className="animate-spin" /> RESTORING…
                    </span>
                  )}
                  {sessionStatus === 'connection_issue' && (
                    <button
                      type="button"
                      onClick={() => { checkSession(); fetchCart(true); }}
                      className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20 cursor-pointer flex items-center gap-1"
                      title="Connection issue. Click to retry."
                    >
                      CONNECTION ISSUE ↺
                    </button>
                  )}
                  {sessionStatus === 'expired' && (
                    <button
                      type="button"
                      onClick={handleReconnect}
                      className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20 cursor-pointer flex items-center gap-1"
                      title="Session expired. Click to reconnect."
                    >
                      SESSION EXPIRED — RECONNECT
                    </button>
                  )}
                  {sessionStatus === null && !isCartFromCache && (
                    <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                      ● LIVE
                    </span>
                  )}
                </h3>
                <p className="text-[10px] text-muted tracking-wider mt-1">
                  {lastFetched
                    ? `Last synced ${lastFetched.toLocaleTimeString()}`
                    : 'Syncing with Pharmarack…'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleToggleAllPreviousItems(true)}
                disabled={previousOrderItemsInfo.length === 0 || previousOrderItemsInfo.every(x => x.isChecked)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold transition-all active:scale-95 text-xs disabled:opacity-40 shadow-sm cursor-pointer"
                title="Select all previous medicines to include in today's active dispatch"
              >
                <Check size={13} />
                <span>Reorder All ({previousOrderItemsInfo.length})</span>
              </button>

              <button
                onClick={handleManualRefresh}
                disabled={loading || isRefreshing}
                className="group p-2 rounded-lg bg-bg3/30 border border-glass-border hover:border-emerald-500/40 hover:bg-emerald-500/10 text-muted hover:text-emerald-400 transition-all active:scale-90 flex items-center justify-center disabled:opacity-50 hover:shadow-[0_0_12px_rgba(16,185,129,0.2)] cursor-pointer"
                title="Refresh Cart Contents"
              >
                <RotateCcw
                  size={14}
                  className={`transition-transform duration-500 ${isRefreshing || loading ? 'animate-spin text-emerald-400' : 'group-hover:-rotate-180 text-muted group-hover:text-emerald-400'}`}
                />
              </button>

              {lastBatchSentTime && (
                <span className="text-[10px] text-emerald-400 font-extrabold px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-1 shrink-0">
                  <Clock size={11} className="text-emerald-400" />
                  Last Batch: {lastBatchSentTime}
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  api.openOfficialPharmarackCartWindow().catch(() => {
                    window.open('https://retailers.pharmarack.com/cart', '_blank');
                  });
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg3/30 border border-glass-border text-muted hover:text-text hover:bg-bg3 transition-all text-xs font-bold active:scale-95 cursor-pointer"
                title="Open Authenticated Cart on retailers.pharmarack.com"
              >
                <ExternalLink size={13} />
                <span>Open Cart Window</span>
              </button>
            </div>
          </div>

          {/* ── Main Area ── */}
          <div className="flex-1 flex overflow-hidden min-h-0">

            {/* Main live cart contents */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-transparent">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
                  <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                  <p className="text-xs text-muted font-bold tracking-wider uppercase animate-pulse">
                    Fetching Live Cart…
                  </p>
                </div>
              ) : (error && distributors.length === 0) ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 max-w-md mx-auto text-center py-12">
                  <AlertCircle size={32} className="text-red/80" />
                  <div>
                    <p className="text-sm font-bold text-text">Failed to fetch cart</p>
                    <p className="text-xs text-muted mt-1">{error}</p>
                  </div>
                  {(error.toLowerCase().includes('login') || error.toLowerCase().includes('session') || error.toLowerCase().includes('unauthorized') || error.toLowerCase().includes('token')) ? (
                    <div className="flex flex-col gap-2 w-full max-w-xs">
                      <button
                        onClick={async () => {
                          try {
                            toastEvent.trigger('Opening Pharmarack Login window...', 'info');
                            await api.launchPharmarackLoginWindow();
                          } catch (err: unknown) {
                            toastEvent.trigger((err as LocalApiError)?.response?.data?.error || 'Failed to launch login window', 'error');
                          }
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition-all shadow-[0_4px_12px_rgba(16,185,129,0.2)]"
                      >
                        <ExternalLink size={13} />
                        <span>Link Pharmarack Account</span>
                      </button>
                      <button
                        onClick={() => fetchCart(true)}
                        className="w-full px-4 py-2 rounded-xl bg-bg2 border border-glass-border text-muted hover:text-text hover:bg-bg3 text-xs font-bold transition-all"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fetchCart(true)}
                      className="premium-btn bg-primary text-white px-4 py-2 hover:bg-primary/80 text-xs font-bold"
                    >
                      Retry
                    </button>
                  )}
                </div>
              ) : distributors.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
                  <ShoppingCart size={48} className="text-muted/30" />
                  <div>
                    <p className="text-sm font-bold text-text">Your cart is empty</p>
                    <p className="text-xs text-muted mt-1">Add items using the Live Cart Add feature or from Pharmarack directly.</p>
                  </div>
                </div>
              ) : (
                <>
                  {error && (
                    <div className="mx-6 mt-3 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-xs text-amber-400">
                      <span className="flex items-center gap-2">
                        <AlertTriangle size={14} className="shrink-0" />
                        Showing cached cart. Live refresh failed: {error}
                      </span>
                      <button
                        onClick={() => fetchCart(true)}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 font-bold transition-all cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {/* ── Sticky Sub-Filter Toggle Bar (Unsent Cart Orders / Sent Orders / All / Failed / Missing Phone) ── */}
                  <div className="sticky top-0 z-10 bg-bg/40 px-6 py-3 border-b border-glass-border/30 shrink-0 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1.5 bg-bg3/30 p-1 rounded-xl border border-glass-border/30 text-xs font-bold select-none overflow-x-auto">
                      <button
                        onClick={() => setDistributorFilterTab('active')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${distributorFilterTab === 'active' || distributorFilterTab === 'unsent'
                          ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm font-extrabold'
                          : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                          }`}
                      >
                        <ShoppingCart size={13} />
                        <span>Unsent Cart Orders</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary border border-primary/20 font-mono font-bold">
                          {unsentCartDistributors.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('success')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${distributorFilterTab === 'success' || distributorFilterTab === 'sent'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm font-extrabold'
                          : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                          }`}
                      >
                        <Check size={13} className="text-emerald-400" />
                        <span>Sent Orders</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-bold">
                          {sentCartDistributors.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('all')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${distributorFilterTab === 'all'
                          ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm font-extrabold'
                          : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                          }`}
                      >
                        <Building2 size={13} />
                        <span>All Items ({distributors.length})</span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('failed')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${distributorFilterTab === 'failed'
                          ? 'bg-red/20 text-red border border-red/30 shadow-sm font-extrabold'
                          : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                          }`}
                      >
                        <AlertCircle size={13} className="text-red" />
                        <span>Failed</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-red/10 text-red border border-red/20 font-mono font-bold">
                          {failedDistributors.length}
                        </span>
                      </button>

                      <button
                        onClick={() => setDistributorFilterTab('unmapped')}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${distributorFilterTab === 'unmapped'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm font-extrabold'
                          : 'text-muted hover:text-text hover:bg-bg3/50 border border-transparent'
                          }`}
                      >
                        <Phone size={13} className="text-amber-400" />
                        <span>Missing Phone</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-mono font-bold">
                          {unmappedDistributors.length}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* ── Scrollable Distributor Cards Panel ── */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0 custom-scrollbar">

                    {/* ── Auto-Reconciled Paid Orders Review Tray (Human-in-the-Loop) ── */}
                    {autoReconciledItems.length > 0 && (
                      <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-500/40 text-sky-400 flex items-center justify-center shrink-0">
                              <CheckCircle2 size={16} />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-text flex items-center gap-2">
                                Auto-Reconciled Paid Orders
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-sky-500/20 text-sky-400 border border-sky-500/30 font-mono">
                                  {autoReconciledItems.length} Cleared
                                </span>
                              </h4>
                              <p className="text-[11px] text-muted">
                                The following items were automatically cleared from active distributor carts because payments are confirmed and orders are fulfilled/received.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAutoReconciledItems([])}
                            className="text-muted hover:text-text p-1 rounded-lg hover:bg-bg3/60 transition-all text-xs font-bold"
                            title="Dismiss alert"
                          >
                            <X size={14} />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {autoReconciledItems.map((rec, idx) => (
                            <div key={idx} className="p-2.5 rounded-xl bg-bg border border-border/80 text-xs flex items-center justify-between gap-2 shadow-xs">
                              <div className="min-w-0">
                                <div className="font-bold text-text truncate">{rec.productName}</div>
                                <div className="text-[10px] text-muted truncate">
                                  {rec.storeName} • Qty: {rec.qty}
                                </div>
                                <div className="text-[9px] text-emerald-500 font-semibold truncate">
                                  Order #{rec.orderId} Paid
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await api.addPharmarackCart([{
                                      productId: (rec as any).productId || rec.productCode || 0,
                                      productName: rec.productName,
                                      productCode: rec.productCode,
                                      storeId: rec.storeId,
                                      storeName: rec.storeName,
                                      qty: rec.qty || 1,
                                      packaging: '1 strip'
                                    }]);
                                    toastEvent.trigger(`Restored ${rec.productName} to cart`, 'success');
                                    setAutoReconciledItems(prev => prev.filter((_, i) => i !== idx));
                                    void fetchCart();
                                  } catch {
                                    toastEvent.trigger('Failed to restore item', 'error');
                                  }
                                }}
                                className="shrink-0 px-2 py-1 rounded-lg bg-bg2 hover:bg-bg3 border border-border text-[10px] font-bold text-text hover:text-primary transition-all cursor-pointer"
                              >
                                Keep in Cart
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Missing Distributor Phone Alert: Concept 2 Inline Fast-Fill Resolution Hub ── */}
                    {unmappedDistributors.length > 0 && (() => {
                      const totalUnmappedInitially = unmappedDistributors.length + sessionResolvedCount;
                      const progressPercent = totalUnmappedInitially > 0 ? Math.round((sessionResolvedCount / totalUnmappedInitially) * 100) : 0;

                      return (
                        <div id="missing-distributors-hub" className="rounded-2xl border border-amber-500/30 bg-bg2/80 shadow-md overflow-hidden transition-all duration-300">
                          {/* Header Bar */}
                          <div className="px-4 py-3 bg-gradient-to-r from-amber-500/15 via-bg2 to-amber-500/10 border-b border-amber-500/20 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0 font-bold text-sm shadow-xs">
                                <Phone size={15} className="animate-pulse" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-extrabold text-xs text-text">
                                    Distributor Phone Resolution Hub
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono">
                                    {unmappedDistributors.length} Missing
                                  </span>
                                  {sessionResolvedCount > 0 && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono flex items-center gap-1">
                                      <CheckCircle2 size={10} /> {sessionResolvedCount} Resolved
                                    </span>
                                  )}
                                </div>
                                <span className="text-muted text-[11px] block truncate">
                                  Type 10-digit WhatsApp numbers and press <kbd className="px-1 py-0.5 rounded bg-bg3 border border-border text-[10px] font-mono text-text">Enter</kbd> to save & link instantly.
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {totalUnmappedInitially > 1 && (
                                <div className="hidden sm:flex items-center gap-2 pr-2 border-r border-border/50">
                                  <div className="w-24 h-2 rounded-full bg-bg3 overflow-hidden border border-border/40">
                                    <div
                                      className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-500"
                                      style={{ width: `${progressPercent}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono font-bold text-muted">
                                    {sessionResolvedCount}/{totalUnmappedInitially}
                                  </span>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => setIsResolutionHubCollapsed(!isResolutionHubCollapsed)}
                                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 border border-border/60 transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold"
                                title={isResolutionHubCollapsed ? 'Expand Resolution Hub' : 'Collapse Resolution Hub'}
                              >
                                {isResolutionHubCollapsed ? (
                                  <>
                                    <span className="text-[11px]">Show</span>
                                    <ChevronDown size={14} />
                                  </>
                                ) : (
                                  <>
                                    <span className="text-[11px]">Hide</span>
                                    <ChevronUp size={14} />
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Table Body (Expanded) */}
                          {!isResolutionHubCollapsed && (
                            <div className="p-3">
                              {/* Desktop Header */}
                              <div className="hidden md:grid grid-cols-12 gap-3 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-muted select-none border-b border-glass-border/40 mb-2">
                                <div className="col-span-5">Distributor & Cart Items</div>
                                <div className="col-span-5">10-Digit Mobile Number</div>
                                <div className="col-span-2 text-right">Actions</div>
                              </div>

                              <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                                {unmappedDistributors.map((d, index) => {
                                  const rawExisting = (getDistributorPhoneNumber(d) || '').replace(/\D/g, '').slice(-10);
                                  const currentInput = inlinePhones[d.storeId] !== undefined
                                    ? inlinePhones[d.storeId]
                                    : rawExisting;
                                  const digitsOnly = currentInput.replace(/\D/g, '');
                                  const isValid = /^[6789]\d{9}$/.test(digitsOnly);
                                  const isSavingThis = inlineSavingStoreId === d.storeId;
                                  const itemsCount = (d.items || []).length;
                                  const cartTotal = getDistributorFullTotal(d);

                                  return (
                                    <div
                                      key={d.storeId}
                                      className="grid grid-cols-1 md:grid-cols-12 gap-2.5 md:gap-3 items-center p-2.5 rounded-xl bg-bg3/30 hover:bg-bg3/60 border border-glass-border/60 transition-all"
                                    >
                                      {/* Column 1: Distributor Info */}
                                      <div className="md:col-span-5 flex items-center gap-2.5 min-w-0">
                                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 font-black text-xs flex items-center justify-center shrink-0">
                                          {d.storeName ? d.storeName.charAt(0).toUpperCase() : `#${index + 1}`}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <span
                                            className="text-xs font-extrabold text-text truncate block leading-tight hover:underline cursor-pointer"
                                            title={d.storeName}
                                            onClick={() => handleOpenEditModal(d)}
                                          >
                                            {d.storeName}
                                          </span>
                                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted">
                                            <span className="flex items-center gap-1 font-mono">
                                              <Package size={10} /> {itemsCount} {itemsCount === 1 ? 'item' : 'items'}
                                            </span>
                                            <span>•</span>
                                            <span className="font-mono font-bold text-text">
                                              ₹{cartTotal.toLocaleString('en-IN')}
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Column 2: Phone Input */}
                                      <div className="md:col-span-5">
                                        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg border transition-all ${isValid
                                            ? 'border-emerald-500/50 ring-1 ring-emerald-500/20'
                                            : digitsOnly.length > 0
                                              ? 'border-amber-500/50 ring-1 ring-amber-500/20'
                                              : 'border-border focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/20'
                                          }`}>
                                          <span className="text-xs font-mono font-bold text-muted select-none">
                                            +91
                                          </span>
                                          <input
                                            type="tel"
                                            maxLength={10}
                                            value={currentInput}
                                            onChange={(e) => {
                                              const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                                              setInlinePhones(prev => ({ ...prev, [d.storeId]: val }));
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' && isValid && !isSavingThis) {
                                                e.preventDefault();
                                                handleInlineSavePhone(d);
                                              }
                                            }}
                                            placeholder="Enter 10-digit number"
                                            className="flex-1 bg-transparent border-none outline-none text-xs font-mono font-semibold text-text placeholder:text-muted/40"
                                            disabled={isSavingThis}
                                          />
                                          {isValid && (
                                            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                                          )}
                                          {digitsOnly.length > 0 && !isSavingThis && (
                                            <button
                                              type="button"
                                              onClick={() => setInlinePhones(prev => ({ ...prev, [d.storeId]: '' }))}
                                              className="text-muted hover:text-text cursor-pointer p-0.5"
                                              title="Clear input"
                                            >
                                              <X size={12} />
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {/* Column 3: Actions */}
                                      <div className="md:col-span-2 flex items-center justify-end gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => handleInlineSavePhone(d)}
                                          disabled={!isValid || isSavingThis}
                                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center gap-1 shadow-xs shrink-0"
                                          title="Save and link phone number"
                                        >
                                          {isSavingThis ? (
                                            <>
                                              <RotateCw size={12} className="animate-spin" />
                                              <span>Saving</span>
                                            </>
                                          ) : (
                                            <>
                                              <Check size={12} />
                                              <span>Save</span>
                                            </>
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleOpenEditModal(d)}
                                          className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg2/80 border border-border/50 transition-all cursor-pointer"
                                          title="Advanced Directory Search / Match"
                                        >
                                          <Search size={13} />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── Top KPI Stat Cards ── */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2 shrink-0">
                      <div className="p-3 rounded-2xl bg-bg2/40 border border-glass-border/60 shadow-xs flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                          <ShoppingCart size={15} />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Ready to Send</span>
                          <span className="text-sm font-black text-text font-mono leading-none">
                            {distributors.reduce((acc, d) => acc + (d.items || []).filter(i => isItemIncludedInDispatch(i, d)).length, 0)} Items
                          </span>
                        </div>
                      </div>

                      <div
                        onClick={() => setSearchParams({ tab: 'reorder' })}
                        className="p-3 rounded-2xl bg-amber-500/[0.07] border border-amber-500/30 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-amber-500/[0.12] transition-all"
                      >
                        <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                          <Clock size={15} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider block">Previous Orders</span>
                          <span className="text-sm font-black text-text font-mono leading-none flex items-center justify-between">
                            <span>{previousOrderItemsInfo.length} Items</span>
                            <span className="text-[10px] text-amber-400 font-bold">Review Hub ➔</span>
                          </span>
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-bg2/40 border border-glass-border/60 shadow-xs flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                          <Building2 size={15} />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Suppliers</span>
                          <span className="text-sm font-black text-emerald-400 font-mono leading-none">
                            {distributors.length} Mapped
                          </span>
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-bg2/40 border border-glass-border/60 shadow-xs flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
                          <Truck size={15} />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Live Orders</span>
                          <span className="text-xs font-bold text-text truncate block leading-none">
                            Auto-Sync Active
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ── Previous Orders Reorder Banner ── */}
                    {previousOrderItemsInfo.length > 0 && (distributorFilterTab === 'active' || distributorFilterTab === 'unsent' || distributorFilterTab === 'all') && (() => {
                      const checkedCount = previousOrderItemsInfo.filter(x => x.isChecked).length;
                      const totalCount = previousOrderItemsInfo.length;
                      const allChecked = checkedCount === totalCount;
                      const noneChecked = checkedCount === 0;

                      // Group by distributor for expanded view
                      const byDist = new Map<number, { distName: string; items: typeof previousOrderItemsInfo }>();
                      for (const entry of previousOrderItemsInfo) {
                        const existing = byDist.get(entry.dist.storeId);
                        if (existing) existing.items.push(entry);
                        else byDist.set(entry.dist.storeId, { distName: entry.dist.storeName, items: [entry] });
                      }

                      return (
                        <div className={`rounded-xl border transition-all mb-1 ${noneChecked ? 'border-amber-500/40 bg-amber-500/[0.06]' : checkedCount > 0 ? 'border-amber-500/60 bg-amber-500/[0.10]' : 'border-amber-500/30 bg-amber-500/[0.04]'}`}>
                          {/* Header row */}
                          <div className="flex items-center justify-between px-4 py-3 gap-3">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <Clock size={14} className="text-amber-400 shrink-0" />
                              <div className="flex flex-col min-w-0">
                                <span className="text-[11px] font-extrabold text-amber-400 leading-tight">
                                  Previous Order — 1 Day Ago ({totalCount} {totalCount === 1 ? 'Medicine' : 'Medicines'} to Reorder)
                                </span>
                                <span className="text-[10px] text-muted">
                                  {noneChecked
                                    ? 'None selected — tick checkboxes to include in today\'s order'
                                    : `${checkedCount} of ${totalCount} selected in today's order — untick any you do not want to reorder`}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Open Reorder Hub Button */}
                              <button
                                onClick={() => setSearchParams({ tab: 'reorder' })}
                                className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-500/30 text-amber-300 border border-amber-500/50 hover:bg-amber-500/40 transition-all active:scale-95 cursor-pointer flex items-center gap-1"
                                title="Open dedicated Reorder Hub"
                              >
                                <span>Reorder Hub</span>
                                <ArrowRight size={10} />
                              </button>
                              {/* Select All */}
                              <button
                                onClick={() => handleToggleAllPreviousItems(true)}
                                disabled={allChecked}
                                className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40 transition-all active:scale-95 cursor-pointer"
                                title="Select all previous order medicines for reorder"
                              >
                                Select All
                              </button>
                              {/* Deselect All */}
                              <button
                                onClick={() => handleToggleAllPreviousItems(false)}
                                disabled={noneChecked}
                                className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-bg2 text-muted border border-border hover:bg-bg3 disabled:opacity-40 transition-all active:scale-95 cursor-pointer"
                                title="Deselect all — exclude previous order medicines from today's order"
                              >
                                Deselect All
                              </button>
                              {/* Expand / Collapse */}
                              <button
                                onClick={() => setReorderBannerCollapsed(v => !v)}
                                className="text-[10px] font-bold px-2 py-1 rounded-lg bg-bg2 text-muted border border-border hover:bg-bg3 transition-all active:scale-95 cursor-pointer"
                                title={reorderBannerCollapsed ? 'Show medicine list' : 'Collapse'}
                              >
                                {reorderBannerCollapsed ? '▸ Show' : '▾ Hide'}
                              </button>
                            </div>
                          </div>

                          {/* Expandable medicine list grouped by distributor */}
                          {!reorderBannerCollapsed && (
                            <div className="border-t border-amber-500/20 px-4 py-3 space-y-3">
                              {Array.from(byDist.entries()).map(([storeId, group]) => (
                                <div key={storeId}>
                                  <div className="text-[10px] font-extrabold text-amber-400/80 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                    <Building2 size={10} />
                                    {group.distName}
                                  </div>
                                  <div className="space-y-1">
                                    {group.items.map(({ item, isChecked, placedDateStr }) => (
                                      <div
                                        key={item.productCode || item.productName}
                                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all cursor-pointer hover:bg-amber-500/10 ${isChecked ? 'bg-amber-500/10' : 'bg-bg2/30'}`}
                                        onClick={() => handleToggleItemCheck(storeId, item, !isChecked)}
                                        title={isChecked ? 'Click to exclude from today\'s order' : 'Click to include in today\'s order'}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={e => handleToggleItemCheck(storeId, item, e.target.checked)}
                                          onClick={e => e.stopPropagation()}
                                          className="w-3.5 h-3.5 rounded text-amber-500 focus:ring-amber-500 cursor-pointer accent-amber-500 shrink-0"
                                        />
                                        <span className={`text-[11px] font-semibold flex-1 truncate ${isChecked ? 'text-text' : 'text-muted line-through opacity-70'}`}>
                                          {item.productName}
                                        </span>
                                        <span className="text-[10px] font-mono text-muted shrink-0">×{item.qty}</span>
                                        {isChecked ? (
                                          <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0 flex items-center gap-0.5">
                                            <Check size={8} />
                                            Reordering
                                          </span>
                                        ) : (
                                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-bg3/70 text-muted/70 border border-border/30 shrink-0">
                                            {placedDateStr}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {filteredDistributorList.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                        {distributorFilterTab === 'active' ? (
                          <>
                            <Check size={36} className="text-emerald-400/50" />
                            <p className="text-sm font-bold text-emerald-400">All Cart Orders Sent! 🎉</p>
                            <p className="text-xs text-muted max-w-sm">All items in your cart have been sent to distributors and saved in Sent Orders History.</p>
                            <button
                              onClick={() => setSearchParams({ tab: 'sent-history' })}
                              className="mt-2 px-4 py-2 rounded-xl bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5"
                            >
                              <Send size={13} />
                              <span>View Sent Orders History</span>
                            </button>
                          </>
                        ) : distributorFilterTab === 'success' ? (
                          <>
                            <MessageSquare size={36} className="text-muted/30" />
                            <p className="text-xs font-bold text-text">No Messages Sent Yet</p>
                            <p className="text-[11px] text-muted">Click "Send All via WhatsApp" to share orders automatically!</p>
                          </>
                        ) : distributorFilterTab === 'failed' ? (
                          <>
                            <Check size={36} className="text-emerald-400/40" />
                            <p className="text-xs font-bold text-emerald-400">No Failed Messages! 🎉</p>
                            <p className="text-[11px] text-muted">All sent WhatsApp messages completed without errors.</p>
                          </>
                        ) : distributorFilterTab === 'unmapped' ? (
                          <>
                            <Check size={36} className="text-emerald-400/40" />
                            <p className="text-xs font-bold text-emerald-400">All Distributors Have Linked Numbers! 🎉</p>
                            <p className="text-[11px] text-muted">Every store in your cart is linked with a confirmed WhatsApp number.</p>
                          </>
                        ) : (
                          <>
                            <Building2 size={36} className="text-muted/30" />
                            <p className="text-xs font-bold text-text">No Distributors Found</p>
                          </>
                        )}
                      </div>
                    ) : (
                      filteredDistributorList.map((dist) => (
                        <div key={dist.storeId} className="bg-transparent border border-glass-border/60 rounded-xl overflow-hidden shadow-sm">
                          {/* Distributor header */}
                          <div className="bg-bg3/30 px-4 py-2.5 border-b border-glass-border flex items-center justify-between">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <h4 className="text-sm font-extrabold text-text tracking-wide uppercase flex items-center gap-2">
                                <Package size={16} className="text-sky" />
                                {dist.storeName}
                              </h4>

                              {/* Status Badge (Sent Successfully vs Failed) */}
                              {sentWaStatusMap[dist.storeId] === 'success' && (
                                <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                                  <Check size={13} />
                                  <span>WhatsApp Sent</span>
                                </span>
                              )}
                              {sentWaStatusMap[dist.storeId] === 'error' && (
                                <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-md bg-red/20 text-red border border-red/40 flex items-center gap-1">
                                  <AlertCircle size={13} />
                                  <span>Send Failed</span>
                                </span>
                              )}

                              {/* Phone Badge & Contact Search/Edit trigger */}
                              {(() => {
                                const activePhone = getDistributorPhoneNumber(dist);
                                const isMapped = isValidPhoneNumber(activePhone.replace(/\D/g, ''));
                                const missingIdx = !isMapped ? unmappedDistributors.findIndex(d => d.storeId === dist.storeId) : -1;

                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(dist)}
                                    className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md border transition-all active:scale-95 cursor-pointer ${activePhone && isMapped
                                      ? 'bg-bg2 text-text border-border hover:bg-bg3'
                                      : 'bg-amber-500/20 text-amber-400 border-amber-500/40 hover:bg-amber-500/30 font-extrabold shadow-sm'
                                      }`}
                                    title={activePhone && isMapped ? 'Edit WhatsApp phone number' : 'Missing WhatsApp number — click to enter and auto-send'}
                                  >
                                    {missingIdx !== -1 && (
                                      <span className="w-4 h-4 rounded-full bg-amber-500 text-bg text-[10px] font-black flex items-center justify-center shrink-0">
                                        {missingIdx + 1}
                                      </span>
                                    )}
                                    <Phone size={12} className={activePhone && isMapped ? '' : 'text-amber-400'} />
                                    <span>
                                      {activePhone && isMapped
                                        ? activePhone
                                        : `[${missingIdx !== -1 ? missingIdx + 1 : '!'}] Missing Phone — Click to Add`}
                                    </span>
                                    <Edit2 size={11} className="opacity-70" />
                                  </button>
                                );
                              })()}

                              {/* Delivery Staff Badge & Assignment trigger */}
                              {(() => {
                                const boyId = resolveInitialDeliveryBoyId(dist);
                                let boyName: string | null = null;
                                let boyPhone: string | null = null;

                                if (boyId === 0) {
                                  boyName = 'Admin / Store Owner';
                                  boyPhone = storeInfo.adminPhone || storeInfo.phone || null;
                                } else if (boyId) {
                                  const found = deliveryBoysList.find(b => b.id === boyId);
                                  if (found) {
                                    boyName = found.name;
                                    boyPhone = found.whatsapp_number ? found.whatsapp_number.replace(/\D/g, '').slice(-10) : null;
                                  }
                                }

                                const isAssigned = Boolean(boyName);

                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(dist)}
                                    className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md border transition-all active:scale-95 cursor-pointer ${
                                      isAssigned
                                        ? 'bg-bg2 text-text border-border hover:bg-bg3'
                                        : 'bg-amber-500/20 text-amber-400 border-amber-500/40 hover:bg-amber-500/30 font-extrabold shadow-sm'
                                    }`}
                                    title={isAssigned ? 'Assigned delivery staff — click to change' : 'Missing delivery staff — click to assign'}
                                  >
                                    <Truck size={12} className={isAssigned ? 'text-primary' : 'text-amber-400'} />
                                    <span>
                                      {isAssigned
                                        ? `${boyName}${boyPhone ? ` (${boyPhone})` : ''}`
                                        : '⚠️ Missing Delivery Staff — Click to Assign'}
                                    </span>
                                    <Edit2 size={11} className="opacity-70" />
                                  </button>
                                );
                              })()}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {(() => {
                                const totalCount = dist.items.length;
                                const includedCount = dist.items.filter(i => isItemIncludedInDispatch(i, dist)).length;
                                const yesterdayItems = dist.items.filter(i => {
                                  const p = getPastOrderedInfo(i, dist);
                                  return p.isPastOrdered && !p.isToday;
                                });
                                const yesterdayCount = yesterdayItems.length;
                                const checkedYesterdayCount = yesterdayItems.filter(i => isItemIncludedInDispatch(i, dist)).length;
                                const checkedTotal = getDistributorCheckedTotal(dist);

                                return (
                                  <span className="text-[10px] font-bold px-2.5 py-0.5 bg-bg/60 rounded-full border border-glass-border/40 flex items-center gap-1.5 shrink-0">
                                    <span className="text-text font-mono font-black">
                                      ₹{checkedTotal.toFixed(2)}
                                    </span>
                                    <span className="text-muted/40">•</span>
                                    <span className={includedCount > 0 ? "text-primary font-bold" : "text-muted"}>
                                      {includedCount}/{totalCount} to send
                                    </span>
                                    {yesterdayCount > 0 && (
                                      <>
                                        <span className="text-muted/40">•</span>
                                        <span className="text-amber-400 font-extrabold flex items-center gap-0.5" title={`${checkedYesterdayCount} of ${yesterdayCount} past items reordered`}>
                                          <Clock size={10} />
                                          {checkedYesterdayCount > 0 ? `${checkedYesterdayCount}/${yesterdayCount} reordered` : `${yesterdayCount} past (tick to reorder)`}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                );
                              })()}

                              {/* Button 1: Send to Delivery Boy via WhatsApp */}
                              <button
                                onClick={() => handleSendDeliveryBoyNotification(dist)}
                                disabled={sendingDeliveryBoyNotifId === dist.storeId}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg2 text-text border border-border hover:bg-bg3 disabled:opacity-50 text-[10px] font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
                                title="Manually trigger and send WhatsApp order notification to assigned Delivery Boy anytime"
                              >
                                {sendingDeliveryBoyNotifId === dist.storeId ? (
                                  <span className="w-2.5 h-2.5 border border-muted/30 border-t-text rounded-full animate-spin" />
                                ) : (
                                  <Truck size={11} className="text-muted" />
                                )}
                                <span>Send to Delivery Boy</span>
                              </button>

                              {/* Button 2: Place Order on Pharmarack (Single Finalization Popup) */}
                              <button
                                type="button"
                                onClick={() => handleOpenPlaceOrderModal(dist)}
                                disabled={isPlacingSingleOrder && placeOrderTargetDist?.storeId === dist.storeId}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/40 font-extrabold text-[10px] transition-all active:scale-95 shadow-sm cursor-pointer disabled:opacity-50"
                                title="Open order finalization popup and place order directly on Pharmarack (~1s)"
                              >
                                {isPlacingSingleOrder && placeOrderTargetDist?.storeId === dist.storeId ? (
                                  <span className="w-2.5 h-2.5 border border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin" />
                                ) : (
                                  <Zap size={11} className="text-emerald-400 fill-emerald-400/30" />
                                )}
                                <span>Place Order</span>
                              </button>

                              {/* Button 2: WhatsApp Send & Resend Controls */}
                              {(() => {
                                const isSending = sendingWaDistributorId === dist.storeId;
                                const status = sentWaStatusMap[dist.storeId];
                                const hasUnsentItems = dist.items.some(i => !isItemAlreadySent(i, dist));
                                const isAlreadySent = !hasUnsentItems && (status === 'success' || (dist.items.length > 0 && dist.items.every(i => isItemAlreadySent(i, dist))));

                                // Button styling: transparent background with emerald text & border for clear readability
                                const whiteGreenBtnClass = "bg-transparent text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/10 font-extrabold shadow-xs";

                                if (isAlreadySent) {
                                  return (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {/* Resend to Distributor Only Button */}
                                      <button
                                        type="button"
                                        onClick={() => handleSendWhatsAppOrder(dist, false, true, 'distributor_only')}
                                        disabled={isSending}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${whiteGreenBtnClass}`}
                                        title="Resend WhatsApp order message to Distributor Only"
                                      >
                                        {isSending ? (
                                          <span className="w-2.5 h-2.5 border border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                                        ) : (
                                          <RotateCcw size={11} className="text-emerald-400" />
                                        )}
                                        <span>Resend (Distributor Only)</span>
                                      </button>

                                      {/* Resend to Both (Distributor & Delivery Boy) Button */}
                                      <button
                                        type="button"
                                        onClick={() => handleSendWhatsAppOrder(dist, false, true, 'both')}
                                        disabled={isSending}
                                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${whiteGreenBtnClass}`}
                                        title="Resend WhatsApp order message to BOTH Distributor and Delivery Boy"
                                      >
                                        <Send size={10} className="text-emerald-400" />
                                        <span>Resend Both</span>
                                      </button>
                                    </div>
                                  );
                                }

                                let btnClass = "bg-transparent text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/10 font-bold";
                                if (status === 'queued') btnClass = "bg-transparent text-amber-400 border border-amber-500/40 hover:bg-amber-500/10 font-bold";
                                if (status === 'error') btnClass = "bg-transparent text-rose-400 border border-rose-500/40 hover:bg-rose-500/10 font-bold";

                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenSingleDispatchModal(dist)}
                                    disabled={isSending}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all active:scale-95 shadow-sm disabled:opacity-50 ${btnClass}`}
                                    title="Review assigned delivery person and send formatted order message to Distributor via WhatsApp"
                                  >
                                    {isSending ? (
                                      <span className="w-2.5 h-2.5 border border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                                    ) : status === 'queued' ? (
                                      <Clock size={11} className="text-amber-500" />
                                    ) : status === 'error' ? (
                                      <AlertCircle size={11} className="text-rose-500" />
                                    ) : (
                                      <MessageSquare size={10} className="text-emerald-500" />
                                    )}
                                    <span>
                                      {isSending
                                        ? 'Sending...'
                                        : status === 'queued'
                                          ? 'Queued'
                                          : status === 'error'
                                            ? 'Retry WhatsApp'
                                            : 'Send via WhatsApp'}
                                    </span>
                                  </button>
                                );
                              })()}

                              {lastSentWaTimeMap[dist.storeId] && (
                                <span className="text-[9px] text-emerald-400 font-mono font-extrabold flex items-center gap-1 shrink-0 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded">
                                  <Clock size={10} />
                                  Sent at {lastSentWaTimeMap[dist.storeId]}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Distributor ordering limits (from Pharmarack, per store) */}
                          {(() => {
                            const limitIssues = getOrderLimitIssues(dist, isItemIncludedInDispatch);
                            if (limitIssues.length === 0) return null;
                            const deficit = getDistributorShortfallDeficit(dist, isItemIncludedInDispatch);
                            return (
                              <div className="px-4 py-2 border-b border-amber-500/30 bg-amber-500/10 space-y-1">
                                {limitIssues.map(msg => (
                                  <p key={msg} className="text-[11px] font-bold text-amber-400 flex items-center gap-1.5">
                                    <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                                    <span>{msg}</span>
                                  </p>
                                ))}
                                {(() => {
                                  const distItems = distributorProductsMap[dist.storeId] || [];
                                  const fillers = getDistributorShortfallFillers(dist, [...distItems, ...purchaseHistoryItems], reorderRecentItems, skippedFillerKeys[dist.storeId], distributorMappings, isItemIncludedInDispatch);
                                  if (fillers.length === 0) return null;
                                  const sum = fillers.reduce((s, f) => s + f.amount, 0);
                                  const skippedCount = skippedFillerKeys[dist.storeId]?.size || 0;
                                  return (
                                    <div className="mt-2 pt-2 border-t border-amber-500/25 space-y-1.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300 flex items-center gap-1.5 truncate">
                                          <BookOpen size={11} className="text-amber-400 shrink-0" />
                                          <span className="truncate">
                                            Past Purchases from {dist.storeName} —{' '}
                                            {deficit.itemShortfall > 0 && deficit.amtShortfall > 0
                                              ? `Add ${deficit.itemShortfall} more medicine${deficit.itemShortfall > 1 ? 's' : ''} & ₹${deficit.amtShortfall.toFixed(2)} to fulfill minimum`
                                              : deficit.itemShortfall > 0
                                                ? `Add ${deficit.itemShortfall} more medicine${deficit.itemShortfall > 1 ? 's' : ''} to fulfill minimum`
                                                : `Add ₹${deficit.amtShortfall.toFixed(2)} more to fulfill minimum`}
                                          </span>
                                        </p>
                                        {skippedCount > 0 && (
                                          <button
                                            type="button"
                                            onClick={() => handleResetSkippedFillers(dist.storeId)}
                                            className="text-[10px] text-amber-300/90 hover:text-amber-200 underline shrink-0 cursor-pointer"
                                            title="Restore previously skipped suggestions"
                                          >
                                            Reset skipped ({skippedCount})
                                          </button>
                                        )}
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 pt-0.5">
                                        {fillers.map(({ item, qty, amount }) => (
                                          <div
                                            key={`${item.medicineName}-${item.storeId || ''}`}
                                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-bg2/80 hover:bg-bg2 border border-glass-border/40 text-[11px] text-text transition-colors"
                                          >
                                            <div className="min-w-0 flex-1">
                                              <div className="flex items-center gap-1.5 truncate">
                                                <span
                                                  className="font-bold text-text truncate cursor-pointer hover:text-primary transition-colors"
                                                  title={`${item.medicineName} — Click to add`}
                                                  onClick={() => handleReorderDirect(item, qty, dist.storeId, dist.storeName)}
                                                >
                                                  {item.medicineName}
                                                </span>
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono shrink-0" title="Verified link for this distributor">
                                                  ✓ Verified
                                                </span>
                                                {item.billCount && item.billCount > 1 ? (
                                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-mono shrink-0 flex items-center gap-0.5" title={`Purchased in ${item.billCount} bills`}>
                                                    <Star size={8} className="fill-amber-400" /> ×{item.billCount}
                                                  </span>
                                                ) : null}
                                              </div>
                                              <div className="text-[10px] text-muted flex items-center gap-2 mt-0.5">
                                                <span>Qty: <strong className="text-text font-mono">×{qty}</strong></span>
                                                {amount > 0 ? (
                                                  <span>Total: <strong className="text-emerald-400 font-mono">₹{amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong></span>
                                                ) : null}
                                                {item.ptr ? (
                                                  <span className="text-[9px] opacity-75">PTR ₹{item.ptr.toFixed(1)}</span>
                                                ) : null}
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0">
                                              <button
                                                type="button"
                                                disabled={readdingSentItems}
                                                onClick={() => handleReorderDirect(item, qty, dist.storeId, dist.storeName)}
                                                className="px-2.5 py-1 rounded-md bg-primary hover:bg-primary/90 text-white text-[10px] font-bold disabled:opacity-50 transition-all active:scale-95 cursor-pointer shadow-xs"
                                                title={`Add ${item.medicineName} (x${qty}) directly to cart`}
                                              >
                                                + Add (x{qty})
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleSkipFiller(dist.storeId, item.medicineName)}
                                                className="p-1 rounded-md bg-bg hover:bg-rose-500/20 border border-glass-border text-muted hover:text-rose-400 transition-all active:scale-95 cursor-pointer"
                                                title="Skip this medicine and suggest another"
                                              >
                                                <RotateCcw size={11} />
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })()}

                          {/* Line items table */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-glass-border/30 text-muted font-bold uppercase tracking-wider text-[10px]">
                                  <th className="text-center px-2 py-2 w-12 text-[9px] font-extrabold text-muted" title="Select / Deselect all items for this distributor">
                                    <div className="flex items-center justify-center gap-1">
                                      <input
                                        type="checkbox"
                                        checked={dist.items.length > 0 && dist.items.every(i => isItemIncludedInDispatch(i, dist))}
                                        onChange={(e) => handleToggleSelectAllInDist(dist.storeId, e.target.checked)}
                                        className="w-3.5 h-3.5 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer accent-emerald-500"
                                        title={dist.items.length > 0 && dist.items.every(i => isItemIncludedInDispatch(i, dist)) ? "Deselect all items (none will send)" : "Select all items (all will send)"}
                                      />
                                    </div>
                                  </th>
                                  <th className="text-left px-3 py-2">Product</th>
                                  <th className="text-left px-3 py-2">Company</th>
                                  <th className="text-center px-3 py-2">Pack</th>
                                  <th className="text-center px-3 py-2">Qty</th>
                                  <th className="text-right px-3 py-2">PTR</th>
                                  <th className="text-right px-3 py-2">MRP</th>
                                  <th className="text-center px-3 py-2">Scheme</th>
                                  <th className="text-center px-3 py-2">Stock</th>
                                  <th className="text-right px-4 py-2">Amount</th>
                                  <th className="text-center px-3 py-2">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-glass-border/15">
                                {dist.items.map((item, idx) => {
                                  const isSent = isItemAlreadySent(item, dist);
                                  const pastInfo = getPastOrderedInfo(item, dist);
                                  const isYesterdayOrPast = pastInfo.isPastOrdered && !pastInfo.isToday;
                                  const isIncluded = isItemIncludedInDispatch(item, dist);
                                  const isDeleting = updatingItemId === (item.productCode || String(item.productId || item.productName));

                                  return (
                                    <tr
                                      key={`${item.productCode}-${idx}`}
                                      className={`transition-colors ${!isIncluded
                                        ? 'opacity-60 hover:opacity-90 text-muted'
                                        : isYesterdayOrPast
                                          ? 'bg-amber-500/[0.06] hover:bg-amber-500/[0.12] border-l-2 border-l-amber-500'
                                          : isSent
                                            ? 'opacity-75 hover:opacity-100 text-muted'
                                            : 'hover:bg-bg3/40'
                                        }`}
                                    >
                                      <td className="px-2 py-2.5 text-center w-12">
                                        <input
                                          type="checkbox"
                                          checked={isIncluded}
                                          onChange={(e) => handleToggleItemCheck(dist.storeId, item, e.target.checked)}
                                          className={`w-4 h-4 rounded cursor-pointer shadow-sm ${isYesterdayOrPast
                                            ? 'text-amber-500 focus:ring-amber-500 accent-amber-500'
                                            : 'text-emerald-500 focus:ring-emerald-500 accent-emerald-500'
                                            }`}
                                          title={isIncluded ? "Checked: Included in WhatsApp order. Click to exclude." : "Unchecked: Excluded from WhatsApp order. Click to include."}
                                        />
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <div className="flex flex-col gap-1">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className={`font-bold text-[11px] ${!isIncluded ? 'text-muted line-through opacity-80' : isSent ? 'text-muted' : 'text-text'}`}>
                                              {item.productName}
                                            </span>
                                            {isSoldAtPOSToday(item.productName) && (
                                              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0 select-none flex items-center gap-1" title="This medicine was already fulfilled/sold at POS today.">
                                                <span>⚠️ FULFILLED AT POS</span>
                                              </span>
                                            )}
                                            {isYesterdayOrPast && (
                                              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0 select-none flex items-center gap-1" title={`Ordered previously on ${pastInfo.placedDateStr}. Check box to include in today's order.`}>
                                                <Clock size={9} />
                                                <span>⚡ {pastInfo.isYesterday ? 'ORDERED 1 DAY AGO (YESTERDAY)' : `ORDERED 1 DAY AGO (${pastInfo.placedDateStr.toUpperCase()})`}</span>
                                              </span>
                                            )}
                                            {!isIncluded && (
                                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-bg3/70 text-muted border border-border/40 shrink-0 select-none">
                                                Excluded (Won't Send)
                                              </span>
                                            )}
                                            {isIncluded && isYesterdayOrPast && (
                                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0 select-none flex items-center gap-0.5">
                                                <Check size={8} />
                                                <span>REORDERING</span>
                                              </span>
                                            )}
                                            {isIncluded && !isYesterdayOrPast && isSent && (
                                              <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-bg3 text-muted border border-border/40 shrink-0 select-none flex items-center gap-0.5">
                                                <Check size={8} />
                                                <span>SENT TODAY</span>
                                              </span>
                                            )}
                                            {isIncluded && !isYesterdayOrPast && !isSent && (
                                              <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0 select-none flex items-center gap-0.5">
                                                <span>✨ TO SEND</span>
                                              </span>
                                            )}
                                          </div>

                                          {/* Duplicate Distributor Warning */}
                                          {(() => {
                                            const dup = getDuplicateItemInCart(item);
                                            if (dup) {
                                              return (
                                                <div className="flex items-center gap-1 text-[9px] font-extrabold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20 w-fit">
                                                  <AlertCircle size={10} className="shrink-0" />
                                                  <span>Also in cart under {dup.storeName} ({dup.qty} qty)</span>
                                                </div>
                                              );
                                            }
                                            return null;
                                          })()}

                                          {/* Alternative Distributor Suggestion */}
                                          {(() => {
                                            const history = priceHistoryCache[item.productName] || [];
                                            const matchingMrpHistory = history.filter(h => Math.abs(h.mrp - item.mrp) < 0.1);
                                            if (matchingMrpHistory.length > 0) {
                                              const best = matchingMrpHistory.reduce((prev, curr) => (curr.net_rate < prev.net_rate) ? curr : prev, matchingMrpHistory[0]);
                                              if (best.net_rate < item.ptr) {
                                                return (
                                                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted bg-bg3/50 px-2 py-0.5 rounded-md border border-glass-border/40 w-fit mt-0.5" title={`Rate: ₹${best.rate.toFixed(2)}, Free: ${best.free_qty}, Disc: ₹${best.cd_rs.toFixed(2)}`}>
                                                    <ArrowDown size={13} className="shrink-0 text-emerald-400 animate-bounce" />
                                                    <span>Cheapest historic: <strong className="text-emerald-400 font-mono font-bold text-xs inline-flex items-center gap-0.5 animate-pulse">₹{best.net_rate.toFixed(2)}</strong> from <strong className="text-emerald-400 font-bold text-[12.5px] inline-flex items-center animate-pulse">{best.distributor_name}</strong></span>
                                                  </div>
                                                );
                                              }
                                            }
                                            return null;
                                          })()}
                                        </div>
                                      </td>
                                      <td className="px-3 py-2.5 text-muted text-[10px] max-w-[120px] truncate">{item.company}</td>
                                      <td className="px-3 py-2.5 text-center">
                                        {item.packaging && (
                                          <span className="text-[9px] text-muted bg-bg3/50 px-1.5 py-0.5 rounded border border-glass-border/40 font-mono">
                                            {item.packaging}
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5 text-center min-w-[110px] whitespace-nowrap">
                                        <CartItemQtyEditor
                                          qty={item.qty}
                                          onCommit={(newQty) => handleUpdateQty(item, newQty)}
                                          isUpdating={updatingItemId === item.productCode}
                                        />
                                      </td>
                                      <td className="px-3 py-2.5 text-right font-mono text-text text-[11px]">
                                        {item.ptr > 0 ? `₹${item.ptr.toFixed(2)}` : '—'}
                                      </td>
                                      <td className="px-3 py-2.5 text-right font-mono text-muted text-[11px]">
                                        {item.mrp > 0 ? `₹${item.mrp.toFixed(2)}` : '—'}
                                      </td>
                                      <td className="px-3 py-2.5 text-center">
                                        {item.scheme ? (
                                          <span className="text-[9px] font-bold text-green bg-green/10 px-1.5 py-0.5 rounded border border-green/20">
                                            {item.scheme}
                                          </span>
                                        ) : (
                                          <span className="text-muted/40">—</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5 text-center font-mono text-[10px]">
                                        {item.stock !== null && item.stock !== undefined && String(item.stock).toLowerCase() !== 'offline' ? (
                                          <span className={item.stock > 10 ? 'text-emerald-400' : item.stock > 0 ? 'text-amber-400' : 'text-red'}>
                                            {item.stock}
                                          </span>
                                        ) : (
                                          <span className="text-muted inline-flex items-center justify-center" title="Offline / Saved Rate">
                                            <WifiOff size={11} className="text-muted" />
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2.5 text-right font-mono font-black text-text text-[11px]">
                                        ₹{getCartItemAmount(item).toFixed(2)}
                                      </td>
                                      <td className="px-3 py-2.5 text-center">
                                        <div className="flex items-center justify-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => handleOpenSwitchModal(item, dist)}
                                            className="px-2 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/25 border border-sky-500/30 text-sky-400 hover:text-sky-300 transition-all active:scale-95 flex items-center gap-1 font-bold text-[10px] cursor-pointer"
                                            title={`Compare prices and switch supplier for ${item.productName}`}
                                          >
                                            <ArrowLeftRight size={11} />
                                            <span>Switch</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteItem(item)}
                                            disabled={isDeleting}
                                            className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 hover:text-rose-300 transition-all active:scale-95 disabled:opacity-40 flex items-center gap-1 font-bold text-[10px] cursor-pointer"
                                            title={`Delete ${item.productName} from Pharmarack live cart`}
                                          >
                                            {isDeleting ? (
                                              <span className="w-2.5 h-2.5 border border-rose-400/30 border-t-rose-400 rounded-full animate-spin" />
                                            ) : (
                                              <Trash2 size={12} />
                                            )}
                                            <span>Delete</span>
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {dist.lineTotal > 0 && (
                            <div className="border-t border-glass-border/30 px-4 py-2 bg-bg3/30 flex justify-end">
                              <span className="text-[10px] text-muted font-bold uppercase tracking-wider mr-3">Subtotal</span>
                              <span className="text-xs font-black text-emerald-400 font-mono">₹{dist.lineTotal.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Footer / Total Summary ── */}
          {distributors.length > 0 && !loading && (
            <div className="border-t border-glass-border bg-bg2/40 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 shadow-lg">
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                <button
                  type="button"
                  onClick={handleOpenConfirmBatchModal}
                  disabled={isSendingBatchWhatsApp || isValidatingBeforeSend || distributors.length === 0}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black transition-all active:scale-95 text-xs disabled:opacity-50 shadow-[0_4px_14px_rgba(16,185,129,0.3)] cursor-pointer"
                  title="Review and send orders to distributors via WhatsApp"
                >
                  {isSendingBatchWhatsApp ? (
                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : isValidatingBeforeSend ? (
                    <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <MessageSquare size={15} />
                  )}
                  <span>
                    {isSendingBatchWhatsApp
                      ? 'Placing orders…'
                      : isValidatingBeforeSend
                        ? 'Verifying live cart…'
                        : `Place Official Orders & Dispatch (${readyToSendDistributors.length})`}
                  </span>
                </button>

                <div className="h-6 w-[1px] bg-glass-border/30 hidden sm:block" />

                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Distributors</span>
                  <span className="text-base font-black text-text font-mono">{distributors.length}</span>
                </div>
                <div className="h-6 w-[1px] bg-glass-border/30" />
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Products</span>
                  <span className="text-base font-black text-text font-mono">{totalProducts}</span>
                </div>
                <div className="h-6 w-[1px] bg-glass-border/30" />
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Total Qty</span>
                  <span className="text-base font-black text-text font-mono">{totalQty}</span>
                </div>
                <div className="h-6 w-[1px] bg-glass-border/30" />
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider block">Estimated Total</span>
                  <span className="text-lg font-black text-emerald-400 font-mono">₹{totalAmount.toFixed(2)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  api.openOfficialPharmarackCartWindow().catch(() => {
                    window.open('https://retailers.pharmarack.com/cart', '_blank');
                  });
                }}
                className="w-full sm:w-auto premium-btn bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 px-6 rounded-xl flex items-center justify-center gap-2 active:scale-95 shadow-[0_4px_14px_rgba(16,185,129,0.4)] transition-all cursor-pointer"
                title="Open authenticated cart on retailers.pharmarack.com"
              >
                <ExternalLink size={14} />
                <span>Open Official Cart</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Edit Distributor Contact Modal ── */}
      {editingDistributor && (
        <div 
          className="fixed inset-0 z-modal bg-black/60 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              if (pendingMissingContactDistributorsRef.current.length > 0) {
                pendingMissingContactDistributorsRef.current = [];
                toastEvent.trigger('Batch order setup cancelled.', 'info');
              }
              setEditingDistributor(null);
              setIsSavingContact(false);
            }
          }}
        >
          <div className="bg-bg2 border border-glass-border rounded-2xl w-full max-w-md shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="bg-bg3/80 px-6 py-4 border-b border-glass-border flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Phone className="text-emerald-400" size={18} />
                <div>
                  <h3 className="font-extrabold text-text text-sm">Distributor WhatsApp Contact</h3>
                  <p className="text-[11px] text-muted truncate max-w-[240px]">{editingDistributor.storeName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (pendingMissingContactDistributorsRef.current.length > 0) {
                    pendingMissingContactDistributorsRef.current = [];
                    toastEvent.trigger('Batch order setup cancelled.', 'info');
                  }
                  setEditingDistributor(null);
                  setIsSavingContact(false);
                }}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              {pendingMissingContactDistributorsRef.current.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 animate-in fade-in zoom-in-95 duration-150">
                  <div className="p-1 rounded-lg bg-amber-500/20 text-amber-400 mt-0.5 shrink-0">
                    <AlertTriangle size={14} />
                  </div>
                  <div className="text-[11px] leading-relaxed">
                    <p className="font-bold text-amber-400">
                      Step 1 of Setup: 10-Digit Contact Required
                    </p>
                    <p className="text-muted mt-0.5">
                      Save a 10-digit mobile number for <strong className="text-text">{editingDistributor.storeName}</strong> ({pendingMissingContactDistributorsRef.current.length} store{pendingMissingContactDistributorsRef.current.length > 1 ? 's' : ''} remaining in checkout queue). Once all numbers are saved, the order confirmation modal will appear automatically.
                    </p>
                  </div>
                </div>
              )}
              {/* Select Saved Directory Distributor or Create New */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-muted">
                    {isAddingNewDistributor ? 'Create New AI Learning Distributor' : 'Link to Saved Directory Distributor'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNewDistributor(!isAddingNewDistributor);
                      if (!isAddingNewDistributor) {
                        setNewDistNameInput(editingDistributor.storeName || '');
                        setSelectedSavedDistId(null);
                      }
                    }}
                    className="text-[11px] font-extrabold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded-lg border border-emerald-500/20 transition-all active:scale-95"
                  >
                    {isAddingNewDistributor ? (
                      <>
                        <X size={12} /> Use Directory List
                      </>
                    ) : (
                      <>
                        <Plus size={12} /> Create New
                      </>
                    )}
                  </button>
                </div>

                {isAddingNewDistributor ? (
                  <div className="space-y-2.5 bg-bg3/50 p-3 rounded-xl border border-emerald-500/30 animate-in fade-in zoom-in-95 duration-150">
                    <div>
                      <label className="block text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                        Distributor Name (AI Learning Page)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. BHIKSHU DISTRIBUTORS"
                        value={newDistNameInput}
                        onChange={(e) => setNewDistNameInput(e.target.value)}
                        className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-emerald-500 font-bold"
                      />
                    </div>
                    <p className="text-[10px] text-muted leading-tight">
                      This will automatically create a new distributor profile in the <strong className="text-text">AI Learning page</strong>.
                    </p>
                  </div>
                ) : (
                  <select
                    value={selectedSavedDistId || ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      setSelectedSavedDistId(val);
                      if (val) {
                        const found = savedDistributorsList.find((d) => d.id === val);
                        if (found && (found.phone || found.mobile || found.whatsapp)) {
                          setModalPhoneInput(found.phone || found.mobile || found.whatsapp || '');
                        }
                      }
                    }}
                    className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-emerald-500 font-medium"
                  >
                    <option value="">-- Direct Mobile Number Only --</option>
                    {savedDistributorsList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.phone ? `(${d.phone})` : ''}
                      </option>
                    ))}
                  </select>
                )}

                {selectedSavedDistId && (() => {
                  const foundSaved = savedDistributorsList.find((d) => d.id === selectedSavedDistId);
                  if (foundSaved && foundSaved.name && editingDistributor?.storeName && foundSaved.name.toLowerCase().trim() !== editingDistributor.storeName.toLowerCase().trim()) {
                    return (
                      <div className="mt-2.5 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 animate-in fade-in zoom-in-95 duration-150">
                        <label className="flex items-start gap-2.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={overwriteDistributorName}
                            onChange={(e) => setOverwriteDistributorName(e.target.checked)}
                            className="mt-0.5 rounded border-glass-border text-emerald-500 focus:ring-0 focus:outline-none cursor-pointer"
                          />
                          <div className="text-[11px] leading-snug">
                            <span className="font-bold text-text">Unify distributor name across pharmacy:</span>
                            <p className="text-muted mt-0.5">
                              Update <strong className="text-emerald-400">"{foundSaved.name}"</strong> &rarr; <strong className="text-emerald-300">"{editingDistributor.storeName}"</strong> (Pharmarack name) so all bills and dispatch reminders show only this 1 name.
                            </p>
                          </div>
                        </label>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* WhatsApp Mobile Number Input */}
              <div>
                <label className="block text-xs font-bold text-muted mb-1.5">
                  WhatsApp Phone Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. 9822012345"
                  value={modalPhoneInput}
                  onChange={(e) => setModalPhoneInput(sanitizePhoneInput(e.target.value))}
                  maxLength={10}
                  className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text font-mono focus:outline-none focus:border-emerald-500 font-bold"
                />
                <p className="text-[10px] text-muted mt-1 font-medium">
                  10-digit mobile numbers will be formatted with +91 country code automatically.
                </p>
                {checkingPhoneDuplicate && (
                  <p className="text-[10px] text-muted mt-1 flex items-center gap-1">
                    <span className="w-2.5 h-2.5 border border-muted border-t-transparent rounded-full animate-spin" />
                    Checking contact uniqueness...
                  </p>
                )}
                {phoneDuplicateWarning && (
                  <div className="mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2 text-amber-400 text-xs">
                    <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-400" />
                    <div className="flex-1 text-[11px] leading-tight">
                      <span className="font-bold">{phoneDuplicateWarning}</span>
                      <p className="text-[10px] text-muted mt-1">
                        If intentional (shared contact person), you can confirm below. Otherwise, please enter the distinct number.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Default Delivery Person Input */}
              <div>
                <label className="block text-xs font-bold text-muted mb-1.5">
                  Default Delivery Person
                </label>
                <select
                  value={modalDeliveryBoyId !== null && modalDeliveryBoyId !== undefined ? String(modalDeliveryBoyId) : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') setModalDeliveryBoyId(null);
                    else setModalDeliveryBoyId(Number(val));
                  }}
                  className={`w-full border rounded-xl px-3 py-2 text-xs font-medium cursor-pointer transition-all focus:outline-none ${
                    modalDeliveryBoyId === null || modalDeliveryBoyId === undefined
                      ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 font-bold focus:border-amber-500'
                      : 'bg-bg border-glass-border text-text focus:border-emerald-500'
                  }`}
                >
                  <option value="">⚠️ Select Delivery Staff (Required)</option>
                  <option value="0">👤 Admin / Store Owner (Store Contact)</option>
                  {deliveryBoysList.map((b) => (
                    <option key={b.id} value={b.id}>
                      🚚 {b.name} {b.whatsapp_number ? `(${b.whatsapp_number.slice(-4)})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted mt-1 font-medium">
                  Pre-selected automatically when dispatching batch orders to this distributor.
                </p>
              </div>
            </div>

            {/* Human-in-the-loop Duplicate Phone Confirmation Banner */}
            {duplicateConfirmNotice && (
              <div className="bg-amber-500/15 border-t border-b border-amber-500/40 px-6 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>Duplicate Phone Warning</span>
                </div>
                <p className="text-[11px] text-text">
                  {duplicateConfirmNotice.message}. If you confirm, both distributors will receive WhatsApp dispatches at this number.
                </p>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setDuplicateConfirmNotice(null)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted hover:text-text hover:bg-bg3"
                  >
                    Change Number
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveDistributorContact(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                  >
                    Confirm Shared Contact
                  </button>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="bg-bg3/40 px-6 py-3.5 border-t border-glass-border flex items-center justify-between gap-2">
              <a
                href={`/learning?tab=distributor_layouts${editingDistributor?.storeId ? `&id=${editingDistributor.storeId}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-[11px] font-bold text-sky hover:bg-sky-500/20 transition-all"
                title="Open full distributor profile & OCR rules in AI Learning page"
              >
                <ExternalLink size={12} />
                <span>Open in AI Learning</span>
              </a>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (pendingMissingContactDistributorsRef.current.length > 0) {
                      pendingMissingContactDistributorsRef.current = [];
                      toastEvent.trigger('Batch order setup cancelled.', 'info');
                    }
                    setEditingDistributor(null);
                    setDuplicateConfirmNotice(null);
                    setPhoneDuplicateWarning(null);
                    setIsSavingContact(false);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveDistributorContact()}
                  disabled={isSavingContact}
                  className="premium-btn bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-5 py-2 rounded-xl flex items-center gap-1.5 disabled:opacity-50 transition-all shadow-md active:scale-95"
                >
                  {isSavingContact ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  <span>Save Contact</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Switch Supplier / Compare Prices Modal ── */}
      {switchModalTarget && createPortal(
        <div 
          className="fixed inset-0 z-modal bg-black/70 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSwitchModalTarget(null);
          }}
        >
          <div className="bg-bg2 border border-glass-border rounded-2xl w-full max-w-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="bg-bg3/80 px-6 py-4 border-b border-glass-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <ArrowLeftRight className="text-sky-400" size={18} />
                <div>
                  <h3 className="font-extrabold text-text text-sm">Compare Suppliers & Switch Distributor</h3>
                  <p className="text-[11px] text-muted truncate max-w-md">
                    Medicine: <strong className="text-text">{switchModalTarget.item.productName}</strong> | Current: <strong className="text-primary">{switchModalTarget.dist.storeName}</strong> (₹{switchModalTarget.item.ptr?.toFixed(2) || '—'})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSwitchModalTarget(null)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search Input Bar */}
            <div className="p-4 border-b border-glass-border/40 bg-bg/40 flex items-center gap-2 shrink-0">
              <Search size={14} className="text-muted shrink-0" />
              <input
                type="text"
                placeholder="Search across all connected distributor catalogs..."
                value={switchSearchQuery}
                onChange={(e) => handleSearchSwitchCatalog(e.target.value)}
                className="flex-1 bg-bg border border-glass-border rounded-xl px-3 py-1.5 text-xs text-text focus:outline-none focus:border-sky-500 font-medium"
              />
              {switchSearching && (
                <span className="w-4 h-4 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin shrink-0" />
              )}
            </div>

            {/* Suppliers Comparison Table / List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {/* Section 1: Live Catalog Matches */}
              <div>
                <h4 className="text-[11px] font-extrabold uppercase text-sky-400 tracking-wider mb-2 flex items-center gap-1.5">
                  <Building2 size={13} />
                  Connected Distributor Catalogs ({switchCatalogResults.length})
                </h4>

                {switchSearching ? (
                  <div className="text-center py-8 text-xs text-muted font-bold tracking-wider uppercase animate-pulse">
                    Searching distributor inventories…
                  </div>
                ) : switchCatalogResults.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted italic border border-glass-border/30 rounded-xl bg-bg/20">
                    No active catalog matches found for "{switchSearchQuery}".
                  </div>
                ) : (
                  <div className="space-y-2">
                    {switchCatalogResults.map((prod, idx) => {
                      const isCurrentDist = prod.storeId === switchModalTarget.dist.storeId;
                      const rateDiff = (prod.rate || 0) - (switchModalTarget.item.ptr || 0);

                      return (
                        <div
                          key={idx}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${isCurrentDist
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-glass-border/50 bg-bg/40 hover:border-sky-500/40 hover:bg-bg/70'
                            }`}
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-xs text-text">{prod.storeName}</span>
                              {isCurrentDist && (
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
                                  Current Supplier
                                </span>
                              )}
                              {prod.scheme && (
                                <span className="text-[9px] font-bold text-green bg-green/10 px-1.5 py-0.5 rounded border border-green/20">
                                  {prod.scheme}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-muted flex-wrap">
                              <span>Rate: <strong className="text-emerald-400 font-mono">₹{prod.rate ? prod.rate.toFixed(2) : '—'}</strong></span>
                              <span>MRP: <strong className="text-text font-mono">₹{prod.mrp ? prod.mrp.toFixed(2) : '—'}</strong></span>
                              <span>Stock: <strong className="text-text font-mono">{prod.stock || 'Available'}</strong></span>
                              {prod.rate && switchModalTarget.item.ptr > 0 && Math.abs(rateDiff) > 0.05 && (
                                <span className={`font-bold font-mono ${rateDiff < 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {rateDiff < 0 ? `(₹${Math.abs(rateDiff).toFixed(2)} cheaper)` : `(+₹${rateDiff.toFixed(2)})`}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0">
                            {isCurrentDist ? (
                              <span className="text-xs text-muted font-bold px-3 py-1.5 rounded-xl bg-bg border border-glass-border block text-center">
                                Current
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleConfirmSwitchSupplier(prod)}
                                disabled={switchingDistributor}
                                className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-extrabold text-xs flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-sm"
                              >
                                {switchingDistributor ? (
                                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                  <Check size={13} />
                                )}
                                <span>Switch to {prod.storeName.split(' ')[0]}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Section 2: Purchase Invoice Price History */}
              {(() => {
                const hist = priceHistoryCache[switchModalTarget.item.productName] || [];
                if (hist.length === 0) return null;

                return (
                  <div className="pt-2 border-t border-glass-border/30">
                    <h4 className="text-[11px] font-extrabold uppercase text-emerald-400 tracking-wider mb-2 flex items-center gap-1.5">
                      <Clock size={13} />
                      Historical Purchase Invoices ({hist.length})
                    </h4>
                    <div className="space-y-1.5">
                      {hist.slice(0, 5).map((h, i) => (
                        <div key={i} className="p-2.5 rounded-xl border border-glass-border/40 bg-bg/30 flex items-center justify-between text-xs">
                          <div className="min-w-0 flex-1">
                            <span className="font-bold text-text">{h.distributor_name}</span>
                            <span className="text-[10px] text-muted ml-2 font-mono">
                              ({h.invoice_date ? new Date(h.invoice_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Past Bill'})
                            </span>
                            <div className="text-[11px] text-muted mt-0.5">
                              Net Rate: <strong className="text-emerald-400 font-mono">₹{h.net_rate?.toFixed(2)}</strong> | Rate: ₹{h.rate?.toFixed(2)} {h.free_qty ? `| Free: ${h.free_qty}` : ''} {h.cd_per ? `| Disc: ${h.cd_per}%` : ''}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="bg-bg3/60 px-6 py-3 border-t border-glass-border flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSwitchModalTarget(null)}
                className="px-4 py-1.5 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Reorder Same Confirmation Modal ── */}
      {reorderSameModalTarget && createPortal(
        <div 
          className="fixed inset-0 z-modal bg-black/75 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReorderSameModalTarget(null);
          }}
        >
          <div className="bg-bg2 border border-glass-border rounded-2xl w-[95vw] max-w-xl h-[80vh] min-h-[500px] max-h-[760px] shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="bg-bg3/80 px-6 py-4 border-b border-glass-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <RotateCw size={16} />
                </div>
                <div>
                  <h3 className="font-extrabold text-text text-sm">REORDER SAME MEDICINE</h3>
                  <p className="text-[11px] text-muted">{reorderSameModalTarget.medicineName} {reorderSameModalTarget.company ? `(${reorderSameModalTarget.company})` : ''}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReorderSameModalTarget(null)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {/* Side-by-side: Previous Purchase vs Current Stock */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Previous Purchase Record */}
                <div className="p-3.5 rounded-xl border border-glass-border/60 bg-bg/40 space-y-2">
                  <span className="text-[10px] font-black uppercase text-amber-400 block border-b border-glass-border/30 pb-1 flex items-center gap-1">
                    <Clock size={11} /> Previous Purchase Record
                  </span>
                  {reorderSameModalTarget.hasPreviousPurchase && reorderSameModalTarget.previousPurchase ? (
                    <div className="space-y-1 text-xs">
                      <div>Supplier: <strong className="text-text font-bold">{reorderSameModalTarget.previousPurchase.supplierName}</strong></div>
                      <div>Previous Qty: <strong className="font-mono text-text">{reorderSameModalTarget.previousPurchase.quantity} units</strong></div>
                      <div>Price Paid: <strong className="font-mono text-emerald-400 font-bold">₹{reorderSameModalTarget.previousPurchase.price?.toFixed(2)}</strong></div>
                      <div>Date: <strong className="font-mono text-muted">{formatDisplayDate(reorderSameModalTarget.previousPurchase.purchaseDate)}</strong></div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted italic py-2 space-y-1">
                      <div className="text-amber-400 font-bold flex items-center gap-1">
                        <AlertCircle size={12} /> No previous purchase found
                      </div>
                      <p className="text-[11px]">Select a supplier below to restock this medicine.</p>
                    </div>
                  )}
                </div>

                {/* Current Stock Status */}
                <div className="p-3.5 rounded-xl border border-glass-border/60 bg-bg/40 space-y-2">
                  <span className="text-[10px] font-black uppercase text-primary block border-b border-glass-border/30 pb-1 flex items-center gap-1">
                    <Layers size={11} /> Current Stock Status
                  </span>
                  <div className="space-y-1 text-xs">
                    <div>Current In-Stock: <strong className={`font-mono ${reorderSameModalTarget.currentStock <= 2 ? 'text-rose-400' : 'text-text'}`}>{reorderSameModalTarget.currentStock} units</strong></div>
                    <div>Minimum / Safety: <strong className="font-mono text-muted">{reorderSameModalTarget.minStock} units</strong></div>
                    <div>Suggested Order: <strong className="font-mono text-primary font-bold">{reorderSameModalTarget.suggestedQty} units</strong></div>
                  </div>
                </div>
              </div>

              {/* Target Supplier & Quantity Adjuster */}
              <div className="p-4 rounded-xl bg-bg3/30 border border-glass-border space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-muted mb-1">Target Supplier / Distributor</label>
                  <select
                    value={reorderModalSupplierId || ''}
                    onChange={(e) => setReorderModalSupplierId(Number(e.target.value))}
                    className="w-full bg-bg border border-glass-border rounded-xl px-3 py-2 text-xs text-text focus:outline-none focus:border-amber-500 font-bold"
                  >
                    {distributors.map(d => (
                      <option key={d.storeId} value={d.storeId}>
                        {d.storeName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-muted mb-1">Quantity to Reorder (Strips / Units)</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReorderModalQty(q => Math.max(1, q - 1))}
                      className="w-8 h-8 rounded-xl bg-bg border border-glass-border hover:bg-bg2 text-sm font-bold flex items-center justify-center cursor-pointer"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={reorderModalQty}
                      onChange={(e) => setReorderModalQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24 text-center bg-bg border border-glass-border rounded-xl py-1.5 text-xs text-text font-mono font-black focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => setReorderModalQty(q => q + 1)}
                      className="w-8 h-8 rounded-xl bg-bg border border-glass-border hover:bg-bg2 text-sm font-bold flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                    <span className="text-xs text-muted ml-2">
                      Estimated Total: <strong className="font-mono text-emerald-400 font-bold">₹{(reorderModalQty * (reorderSameModalTarget.ptr || reorderSameModalTarget.previousPurchase?.price || 0)).toFixed(2)}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Workflow Reminder */}
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 space-y-1">
                <div className="font-bold flex items-center gap-1">
                  <AlertCircle size={13} /> Restocking Rule Reminder
                </div>
                <p className="text-[11px] text-amber-300/90 leading-relaxed">
                  Confirming adds this medicine to the distributor's Purchase Order batch. It does <strong>NOT</strong> create the final PO immediately and does <strong>NOT</strong> increase inventory stock. Inventory updates ONLY when goods are received & verified in GRN.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-bg3/60 px-6 py-3.5 border-t border-glass-border flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setReorderSameModalTarget(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReorderSame}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-md cursor-pointer"
              >
                <Check size={14} />
                <span>Confirm & Add to Reorder Cart</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Sent History: finalize ticked medicines ── */}
      {sentPopup && (
        <SentSelectionPopup
          rows={sentPopup.rows}
          busy={readdingSentItems}
          onQty={(key, qty) => setSentPopup(prev => prev ? { ...prev, rows: prev.rows.map(r => r.key === key ? { ...r, qty } : r) } : prev)}
          onRemove={(key) => setSentPopup(prev => prev ? { ...prev, rows: prev.rows.filter(r => r.key !== key) } : prev)}
          onChangeDistributor={(row) => {
            // Same search-all-distributors dropdown as Live Cart Add; the row leaves this list once handed over.
            liveCartAddEvent.triggerOpen(row.name, Math.max(1, Math.floor(row.qty) || 1));
            setSentPopup(prev => prev ? { ...prev, rows: prev.rows.filter(r => r.key !== row.key) } : prev);
          }}
          onConfirm={handleAddSelectedSent}
          onClose={() => setSentPopup(null)}
        />
      )}

      {/* ── Purchase History Modal ── */}
      <CartPurchaseHistoryModal
        target={purchaseHistoryModalTarget}
        onClose={() => setPurchaseHistoryModalTarget(null)}
      />

      {/* ── Confirm Batch WhatsApp Dispatch Modal ── */}
      <BatchDispatchModal
        isOpen={showConfirmBatchModal}
        onClose={() => setShowConfirmBatchModal(false)}
        deliveryBoysList={deliveryBoysList}
        bulkApplyDeliveryBoyId={bulkApplyDeliveryBoyId}
        setBulkApplyDeliveryBoyId={setBulkApplyDeliveryBoyId}
        selectedBatchDeliveryBoys={selectedBatchDeliveryBoys}
        setSelectedBatchDeliveryBoys={setSelectedBatchDeliveryBoys}
        selectedBatchStoreIds={selectedBatchStoreIds}
        setSelectedBatchStoreIds={setSelectedBatchStoreIds}
        batchSummaryList={batchSummaryList}
        finalBatchTotalQty={finalBatchTotalQty}
        finalBatchTotalAmount={finalBatchTotalAmount}
        isSendingBatchWhatsApp={isSendingBatchWhatsApp}
        includeMedicineList={includeMedicineListInBatch}
        setIncludeMedicineList={setIncludeMedicineListInBatch}
        limitIssuesMap={Object.fromEntries(
          distributors.map(d => [d.storeId, getOrderLimitIssues(d, isItemIncludedInDispatch)])
        )}
        onConfirmSend={(selectedIds) => {
          if (isSendingBatchRef.current || isSendingBatchWhatsApp) return;
          setShowConfirmBatchModal(false);
          handleSendAllWhatsAppOrders(false, selectedBatchDeliveryBoys, includeMedicineListInBatch, selectedIds);
        }}
      />

      {/* ── Confirm Single Pharmarack Order Placement Modal ── */}
      <SingleOrderConfirmModal
        target={placeOrderTargetDist}
        onClose={() => !isPlacingSingleOrder && setPlaceOrderTargetDist(null)}
        onConfirm={handleConfirmPlaceSingleOrder}
        isPlacing={isPlacingSingleOrder}
        isItemIncludedInDispatch={isItemIncludedInDispatch}
        getDistributorCheckedTotal={getDistributorCheckedTotal}
        limitIssues={placeOrderTargetDist ? getOrderLimitIssues(placeOrderTargetDist, isItemIncludedInDispatch) : []}
        assignedBoyName={(() => {
          if (!placeOrderTargetDist) return null;
          const boyId = resolveInitialDeliveryBoyId(placeOrderTargetDist, distributorMappings, deliveryBoysList);
          if (boyId === 0) return 'Admin / Store Owner';
          if (boyId) {
            const found = deliveryBoysList.find(b => b.id === boyId);
            return found ? found.name : null;
          }
          return null;
        })()}
      />

      {/* ── Confirm Single WhatsApp Order Dispatch Modal ── */}
      <SingleDispatchModal
        target={singleDispatchTarget}
        onClose={() => setSingleDispatchTarget(null)}
        singleDispatchBoyId={singleDispatchBoyId}
        setSingleDispatchBoyId={setSingleDispatchBoyId}
        deliveryBoysList={deliveryBoysList}
        isItemIncludedInDispatch={isItemIncludedInDispatch}
        getDistributorCheckedTotal={getDistributorCheckedTotal}
        sendingWaDistributorId={sendingWaDistributorId}
        onConfirm={handleConfirmSingleDispatch}
        orderNo={singleDispatchOrderNo}
        setOrderNo={setSingleDispatchOrderNo}
        previewMessage={singleDispatchTarget ? buildDistributorOrderMessage(
          singleDispatchTarget,
          deliveryBoysList.find(b => b.id === singleDispatchBoyId) || null,
          singleDispatchOrderNo
        ) : ''}
      />

      {/* ── Medicine Distributor Link Modal for Shortfall Fillers ── */}
      {linkModalTarget && (
        <MedicineLinkModal
          medicineId={linkModalTarget.medicineId}
          medicineName={linkModalTarget.medicineName}
          onSaved={() => {
            fetchPurchaseHistoryItems();
            fetchReorderRecentItems();
            toastEvent.trigger(`Medicine "${linkModalTarget.medicineName}" linked to distributor! Click Add to place in cart.`, 'success');
            setLinkModalTarget(null);
          }}
          onClose={() => setLinkModalTarget(null)}
        />
      )}
    </div>
  );
}
