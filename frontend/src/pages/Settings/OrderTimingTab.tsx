import { createPortal } from 'react-dom';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, api } from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { broadcastContactDataChanged, updateSettingsCache } from '../../utils/settingsSync';
import { useModalEscape, shortcutEvent } from '../../services/keyboardShortcuts';
import { toastEvent } from '../../services/events';
import type { LocalApiError, StorageLocation, RegisteredDevice, PharmacyHolidayItem } from './settingsTypes';
import { Trash2, Save, RefreshCw, Clock, RotateCcw, X, Calendar } from 'lucide-react';

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

// Fixed-date national festivals are suggested on their exact day. Lunar festivals move every year, so they are
// offered as name templates only — no date is ever assumed for them.
const FIXED_FESTIVALS: Record<string, string> = {
  '01-01': 'New Year', '01-14': 'Makar Sankranti', '01-26': 'Republic Day', '04-14': 'Ambedkar Jayanti',
  '05-01': 'Maharashtra Day', '08-15': 'Independence Day', '10-02': 'Gandhi Jayanti', '12-25': 'Christmas'
};
const FESTIVAL_TEMPLATES = ['Diwali', 'Dhanteras', 'Bhai Dooj', 'Holi', 'Dussehra', 'Navratri', 'Ganesh Chaturthi', 'Raksha Bandhan',
  'Janmashtami', 'Maha Shivratri', 'Ram Navami', 'Eid-ul-Fitr', 'Eid-ul-Adha', 'Muharram', 'Guru Nanak Jayanti', 'Mahavir Jayanti',
  'Good Friday', 'Buddha Purnima', 'Onam', 'Pongal', 'Gudi Padwa', 'Chhath Puja'];
const REASON_TEMPLATES = ['Personal leave', 'Family function', 'Stock taking', 'Shop maintenance', 'Staff unavailable', 'Not well', 'Local bandh / strike'];

