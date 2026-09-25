import React, { useState, useEffect, useMemo } from 'react';
import { X, CheckSquare, Square, ShoppingCart, MessageSquare, AlertCircle, Calendar, Package, RefreshCw, Send } from 'lucide-react';
import { api } from '../services/api';
import { toastEvent } from '../services/events';

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
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [isStagingNotices, setIsStagingNotices] = useState(false);

  const fetchBuffer = () => {
    setLoading(true);
    api.getMarketClosureBuffer()
      .then((res: any) => {
        if (res?.success) {
          setConfig(res.config);
          const rawItems: BufferItem[] = res.items || [];
          setItems(rawItems);
          
          // Pre-select items with shortfall by default
          const autoSelected = new Set<number>();
          const initialQtys: Record<number, number> = {};
          rawItems.forEach(it => {
            initialQtys[it.refill_id] = it.recommended_order_qty || (it.shortfall_packs > 0 ? it.shortfall_packs : 1);
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

  const handleQtyChange = (refillId: number, val: number) => {
    setOrderQtys(prev => ({
      ...prev,
      [refillId]: Math.max(1, val)
    }));
  };

  const selectedCount = selectedIds.size;
  const totalPacksToOrder = useMemo(() => {
    let sum = 0;
    selectedIds.forEach(id => {
      sum += orderQtys[id] || 1;
    });
    return sum;
  }, [selectedIds, orderQtys]);

  const handleAddToCart = async () => {
    if (selectedCount === 0) {
      toastEvent.trigger('Please select at least one medicine to add to cart', 'info');
      return;
    }
    setIsAddingToCart(true);
    try {
      const payload = items
        .filter(it => selectedIds.has(it.refill_id))
        .map(it => ({
          medicine_id: it.medicine_id,
          medicine_name: it.medicine_name,
          qty: orderQtys[it.refill_id] || it.recommended_order_qty || 1,
          distributor_name: it.distributor_name,
        }));

      const res = await api.addClosureBufferToCart(payload);
      toastEvent.trigger(
        `Added ${res.addedCount || payload.length} buffer medicine(s) into Reorder Queue / Pharmarack Cart.`,
        'info'
      );
      onCartUpdated?.();
      onClose();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to add buffer to cart', 'error');
    } finally {
      setIsAddingToCart(false);
    }
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-bg border border-border w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
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
          <div className="flex items-center gap-2">
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

        {/* Content Table / Checklist */}
        <div className="p-4 overflow-y-auto flex-1 space-y-2">
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
                    <th className="py-2.5 px-3">Distributor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20 font-mono">
                  {items.map(item => {
                    const isSelected = selectedIds.has(item.refill_id);
                    const isShortfall = item.shortfall_packs > 0;
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
                          <div className="font-bold text-text text-sm">{item.medicine_name}</div>
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
                            <span className="text-[10px] text-rose-500 font-sans font-bold bg-rose-500/10 px-1.5 py-0.2 rounded-md">
                              Short by {item.shortfall_packs}
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-500 font-sans font-bold bg-emerald-500/10 px-1.5 py-0.2 rounded-md">
                              In Stock
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono" onClick={e => e.stopPropagation()}>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={orderQtys[item.refill_id] || 1}
                            onChange={e => handleQtyChange(item.refill_id, Number(e.target.value))}
                            className="w-16 bg-bg border border-border/80 rounded-lg text-center font-bold font-mono py-1 text-sm focus:border-amber-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-sans text-xs text-muted truncate max-w-[160px]">
                          {item.distributor_name || 'Standard Distributor'}
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
          <div className="flex items-center gap-2 text-xs text-muted">
            <AlertCircle size={14} className="text-amber-500 shrink-0" />
            <span>Human-in-the-loop: All orders and notifications are reviewed by you before dispatch.</span>
          </div>

          <div className="flex items-center gap-2">
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
              disabled={isAddingToCart || selectedCount === 0}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-500 transition-all cursor-pointer shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <ShoppingCart size={14} />
              <span>{isAddingToCart ? 'Adding...' : `Add Selected (${selectedCount}) to Cart`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
