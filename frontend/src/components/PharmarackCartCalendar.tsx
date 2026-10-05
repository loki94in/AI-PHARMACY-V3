import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Clock, ShoppingCart, Send, Store, Calendar, Truck, Package } from 'lucide-react';
import { api, apiClient } from '../services/api';
import { toastEvent, whatsappQueueEvent } from '../services/events';
import { useStore } from '../context/StoreContext';
import { ClosureCalendarModal } from './ClosureCalendarModal';
import { ClosureStockBufferModal } from './ClosureStockBufferModal';
import { MarketClosureNoticeModal } from './MarketClosureNoticeModal';

// Indian Public & National Holidays (2025-2027 reference)
const INDIAN_HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-26': 'Republic Day',
  '2025-03-14': 'Holi',
  '2025-03-31': 'Id-ul-Fitr',
  '2025-04-18': 'Good Friday',
  '2025-08-15': 'Independence Day',
  '2025-10-02': 'Gandhi Jayanti',
  '2025-10-21': 'Dussehra',
  '2025-10-20': 'Diwali',
  '2025-12-25': 'Christmas',
  // 2026
  '2026-01-01': 'New Year',
  '2026-01-26': 'Republic Day',
  '2026-03-04': 'Mahashivratri',
  '2026-03-14': 'Holi',
  '2026-03-20': 'Id-ul-Fitr',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Ambedkar Jayanti',
  '2026-05-01': 'May Day',
  '2026-05-27': 'Bakrid',
  '2026-08-15': 'Independence Day',
  '2026-08-26': 'Janmashtami',
  '2026-09-16': 'Milad-un-Nabi',
  '2026-10-02': 'Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-08': 'Diwali',
  '2026-11-24': 'Guru Nanak Jayanti',
  '2026-12-25': 'Christmas',
  // 2027
  '2027-01-26': 'Republic Day',
  '2027-03-22': 'Holi',
  '2027-08-15': 'Independence Day',
  '2027-10-02': 'Gandhi Jayanti',
  '2027-11-09': 'Diwali',
  '2027-12-25': 'Christmas',
};

interface DateCardItem {
  dateStr: string; // YYYY-MM-DD
  dayName: string; // Sun, Mon, etc.
  dateNum: number;
  monthName: string;
  isToday: boolean;
  isSunday: boolean;
  holidayName?: string;
  isPaused: boolean;
  isShopClosed?: boolean;
}

interface PharmarackCartCalendarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  hasUnreadSentHistory?: boolean;
  activeCount?: number;
  reorderCount?: number;
}

