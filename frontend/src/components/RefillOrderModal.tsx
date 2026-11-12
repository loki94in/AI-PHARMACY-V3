import React, { useState, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  ShoppingCart, X, Check, AlertCircle, Link2, Plus, Minus,
  Package, Layers, Loader2, BellRing, CheckCheck, Clock, AlertTriangle, MessageSquare
} from 'lucide-react';
import { useModalEscape } from '../services/keyboardShortcuts';
import { MedicineLinkModal } from './MedicineLinkModal';
import { api, apiClient } from '../services/api';
import { toastEvent, refillEvent, whatsappQueueEvent } from '../services/events';
import { queryClient } from '../lib/queryClient';
import { subscribeRefillCartJobs, getRefillCartJobs, startRefillCartJob, isRefillJobRunning, type RefillCartItemInput } from '../services/refillCartJobs';
import { isRefillQaStaged, isRefillOrdered, isRefillActuallyFulfilled, isEarlyCrmAddition, effectiveRefillLeadDays } from '../utils/refillSettled';

export interface RefillMedicineItem {
  id: number;
  medicine_id?: number;
  medicine_name: string;
  quantity_needed: number;
  in_stock_qty: number;
  packaging?: string;
  status: string;
  is_active?: number;
  last_refill_date?: string | null;
  next_refill_date?: string | null;
  refill_interval_days?: number | null;
  cart_store_name?: string | null;
  cart_qty?: number | null;
  qa_cart_qty?: number | null;
  qa_staged_at?: string | null;
  is_early_crm_addition?: boolean;
  cart_cycle_due_date?: string | null;
  cart_status?: string | null;
  in_live_cart?: boolean;
  linked_distributors?: string[];
}

export interface RefillOrderModalProps {
  patientName: string;
  patientPhone?: string;
  patientKey?: string;
  workflowMode?: 'crm_select' | 'qa_approve';
  initialSelectedIds?: number[];
  medicines: RefillMedicineItem[];
  onConfirm?: (items: RefillCartItemInput[]) => void | Promise<void>;
  onClose: () => void;
  onMedicineLinked?: (medicineId: number, linked: string[]) => void;
  onMarkReady?: (selectedIds?: number[]) => Promise<void> | void;
  onPostAndComplete?: (selectedIds?: number[]) => Promise<void> | void;
}

interface ItemState {
  selected: boolean;
  orderQty: number;
}

