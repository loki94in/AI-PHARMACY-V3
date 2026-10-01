import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart, X, Check, AlertCircle, Link2, Plus, Minus, Package, Layers } from 'lucide-react';
import { useModalEscape } from '../services/keyboardShortcuts';
import { MedicineLinkModal } from './MedicineLinkModal';
import type { RefillCartItemInput } from '../services/refillCartJobs';

export interface RefillMedicineItem {
  id: number;
  medicine_id?: number;
  medicine_name: string;
  quantity_needed: number;
  in_stock_qty: number;
  packaging?: string;
  status: string;
  is_active?: number;
  cart_store_name?: string | null;
  cart_qty?: number | null;
  in_live_cart?: boolean;
  linked_distributors?: string[];
}

interface RefillOrderModalProps {
  patientName: string;
  medicines: RefillMedicineItem[];
  onConfirm: (items: RefillCartItemInput[]) => void;
  onClose: () => void;
  onMedicineLinked?: (medicineId: number, linked: string[]) => void;
}

interface ItemState {
  selected: boolean;
  orderQty: number;
}

export const RefillOrderModal: React.FC<RefillOrderModalProps> = ({
  patientName,
  medicines,
  onConfirm,
  onClose,
  onMedicineLinked
}) => {
  // Only active medicines are candidates for ordering
  const activeMeds = medicines.filter(m => m.is_active !== 0 && m.status !== 'canceled' && m.status !== 'paused');

  // Mode: 'full' (default, guarantees dispatch stock) or 'shortage' (subtracts shelf stock)
  const [mode, setMode] = useState<'full' | 'shortage'>('full');

  // Linking modal state
  const [linkingMed, setLinkingMed] = useState<{ id: number; name: string } | null>(null);

  // Initialize selection and quantities
  const [itemStates, setItemStates] = useState<Record<number, ItemState>>(() => {
    const initial: Record<number, ItemState> = {};
    activeMeds.forEach(m => {
      const isAlreadyInCart = !!m.in_live_cart || !!m.cart_store_name;
      const shortage = Math.max(0, Number(m.quantity_needed || 3) - Number(m.in_stock_qty || 0));
      const defaultQty = Number(m.quantity_needed || 3);
      initial[m.id] = {
        // Pre-select items needing order; unselect items that are already in today's cart to prevent duplicate adds
        selected: !isAlreadyInCart,
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
        next[m.id] = {
          ...next[m.id],
          orderQty: targetQty,
          selected: newMode === 'full' ? true : (shortage > 0 && !m.in_live_cart)
        };
      });
      return next;
    });
  };

  const toggleSelect = (id: number) => {
    setItemStates(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        selected: !prev[id]?.selected
      }
    }));
  };

  const toggleSelectAll = () => {
    const allSelected = activeMeds.every(m => itemStates[m.id]?.selected);
    setItemStates(prev => {
      const next = { ...prev };
      activeMeds.forEach(m => {
        next[m.id] = { ...next[m.id], selected: !allSelected };
      });
      return next;
    });
  };

  const updateQty = (id: number, delta: number) => {
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
    const safeVal = Math.max(1, isNaN(val) ? 1 : val);
    setItemStates(prev => ({
      ...prev,
      [id]: { ...prev[id], orderQty: safeVal }
    }));
  };

  const selectedList = activeMeds.filter(m => itemStates[m.id]?.selected);
  const totalSelectedQty = selectedList.reduce((sum, m) => sum + (itemStates[m.id]?.orderQty || 1), 0);

  const handleConfirm = () => {
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
    onConfirm(payload);
  };

  return createPortal(
    <div className="fixed inset-0 z-global-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150">
      <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-3xl h-[85vh] min-h-[540px] max-h-[780px] shadow-2xl overflow-hidden flex flex-col text-text">
        {/* Header */}
        <div className="bg-bg3/80 px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
              <ShoppingCart size={16} />
            </div>
            <div>
              <h3 className="font-extrabold text-text text-sm">Order Refill to Live Cart — {patientName}</h3>
              <p className="text-[11px] text-muted">Review medicines, quantities, and distributor links before adding to the live cart.</p>
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
                title="Default: Orders the full requested prescription quantity to guarantee refill stock on dispatch day"
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
                title="Calculates order quantity as (Prescribed - Shelf Stock)"
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
              {activeMeds.every(m => itemStates[m.id]?.selected) ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        </div>

        {/* Medicine List */}
        <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-2.5 text-xs">
          {activeMeds.length === 0 ? (
            <div className="p-8 text-center text-muted">No active prescribed medicines found for this patient.</div>
          ) : (
            activeMeds.map(med => {
              const state = itemStates[med.id] || { selected: true, orderQty: med.quantity_needed || 3 };
              const isSelected = state.selected;
              const isAlreadyInCart = !!med.in_live_cart || !!med.cart_store_name;
              const shortage = Math.max(0, Number(med.quantity_needed || 3) - Number(med.in_stock_qty || 0));
              const hasDistributor = med.linked_distributors && med.linked_distributors.length > 0;

              return (
                <div
                  key={med.id}
                  onClick={() => toggleSelect(med.id)}
                  className={`rounded-xl border p-3 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-primary/50 bg-primary/5 shadow-xs'
                      : 'border-border bg-bg opacity-75 hover:opacity-100'
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

                          {isAlreadyInCart && (
                            <span
                              className="px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-400 font-bold flex items-center gap-1"
                              title="Already in today's active Pharmarack live cart"
                            >
                              <ShoppingCart size={10} /> In Live Cart: {med.cart_store_name || 'Cart'} ×{med.cart_qty || 1}
                            </span>
                          )}
                        </div>

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
                        onClick={() => updateQty(med.id, -1)}
                        className="w-6 h-6 rounded-lg bg-bg3 hover:bg-bg border border-border flex items-center justify-center text-muted hover:text-text cursor-pointer transition-colors"
                      >
                        <Minus size={11} />
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={state.orderQty}
                        onChange={e => setExactQty(med.id, parseInt(e.target.value, 10))}
                        className="w-10 text-center font-extrabold text-text bg-bg border border-border rounded-lg py-0.5 text-xs focus:outline-hidden focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => updateQty(med.id, 1)}
                        className="w-6 h-6 rounded-lg bg-bg3 hover:bg-bg border border-border flex items-center justify-center text-muted hover:text-text cursor-pointer transition-colors"
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
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedList.length === 0}
              onClick={handleConfirm}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white font-extrabold shadow-md shadow-primary/25 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <ShoppingCart size={14} />
              <span>⚡ Add Selected ({selectedList.length}) to Cart</span>
            </button>
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
