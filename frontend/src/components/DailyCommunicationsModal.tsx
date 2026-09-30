import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  Send,
  CheckCircle2,
  RotateCw,
  Calendar,
  MessageSquare,
  Loader2,
  ChevronDown,
  ChevronRight,
  Pencil,
  AlertTriangle
} from 'lucide-react';
import { api, type DailyLogRow } from '../services/api';
import { toastEvent, whatsappQueueEvent, refillEvent } from '../services/events';

interface DailyCommunicationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** refreshes Quick Assist's counts after a send/snooze/cancel */
  onRefresh: () => void;
}

const HISTORY_DAYS = 7;
const SENT_STATUSES = ['sent', 'sent_manually', 'delivered'];
const isSent = (s: string) => SENT_STATUSES.includes(s);
const isWaiting = (s: string) => s === 'staged' || s === 'snoozed';
const isFailed = (s: string) => s.startsWith('failed') || s.startsWith('skipped') || s === 'error';
const phoneKey = (p: string) => (p || '').replace(/\D/g, '').slice(-10);

/** Identical text to the same number on the same day, shown as ONE row. */
interface MessageGroup {
  key: string;
  latest: DailyLogRow;
  sendTimes: number[];
}

interface DaySection {
  key: string;
  label: string;
  isToday: boolean;
  groups: MessageGroup[];
}

