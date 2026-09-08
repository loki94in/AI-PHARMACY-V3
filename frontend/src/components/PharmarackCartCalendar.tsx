import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Clock, Pause, ChevronLeft, ChevronRight, ShoppingCart, Send, Store, Calendar, X, ChevronDown, Truck } from 'lucide-react';
import { api, apiClient } from '../services/api';
import { toastEvent } from '../services/events';
import { useStore } from '../context/StoreContext';

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

  // Timer Pacing state (seconds)
  const [timerSec, setTimerSec] = useState<number>(10);

  // Pharmacy Operating Hours, Weekly Off Day & Delivery Timetable state
  const [shopWeeklyOff, setShopWeeklyOff] = useState<string>('Monday');
  const [shopOpenTime, setShopOpenTime] = useState<string>('09:00');
  const [shopCloseTime, setShopCloseTime] = useState<string>('22:00');
  const [cutoffTime, setCutoffTime] = useState<string>('23:00');
  const [deliveryStart, setDeliveryStart] = useState<string>('19:00');
  const [deliveryEnd, setDeliveryEnd] = useState<string>('21:00');
  const [pharmacyClosedDates, setPharmacyClosedDates] = useState<string[]>([]);

  // Month Calendar Popover State
  const [isCalendarOpen, setIsCalendarOpen] = useState<boolean>(false);
  const calendarPopoverRef = useRef<HTMLDivElement>(null);
  const [calendarViewDate, setCalendarViewDate] = useState<Date>(() => new Date());

  // Click outside listener for calendar popover
  useEffect(() => {
    if (!isCalendarOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (calendarPopoverRef.current && !calendarPopoverRef.current.contains(e.target as Node)) {
        setIsCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCalendarOpen]);

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
          if (res.data.pharmacy_weekly_off) setShopWeeklyOff(res.data.pharmacy_weekly_off);
          if (res.data.pharmacy_open_time) setShopOpenTime(res.data.pharmacy_open_time);
          if (res.data.pharmacy_close_time) setShopCloseTime(res.data.pharmacy_close_time);
          if (res.data.pharmacy_cutoff_time || res.data.order_cutoff_time) {
            setCutoffTime(res.data.pharmacy_cutoff_time || res.data.order_cutoff_time);
          }
          if (res.data.delivery_window_start) setDeliveryStart(res.data.delivery_window_start);
          if (res.data.delivery_window_end) setDeliveryEnd(res.data.delivery_window_end);
          if (res.data.pharmacy_closed_dates) {
            try {
              setPharmacyClosedDates(JSON.parse(res.data.pharmacy_closed_dates));
            } catch (_) {}
          }
        }
      } catch (_) {}
    })();
    return () => { mounted = false; };
  }, []);

  // Save paused dates to localStorage & backend
  const updatePausedDates = (newDates: string[]) => {
    setPausedDates(newDates);
    try {
      localStorage.setItem('pharmarack_paused_dispatch_dates', JSON.stringify(newDates));
    } catch (_) {}

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

  const toggleCustomClosedDate = (dateStr: string) => {
    let updated: string[];
    const isCurrentlyClosed = pharmacyClosedDates.includes(dateStr);
    if (isCurrentlyClosed) {
      updated = pharmacyClosedDates.filter(d => d !== dateStr);
    } else {
      updated = [...pharmacyClosedDates, dateStr].sort();
    }
    setPharmacyClosedDates(updated);
    apiClient.post('/settings/save', {
      pharmacy_closed_dates: JSON.stringify(updated)
    }).then(() => {
      toastEvent.trigger(
        isCurrentlyClosed ? `Reopened shop on ${dateStr}` : `Marked shop closed on ${dateStr}`,
        'info'
      );
    }).catch(() => {});
  };

  const clearAllCustomClosedDates = () => {
    setPharmacyClosedDates([]);
    apiClient.post('/settings/save', {
      pharmacy_closed_dates: JSON.stringify([])
    }).then(() => {
      toastEvent.trigger('Cleared all custom shop closed dates', 'info');
    }).catch(() => {});
  };

  const handlePrevMonth = () => {
    setCalendarViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };
  const handleNextMonth = () => {
    setCalendarViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };
  const handleTodayMonth = () => {
    setCalendarViewDate(new Date());
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
    }
  };

  const handleTimerChange = (sec: number) => {
    setTimerSec(sec);
    localStorage.setItem('pharmarack_cart_timer_sec', String(sec));
    toastEvent.trigger(`Auto-send delay set to ${sec}s per order`, 'info');
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
              {[1, 5, 10, 30, 60].map(sec => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => handleTimerChange(sec)}
                  className={`px-1.5 py-0.5 rounded-md text-[9px] font-black transition-all cursor-pointer ${
                    timerSec === sec
                      ? 'bg-transparent text-sky-600 border border-sky-400/80 shadow-2xs'
                      : 'text-muted hover:text-text hover:bg-bg3 border border-transparent'
                  }`}
                  title={`Set auto-send delay timer to ${sec}s`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

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

          {/* Shop Off Calendar Popover Trigger */}
          <div className="relative" ref={calendarPopoverRef}>
            <div className="flex items-center gap-1.5">
              <Store size={13} className="text-emerald-600 shrink-0" />
              <span className="text-[11px] font-bold text-muted">Shop Off:</span>
              <button
                type="button"
                onClick={() => setIsCalendarOpen(prev => !prev)}
                className={`flex items-center gap-1.5 bg-bg border rounded-lg px-2 py-0.5 text-[11px] font-bold text-text hover:border-primary/50 transition-all cursor-pointer shadow-2xs ${
                  isCalendarOpen ? 'border-primary ring-1 ring-primary/30' : 'border-border'
                }`}
                title="Click to open calendar and configure Shop Off Days & Holidays"
              >
                <Calendar size={11} className="text-emerald-600 shrink-0" />
                <span>{shopWeeklyOff}</span>
                {pharmacyClosedDates.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-rose-500/15 text-rose-600 border border-rose-500/30">
                    +{pharmacyClosedDates.length}
                  </span>
                )}
                <ChevronDown size={11} className={`text-muted transition-transform duration-150 ${isCalendarOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {/* Interactive Month Calendar Popover */}
            {isCalendarOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-50 w-[310px] sm:w-[340px] bg-bg border border-border rounded-2xl shadow-xl p-3.5 space-y-3 backdrop-blur-md">
                {/* Header with Title & Close button */}
                <div className="flex items-center justify-between pb-1.5 border-b border-glass-border/40">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={14} className="text-primary" />
                    <span className="text-xs font-bold text-text">Pharmacy Schedule & Off Days</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCalendarOpen(false)}
                    className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg2 transition-all cursor-pointer"
                    title="Close Calendar"
                  >
                    <X size={13} />
                  </button>
                </div>

                {/* Month Navigator */}
                <div className="flex items-center justify-between px-1">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="p-1 rounded-lg bg-bg border border-border hover:bg-bg2 text-muted hover:text-text transition-all cursor-pointer shadow-2xs"
                    title="Previous Month"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-text">
                      {calendarViewDate.toLocaleDateString('en-IN', { month: 'long' })} {calendarViewDate.getFullYear()}
                    </span>
                    <button
                      type="button"
                      onClick={handleTodayMonth}
                      className="px-1.5 py-0.2 text-[9px] font-bold rounded-md bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 border border-sky-400/40 transition-all cursor-pointer"
                      title="Jump to current month"
                    >
                      Today
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="p-1 rounded-lg bg-bg border border-border hover:bg-bg2 text-muted hover:text-text transition-all cursor-pointer shadow-2xs"
                    title="Next Month"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>

                {/* Section 1: Recurring Weekly Off Day Selector */}
                <div className="space-y-1.5 bg-bg2/40 p-2 rounded-xl border border-glass-border/40">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">
                      Recurring Weekly Off
                    </span>
                    <span className="text-[9px] font-bold text-muted/80">
                      {shopWeeklyOff === 'None' ? 'No weekly off' : `Every ${shopWeeklyOff}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {['None', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(dayShort => {
                      const dayFullMap: Record<string, string> = {
                        None: 'None',
                        Sun: 'Sunday',
                        Mon: 'Monday',
                        Tue: 'Tuesday',
                        Wed: 'Wednesday',
                        Thu: 'Thursday',
                        Fri: 'Friday',
                        Sat: 'Saturday'
                      };
                      const dayFull = dayFullMap[dayShort];
                      const isSelected = shopWeeklyOff.toLowerCase() === dayFull.toLowerCase();

                      return (
                        <button
                          key={dayShort}
                          type="button"
                          onClick={() => handleShopWeeklyOffChange(dayFull)}
                          className={`flex-1 min-w-[32px] py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer text-center ${
                            isSelected
                              ? 'bg-red-600 text-white shadow-xs'
                              : 'bg-bg hover:bg-bg3 text-text border border-border/70 hover:border-border'
                          }`}
                        >
                          {dayShort}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Section 2: Interactive Month Grid */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted">
                      Specific Closed Dates
                    </span>
                    <span className="text-[9px] text-muted italic">Click date to toggle</span>
                  </div>

                  {/* Days of Week Header */}
                  <div className="grid grid-cols-7 gap-1 text-center font-black">
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((dw, idx) => (
                      <div
                        key={dw}
                        className={`text-[10px] py-0.5 ${idx === 0 ? 'text-red-600' : 'text-muted'}`}
                      >
                        {dw}
                      </div>
                    ))}
                  </div>

                  {/* Month Day Cells */}
                  <div className="grid grid-cols-7 gap-1">
                    {/* Leading blank slots */}
                    {Array.from({ length: new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth(), 1).getDay() }).map((_, i) => (
                      <div key={`blank-${i}`} className="h-7" />
                    ))}

                    {/* Days in Month */}
                    {Array.from({ length: new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + 1, 0).getDate() }, (_, i) => i + 1).map(d => {
                      const yr = calendarViewDate.getFullYear();
                      const mo = calendarViewDate.getMonth();
                      const dateStr = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const dayDate = new Date(yr, mo, d);
                      const dayOfWeekName = dayDate.toLocaleDateString('en-US', { weekday: 'long' });
                      const isWeeklyOff = shopWeeklyOff.toLowerCase() !== 'none' && dayOfWeekName.toLowerCase() === shopWeeklyOff.toLowerCase();
                      const isCustomClosed = pharmacyClosedDates.includes(dateStr);
                      const holidayName = INDIAN_HOLIDAYS[dateStr];
                      const isSunday = dayDate.getDay() === 0;
                      const now = new Date();
                      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                      const isToday = dateStr === todayStr;

                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleCustomClosedDate(dateStr)}
                          className={`
                            relative h-7 w-full rounded-lg text-[11px] font-bold flex flex-col items-center justify-center transition-all cursor-pointer select-none
                            ${isCustomClosed
                              ? 'bg-red-600 text-white font-black shadow-xs ring-1 ring-red-400'
                              : isWeeklyOff
                                ? 'bg-red-500/15 text-red-600 border border-red-400/40 font-black'
                                : holidayName
                                  ? 'bg-purple-500/15 text-purple-600 border border-purple-400/40 font-extrabold'
                                  : isToday
                                    ? 'bg-sky-500/15 text-sky-700 border border-sky-400 font-black ring-1 ring-sky-400/50'
                                    : isSunday
                                      ? 'text-red-600 hover:bg-bg3 border border-transparent'
                                      : 'text-text hover:bg-bg3 border border-transparent'
                            }
                            hover:scale-105 active:scale-95
                          `}
                          title={`${d} ${calendarViewDate.toLocaleDateString('en-IN', { month: 'short' })} ${yr}${
                            isCustomClosed ? ' • Marked Closed (Click to reopen)' :
                            isWeeklyOff ? ' • Recurring Weekly Off (Click to toggle custom off)' :
                            holidayName ? ` • Holiday: ${holidayName} (Click to mark closed)` :
                            ' • Open (Click to mark closed)'
                          }`}
                        >
                          <span>{d}</span>
                          <div className="absolute bottom-0.5 flex items-center justify-center gap-0.5 leading-none">
                            {isCustomClosed && (
                              <span className="w-1 h-1 rounded-full bg-red-100 inline-block"></span>
                            )}
                            {!isCustomClosed && holidayName && (
                              <span className="w-1 h-1 rounded-full bg-purple-500 inline-block"></span>
                            )}
                            {!isCustomClosed && isWeeklyOff && (
                              <span className="w-1 h-1 rounded-full bg-red-500 inline-block"></span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Popover Footer: Legend & Actions */}
                <div className="pt-2 border-t border-glass-border/40 space-y-2">
                  <div className="flex items-center justify-between text-[10px] text-muted flex-wrap gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-xs bg-red-500/20 border border-red-400 inline-block"></span>
                        <span>Weekly Off</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-xs bg-red-600 inline-block"></span>
                        <span className="font-semibold text-red-600">Custom Closed</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-xs bg-purple-500/20 border border-purple-400 inline-block"></span>
                        <span>Holiday</span>
                      </span>
                    </div>
                    {pharmacyClosedDates.length > 0 && (
                      <button
                        type="button"
                        onClick={clearAllCustomClosedDates}
                        className="text-[10px] font-bold text-red-600 hover:text-red-700 underline cursor-pointer"
                      >
                        Clear ({pharmacyClosedDates.length})
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-muted italic">
                      Closed days sync with order auto-dispatch
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCalendarOpen(false)}
                      className="px-3 py-1 bg-primary text-white text-[11px] font-bold rounded-lg hover:bg-primary/90 transition-all cursor-pointer shadow-2xs"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
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

    </div>
  );
};
