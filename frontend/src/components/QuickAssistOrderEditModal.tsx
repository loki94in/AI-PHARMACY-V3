import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Check,
  Package,
  Globe,
  BellRing,
  Plus,
  Minus,
  Trash2,
  Phone,
  ExternalLink,
  MessageCircle,
  Loader2,
  Clock,
  Edit3
} from 'lucide-react';
import { useModalEscape } from '../services/keyboardShortcuts';
import { api, apiClient } from '../services/api';
import { toastEvent, specialOrdersEvent, refillEvent } from '../services/events';

export interface EditOrderItem {
  id: number;
  product: string;
  qty: number;
  status?: string;
  priority?: string;
  notes?: string;
  interval_days?: number;
  hold_for_stock?: number;
  next_refill_date?: string;
}

export interface QuickAssistEditGroup {
  type: 'special_request' | 'website_order' | 'refill';
  title: string;
  customerName: string;
  customerPhone: string;
  items: EditOrderItem[];
}

interface QuickAssistOrderEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  editGroup: QuickAssistEditGroup | null;
  onOpenArrivalModal?: (group: { requester: string; phone?: string; items: Array<{ id: number; product: string; qty: number }> }) => void;
  onSuccess: () => void;
}

const QUICK_DELAY_PRESETS = [
  'Tomorrow 11 AM',
  'In 2–3 Hours',
  'Today Evening (6 PM)',
  'Arranging from distributor'
];

