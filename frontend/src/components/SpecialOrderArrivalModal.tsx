import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Clock, Send, MessageSquare, Phone, Package, Edit3 } from 'lucide-react';
import { api } from '../services/api';
import { toastEvent, messageSendEvent, whatsappQueueEvent, specialOrdersEvent } from '../services/events';
import { useModalEscape } from '../services/keyboardShortcuts';

export interface ArrivalModalOrderItem {
  id: number;
  product: string;
  qty: number | string;
  status?: string;
  advance_payment?: number | string;
}

interface SpecialOrderArrivalModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  customerPhone: string;
  orders: ArrivalModalOrderItem[];
  onSuccess: () => void;
}

export const SpecialOrderArrivalModal: React.FC<SpecialOrderArrivalModalProps> = ({
  isOpen,
  onClose,
  customerName,
  customerPhone,
  orders,
  onSuccess
}) => {
  useModalEscape(onClose);

  const [itemStatuses, setItemStatuses] = useState<Record<number, 'arrived' | 'delayed'>>({});
  const [delayNotes, setDelayNotes] = useState<Record<number, string>>({});
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const [isEditingMessage, setIsEditingMessage] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize all items to 'arrived' by default whenever orders change
  useEffect(() => {
    if (isOpen && orders.length > 0) {
      const initialStatuses: Record<number, 'arrived' | 'delayed'> = {};
      const initialNotes: Record<number, string> = {};
      orders.forEach(o => {
        initialStatuses[o.id] = 'arrived';
        initialNotes[o.id] = '';
      });
      setItemStatuses(initialStatuses);
      setDelayNotes(initialNotes);
      setIsEditingMessage(false);
      setCustomMessage('');
    }
  }, [isOpen, orders]);

  // Compute default preview message based on current statuses and notes
  const generatedMessage = useMemo(() => {
    const arrived = orders.filter(o => itemStatuses[o.id] !== 'delayed');
    const delayed = orders.filter(o => itemStatuses[o.id] === 'delayed');
    const cleanName = customerName || 'Customer';

    if (lang === 'hi') {
      let msg = `नमस्ते ${cleanName}, 👋\n\n`;
      if (arrived.length > 0 && delayed.length === 0) {
        msg += `खुशखबरी! 🎉 आपकी मांगी गई दवाई दुकान पर लेने के लिए तैयार है:\n\n`;
        msg += `📦 तैयार दवाइयां:\n` + arrived.map(o => `• ${o.product} × ${o.qty || 1}`).join('\n');
        msg += `\n\n📍 कृपया अपनी सुविधानुसार हमारी दुकान पर आकर प्राप्त करें।`;
      } else if (arrived.length > 0 && delayed.length > 0) {
        msg += `आपके ऑर्डर का अपडेट:\n\n`;
        msg += `✅ तैयार दवाइयां (दुकान से प्राप्त करें):\n` + arrived.map(o => `• ${o.product} × ${o.qty || 1}`).join('\n');
        msg += `\n\n⏳ आने में समय (आते ही सूचित करेंगे):\n` + delayed.map(o => `• ${o.product} × ${o.qty || 1}${delayNotes[o.id] ? ` (${delayNotes[o.id]})` : ''}`).join('\n');
        msg += `\n\n📍 तैयार दवाइयां आप कभी भी ले सकते हैं।`;
      } else {
        msg += `आपके ऑर्डर का अपडेट:\n\n`;
        msg += `⏳ निम्नलिखित दवाइयों में थोड़ा समय लग रहा है:\n` + delayed.map(o => `• ${o.product} × ${o.qty || 1}${delayNotes[o.id] ? ` (${delayNotes[o.id]})` : ''}`).join('\n');
        msg += `\n\nजैसे ही दवाइयां आएंगी, हम तुरंत सूचित करेंगे।`;
      }
      return msg;
    }

    // English
    let msg = `Hi ${cleanName}, 👋\n\n`;
    if (arrived.length > 0 && delayed.length === 0) {
      msg += `Great news! 🎉 Your requested medicine is now ready for pickup:\n\n`;
      msg += `📦 Ready for Pickup:\n` + arrived.map(o => `• ${o.product} × ${o.qty || 1}`).join('\n');
      msg += `\n\n📍 Please visit our store at your convenience to collect your order.`;
    } else if (arrived.length > 0 && delayed.length > 0) {
      msg += `Order status update:\n\n`;
      msg += `✅ Ready for Pickup:\n` + arrived.map(o => `• ${o.product} × ${o.qty || 1}`).join('\n');
      msg += `\n\n⏳ Slightly Delayed / In Transit:\n` + delayed.map(o => `• ${o.product} × ${o.qty || 1}${delayNotes[o.id] ? ` (${delayNotes[o.id]})` : ''}`).join('\n');
      msg += `\n\n📍 You can collect the ready items anytime. We will alert you once the rest arrive!`;
    } else {
      msg += `Order status update:\n\n`;
      msg += `⏳ The following medicines are slightly delayed:\n` + delayed.map(o => `• ${o.product} × ${o.qty || 1}${delayNotes[o.id] ? ` (${delayNotes[o.id]})` : ''}`).join('\n');
      msg += `\n\nWe are actively arranging them and will notify you as soon as they arrive.`;
    }
    return msg;
  }, [orders, itemStatuses, delayNotes, customerName, lang]);

  const activeMessage = isEditingMessage ? customMessage : generatedMessage;

  const handleToggleStatus = (id: number, status: 'arrived' | 'delayed') => {
    setItemStatuses(prev => ({ ...prev, [id]: status }));
  };

  const handleNoteChange = (id: number, note: string) => {
    setDelayNotes(prev => ({ ...prev, [id]: note }));
  };

  const handleSend = async () => {
    if (orders.length === 0) return;
    setIsSubmitting(true);

    try {
      const itemsPayload = orders.map(o => ({
        order_id: o.id,
        status: itemStatuses[o.id] || 'arrived',
        delay_reason: delayNotes[o.id] || undefined
      }));

      messageSendEvent.triggerSendProgress(customerName || customerPhone || 'Customer', 'Sending arrival notification...', 15);

      const res = await api.batchNotifySpecialOrderArrival({
        order_ids: orders.map(o => o.id),
        items: itemsPayload,
        custom_message: isEditingMessage ? customMessage : undefined,
        lang
      });

      if (res && res.success) {
        toastEvent.trigger(`Consolidated WhatsApp message queued for "${customerName}"!`, 'success');
        whatsappQueueEvent.triggerUpdated();
        specialOrdersEvent.triggerUpdated();
        window.dispatchEvent(new CustomEvent('refresh-special-orders'));
        onSuccess();
        onClose();
      } else {
        toastEvent.trigger(res?.message || 'Failed to queue message', 'error');
      }
    } catch (err: any) {
      console.error('Batch notify failed:', err);
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to send notification', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const arrivedCount = orders.filter(o => itemStatuses[o.id] !== 'delayed').length;
  const delayedCount = orders.length - arrivedCount;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-bg2 border border-glass-border rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] overflow-hidden text-text">
        {/* Header */}
        <div className="p-4 border-b border-glass-border flex items-center justify-between bg-bg3/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Package size={16} />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-text flex items-center gap-2">
                Special Order Arrival Preview
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 font-mono">
                  {orders.length} {orders.length === 1 ? 'Medicine' : 'Medicines'}
                </span>
              </h3>
              <p className="text-xs text-muted flex items-center gap-2">
                <span>{customerName || 'Customer'}</span>
                {customerPhone && (
                  <span className="flex items-center gap-1 text-sky font-mono font-bold">
                    <Phone size={10} /> {customerPhone}
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 border border-transparent transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {/* Status summary info */}
          <div className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-bg3/50 border border-border">
            <span className="text-muted">
              Sends <strong>1 combined WhatsApp</strong> with current status for all items.
            </span>
            <div className="flex items-center gap-2 font-mono font-bold">
              <span className="text-emerald-400">{arrivedCount} Arrived</span>
              {delayedCount > 0 && <span className="text-amber-400">{delayedCount} Delayed</span>}
            </div>
          </div>

          {/* Medicines Checklist */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-muted uppercase tracking-wider block">
              Item Arrival Status
            </label>
            {orders.map((ord) => {
              const isArrived = itemStatuses[ord.id] !== 'delayed';
              return (
                <div
                  key={ord.id}
                  className={`p-3 rounded-xl border transition-all ${
                    isArrived
                      ? 'bg-emerald-500/[0.06] border-emerald-500/30'
                      : 'bg-amber-500/[0.06] border-amber-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-black text-text block truncate">
                        {ord.product}
                      </span>
                      <span className="text-[11px] text-muted font-mono">
                        Qty: {ord.qty || 1}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(ord.id, 'arrived')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                          isArrived
                            ? 'bg-emerald-500 text-bg shadow-sm font-black'
                            : 'bg-bg2 text-muted border border-border hover:text-text'
                        }`}
                      >
                        <Check size={12} />
                        <span>Arrived</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(ord.id, 'delayed')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                          !isArrived
                            ? 'bg-amber-500 text-bg shadow-sm font-black'
                            : 'bg-bg2 text-muted border border-border hover:text-text'
                        }`}
                      >
                        <Clock size={12} />
                        <span>Delayed</span>
                      </button>
                    </div>
                  </div>

                  {!isArrived && (
                    <div className="mt-2 pt-2 border-t border-amber-500/20 flex items-center gap-2">
                      <span className="text-[10px] text-amber-400 font-bold shrink-0">Reason / ETA:</span>
                      <input
                        type="text"
                        value={delayNotes[ord.id] || ''}
                        onChange={e => handleNoteChange(ord.id, e.target.value)}
                        placeholder="e.g. Expected tomorrow 11 AM"
                        className="flex-1 text-xs px-2.5 py-1 rounded-lg bg-bg border border-border text-text placeholder:text-muted/50 focus:outline-hidden focus:border-amber-500/60"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* WhatsApp Message Preview Card */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare size={13} className="text-emerald-400" />
                <span>Single WhatsApp Message Preview</span>
              </label>
              <div className="flex items-center gap-2">
                {/* Language Toggle */}
                <div className="flex items-center rounded-lg bg-bg3 p-0.5 border border-border text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => { setLang('en'); setIsEditingMessage(false); }}
                    className={`px-2 py-0.5 rounded cursor-pointer ${lang === 'en' ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLang('hi'); setIsEditingMessage(false); }}
                    className={`px-2 py-0.5 rounded cursor-pointer ${lang === 'hi' ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
                  >
                    हिन्दी
                  </button>
                </div>
                {/* Edit Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    if (!isEditingMessage) setCustomMessage(generatedMessage);
                    setIsEditingMessage(!isEditingMessage);
                  }}
                  className="text-[10px] font-bold text-sky hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Edit3 size={11} />
                  <span>{isEditingMessage ? 'Use Auto Template' : 'Edit Text'}</span>
                </button>
              </div>
            </div>

            {isEditingMessage ? (
              <textarea
                value={customMessage}
                onChange={e => setCustomMessage(e.target.value)}
                rows={6}
                className="w-full text-xs p-3 rounded-xl bg-bg border border-sky/40 text-text focus:outline-hidden font-mono leading-relaxed"
              />
            ) : (
              <div className="p-3.5 rounded-xl bg-bg border border-glass-border font-mono text-xs whitespace-pre-line text-text/90 leading-relaxed shadow-inner">
                {activeMessage}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-glass-border flex items-center justify-between bg-bg3/30 shrink-0 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-bg2 text-muted border border-border hover:bg-bg3 hover:text-text text-xs font-bold transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={isSubmitting || orders.length === 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            ) : (
              <Send size={13} />
            )}
            <span>
              {isSubmitting ? 'Queueing WhatsApp...' : `Confirm & Send 1 Message (${orders.length} Items)`}
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
