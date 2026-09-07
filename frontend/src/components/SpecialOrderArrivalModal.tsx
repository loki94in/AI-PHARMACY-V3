import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Check, Clock, Send, MessageSquare, Phone, Package, Edit3, 
  Copy, CheckCheck, Sparkles, CheckCircle2, RotateCcw, ChevronDown, 
  ChevronUp, CheckSquare, Zap, BadgeCheck, AlertTriangle
} from 'lucide-react';
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

const QUICK_DELAY_PRESETS = [
  'Tomorrow 11 AM',
  'In 2–3 Hours',
  'Today Evening (6 PM)',
  'Arranging from distributor'
];

export const SpecialOrderArrivalModal: React.FC<SpecialOrderArrivalModalProps> = ({
  isOpen,
  onClose,
  customerName,
  customerPhone,
  orders,
  onSuccess
}) => {
  useModalEscape(isOpen, onClose);

  const [itemStatuses, setItemStatuses] = useState<Record<number, 'arrived' | 'delayed'>>({});
  const [delayNotes, setDelayNotes] = useState<Record<number, string>>({});
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const [isEditingMessage, setIsEditingMessage] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recentNotif, setRecentNotif] = useState<{ recentlyNotified: boolean; minutesAgo?: number } | null>(null);

  // Check if an arrival message was queued for this customer in the last 60 minutes
  useEffect(() => {
    let active = true;
    if (isOpen && customerPhone) {
      api.checkArrivalRecentlyNotified(customerPhone)
        .then(res => {
          if (active) {
            if (res && res.recentlyNotified) {
              setRecentNotif({ recentlyNotified: true, minutesAgo: res.minutesAgo });
            } else {
              setRecentNotif(null);
            }
          }
        })
        .catch(() => {
          if (active) setRecentNotif(null);
        });
    } else {
      setRecentNotif(null);
    }
    return () => {
      active = false;
    };
  }, [isOpen, customerPhone]);

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
      setCopied(false);
    }
  }, [isOpen, orders]);

  // Customer avatar initials
  const customerInitials = useMemo(() => {
    const parts = (customerName || 'Customer').trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return (parts[0]?.[0] || 'C').toUpperCase();
  }, [customerName]);

  // Current formatted time for WhatsApp bubble timestamp
  const currentTimeStr = useMemo(() => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

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
        msg += `\n\n📍 कृपया अपनी सुविधानुसार हमारी दुकान पर आकर प्राप्त करें। धन्यवाद!`;
      } else if (arrived.length > 0 && delayed.length > 0) {
        msg += `आपके ऑर्डर का अपडेट:\n\n`;
        msg += `✅ तैयार दवाइयां (दुकान से प्राप्त करें):\n` + arrived.map(o => `• ${o.product} × ${o.qty || 1}`).join('\n');
        msg += `\n\n⏳ आने में समय (आते ही सूचित करेंगे):\n` + delayed.map(o => `• ${o.product} × ${o.qty || 1}${delayNotes[o.id] ? ` (${delayNotes[o.id]})` : ''}`).join('\n');
        msg += `\n\n📍 तैयार दवाइयां आप कभी भी ले सकते हैं।`;
      } else {
        msg += `आपके ऑर्डर का अपडेट:\n\n`;
        msg += `⏳ निम्नलिखित दवाइयों में थोड़ा समय लग रहा है:\n` + delayed.map(o => `• ${o.product} × ${o.qty || 1}${delayNotes[o.id] ? ` (${delayNotes[o.id]})` : ''}`).join('\n');
        msg += `\n\nजैसे ही दवाइयां आएंगी, हम तुरंत सूचित करेंगे। धैर्य के लिए धन्यवाद!`;
      }
      return msg;
    }

    // English
    let msg = `Hi ${cleanName}, 👋\n\n`;
    if (arrived.length > 0 && delayed.length === 0) {
      msg += `Great news! 🎉 Your requested medicine is now ready for pickup:\n\n`;
      msg += `📦 Ready for Pickup:\n` + arrived.map(o => `• ${o.product} × ${o.qty || 1}`).join('\n');
      msg += `\n\n📍 Please visit our store at your convenience to collect your order. Thank you!`;
    } else if (arrived.length > 0 && delayed.length > 0) {
      msg += `Order status update:\n\n`;
      msg += `✅ Ready for Pickup:\n` + arrived.map(o => `• ${o.product} × ${o.qty || 1}`).join('\n');
      msg += `\n\n⏳ Slightly Delayed / In Transit:\n` + delayed.map(o => `• ${o.product} × ${o.qty || 1}${delayNotes[o.id] ? ` (${delayNotes[o.id]})` : ''}`).join('\n');
      msg += `\n\n📍 You can collect the ready items anytime. We will alert you once the rest arrive!`;
    } else {
      msg += `Order status update:\n\n`;
      msg += `⏳ The following medicines are slightly delayed:\n` + delayed.map(o => `• ${o.product} × ${o.qty || 1}${delayNotes[o.id] ? ` (${delayNotes[o.id]})` : ''}`).join('\n');
      msg += `\n\nWe are actively arranging them and will notify you as soon as they arrive. Thank you for your patience!`;
    }
    return msg;
  }, [orders, itemStatuses, delayNotes, customerName, lang]);

  const activeMessage = isEditingMessage ? customMessage : generatedMessage;

  const handleToggleStatus = (id: number, status: 'arrived' | 'delayed') => {
    setItemStatuses(prev => ({ ...prev, [id]: status }));
  };

  const handleMarkAll = (status: 'arrived' | 'delayed') => {
    const updated: Record<number, 'arrived' | 'delayed'> = {};
    orders.forEach(o => {
      updated[o.id] = status;
    });
    setItemStatuses(updated);
  };

  const handleNoteChange = (id: number, note: string) => {
    setDelayNotes(prev => ({ ...prev, [id]: note }));
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(activeMessage);
      setCopied(true);
      toastEvent.trigger('WhatsApp message copied to clipboard!', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastEvent.trigger('Failed to copy to clipboard', 'error');
    }
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

      const isForce = Boolean(recentNotif?.recentlyNotified);
      const res = await api.batchNotifySpecialOrderArrival({
        order_ids: orders.map(o => o.id),
        items: itemsPayload,
        custom_message: isEditingMessage ? customMessage : undefined,
        lang,
        force_resend: isForce
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
      if (err?.response?.status === 409 || err?.response?.data?.code === 'RECENTLY_NOTIFIED') {
        const mins = err?.response?.data?.minutes_ago || 1;
        setRecentNotif({ recentlyNotified: true, minutesAgo: mins });
        toastEvent.trigger(`Notice was already sent ${mins} min ago. Click "Resend Anyway" if you wish to resend.`, 'info');
        return;
      }
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to send notification', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const arrivedCount = orders.filter(o => itemStatuses[o.id] !== 'delayed').length;
  const delayedCount = orders.length - arrivedCount;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-bg2 border border-glass-border rounded-3xl shadow-2xl shadow-emerald-500/10 w-full max-w-2xl flex flex-col max-h-[92vh] overflow-hidden text-text transition-all">
        
        {/* Top Accent Gradient Bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 shrink-0" />

        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-glass-border flex items-center justify-between bg-bg3/30 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Customer Avatar Initials Badge */}
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-extrabold text-sm shadow-inner shrink-0">
              {customerInitials}
            </div>
            
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-black text-text tracking-tight truncate">
                  Special Order Arrival Preview
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono font-bold flex items-center gap-1">
                  <Package size={10} />
                  {orders.length} {orders.length === 1 ? 'Item' : 'Items'}
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-muted mt-0.5 flex-wrap">
                <span className="font-semibold text-text truncate">{customerName || 'Customer'}</span>
                {customerPhone && (
                  <span className="flex items-center gap-1 text-emerald-400 font-mono font-bold bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                    <Phone size={10} /> {customerPhone}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-text hover:bg-bg3 border border-transparent transition-all cursor-pointer shrink-0 ml-2"
            title="Close preview"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 custom-scrollbar">
          
          {/* 60-Minute Recent Notification Warning Banner */}
          {recentNotif?.recentlyNotified && (
            <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs animate-in fade-in">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <div className="font-extrabold text-amber-200 flex items-center gap-1.5 flex-wrap">
                  <span>Notice already queued {recentNotif.minutesAgo || 1} min(s) ago</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                    Anti-Spam Guard Active
                  </span>
                </div>
                <p className="text-text text-[11px] leading-relaxed">
                  A WhatsApp arrival message was recently queued for this customer. If you need to send another update right now, click <strong className="text-amber-300">"Resend Anyway"</strong> below.
                </p>
              </div>
            </div>
          )}

          {/* Summary & Bulk Quick Actions */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-2xl bg-bg3/60 border border-border">
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-extrabold flex items-center gap-1.5">
                <CheckCircle2 size={12} /> {arrivedCount} Arrived
              </span>
              {delayedCount > 0 && (
                <span className="px-2.5 py-1 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 font-extrabold flex items-center gap-1.5">
                  <Clock size={12} /> {delayedCount} Delayed
                </span>
              )}
            </div>

            {/* Quick Bulk Select Buttons */}
            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => handleMarkAll('arrived')}
                disabled={arrivedCount === orders.length}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-bg2 hover:bg-emerald-500/15 text-muted hover:text-emerald-400 border border-border hover:border-emerald-500/30 transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"
                title="Mark all items as Arrived"
              >
                <Check size={11} />
                <span>All Arrived</span>
              </button>
              <button
                type="button"
                onClick={() => handleMarkAll('delayed')}
                disabled={delayedCount === orders.length}
                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-bg2 hover:bg-amber-500/15 text-muted hover:text-amber-400 border border-border hover:border-amber-500/30 transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"
                title="Mark all items as Delayed"
              >
                <Clock size={11} />
                <span>All Delayed</span>
              </button>
            </div>
          </div>

          {/* Medicines Checklist */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-extrabold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <Package size={12} className="text-emerald-400" />
                <span>Items Arrival Checklist</span>
              </label>
              <span className="text-[10px] text-muted font-mono">
                Click status pill to toggle
              </span>
            </div>

            <div className="space-y-2">
              {orders.map((ord) => {
                const isArrived = itemStatuses[ord.id] !== 'delayed';
                const hasAdvance = Number(ord.advance_payment || 0) > 0;

                return (
                  <div
                    key={ord.id}
                    className={`p-3.5 rounded-2xl border transition-all duration-200 ${
                      isArrived
                        ? 'bg-emerald-500/[0.04] border-emerald-500/30 hover:border-emerald-500/50 shadow-xs'
                        : 'bg-amber-500/[0.04] border-amber-500/30 hover:border-amber-500/50 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-text tracking-tight truncate">
                            {ord.product}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-bg3 text-muted border border-border font-mono font-bold">
                            Qty: {ord.qty || 1}
                          </span>
                          {hasAdvance && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 font-mono font-bold">
                              ₹{ord.advance_payment} Adv Paid
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status Segmented Pill */}
                      <div className="flex items-center p-0.5 rounded-xl bg-bg3 border border-border shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(ord.id, 'arrived')}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            isArrived
                              ? 'bg-emerald-600 text-white shadow-sm font-black'
                              : 'text-muted hover:text-text hover:bg-bg2'
                          }`}
                        >
                          <Check size={12} />
                          <span>Arrived</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(ord.id, 'delayed')}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            !isArrived
                              ? 'bg-amber-600 text-white shadow-sm font-black'
                              : 'text-muted hover:text-text hover:bg-bg2'
                          }`}
                        >
                          <Clock size={12} />
                          <span>Delayed</span>
                        </button>
                      </div>
                    </div>

                    {/* Expandable Delay Preset Drawer */}
                    {!isArrived && (
                      <div className="mt-3 pt-2.5 border-t border-amber-500/20 space-y-2 animate-in fade-in duration-150">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] text-amber-400 font-extrabold uppercase tracking-wide mr-1">
                            Quick ETA:
                          </span>
                          {QUICK_DELAY_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => handleNoteChange(ord.id, preset)}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border transition-all cursor-pointer ${
                                delayNotes[ord.id] === preset
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                                  : 'bg-bg2 text-muted border-border hover:text-amber-400 hover:border-amber-500/30'
                              }`}
                            >
                              + {preset}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={delayNotes[ord.id] || ''}
                            onChange={e => handleNoteChange(ord.id, e.target.value)}
                            placeholder="Type custom reason or delivery time..."
                            className="flex-1 text-xs px-3 py-1.5 rounded-xl bg-bg border border-border text-text placeholder:text-muted/50 focus:outline-hidden focus:border-amber-500/60 transition-all font-mono"
                          />
                          {delayNotes[ord.id] && (
                            <button
                              type="button"
                              onClick={() => handleNoteChange(ord.id, '')}
                              className="text-[10px] text-muted hover:text-text px-1.5 py-1"
                              title="Clear note"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Authentic WhatsApp Message Preview Card */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-[11px] font-extrabold text-muted uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare size={13} className="text-emerald-400" />
                <span>WhatsApp Notification Preview</span>
              </label>

              <div className="flex items-center gap-2">
                {/* Language Toggle */}
                <div className="flex items-center rounded-xl bg-bg3 p-0.5 border border-border text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => { setLang('en'); setIsEditingMessage(false); }}
                    className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${lang === 'en' ? 'bg-emerald-600 text-white shadow-xs' : 'text-muted hover:text-text'}`}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLang('hi'); setIsEditingMessage(false); }}
                    className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${lang === 'hi' ? 'bg-emerald-600 text-white shadow-xs' : 'text-muted hover:text-text'}`}
                  >
                    हिन्दी
                  </button>
                </div>

                {/* Edit Message Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (!isEditingMessage) setCustomMessage(generatedMessage);
                    setIsEditingMessage(!isEditingMessage);
                  }}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-bg3 hover:bg-bg2 text-sky-400 hover:text-sky-300 border border-border transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Edit3 size={11} />
                  <span>{isEditingMessage ? 'Auto Template' : 'Edit Text'}</span>
                </button>

                {/* Copy Button */}
                <button
                  type="button"
                  onClick={handleCopyMessage}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-bg3 hover:bg-bg2 text-muted hover:text-text border border-border transition-all flex items-center gap-1 cursor-pointer"
                  title="Copy message to clipboard"
                >
                  {copied ? (
                    <>
                      <Check size={11} className="text-emerald-400" />
                      <span className="text-emerald-400 font-extrabold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* WhatsApp Chat Bubble Container */}
            <div className="rounded-2xl border border-glass-border bg-bg3/40 overflow-hidden shadow-inner">
              
              {/* WhatsApp Mock Top Header */}
              <div className="px-3.5 py-2 bg-emerald-600/10 border-b border-emerald-500/20 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-bold text-text text-[11px] flex items-center gap-1">
                    WhatsApp Message to: <strong className="text-emerald-400">{customerName || 'Customer'}</strong>
                  </span>
                </div>
                <span className="text-[10px] text-muted font-mono">
                  {customerPhone || 'Direct Dispatch'}
                </span>
              </div>

              {/* Chat Bubble Body */}
              <div className="p-3.5 sm:p-4">
                {isEditingMessage ? (
                  <div className="space-y-1.5">
                    <textarea
                      value={customMessage}
                      onChange={e => setCustomMessage(e.target.value)}
                      rows={7}
                      className="w-full text-xs p-3 rounded-xl bg-bg border border-sky-400/40 text-text focus:outline-hidden focus:ring-1 focus:ring-sky-400/50 font-mono leading-relaxed custom-scrollbar"
                      placeholder="Type custom WhatsApp notification message..."
                    />
                    <div className="flex items-center justify-between text-[10px] text-muted">
                      <span>Custom message mode active</span>
                      <span>{customMessage.length} characters</span>
                    </div>
                  </div>
                ) : (
                  <div className="relative p-4 rounded-2xl rounded-tl-xs bg-bg border border-border text-xs text-text/90 font-mono whitespace-pre-line leading-relaxed shadow-xs max-w-xl">
                    {/* Speech tail subtle notch */}
                    <div className="absolute -top-1.5 left-3 w-3 h-3 bg-bg border-t border-l border-border rotate-45" />

                    {activeMessage}

                    {/* Message delivery metadata */}
                    <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted font-mono select-none">
                      <span>{currentTimeStr}</span>
                      <CheckCheck size={14} className="text-sky-400 inline" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-glass-border flex flex-col sm:flex-row items-center justify-between bg-bg3/30 shrink-0 gap-3">
          <div className="text-[11px] text-muted font-medium text-center sm:text-left">
            <span>Sends <strong>1 consolidated WhatsApp message</strong> to {customerPhone || 'customer'}.</span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-bg2 text-muted border border-border hover:bg-bg3 hover:text-text text-xs font-bold transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSubmitting || orders.length === 0}
              className={
                recentNotif?.recentlyNotified
                  ? 'flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-white text-xs font-black shadow-lg transition-all hover:scale-[1.01] active:scale-95 cursor-pointer disabled:opacity-50 bg-amber-600 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 shadow-amber-500/25'
                  : 'flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-white text-xs font-black shadow-lg transition-all hover:scale-[1.01] active:scale-95 cursor-pointer disabled:opacity-50 bg-emerald-600 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-500/25'
              }
            >
              {isSubmitting ? (
                <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              ) : (
                <Send size={13} />
              )}
              <span>
                {isSubmitting
                  ? (recentNotif?.recentlyNotified ? 'Resending WhatsApp...' : 'Queueing WhatsApp...')
                  : (recentNotif?.recentlyNotified
                      ? `Resend Anyway (${orders.length} ${orders.length === 1 ? 'Item' : 'Items'})`
                      : `Confirm & Send (${orders.length} ${orders.length === 1 ? 'Item' : 'Items'})`)}
              </span>
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
};