export const QuickAssistOrderEditModal: React.FC<QuickAssistOrderEditModalProps> = ({
  isOpen,
  onClose,
  editGroup,
  onOpenArrivalModal,
  onSuccess
}) => {
  useModalEscape(isOpen, onClose);
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [items, setItems] = useState<EditOrderItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editGroup) {
      setPhone(editGroup.customerPhone || '');
      setItems(editGroup.items.map(i => ({ ...i })));
    }
  }, [editGroup]);

  const handleQtyChange = (idx: number, delta: number) => {
    setItems(prev => {
      const copy = [...prev];
      const newQty = Math.max(1, (copy[idx]?.qty || 1) + delta);
      copy[idx] = { ...copy[idx], qty: newQty };
      return copy;
    });
  };

  const handleProductChange = (idx: number, name: string) => {
    setItems(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], product: name };
      return copy;
    });
  };

  const handleStatusChange = (idx: number, newStatus: string) => {
    setItems(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], status: newStatus };
      return copy;
    });
  };

  const handleNoteChange = (idx: number, note: string) => {
    setItems(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], notes: note };
      return copy;
    });
  };

  const handleIntervalChange = (idx: number, days: number) => {
    setItems(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], interval_days: days };
      return copy;
    });
  };

  const handleToggleHold = (idx: number) => {
    setItems(prev => {
      const copy = [...prev];
      const cur = copy[idx]?.hold_for_stock || 0;
      copy[idx] = { ...copy[idx], hold_for_stock: cur === 1 ? 0 : 1 };
      return copy;
    });
  };

  const handleRemoveItem = async (idx: number) => {
    const item = items[idx];
    if (!item) return;

    if (items.length <= 1) {
      toastEvent.trigger('An order must have at least one item. To cancel the whole order, use Cancel.', 'info');
      return;
    }

    if (editGroup?.type === 'special_request' || editGroup?.type === 'website_order') {
      try {
        await api.deleteOrder(item.id);
        toastEvent.trigger(`Removed "${item.product}" from order`, 'success');
      } catch {
        toastEvent.trigger('Failed to remove item', 'error');
        return;
      }
    }

    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!editGroup) return;
    setSaving(true);

    try {
      if (editGroup.type === 'special_request' || editGroup.type === 'website_order') {
        const cleanPhone = phone.trim();
        await Promise.all(
          items.map(item =>
            api.updateOrder(item.id, {
              product: item.product,
              qty: item.qty,
              status: item.status,
              notes: item.notes || '',
              phone: cleanPhone
            })
          )
        );

        toastEvent.trigger(`Successfully updated ${items.length} item(s) for "${editGroup.customerName}"!`, 'success');
        specialOrdersEvent.triggerUpdated();
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));
      } else if (editGroup.type === 'refill') {
        const cleanPhone = phone.trim();

        // Update frequencies and patient medicines
        await Promise.all(
          items.map(async item => {
            if (item.interval_days) {
              await apiClient.put(`/refills/${item.id}/frequency`, {
                refill_interval_days: item.interval_days
              }).catch(() => {});
            }
          })
        );

        // Update patient profile/phone if changed
        if (cleanPhone && cleanPhone !== editGroup.customerPhone) {
          await apiClient.post('/refills/update-patient-profile', {
            original_phone: editGroup.customerPhone,
            patient_name: editGroup.customerName,
            patient_phone: cleanPhone
          }).catch(() => {});
        }

        toastEvent.trigger(`Refill schedule updated for "${editGroup.customerName}"!`, 'success');
        refillEvent.triggerRefresh();
        window.dispatchEvent(new CustomEvent('refresh-refills'));
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to save order edits:', err);
      toastEvent.trigger(err?.response?.data?.error || 'Failed to save changes', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenFullPage = () => {
    if (!editGroup) return;
    onClose();
    if (editGroup.type === 'special_request') {
      navigate(`/crm?tab=special_orders&search=${encodeURIComponent(editGroup.customerPhone || editGroup.customerName)}`);
    } else if (editGroup.type === 'website_order') {
      navigate('/website-orders');
    } else {
      navigate(`/crm?tab=refills&search=${encodeURIComponent(editGroup.customerPhone || editGroup.customerName)}`);
    }
  };

  const handleOpenArrivalWhatsApp = () => {
    if (!editGroup || !onOpenArrivalModal) return;
    onClose();
    onOpenArrivalModal({
      requester: editGroup.customerName,
      phone: phone.trim() || editGroup.customerPhone,
      items: items.map(i => ({ id: i.id, product: i.product, qty: i.qty }))
    });
  };

  if (!isOpen || !editGroup) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="glass-panel w-full max-w-lg bg-bg2 rounded-2xl border border-border p-5 shadow-2xl space-y-4 max-h-[90vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {editGroup.type === 'special_request' ? (
              <Package size={18} className="text-amber-500 shrink-0" />
            ) : editGroup.type === 'website_order' ? (
              <Globe size={18} className="text-cyan-400 shrink-0" />
            ) : (
              <BellRing size={18} className="text-purple-400 shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-text truncate">
                {editGroup.title}
              </h3>
              <p className="text-[11px] text-muted truncate">
                Customer: <strong className="text-text font-medium">{editGroup.customerName}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="p-1 rounded-lg hover:bg-bg3 text-muted hover:text-text cursor-pointer transition-colors shrink-0"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Customer Phone Bar */}
        <div className="p-2.5 rounded-xl bg-bg border border-border flex items-center gap-2 shrink-0">
          <Phone size={14} className="text-muted shrink-0" />
          <div className="flex-1 flex items-center gap-2">
            <span className="text-xs text-muted font-medium shrink-0">Mobile / WhatsApp:</span>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="10-digit phone number"
              className="flex-1 px-2 py-1 bg-bg2 border border-border rounded-lg text-xs font-mono text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Scrollable Items List */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted px-1">
            <span>Requested Medicines ({items.length})</span>
            <span>Quantity & Status</span>
          </div>

          {items.map((item, idx) => (
            <div
              key={item.id || idx}
              className="p-3 rounded-xl bg-bg border border-border space-y-2 transition-all hover:border-border/80 shadow-xs"
            >
              {/* Product Name & Qty Controls */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.product}
                  onChange={e => handleProductChange(idx, e.target.value)}
                  placeholder="Medicine name..."
                  className="flex-1 px-2.5 py-1.5 bg-bg2 border border-border rounded-lg text-xs font-medium text-text focus:outline-none focus:border-primary"
                />

                {/* Qty +/- Counter */}
                <div className="flex items-center rounded-lg border border-border bg-bg2 overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => handleQtyChange(idx, -1)}
                    className="p-1.5 hover:bg-bg3 text-muted hover:text-text cursor-pointer transition-colors"
                    title="Decrease quantity"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="px-2 text-xs font-mono font-bold text-text min-w-[28px] text-center">
                    {item.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleQtyChange(idx, 1)}
                    className="p-1.5 hover:bg-bg3 text-muted hover:text-text cursor-pointer transition-colors"
                    title="Increase quantity"
                  >
                    <Plus size={12} />
                  </button>
                </div>

                {/* Remove item */}
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(idx)}
                    className="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors shrink-0"
                    title="Remove medicine"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Status / Notes Controls for Special Requests & Website Orders */}
              {(editGroup.type === 'special_request' || editGroup.type === 'website_order') && (
                <div className="space-y-1.5 pt-1 border-t border-border/50">
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span className="text-[10px] font-bold text-muted uppercase">Status:</span>
                    <div className="flex items-center gap-1">
                      {(['Pending', 'Ordered', 'Ready', 'Delayed'] as const).map(st => {
                        const isSelected = item.status === st;
                        return (
                          <button
                            key={st}
                            type="button"
                            onClick={() => handleStatusChange(idx, st)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                              isSelected
                                ? st === 'Ready'
                                  ? 'bg-sky-600 text-white shadow-xs'
                                  : st === 'Ordered'
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : st === 'Delayed'
                                  ? 'bg-amber-600 text-white shadow-xs'
                                  : 'bg-primary text-white shadow-xs'
                                : 'bg-bg2 text-muted hover:text-text border border-border'
                            }`}
                          >
                            {st}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Delay notes or remarks */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-[10px] text-muted">
                      <Clock size={10} />
                      <span>Delay Note / ETA:</span>
                    </div>
                    <input
                      type="text"
                      value={item.notes || ''}
                      onChange={e => handleNoteChange(idx, e.target.value)}
                      placeholder="e.g. Tomorrow 11 AM, arriving in 2 hours..."
                      className="w-full px-2 py-1 bg-bg2 border border-border rounded-lg text-[11px] text-text focus:outline-none focus:border-primary"
                    />
                    <div className="flex items-center gap-1 flex-wrap pt-0.5">
                      {QUICK_DELAY_PRESETS.map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handleNoteChange(idx, preset)}
                          className="px-1.5 py-0.2 rounded bg-bg2 hover:bg-bg3 border border-border text-[9px] text-muted hover:text-text transition-colors cursor-pointer"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Refill Controls */}
              {editGroup.type === 'refill' && (
                <div className="space-y-2 pt-1 border-t border-border/50">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[10px] font-bold text-muted uppercase">Interval Cycle:</span>
                    <div className="flex items-center gap-1">
                      {[15, 30, 60, 90].map(days => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => handleIntervalChange(idx, days)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                            (item.interval_days || 30) === days
                              ? 'bg-purple-600 text-white shadow-xs'
                              : 'bg-bg2 text-muted hover:text-text border border-border'
                          }`}
                        >
                          {days}d
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-muted uppercase">Stock Status:</span>
                    <button
                      type="button"
                      onClick={() => handleToggleHold(idx)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        item.hold_for_stock === 1
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}
                    >
                      {item.hold_for_stock === 1 ? '⏸️ Stock on Hold' : '▶️ Active Refill'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-border shrink-0 flex-wrap">
          <div className="flex items-center gap-1.5">
            {/* Direct arrival WhatsApp trigger for special & website requests */}
            {(editGroup.type === 'special_request' || editGroup.type === 'website_order') && onOpenArrivalModal && (
              <button
                type="button"
                onClick={handleOpenArrivalWhatsApp}
                className="py-1.5 px-2.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                title="Open Arrival Preview to mark some arrived, some delayed & send 1 WhatsApp message"
              >
                <MessageCircle size={13} />
                <span>Arrival & Delay WhatsApp</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenFullPage}
              className="py-1.5 px-2.5 rounded-xl bg-bg3 hover:bg-bg border border-border text-muted hover:text-text text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
              title="Open in dedicated page"
            >
              <span>Full Details</span>
              <ExternalLink size={12} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              className="py-1.5 px-3 rounded-xl bg-bg3 border border-border text-muted hover:text-text text-xs font-semibold cursor-pointer transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="py-1.5 px-4 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check size={13} />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
