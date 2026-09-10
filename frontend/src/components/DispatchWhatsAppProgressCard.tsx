import React, { memo, useState, useEffect, useRef } from 'react';
import {
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  FastForward,
  ChevronDown,
  ChevronUp,
  MessageSquare,
} from 'lucide-react';
import {
  api,
  peekWhatsAppQueueStatusCache,
  type WhatsAppQueueStatus,
} from '../services/api';
import {
  whatsappQueueEvent,
  messageSendEvent,
  toastEvent,
} from '../services/events';

interface ActiveSendingState {
  recipient: string;
  progress: number;
  secondsLeft: number;
  completed: boolean;
  type?: string;
}

export const DispatchWhatsAppProgressCard: React.FC = memo(() => {
  const [queueState, setQueueState] = useState<WhatsAppQueueStatus | null>(() =>
    peekWhatsAppQueueStatusCache(2500)
  );
  const [isForcingNext, setIsForcingNext] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Live in-flight animation state for currently sending WhatsApp message
  const [activeSending, setActiveSending] = useState<ActiveSendingState | null>(null);
  const activeSendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAnimatedTargetRef = useRef<string | null>(null);

  const startSendAnimation = (recipient: string, type?: string, durationSec = 10) => {
    if (activeSendTimerRef.current) clearInterval(activeSendTimerRef.current);
    const totalSteps = durationSec * 10;
    let currentStep = 0;

    setActiveSending({
      recipient,
      progress: 0,
      secondsLeft: durationSec,
      completed: false,
      type,
    });

    activeSendTimerRef.current = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      currentStep++;
      const percent = Math.min(100, Math.round((currentStep / totalSteps) * 100));
      const secsLeft = Math.max(0, Math.ceil(durationSec - currentStep / 10));

      if (currentStep >= totalSteps) {
        if (activeSendTimerRef.current) clearInterval(activeSendTimerRef.current);
        setActiveSending(prev => (prev ? { ...prev, progress: 100, secondsLeft: 0, completed: true } : null));
        setTimeout(() => {
          setActiveSending(null);
        }, 2200);
      } else {
        setActiveSending(prev => (prev ? { ...prev, progress: percent, secondsLeft: secsLeft } : null));
      }
    }, 100);
  };

  const fetchStatus = async (forceBypassCache = false) => {
    try {
      const cached = forceBypassCache ? null : peekWhatsAppQueueStatusCache(2500);
      const data = cached ?? (await api.getWhatsAppQueueStatus());
      setQueueState(data);

      const sendingCount = data?.counts?.sending || 0;
      if (data?.activeTargetName && sendingCount > 0) {
        const targetKey = `${data.currentSendingItemId || data.activeTargetName}`;
        if (lastAnimatedTargetRef.current !== targetKey) {
          lastAnimatedTargetRef.current = targetKey;
          startSendAnimation(data.activeTargetName, 'Queue Dispatch', 10);
        }
      } else if (sendingCount === 0 && !activeSending) {
        lastAnimatedTargetRef.current = null;
      }
    } catch {
      // Background silent failure
    }
  };

  const handleForceNext = async () => {
    setIsForcingNext(true);
    try {
      const res = await api.flushNextWhatsAppQueueItem();
      if (res?.success) {
        toastEvent.trigger('Pacing skipped — dispatching next message immediately', 'info');
        if (res.state) {
          setQueueState(res.state);
        } else {
          fetchStatus(true);
        }
      }
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to skip delay', 'error');
    } finally {
      setIsForcingNext(false);
    }
  };

  useEffect(() => {
    fetchStatus(false);
    const unsub = whatsappQueueEvent.subscribeUpdated(() => {
      fetchStatus(true);
    });
    const unsubSend = messageSendEvent.subscribeSendProgress((detail) => {
      startSendAnimation(detail.recipient, detail.messagePreview, detail.durationSec || 10);
    });
    const handleSse = () => {
      fetchStatus(true);
    };
    window.addEventListener('sse-wa-queue-updated', handleSse);
    return () => {
      if (activeSendTimerRef.current) clearInterval(activeSendTimerRef.current);
      unsub();
      unsubSend();
      window.removeEventListener('sse-wa-queue-updated', handleSse);
    };
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];
  const items = queueState?.recentItems || [];
  const todayRawItems = items.filter(i => {
    if (!i.created_at) return false;
    const d = new Date(typeof i.created_at === 'number' ? i.created_at : Number(i.created_at));
    return !isNaN(d.getTime()) && d.toISOString().split('T')[0] === todayStr;
  });

  const counts = queueState?.counts || { pending: 0, sending: 0, sent: 0, failed_offline: 0, failed_perm: 0 };
  const todaySentCount = todayRawItems.length > 0
    ? todayRawItems.filter(i => i.status === 'sent').length
    : counts.sent;
  const todayRemainingCount = todayRawItems.length > 0
    ? todayRawItems.filter(i => i.status === 'pending' || i.status === 'sending' || i.status === 'waiting').length
    : counts.pending;
  const todaySendingCount = todayRawItems.length > 0
    ? todayRawItems.filter(i => i.status === 'sending').length
    : counts.sending;
  const todayFailedCount = todayRawItems.length > 0
    ? todayRawItems.filter(i => i.status === 'failed_offline' || i.status === 'failed_perm').length
    : (counts.failed_offline + counts.failed_perm);
  const todayAllCount = todayRawItems.length > 0
    ? todayRawItems.length
    : (todaySentCount + todayRemainingCount + todayFailedCount);
  const todayProgressPercent = todayAllCount > 0
    ? Math.min(100, Math.round((todaySentCount / todayAllCount) * 100))
    : 0;
  const countdownSeconds = queueState?.nextDispatchCountdownMs
    ? Math.ceil(queueState.nextDispatchCountdownMs / 1000)
    : 0;
  const isPacingActive = countdownSeconds > 0 && queueState?.isProcessing;

  const hasActivity = todayAllCount > 0 || activeSending !== null || isPacingActive || todaySendingCount > 0;

  // When no messages have been sent or queued today, show a subtle resting state
  if (!hasActivity) {
    return (
      <div className="rounded-xl border border-glass-border/60 bg-bg2/30 px-4 py-2.5 flex items-center justify-between text-xs text-muted">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-muted" />
          <span>WhatsApp Dispatch Queue is idle (no pending messages for today)</span>
        </div>
        <button
          onClick={() => whatsappQueueEvent.triggerOpen()}
          className="text-xs font-bold text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
        >
          Open Automation Hub
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-glass-border/80 bg-bg2/50 backdrop-blur-md shadow-sm overflow-hidden transition-all duration-300 animate-in fade-in">
      {/* ── HEADER / SUMMARY ROW ── */}
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-glass-border/40 bg-bg2/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            {todaySendingCount > 0 ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-text">WhatsApp Queue Dispatch Progress:</span>
              <span className="text-xs font-mono font-extrabold text-sky-400">
                {todaySentCount} / {todayAllCount} ({todayProgressPercent}%)
              </span>
            </div>
            <p className="text-[11px] text-muted truncate">
              {todayRemainingCount > 0
                ? `${todayRemainingCount} message(s) pending in background queue`
                : todayFailedCount > 0
                ? `${todayFailedCount} message(s) failed delivery`
                : todaySentCount > 0
                ? `All ${todaySentCount} queued messages delivered successfully today`
                : 'Queue processing'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isPacingActive && (
            <button
              onClick={handleForceNext}
              disabled={isForcingNext}
              className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs disabled:opacity-50"
              title="Skip safety wait countdown and send next queued message immediately"
            >
              <FastForward size={12} className={isForcingNext ? 'animate-spin' : ''} />
              <span>Skip Delay ({countdownSeconds}s)</span>
            </button>
          )}

          <button
            onClick={() => whatsappQueueEvent.triggerOpen()}
            className="px-2.5 py-1 rounded-lg bg-bg border border-glass-border/60 hover:border-glass-border text-[11px] font-bold text-text transition-colors cursor-pointer"
            title="Open WhatsApp Queue Drawer"
          >
            Manage Queue
          </button>

          <button
            onClick={() => setIsCollapsed(prev => !prev)}
            className="p-1 rounded-lg hover:bg-bg3/50 text-muted hover:text-text transition-colors cursor-pointer"
            title={isCollapsed ? 'Expand Progress' : 'Collapse Progress'}
          >
            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* ── CARD BODY (COLLAPSIBLE) ── */}
      {!isCollapsed && (
        <div className="p-4 space-y-3.5">
          {/* ── BAR 1: MACRO QUEUE BATCH PROGRESS ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-muted">Total Batch Completed</span>
              <span className="font-mono font-bold text-sky-400">{todayProgressPercent}%</span>
            </div>

            {/* Overall Progress Bar */}
            <div className="w-full bg-bg h-2 rounded-full overflow-hidden border border-glass-border/40 relative shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-sky-500 via-teal-400 to-emerald-400 transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, todayProgressPercent))}%` }}
              />
            </div>

            {/* Metric Status Badges */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5 text-[11px]">
              <span className="px-2 py-0.5 rounded-lg bg-bg border border-glass-border font-bold text-text">
                Total: {todayAllCount}
              </span>
              <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 size={11} /> {todaySentCount} Sent
              </span>
              {todayRemainingCount > 0 && (
                <span className="px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 font-semibold flex items-center gap-1">
                  <Clock size={11} /> {todayRemainingCount} Pending
                </span>
              )}
              {todaySendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400 font-bold flex items-center gap-1 animate-pulse">
                  <RefreshCw size={11} className="animate-spin" /> {todaySendingCount} Sending
                </span>
              )}
              {isPacingActive && (
                <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold flex items-center gap-1">
                  <Clock size={11} /> Delay: {countdownSeconds}s
                </span>
              )}
              {todayFailedCount > 0 && (
                <span className="px-2 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 font-bold flex items-center gap-1">
                  <AlertTriangle size={11} /> {todayFailedCount} Failed
                </span>
              )}
            </div>
          </div>

          {/* ── BAR 2: MICRO IN-FLIGHT MESSAGE ANIMATION (0-100% & 10s-0s) ── */}
          {activeSending && (
            <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 shadow-sm space-y-2 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Send
                    size={14}
                    className={`text-sky-400 ${activeSending.completed ? '' : 'animate-bounce'}`}
                  />
                  <span className="text-xs font-bold text-text truncate">
                    {activeSending.completed
                      ? `✓ Sent to ${activeSending.recipient}`
                      : `Sending WhatsApp to ${activeSending.recipient}`}
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 shrink-0">
                  {activeSending.completed
                    ? '100% Complete'
                    : `${activeSending.progress}% (${activeSending.secondsLeft}s left)`}
                </span>
              </div>

              {/* 0-100% Smooth Progress Bar with Glowing Edge */}
              <div className="w-full h-1.5 bg-bg border border-glass-border/40 rounded-full overflow-hidden relative shadow-inner">
                <div
                  className="h-full rounded-full transition-all duration-150 relative bg-gradient-to-r from-sky-500 via-teal-400 to-emerald-400"
                  style={{ width: `${Math.min(100, Math.max(0, activeSending.progress))}%` }}
                >
                  <div className="absolute right-0 top-0 bottom-0 w-2.5 bg-sky-100 rounded-full shadow-sm shadow-sky-400/50" />
                </div>
              </div>

              {activeSending.type && (
                <div className="text-[10px] text-muted truncate">
                  Context: {activeSending.type}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

DispatchWhatsAppProgressCard.displayName = 'DispatchWhatsAppProgressCard';