export const PharmarackCartCalendar: React.FC<PharmarackCartCalendarProps> = ({
  currentTab,
  onTabChange,
  hasUnreadSentHistory = false,
  activeCount = 0,
  reorderCount = 0,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const todayCardRef = useRef<HTMLButtonElement>(null);

  // Paused dates set (stored in localStorage & synced to backend settings)
  const [pausedDates, setPausedDates] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('pharmarack_paused_dispatch_dates');
      if (stored) return JSON.parse(stored);
    } catch (_) {}
    return [];
  });

  // Active store context for per-store ordering and delivery management
  const { activeStore } = useStore();

  // Timer Pacing state (seconds) & Mode ('auto' | 'manual')
  const [timerSec, setTimerSec] = useState<number>(12);
  const [pacingMode, setPacingMode] = useState<'auto' | 'manual'>('auto');
  const [isSavingPacing, setIsSavingPacing] = useState<boolean>(false);

  // Smart daily auto pacing variation (rotates 11s - 16s by day of month)
  const todayAutoDelay = useMemo(() => {
    const day = new Date().getDate();
    const autoSchedule = [12, 14, 11, 15, 13, 16];
    return autoSchedule[day % autoSchedule.length];
  }, []);

  // Pharmacy Operating Hours, Weekly Off Day & Delivery Timetable state
  const [shopWeeklyOff, setShopWeeklyOff] = useState<string>('Monday');
  const [shopOpenTime, setShopOpenTime] = useState<string>('09:00');
  const [shopCloseTime, setShopCloseTime] = useState<string>('22:00');
  const [cutoffTime, setCutoffTime] = useState<string>('23:00');
  const [deliveryStart, setDeliveryStart] = useState<string>('19:00');
  const [deliveryEnd, setDeliveryEnd] = useState<string>('21:00');
  const [pharmacyClosedDates, setPharmacyClosedDates] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<Record<string, string>>({});

  // Month Calendar Popover State
  const [isCalendarOpen, setIsCalendarOpen] = useState<boolean>(false);

  // Market & Pharmacy Closure Management States
  const [isBufferModalOpen, setIsBufferModalOpen] = useState<boolean>(false);
  const [isNoticeModalOpen, setIsNoticeModalOpen] = useState<boolean>(false);
  const [noticeModalTargetDate, setNoticeModalTargetDate] = useState<string>('');
  const [noticeModalEndDate, setNoticeModalEndDate] = useState<string>('');
  const [closureConfig, setClosureConfig] = useState<any>(null);
  const [bufferCount, setBufferCount] = useState<number>(0);

  const loadClosureStatus = useCallback(() => {
    api.getMarketClosureStatus()
      .then((res: any) => {
        if (res?.config) {
          setClosureConfig(res.config);
          if (res.config.enabled) {
            api.getMarketClosureBuffer()
              .then((buf: any) => setBufferCount(buf?.items?.length || 0))
              .catch(() => {});
          } else {
            setBufferCount(0);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Fetch current pacing and schedule settings
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api.getWhatsAppQueueStatus();
        if (mounted && data?.currentPacingMinMs) {
          setTimerSec(Math.round(data.currentPacingMinMs / 1000));
        }
      } catch (_) {}

      try {
        const res = await apiClient.get('/settings');
        if (mounted && res?.data) {
          const mode = res.data.whatsapp_queue_pacing_mode === 'manual' ? 'manual' : 'auto';
          setPacingMode(mode);
          if (res.data.whatsapp_queue_pacing_sec) {
            setTimerSec(Number(res.data.whatsapp_queue_pacing_sec) || 12);
          }
          if (mode === 'auto') {
            const minSec = todayAutoDelay;
            const maxSec = todayAutoDelay + 2;
            api.updateWhatsAppPacingConfig(minSec, maxSec).catch(() => {});
          }
          if (res.data.pharmacy_weekly_off) setShopWeeklyOff(res.data.pharmacy_weekly_off);
          if (res.data.pharmacy_open_time) setShopOpenTime(res.data.pharmacy_open_time);
          if (res.data.pharmacy_close_time) setShopCloseTime(res.data.pharmacy_close_time);
          if (res.data.pharmacy_cutoff_time || res.data.order_cutoff_time) {
            setCutoffTime(res.data.pharmacy_cutoff_time || res.data.order_cutoff_time);
          }
          if (res.data.delivery_window_start) setDeliveryStart(res.data.delivery_window_start);
          if (res.data.delivery_window_end) setDeliveryEnd(res.data.delivery_window_end);
          if (res.data.closure_occasions) {
            try { setOccasions(JSON.parse(res.data.closure_occasions)); } catch (_) {}
          }
          if (res.data.pharmacy_closed_dates) {
            try {
              setPharmacyClosedDates(JSON.parse(res.data.pharmacy_closed_dates));
            } catch (_) {}
          }
        }
      } catch (_) {}
      loadClosureStatus();
    })();
    return () => { mounted = false; };
  }, [loadClosureStatus]);

  useEffect(() => {
    const handleRefresh = () => loadClosureStatus();
    window.addEventListener('refresh-pharmarack-cart', handleRefresh);
    return () => window.removeEventListener('refresh-pharmarack-cart', handleRefresh);
  }, [loadClosureStatus]);

  // Save paused dates to localStorage & backend
  const updatePausedDates = (newDates: string[]) => {
    setPausedDates(newDates);
    try {
      localStorage.setItem('pharmarack_paused_dispatch_dates', JSON.stringify(newDates));
    } catch (_) {}

    // Instantly notify Header Topbar & Dispatch components with new paused dates
    window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart', { detail: { pausedDates: newDates } }));

    apiClient.post('/settings/save', {
      pharmarack_paused_dispatch_dates: JSON.stringify(newDates)
    }).catch(() => {});
  };

  const handleShopWeeklyOffChange = (val: string) => {
    setShopWeeklyOff(val);
    apiClient.post('/settings/save', { pharmacy_weekly_off: val }).then(() => {
      toastEvent.trigger(`Shop weekly off set to ${val}`, 'info');
    }).catch(() => {});
  };

  const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Keep the stock-buffer closure plan (single upcoming window) in step with the calendar: the first run of
  // consecutive closed days from today that holds at least one explicitly marked date (Sundays alone are automatic).
  const syncClosureConfig = (market: string[], store: string[], reason: string) => {
    const marketSet = new Set(market);
    const storeSet = new Set(store);
    const todayYmd = ymdOf(new Date());
    const closedOn = (d: Date) => d.getDay() === 0 || marketSet.has(ymdOf(d)) || storeSet.has(ymdOf(d));
    const explicit = (d: Date) => marketSet.has(ymdOf(d)) || storeSet.has(ymdOf(d));
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    let start: Date | null = null;
    for (let i = 0; i < 120 && !start; i++) {
      if (explicit(cursor) && ymdOf(cursor) >= todayYmd) start = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
    if (!start) {
      api.saveMarketClosureStatus({ enabled: false, type: 'market_closed', startDate: '', endDate: '' }).then(loadClosureStatus).catch(() => {});
      return;
    }
    let end = new Date(start);
    while (true) {
      const next = new Date(end);
      next.setDate(next.getDate() + 1);
      if (!closedOn(next)) break;
      end = next;
    }
    let anyStore = false;
    for (let d = new Date(start); ymdOf(d) <= ymdOf(end); d.setDate(d.getDate() + 1)) {
      if (storeSet.has(ymdOf(d))) anyStore = true;
    }
    api.saveMarketClosureStatus({
      enabled: true,
      type: anyStore ? 'pharmacy_closed' : 'market_closed',
      startDate: ymdOf(start),
      endDate: ymdOf(end),
      reason
    }).then(loadClosureStatus).catch(() => {});
  };

  const handleSaveOccasion = (dateStr: string, name: string) => {
    const next = { ...occasions };
    if (name.trim()) next[dateStr] = name.trim(); else delete next[dateStr];
    setOccasions(next);
    apiClient.post('/settings/save', { closure_occasions: JSON.stringify(next) }).catch(() => {});
  };

  const handleToggleMarketDate = (dateStr: string, on: boolean, reason: string) => {
    const updated = on ? Array.from(new Set([...pausedDates, dateStr])).sort() : pausedDates.filter(d => d !== dateStr);
    updatePausedDates(updated);
    syncClosureConfig(updated, pharmacyClosedDates, reason);
    toastEvent.trigger(on ? `Market marked closed on ${dateStr} — store stays open for orders and pickup` : `Market reopened on ${dateStr}`, 'info');
  };

  const handleToggleStoreDate = (dateStr: string, on: boolean) => {
    const updated = on ? Array.from(new Set([...pharmacyClosedDates, dateStr])).sort() : pharmacyClosedDates.filter(d => d !== dateStr);
    setPharmacyClosedDates(updated);
    apiClient.post('/settings/save', { pharmacy_closed_dates: JSON.stringify(updated) }).then(() => {
      toastEvent.trigger(on ? `Store marked closed on ${dateStr}` : `Store reopened on ${dateStr}`, 'info');
    }).catch(() => {});
    syncClosureConfig(pausedDates, updated, 'Store Holiday');
  };

  const handleTimeChange = (open: string, close: string) => {
    setShopOpenTime(open);
    setShopCloseTime(close);
    apiClient.post('/settings/save', {
      pharmacy_open_time: open,
      pharmacy_close_time: close
    }).then(() => {
      toastEvent.trigger(`Store hours set: ${open} - ${close}`, 'info');
    }).catch(() => {});
  };

  const handleCutoffChange = (cutoff: string) => {
    setCutoffTime(cutoff);
    apiClient.post('/settings/save', {
      pharmacy_cutoff_time: cutoff,
      order_cutoff_time: cutoff
    }).then(() => {
      toastEvent.trigger(`Order cutoff time set to ${cutoff}`, 'info');
    }).catch(() => {});
  };

  const handleDeliveryWindowChange = (start: string, end: string) => {
    setDeliveryStart(start);
    setDeliveryEnd(end);
    apiClient.post('/settings/save', {
      delivery_window_start: start,
      delivery_window_end: end
    }).then(() => {
      toastEvent.trigger(`Delivery timetable window set: ${start} - ${end}`, 'info');
    }).catch(() => {});
  };

  const togglePauseDate = (dateStr: string) => {
    if (pausedDates.includes(dateStr)) {
      const updated = pausedDates.filter(d => d !== dateStr);
      updatePausedDates(updated);
      toastEvent.trigger(`Resumed auto-dispatch for ${dateStr}`, 'info');
    } else {
      const updated = [...pausedDates, dateStr];
      updatePausedDates(updated);
      toastEvent.trigger(`Paused auto-dispatch for ${dateStr}`, 'info');
      setNoticeModalTargetDate(dateStr);
      setNoticeModalEndDate(dateStr);
      setIsNoticeModalOpen(true);
    }
  };

  const handlePacingChange = async (target: 'auto' | number) => {
    setIsSavingPacing(true);
    try {
      if (target === 'auto') {
        setPacingMode('auto');
        setTimerSec(todayAutoDelay);
        const minSec = todayAutoDelay;
        const maxSec = todayAutoDelay + 2;
        await api.updateWhatsAppPacingConfig(minSec, maxSec);
        await apiClient.post('/settings/save', {
          whatsapp_queue_pacing_mode: 'auto',
          whatsapp_queue_pacing_sec: String(todayAutoDelay)
        });
        try { localStorage.setItem('pharmarack_cart_timer_sec', String(todayAutoDelay)); } catch (_) {}
        whatsappQueueEvent.triggerUpdated();
        toastEvent.trigger(`Auto-send delay set to Smart Daily Auto (${todayAutoDelay}s today)`, 'info');
      } else {
        const sec = Math.max(10, target);
        setPacingMode('manual');
        setTimerSec(sec);
        const minSec = sec;
        const maxSec = sec + 2;
        await api.updateWhatsAppPacingConfig(minSec, maxSec);
        await apiClient.post('/settings/save', {
          whatsapp_queue_pacing_mode: 'manual',
          whatsapp_queue_pacing_sec: String(sec)
        });
        try { localStorage.setItem('pharmarack_cart_timer_sec', String(sec)); } catch (_) {}
        whatsappQueueEvent.triggerUpdated();
        toastEvent.trigger(`Auto-send delay set to ${sec}s per order`, 'info');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.message || 'Failed to update send delay', 'error');
    } finally {
      setIsSavingPacing(false);
    }
  };

  // Generate 60-day rolling date strip (-7 days ago to +52 days ahead to fill widescreen displays)
  const dateCards = useMemo(() => {
    const cards: DateCardItem[] = [];
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    for (let offset = -7; offset <= 52; offset++) {
      const d = new Date(now);
      d.setDate(now.getDate() + offset);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const isSunday = d.getDay() === 0;
      const isToday = dateStr === todayStr;
      const holidayName = INDIAN_HOLIDAYS[dateStr];
      const isPaused = pausedDates.includes(dateStr);
      const dayFullName = d.toLocaleDateString('en-US', { weekday: 'long' });
      const isShopWeeklyOff = shopWeeklyOff.toLowerCase() !== 'none' && dayFullName.toLowerCase() === shopWeeklyOff.toLowerCase();
      const isCustomShopClosed = pharmacyClosedDates.includes(dateStr);
      const isShopClosed = isShopWeeklyOff || isCustomShopClosed;

      cards.push({
        dateStr,
        dayName: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        dateNum: d.getDate(),
        monthName: d.toLocaleDateString('en-IN', { month: 'short' }),
        isToday,
        isSunday,
        holidayName,
        isPaused,
        isShopClosed
      });
    }
    return cards;
  }, [pausedDates, shopWeeklyOff, pharmacyClosedDates]);

  // Center scroll on today's card on initial load
  useEffect(() => {
    if (todayCardRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const card = todayCardRef.current;
      const scrollPos = card.offsetLeft - container.offsetWidth / 2 + card.offsetWidth / 2;
      container.scrollTo({ left: Math.max(0, scrollPos), behavior: 'smooth' });
    }
  }, []);



  const scrollToToday = () => {
    if (todayCardRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const card = todayCardRef.current;
      const scrollPos = card.offsetLeft - container.offsetWidth / 2 + card.offsetWidth / 2;
      container.scrollTo({ left: Math.max(0, scrollPos), behavior: 'smooth' });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (scrollContainerRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      scrollContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <div className="w-full bg-transparent border border-glass-border/40 rounded-2xl p-1.5 shadow-sm mb-1.5 space-y-1.5 shrink-0 transition-all">
      
      {/* Top Controls Row: Integrated Navigation Tabs + Timer Pacing Presets */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-glass-border/30">
        
        {/* Integrated Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-bg3/30 p-1 rounded-xl border border-glass-border/40 shrink-0 overflow-x-auto">
          {/* Tab 1: Reorder Hub */}
          <button
            type="button"
            onClick={() => onTabChange('reorder')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'reorder'
                ? 'bg-amber-500/20 text-amber-500 font-black shadow-xs border border-amber-500/40'
                : reorderCount > 0
                  ? 'text-amber-500 hover:bg-amber-500/10'
                  : 'text-muted hover:text-text hover:bg-bg3'
            }`}
            title="Customer requests, refills due, sales-weighted restock suggestions, and recently ordered medicines"
          >
            <Clock size={13} className={currentTab === 'reorder' || reorderCount > 0 ? 'text-amber-500' : 'text-muted'} />
            <span>Reorder Hub</span>
            {reorderCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-500 border border-amber-500/40 font-mono font-bold">
                {reorderCount}
              </span>
            )}
          </button>

          {/* Tab 2: Supplier PO Grouping */}
          <button
            type="button"
            onClick={() => onTabChange('cart')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'cart' || !currentTab
                ? 'bg-bg3/60 text-primary font-black shadow-xs border border-glass-border'
                : 'text-muted hover:text-text hover:bg-bg3'
            }`}
            title="Review grouped distributor carts and create Purchase Orders"
          >
            <ShoppingCart size={13} className={currentTab === 'cart' || !currentTab ? 'text-primary' : 'text-muted'} />
            <span>Supplier PO Grouping</span>
            {activeCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary/15 text-primary border border-primary/20 font-mono font-bold">
                {activeCount}
              </span>
            )}
          </button>

          {/* Tab 3: Sent Orders History */}
          <button
            type="button"
            onClick={() => onTabChange('sent-history')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap relative ${
              currentTab === 'sent-history'
                ? 'bg-bg3/60 text-primary font-black shadow-xs border border-glass-border'
                : 'text-muted hover:text-text hover:bg-bg3'
            }`}
          >
            <Send size={13} className={currentTab === 'sent-history' ? 'text-primary' : 'text-muted'} />
            <span>Sent PO History</span>
            {hasUnreadSentHistory && currentTab !== 'sent-history' && (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
          </button>
        </div>

        {/* Timer Pacing Selector & Controls */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-1 bg-bg px-2.5 py-1 rounded-xl border border-glass-border shadow-2xs">
            <Clock size={12} className="text-sky-500 shrink-0" />
            <span className="text-[11px] font-bold text-muted truncate mr-1">Delay:</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => handlePacingChange('auto')}
                disabled={isSavingPacing}
                className={`px-1.5 py-0.5 rounded-md text-[9px] font-black transition-all cursor-pointer ${
                  pacingMode === 'auto'
                    ? 'bg-primary/20 text-primary border border-primary/40 shadow-2xs'
                    : 'text-muted hover:text-text hover:bg-bg3 border border-transparent'
                }`}
                title={`Smart Daily Auto-Pacing (Rotates daily for anti-ban safety — currently ${todayAutoDelay}s today)`}
              >
                Auto {pacingMode === 'auto' ? `(${todayAutoDelay}s)` : ''}
              </button>
              {[10, 12, 15, 16, 17, 18].map(sec => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => handlePacingChange(sec)}
                  disabled={isSavingPacing}
                  className={`px-1.5 py-0.5 rounded-md text-[9px] font-black transition-all cursor-pointer ${
                    pacingMode === 'manual' && timerSec === sec
                      ? 'bg-sky-500/15 text-sky-400 border border-sky-400/80 shadow-2xs'
                      : 'text-muted hover:text-text hover:bg-bg3 border border-transparent'
                  }`}
                  title={`Set auto-send delay timer to ${sec}s`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* Market & Store Closure Calendar */}
          <button
            type="button"
            onClick={() => setIsCalendarOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer shadow-2xs ${
              closureConfig?.enabled
                ? closureConfig.type === 'pharmacy_closed'
                  ? 'bg-rose-500/20 text-rose-500 border border-rose-500/50 hover:bg-rose-500/30'
                  : 'bg-amber-500/20 text-amber-500 border border-amber-500/50 hover:bg-amber-500/30'
                : 'bg-bg border border-border text-muted hover:text-text hover:bg-bg2'
            }`}
            title="Mark market closed / store closed dates"
          >
            <Calendar size={12} />
            <span>
              {closureConfig?.enabled && closureConfig?.startDate
                ? `${closureConfig.type === 'pharmacy_closed' ? 'Store' : 'Market'} Closed (${closureConfig.startDate.slice(5)}${closureConfig.endDate && closureConfig.endDate !== closureConfig.startDate ? ` - ${closureConfig.endDate.slice(5)}` : ''})`
                : 'Market / Store Closures'}
            </span>
          </button>

          {/* Closure Stock Buffer Review Button */}
          {closureConfig?.enabled && bufferCount > 0 && (
            <button
              type="button"
              onClick={() => setIsBufferModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-black bg-amber-500/20 text-amber-500 border border-amber-500/50 hover:bg-amber-500/30 transition-all cursor-pointer shadow-2xs animate-pulse"
              title="Review interactive checklist of upcoming refill medicines affected by market closure"
            >
              <Package size={12} />
              <span>Buffer Review ({bufferCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={scrollToToday}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-bg border border-border hover:bg-bg2 text-[11px] font-bold text-sky-700 hover:text-sky-800 transition-all cursor-pointer shadow-2xs"
            title="Jump back to Today in calendar strip"
          >
            <Calendar size={12} className="text-sky-500" />
            <span>Today</span>
          </button>
        </div>

      </div>

      {/* Pharmacy Schedule & Operating Hours Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1 bg-bg3/30 rounded-xl border border-glass-border/30 text-xs">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Active Store Indicator */}
          {activeStore && (
            <div className="flex items-center gap-1 text-[11px] font-bold text-text bg-bg px-2 py-0.5 rounded-lg border border-border/80 shadow-2xs">
              <Store size={12} className="text-primary shrink-0" />
              <span className="truncate max-w-[120px]">{activeStore.name}</span>
            </div>
          )}

          {/* Shop Off / Market & Store closure calendar (single combined calendar) */}
          <div className="flex items-center gap-1.5">
            <Store size={13} className="text-emerald-600 shrink-0" />
            <span className="text-[11px] font-bold text-muted">Shop Off:</span>
            <button
              type="button"
              onClick={() => setIsCalendarOpen(true)}
              className="flex items-center gap-1.5 bg-bg border border-border rounded-lg px-2 py-0.5 text-[11px] font-bold text-text hover:border-primary/50 transition-all cursor-pointer shadow-2xs"
              title="Open the market and store closure calendar"
            >
              <Calendar size={11} className="text-emerald-600 shrink-0" />
              <span>{shopWeeklyOff}</span>
              {pharmacyClosedDates.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-rose-500/15 text-rose-600 border border-rose-500/30">
                  +{pharmacyClosedDates.length}
                </span>
              )}
            </button>
          </div>

          {/* Shop Hours: Open - Close */}
          <div className="flex items-center gap-1">
            <Clock size={12} className="text-emerald-600 shrink-0" />
            <span className="text-[11px] font-bold text-muted">Store:</span>
            <input
              type="time"
              value={shopOpenTime}
              onChange={(e) => handleTimeChange(e.target.value, shopCloseTime)}
              className="bg-bg border border-border rounded-lg px-1.5 py-0.5 text-[11px] font-mono font-bold text-text focus:outline-none focus:border-primary shadow-2xs"
              title="Store Open Time"
            />
            <span className="text-muted text-[10px] font-bold">-</span>
            <input
              type="time"
              value={shopCloseTime}
              onChange={(e) => handleTimeChange(shopOpenTime, e.target.value)}
              className="bg-bg border border-border rounded-lg px-1.5 py-0.5 text-[11px] font-mono font-bold text-text focus:outline-none focus:border-primary shadow-2xs"
              title="Store Close Time"
            />
          </div>

          {/* Order Cutoff Time */}
          <div className="flex items-center gap-1">
            <Clock size={12} className="text-amber-500 shrink-0" />
            <span className="text-[11px] font-bold text-muted">Cutoff:</span>
            <input
              type="time"
              value={cutoffTime}
              onChange={(e) => handleCutoffChange(e.target.value)}
              className="bg-bg border border-border rounded-lg px-1.5 py-0.5 text-[11px] font-mono font-bold text-text focus:outline-none focus:border-primary shadow-2xs"
              title="Order Cutoff Time (Orders after this rollover to next delivery)"
            />
          </div>

          {/* Delivery Timetable Window */}
          <div className="flex items-center gap-1">
            <Truck size={12} className="text-sky-500 shrink-0" />
            <span className="text-[11px] font-bold text-muted">Delivery:</span>
            <input
              type="time"
              value={deliveryStart}
              onChange={(e) => handleDeliveryWindowChange(e.target.value, deliveryEnd)}
              className="bg-bg border border-border rounded-lg px-1.5 py-0.5 text-[11px] font-mono font-bold text-text focus:outline-none focus:border-primary shadow-2xs"
              title="Delivery Window Start Time"
            />
            <span className="text-muted text-[10px] font-bold">-</span>
            <input
              type="time"
              value={deliveryEnd}
              onChange={(e) => handleDeliveryWindowChange(deliveryStart, e.target.value)}
              className="bg-bg border border-border rounded-lg px-1.5 py-0.5 text-[11px] font-mono font-bold text-text focus:outline-none focus:border-primary shadow-2xs"
              title="Delivery Window End Time"
            />
          </div>
        </div>

        {/* Legend / Status Info */}
        <div className="flex items-center gap-2.5 text-[10px] text-muted font-medium flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
            <span>Auto</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span>
            <span>Paused</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block"></span>
            <span>Off / Sun</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 inline-block"></span>
            <span>Today</span>
          </span>
        </div>
      </div>

      {/* Date Strip: Clean Number-Only Bar (Direct Click to Pause/Resume, No Sliding Bar) */}
      <div className="relative flex items-center w-full min-w-0 bg-bg3/20 rounded-xl px-2 py-1 border border-glass-border/30">
        {/* Current Month & Year Indicator */}
        <div className="shrink-0 hidden sm:flex items-center gap-1 mr-2 px-2.5 py-1 rounded-lg bg-bg border border-border/70 text-[11px] font-bold text-muted shadow-2xs">
          <Calendar size={12} className="text-primary shrink-0" />
          <span>{new Date().toLocaleDateString('en-IN', { month: 'short' })} {new Date().getFullYear()}</span>
        </div>

        <div
          ref={scrollContainerRef}
          onWheel={handleWheel}
          className="flex-1 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden scroll-smooth py-0.5 px-0.5 min-w-0"
        >
          {dateCards.map((card) => {
            const isRed = card.isSunday || Boolean(card.holidayName) || card.isShopClosed;

            return (
              <button
                key={card.dateStr}
                ref={card.isToday ? todayCardRef : undefined}
                type="button"
                onClick={() => togglePauseDate(card.dateStr)}
                className={`
                  group relative shrink-0 flex items-center justify-center
                  w-9 h-9 rounded-lg border transition-all duration-150 cursor-pointer select-none
                  ${card.isPaused
                    ? 'bg-amber-500/20 text-amber-600 border-amber-400 font-black shadow-2xs ring-1 ring-amber-400/40 hover:bg-amber-500/30'
                    : card.isToday
                      ? 'bg-sky-500/20 text-sky-700 border-sky-500 ring-2 ring-sky-400/50 font-black hover:bg-sky-500/30'
                      : card.isShopClosed || isRed
                        ? 'bg-rose-500/15 text-rose-600 border-rose-400/40 font-black hover:bg-rose-500/25'
                        : 'bg-bg hover:bg-bg2 border-border hover:border-glass-border text-text font-bold'
                  }
                  hover:scale-105 active:scale-95
                `}
                title={`${card.dayName}, ${card.dateNum} ${card.monthName} ${card.dateStr.split('-')[0]} ${
                  card.isPaused
                    ? '• PAUSED'
                    : card.isShopClosed
                      ? '• Shop Closed'
                      : card.holidayName
                        ? `• Holiday: ${card.holidayName}`
                        : card.isSunday
                          ? '• Sunday'
                          : '• Auto-dispatch Active'
                } — Click to ${card.isPaused ? 'RESUME auto-dispatch' : 'PAUSE auto-dispatch'}`}
              >
                {/* Day Number (with tiny Month tag on 1st of each month) */}
                <div className="flex flex-col items-center justify-center leading-none">
                  {card.dateNum === 1 && (
                    <span className="text-[7px] font-black uppercase tracking-tighter opacity-80 leading-none mb-0.5">
                      {card.monthName}
                    </span>
                  )}
                  <span className="text-xs font-black leading-none">
                    {card.dateNum}
                  </span>
                </div>

                {/* State Micro-Indicator Dot */}
                <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center pointer-events-none">
                  {card.isPaused ? (
                    <span className="w-2 h-2 rounded-full bg-amber-500 border border-bg shadow-2xs"></span>
                  ) : card.isToday ? (
                    <span className="w-2 h-2 rounded-full bg-sky-500 border border-bg shadow-2xs"></span>
                  ) : card.isShopClosed || isRed ? (
                    <span className="w-2 h-2 rounded-full bg-rose-500 border border-bg shadow-2xs"></span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Combined Market & Store Closure Calendar */}
      <ClosureCalendarModal
        isOpen={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        marketDates={pausedDates}
        storeDates={pharmacyClosedDates}
        weeklyOff={shopWeeklyOff}
        occasions={occasions}
        onSaveOccasion={handleSaveOccasion}
        onToggleMarket={handleToggleMarketDate}
        onToggleStore={handleToggleStoreDate}
        onWeeklyOffChange={handleShopWeeklyOffChange}
      />

      {/* Closure Stock Buffer Review Checklist Modal (Human-in-the-Loop) */}
      <ClosureStockBufferModal
        isOpen={isBufferModalOpen}
        onClose={() => setIsBufferModalOpen(false)}
        onCartUpdated={() => {
          loadClosureStatus();
          window.dispatchEvent(new CustomEvent('refresh-pharmarack-cart'));
        }}
      />

      {/* Market Closure & Paused Dispatch Patient Notice Modal (Human-in-the-Loop) */}
      <MarketClosureNoticeModal
        isOpen={isNoticeModalOpen}
        onClose={() => setIsNoticeModalOpen(false)}
        targetDate={noticeModalTargetDate}
        endDate={noticeModalEndDate}
        closureReason={closureConfig?.reason || 'Market Holiday / Paused Dispatch'}
        onConfirmPauseWithoutSending={() => {
          // Date already recorded in pausedDates state
        }}
        onSuccess={(count) => {
          toastEvent.trigger(`Notified ${count} affected patient(s) about delivery reschedule`, 'success');
        }}
      />

    </div>
  );
};
