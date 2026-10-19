import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { Smartphone, QrCode, Wifi, WifiOff, Edit2, Save, X, Bot, BotOff, Loader2, Clock, MessageSquare, Pause, Send } from 'lucide-react';
import { api, peekWhatsAppQueueStatusCache, type WhatsAppQueueStatus } from '../services/api';
import { whatsappQueueEvent } from '../services/events';

export interface RegisteredDevice {
  token: string;
  device_name: string;
  os: string;
  is_online: number;
  last_seen: string;
  offline_seconds?: number;
}

interface ConnectedDevicesFooterBarProps {
  onOpenConnectModal: () => void;
}

// memo: footer chrome re-renders only on its own device/WA state, never on navigation
export const ConnectedDevicesFooterBar = memo(function ConnectedDevicesFooterBar({
  onOpenConnectModal,
}: ConnectedDevicesFooterBarProps) {
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [waStatus, setWaStatus] = useState<{ isReady: boolean; sleeping: boolean; status: string } | null>(null);
  const [queueStatus, setQueueStatus] = useState<WhatsAppQueueStatus | null>(() => peekWhatsAppQueueStatusCache(30000));
  const [countdownSec, setCountdownSec] = useState<number>(() => {
    const initial = peekWhatsAppQueueStatusCache(30000);
    if (initial?.nextDispatchTimestamp) {
      return Math.max(0, Math.ceil((initial.nextDispatchTimestamp - Date.now()) / 1000));
    }
    return initial?.nextDispatchCountdownSeconds || 0;
  });
  const [waking, setWaking] = useState(false);
  const wakePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDevicesStatus = useCallback(async () => {
    try {
      if (typeof api.getRegisteredDevices === 'function') {
        const res = await api.getRegisteredDevices();
        if (res && Array.isArray(res.devices)) {
          setDevices(res.devices);
        }
      }
    } catch {
      // Ignore background fetch errors
    }
  }, []);

  const fetchWhatsAppStatus = useCallback(async () => {
    try {
      if (typeof api.getWhatsAppStatus === 'function') {
        const waRes = await api.getWhatsAppStatus() as any;
        setWaStatus({
          isReady: !!waRes?.isReady,
          sleeping: waRes?.status === 'SLEEPING' || waRes?.sleeping === true,
          status: waRes?.status || (waRes?.isReady ? 'READY' : 'DISCONNECTED'),
        });
        return !!(waRes?.isReady || waRes?.status === 'READY' || waRes?.status === 'CONNECTED');
      }
    } catch {
      // Ignore background fetch errors
    }
    return false;
  }, []);

  const handleWake = useCallback(async () => {
    if (waking) return;
    setWaking(true);
    if (wakePollRef.current) {
      clearInterval(wakePollRef.current);
      wakePollRef.current = null;
    }
    try {
      await (api as any).wakeWhatsapp?.();
      // Poll for ready state after wake (max 20s, stops immediately when ready)
      let attempts = 0;
      wakePollRef.current = setInterval(async () => {
        attempts++;
        if (document.visibilityState === 'visible') {
          const isReady = await fetchWhatsAppStatus();
          if (isReady && wakePollRef.current) {
            clearInterval(wakePollRef.current);
            wakePollRef.current = null;
            return;
          }
        }
        if (attempts >= 10 && wakePollRef.current) {
          clearInterval(wakePollRef.current);
          wakePollRef.current = null;
        }
      }, 2000);
    } catch {
      // ignore
    } finally {
      setTimeout(() => setWaking(false), 3000);
    }
  }, [waking, fetchWhatsAppStatus]);

  const fetchQueueStatus = useCallback(async (bypassCache = false) => {
    try {
      if (typeof api.getWhatsAppQueueStatus === 'function') {
        const cached = bypassCache ? null : peekWhatsAppQueueStatusCache(2500);
        const data = cached ?? (await api.getWhatsAppQueueStatus());
        if (data) {
          setQueueStatus(data);
          if (data.nextDispatchTimestamp) {
            setCountdownSec(Math.max(0, Math.ceil((data.nextDispatchTimestamp - Date.now()) / 1000)));
          } else {
            setCountdownSec(data.nextDispatchCountdownSeconds || 0);
          }
        }
      }
    } catch {
      // Ignore background fetch errors
    }
  }, []);

  useEffect(() => {
    if (!queueStatus?.nextDispatchTimestamp) {
      if (countdownSec !== (queueStatus?.nextDispatchCountdownSeconds || 0)) {
        setCountdownSec(queueStatus?.nextDispatchCountdownSeconds || 0);
      }
      return;
    }

    const targetTs = queueStatus.nextDispatchTimestamp;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((targetTs - Date.now()) / 1000));
      setCountdownSec(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [queueStatus?.nextDispatchTimestamp, queueStatus?.nextDispatchCountdownSeconds]);

  useEffect(() => {
    fetchDevicesStatus();
    fetchWhatsAppStatus();
    fetchQueueStatus(false);

    // P1 "events, not timers": updates driven by SSE push, focus, and visibility change — zero background polling timers
    const handleSse = () => {
      fetchWhatsAppStatus();
      fetchQueueStatus(true);
    };
    window.addEventListener('sse-wa-status-changed', handleSse);
    window.addEventListener('sse-wa-queue-updated', handleSse);
    const unsubQueue = whatsappQueueEvent.subscribeUpdated(() => fetchQueueStatus(true));

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchDevicesStatus();
        fetchWhatsAppStatus();
        fetchQueueStatus(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      if (wakePollRef.current) {
        clearInterval(wakePollRef.current);
        wakePollRef.current = null;
      }
      unsubQueue();
      window.removeEventListener('sse-wa-status-changed', handleSse);
      window.removeEventListener('sse-wa-queue-updated', handleSse);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [fetchDevicesStatus, fetchWhatsAppStatus, fetchQueueStatus]);

  const handleSaveRename = async (token: string) => {
    if (!editName.trim()) return;
    try {
      await api.renameDevice(token, editName.trim());
      setDevices(prev =>
        prev.map(d => (d.token === token ? { ...d, device_name: editName.trim() } : d))
      );
      setEditingToken(null);
    } catch (err) {
      console.warn('Failed to rename device:', err);
    }
  };

  const getPlatformIcon = (osStr: string) => {
    const lower = (osStr || '').toLowerCase();
    if (lower.includes('ios') || lower.includes('iphone') || lower.includes('ipad') || lower.includes('apple')) {
      return <span className="font-bold text-xs mr-1 text-text"></span>;
    }
    if (lower.includes('android')) {
      return <span className="font-bold text-xs mr-1 text-emerald-400">🤖</span>;
    }
    return <Smartphone size={12} className="mr-1 text-primary" />;
  };

  const onlineCount = devices.filter(d => d.is_online === 1).length;

  // WhatsApp Bot status pill
  const BotStatusPill = () => {
    if (waStatus === null) return null;

    if (waStatus.isReady) {
      return (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] shrink-0">
          <Bot size={11} />
          <span className="font-semibold">AI Bot: Active</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </div>
      );
    }

    if (waStatus.sleeping) {
      return (
        <button
          onClick={handleWake}
          disabled={waking}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] shrink-0 hover:bg-amber-500/20 transition-colors cursor-pointer"
          title="WhatsApp bot is sleeping. Click to wake it up so it can reply to customer messages instantly."
        >
          {waking ? <Loader2 size={11} className="animate-spin" /> : <Bot size={11} />}
          <span className="font-semibold">{waking ? 'Waking...' : 'AI Bot: Sleeping — Wake'}</span>
        </button>
      );
    }

    // Disconnected
    return (
      <button
        onClick={handleWake}
        disabled={waking}
        className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-400 text-[11px] shrink-0 hover:bg-rose-500/20 transition-colors cursor-pointer"
        title="WhatsApp bot is offline. Click to reconnect."
      >
        {waking ? <Loader2 size={11} className="animate-spin" /> : <BotOff size={11} />}
        <span className="font-semibold">{waking ? 'Connecting...' : 'AI Bot: Offline — Connect'}</span>
      </button>
    );
  };

  // WhatsApp Queue Countdown & Live Status Pill
  const QueueCountdownPill = () => {
    const pendingCount = (queueStatus?.counts?.pending || 0) + (queueStatus?.counts?.sending || 0);
    const sendingCount = queueStatus?.counts?.sending || 0;
    const isPaused = Boolean(queueStatus?.isPaused);
    const isOnline = Boolean(waStatus?.isReady || queueStatus?.isOnline);
    const isSleeping = Boolean(waStatus?.sleeping || queueStatus?.sleeping);

    const handleClick = () => {
      whatsappQueueEvent.triggerOpen();
    };

    // State 1: Paused
    if (isPaused) {
      return (
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => import('./WhatsAppQueuePopover').catch(() => {})}
          onFocus={() => import('./WhatsAppQueuePopover').catch(() => {})}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] shrink-0 hover:bg-amber-500/20 transition-colors cursor-pointer"
          title="WhatsApp send queue is paused. Click to open controller and resume."
        >
          <Pause size={11} className="fill-current text-amber-400" />
          <span className="font-semibold">Queue: Paused{pendingCount > 0 ? ` (${pendingCount})` : ''}</span>
        </button>
      );
    }

    // State 2: Offline / Disconnected with queued items
    if (!isOnline && !isSleeping && pendingCount > 0) {
      return (
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => import('./WhatsAppQueuePopover').catch(() => {})}
          onFocus={() => import('./WhatsAppQueuePopover').catch(() => {})}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-400 text-[11px] shrink-0 hover:bg-rose-500/20 transition-colors cursor-pointer"
          title={`WhatsApp bot is offline with ${pendingCount} message(s) queued. Click to open controller.`}
        >
          <Clock size={11} className="text-rose-400" />
          <span className="font-semibold">Queue: WA Offline ({pendingCount})</span>
        </button>
      );
    }

    // State 3: Sleeping with queued items
    if (isSleeping && pendingCount > 0) {
      return (
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => import('./WhatsAppQueuePopover').catch(() => {})}
          onFocus={() => import('./WhatsAppQueuePopover').catch(() => {})}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky text-[11px] shrink-0 hover:bg-sky-500/20 transition-colors cursor-pointer"
          title={`WhatsApp is sleeping. Queue will wake it automatically to dispatch ${pendingCount} message(s). Click to open controller.`}
        >
          <Clock size={11} className="text-sky" />
          <span className="font-semibold">Queue: Sleeping ({pendingCount})</span>
        </button>
      );
    }

    // State 4: Actively sending / pacing countdown
    if (sendingCount > 0 && countdownSec > 0) {
      return (
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => import('./WhatsAppQueuePopover').catch(() => {})}
          onFocus={() => import('./WhatsAppQueuePopover').catch(() => {})}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky text-[11px] shrink-0 hover:bg-sky-500/20 transition-colors cursor-pointer"
          title="Dispatching message now. Click to open live WhatsApp queue controller."
        >
          <Loader2 size={11} className="animate-spin text-sky" />
          <span className="font-semibold">Sending · Next in {countdownSec}s ({pendingCount})</span>
        </button>
      );
    }

    if (countdownSec > 0 && pendingCount > 0) {
      return (
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => import('./WhatsAppQueuePopover').catch(() => {})}
          onFocus={() => import('./WhatsAppQueuePopover').catch(() => {})}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] shrink-0 hover:bg-amber-500/20 transition-colors cursor-pointer"
          title="Waiting pacing delay before sending next message. Click to open controller or send now."
        >
          <Clock size={11} className="text-amber-300" />
          <span className="font-semibold">Next message in {countdownSec}s ({pendingCount})</span>
        </button>
      );
    }

    if (sendingCount > 0) {
      return (
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => import('./WhatsAppQueuePopover').catch(() => {})}
          onFocus={() => import('./WhatsAppQueuePopover').catch(() => {})}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky text-[11px] shrink-0 hover:bg-sky-500/20 transition-colors cursor-pointer"
          title="Sending queued WhatsApp message. Click to open controller."
        >
          <Loader2 size={11} className="animate-spin text-sky" />
          <span className="font-semibold">Sending message... ({pendingCount})</span>
        </button>
      );
    }

    if (pendingCount > 0) {
      return (
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={() => import('./WhatsAppQueuePopover').catch(() => {})}
          onFocus={() => import('./WhatsAppQueuePopover').catch(() => {})}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] shrink-0 hover:bg-emerald-500/20 transition-colors cursor-pointer"
          title="Queue ready for dispatch. Click to open controller."
        >
          <Send size={11} className="text-emerald-400" />
          <span className="font-semibold">Queue: {pendingCount} ready</span>
        </button>
      );
    }

    // State 5: Idle (empty queue)
    return (
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => import('./WhatsAppQueuePopover').catch(() => {})}
        onFocus={() => import('./WhatsAppQueuePopover').catch(() => {})}
        className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-bg3/60 hover:bg-bg3 border border-glass-border text-muted hover:text-text text-[11px] shrink-0 transition-colors cursor-pointer"
        title="WhatsApp queue is idle. Click to view delivery register & queue controller."
      >
        <MessageSquare size={11} />
        <span className="font-semibold">Queue: Idle</span>
      </button>
    );
  };

  return (
    <footer className="h-9 bg-bg2/90 border-t border-glass-border px-3 flex items-center justify-between text-xs shrink-0 select-none z-20">
      {/* Left: Device status pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        <button
          onClick={onOpenConnectModal}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary font-bold transition-all shrink-0"
          title="Connect mobile app or scan QR"
        >
          <QrCode size={12} />
          <span>Mobile Devices ({onlineCount}/{devices.length} Online)</span>
        </button>

        <div className="h-3 w-[1px] bg-glass-border shrink-0" />

        {devices.length === 0 ? (
          <span className="text-[11px] text-muted flex items-center gap-1">
            <WifiOff size={11} /> No mobile devices registered yet (scan QR to pair)
          </span>
        ) : (
          devices.map(dev => {
            const isOnline = dev.is_online === 1;
            const isEditing = editingToken === dev.token;

            return (
              <div
                key={dev.token}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[11px] transition-all shrink-0 ${
                  isOnline
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                    : 'bg-white/5 border-glass-border text-muted'
                }`}
              >
                {getPlatformIcon(dev.os)}

                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <input
                      id={`device-rename-${dev.token}`}
                      name={`device_rename_${dev.token}`}
                      type="text"
                      autoComplete="off"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="bg-bg border border-primary px-1.5 py-0.5 rounded text-[11px] text-white outline-none w-24"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveRename(dev.token)}
                      className="text-primary hover:text-white"
                    >
                      <Save size={11} />
                    </button>
                    <button
                      onClick={() => setEditingToken(null)}
                      className="text-muted hover:text-white"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white truncate max-w-[120px]">
                      {dev.device_name}
                    </span>

                    <button
                      onClick={() => {
                        setEditingToken(dev.token);
                        setEditName(dev.device_name);
                      }}
                      className="text-muted hover:text-white opacity-0 hover:opacity-100 transition-opacity"
                      title="Rename device"
                    >
                      <Edit2 size={10} />
                    </button>

                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                      }`}
                      title={isOnline ? 'Connected' : 'Offline'}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Right: AI Bot status + WhatsApp queue countdown + sync indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <BotStatusPill />
        <QueueCountdownPill />
        <div className="h-3 w-[1px] bg-glass-border" />
        <button
          onClick={onOpenConnectModal}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-white transition-colors"
        >
          <Wifi size={11} className="text-emerald-400" />
          <span>Auto-Sync Active</span>
        </button>
      </div>
    </footer>
  );
});