export const RefillOrderModal: React.FC<RefillOrderModalProps> = ({
  patientName,
  patientPhone,
  patientKey,
  initialSelectedIds,
  medicines,
  onConfirm,
  onClose,
  onMedicineLinked,
  onMarkReady,
  onPostAndComplete
}) => {
  // Local state of medicines reflecting live in-cart / QA status
  const [localMeds, setLocalMeds] = useState<RefillMedicineItem[]>(medicines);
  useEffect(() => {
    setLocalMeds(medicines);
    setItemStates(prev => {
      let changed = false;
      const next = { ...prev };
      medicines.forEach(m => {
        if (!next[m.id]) {
          changed = true;
          const shortage = Math.max(0, Number(m.quantity_needed || 3) - Number(m.in_stock_qty || 0));
          const defaultQty = Number(m.qa_cart_qty || m.cart_qty || m.quantity_needed || 3);
          next[m.id] = {
            selected: false,
            orderQty: defaultQty > 0 ? defaultQty : Math.max(1, shortage)
          };
        }
      });
      return changed ? next : prev;
    });
  }, [medicines]);

  // Only active medicines are candidates for ordering
  const activeMeds = localMeds.filter(m => m.is_active !== 0 && m.status !== 'canceled' && m.status !== 'paused');

  // Mode: 'full' (guarantees dispatch stock) or 'shortage' (subtracts shelf stock)
  const [mode, setMode] = useState<'full' | 'shortage'>('full');

  // Linking modal state
  const [linkingMed, setLinkingMed] = useState<{ id: number; name: string } | null>(null);

  // Status & Feedback States
  const [validationError, setValidationError] = useState<string | null>(null);
  const [cartError, setCartError] = useState<string | null>(null);
  const [isCartUpdated, setIsCartUpdated] = useState(false);
  const [isMarkingReady, setIsMarkingReady] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isNotifyingBooking, setIsNotifyingBooking] = useState(false);

  // Background Live Cart Job coordination (scoped strictly to an actively running job for this patientKey)
  const jobs = useSyncExternalStore(subscribeRefillCartJobs, getRefillCartJobs);
  const activeJob = jobs.find(
    j => (patientKey ? (j.patientKey || j.patientName) === patientKey : j.patientName === patientName) && isRefillJobRunning(j)
  );
  const isJobRunning = Boolean(activeJob);

  useEffect(() => {
    if (!activeJob) return;
    const finishedRows = activeJob.rows.filter(r => r.state === 'added' || r.state === 'in_cart');
    if (finishedRows.length > 0) {
      setLocalMeds(prev => prev.map(m => {
        const matchingRow = activeJob.rows.find(r => r.refillId === m.id);
        if (matchingRow && (matchingRow.state === 'added' || matchingRow.state === 'in_cart')) {
          return {
            ...m,
            in_live_cart: true,
            cart_qty: matchingRow.qty || m.cart_qty || 1,
            cart_store_name: matchingRow.line?.storeName || m.cart_store_name || 'Live Cart'
          };
        }
        return m;
      }));
      setIsCartUpdated(true);
    }
  }, [activeJob]);

  // Pharmacist can always select any medicine, even if fulfilled or already in cart.
  const isCycleDuplicateLocked = (_m: RefillMedicineItem): boolean => false;

  const isAlreadyInCartOrOrdered = (m: RefillMedicineItem): boolean => {
    const isAlreadyInCart = !!m.in_live_cart || !!m.cart_store_name || m.cart_status === 'added';
    return isAlreadyInCart || isRefillOrdered(m);
  };

  // Initialize selection and quantities without auto-selecting already-processed items
  const [itemStates, setItemStates] = useState<Record<number, ItemState>>(() => {
    const initial: Record<number, ItemState> = {};
    const initialSet = initialSelectedIds && initialSelectedIds.length > 0 ? new Set(initialSelectedIds) : null;
    activeMeds.forEach(m => {
      const isProcessed = isAlreadyInCartOrOrdered(m);
      const shortage = Math.max(0, Number(m.quantity_needed || 3) - Number(m.in_stock_qty || 0));
      const defaultQty = Number(m.qa_cart_qty || m.cart_qty || m.quantity_needed || 3);

      let selected = false;
      if (isProcessed) {
        selected = false;
      } else if (initialSet) {
        selected = initialSet.has(m.id);
      } else {
        selected = true;
      }

      initial[m.id] = {
        selected,
        orderQty: defaultQty > 0 ? defaultQty : Math.max(1, shortage)
      };
    });
    return initial;
  });

  useModalEscape(!linkingMed, onClose);

  // Switch between Full Prescribed Qty and Shortages Only
  const handleModeChange = (newMode: 'full' | 'shortage') => {
    setMode(newMode);
    setItemStates(prev => {
      const next = { ...prev };
      activeMeds.forEach(m => {
        const fullQty = Math.max(1, Number(m.quantity_needed || 3));
        const shortage = Math.max(0, fullQty - Number(m.in_stock_qty || 0));
        const targetQty = newMode === 'full' ? fullQty : (shortage > 0 ? shortage : 1);
        const skipAutoSelect = isAlreadyInCartOrOrdered(m);
        next[m.id] = {
          ...next[m.id],
          orderQty: skipAutoSelect ? (next[m.id]?.orderQty || targetQty) : targetQty,
          selected: skipAutoSelect ? false : (newMode === 'full' ? true : (shortage > 0))
        };
      });
      return next;
    });
  };

  const toggleSelect = (id: number) => {
    const med = activeMeds.find(m => m.id === id);
    if (med && isCycleDuplicateLocked(med)) return;
    setValidationError(null);
    setItemStates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        selected: !prev[id]?.selected
      }
    }));
  };

  const toggleSelectAll = () => {
    setValidationError(null);
    const selectable = activeMeds.filter(m => !isCycleDuplicateLocked(m));
    const allSelected = selectable.length > 0 && selectable.every(m => itemStates[m.id]?.selected);
    setItemStates(prev => {
      const next = { ...prev };
      activeMeds.forEach(m => {
        next[m.id] = { ...next[m.id], selected: isCycleDuplicateLocked(m) ? false : !allSelected };
      });
      return next;
    });
  };

  const updateQty = (id: number, delta: number) => {
    setValidationError(null);
    setItemStates(prev => {
      const current = prev[id]?.orderQty || 1;
      const nextQty = Math.max(1, current + delta);
      return {
        ...prev,
        [id]: { ...prev[id], orderQty: nextQty }
      };
    });
  };

  const setExactQty = (id: number, val: number) => {
    setValidationError(null);
    const safeVal = Math.max(1, isNaN(val) ? 1 : val);
    setItemStates(prev => ({
      ...prev,
      [id]: { ...prev[id], orderQty: safeVal }
    }));
  };

  const selectedList = activeMeds.filter(m => itemStates[m.id]?.selected);
  const totalSelectedQty = selectedList.reduce((sum, m) => sum + (itemStates[m.id]?.orderQty || 1), 0);

  // Node L, M, O, P, Q, R: Validate and trigger background live cart addition with selected medicines only
  const handleUpdateCart = async () => {
    // Node J: At least one valid medicine selected?
    if (selectedList.length === 0) {
      setValidationError('Please select at least one medicine with quantity ≥ 1 to update the cart.');
      return;
    }

    // Node L: Validate selected medicines and quantities
    for (const med of selectedList) {
      const q = itemStates[med.id]?.orderQty;
      if (!q || isNaN(q) || q < 1 || !Number.isInteger(q)) {
        setValidationError(`Invalid quantity for "${med.medicine_name}". Quantity must be a positive whole number.`);
        return;
      }
    }

    setValidationError(null);
    setCartError(null);

    const payload: RefillCartItemInput[] = selectedList.map(m => ({
      refillId: m.id,
      medicineId: m.medicine_id,
      medicineName: m.medicine_name,
      qty: itemStates[m.id]?.orderQty || 1,
      neededQty: m.quantity_needed,
      stockQty: m.in_stock_qty,
      cartStoreName: m.cart_store_name,
      cartQty: m.cart_qty,
      inLiveCart: m.in_live_cart
    }));

    try {
      // Direct 1-step Pharmarack Live Cart addition strictly for selected medicines & quantities
      startRefillCartJob(patientName, payload, { openModal: false, patientKey });
      toastEvent.trigger(`Adding ${payload.length} medicine(s) to Live Cart in the background…`, 'info', '/pharmarack-cart');
      onClose();

      if (onConfirm) {
        Promise.resolve(onConfirm(payload)).catch(() => {});
      }
    } catch (err: unknown) {
      console.error('Failed to process refill selection:', err);
      const apiErr = err as { response?: { data?: { error?: string } }; message?: string };
      setCartError(apiErr.response?.data?.error || apiErr.message || 'Failed to process refill selection.');
    }
  };

  // Send one consolidated booking / re-order notification WhatsApp message to patient
  const handleNotifyBooking = async () => {
    if (!patientPhone) {
      toastEvent.trigger('Patient phone number missing', 'error');
      return;
    }
    const selectedIds = selectedList.map(m => m.id);
    if (selectedIds.length === 0) {
      setValidationError('Please select at least one medicine to notify.');
      return;
    }

    setIsNotifyingBooking(true);
    try {
      const res = await apiClient.post(`/refills/patient/${encodeURIComponent(patientPhone)}/notify-booked`, {
        refill_ids: selectedIds,
        is_reorder: true
      });
      if (res.data?.whatsapp_queued) {
        toastEvent.trigger(`Re-order booking WhatsApp queued for "${patientName}" (${selectedIds.length} medicine(s))!`, 'success');
      } else {
        toastEvent.trigger(res.data?.message || `Booking alert already sent recently for "${patientName}"`, 'info');
      }
      whatsappQueueEvent.triggerUpdated();
    } catch (err: any) {
      console.error('Failed to notify booking WhatsApp:', err);
      const errMsg = err?.response?.data?.error || err?.message || 'Failed to send booking WhatsApp';
      toastEvent.trigger(errMsg, 'error');
    } finally {
      setIsNotifyingBooking(false);
    }
  };

  // Node T & V: Run existing Mark Ready workflow
  const handleRunMarkReady = async () => {
    setIsMarkingReady(true);
    try {
      const selectedIds = selectedList.map(m => m.id);
      if (onMarkReady) {
        await onMarkReady(selectedIds);
      } else if (patientPhone) {
        const res = await apiClient.post(`/refills/patient/${encodeURIComponent(patientPhone)}/mark-ready`, {
          refill_ids: selectedIds
        });
        if (res.data?.whatsapp_queued) {
          toastEvent.trigger(`Marked ready & pickup WhatsApp queued for "${patientName}"!`, 'success');
        } else {
          toastEvent.trigger(`Marked refills for "${patientName}" as Ready!`, 'success');
        }
      }
      refillEvent.triggerRefresh();
      whatsappQueueEvent.triggerUpdated();
      queryClient.invalidateQueries({ queryKey: ['refills'] });
      onClose();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: string } }; message?: string };
      toastEvent.trigger(apiErr.response?.data?.error || apiErr.message || 'Failed to mark refills ready', 'error');
    } finally {
      setIsMarkingReady(false);
    }
  };

  // Node U & W: Run existing Post & Complete workflow
  const handleRunPostAndComplete = async () => {
    setIsCompleting(true);
    try {
      const selectedIds = selectedList.map(m => m.id);
      if (onPostAndComplete) {
        await onPostAndComplete(selectedIds);
      } else if (patientPhone) {
        const cleanPhone = patientPhone.trim();
        const res = await api.fulfillAllRefills(cleanPhone, {
          refill_ids: selectedIds,
          fulfilled_via: 'refill_order_modal_complete',
          patient_phone: cleanPhone
        });
        toastEvent.trigger(res.message || `Refill cycle completed & scheduled for next month for "${patientName}"!`, 'success');
      }
      refillEvent.triggerRefresh();
      queryClient.invalidateQueries({ queryKey: ['refills'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onClose();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: string } }; message?: string };
      toastEvent.trigger(apiErr.response?.data?.error || apiErr.message || 'Failed to complete refill cycle', 'error');
    } finally {
      setIsCompleting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-global-modal bg-black/60 flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150">
      <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-3xl h-[85vh] min-h-[540px] max-h-[780px] shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col text-text">
        {/* Header */}
        <div className="bg-bg3/80 px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
              <ShoppingCart size={16} />
            </div>
            <div>
              <h3 className="font-extrabold text-text text-sm">
                Add to Live Cart — {patientName}
              </h3>
              <p className="text-[11px] text-muted">
                Select medicines and edit quantities. Click Add to Cart to add only selected items directly.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode Selector & Quick Actions */}
        <div className="px-5 py-3 border-b border-border/60 bg-bg3/30 flex items-center justify-between gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-muted uppercase tracking-wider">Quantity Mode:</span>
            <div className="flex items-center bg-bg rounded-xl border border-border p-0.5">
              <button
                type="button"
                onClick={() => handleModeChange('full')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  mode === 'full'
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-muted hover:text-text'
                }`}
                title="Orders full prescribed quantity"
              >
                <Package size={12} />
                <span>Full Prescribed Qty</span>
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('shortage')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  mode === 'shortage'
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-muted hover:text-text'
                }`}
                title="Orders only current shortage (Prescribed - Shelf Stock)"
              >
                <Layers size={12} />
                <span>Shortage Only</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="px-2.5 py-1 rounded-lg bg-bg2 border border-border hover:border-primary/40 text-muted hover:text-text text-[11px] font-semibold transition-all cursor-pointer"
            >
              {activeMeds.some(m => !isCycleDuplicateLocked(m)) && activeMeds.filter(m => !isCycleDuplicateLocked(m)).every(m => itemStates[m.id]?.selected) ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        </div>

        {/* Node K / N / Q: Guidance & Error Alerts */}
        {selectedList.length === 0 && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle size={14} className="shrink-0 text-amber-400" />
            <span>Select at least one medicine with quantity ≥ 1 to proceed with cart update.</span>
          </div>
        )}

        {validationError && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle size={14} className="shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {cartError && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle size={14} className="shrink-0" />
            <span>{cartError}</span>
          </div>
        )}

        {/* Live Background Progress Banner */}
        {isJobRunning && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-primary/10 border border-primary/30 text-primary text-xs flex items-center justify-between gap-3 shrink-0 flex-wrap">
            <div className="flex items-center gap-2.5">
              <Loader2 size={16} className="animate-spin text-primary shrink-0" />
              <div>
                <div className="font-extrabold text-sm">Adding to Live Cart in Background</div>
                <div className="text-[11px] text-muted">Checking stock across distributors and updating cart. You can close this window at any time.</div>
              </div>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-primary/20 text-primary font-bold text-[11px]">
              Background Active
            </span>
          </div>
        )}

        {/* Node R & S: Post-Update Success Guidance & Next Actions Banner */}
        {isCartUpdated && !isJobRunning && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between gap-3 shrink-0 flex-wrap">
            <div className="flex items-center gap-2">
              <CheckCheck size={16} className="shrink-0" />
              <div>
                <div className="font-extrabold text-sm">Cart updated successfully!</div>
                <div className="text-[11px] text-emerald-300">Choose a next action below or keep in cart:</div>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <button
                type="button"
                disabled={isNotifyingBooking}
                onClick={handleNotifyBooking}
                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 transition-all"
                title="Send one consolidated WhatsApp message confirming medicines are booked"
              >
                {isNotifyingBooking ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />}
                <span>Notify Booking</span>
              </button>
              <button
                type="button"
                disabled={isMarkingReady}
                onClick={handleRunMarkReady}
                className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 transition-all"
                title="Mark refills ready and dispatch WhatsApp pickup alert"
              >
                {isMarkingReady ? <Loader2 size={12} className="animate-spin" /> : <BellRing size={12} />}
                <span>Mark Ready</span>
              </button>
              <button
                type="button"
                disabled={isCompleting}
                onClick={handleRunPostAndComplete}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 transition-all"
                title="Complete refill cycle and schedule next month"
              >
                {isCompleting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                <span>Post & Complete</span>
              </button>
            </div>
          </div>
        )}

        {/* Medicine List */}
        <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-2.5 text-xs">
          {activeMeds.length === 0 ? (
            <div className="p-8 text-center text-muted">No active prescribed medicines found for this patient.</div>
          ) : (
            activeMeds.map(med => {
              const state = itemStates[med.id] || { selected: false, orderQty: med.qa_cart_qty || med.quantity_needed || 3 };
              const isSelected = state.selected;
              const isAlreadyInCart = !!med.in_live_cart || !!med.cart_store_name || med.cart_status === 'added';
              const isQaQueued = isRefillQaStaged(med);
              const isFulfilled = isRefillActuallyFulfilled(med);
              const isDuplicateLocked = isCycleDuplicateLocked(med);
              const earlyProvenance = isEarlyCrmAddition(med);
              const scheduledDueStr = med.next_refill_date
                ? new Date(med.next_refill_date).toLocaleDateString([], { day: 'numeric', month: 'short' })
                : null;
              const isFutureEarlyEligible = (() => {
                if (!med.next_refill_date || isDuplicateLocked) return false;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const due = new Date(`${String(med.next_refill_date).slice(0, 10)}T00:00:00`);
                if (isNaN(due.getTime())) return false;
                const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
                return diff > effectiveRefillLeadDays(med.refill_interval_days, 7);
              })();
              const shortage = Math.max(0, Number(med.quantity_needed || 3) - Number(med.in_stock_qty || 0));
              const hasDistributor = med.linked_distributors && med.linked_distributors.length > 0;
              const jobRow = activeJob?.rows.find(r => r.refillId === med.id);

              return (
                <div
                  key={med.id}
                  onClick={() => toggleSelect(med.id)}
                  className={`rounded-xl border p-3 transition-all ${
                    isSelected
                      ? 'border-primary/50 bg-primary/5 shadow-xs cursor-pointer'
                      : 'border-border bg-bg opacity-85 hover:opacity-100 cursor-pointer'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    {/* Checkbox & Medicine Details */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(med.id)}
                        onClick={e => e.stopPropagation()}
                        title="Select medicine to add to Live Cart"
                        className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="font-extrabold text-text text-sm flex items-center gap-2 flex-wrap">
                          <span>{med.medicine_name}</span>
                          {med.packaging && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg3 text-muted font-normal">
                              {med.packaging}
                            </span>
                          )}
                        </div>

                        {/* Badges: Shelf Stock, Prescribed, Shortage, Live Cart */}
                        <div className="flex items-center gap-2 flex-wrap text-[11px]">
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold flex items-center gap-1 ${
                              med.in_stock_qty > 0
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-red-500/15 text-red-400 border border-red-500/30'
                            }`}
                          >
                            Shelf Stock: {med.in_stock_qty || 0}
                          </span>

                          <span className="px-2 py-0.5 rounded-md bg-bg3 border border-border text-muted font-semibold">
                            Prescribed: {med.quantity_needed || 3}
                          </span>

                          {shortage > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold flex items-center gap-1">
                              <AlertCircle size={10} /> Shortage: {shortage}
                            </span>
                          )}

                          {scheduledDueStr && (
                            <span className="px-2 py-0.5 rounded-md bg-bg3 border border-border text-muted font-semibold">
                              Due: {scheduledDueStr}
                            </span>
                          )}

                          {(earlyProvenance || isFutureEarlyEligible) && (
                            <span
                              className="px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 font-bold"
                              title="Scheduled for a future due date — allowed for early pharmacist CRM selection without auto-completing the cycle"
                            >
                              {earlyProvenance ? 'Early CRM addition' : 'Early selection'}
                            </span>
                          )}

                          {isQaQueued && (
                            <span
                              className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold flex items-center gap-1"
                              title="Selected for Live Cart addition"
                            >
                              <Clock size={10} /> In QA ×{med.qa_cart_qty || state.orderQty}
                            </span>
                          )}

                          {isAlreadyInCart && (
                            <span
                              className="px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-400 font-bold flex items-center gap-1"
                              title="Already in active Pharmarack live cart for this cycle (duplicate prevented)"
                            >
                              <ShoppingCart size={10} /> In Live Cart: {med.cart_store_name || 'Cart'} ×{med.cart_qty || 1}
                            </span>
                          )}

                          {!isAlreadyInCart && med.status === 'ordered' && (
                            <span className="px-2 py-0.5 rounded-md bg-purple-500/15 border border-purple-500/30 text-purple-400 font-bold">
                              Ordered
                            </span>
                          )}

                          {med.cart_status === 'linked_oos' && (
                            <span className="px-2 py-0.5 rounded-md bg-orange-500/15 border border-orange-500/30 text-orange-400 font-bold">
                              Out of Stock (Distributor)
                            </span>
                          )}

                          {med.cart_status === 'needs_link' && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold">
                              Needs Link
                            </span>
                          )}

                          {isFulfilled && (
                            <span
                              className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold"
                              title="Fulfilled for current cycle"
                            >
                              Fulfilled
                            </span>
                          )}
                        </div>

                        {/* Live Background Row State */}
                        {jobRow && (
                          <div className="pt-1 flex items-center gap-2 flex-wrap">
                            {jobRow.state === 'working' && (
                              <span className="px-2 py-0.5 rounded-md bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold flex items-center gap-1">
                                <Loader2 size={10} className="animate-spin" /> {jobRow.message || 'Checking stock…'}
                              </span>
                            )}
                            {jobRow.state === 'queued' && (
                              <span className="px-2 py-0.5 rounded-md bg-bg3 border border-border text-muted text-[10px] font-semibold flex items-center gap-1">
                                <Clock size={10} /> Queued in background…
                              </span>
                            )}
                            {jobRow.state === 'added' && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold flex items-center gap-1">
                                <Check size={10} /> {jobRow.message || 'Added to Cart'}
                              </span>
                            )}
                            {jobRow.state === 'in_cart' && (
                              <span className="px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-400 text-[10px] font-bold flex items-center gap-1">
                                <ShoppingCart size={10} /> {jobRow.message || 'In Live Cart'}
                              </span>
                            )}
                            {(jobRow.state === 'failed' || jobRow.state === 'linked_oos' || jobRow.state === 'needs_link') && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold flex items-center gap-1">
                                <AlertTriangle size={10} /> {jobRow.message}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Distributor Status */}
                        <div className="pt-1 flex items-center gap-2">
                          {hasDistributor ? (
                            <span className="text-[11px] text-muted flex items-center gap-1">
                              <Link2 size={11} className="text-primary" />
                              <span>Linked: <strong className="text-text">{med.linked_distributors![0]}</strong>{med.linked_distributors!.length > 1 ? ` (+${med.linked_distributors!.length - 1})` : ''}</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                if (med.medicine_id) setLinkingMed({ id: med.medicine_id, name: med.medicine_name });
                              }}
                              className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold flex items-center gap-1 hover:bg-amber-500/25 transition-colors cursor-pointer"
                            >
                              <Link2 size={10} /> Link Distributor
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quantity Stepper Control */}
                    <div
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1.5 shrink-0 bg-bg2 border border-border rounded-xl p-1 shadow-xs"
                    >
                      <span className="text-[10px] font-bold text-muted px-1">Order Qty:</span>
                      <button
                        type="button"
                        disabled={isJobRunning}
                        onClick={() => updateQty(med.id, -1)}
                        className="w-6 h-6 rounded-lg bg-bg3 hover:bg-bg border border-border flex items-center justify-center text-muted hover:text-text cursor-pointer transition-colors disabled:opacity-40"
                      >
                        <Minus size={11} />
                      </button>
                      <input
                        type="number"
                        min="1"
                        disabled={isJobRunning}
                        value={state.orderQty}
                        onChange={e => setExactQty(med.id, parseInt(e.target.value, 10))}
                        className="w-10 text-center font-extrabold text-text bg-bg border border-border rounded-lg py-0.5 text-xs focus:outline-hidden focus:border-primary disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={isJobRunning}
                        onClick={() => updateQty(med.id, 1)}
                        className="w-6 h-6 rounded-lg bg-bg3 hover:bg-bg border border-border flex items-center justify-center text-muted hover:text-text cursor-pointer transition-colors disabled:opacity-40"
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-border bg-bg3/50 flex items-center justify-between gap-3 flex-wrap shrink-0 text-xs">
          <div className="space-y-0.5">
            <div className="font-extrabold text-text">
              Selected: <span className="text-primary font-black">{selectedList.length}</span> of {activeMeds.length} medicine(s)
            </div>
            <div className="text-[11px] text-muted">
              Total Order Volume: <strong>{totalSelectedQty}</strong> unit(s)
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-bg border border-border text-muted hover:text-text font-bold transition-all cursor-pointer"
            >
              {isCartUpdated ? 'Done / Close' : 'Cancel'}
            </button>
            {(() => {
              const allSelectedAlreadyInCart = selectedList.length > 0 && selectedList.every(m => m.in_live_cart || m.cart_store_name);
              const actionVerb = allSelectedAlreadyInCart ? 'Update Cart' : 'Add to Cart';
              const busy = isJobRunning;

              return (
                <button
                  type="button"
                  disabled={selectedList.length === 0 || busy}
                  onClick={handleUpdateCart}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-extrabold shadow-md shadow-primary/25 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {busy ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Adding in Background…</span>
                    </>
                  ) : (
                    <>
                      <ShoppingCart size={14} />
                      <span>{actionVerb} ({selectedList.length})</span>
                    </>
                  )}
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      {linkingMed && (
        <MedicineLinkModal
          medicineId={linkingMed.id}
          medicineName={linkingMed.name}
          onSaved={links => {
            if (onMedicineLinked) onMedicineLinked(linkingMed.id, links || []);
            setLinkingMed(null);
          }}
          onClose={() => setLinkingMed(null)}
        />
      )}
    </div>,
    document.body
  );
};