// Module-level cache: reopening paints the last log instantly, then refreshes silently.
let cachedLog: DailyLogRow[] | null = null;

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayLabel = (ms: number, todayStart: number) => {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (ms >= todayStart) return `Today (${date})`;
  if (ms >= todayStart - 86400000) return `Yesterday (${date})`;
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const groupRows = (rows: DailyLogRow[]): MessageGroup[] => {
  const map = new Map<string, MessageGroup>();
  for (const r of rows) {
    // Staged/snoozed rows carry per-row actions, so they never merge.
    const bucket = isWaiting(r.status) ? `${r.status}:${r.id}` : isSent(r.status) ? 'sent' : r.status;
    const key = `${new Date(r.activity_ms).toDateString()}|${bucket}|${phoneKey(r.recipient_phone)}|${(r.message || '').trim()}`;
    const g = map.get(key);
    if (g) g.sendTimes.push(r.activity_ms); // rows arrive newest-first
    else map.set(key, { key, latest: r, sendTimes: [r.activity_ms] });
  }
  return [...map.values()];
};

const rowTone = (s: string) =>
  isSent(s) ? 'bg-emerald-500/[0.04] border-emerald-500/20'
    : s === 'staged' ? 'bg-purple-500/[0.04] border-purple-500/25'
    : s === 'snoozed' ? 'bg-amber-500/[0.04] border-amber-500/25'
    : isFailed(s) ? 'bg-rose-500/[0.05] border-rose-500/25'
    : 'bg-bg2 border-border';

const chipTone = (s: string) =>
  isSent(s) ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : s === 'staged' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
    : s === 'snoozed' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    : isFailed(s) ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
    : s === 'queued' || s === 'sending' || s === 'pending' ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
    : 'bg-bg3 text-muted border-border';

const chipLabel = (s: string) => (isSent(s) ? 'Sent' : s.replace(/_/g, ' '));

export const DailyCommunicationsModal: React.FC<DailyCommunicationsModalProps> = ({
  isOpen,
  onClose,
  onRefresh,
}) => {
  const [log, setLog] = useState<DailyLogRow[]>(() => cachedLog || []);
  const [loading, setLoading] = useState(!cachedLog);
  const [filterTab, setFilterTab] = useState<'all' | 'sent' | 'staged' | 'snoozed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editMessage, setEditMessage] = useState('');

  const loadLog = useCallback(() => {
    api.getDailyNotificationSummary(HISTORY_DAYS)
      .then(res => {
        if (res?.success && res.log) {
          cachedLog = res.log;
          setLog(res.log);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load on open; afterwards only on real queue events (queued → sent flips live).
  // One queue start/stop arrives as several DOM events — coalesce them into one fetch.
  useEffect(() => {
    if (!isOpen) return;
    loadLog();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = whatsappQueueEvent.subscribeUpdated(() => {
      clearTimeout(timer);
      timer = setTimeout(loadLog, 400);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [isOpen, loadLog]);

  // Escape closes the editor first, then the modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editKey) setEditKey(null);
      else onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, editKey]);

  const { waitingGroups, daySections, counts } = useMemo(() => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const todayStart = midnight.getTime();
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = (r: DailyLogRow) => !q
      || (r.recipient_name || '').toLowerCase().includes(q)
      || (r.recipient_phone || '').includes(q)
      || (r.message || '').toLowerCase().includes(q);
    const matchesTab = (r: DailyLogRow) =>
      filterTab === 'all'
      || (filterTab === 'sent' && isSent(r.status))
      || r.status === filterTab;

    const waiting = log.filter(r => isWaiting(r.status));
    const history = log.filter(r => !isWaiting(r.status));

    const byDay = new Map<string, DailyLogRow[]>();
    for (const r of history.filter(r => matchesTab(r) && matchesSearch(r))) {
      const key = new Date(r.activity_ms).toDateString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(r);
    }
    const sections: DaySection[] = [...byDay.entries()].map(([key, rows]) => ({
      key,
      label: dayLabel(rows[0].activity_ms, todayStart),
      isToday: rows[0].activity_ms >= todayStart,
      groups: groupRows(rows),
    }));

    return {
      waitingGroups: groupRows(waiting.filter(r => matchesTab(r) && matchesSearch(r))),
      daySections: sections,
      counts: {
        all: groupRows(log).length,
        sentToday: groupRows(history.filter(r => isSent(r.status) && r.activity_ms >= todayStart)).length,
        sent: groupRows(history.filter(r => isSent(r.status))).length,
        staged: waiting.filter(r => r.status === 'staged').length,
        snoozed: waiting.filter(r => r.status === 'snoozed').length,
      },
    };
  }, [log, filterTab, searchQuery]);

  if (!isOpen) return null;

  // Sends reload the log via the app-wa-queue-updated subscription; snooze/cancel reload directly.
  const afterAction = () => {
    refillEvent.triggerRefresh();
    onRefresh();
  };

  const toggleRow = (key: string) => setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const toggleDay = (key: string) => setOpenDays(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const startEdit = (g: MessageGroup) => {
    setEditKey(g.key);
    setEditPhone(g.latest.recipient_phone || '');
    setEditMessage(g.latest.message || '');
    setExpandedRows(prev => new Set(prev).add(g.key));
  };

  // One click: send a staged message, or re-send (optionally edited) an old one.
  const handleSend = async (row: DailyLogRow, edits?: { message: string; phone: string }) => {
    setBusyId(row.id);
    try {
      const res = await api.sendNotification(row.id, edits);
      whatsappQueueEvent.triggerUpdated();
      const who = row.recipient_name || row.recipient_phone;
      toastEvent.trigger(
        isWaiting(row.status) ? `WhatsApp queued for ${who}` : `${res.edited ? 'Edited message' : 'Message'} re-queued for ${who}`,
        'success'
      );
      setEditKey(null);
      afterAction();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toastEvent.trigger(e?.response?.data?.error || e?.message || 'Failed to send message', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleSnooze = async (row: DailyLogRow) => {
    setBusyId(row.id);
    try {
      await api.snoozeNotification(row.id, 1);
      toastEvent.trigger(`Message for ${row.recipient_name || row.recipient_phone} snoozed to tomorrow`, 'info');
      loadLog();
      afterAction();
    } catch (err: unknown) {
      toastEvent.trigger((err as Error)?.message || 'Failed to snooze message', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (row: DailyLogRow) => {
    setBusyId(row.id);
    try {
      await api.cancelNotification(row.id);
      toastEvent.trigger(`Staged message dismissed for ${row.recipient_name || row.recipient_phone}`, 'info');
      loadLog();
      afterAction();
    } catch (err: unknown) {
      toastEvent.trigger((err as Error)?.message || 'Failed to dismiss message', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const renderRow = (g: MessageGroup) => {
    const r = g.latest;
    const isOpenRow = expandedRows.has(g.key);
    const isEditing = editKey === g.key;
    const isBusy = busyId === r.id;
    const waiting = isWaiting(r.status);
    const canSend = r.status !== 'sending';

    return (
      <div key={g.key} className={`rounded-xl border overflow-hidden transition-colors ${rowTone(r.status)}`}>
        {/* Compact single-line row — click to read the full message */}
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          <button
            type="button"
            onClick={() => toggleRow(g.key)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
            title={isOpenRow ? 'Hide message' : 'Show full message'}
          >
            {isOpenRow ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
            <span className="font-bold text-text truncate max-w-[160px] shrink-0">{r.recipient_name || 'Customer'}</span>
            <span className="font-mono text-[10px] text-muted shrink-0">{r.recipient_phone}</span>
            {!isOpenRow && (
              <span className="text-muted truncate min-w-0 flex-1">{(r.message || '').split('\n').find(l => l.trim()) || ''}</span>
            )}
          </button>

          {g.sendTimes.length > 1 && (
            <span
              className="px-1.5 py-0.5 rounded-md text-[10px] font-bold font-mono bg-bg3 text-muted border border-border shrink-0"
              title={`Same message sent ${g.sendTimes.length} times — shown once`}
            >
              ×{g.sendTimes.length}
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border shrink-0 ${chipTone(r.status)}`}>
            {chipLabel(r.status)}
          </span>
          <span className="text-[10px] text-muted font-mono shrink-0 w-11 text-right">{formatTime(r.activity_ms)}</span>

          {canSend && (
            <>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => (isEditing ? setEditKey(null) : startEdit(g))}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-50 shrink-0 ${
                  isEditing ? 'bg-sky-600 text-white border-sky-600' : 'bg-bg3 text-muted hover:text-text border-border'
                }`}
                title="Edit message or number before sending"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleSend(r)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-60 shrink-0 ${
                  waiting
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-bg3 hover:bg-purple-600 hover:text-white text-muted border border-border'
                }`}
                title={waiting ? 'Send this WhatsApp message now' : 'Re-send the same message now'}
              >
                {isBusy ? <Loader2 size={12} className="animate-spin" /> : waiting ? <Send size={12} /> : <RotateCw size={12} />}
                <span>{waiting ? 'Send' : 'Re-send'}</span>
              </button>
            </>
          )}
        </div>

        {isOpenRow && !isEditing && (
          <div className="px-3 pb-3 pt-2 border-t border-border/60 bg-bg3/30 space-y-2">
            <p className="text-xs text-text whitespace-pre-wrap break-words leading-relaxed">{r.message}</p>
            {g.sendTimes.length > 1 && (
              <p className="text-[10px] text-muted font-mono">
                Sent at: {g.sendTimes.map(formatTime).join(' · ')}
              </p>
            )}
            {r.error_message && (
              <p className="text-[10px] text-rose-300 flex items-start gap-1">
                <AlertTriangle size={11} className="shrink-0 mt-px" />
                <span className="break-words">{r.error_message}</span>
              </p>
            )}
            {waiting && (
              <div className="flex items-center justify-end gap-1.5">
                {r.status === 'staged' && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleSnooze(r)}
                    className="px-2.5 py-1 rounded-lg bg-bg3 hover:bg-amber-600 hover:text-white text-muted border border-border text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1"
                    title="Snooze reminder by 1 day"
                  >
                    <Calendar size={11} />
                    <span>Snooze (+1d)</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleDismiss(r)}
                  className="px-2.5 py-1 rounded-lg bg-bg3 hover:bg-red-600 hover:text-white text-muted border border-border text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1"
                  title="Dismiss message without sending"
                >
                  <X size={11} />
                  <span>Cancel</span>
                </button>
              </div>
            )}
          </div>
        )}

        {isEditing && (
          <div className="px-3 pb-3 pt-2 border-t border-border/60 bg-bg3/30 space-y-2">
            <input
              type="tel"
              value={editPhone}
              onChange={e => setEditPhone(e.target.value)}
              placeholder="WhatsApp number"
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-bg2 border border-border rounded-lg text-text focus:outline-hidden focus:border-sky-500"
            />
            <textarea
              value={editMessage}
              onChange={e => setEditMessage(e.target.value)}
              rows={Math.min(12, Math.max(4, editMessage.split('\n').length + 1))}
              className="w-full px-2.5 py-2 text-xs bg-bg2 border border-border rounded-lg text-text leading-relaxed focus:outline-hidden focus:border-sky-500 resize-y"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setEditKey(null)}
                className="px-3 py-1.5 rounded-lg bg-bg3 hover:bg-bg border border-border text-xs font-bold text-muted hover:text-text transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBusy || !editMessage.trim() || phoneKey(editPhone).length < 10}
                onClick={() => handleSend(r, { message: editMessage, phone: editPhone })}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                <span>Send edited</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const tabs: Array<{ id: typeof filterTab; label: string; active: string }> = [
    { id: 'all', label: `All (${counts.all})`, active: 'bg-purple-600 text-white' },
    { id: 'sent', label: `Sent (${counts.sent})`, active: 'bg-emerald-600 text-white' },
    { id: 'staged', label: `Staged (${counts.staged})`, active: 'bg-purple-600 text-white' },
    { id: 'snoozed', label: `Snoozed (${counts.snoozed})`, active: 'bg-amber-600 text-white' },
  ];
  const nothingToShow = waitingGroups.length === 0 && daySections.length === 0;

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
        className="bg-bg border border-border w-[95vw] max-w-4xl h-[85vh] min-h-[560px] max-h-[840px] rounded-2xl shadow-2xl flex flex-col overflow-hidden relative"
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
                  {counts.sentToday} Sent Today
                </span>
                {counts.staged > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 font-bold border border-purple-500/25">
                    {counts.staged} Staged
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted">
                Click a row to read the full message. Re-send or edit in one click. Repeats of the same message show once, with a ×count.
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
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setFilterTab(t.id)}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  filterTab === t.id ? `${t.active} shadow-xs` : 'text-muted hover:text-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <div className="relative w-full">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="Search patient, phone or text..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-bg2 border border-border rounded-xl text-text placeholder:text-muted/60 focus:outline-hidden focus:border-purple-500 transition-colors"
              />
            </div>
            <button
              onClick={loadLog}
              className="p-2 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-muted hover:text-text transition-colors cursor-pointer shrink-0"
              title="Refresh log"
            >
              <RotateCw size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {loading && log.length === 0 ? (
            <div className="py-16 flex items-center justify-center text-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : nothingToShow ? (
            <div className="py-16 text-center text-muted flex flex-col items-center justify-center">
              <MessageSquare size={36} className="text-muted/40 mb-2" />
              <p className="text-sm font-semibold">No communications found</p>
              <p className="text-xs text-muted/70 mt-0.5">
                Staged reminders and WhatsApp messages from the last {HISTORY_DAYS} days show up here.
              </p>
            </div>
          ) : (
            <>
              {waitingGroups.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-purple-300 px-1">
                    Waiting to send ({waitingGroups.length})
                  </h4>
                  {waitingGroups.map(renderRow)}
                </div>
              )}

              {daySections.map(day => {
                // Today is open by default; older days start collapsed. A search opens every match.
                const isDayOpen = searchQuery.trim() !== '' || (day.isToday ? !openDays.has(day.key) : openDays.has(day.key));
                const sentCount = day.groups.filter(g => isSent(g.latest.status)).length;
                const failedCount = day.groups.filter(g => isFailed(g.latest.status)).length;
                return (
                  <div key={day.key} className="rounded-2xl border border-border bg-bg2/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleDay(day.key)}
                      className="w-full px-3 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-bg2/80 transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isDayOpen ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
                        <Calendar size={13} className="text-sky shrink-0" />
                        <span className="font-bold text-text truncate">{day.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-bg3 text-muted border border-border">
                          {day.groups.length} msg{day.groups.length === 1 ? '' : 's'}
                        </span>
                        {sentCount > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                            <CheckCircle2 size={10} /> {sentCount} Sent
                          </span>
                        )}
                        {failedCount > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/25 flex items-center gap-1">
                            <AlertTriangle size={10} /> {failedCount} Failed
                          </span>
                        )}
                      </div>
                    </button>
                    {isDayOpen && (
                      <div className="px-2 pb-2 space-y-1.5">
                        {day.groups.map(renderRow)}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-bg2 flex items-center justify-between text-xs text-muted shrink-0">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-emerald-400" />
            <span>Nothing is sent without your click. Showing the last {HISTORY_DAYS} days.</span>
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
