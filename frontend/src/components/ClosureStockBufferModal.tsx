import React, { useState, useEffect, useMemo } from 'react';
import { X, CheckSquare, Square, ShoppingCart, MessageSquare, AlertCircle, Calendar, Package, RefreshCw, Minus, Plus } from 'lucide-react';
import { api } from '../services/api';
import { toastEvent, refillEvent } from '../services/events';
import { startRefillCartJob, type RefillCartItemInput } from '../services/refillCartJobs';
import { useModalEscape } from '../services/keyboardShortcuts';
import { MedicineLinkModal } from './MedicineLinkModal';

interface ClosureStockBufferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCartUpdated?: () => void;
}

interface BufferItem {
  refill_id: number;
  patient_name: string;
  patient_phone: string;
  medicine_id: number;
  medicine_name: string;
  manufacturer: string;
  pack_size: number | string;
  next_refill_date: string;
  quantity_needed: number;
  current_stock: number;
  shortfall_packs: number;
  recommended_order_qty: number;
  mrp: number;
  rate: number;
  distributor_name: string;
  status: 'shortfall' | 'sufficient';
  is_in_cart?: boolean;
  cart_store_name?: string;
  linked_distributors_count?: number;
}

export const ClosureStockBufferModal: React.FC<ClosureStockBufferModalProps> = ({
  isOpen,
  onClose,
  onCartUpdated,
}) => {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<any>(null);
  const [items, setItems] = useState<BufferItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [orderQtys, setOrderQtys] = useState<Record<number, number>>({});
  const [mode, setMode] = useState<'shortage' | 'full'>('shortage');
  const [isStagingNotices, setIsStagingNotices] = useState(false);
  const [linkingMedicine, setLinkingMedicine] = useState<{ id: number; name: string } | null>(null);

  const fetchBuffer = () => {
    setLoading(true);
    api.getMarketClosureBuffer()
      .then((res: any) => {
        if (res?.success) {
          setConfig(res.config);
          const rawItems: BufferItem[] = res.items || [];
          setItems(rawItems);
          
          // Pre-select items with shortfall by default in 'shortage' mode
          const autoSelected = new Set<number>();
          const initialQtys: Record<number, number> = {};
          rawItems.forEach(it => {
            const qty = it.shortfall_packs > 0 ? it.shortfall_packs : (it.recommended_order_qty > 0 ? it.recommended_order_qty : 1);
            initialQtys[it.refill_id] = qty;
            if (it.shortfall_packs > 0) {
              autoSelected.add(it.refill_id);
            }
          });
          setSelectedIds(autoSelected.size > 0 ? autoSelected : new Set(rawItems.map(i => i.refill_id)));
          setOrderQtys(initialQtys);
        }
      })
      .catch((err: any) => console.error('Failed to load closure buffer:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen) {
      fetchBuffer();
      const unsub = refillEvent.subscribeRefresh(() => {
        fetchBuffer();
      });
      return () => unsub();
    }
  }, [isOpen]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(items.map(i => i.refill_id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  const handleModeChange = (newMode: 'shortage' | 'full') => {
    setMode(newMode);
    const updatedQtys: Record<number, number> = {};
    const updatedSelected = new Set<number>();

    items.forEach(it => {
      if (newMode === 'shortage') {
        const qty = it.shortfall_packs > 0 ? it.shortfall_packs : 1;
        updatedQtys[it.refill_id] = qty;
        if (it.shortfall_packs > 0) {
          updatedSelected.add(it.refill_id);
        }
      } else {
        const qty = it.quantity_needed > 0 ? it.quantity_needed : 1;
        updatedQtys[it.refill_id] = qty;
        updatedSelected.add(it.refill_id);
      }
    });

    setOrderQtys(updatedQtys);
    setSelectedIds(updatedSelected.size > 0 ? updatedSelected : new Set(items.map(i => i.refill_id)));
  };

  const handleStepQty = (refillId: number, delta: number) => {
    setOrderQtys(prev => {
      const current = prev[refillId] !== undefined && prev[refillId] > 0 ? prev[refillId] : 1;
      return {
        ...prev,
        [refillId]: Math.max(1, current + delta)
      };
    });
  };

  const handleInputChange = (refillId: number, valStr: string) => {
    if (valStr === '') {
      // Allow user to clear the input without immediate snap-back to 1
      setOrderQtys(prev => ({
        ...prev,
        [refillId]: 0
      }));
    } else {
      const num = parseInt(valStr, 10);
      if (!isNaN(num)) {
        setOrderQtys(prev => ({
          ...prev,
          [refillId]: Math.min(999, Math.max(1, num))
        }));
      }
    }
  };

  const handleInputBlur = (refillId: number) => {
    setOrderQtys(prev => ({
      ...prev,
      [refillId]: prev[refillId] && prev[refillId] > 0 ? prev[refillId] : 1
    }));
  };

  const selectedCount = selectedIds.size;
  const totalPacksToOrder = useMemo(() => {
    let sum = 0;
    selectedIds.forEach(id => {
      const val = orderQtys[id];
      sum += (val !== undefined && val > 0) ? val : 1;
    });
    return sum;
  }, [selectedIds, orderQtys]);

  const selectedItems = useMemo(() => items.filter(it => selectedIds.has(it.refill_id)), [items, selectedIds]);
  const unlinkedSelectedCount = useMemo(() => selectedItems.filter(it => (it.linked_distributors_count || 0) === 0).length, [selectedItems]);

  const handleAddToCart = () => {
    if (selectedCount === 0) {
      toastEvent.trigger('Please select at least one medicine to add to cart', 'info');
      return;
    }

    const selectedRefillInputs: RefillCartItemInput[] = items
      .filter(it => selectedIds.has(it.refill_id))
      .map(it => ({
        refillId: it.refill_id,
        medicineId: it.medicine_id,
        medicineName: it.medicine_name,
        qty: orderQtys[it.refill_id] && orderQtys[it.refill_id] > 0
          ? orderQtys[it.refill_id]
          : (it.shortfall_packs > 0 ? it.shortfall_packs : 1)
      }));

    // Start background job visible on screen in top-right floating progress card
    startRefillCartJob('Market Closure Buffer', selectedRefillInputs, { openModal: false });

    toastEvent.trigger(
      `Adding ${selectedRefillInputs.length} buffer medicine(s) to Live Cart in background...`,
      'info'
    );
    onCartUpdated?.();
    refillEvent.triggerRefresh();
    onClose();
  };

  const handleStageWhatsAppNotices = async () => {
    if (selectedCount === 0) {
      toastEvent.trigger('Please select at least one refill patient to notify', 'info');
      return;
    }
    setIsStagingNotices(true);
    try {
      const refillIds = Array.from(selectedIds);
      const res = await api.stageClosureNotices(refillIds);
      toastEvent.trigger(
        `Staged ${res.stagedCount} WhatsApp notices for ${res.patientCount} patient(s). Review & approve them in CRM before sending.`,
        'info'
      );
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to stage notices', 'error');
    } finally {
      setIsStagingNotices(false);
    }
  };

  useModalEscape(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-150">
      <div className="bg-bg border border-border w-[95vw] max-w-4xl h-[85vh] min-h-[560px] max-h-[840px] rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border/40 flex items-center justify-between bg-bg2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
              <Package size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text">
                  {config?.type === 'pharmacy_closed' ? 'Store Closure' : 'Market Closure'} Stock Buffer Review
                </h2>
                {config?.startDate && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-500 border border-amber-500/40">
                    {config.startDate} {config.endDate && config.endDate !== config.startDate ? `to ${config.endDate}` : ''}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted">
                {items.length} upcoming refill medicine(s) in next {config?.lookaheadDays || 7} days. Select items to order before distributor shutdown.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Action Bar */}
        <div className="p-3 bg-bg3/30 border-b border-border/30 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={selectAll}
              className="text-primary hover:underline font-bold cursor-pointer"
            >
              Select All ({items.length})
            </button>
            <span className="text-muted">•</span>
            <button
              type="button"
              onClick={selectNone}
              className="text-muted hover:text-text cursor-pointer"
            >
              Deselect All
            </button>
            <span className="text-muted">•</span>
            <span className="font-mono text-text">
              Selected: <strong>{selectedCount}</strong> items ({totalPacksToOrder} packs)
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Shortage vs Full Demand Mode Toggle */}
            <div className="flex items-center gap-1 bg-bg2 p-0.5 rounded-lg border border-border/60">
              <button
                type="button"
                onClick={() => handleModeChange('shortage')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  mode === 'shortage'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-muted hover:text-text'
                }`}
                title="Order only the shortage quantity required to fulfill upcoming refills"
              >
                Shortage Only
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('full')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  mode === 'full'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-muted hover:text-text'
                }`}
                title="Order the full prescribed quantity for every refill"
              >
                Full Demand
              </button>
            </div>

            <button
              type="button"
              onClick={fetchBuffer}
              className="flex items-center gap-1 text-muted hover:text-text cursor-pointer"
              title="Refresh demand scan"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              <span>Refresh Scan</span>
            </button>
          </div>
        </div>

        {/* Content Table / Checklist */}
        <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-2">
          {loading ? (
            <div className="py-16 text-center text-muted flex flex-col items-center justify-center gap-2">
              <RefreshCw size={24} className="animate-spin text-amber-500" />
              <span>Scanning upcoming 7-day refills & current inventory...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-muted flex flex-col items-center justify-center gap-2">
              <Package size={28} className="text-muted/40" />
              <p className="font-bold text-text">No Refill Shortages Found</p>
              <p className="text-xs max-w-md">
                Current in-hand stock is sufficient for all active patient refills due within the closure and lookahead window.
              </p>
            </div>
          ) : (
            <div className="border border-border/60 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-bg2 border-b border-border/40 text-muted uppercase font-bold text-[10px] tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">Select</th>
                    <th className="py-2.5 px-3">Medicine & Manufacturer</th>
                    <th className="py-2.5 px-3">Patient & Refill Date</th>
                    <th className="py-2.5 px-3 text-center">Stock / Needed</th>
                    <th className="py-2.5 px-3 text-center">Order Qty</th>
                    <th className="py-2.5 px-3 text-center">Live Cart</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20 font-mono">
                  {items.map(item => {
                    const isSelected = selectedIds.has(item.refill_id);
                    const isShortfall = item.shortfall_packs > 0;
                    const curQty = orderQtys[item.refill_id];
                    const displayVal = curQty === undefined
                      ? (isShortfall ? item.shortfall_packs : 1)
                      : (curQty === 0 ? '' : curQty);

                    return (
                      <tr
                        key={item.refill_id}
                        onClick={() => toggleSelect(item.refill_id)}
                        className={`transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500/5 hover:bg-amber-500/10'
                            : 'hover:bg-bg2/60'
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleSelect(item.refill_id)}
                            className="text-amber-500 cursor-pointer"
                          >
                            {isSelected ? <CheckSquare size={16} /> : <Square size={16} className="text-muted" />}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-text text-sm">{item.medicine_name}</span>
                            {item.medicine_id ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLinkingMedicine({ id: item.medicine_id, name: item.medicine_name });
                                }}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold transition-all cursor-pointer border ${
                                  (item.linked_distributors_count || 0) > 0
                                    ? 'bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20'
                                    : 'bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20'
                                }`}
                                title={
                                  (item.linked_distributors_count || 0) > 0
                                    ? `Linked: ${item.distributor_name || 'Mapped'} (Click to view or edit priority/links)`
                                    : 'Not linked to any Pharmarack distributor! Click to link so automatic orders succeed.'
                                }
                              >
                                <span>{(item.linked_distributors_count || 0) > 0 ? '⭐' : '🔗'}</span>
                                <span className="truncate max-w-[130px]">
                                  {(item.linked_distributors_count || 0) > 0
                                    ? (item.distributor_name || 'Linked')
                                    : 'Link distributor'}
                                </span>
                              </button>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-muted">{item.manufacturer || 'General'}</div>
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-semibold text-text">{item.patient_name}</div>
                          <div className="text-[11px] text-muted flex items-center gap-1 font-mono">
                            <Calendar size={11} /> {item.next_refill_date}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono">
                          <div className="font-bold">
                            <span className={item.current_stock < item.quantity_needed ? 'text-rose-500' : 'text-emerald-500'}>
                              {item.current_stock}
                            </span>
                            <span className="text-muted"> / {item.quantity_needed} Str</span>
                          </div>
                          {isShortfall ? (
                            <span className="text-[10px] text-rose-500 font-sans font-bold bg-rose-500/10 px-1.5 py-0.5 rounded-md">
                              Short by {item.shortfall_packs}
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-500 font-sans font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded-md">
                              In Stock
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleStepQty(item.refill_id, -1)}
                              className="w-6 h-6 rounded-md bg-bg2 hover:bg-bg3 border border-border/80 flex items-center justify-center text-muted hover:text-text cursor-pointer transition-colors"
                              title="Decrease quantity"
                            >
                              <Minus size={11} />
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={999}
                              value={displayVal}
                              onChange={e => handleInputChange(item.refill_id, e.target.value)}
                              onBlur={() => handleInputBlur(item.refill_id)}
                              className="w-12 bg-bg border border-border/80 rounded-md text-center font-bold font-mono py-1 text-xs focus:border-amber-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleStepQty(item.refill_id, 1)}
                              className="w-6 h-6 rounded-md bg-bg2 hover:bg-bg3 border border-border/80 flex items-center justify-center text-muted hover:text-text cursor-pointer transition-colors"
                              title="Increase quantity"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-sans text-xs text-center" onClick={e => e.stopPropagation()}>
                          <div className="flex flex-col items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const qtyToOrder = orderQtys[item.refill_id] && orderQtys[item.refill_id] > 0
                                  ? orderQtys[item.refill_id]
                                  : (item.shortfall_packs > 0 ? item.shortfall_packs : 1);
                                startRefillCartJob(
                                  item.patient_name || 'Patient Refill',
                                  [
                                    { refillId: item.refill_id, medicineId: item.medicine_id, medicineName: item.medicine_name, qty: qtyToOrder }
                                  ],
                                  { openModal: false }
                                );
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-[11px] font-bold transition-all cursor-pointer shadow-xs"
                              title={`Add ${orderQtys[item.refill_id] && orderQtys[item.refill_id] > 0 ? orderQtys[item.refill_id] : (item.shortfall_packs > 0 ? item.shortfall_packs : 1)} unit(s) to Pharmarack Live Cart with automatic distributor stock check`}
                            >
                              <ShoppingCart size={12} />
                              <span>+ Live Cart ({orderQtys[item.refill_id] && orderQtys[item.refill_id] > 0 ? orderQtys[item.refill_id] : (item.shortfall_packs > 0 ? item.shortfall_packs : 1)})</span>
                            </button>
                            {item.is_in_cart && item.cart_store_name && item.cart_store_name !== 'Manual / Phone Order' && (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 font-bold text-[10px] shadow-xs"
                                title={`Currently in live cart: ${item.cart_store_name}`}
                              >
                                <ShoppingCart size={10} />
                                <span className="truncate max-w-[120px]">In Cart: {item.cart_store_name}</span>
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer with Human-in-the-Loop Actions */}
        <div className="p-4 border-t border-border/40 bg-bg2 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
            <AlertCircle size={14} className="text-amber-500 shrink-0" />
            <span>Human-in-the-loop: All orders and notifications are reviewed by you before dispatch.</span>
            {unlinkedSelectedCount > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-500 border border-rose-500/30 text-[11px] font-bold">
                ⚠️ {unlinkedSelectedCount} unlinked (stages in Special Orders)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-muted hover:text-text hover:bg-bg3 border border-border transition-all cursor-pointer"
            >
              Close
            </button>

            <button
              type="button"
              onClick={handleStageWhatsAppNotices}
              disabled={isStagingNotices || selectedCount === 0}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-bg3 text-text hover:bg-bg3/80 border border-border transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              title="Stage personalized WhatsApp alerts for affected patients (Requires owner send in CRM)"
            >
              <MessageSquare size={14} className="text-sky-500" />
              <span>{isStagingNotices ? 'Staging...' : `Stage WhatsApp Notices (${selectedCount})`}</span>
            </button>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={selectedCount === 0}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-500 transition-all cursor-pointer shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <ShoppingCart size={14} />
              <span>Add Selected ({selectedCount}) to Cart</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Link medicine ↔ Pharmarack distributor modal ── */}
      {linkingMedicine && (
        <MedicineLinkModal
          medicineId={linkingMedicine.id}
          medicineName={linkingMedicine.name}
          onSaved={(newLinks) => {
            const links = newLinks || [];
            // Instant 0ms in-memory update across matching buffer items
            setItems(prev => prev.map(it => {
              if (it.medicine_id === linkingMedicine.id) {
                return {
                  ...it,
                  linked_distributors_count: links.length,
                  distributor_name: links.length > 0 ? links[0] : ''
                };
              }
              return it;
            }));
            refillEvent.triggerRefresh();
          }}
          onClose={() => setLinkingMedicine(null)}
        />
      )}
    </div>
  );
};
