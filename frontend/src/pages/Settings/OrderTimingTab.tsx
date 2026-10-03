import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, api } from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { broadcastContactDataChanged, updateSettingsCache } from '../../utils/settingsSync';
import { useModalEscape, shortcutEvent } from '../../services/keyboardShortcuts';
import { toastEvent } from '../../services/events';
import type { LocalApiError, StorageLocation, RegisteredDevice, PharmacyHolidayItem } from './settingsTypes';
import { Trash2, Save, RefreshCw, Clock, RotateCcw, X, Plus, Calendar } from 'lucide-react';

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
  const [holidayForm, setHolidayForm] = useState({
    name: '',
    date: '',
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
    if (!holidayForm.name.trim() || !holidayForm.date) {
      toastEvent.trigger('Holiday name and date are required', 'error');
      return;
    }

    setSavingHoliday(true);
    try {
      await apiClient.post('/settings/holidays', {
        holiday_name: holidayForm.name.trim(),
        holiday_date: holidayForm.date,
        is_closed: holidayForm.isClosed,
        custom_window_start: holidayForm.isClosed ? null : holidayForm.customStart,
        custom_window_end: holidayForm.isClosed ? null : holidayForm.customEnd
      });

      toastEvent.trigger(`Holiday "${holidayForm.name}" added`, 'success');
      setHolidayForm({ name: '', date: '', isClosed: true, customStart: '10:00', customEnd: '14:00' });
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
            <button
              type="button"
              onClick={() => setShowAddHoliday(!showAddHoliday)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 text-xs font-bold rounded-lg hover:bg-primary/20 transition-all cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Holiday</span>
            </button>
          </div>

          {/* Add Holiday Inline Form */}
          {showAddHoliday && (
            <form onSubmit={handleAddHoliday} className="p-3 bg-bg border border-border rounded-xl space-y-3">
              <div className="text-xs font-bold text-text flex items-center justify-between">
                <span>Add Scheduled Holiday</span>
                <button
                  type="button"
                  onClick={() => setShowAddHoliday(false)}
                  className="text-muted hover:text-text"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-muted mb-1">Holiday Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Republic Day"
                    value={holidayForm.name}
                    onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-muted mb-1">Date</label>
                  <input
                    type="date"
                    value={holidayForm.date}
                    onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={holidayForm.isClosed}
                    onChange={(e) => setHolidayForm({ ...holidayForm, isClosed: e.target.checked })}
                    className="w-3.5 h-3.5 rounded text-primary"
                  />
                  <span>Full Day Closed (No deliveries)</span>
                </label>
                <button
                  type="submit"
                  disabled={savingHoliday}
                  className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg shadow-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  {savingHoliday ? 'Adding...' : 'Save Holiday'}
                </button>
              </div>
            </form>
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
