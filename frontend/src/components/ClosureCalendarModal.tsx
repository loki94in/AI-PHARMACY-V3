import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, ChevronLeft, ChevronRight, Truck, Store, Info, Sparkles, Check } from 'lucide-react';
import { useModalEscape } from '../services/keyboardShortcuts';
import { FIXED_FESTIVALS, LUNAR_FESTIVALS, WEEK_DAYS, getHolidayName } from '../utils/indianHolidays';

const pad2 = (n: number) => String(n).padStart(2, '0');
const toYmd = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

interface ClosureCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  marketDates: string[];
  storeDates: string[];
  weeklyOff: string;
  occasions: Record<string, string>;
  onSaveOccasion: (date: string, name: string) => void;
  onToggleMarket: (date: string, on: boolean, reason: string) => void;
  onToggleStore: (date: string, on: boolean) => void;
  onWeeklyOffChange: (day: string) => void;
}

export const ClosureCalendarModal: React.FC<ClosureCalendarModalProps> = ({
  isOpen,
  onClose,
  marketDates,
  storeDates,
  weeklyOff,
  occasions,
  onSaveOccasion,
  onToggleMarket,
  onToggleStore,
  onWeeklyOffChange,
}) => {
  const [view, setView] = useState(() => {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() };
  });
  const [selected, setSelected] = useState<string>('');
  const [festivalName, setFestivalName] = useState<string>('');

  const marketSet = useMemo(() => new Set(marketDates), [marketDates]);
  const storeSet = useMemo(() => new Set(storeDates), [storeDates]);

  useModalEscape(isOpen, onClose);

  if (!isOpen) return null;

  const first = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(first).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const now = new Date();
  const todayStr = toYmd(now.getFullYear(), now.getMonth(), now.getDate());

  const shift = (delta: number) =>
    setView((v) => {
      const dt = new Date(v.y, v.m + delta, 1);
      return { y: dt.getFullYear(), m: dt.getMonth() };
    });

  const jumpToTodayMonth = () => {
    const t = new Date();
    setView({ y: t.getFullYear(), m: t.getMonth() });
    setSelected(todayStr);
    setFestivalName(getHolidayName(todayStr, occasions));
  };

  const monthLabel = new Date(view.y, view.m, 1).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const isSunday = (ymd: string) => new Date(`${ymd}T12:00:00`).getDay() === 0;
  const festivalOf = (ymd: string) => getHolidayName(ymd, occasions);
  const marketClosed = (ymd: string) => isSunday(ymd) || marketSet.has(ymd);
  const storeClosed = (ymd: string) => storeSet.has(ymd);

  const pick = (ymd: string) => {
    setSelected(ymd);
    setFestivalName(festivalOf(ymd));
  };

  const selMarket = selected ? marketClosed(selected) : false;
  const selStore = selected ? storeClosed(selected) : false;
  const selSunday = selected ? isSunday(selected) : false;

  const monthMarketCount = cells.filter(
    (d): d is number => d !== null && marketClosed(toYmd(view.y, view.m, d))
  ).length;
  const monthStoreCount = cells.filter(
    (d): d is number => d !== null && storeClosed(toYmd(view.y, view.m, d))
  ).length;

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 p-4">
      <div className="bg-bg border border-border w-[96vw] max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in duration-150">
        {/* Header Bar */}
        <div className="p-4 border-b border-border/60 flex items-center justify-between bg-bg2 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/15 text-primary shadow-2xs">
              <Calendar size={20} />
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight text-text">
                Market &amp; Store Calendar
              </h2>
              <p className="text-xs text-muted">
                Sundays are market-closed automatically. Tap any date to configure.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-text hover:bg-bg3 cursor-pointer transition-transform duration-100 active:scale-95"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 space-y-3.5 overflow-y-auto min-h-0">
          {/* Store Weekly Off - Tactile Segmented Pill Strip */}
          <div className="bg-bg2 p-2.5 rounded-xl border border-border/70 space-y-1.5 shadow-2xs">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-muted">
                Store Weekly Off Day
              </span>
              <span className="text-[10px] text-muted">
                Active: <strong className="text-text">{weeklyOff}</strong>
              </span>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-0.5">
              {WEEK_DAYS.map((day) => {
                const isActive = weeklyOff.toLowerCase() === day.toLowerCase();
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => onWeeklyOffChange(day)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-all duration-100 active:scale-95 ${
                      isActive
                        ? 'bg-primary text-white shadow-2xs'
                        : 'bg-bg border border-border/80 text-muted hover:text-text hover:bg-bg3'
                    }`}
                  >
                    {day === 'None' ? 'None' : day.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Month Navigator */}
          <div className="flex items-center justify-between px-1 bg-bg2/40 py-1.5 rounded-xl border border-border/40">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="p-1.5 rounded-lg bg-bg border border-border hover:bg-bg3 text-text cursor-pointer transition-transform duration-100 active:scale-95"
              title="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black tracking-tight text-text">
                {monthLabel}
              </span>
              {(view.y !== now.getFullYear() || view.m !== now.getMonth()) && (
                <button
                  type="button"
                  onClick={jumpToTodayMonth}
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 cursor-pointer active:scale-95"
                >
                  This Month
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => shift(1)}
              className="p-1.5 rounded-lg bg-bg border border-border hover:bg-bg3 text-text cursor-pointer transition-transform duration-100 active:scale-95"
              title="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Weekday Labels */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-wider text-muted px-0.5">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
              <div key={d} className={i === 0 ? 'text-amber-500' : ''}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar Grid Cells */}
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((d, i) => {
              if (d === null) return <div key={`empty-${i}`} className="h-12" />;
              const ymd = toYmd(view.y, view.m, d);
              const mk = marketClosed(ymd);
              const st = storeClosed(ymd);
              const fest = festivalOf(ymd);
              const isToday = ymd === todayStr;
              const isSelected = selected === ymd;

              let cellStyle = 'bg-bg border-border text-text hover:bg-bg2';
              if (st && mk) {
                cellStyle = 'bg-rose-500/15 border-rose-400/60 text-rose-500';
              } else if (st) {
                cellStyle = 'bg-rose-500/10 border-rose-400/50 text-rose-500';
              } else if (mk) {
                cellStyle = 'bg-amber-500/10 border-amber-400/50 text-amber-500';
              } else if (fest) {
                cellStyle = 'bg-purple-500/10 border-purple-400/40 text-purple-500';
              }

              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => pick(ymd)}
                  title={[fest, mk ? 'Market closed' : '', st ? 'Store closed' : ''].filter(Boolean).join(' • ') || 'Normal Working Day'}
                  className={`relative h-13 rounded-xl border text-xs font-bold flex flex-col items-center justify-between p-1 cursor-pointer transition-all duration-100 active:scale-95 ${cellStyle} ${
                    isSelected ? 'ring-2 ring-primary border-primary shadow-sm' : ''
                  }`}
                >
                  <div className="flex items-center justify-between w-full leading-none">
                    <span className={`text-[11px] font-black ${isToday ? 'px-1 rounded bg-sky-500 text-white' : ''}`}>
                      {d}
                    </span>
                    {isToday && !isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-500" title="Today" />
                    )}
                  </div>

                  {fest && (
                    <span className="w-full truncate text-[8px] font-semibold leading-tight text-center px-0.5">
                      {fest}
                    </span>
                  )}

                  {/* Status Badges on Cell Footer */}
                  <div className="flex items-center gap-1 justify-center w-full mt-auto">
                    {mk && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Market Closed" />
                    )}
                    {st && (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" title="Store Closed" />
                    )}
                    {!mk && !st && fest && (
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-500" title="Festival Day" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted px-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Market closed</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>Store closed</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              <span>Festival / Holiday</span>
            </span>
            <span className="ml-auto font-bold text-text">
              Month totals: {monthMarketCount} market pauses · {monthStoreCount} store offs
            </span>
          </div>

          {/* Selected Date Inspector Surface */}
          {selected ? (
            <div className="rounded-2xl border border-border bg-bg2 p-3.5 space-y-3 shadow-sm animate-in fade-in duration-100">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black text-text">
                  {new Date(`${selected}T12:00:00`).toLocaleDateString('en-IN', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </div>
                {festivalOf(selected) && (
                  <span className="px-2 py-0.5 rounded-lg bg-purple-500/15 text-purple-600 border border-purple-400/30 text-[10px] font-bold">
                    {festivalOf(selected)}
                  </span>
                )}
              </div>

              {/* Occasion / Festival Selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-muted flex items-center gap-1">
                  <Sparkles size={11} className="text-purple-500" />
                  <span>Occasion / Festival (Optional)</span>
                </label>
                <input
                  type="text"
                  value={festivalName}
                  onChange={(e) => setFestivalName(e.target.value)}
                  onBlur={() => onSaveOccasion(selected, festivalName)}
                  placeholder="Type occasion name (e.g. Diwali, Holi) or select below"
                  className="w-full bg-bg border border-border rounded-xl px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary shadow-2xs"
                />
                <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto pt-0.5">
                  {LUNAR_FESTIVALS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setFestivalName(f);
                        onSaveOccasion(selected, f);
                      }}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border cursor-pointer transition-all duration-100 active:scale-95 ${
                        festivalName === f
                          ? 'bg-primary text-white border-primary shadow-2xs'
                          : 'bg-bg border-border text-muted hover:text-text hover:bg-bg3'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Orthogonal Operation Switches */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                {/* Switch 1: Market / Distributor Dispatch */}
                <button
                  type="button"
                  disabled={selSunday}
                  onClick={() =>
                    onToggleMarket(
                      selected,
                      !selMarket,
                      festivalName.trim() || festivalOf(selected) || 'Market Holiday'
                    )
                  }
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all duration-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-85 ${
                    selMarket
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-500 shadow-2xs'
                      : 'border-border bg-bg text-muted hover:text-text hover:bg-bg3'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-black">
                      <Truck size={15} />
                      <span>{selMarket ? 'Market Closed' : 'Market Open'}</span>
                    </div>
                    {selMarket && <Check size={14} className="text-amber-500" />}
                  </div>
                  <div className="text-[10px] opacity-80 mt-1 leading-snug">
                    {selSunday
                      ? 'Every Sunday — Automatic Market Pause'
                      : selMarket
                        ? 'Distributor dispatches paused; tap to open'
                        : 'Wholesale dispatches active; tap to pause'}
                  </div>
                </button>

                {/* Switch 2: Store Counter Operations */}
                <button
                  type="button"
                  onClick={() => onToggleStore(selected, !selStore)}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all duration-100 active:scale-95 ${
                    selStore
                      ? 'border-rose-500/60 bg-rose-500/10 text-rose-500 shadow-2xs'
                      : 'border-border bg-bg text-muted hover:text-text hover:bg-bg3'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-black">
                      <Store size={15} />
                      <span>{selStore ? 'Store Closed' : 'Store Open'}</span>
                    </div>
                    {selStore && <Check size={14} className="text-rose-500" />}
                  </div>
                  <div className="text-[10px] opacity-80 mt-1 leading-snug">
                    {selStore
                      ? 'Physical counter shut; tap to open'
                      : 'Walk-ins & counter active; tap to shut'}
                  </div>
                </button>
              </div>

              {/* Contextual Real-World Explanation */}
              <div className="flex items-start gap-2 text-[11px] text-muted bg-bg p-2.5 rounded-xl border border-border/60">
                <Info size={14} className="shrink-0 text-primary mt-0.5" />
                <span className="leading-snug">
                  {selMarket && !selStore && (
                    <>
                      <strong>Market closed, store open:</strong> Counter POS &amp; walk-in pickups operate normally. Distributor deliveries will not arrive on this day.
                    </>
                  )}
                  {selMarket && selStore && (
                    <>
                      <strong>Full closure:</strong> Both the distributor wholesale market and your pharmacy counter are completely closed.
                    </>
                  )}
                  {!selMarket && selStore && (
                    <>
                      <strong>Store counter closed:</strong> Walk-in sales are off, but wholesale distributor dispatches remain active.
                    </>
                  )}
                  {!selMarket && !selStore && (
                    <>
                      <strong>Normal operating day:</strong> Both wholesale distributor deliveries and retail store counter are fully operational.
                    </>
                  )}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted text-center py-2 bg-bg2/40 rounded-xl border border-border/40">
              Select any date above to view or adjust Market and Store operating status.
            </p>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 border-t border-border/60 bg-bg2 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-primary text-white text-xs font-black cursor-pointer shadow-2xs transition-transform duration-100 active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
