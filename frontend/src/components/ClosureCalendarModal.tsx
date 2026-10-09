import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, ChevronLeft, ChevronRight, Truck, Store, Info } from 'lucide-react';
import { useModalEscape } from '../services/keyboardShortcuts';

// Fixed-date national festivals are prefilled on their exact day, every year. Lunar festivals move yearly, so they are
// offered as name templates only — no date is ever assumed for them (owner rule, same as Settings → Order Timing).
const FIXED_FESTIVALS: Record<string, string> = {
  '01-01': 'New Year', '01-14': 'Makar Sankranti', '01-26': 'Republic Day', '04-14': 'Ambedkar Jayanti',
  '05-01': 'Maharashtra Day', '08-15': 'Independence Day', '10-02': 'Gandhi Jayanti', '12-25': 'Christmas'
};
const LUNAR_FESTIVALS = ['Diwali', 'Dhanteras', 'Bhai Dooj', 'Holi', 'Dussehra', 'Navratri', 'Ganesh Chaturthi', 'Raksha Bandhan',
  'Janmashtami', 'Maha Shivratri', 'Ram Navami', 'Eid-ul-Fitr', 'Eid-ul-Adha', 'Muharram', 'Guru Nanak Jayanti', 'Good Friday'];

const WEEK_DAYS = ['None', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
  isOpen, onClose, marketDates, storeDates, weeklyOff, occasions, onSaveOccasion, onToggleMarket, onToggleStore, onWeeklyOffChange
}) => {
  const [view, setView] = useState(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() }; });
  const [selected, setSelected] = useState<string>('');
  const [festivalName, setFestivalName] = useState<string>('');

  const marketSet = useMemo(() => new Set(marketDates), [marketDates]);
  const storeSet = useMemo(() => new Set(storeDates), [storeDates]);

  useModalEscape(isOpen, onClose);

  if (!isOpen) return null;

  const first = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const now = new Date();
  const todayStr = toYmd(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (delta: number) => setView(v => { const dt = new Date(v.y, v.m + delta, 1); return { y: dt.getFullYear(), m: dt.getMonth() }; });
  const monthLabel = new Date(view.y, view.m, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  const isSunday = (ymd: string) => new Date(`${ymd}T12:00:00`).getDay() === 0;
  const festivalOf = (ymd: string) => occasions[ymd] || FIXED_FESTIVALS[ymd.slice(5)] || '';
  const marketClosed = (ymd: string) => isSunday(ymd) || marketSet.has(ymd);
  const storeClosed = (ymd: string) => storeSet.has(ymd);

  const pick = (ymd: string) => {
    setSelected(ymd);
    setFestivalName(festivalOf(ymd));
  };

  const selMarket = selected ? marketClosed(selected) : false;
  const selStore = selected ? storeClosed(selected) : false;
  const selSunday = selected ? isSunday(selected) : false;

  const monthMarketCount = cells.filter((d): d is number => d !== null && marketClosed(toYmd(view.y, view.m, d))).length;
  const monthStoreCount = cells.filter((d): d is number => d !== null && storeClosed(toYmd(view.y, view.m, d))).length;

  return createPortal(
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 p-4">
      <div className="bg-bg border border-border w-[95vw] max-w-xl rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-border/40 flex items-center justify-between bg-bg2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary"><Calendar size={20} /></div>
            <div>
              <h2 className="text-base font-bold text-text">Market &amp; Store Calendar</h2>
              <p className="text-xs text-muted">Sundays are market-closed automatically. Tap a date to change it.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 cursor-pointer" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto min-h-0">
          <div className="flex items-center justify-between gap-2 flex-wrap bg-bg2/40 p-2 rounded-xl border border-glass-border/40">
            <span className="text-[10px] font-black uppercase tracking-wider text-muted">Store weekly off</span>
            <div className="flex items-center gap-1 flex-wrap">
              {WEEK_DAYS.map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => onWeeklyOffChange(day)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-black cursor-pointer ${
                    weeklyOff.toLowerCase() === day.toLowerCase() ? 'bg-primary text-white' : 'bg-bg border border-border text-text hover:bg-bg3'
                  }`}
                >
                  {day === 'None' ? 'None' : day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between px-1">
            <button type="button" onClick={() => shift(-1)} className="p-1.5 rounded-lg bg-bg border border-border hover:bg-bg2 text-muted cursor-pointer" title="Previous month"><ChevronLeft size={14} /></button>
            <div className="text-sm font-black text-text">{monthLabel}</div>
            <button type="button" onClick={() => shift(1)} className="p-1.5 rounded-lg bg-bg border border-border hover:bg-bg2 text-muted cursor-pointer" title="Next month"><ChevronRight size={14} /></button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-muted">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (d === null) return <div key={`b${i}`} />;
              const ymd = toYmd(view.y, view.m, d);
              const mk = marketClosed(ymd);
              const st = storeClosed(ymd);
              const fest = festivalOf(ymd);
              const base = st
                ? 'bg-rose-500/20 border-rose-400/60 text-rose-500'
                : mk
                  ? 'bg-amber-500/15 border-amber-400/50 text-amber-500'
                  : fest
                    ? 'bg-purple-500/15 border-purple-400/40 text-purple-500'
                    : 'bg-bg border-border text-text hover:bg-bg3';
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => pick(ymd)}
                  title={[fest, mk ? 'Market closed' : '', st ? 'Store closed' : ''].filter(Boolean).join(' • ') || 'Open'}
                  className={`relative h-12 rounded-lg border text-xs font-bold flex flex-col items-center justify-center cursor-pointer ${base} ${
                    selected === ymd ? 'ring-2 ring-primary' : ''
                  } ${ymd === todayStr ? 'underline underline-offset-2' : ''}`}
                >
                  <span>{d}</span>
                  {fest && <span className="max-w-full px-0.5 truncate text-[8px] font-semibold leading-none">{fest}</span>}
                  <span className="flex gap-0.5 mt-0.5">
                    {mk && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                    {st && <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />}
                    {!mk && !st && fest && <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Market closed</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />Store closed</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" />Festival (tap to choose)</span>
            <span className="ml-auto">This month: {monthMarketCount} market · {monthStoreCount} store</span>
          </div>

          {selected ? (
            <div className="rounded-xl border border-border bg-bg2 p-3 space-y-2.5">
              <div className="text-xs font-black text-text">
                {new Date(`${selected}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                {festivalOf(selected) && <span className="ml-2 px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500 text-[10px]">{festivalOf(selected)}</span>}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted">Occasion (optional — pick a festival or type)</label>
                <input
                  type="text"
                  value={festivalName}
                  onChange={e => setFestivalName(e.target.value)}
                  onBlur={() => onSaveOccasion(selected, festivalName)}
                  placeholder="e.g. Diwali"
                  className="w-full bg-bg border border-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                />
                <div className="flex flex-wrap gap-1">
                  {LUNAR_FESTIVALS.map(f => (
                    <button key={f} type="button" onClick={() => { setFestivalName(f); onSaveOccasion(selected, f); }}
                      className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${festivalName === f ? 'bg-primary text-white border-primary' : 'bg-bg border-border text-muted hover:text-text'}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={selSunday}
                  onClick={() => onToggleMarket(selected, !selMarket, festivalName.trim() || festivalOf(selected) || 'Market Holiday')}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer disabled:cursor-not-allowed ${selMarket ? 'border-amber-500/60 bg-amber-500/10 text-amber-500' : 'border-border bg-bg text-muted hover:text-text'}`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold"><Truck size={14} />{selMarket ? 'Market closed' : 'Market open'}</div>
                  <div className="text-[10px] opacity-80 mt-0.5">{selSunday ? 'Every Sunday — automatic' : 'Tap to ' + (selMarket ? 'reopen market' : 'mark market closed')}</div>
                </button>
                <button
                  type="button"
                  onClick={() => onToggleStore(selected, !selStore)}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer ${selStore ? 'border-rose-500/60 bg-rose-500/10 text-rose-500' : 'border-border bg-bg text-muted hover:text-text'}`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold"><Store size={14} />{selStore ? 'Store closed' : 'Store open'}</div>
                  <div className="text-[10px] opacity-80 mt-0.5">Tap to {selStore ? 'reopen store' : 'mark store closed'}</div>
                </button>
              </div>

              <div className="flex items-start gap-1.5 text-[11px] text-muted">
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>
                  {selMarket && !selStore && 'Store stays open: customers can still order and pick up at the counter. Distributor stock will not arrive; there is no home delivery.'}
                  {selMarket && selStore && 'Market and store are both closed on this day.'}
                  {!selMarket && selStore && 'Store is closed; the market is open, so distributor orders still go out.'}
                  {!selMarket && !selStore && 'Normal working day.'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted text-center py-1">Select a date to mark market or store closed.</p>
          )}
        </div>

        <div className="p-3 border-t border-border/40 bg-bg2 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-xl bg-primary text-white text-xs font-bold cursor-pointer">Done</button>
        </div>
      </div>
    </div>,
    document.body
  );
};