// Month grid where every click toggles a date; Sundays are tinted for quick bulk picking.
function MultiDatePicker({ selected, onChange, onPick, marked }: { selected: string[]; onChange: (dates: string[]) => void; onPick?: (date: string) => void; marked?: Set<string> }) {
  const [view, setView] = useState(() => {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() };
  });
  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const toggle = (d: number) => {
    const k = ymd(view.y, view.m, d);
    if (onPick) { onPick(k); return; }
    onChange(selected.includes(k) ? selected.filter(x => x !== k) : [...selected, k].sort());
  };
  const allSundays = () => {
    const add: string[] = [];
    for (let d = 1; d <= days; d++) if (new Date(view.y, view.m, d).getDay() === 0) add.push(ymd(view.y, view.m, d));
    onChange(Array.from(new Set([...selected, ...add])).sort());
  };
  const shift = (delta: number) => setView(v => {
    const dt = new Date(v.y, v.m + delta, 1);
    return { y: dt.getFullYear(), m: dt.getMonth() };
  });
  const label = new Date(view.y, view.m, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  return (
    <div className="bg-bg2 border border-border rounded-lg p-2">
      <div className="flex items-center justify-between mb-1.5 text-xs text-text">
        <button type="button" onClick={() => shift(-1)} className="px-2 py-0.5 rounded hover:bg-bg3">‹</button>
        <span className="font-bold">{label}</span>
        <button type="button" onClick={() => shift(1)} className="px-2 py-0.5 rounded hover:bg-bg3">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted mb-0.5">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => d === null ? <div key={i} /> : (
          <button
            key={i}
            type="button"
            onClick={() => toggle(d)}
            className={`py-1 text-[11px] rounded cursor-pointer ${
              selected.includes(ymd(view.y, view.m, d)) || marked?.has(ymd(view.y, view.m, d))
                ? 'bg-primary text-white font-bold'
                : 'text-text hover:bg-bg3'
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px]">
        <button type="button" onClick={allSundays} className="text-primary font-bold hover:underline">+ All Sundays this month</button>
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-muted hover:text-text">Clear</button>
        )}
      </div>
    </div>
  );
}

export function OrderTimingTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  // Form states
  const [cutoffTime, setCutoffTime] = useState(rawSettings.pharmacy_cutoff_time || '23:00');
  const [deliveryStart, setDeliveryStart] = useState(rawSettings.delivery_window_start || '19:00');
  const [deliveryEnd, setDeliveryEnd] = useState(rawSettings.delivery_window_end || '21:00');
  const [sundayEnabled, setSundayEnabled] = useState(rawSettings.sunday_orders_enabled === 'true');
  const [sundayStart, setSundayStart] = useState(rawSettings.sunday_window_start || '10:00');
  const [sundayEnd, setSundayEnd] = useState(rawSettings.sunday_window_end || '14:00');
  const [holidayDeliveryEnabled, setHolidayDeliveryEnabled] = useState(rawSettings.holiday_delivery_enabled === 'true');
  const [returnWindowDays, setReturnWindowDays] = useState(rawSettings.return_window_days || '15');
  const [refillPauseRecalc, setRefillPauseRecalc] = useState(rawSettings.refill_pause_recalculation_enabled !== 'false');

  // Holidays state
  const [holidays, setHolidays] = useState<PharmacyHolidayItem[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(false);
  const [showAddHoliday, setShowAddHoliday] = useState(false);
  const [holidayForm, setHolidayForm] = useState<{ name: string; dates: string[]; isClosed: boolean; customStart: string; customEnd: string }>({
    name: '',
    dates: [],
    isClosed: true,
    customStart: '10:00',
    customEnd: '14:00'
  });
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [deletingHolidayId, setDeletingHolidayId] = useState<number | null>(null);

  const fetchHolidays = useCallback(async () => {
    setLoadingHolidays(true);
    try {
      const res = await apiClient.get('/settings/holidays');
      if (res?.data?.holidays) {
        setHolidays(res.data.holidays);
      }
    } catch (err: any) {
      console.error('Failed to load holidays:', err);
    } finally {
      setLoadingHolidays(false);
    }
  }, []);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const handleSaveTimingSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        pharmacy_cutoff_time: cutoffTime,
        delivery_window_start: deliveryStart,
        delivery_window_end: deliveryEnd,
        sunday_orders_enabled: sundayEnabled ? 'true' : 'false',
        sunday_window_start: sundayStart,
        sunday_window_end: sundayEnd,
        holiday_delivery_enabled: holidayDeliveryEnabled ? 'true' : 'false',
        return_window_days: returnWindowDays,
        refill_pause_recalculation_enabled: refillPauseRecalc ? 'true' : 'false'
      };

      await apiClient.post('/settings/save', payload);
      toastEvent.trigger('Fulfilment timing & order rules updated successfully', 'success');
      updateSettingsCache(queryClient, payload);
      refetchSettings();
    } catch (err: any) {
      toastEvent.trigger('Failed to save timing settings: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTimingSettingsRef = useRef(handleSaveTimingSettings);
  handleSaveTimingSettingsRef.current = handleSaveTimingSettings;

  useEffect(() => {
    return shortcutEvent.subscribeSave(() => {
      void handleSaveTimingSettingsRef.current();
    });
  }, []);

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayForm.name.trim() || holidayForm.dates.length === 0) {
      toastEvent.trigger('Holiday name and at least one date are required', 'error');
      return;
    }

    setSavingHoliday(true);
    try {
      await apiClient.post('/settings/holidays/bulk', {
        holiday_name: holidayForm.name.trim(),
        dates: holidayForm.dates,
        is_closed: holidayForm.isClosed,
        custom_window_start: holidayForm.isClosed ? null : holidayForm.customStart,
        custom_window_end: holidayForm.isClosed ? null : holidayForm.customEnd
      });

      toastEvent.trigger(`"${holidayForm.name}" saved for ${holidayForm.dates.length} date(s)`, 'success');
      setHolidayForm({ name: '', dates: [], isClosed: true, customStart: '10:00', customEnd: '14:00' });
      setShowAddHoliday(false);
      fetchHolidays();
    } catch (err: any) {
      toastEvent.trigger('Failed to add holiday: ' + (err?.response?.data?.error || err?.message || 'Unknown error'), 'error');
    } finally {
      setSavingHoliday(false);
    }
  };

  const handleDeleteHoliday = async (id: number, name: string) => {
    setDeletingHolidayId(id);
    try {
      await apiClient.delete(`/settings/holidays/${id}`);
      toastEvent.trigger(`Holiday "${name}" deleted`, 'info');
      setHolidays(prev => prev.filter(h => h.id !== id));
    } catch (err: any) {
      toastEvent.trigger('Failed to delete holiday: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      setDeletingHolidayId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Save Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <h2 className="text-base font-bold text-text flex items-center gap-2">
            <Clock size={18} className="text-primary" />
            Orders & Fulfilment Timing Engine
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Configure order cutoff times, daily delivery windows, Sunday/holiday scheduling shifts, and return policies.
          </p>
        </div>
        <button
          type="button"
          onClick={() => handleSaveTimingSettings()}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl shadow-sm hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          <span>{saving ? 'Saving...' : 'Save Timing Rules'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Cutoff & Daily Delivery Window */}
        <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Clock size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">Daily Order Cutoff & Delivery Windows</h3>
              <p className="text-[11px] text-muted">Authoritative server schedule for website, portal & store orders</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-bold text-text mb-1">
                Order Cutoff Time (24h format)
              </label>
              <input
                type="time"
                value={cutoffTime}
                onChange={(e) => setCutoffTime(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary"
              />
              <p className="text-[10px] text-muted mt-1">
                Default 23:00 (11:00 PM). Orders placed after this time automatically shift to the next operating day.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-text mb-1">
                  Delivery Window Start
                </label>
                <input
                  type="time"
                  value={deliveryStart}
                  onChange={(e) => setDeliveryStart(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-text mb-1">
                  Delivery Window End
                </label>
                <input
                  type="time"
                  value={deliveryEnd}
                  onChange={(e) => setDeliveryEnd(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted">
              Default 19:00 to 21:00 (7:00 PM – 9:00 PM). Calculated and broadcast on all order confirmations.
            </p>
          </div>
        </div>

        {/* Card 2: Sunday & Weekend Operations */}
        <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-sky/10 text-sky">
              <Calendar size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">Sunday Operating Rules</h3>
              <p className="text-[11px] text-muted">Handle Sunday closure or reduced delivery hours</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <label className="flex items-center gap-2.5 p-2.5 bg-bg border border-border rounded-xl cursor-pointer hover:bg-bg3/50 transition-all">
              <input
                type="checkbox"
                checked={sundayEnabled}
                onChange={(e) => setSundayEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <div className="text-xs">
                <span className="font-bold text-text">Open for Delivery on Sundays</span>
                <p className="text-[10px] text-muted">
                  {sundayEnabled
                    ? 'Deliveries are processed on Sundays using the window below.'
                    : 'Pharmacy is closed on Sundays. Sunday orders automatically shift to Monday.'}
                </p>
              </div>
            </label>

            {sundayEnabled && (
              <div className="grid grid-cols-2 gap-3 p-3 bg-bg border border-border rounded-xl">
                <div>
                  <label className="block text-[11px] font-bold text-text mb-1">
                    Sunday Window Start
                  </label>
                  <input
                    type="time"
                    value={sundayStart}
                    onChange={(e) => setSundayStart(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-text mb-1">
                    Sunday Window End
                  </label>
                  <input
                    type="time"
                    value={sundayEnd}
                    onChange={(e) => setSundayEnd(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}

            <label className="flex items-center gap-2.5 p-2.5 bg-bg border border-border rounded-xl cursor-pointer hover:bg-bg3/50 transition-all">
              <input
                type="checkbox"
                checked={holidayDeliveryEnabled}
                onChange={(e) => setHolidayDeliveryEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <div className="text-xs">
                <span className="font-bold text-text">Deliver on Pharmacy Holidays</span>
                <p className="text-[10px] text-muted">
                  {holidayDeliveryEnabled
                    ? 'Holidays allow delivery unless specifically marked closed in the calendar below.'
                    : 'All calendar holidays pause delivery and shift fulfilment to the next operating day.'}
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Card 3: Return Policy & Refill Auto-Pause Recalculation */}
        <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
              <RotateCcw size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">Return Window & Refill Recalculation</h3>
              <p className="text-[11px] text-muted">Post-delivery policy window and recurring prescription shifts</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-bold text-text mb-1">
                Return Window Duration (Days)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={returnWindowDays}
                  onChange={(e) => setReturnWindowDays(e.target.value)}
                  className="w-24 px-3 py-2 text-xs bg-bg border border-border rounded-xl text-text focus:outline-none focus:border-primary font-bold"
                />
                <span className="text-xs text-muted">Days from actual delivery confirmation timestamp</span>
              </div>
              <p className="text-[10px] text-muted mt-1">
                Standard: 15 days. Returns can be initiated up to {returnWindowDays} days after delivery. Staff override allows supervisor exceptions.
              </p>
            </div>

            <label className="flex items-center gap-2.5 p-2.5 bg-bg border border-border rounded-xl cursor-pointer hover:bg-bg3/50 transition-all">
              <input
                type="checkbox"
                checked={refillPauseRecalc}
                onChange={(e) => setRefillPauseRecalc(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <div className="text-xs">
                <span className="font-bold text-text">Refill Auto-Pause Recalculation</span>
                <p className="text-[10px] text-muted">
                  When a customer or doctor resumes a paused refill, automatically push next refill date by the paused duration, skipping closed Sundays & holidays.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Card 4: Pharmacy Holiday Calendar Management */}
        <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500">
                <Calendar size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text">Holiday Calendar</h3>
                <p className="text-[11px] text-muted">{holidays.length} scheduled holiday(s)</p>
              </div>
            </div>
          </div>

          <div className="max-w-xs">
            <p className="text-[10px] font-bold text-muted mb-1">Tap a date to mark it a holiday (market closed by default)</p>
            <MultiDatePicker
              selected={[]}
              onChange={() => {}}
              marked={new Set(holidays.map(h => h.holiday_date))}
              onPick={(date) => {
                setHolidayForm({ name: FIXED_FESTIVALS[date.slice(5)] || '', dates: [date], isClosed: true, customStart: '10:00', customEnd: '14:00' });
                setShowAddHoliday(true);
              }}
            />
          </div>

          {showAddHoliday && holidayForm.dates[0] && createPortal(
            <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAddHoliday(false)}>
              <form onSubmit={handleAddHoliday} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-bg2 border border-border rounded-2xl p-4 space-y-3 shadow-xl">
                <div className="flex items-center justify-between text-text">
                  <div>
                    <div className="text-sm font-bold">Mark holiday</div>
                    <div className="text-[11px] text-muted">📅 {new Date(holidayForm.dates[0] + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
                  </div>
                  <button type="button" onClick={() => setShowAddHoliday(false)} className="text-muted hover:text-text"><X size={16} /></button>
                </div>

                {FIXED_FESTIVALS[holidayForm.dates[0].slice(5)] && (
                  <div className="text-[11px] text-text">
                    Suggested for this date:{' '}
                    <button type="button" onClick={() => setHolidayForm({ ...holidayForm, name: FIXED_FESTIVALS[holidayForm.dates[0].slice(5)] })} className="px-2 py-0.5 rounded bg-primary text-white font-bold">
                      {FIXED_FESTIVALS[holidayForm.dates[0].slice(5)]}
                    </button>
                  </div>
                )}

                {[['Indian festivals', FESTIVAL_TEMPLATES], ['Other reason', REASON_TEMPLATES]].map(([title, list]) => (
                  <div key={title as string}>
                    <label className="block text-[10px] font-bold text-muted mb-1">{title as string}</label>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto dropdown-scroll">
                      {(list as string[]).map(f => (
                        <button key={f} type="button" onClick={() => setHolidayForm({ ...holidayForm, name: f })}
                          className={`px-2 py-0.5 rounded-full text-[11px] border ${holidayForm.name === f ? 'bg-primary text-white border-primary font-bold' : 'bg-bg3 text-text border-border hover:border-primary'}`}>
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <input
                  type="text"
                  placeholder="Or type your own reason"
                  value={holidayForm.name}
                  onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                  required
                />

                <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                  <input type="checkbox" checked={holidayForm.isClosed} onChange={(e) => setHolidayForm({ ...holidayForm, isClosed: e.target.checked })} className="w-3.5 h-3.5 rounded text-primary" />
                  <span>Market closed all day (no deliveries)</span>
                </label>
                {!holidayForm.isClosed && (
                  <div className="flex items-center gap-2 text-xs text-text">
                    <span>Open</span>
                    <input type="time" value={holidayForm.customStart} onChange={(e) => setHolidayForm({ ...holidayForm, customStart: e.target.value })} className="px-2 py-1 bg-bg border border-border rounded text-text" />
                    <span>to</span>
                    <input type="time" value={holidayForm.customEnd} onChange={(e) => setHolidayForm({ ...holidayForm, customEnd: e.target.value })} className="px-2 py-1 bg-bg border border-border rounded text-text" />
                  </div>
                )}

                <button type="submit" disabled={savingHoliday || !holidayForm.name.trim()} className="w-full px-3 py-2 bg-primary text-white text-xs font-bold rounded-lg disabled:opacity-50">
                  {savingHoliday ? 'Saving...' : 'Save holiday'}
                </button>
              </form>
            </div>,
            document.body
          )}

          {/* Holiday List */}
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {loadingHolidays ? (
              <div className="flex items-center justify-center py-6 text-xs text-muted">
                <RefreshCw size={14} className="animate-spin mr-1.5" /> Loading holiday schedule...
              </div>
            ) : holidays.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted bg-bg/50 border border-border rounded-xl">
                No holidays added yet. Deliveries will run on regular daily schedule.
              </div>
            ) : (
              holidays.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between p-2.5 bg-bg border border-border rounded-xl text-xs"
                >
                  <div>
                    <div className="font-bold text-text flex items-center gap-1.5">
                      <span>{h.holiday_name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        h.is_closed ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                      }`}>
                        {h.is_closed ? 'Closed' : 'Custom Hours'}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      📅 {h.holiday_date}
                      {!h.is_closed && h.custom_window_start && ` (${h.custom_window_start} - ${h.custom_window_end})`}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteHoliday(h.id, h.holiday_name)}
                    disabled={deletingHolidayId === h.id}
                    className="p-1.5 text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                    title="Delete holiday"
                  >
                    {deletingHolidayId === h.id ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── License Management Card ──────────────────────────────────────────────────
// Allows viewing machine hardware ID, license status, and activating/updating license key online
