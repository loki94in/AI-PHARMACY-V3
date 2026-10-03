import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, api } from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { useModalEscape, shortcutEvent } from '../../services/keyboardShortcuts';
import { toastEvent } from '../../services/events';
import { BackupCenterContent } from '../../components/BackupCenterModal';
import type { LocalApiError, StorageLocation, RegisteredDevice } from './settingsTypes';
import { Database, Trash2, Save, RefreshCw, RotateCcw, Shield, ShieldCheck, AlertTriangle, X, Upload, Image as ImageIcon, Cloud } from 'lucide-react';

export function DataBackupsTab({ rawSettings, refetchSettings }: { rawSettings: Record<string, string>; refetchSettings: () => void }) {
  const [backupFrequency, setBackupFrequency] = useState(rawSettings.backup_frequency || 'off');
  const [gdriveEnabled, setGdriveEnabled] = useState(rawSettings.backup_gdrive_enabled === 'true');
  const [emailBackupEnabled, setEmailBackupEnabled] = useState(rawSettings.backup_email_backup_enabled === 'true');
  const [savingFreq, setSavingFreq] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showSystemResetModal, setShowSystemResetModal] = useState(false);
  const [resetModalInitialMode, setResetModalInitialMode] = useState<'data' | 'factory'>('data');
  const [storageStats, setStorageStats] = useState<{
    totalFiles: number;
    totalSizeBytes: number;
    eligibleCount: number;
    eligibleSizeBytes: number;
  } | null>(null);
  const [loadingStorageStats, setLoadingStorageStats] = useState(false);
  const [purgingStorage, setPurgingStorage] = useState(false);
  const [showPurgeConfirmModal, setShowPurgeConfirmModal] = useState(false);
  const queryClient = useQueryClient();

  // Universal Escape key dismissal for Backup & Reset modals
  useModalEscape(showBackupModal, () => setShowBackupModal(false));
  useModalEscape(showSystemResetModal, () => setShowSystemResetModal(false));
  useModalEscape(showPurgeConfirmModal, () => setShowPurgeConfirmModal(false));

  const fetchStorageStats = useCallback(async () => {
    setLoadingStorageStats(true);
    try {
      const res = await apiClient.get('/utilities/storage/payment-proofs?daysOld=90');
      if (res.data?.success) {
        setStorageStats({
          totalFiles: res.data.totalFiles || 0,
          totalSizeBytes: res.data.totalSizeBytes || 0,
          eligibleCount: res.data.eligibleCount || 0,
          eligibleSizeBytes: res.data.eligibleSizeBytes || 0,
        });
      }
    } catch (err) {
      console.warn('[Settings] Failed to fetch storage stats:', err);
    } finally {
      setLoadingStorageStats(false);
    }
  }, []);

  useEffect(() => {
    fetchStorageStats();
  }, [fetchStorageStats]);

  const handlePurgeScreenshots = async () => {
    setPurgingStorage(true);
    try {
      const res = await apiClient.post('/utilities/storage/purge-payment-proofs', { daysOld: 90 });
      if (res.data?.success) {
        toastEvent.trigger(
          `Retention purge complete: ${res.data.purgedCount} screenshot(s) cleaned (${(res.data.freedBytes / 1024).toFixed(1)} KB freed)`,
          'success'
        );
        setShowPurgeConfirmModal(false);
        fetchStorageStats();
      }
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to purge screenshots: ' + e.message, 'error');
    } finally {
      setPurgingStorage(false);
    }
  };

  const hasGdriveAuth = !!(rawSettings.gmail_oauth_refresh_token || rawSettings.gmail_user);

  const handleSaveBackupSchedule = async () => {
    setSavingFreq(true);
    try {
      await apiClient.post('/settings/save', {
        backup_frequency: backupFrequency,
        backup_gdrive_enabled: gdriveEnabled ? 'true' : 'false',
        backup_email_backup_enabled: emailBackupEnabled ? 'true' : 'false'
      });
      toastEvent.trigger('Backup configuration updated', 'success');
      refetchSettings();
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to update backup schedule: ' + e.message, 'error');
    } finally {
      setSavingFreq(false);
    }
  };

  const handleClearCache = async () => {
    try {
      queryClient.clear();
      invalidateAfterStockWrite(queryClient);
      toastEvent.trigger('Local inventory & search cache cleared successfully', 'success');
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('Failed to clear cache: ' + e.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Database Backup Center */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Database size={16} /> Automated Database Backup & Google Drive Cloud Protection
        </h2>

        <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Automated Schedule Frequency</label>
              <select
                value={backupFrequency}
                onChange={(e) => setBackupFrequency(e.target.value)}
                className="px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-primary focus:outline-none"
              >
                <option value="off">Off (Manual Backups Only)</option>
                <option value="daily">Daily Automatic Backup</option>
                <option value="weekly">Weekly Automatic Backup</option>
                <option value="monthly">Monthly Automatic Backup</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveBackupSchedule}
                disabled={savingFreq}
                className="px-4 py-2 bg-primary text-white font-bold text-xs rounded-xl hover:bg-primary/90 transition-all cursor-pointer"
              >
                Save Configuration
              </button>
              <button
                onClick={() => setShowBackupModal(true)}
                className="px-4 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Cloud size={14} className="text-green" />
                Open Cloud Backup Vault
              </button>
            </div>
          </div>

          {/* Quick Cloud Options */}
          <div className="pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={gdriveEnabled}
                onChange={(e) => setGdriveEnabled(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
              />
              <div>
                <span className="font-bold text-text flex items-center gap-1.5">
                  <Cloud size={13} className="text-green" />
                  Auto-Upload to Google Drive on Schedule
                </span>
                <span className="text-[11px] text-muted block">
                  {hasGdriveAuth ? `Account: ${rawSettings.gmail_user || 'Linked'}` : 'Requires Google Account connection in Backup Vault'}
                </span>
              </div>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={emailBackupEnabled}
                onChange={(e) => setEmailBackupEnabled(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
              />
              <div>
                <span className="font-semibold text-text block">Email Backup Attachment</span>
                <span className="text-[11px] text-muted block">Sends copy to inbox via App Password</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* WhatsApp Payment Receipts & Media Storage Retention Card */}
      <div className="space-y-4 pt-2 border-t border-border">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
            <ImageIcon size={16} /> WhatsApp Payment Receipts & Media Storage
          </h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-bold">
            90-Day Auto Retention Active
          </span>
        </div>

        <div className="bg-bg3/20 border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-text">Payment Screenshots Disk Space:</span>
                <span className="text-xs font-mono font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                  {storageStats ? `${storageStats.totalFiles} file(s) · ${(storageStats.totalSizeBytes / 1024).toFixed(1)} KB` : 'Loading...'}
                </span>
              </div>
              <p className="text-[11px] text-muted">
                Receipts from delivered & return-window closed orders older than 90 days are automatically purged daily at 2:30 AM to prevent disk accumulation.
              </p>
              {storageStats && (
                <div className="text-[11px] text-muted flex items-center gap-3 pt-1">
                  <span>Eligible for 90-day purge: <strong className="text-text">{storageStats.eligibleCount} file(s)</strong> ({(storageStats.eligibleSizeBytes / 1024).toFixed(1)} KB)</span>
                  <span className="text-emerald-500 font-medium">✓ Active & pending orders protected</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchStorageStats}
                disabled={loadingStorageStats}
                className="p-2 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-muted hover:text-text cursor-pointer transition-all"
                title="Refresh Storage Stats"
              >
                <RefreshCw size={14} className={loadingStorageStats ? 'animate-spin text-primary' : ''} />
              </button>
              <button
                type="button"
                onClick={() => setShowPurgeConfirmModal(true)}
                disabled={purgingStorage || !storageStats || storageStats.eligibleCount === 0}
                className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                title={storageStats && storageStats.eligibleCount === 0 ? 'No delivered receipts older than 90 days' : 'Purge delivered screenshots older than 90 days'}
              >
                <Trash2 size={13} />
                <span>Clean 90-Day Expired Proofs</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Maintenance, Cache & Reset */}
      <div className="space-y-4 pt-2 border-t border-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2 border-b border-border pb-2">
          <Trash2 size={16} /> System Maintenance, Data Reset & Factory Wipe
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Search Cache */}
          <div className="flex flex-col justify-between gap-4 bg-bg3/20 border border-border rounded-xl p-4">
            <div>
              <h3 className="text-xs font-bold text-text flex items-center gap-2">
                <RefreshCw size={14} className="text-amber-400" /> Clear Search Cache
              </h3>
              <p className="text-[11px] text-muted mt-1">Forces instant re-hydration of SQLite compact indexes without touching sales data.</p>
            </div>
            <div>
              <button
                onClick={handleClearCache}
                className="w-full py-2 bg-amber-500/10 text-amber-500 border border-amber-500/30 font-bold text-xs rounded-xl hover:bg-amber-500/20 transition-all cursor-pointer"
              >
                Clear Search Cache
              </button>
            </div>
          </div>

          {/* Card 2: System Data Reset */}
          <div className="flex flex-col justify-between gap-4 bg-bg3/20 border border-border rounded-xl p-4">
            <div>
              <h3 className="text-xs font-bold text-text flex items-center gap-2">
                <RotateCcw size={14} className="text-amber-400" /> System Data Reset
              </h3>
              <p className="text-[11px] text-muted mt-1">Wipes sales, inventory & transactions. Keeps store profile & API keys intact.</p>
            </div>
            <div>
              <button
                onClick={() => { setShowSystemResetModal(true); setResetModalInitialMode('data'); }}
                className="w-full py-2 bg-amber-500/10 text-amber-500 border border-amber-500/30 font-bold text-xs rounded-xl hover:bg-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={13} />
                <span>Reset Sales & Inventory</span>
              </button>
            </div>
          </div>

          {/* Card 3: Full Factory Reset */}
          <div className="flex flex-col justify-between gap-4 bg-red-500/5 border border-red-500/30 rounded-xl p-4">
            <div>
              <h3 className="text-xs font-bold text-red-400 flex items-center gap-2">
                <Trash2 size={14} className="text-red-400" /> Full Factory Reset (Complete Wipe)
              </h3>
              <p className="text-[11px] text-muted mt-1">Completely wipes ALL saved data, WhatsApp/Gmail tokens, Pharmarack logins, doctors, distributors & settings to fresh factory state.</p>
            </div>
            <div>
              <button
                onClick={() => { setShowSystemResetModal(true); setResetModalInitialMode('factory'); }}
                className="w-full py-2 bg-red-600 text-white font-bold text-xs rounded-xl hover:bg-red-700 transition-all cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
              >
                <Trash2 size={13} />
                <span>Full Factory Reset</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Full Backup Modal */}
      {showBackupModal && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-bg border border-border rounded-2xl p-6 w-[95vw] max-w-4xl h-[85vh] min-h-[560px] max-h-[840px] overflow-y-auto relative shadow-2xl">
            <button
              onClick={() => setShowBackupModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
            <BackupCenterContent onClose={() => setShowBackupModal(false)} />
          </div>
        </div>
      )}

      {/* System Data Reset Modal */}
      {showSystemResetModal && (
        <ResetDataModal
          initialMode={resetModalInitialMode}
          onClose={() => setShowSystemResetModal(false)}
          refetchSettings={refetchSettings}
        />
      )}

      {/* Purge Confirmation Modal (Human-in-the-Loop) */}
      {showPurgeConfirmModal && storageStats && (
        <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-bg border border-border rounded-2xl p-5 w-[95vw] max-w-md space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <Trash2 size={18} className="text-amber-500" />
                <h3 className="text-sm font-bold text-text">Confirm 90-Day Receipt Purge</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPurgeConfirmModal(false)}
                className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg2 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              You are about to delete <strong className="text-text">{storageStats.eligibleCount} payment receipt image(s)</strong> older than 90 days. This will free approximately <strong className="text-emerald-500">{(storageStats.eligibleSizeBytes / 1024).toFixed(1)} KB</strong> of disk space.
            </p>

            <div className="p-3 bg-bg2 rounded-xl border border-border text-xs text-text space-y-1.5">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck size={14} className="text-emerald-500 shrink-0" />
                <span>Zero Accidental Data Loss Shield:</span>
              </div>
              <ul className="text-[11px] text-muted list-disc list-inside space-y-0.5">
                <li>Orders in progress, pending delivery, or return-window open are preserved.</li>
                <li>Financial transaction amounts, order totals, and customer details remain in SQLite.</li>
                <li>An audit trail entry is logged in order tracking events.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
              <button
                type="button"
                onClick={() => setShowPurgeConfirmModal(false)}
                className="px-4 py-2 rounded-xl bg-bg2 hover:bg-bg3 border border-border text-xs font-bold text-muted hover:text-text cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={purgingStorage}
                onClick={handlePurgeScreenshots}
                className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {purgingStorage ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>{purgingStorage ? 'Purging...' : 'Approve & Purge Files'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// SYSTEM DATA & FACTORY RESET MODAL
// ==========================================

interface ResetDataModalProps {
  initialMode?: 'data' | 'factory';
  onClose: () => void;
  refetchSettings: () => void;
}

function ResetDataModal({ initialMode = 'data', onClose, refetchSettings }: ResetDataModalProps) {
  useModalEscape(true, onClose);
  const [resetType, setResetType] = useState<'data' | 'factory'>(initialMode);
  const [dataCounts, setDataCounts] = useState<{ medicines: number; inventory: number; bills: number; purchases: number; customers: number } | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [confirmInput, setConfirmInput] = useState('');
  const [resetting, setResetting] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    apiClient.get('/utilities/data-counts')
      .then(res => setDataCounts(res.data))
      .catch(err => console.warn('Failed to fetch data counts:', err))
      .finally(() => setLoadingCounts(false));
  }, []);

  const requiredWord = resetType === 'factory' ? 'FACTORY RESET' : 'RESET';
  const isConfirmed = confirmInput.trim().toUpperCase() === requiredWord;

  const handleExecuteReset = async () => {
    if (!isConfirmed) return;
    setResetting(true);
    try {
      const res = await apiClient.post('/utilities/reset-data', { wipeAll: resetType === 'factory' }, { timeout: 300000 });
      
      // 1. Purge all localStorage sent order history keys & cached state
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (_) {}

      // 2. Clear QueryClient and invalidate queries
      queryClient.clear();
      invalidateAfterStockWrite(queryClient);
      refetchSettings();

      // 3. Dispatch events to notify all active pages
      window.dispatchEvent(new CustomEvent('clear-app-cache'));
      window.dispatchEvent(new CustomEvent('clear-sent-history'));
      window.dispatchEvent(new CustomEvent('settings-updated'));

      toastEvent.trigger(res.data?.message || 'Database reset successfully', 'success');
      onClose();

      // 4. Force browser page reload after short delay to flush all module-level memory variables across SPA
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err) {
      const e = err as LocalApiError;
      toastEvent.trigger('System reset failed: ' + (e.response?.data?.error || e.message || 'Unknown error'), 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-global-modal flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl p-6 w-[95vw] max-w-xl relative shadow-2xl space-y-5">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-red-500/10 text-red-500 border border-red-500/30">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h2 className="text-base font-bold text-text">System Data Reset & Factory Initialization</h2>
            <p className="text-xs text-muted">Wipe operational data and integrations while preserving the Master Medicines catalog.</p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { setResetType('data'); setConfirmInput(''); }}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              resetType === 'data'
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-500 font-bold'
                : 'bg-bg3/30 border-border text-muted hover:text-text'
            }`}
          >
            <div className="font-bold text-xs flex items-center gap-1.5">
              <RotateCcw size={14} /> System Data Reset
            </div>
            <p className="text-[11px] mt-1 opacity-80">Wipes sales, purchases, inventory, CRM, reports, migration files, WhatsApp auth & Pharmarack tokens. Keeps Store Profile and Master Medicines catalog.</p>
          </button>

          <button
            type="button"
            onClick={() => { setResetType('factory'); setConfirmInput(''); }}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              resetType === 'factory'
                ? 'bg-red-500/10 border-red-500/40 text-red-500 font-bold'
                : 'bg-bg3/30 border-border text-muted hover:text-text'
            }`}
          >
            <div className="font-bold text-xs flex items-center gap-1.5">
              <Trash2 size={14} /> Full Factory Reset
            </div>
            <p className="text-[11px] mt-1 opacity-80">Total clean wipe: store profile, migrated data, sales, purchases, inventory, CRM, reports, WhatsApp auth, Pharmarack tokens. Preserves only Master Medicines catalog.</p>
          </button>
        </div>

        {/* Impact Summary */}
        <div className="bg-bg3/30 border border-border rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-bold text-text uppercase tracking-wider">Live Database Snapshot</h3>
          {loadingCounts ? (
            <div className="flex items-center text-xs text-muted py-2">
              <RefreshCw size={14} className="animate-spin mr-2" /> Counting active records...
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-xs">
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.medicines ?? 0}</div>
                <div className="text-[10px] text-emerald-400 font-semibold">Medicines (Kept)</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.inventory ?? 0}</div>
                <div className="text-[10px] text-muted">Batches</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.bills ?? 0}</div>
                <div className="text-[10px] text-muted">Sales Bills</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.purchases ?? 0}</div>
                <div className="text-[10px] text-muted">Purchases</div>
              </div>
              <div className="p-2 bg-bg rounded-lg border border-border">
                <div className="font-bold text-text">{dataCounts?.customers ?? 0}</div>
                <div className="text-[10px] text-muted">Customers</div>
              </div>
            </div>
          )}
        </div>

        {/* Confirmation Input */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-text">
            Type <span className="font-mono font-bold text-red-400">{requiredWord}</span> to confirm execution:
          </label>
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={`Type ${requiredWord} here`}
            className="w-full px-3 py-2 rounded-xl bg-bg border border-border text-text text-xs focus:border-red-500 focus:outline-none"
          />
        </div>

        {/* Modal Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-bg3 border border-border text-text font-bold text-xs rounded-xl hover:bg-bg3/80 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExecuteReset}
            disabled={!isConfirmed || resetting}
            className={`flex items-center gap-2 px-5 py-2 font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm ${
              isConfirmed && !resetting
                ? resetType === 'factory' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-muted/20 text-muted cursor-not-allowed border border-border'
            }`}
          >
            {resetting ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            <span>Execute {resetType === 'factory' ? 'Factory Reset' : 'System Reset'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// SUB-TAB 5: TRIGGER SCHEDULES & AUTOMATION
// ==========================================

