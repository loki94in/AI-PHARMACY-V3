import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  Calendar,
  MessageSquare,
  ShieldAlert,
  Loader2
} from 'lucide-react';
import { api } from '../services/api';
import { toastEvent, whatsappQueueEvent, refillEvent } from '../services/events';

export interface DailyLogItem {
  id: number;
  type: string;
  recipient_name: string;
  recipient_phone: string;
  message: string;
  status: string;
  created_at: string;
  resolved_at?: string;
  reference_id?: string;
}

interface DailyCommunicationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  dailyLog: DailyLogItem[];
  sentTodayCount: number;
  stagedCount: number;
  onRefresh: () => void;
}

export const DailyCommunicationsModal: React.FC<DailyCommunicationsModalProps> = ({
  isOpen,
  onClose,
  dailyLog,
  sentTodayCount,
  stagedCount,
  onRefresh,
}) => {
  const [filterTab, setFilterTab] = useState<'all' | 'sent' | 'staged' | 'snoozed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [confirmResendItem, setConfirmResendItem] = useState<DailyLogItem | null>(null);

  // Auto-refresh log whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      onRefresh();
    }
  }, [isOpen, onRefresh]);

  // Auto-close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmResendItem) {
          setConfirmResendItem(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, confirmResendItem]);

  const filteredItems = useMemo(() => {
    return (dailyLog || []).filter(item => {
      // Tab filter
      if (filterTab === 'sent' && !['sent', 'sent_manually', 'delivered'].includes(item.status)) return false;
      if (filterTab === 'staged' && item.status !== 'staged') return false;
      if (filterTab === 'snoozed' && item.status !== 'snoozed') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (item.recipient_name || '').toLowerCase().includes(q);
        const matchPhone = (item.recipient_phone || '').includes(q);
        const matchMsg = (item.message || '').toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchMsg) return false;
      }
      return true;
    });
  }, [dailyLog, filterTab, searchQuery]);

  if (!isOpen) return null;

  const handleSendStaged = async (item: DailyLogItem) => {
    setActioningId(item.id);
    try {
      if (item.recipient_phone) {
        await api.enqueueSingleWhatsApp({
          number: item.recipient_phone,
          message: item.message,
          type: item.type || 'refill_collection',
          targetName: item.recipient_name,
          skipDedupe: true
        });
        whatsappQueueEvent.triggerUpdated();
      }
      await api.manualNotification(item.id);
      toastEvent.trigger(`WhatsApp message queued for ${item.recipient_name}!`, 'success');
      refillEvent.triggerRefresh();
      onRefresh();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to dispatch message', 'error');
    } finally {
      setActioningId(null);
    }
  };

  const handleSnooze = async (item: DailyLogItem) => {
    setActioningId(item.id);
    try {
      await api.snoozeNotification(item.id, 1);
      toastEvent.trigger(`Message for ${item.recipient_name} snoozed to tomorrow`, 'info');
      refillEvent.triggerRefresh();
      onRefresh();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to snooze message', 'error');
    } finally {
      setActioningId(null);
    }
  };

  const handleDismiss = async (item: DailyLogItem) => {
    setActioningId(item.id);
    try {
      await api.cancelNotification(item.id);
      toastEvent.trigger(`Staged message dismissed for ${item.recipient_name}`, 'info');
      refillEvent.triggerRefresh();
      onRefresh();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to dismiss message', 'error');
    } finally {
      setActioningId(null);
    }
  };

  const handleExecuteResend = async (item: DailyLogItem) => {
    setResendingId(item.id);
    try {
      if (item.recipient_phone) {
        await api.enqueueSingleWhatsApp({
          number: item.recipient_phone,
          message: item.message,
          type: item.type || 'refill_reminder',
          targetName: item.recipient_name,
          skipDedupe: true
        });
        whatsappQueueEvent.triggerUpdated();
      }
      // Update notification status & timestamp for audit trail
      await api.manualNotification(item.id).catch(() => {});
      toastEvent.trigger(`Re-sent WhatsApp message to ${item.recipient_name}!`, 'success');
      setConfirmResendItem(null);
      refillEvent.triggerRefresh();
      onRefresh();
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to re-send message', 'error');
    } finally {
      setResendingId(null);
    }
  };

  const formatTime = (isoStr?: string) => {
    if (!isoStr) return '--:--';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return isoStr;
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      data-modal="daily-communications"
      onClick={onClose}
      className="fixed inset-0 z-global-modal flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-bg border border-border w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden relative"
      >
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-border bg-bg2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/15 text-purple-400 border border-purple-500/20">
              <MessageSquare size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text flex items-center gap-2">
                Daily Communications & Staged Log
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/25">
                  {sentTodayCount} Sent Today
                </span>
                {stagedCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 font-bold border border-purple-500/25">
                    {stagedCount} Staged
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted">
                Review all outgoing WhatsApp patient communications, staged refills, and dispatch history for today.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="p-4 border-b border-border bg-bg3/40 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-bg2 border border-border text-xs">
            <button
              onClick={() => setFilterTab('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterTab === 'all'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-muted hover:text-text'
              }`}
            >
              All ({dailyLog.length})
            </button>
            <button
              onClick={() => setFilterTab('sent')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterTab === 'sent'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-muted hover:text-text'
              }`}
            >
              Sent Today ({sentTodayCount})
            </button>
            <button
              onClick={() => setFilterTab('staged')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterTab === 'staged'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-muted hover:text-text'
              }`}
            >
              Staged ({stagedCount})
            </button>
            <button
              onClick={() => setFilterTab('snoozed')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterTab === 'snoozed'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-muted hover:text-text'
              }`}
            >
              Snoozed
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <div className="relative w-full">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search patient or phone..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-bg2 border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-hidden focus:border-purple-500 transition-colors"
              />
            </div>
            <button
              onClick={onRefresh}
              className="p-2 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-muted hover:text-text transition-colors cursor-pointer shrink-0"
              title="Refresh log"
            >
              <RotateCw size={14} />
            </button>
          </div>
        </div>

        {/* Body list */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
          {filteredItems.length === 0 ? (
            <div className="py-16 text-center text-muted flex flex-col items-center justify-center">
              <MessageSquare size={36} className="text-muted/40 mb-2" />
              <p className="text-sm font-semibold">No communications found for today</p>
              <p className="text-xs text-muted/70 mt-0.5">
                Staged refill reminders or dispatched WhatsApp messages will show up here.
              </p>
            </div>
          ) : (
            filteredItems.map(item => {
              const isSent = ['sent', 'sent_manually', 'delivered'].includes(item.status);
              const isStaged = item.status === 'staged';
              const isSnoozed = item.status === 'snoozed';
              const isActioning = actioningId === item.id;
              const isResending = resendingId === item.id;

              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isSent
                      ? 'bg-emerald-500/[0.04] border-emerald-500/20'
                      : isStaged
                      ? 'bg-purple-500/[0.04] border-purple-500/25'
                      : isSnoozed
                      ? 'bg-amber-500/[0.04] border-amber-500/25'
                      : 'bg-bg2 border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-text">
                          {item.recipient_name || 'Customer'}
                        </span>
                        <span className="text-xs font-mono text-muted">
                          {item.recipient_phone}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                            isSent
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : isStaged
                              ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                              : isSnoozed
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-bg3 text-muted border-border'
                          }`}
                        >
                          {isSent ? 'Sent Today' : item.status}
                        </span>
                        <span className="text-[10px] text-muted flex items-center gap-1 font-mono">
                          <Clock size={11} />
                          {formatTime(item.resolved_at || item.created_at)}
                        </span>
                      </div>

                      {/* Message preview snippet */}
                      <p className="mt-2 text-xs text-text/90 bg-bg/80 border border-border/80 p-2.5 rounded-lg break-words leading-relaxed">
                        {item.message}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                      {isStaged && (
                        <>
                          <button
                            disabled={isActioning}
                            onClick={() => handleSnooze(item)}
                            className="px-2.5 py-1.5 rounded-lg bg-bg3 hover:bg-amber-600 hover:text-white text-muted border border-border text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                            title="Snooze reminder by 1 day"
                          >
                            <Calendar size={12} />
                            <span>Snooze (+1d)</span>
                          </button>
                          <button
                            disabled={isActioning}
                            onClick={() => handleDismiss(item)}
                            className="px-2.5 py-1.5 rounded-lg bg-bg3 hover:bg-red-600 hover:text-white text-muted border border-border text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                            title="Dismiss message without sending"
                          >
                            <X size={12} />
                            <span>Cancel</span>
                          </button>
                          <button
                            disabled={isActioning}
                            onClick={() => handleSendStaged(item)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                            title="Send WhatsApp message now"
                          >
                            {isActioning ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Send size={13} />
                            )}
                            <span>Send</span>
                          </button>
                        </>
                      )}

                      {isSent && (
                        <button
                          disabled={isResending}
                          onClick={() => setConfirmResendItem(item)}
                          className="px-2.5 py-1.5 rounded-lg bg-bg3 hover:bg-purple-600 hover:text-white text-muted border border-border text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                          title="Re-send WhatsApp reminder to this patient"
                        >
                          <RotateCw size={12} className={isResending ? 'animate-spin' : ''} />
                          <span>Re-Send</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Confirmation Modal for Re-Sending */}
        {confirmResendItem && (
          <div
            onClick={() => setConfirmResendItem(null)}
            className="absolute inset-0 z-submodal bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-bg border border-border p-5 rounded-2xl max-w-md w-full shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-3 text-amber-400">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/25">
                  <ShieldAlert size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text">Re-send WhatsApp Message?</h3>
                  <p className="text-xs text-muted">
                    This customer already received a message today at {formatTime(confirmResendItem.resolved_at || confirmResendItem.created_at)}.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-bg2 border border-border text-xs text-text/90 font-mono break-words">
                Recipient: <span className="font-bold">{confirmResendItem.recipient_name} ({confirmResendItem.recipient_phone})</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  disabled={resendingId === confirmResendItem.id}
                  onClick={() => setConfirmResendItem(null)}
                  className="px-3 py-1.5 rounded-xl bg-bg3 hover:bg-bg border border-border text-xs font-bold text-muted hover:text-text transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  disabled={resendingId === confirmResendItem.id}
                  onClick={() => handleExecuteResend(confirmResendItem)}
                  className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
                >
                  {resendingId === confirmResendItem.id ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Send size={13} />
                  )}
                  <span>{resendingId === confirmResendItem.id ? 'Sending...' : 'Confirm & Re-Send'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-bg2 flex items-center justify-between text-xs text-muted shrink-0">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-emerald-400" />
            <span>100% Human-Approved: Zero background auto-sending without pharmacist review</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-bg3 hover:bg-bg text-text border border-border font-bold text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
