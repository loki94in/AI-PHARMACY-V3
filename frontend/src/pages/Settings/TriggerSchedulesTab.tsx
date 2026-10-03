import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, api } from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { broadcastContactDataChanged, updateSettingsCache } from '../../utils/settingsSync';
import { useModalEscape, shortcutEvent } from '../../services/keyboardShortcuts';
import { toastEvent } from '../../services/events';
import type { LocalApiError, StorageLocation, RegisteredDevice } from './settingsTypes';
import { Database, Trash2, Save, RefreshCw, Zap, Clock, RotateCcw, AlertTriangle, Send, Plus, CheckCircle2, MessageCircle, Mail, Stethoscope, Truck, Check, ShoppingCart, Phone } from 'lucide-react';

export function TriggerSchedulesTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [formData, setFormData] = useState({
    automationEnabled: rawSettings.automation_enabled !== 'false',

    // 1. Daily Operational Check
    triggerDailyCheckEnabled: rawSettings.trigger_daily_check_enabled !== 'false',
    triggerDailyCheckTime: rawSettings.trigger_daily_check_time || '09:00',
    dailyBriefingTemplate: rawSettings.daily_briefing_template || 'detailed',

    // 2. Near-Expiry Stock Scan
    triggerExpiryScanEnabled: rawSettings.trigger_expiry_scan_enabled !== 'false',
    triggerExpiryScanTime: rawSettings.trigger_expiry_scan_time || '09:00',
    triggerExpiryScanDays: rawSettings.trigger_expiry_scan_days || '1,16',
    triggerExpiryLookaheadDays: rawSettings.trigger_expiry_lookahead_days || '90',

    // 3. Distributor Dispatch Reminder
    triggerDispatchReminderEnabled: rawSettings.trigger_dispatch_reminder_enabled === 'true',
    triggerDispatchReminderTimeStart: rawSettings.trigger_dispatch_reminder_time_start || '12:30',
    triggerDispatchReminderTimeEnd: rawSettings.trigger_dispatch_reminder_time_end || '13:00',
    triggerAfternoonDispatchReminderEnabled: rawSettings.trigger_afternoon_dispatch_reminder_enabled === 'true',
    triggerAfternoonDispatchReminderTime: rawSettings.trigger_afternoon_dispatch_reminder_time || '14:00',

    // 4. Nightly Database Backup
    triggerBackupEnabled: rawSettings.trigger_backup_enabled !== 'false',
    triggerBackupTime: rawSettings.trigger_backup_time || '21:59',

    // 5. Auto Expiry Return Memos
    triggerExpiryReturnEnabled: rawSettings.trigger_expiry_return_enabled !== 'false',
    triggerExpiryReturnIntervalDays: rawSettings.trigger_expiry_return_interval_days || '15',

    // 6. Pharmarack Token Refresher
    triggerPharmarackRefreshEnabled: rawSettings.trigger_pharmarack_refresh_enabled !== 'false',
    triggerPharmarackRefreshIntervalMin: rawSettings.trigger_pharmarack_refresh_interval_min || '20',

    // 7. WhatsApp Message Queue
    triggerWhatsappQueueEnabled: rawSettings.trigger_whatsapp_queue_enabled !== 'false',
    triggerWhatsappQueueIntervalSec: rawSettings.trigger_whatsapp_queue_interval_sec || '30',

    // 7b. WhatsApp Smart Auto-Reply Timing
    waBotColdDelayMin: rawSettings.wa_bot_cold_delay_min_sec || '35',
    waBotColdDelayMax: rawSettings.wa_bot_cold_delay_max_sec || '60',
    waBotWarmDelayMin: rawSettings.wa_bot_warm_delay_min_sec || '10',
    waBotWarmDelayMax: rawSettings.wa_bot_warm_delay_max_sec || '17',
    waBotWarmWindowMin: rawSettings.wa_bot_warm_window_minutes || '20',

    // 8. Email PDF Invoice Poller
    triggerEmailPollerEnabled: rawSettings.trigger_email_poller_enabled !== 'false',
    triggerEmailPollerIntervalMin: rawSettings.trigger_email_poller_interval_min || '15',

    // 9. Doctor Daily Reports
    triggerDoctorReportEnabled: rawSettings.trigger_doctor_report_enabled !== 'false',
    triggerDoctorReportTime: rawSettings.trigger_doctor_report_time || '20:00',

    // 10. Patient Chronic Refill Evaluator
    triggerRefillsEnabled: rawSettings.trigger_refills_enabled !== 'false',
    triggerRefillsCheckTime: rawSettings.trigger_refills_check_time || '09:00',
    defaultRefillReminderMode: rawSettings.default_refill_reminder_mode || 'manual',
    reminderAdminPreviewEnabled: rawSettings.reminder_admin_preview_enabled !== 'false',

    // 11. Pharmarack Cart Auto-Send Cutoff
    triggerPharmarackCartSendEnabled: rawSettings.trigger_pharmarack_cart_send_enabled !== 'false',
    triggerPharmarackCartSendTime: rawSettings.trigger_pharmarack_cart_send_time || '11:00',

    // 12. Non-WhatsApp Patient Fallback
    nonWaFallbackEnabled: rawSettings.non_wa_fallback_enabled !== 'false',
    nonWaFallbackMode: rawSettings.non_wa_fallback_mode || 'both',
    nonWaFallbackAlertPhone: rawSettings.non_wa_fallback_alert_phone || '',

    // 13. Customer Delivery Schedules
    deliverySchedules: (() => {
      try {
        if (rawSettings.pharmacy_delivery_schedules) {
          const parsed = JSON.parse(rawSettings.pharmacy_delivery_schedules);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (_) {}
      return [
        { id: 'slot_1', label: 'Afternoon Dispatch', cutoffTime: '14:00', deliveryWindow: '5:00 PM – 7:00 PM (Same Day)' },
        { id: 'slot_2', label: 'Night Cutoff Dispatch', cutoffTime: '23:00', deliveryWindow: '9:00 AM – 11:00 AM (Next Day)' }
      ];
    })() as Array<{ id: string; label: string; cutoffTime: string; deliveryWindow: string }>,
  });

  const [saving, setSaving] = useState(false);
  const [sendingTestBriefing, setSendingTestBriefing] = useState(false);
  const queryClient = useQueryClient();

  const handleSendTestBriefing = async () => {
    setSendingTestBriefing(true);
    try {
      const res = await apiClient.post('/settings/send-test-briefing', {
        template: formData.dailyBriefingTemplate
      });
      if (res.data?.success) {
        toastEvent.trigger(res.data.message || 'Test briefing dispatched to store WhatsApp!', 'success');
      } else {
        toastEvent.trigger(res.data?.error || 'Failed to send test briefing', 'error');
      }
    } catch (err: any) {
      toastEvent.trigger(err?.response?.data?.error || err?.message || 'Failed to send test briefing', 'error');
    } finally {
      setSendingTestBriefing(false);
    }
  };

  const handleSaveTriggers = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        automation_enabled: formData.automationEnabled ? 'true' : 'false',
        trigger_daily_check_enabled: formData.triggerDailyCheckEnabled ? 'true' : 'false',
        trigger_daily_check_time: formData.triggerDailyCheckTime,
        daily_briefing_template: formData.dailyBriefingTemplate || 'detailed',
        trigger_expiry_scan_enabled: formData.triggerExpiryScanEnabled ? 'true' : 'false',
        trigger_expiry_scan_time: formData.triggerExpiryScanTime,
        trigger_expiry_scan_days: formData.triggerExpiryScanDays,
        trigger_expiry_lookahead_days: formData.triggerExpiryLookaheadDays,
        trigger_dispatch_reminder_enabled: formData.triggerDispatchReminderEnabled ? 'true' : 'false',
        trigger_dispatch_reminder_time_start: formData.triggerDispatchReminderTimeStart,
        trigger_dispatch_reminder_time_end: formData.triggerDispatchReminderTimeEnd,
        trigger_afternoon_dispatch_reminder_enabled: formData.triggerAfternoonDispatchReminderEnabled ? 'true' : 'false',
        trigger_afternoon_dispatch_reminder_time: formData.triggerAfternoonDispatchReminderTime,
        trigger_backup_enabled: formData.triggerBackupEnabled ? 'true' : 'false',
        trigger_backup_time: formData.triggerBackupTime,
        trigger_expiry_return_enabled: formData.triggerExpiryReturnEnabled ? 'true' : 'false',
        trigger_expiry_return_interval_days: formData.triggerExpiryReturnIntervalDays,
        trigger_pharmarack_refresh_enabled: formData.triggerPharmarackRefreshEnabled ? 'true' : 'false',
        trigger_pharmarack_refresh_interval_min: formData.triggerPharmarackRefreshIntervalMin,
        trigger_whatsapp_queue_enabled: formData.triggerWhatsappQueueEnabled ? 'true' : 'false',
        trigger_whatsapp_queue_interval_sec: formData.triggerWhatsappQueueIntervalSec,
        // Smart auto-reply timing
        wa_bot_cold_delay_min_sec: formData.waBotColdDelayMin,
        wa_bot_cold_delay_max_sec: formData.waBotColdDelayMax,
        wa_bot_warm_delay_min_sec: formData.waBotWarmDelayMin,
        wa_bot_warm_delay_max_sec: formData.waBotWarmDelayMax,
        wa_bot_warm_window_minutes: formData.waBotWarmWindowMin,
        trigger_email_poller_enabled: formData.triggerEmailPollerEnabled ? 'true' : 'false',
        trigger_email_poller_interval_min: formData.triggerEmailPollerIntervalMin,
        trigger_doctor_report_enabled: formData.triggerDoctorReportEnabled ? 'true' : 'false',
        trigger_doctor_report_time: formData.triggerDoctorReportTime,
        trigger_refills_enabled: formData.triggerRefillsEnabled ? 'true' : 'false',
        trigger_refills_check_time: formData.triggerRefillsCheckTime,
        default_refill_reminder_mode: formData.defaultRefillReminderMode,
        reminder_admin_preview_enabled: formData.reminderAdminPreviewEnabled ? 'true' : 'false',
        trigger_pharmarack_cart_send_enabled: formData.triggerPharmarackCartSendEnabled ? 'true' : 'false',
        trigger_pharmarack_cart_send_time: formData.triggerPharmarackCartSendTime,
        // Non-WhatsApp patient fallback (v69)
        non_wa_fallback_enabled: formData.nonWaFallbackEnabled ? 'true' : 'false',
        non_wa_fallback_mode: formData.nonWaFallbackMode,
        non_wa_fallback_alert_phone: formData.nonWaFallbackAlertPhone,
        // Delivery Schedules
        pharmacy_delivery_schedules: JSON.stringify(formData.deliverySchedules),
      };

      await api.saveSettings(payload);
      refetchSettings();
      updateSettingsCache(queryClient, payload);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toastEvent.trigger('Automated trigger schedules saved & applied successfully!', 'success');
    } catch (err) {
      console.error('Failed to save trigger schedules:', err);
      toastEvent.trigger('Failed to save trigger schedules', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTriggersRef = useRef(handleSaveTriggers);
  handleSaveTriggersRef.current = handleSaveTriggers;

  useEffect(() => {
    return shortcutEvent.subscribeSave(() => {
      void handleSaveTriggersRef.current();
    });
  }, []);

  return (
    <div className="space-y-6">
      {/* Header Banner & Save Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-bg3/40 border border-border">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 mt-0.5">
            <Clock size={22} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text">Automated Trigger Schedule Engine</h2>
            <p className="text-xs text-muted mt-0.5">Configure execution times, frequency intervals & auto-triggers for every background worker in AI PHARMACY OS.</p>
          </div>
        </div>

        <button
          onClick={handleSaveTriggers}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-sm disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          <span>{saving ? 'Applying Schedules...' : 'Save & Apply Schedules'}</span>
        </button>
      </div>

      {/* Global Master Toggle */}
      <div className="p-4 rounded-2xl bg-bg3/20 border border-border flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-text">Master Background Automation Switch</div>
          <div className="text-[11px] text-muted">Master override to enable or pause all background automated workers across the system.</div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={formData.automationEnabled}
            onChange={(e) => setFormData({ ...formData, automationEnabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-bg3 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
        </label>
      </div>

      {/* Grid of 10 Trigger Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Trigger 1: Daily Operational Check */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-500" />
              <span className="text-xs font-bold text-text">Daily Operational Check</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerDailyCheckEnabled}
                onChange={(e) => setFormData({ ...formData, triggerDailyCheckEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Evaluates patient refills, checks overdue Khata credit notes, and triggers bounced product alerts daily.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Execution Time:</label>
            <input
              type="time"
              value={formData.triggerDailyCheckTime}
              onChange={(e) => setFormData({ ...formData, triggerDailyCheckTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>

          {/* WhatsApp Briefing Template Selection & Live Test */}
          <div className="pt-2 border-t border-border/60 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-text">WhatsApp Briefing Template:</label>
              <button
                type="button"
                onClick={handleSendTestBriefing}
                disabled={sendingTestBriefing}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {sendingTestBriefing ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                <span>Send Test Briefing</span>
              </button>
            </div>
            <select
              value={formData.dailyBriefingTemplate}
              onChange={(e) => setFormData({ ...formData, dailyBriefingTemplate: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary font-medium"
            >
              <option value="detailed">Template 4: Itemized Detail List (Default - Medicines & Qty)</option>
              <option value="compact">Template 1: Compact Worklist (Patients & Stock Only)</option>
              <option value="checklist">Template 2: Action Checklist ([ ] Priorities)</option>
              <option value="executive">Template 3: Executive Summary (Counts & Status)</option>
            </select>
            <p className="text-[10px] text-muted">
              {formData.dailyBriefingTemplate === 'detailed' && 'Includes full medicine brand names, quantities, and stock status for each patient.'}
              {formData.dailyBriefingTemplate === 'compact' && 'Compact view showing patient names and medicine counts without long brand names.'}
              {formData.dailyBriefingTemplate === 'checklist' && 'Numbered operational to-do checklist with priority task order.'}
              {formData.dailyBriefingTemplate === 'executive' && 'Fast 5-line summary highlighting total counts, high alerts, and store status.'}
            </p>
          </div>
        </div>

        {/* Trigger 2: Near-Expiry Stock Scan */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <span className="text-xs font-bold text-text">Near-Expiry Stock Scan & Alerts</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerExpiryScanEnabled}
                onChange={(e) => setFormData({ ...formData, triggerExpiryScanEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans inventory for batches nearing expiration and sends alerts to store owner.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">Time:</label>
              <input
                type="time"
                value={formData.triggerExpiryScanTime}
                onChange={(e) => setFormData({ ...formData, triggerExpiryScanTime: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">Days:</label>
              <input
                type="text"
                placeholder="1,16"
                value={formData.triggerExpiryScanDays}
                onChange={(e) => setFormData({ ...formData, triggerExpiryScanDays: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Trigger 3: Distributor Dispatch Reminder */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-blue-500" />
              <span className="text-xs font-bold text-text">Distributor Dispatch Reminders</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerDispatchReminderEnabled}
                onChange={(e) => setFormData({ ...formData, triggerDispatchReminderEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Sends automated daily dispatches and stock reminders to suppliers during active window.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">Start:</label>
              <input
                type="time"
                value={formData.triggerDispatchReminderTimeStart}
                onChange={(e) => setFormData({ ...formData, triggerDispatchReminderTimeStart: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-semibold text-text">End:</label>
              <input
                type="time"
                value={formData.triggerDispatchReminderTimeEnd}
                onChange={(e) => setFormData({ ...formData, triggerDispatchReminderTimeEnd: e.target.value })}
                className="w-full px-2 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Trigger 3B: Afternoon Delivery Boy Dispatch */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-emerald-500" />
              <span className="text-xs font-bold text-text">Afternoon Delivery Boy Dispatch</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerAfternoonDispatchReminderEnabled}
                onChange={(e) => setFormData({ ...formData, triggerAfternoonDispatchReminderEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Sends a consolidated WhatsApp collection summary with repeat order counts (e.g. 2x) to active Delivery Staff.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Dispatch Time:</label>
            <input
              type="time"
              value={formData.triggerAfternoonDispatchReminderTime}
              onChange={(e) => setFormData({ ...formData, triggerAfternoonDispatchReminderTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 4: Nightly Database Backup */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-purple-500" />
              <span className="text-xs font-bold text-text">Nightly Database Backup</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerBackupEnabled}
                onChange={(e) => setFormData({ ...formData, triggerBackupEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Automatically compiles compressed database backups every night.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Backup Time:</label>
            <input
              type="time"
              value={formData.triggerBackupTime}
              onChange={(e) => setFormData({ ...formData, triggerBackupTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 5: Auto Expiry Return Review Scans */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCcw size={16} className="text-indigo-500" />
              <span className="text-xs font-bold text-text">Auto Expiry Return Review Scans</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerExpiryReturnEnabled}
                onChange={(e) => setFormData({ ...formData, triggerExpiryReturnEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans in-stock inventory only (never sold or already-returned batches) for expired batches and creates pending items for pharmacist review. Requires manual approval before stock deduction.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Interval (days):</label>
            <input
              type="number"
              min="1"
              max="365"
              placeholder="15"
              value={formData.triggerExpiryReturnIntervalDays}
              onChange={(e) => setFormData({ ...formData, triggerExpiryReturnIntervalDays: e.target.value })}
              className="w-full px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 6: Pharmarack Token Refresher */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="text-teal-500" />
              <span className="text-xs font-bold text-text">Pharmarack Token Refresher</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerPharmarackRefreshEnabled}
                onChange={(e) => setFormData({ ...formData, triggerPharmarackRefreshEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Keeps Pharmarack session rolling and refreshes OAuth tokens headlessly.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Interval (Minutes):</label>
            <input
              type="number"
              min="5"
              max="120"
              value={formData.triggerPharmarackRefreshIntervalMin}
              onChange={(e) => setFormData({ ...formData, triggerPharmarackRefreshIntervalMin: e.target.value })}
              className="w-24 px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 7: WhatsApp Message Queue */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle size={16} className="text-green-500" />
              <span className="text-xs font-bold text-text">WhatsApp Message Queue</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerWhatsappQueueEnabled}
                onChange={(e) => setFormData({ ...formData, triggerWhatsappQueueEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Processes pending outbound WhatsApp messages with rate-limiting and anti-ban protection.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Interval (Seconds):</label>
            <input
              type="number"
              min="5"
              max="300"
              value={formData.triggerWhatsappQueueIntervalSec}
              onChange={(e) => setFormData({ ...formData, triggerWhatsappQueueIntervalSec: e.target.value })}
              className="w-24 px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Auto-Reply Timing Card */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <MessageCircle size={16} className="text-emerald-400" />
            <span className="text-xs font-bold text-text">🤖 Auto-Reply Timing</span>
          </div>
          <p className="text-[11px] text-muted">Controls how long the bot waits before replying. Cold = new/inactive customer. Warm = active chat within the warm window.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text">Cold Min (sec)</label>
              <input
                type="number" min="5" max="300"
                value={formData.waBotColdDelayMin}
                onChange={(e) => setFormData({ ...formData, waBotColdDelayMin: e.target.value })}
                className="w-full px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text">Cold Max (sec)</label>
              <input
                type="number" min="5" max="300"
                value={formData.waBotColdDelayMax}
                onChange={(e) => setFormData({ ...formData, waBotColdDelayMax: e.target.value })}
                className="w-full px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text">Warm Min (sec)</label>
              <input
                type="number" min="1" max="120"
                value={formData.waBotWarmDelayMin}
                onChange={(e) => setFormData({ ...formData, waBotWarmDelayMin: e.target.value })}
                className="w-full px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text">Warm Max (sec)</label>
              <input
                type="number" min="1" max="120"
                value={formData.waBotWarmDelayMax}
                onChange={(e) => setFormData({ ...formData, waBotWarmDelayMax: e.target.value })}
                className="w-full px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-[11px] font-semibold text-text">Warm Window (minutes) — active convo threshold</label>
              <input
                type="number" min="5" max="120"
                value={formData.waBotWarmWindowMin}
                onChange={(e) => setFormData({ ...formData, waBotWarmWindowMin: e.target.value })}
                className="w-full px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Trigger 8: Email PDF Invoice Poller */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail size={16} className="text-cyan-500" />
              <span className="text-xs font-bold text-text">Email PDF Invoice Poller</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerEmailPollerEnabled}
                onChange={(e) => setFormData({ ...formData, triggerEmailPollerEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans linked store email inbox for incoming distributor invoices and queues OCR parsing.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Polling (Minutes):</label>
            <input
              type="number"
              min="5"
              max="120"
              value={formData.triggerEmailPollerIntervalMin}
              onChange={(e) => setFormData({ ...formData, triggerEmailPollerIntervalMin: e.target.value })}
              className="w-24 px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 9: Doctor Daily Reports */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Stethoscope size={16} className="text-rose-500" />
              <span className="text-xs font-bold text-text">Doctor Daily Summary Reports</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerDoctorReportEnabled}
                onChange={(e) => setFormData({ ...formData, triggerDoctorReportEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Compiles daily prescription statistics and emails/whatsapps reports to partner doctors.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Report Time:</label>
            <input
              type="time"
              value={formData.triggerDoctorReportTime}
              onChange={(e) => setFormData({ ...formData, triggerDoctorReportTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Trigger 10: Chronic Refill Evaluator */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-sky-500" />
              <span className="text-xs font-bold text-text">Chronic Medication Refill Alerts</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={formData.triggerRefillsEnabled}
                onChange={(e) => setFormData({ ...formData, triggerRefillsEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">Scans chronic dosage schedules and queues 3-day refill alerts for patients.</p>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Check Time:</label>
            <input
              type="time"
              value={formData.triggerRefillsCheckTime}
              onChange={(e) => setFormData({ ...formData, triggerRefillsCheckTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
          </div>

          <div className="pt-2 border-t border-border/40 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-text">Default Dispatch Mode</div>
                <div className="text-[10px] text-muted">Initial mode for newly enrolled refill patients</div>
              </div>
              <div className="flex items-center bg-bg rounded-lg p-0.5 border border-border text-[11px]">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultRefillReminderMode: 'manual' })}
                  className={`px-2 py-1 rounded-md font-bold transition-all ${
                    formData.defaultRefillReminderMode === 'manual'
                      ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  Manual 👆
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultRefillReminderMode: 'auto' })}
                  className={`px-2 py-1 rounded-md font-bold transition-all ${
                    formData.defaultRefillReminderMode === 'auto'
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  Auto 🤖
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold text-text">Alert Pharmacy WhatsApp First</div>
                <div className="text-[10px] text-muted">Send staged refill briefing to store number before dispatch</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.reminderAdminPreviewEnabled}
                  onChange={(e) => setFormData({ ...formData, reminderAdminPreviewEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-zinc-100 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-100 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Trigger 10b: Non-WhatsApp Patient Fallback */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone size={16} className="text-orange-400" />
              <span className="text-xs font-bold text-text">Non-WhatsApp Patient Fallback</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                id="non-wa-fallback-enabled"
                checked={formData.nonWaFallbackEnabled}
                onChange={(e) => setFormData({ ...formData, nonWaFallbackEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-zinc-100 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-100 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-400"></div>
            </label>
          </div>
          <p className="text-[11px] text-muted">When a refill or credit patient does not have WhatsApp, create a call task for counter staff and/or alert the pharmacy owner to call them manually.</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-text whitespace-nowrap w-24">Channel:</label>
              <select
                id="non-wa-fallback-mode"
                value={formData.nonWaFallbackMode}
                onChange={(e) => setFormData({ ...formData, nonWaFallbackMode: e.target.value })}
                className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary flex-1"
              >
                <option value="both">Both — In-App Call Board + Owner WhatsApp Alert</option>
                <option value="board">In-App Call Board Only</option>
                <option value="owner">Owner WhatsApp Alert Only</option>
                <option value="off">Disabled</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-text whitespace-nowrap w-24">Alert Phone:</label>
              <input
                id="non-wa-fallback-alert-phone"
                type="tel"
                value={formData.nonWaFallbackAlertPhone}
                onChange={(e) => setFormData({ ...formData, nonWaFallbackAlertPhone: e.target.value })}
                placeholder="Owner WhatsApp number (e.g. 9876543210)"
                className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary flex-1"
              />
            </div>
            <p className="text-[10px] text-muted">Leave Alert Phone blank to use the Admin WhatsApp number configured above.</p>
          </div>
        </div>

        {/* Trigger 11: Pharmarack Cart Daily Auto-Send Cutoff & Configurable Delivery Timetable */}
        <div className="p-4 rounded-2xl bg-bg3/30 border border-border space-y-4 md:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart size={16} className="text-emerald-400" />
              <div>
                <span className="text-xs font-bold text-text">Pharmarack Cart Auto-Send Cutoff & Delivery Timetable</span>
                <p className="text-[11px] text-muted">Daily deadline when today's Pharmarack cart orders automatically batch-dispatch to suppliers, plus customer delivery expectation windows.</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={formData.triggerPharmarackCartSendEnabled}
                onChange={(e) => setFormData({ ...formData, triggerPharmarackCartSendEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-bg3 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-zinc-100 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-100 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-border/40">
            <label className="text-[11px] font-semibold text-text whitespace-nowrap">Primary Cart Auto-Send Cutoff:</label>
            <input
              type="time"
              value={formData.triggerPharmarackCartSendTime}
              onChange={(e) => setFormData({ ...formData, triggerPharmarackCartSendTime: e.target.value })}
              className="px-2.5 py-1 text-xs bg-bg border border-border rounded-lg text-text focus:outline-none focus:border-primary"
            />
            <span className="text-[10px] text-muted">(Automated batch send timer fires at this time)</span>
          </div>

          {/* Delivery Schedule Slots for WhatsApp & Online Orders */}
          <div className="space-y-2 pt-2 border-t border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Truck size={14} className="text-primary" />
                <span className="text-xs font-bold text-text">Configured Delivery Windows & Cutoffs</span>
                <span className="text-[10px] text-muted">({formData.deliverySchedules.length} slots)</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const newSlot = {
                    id: `slot_${Date.now()}`,
                    label: `Slot ${formData.deliverySchedules.length + 1}`,
                    cutoffTime: '18:00',
                    deliveryWindow: '8:00 PM – 10:00 PM (Same Day)',
                  };
                  setFormData({
                    ...formData,
                    deliverySchedules: [...formData.deliverySchedules, newSlot],
                  });
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all cursor-pointer"
              >
                <Plus size={12} />
                <span>Add Delivery Window</span>
              </button>
            </div>
            <p className="text-[10px] text-muted">
              AI Bot automatically calculates the promised delivery date/time on WhatsApp and Online Orders based on order booking time, these cutoffs, and market closure/paused days.
            </p>

            <div className="space-y-2">
              {formData.deliverySchedules.map((slot, index) => (
                <div
                  key={slot.id || index}
                  className="p-2.5 rounded-xl bg-bg border border-border flex flex-wrap items-center gap-2 text-xs"
                >
                  <div className="flex items-center gap-1.5 min-w-[130px] flex-1 sm:flex-initial">
                    <label className="text-[10px] font-bold text-muted uppercase">Name:</label>
                    <input
                      type="text"
                      value={slot.label}
                      onChange={(e) => {
                        const updated = [...formData.deliverySchedules];
                        updated[index] = { ...updated[index], label: e.target.value };
                        setFormData({ ...formData, deliverySchedules: updated });
                      }}
                      placeholder="e.g. Afternoon Slot"
                      className="px-2 py-1 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary flex-1 min-w-[110px]"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-bold text-muted uppercase">Cutoff:</label>
                    <input
                      type="time"
                      value={slot.cutoffTime}
                      onChange={(e) => {
                        const updated = [...formData.deliverySchedules];
                        updated[index] = { ...updated[index], cutoffTime: e.target.value };
                        setFormData({ ...formData, deliverySchedules: updated });
                      }}
                      className="px-2 py-1 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary font-mono"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
                    <label className="text-[10px] font-bold text-muted uppercase">Delivery Window:</label>
                    <input
                      type="text"
                      value={slot.deliveryWindow}
                      onChange={(e) => {
                        const updated = [...formData.deliverySchedules];
                        updated[index] = { ...updated[index], deliveryWindow: e.target.value };
                        setFormData({ ...formData, deliverySchedules: updated });
                      }}
                      placeholder="e.g. 5:00 PM – 7:00 PM (Same Day)"
                      className="px-2 py-1 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-primary flex-1"
                    />
                  </div>

                  {formData.deliverySchedules.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const updated = formData.deliverySchedules.filter((_, i) => i !== index);
                        setFormData({ ...formData, deliverySchedules: updated });
                      }}
                      className="p-1 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer shrink-0"
                      title="Remove Schedule Slot"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 6: MULTI-STORE & CENTRAL SYNC
// ==========================================

