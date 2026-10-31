import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, api } from '../../services/api';
import { toastEvent } from '../../services/events';
import type { LocalApiError, StorageLocation, RegisteredDevice } from './settingsTypes';
import { RefreshCw, Clock, Shield, ShieldCheck, AlertTriangle, CheckCircle2, Check, ArrowDownToLine, ExternalLink, Copy, History, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { useUpdateStatus, setUpdateStatus, type RawUpdateFrame } from '../../services/updateStatusStore';

function LicenseManagementCard() {
  const [status, setStatus] = React.useState<{
    valid: boolean;
    mode: 'testing' | 'licensed' | 'grace' | 'expired';
    pharmacyName: string | null;
    licenseId: string | null;
    daysUntilExpiry: number | null;
    message: string;
  } | null>(null);
  const [machineId, setMachineId] = React.useState<string>('');
  const [copied, setCopied] = React.useState(false);

  // Form state
  const [showForm, setShowForm] = React.useState(false);
  const [inputLicenseId, setInputLicenseId] = React.useState('');
  const [inputLicenseKey, setInputLicenseKey] = React.useState('');
  const [activating, setActivating] = React.useState(false);
  const [activateError, setActivateError] = React.useState<string | null>(null);
  const [activateSuccess, setActivateSuccess] = React.useState<string | null>(null);

  const loadStatus = React.useCallback(async () => {
    try {
      const [statusRes, machineRes] = await Promise.allSettled([
        apiClient.get('/license/status'),
        apiClient.get('/license/machine-id'),
      ]);
      if (statusRes.status === 'fulfilled') setStatus(statusRes.value.data);
      if (machineRes.status === 'fulfilled') setMachineId(machineRes.value.data.machineId || '');
    } catch {
      // offline or unreachable
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleCopyMachineId = () => {
    if (!machineId) return;
    navigator.clipboard.writeText(machineId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputLicenseId.trim() || !inputLicenseKey.trim()) {
      setActivateError('Please enter both License ID and License Key');
      return;
    }
    setActivating(true);
    setActivateError(null);
    setActivateSuccess(null);
    try {
      const res = await apiClient.post('/license/activate', {
        licenseId: inputLicenseId.trim(),
        licenseKey: inputLicenseKey.trim(),
      });
      if (res.data.success) {
        setActivateSuccess(`License activated successfully for ${res.data.pharmacyName || 'this PC'}!`);
        setInputLicenseId('');
        setInputLicenseKey('');
        setShowForm(false);
        void loadStatus();
      } else {
        setActivateError(res.data.error || 'Activation failed');
      }
    } catch (err: any) {
      setActivateError(err?.response?.data?.error || err?.message || 'Could not connect to license server');
    } finally {
      setActivating(false);
    }
  };

  const getStatusBadge = () => {
    if (!status) return null;
    if (status.mode === 'licensed') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-600 border border-green-500/20">
          <CheckCircle2 size={13} />
          Active License
        </span>
      );
    }
    if (status.mode === 'testing') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
          <Clock size={13} />
          Testing Mode ({status.daysUntilExpiry}d left)
        </span>
      );
    }
    if (status.mode === 'grace') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-700 border border-amber-500/30">
          <AlertTriangle size={13} />
          Offline Grace ({status.daysUntilExpiry}d left)
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-500 border border-red-500/20">
        <AlertTriangle size={13} />
        License Unverified / Expired
      </span>
    );
  };

  return (
    <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Shield size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">App License & Machine Binding</h3>
            <p className="text-[11px] text-muted">
              1 PC = 1 Key · Hardware-locked anti-piracy protection
            </p>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      {/* Details summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-bg border border-border text-xs">
        <div>
          <span className="text-[11px] text-muted block">Licensed To:</span>
          <span className="font-bold text-text">
            {status?.pharmacyName || 'Testing / Unregistered'}
          </span>
        </div>
        <div>
          <span className="text-[11px] text-muted block">License ID:</span>
          <span className="font-mono font-medium text-text">
            {status?.licenseId || 'None (Testing Mode)'}
          </span>
        </div>
        <div className="sm:col-span-2 flex items-center justify-between gap-2 pt-2 border-t border-border">
          <div>
            <span className="text-[11px] text-muted block">This PC Machine ID:</span>
            <span className="font-mono text-[11px] text-text">
              {machineId || 'Detecting...'}
            </span>
          </div>
          {machineId && (
            <button
              type="button"
              onClick={handleCopyMachineId}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg2 hover:bg-bg3 border border-border text-[11px] font-medium text-text transition-colors cursor-pointer shrink-0"
              title="Copy Machine ID to send to support"
            >
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy ID'}
            </button>
          )}
        </div>
      </div>

      {/* Success banner */}
      {activateSuccess && (
        <div className="p-3 rounded-xl border border-green-500/20 bg-green-500/10 text-xs text-green-600 font-medium flex items-center gap-2">
          <CheckCircle2 size={14} className="shrink-0" />
          {activateSuccess}
        </div>
      )}

      {/* Action / Toggle Form */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          Need to enter a new key or activate after hardware change?
        </span>
        <button
          type="button"
          onClick={() => {
            setShowForm(v => !v);
            setActivateError(null);
          }}
          className="text-xs font-bold text-primary hover:underline cursor-pointer"
        >
          {showForm ? 'Cancel' : (status?.mode === 'licensed' ? 'Change License Key' : 'Enter License Key')}
        </button>
      </div>

      {/* Activation Form */}
      {showForm && (
        <form onSubmit={handleActivate} className="p-4 rounded-xl bg-bg border border-border space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-muted mb-1 uppercase tracking-wider">
                License ID
              </label>
              <input
                type="text"
                placeholder="e.g. PHARM-A3B2"
                value={inputLicenseId}
                onChange={e => setInputLicenseId(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-xl bg-bg2 border border-border text-xs text-text font-mono uppercase focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-muted mb-1 uppercase tracking-wider">
                License Key
              </label>
              <input
                type="text"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={inputLicenseKey}
                onChange={e => setInputLicenseKey(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-xl bg-bg2 border border-border text-xs text-text font-mono uppercase focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {activateError && (
            <div className="p-2.5 rounded-lg border border-red-500/20 bg-red-500/10 text-xs text-red-500 flex items-center gap-2">
              <AlertTriangle size={13} className="shrink-0" />
              {activateError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="submit"
              disabled={activating}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl shadow-sm hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={13} className={activating ? 'animate-spin' : ''} />
              {activating ? 'Validating Online...' : 'Activate & Lock to This PC'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
// ── Release History Types & Cache ─────────────────────────────────────────────
interface ReleaseHistoryItem {
  version: string;
  name: string;
  publishedAt: string;
  changelog: string;
  isNewerThanInstalled: boolean;
}

interface UpdateHistoryResponse {
  installed: string;
  releases: ReleaseHistoryItem[];
  offline?: boolean;
}

let cachedReleaseHistory: UpdateHistoryResponse | null = null;
let cachedReleaseHistoryTime = 0;

function formatCheckTime(isoStr?: string): string | null {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

function formatReleaseDate(isoStr?: string): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// ── Software Update Card ──────────────────────────────────────────────────────
// Isolated component driven by useUpdateStatus store so its state doesn't re-render entire Settings
function SoftwareUpdateCard() {
  const updateStatus = useUpdateStatus();
  const [checking, setChecking] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [downloadStarting, setDownloadStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [postponed, setPostponed] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyData, setHistoryData] = React.useState<UpdateHistoryResponse | null>(null);

  // Apple-design in-app terminal console state
  const [terminalOpen, setTerminalOpen] = React.useState(false);
  const [terminalLines, setTerminalLines] = React.useState<string[]>([]);
  const [terminalLoading, setTerminalLoading] = React.useState(false);
  const [terminalAutoScroll, setTerminalAutoScroll] = React.useState(true);
  const [copiedLog, setCopiedLog] = React.useState(false);
  const terminalScrollRef = React.useRef<HTMLDivElement>(null);

  const lastCheckedStr = formatCheckTime(updateStatus.lastCheckedAt);

  // Automated live polling while downloading or checking — user never has to click refresh
  React.useEffect(() => {
    if (updateStatus.state !== 'downloading' && !checking && !installing) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const pollStatus = async () => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        try {
          const res = await apiClient.get<RawUpdateFrame>('/license/update-status');
          if (res.data) setUpdateStatus(res.data);
        } catch (_) {}
      }
      if (active) {
        timer = setTimeout(pollStatus, 1200);
      }
    };

    timer = setTimeout(pollStatus, 1200);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [updateStatus.state, checking, installing]);

  // Real-time terminal log fetcher
  const fetchTerminalLogs = React.useCallback(async (quiet = false) => {
    if (!quiet) setTerminalLoading(true);
    try {
      const res = await apiClient.get<{ success: boolean; lines: string[] }>('/license/updater-log');
      if (res.data?.lines) {
        setTerminalLines(res.data.lines);
      }
    } catch (_) {
    } finally {
      if (!quiet) setTerminalLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!terminalOpen && !installing) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    void fetchTerminalLogs();

    const pollLogs = async () => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        await fetchTerminalLogs(true);
      }
      if (active) {
        timer = setTimeout(pollLogs, installing ? 1000 : 3000);
      }
    };

    timer = setTimeout(pollLogs, installing ? 1000 : 3000);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [terminalOpen, installing, fetchTerminalLogs]);

  React.useEffect(() => {
    if (terminalAutoScroll && terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [terminalLines, terminalAutoScroll]);

  const handleCopyLogs = () => {
    if (terminalLines.length === 0) return;
    navigator.clipboard.writeText(terminalLines.join('\n'));
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const handleCheckNow = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await apiClient.post<RawUpdateFrame>('/license/check-update');
      if (res.data) {
        setUpdateStatus(res.data);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error || e?.message || 'Could not reach update server. Check internet connection.');
    } finally {
      setChecking(false);
    }
  };

  const handleStartBackgroundDownload = async () => {
    setDownloadStarting(true);
    setError(null);
    try {
      const res = await apiClient.post<{ downloading?: boolean; latestVersion?: string }>('/license/start-download');
      setUpdateStatus({
        latestVersion: res.data?.latestVersion || updateStatus.version,
        currentVersion: updateStatus.currentVersion,
        hasUpdate: true,
        downloading: true,
        readyToInstall: false,
      });
      toastEvent.trigger('Background update download started...', 'info');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error || e?.message || 'Failed to start download.');
    } finally {
      setDownloadStarting(false);
    }
  };

  const handleInstallAndRestart = async () => {
    setInstalling(true);
    setTerminalOpen(true);
    const timeout = setTimeout(() => {
      setInstalling(false);
    }, 15000);
    try {
      const res = await fetch('/api/system/apply-update', { method: 'POST' });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!data.success) {
        clearTimeout(timeout);
        toastEvent.trigger(data.error || 'Failed to start update installation.', 'error');
        setInstalling(false);
      }
    } catch (err: unknown) {
      clearTimeout(timeout);
      setInstalling(false);
      toastEvent.trigger((err as Error)?.message || 'Update request failed.', 'error');
    }
  };

  const handlePostpone = () => {
    if (updateStatus.version) {
      sessionStorage.setItem(`update_later_${updateStatus.version}`, 'true');
    }
    setPostponed(true);
    toastEvent.trigger(`Update v${updateStatus.version || ''} postponed. You can install anytime from here.`, 'info');
  };

  const loadHistory = async (force = false) => {
    const now = Date.now();
    if (!force && cachedReleaseHistory && (now - cachedReleaseHistoryTime < 10 * 60 * 1000)) {
      setHistoryData(cachedReleaseHistory);
      return;
    }
    setHistoryLoading(true);
    try {
      const url = force ? '/license/update-history?refresh=true' : '/license/update-history';
      const res = await apiClient.get<UpdateHistoryResponse>(url);
      if (res.data) {
        cachedReleaseHistory = res.data;
        cachedReleaseHistoryTime = now;
        setHistoryData(res.data);
      }
    } catch {
      setHistoryData({
        installed: updateStatus.currentVersion,
        releases: cachedReleaseHistory?.releases || [],
        offline: true,
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && !historyData) {
      void loadHistory(false);
    }
  };

  const renderTerminalLine = (line: string, idx: number) => {
    const tsMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    const ts = tsMatch ? tsMatch[1] : null;
    const content = tsMatch ? tsMatch[2] : line;

    const stepMatch = content.match(/^(\[\d\/4\])\s*(.*)$/);
    const isError = /error|failed|exception/i.test(content);
    const isSuccess = /ok|success|complete|verified/i.test(content) && !isError;
    const isProgress = /installing update:\s*\d+%/i.test(content);

    return (
      <div key={idx} className="flex items-start gap-2 hover:bg-bg/40 px-1 py-0.5 rounded transition-colors text-[11px] font-mono leading-relaxed">
        {ts && (
          <span className="text-muted/60 select-none text-[10px] shrink-0 pt-0.5">{ts}</span>
        )}
        <div className="flex-1 break-all">
          {stepMatch ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/20 text-primary border border-primary/30">
                {stepMatch[1]}
              </span>
              <span className={isError ? 'text-red-400 font-bold' : isSuccess ? 'text-emerald-400 font-semibold' : 'text-text'}>
                {stepMatch[2]}
              </span>
            </span>
          ) : isProgress ? (
            <span className="text-primary font-bold">{content}</span>
          ) : isError ? (
            <span className="text-red-400 font-semibold">{content}</span>
          ) : isSuccess ? (
            <span className="text-emerald-400">{content}</span>
          ) : (
            <span className="text-text/90">{content}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4 shadow-sm">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <RefreshCw size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-text tracking-tight">Software Update</h3>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                Installed: v{updateStatus.currentVersion}
              </span>
            </div>
            <p className="text-[11px] text-muted mt-0.5">
              AI Pharmacy OS — automatic background sync &amp; live diagnostics
              {lastCheckedStr && <span className="ml-1">· Last checked {lastCheckedStr}</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Terminal Console Toggle Button */}
          <button
            type="button"
            onClick={() => {
              setTerminalOpen(v => !v);
              if (!terminalOpen) void fetchTerminalLogs();
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer active:scale-[0.97] ${
              terminalOpen
                ? 'bg-primary text-white border-primary shadow-sm'
                : 'bg-bg border-border text-text hover:bg-bg3'
            }`}
            title="Toggle macOS-style in-app Installer CLI Console"
          >
            <Terminal size={13} />
            <span>{terminalOpen ? 'Hide Terminal' : 'CLI Terminal'}</span>
          </button>

          <button
            type="button"
            onClick={handleCheckNow}
            disabled={checking}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary/10 text-primary border border-primary/20 text-xs font-bold rounded-xl hover:bg-primary/20 transition-all cursor-pointer active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking...' : 'Check Now'}
          </button>
        </div>
      </div>

      {/* Apple-Style Fluid Progress Bar: Active Downloading State */}
      {updateStatus.state === 'downloading' && (
        <div className="space-y-3 p-4 rounded-2xl bg-bg border border-border shadow-inner text-xs text-text">
          <div className="flex justify-between items-center text-xs font-semibold flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
              <span className="font-extrabold text-primary">
                Downloading Update v{updateStatus.version || ''}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                Live Auto-Sync
              </span>
            </div>
            <span className="font-mono text-text font-bold">
              {updateStatus.totalMB > 0
                ? `${updateStatus.downloadedMB} MB / ${updateStatus.totalMB} MB (${updateStatus.percent}%)`
                : (updateStatus.downloadedMB > 0
                  ? `${updateStatus.downloadedMB} MB (${updateStatus.percent}%)`
                  : `Connecting... (${updateStatus.percent}%)`)}
            </span>
          </div>

          <div className="w-full bg-bg3 border border-border/60 rounded-full h-3 overflow-hidden p-0.5 shadow-inner">
            <div
              className="bg-primary h-full transition-[width] duration-300 ease-out rounded-full shadow-sm"
              style={{ width: `${Math.min(100, Math.max(3, updateStatus.percent))}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>Downloading in background without interrupting POS sales</span>
            <span className="font-mono text-[10px] text-primary">{updateStatus.percent}% Completed</span>
          </div>
        </div>
      )}

      {/* Ready State */}
      {updateStatus.state === 'ready' && (
        <div className="p-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 text-xs text-text space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <span className="flex items-center gap-2 font-bold text-emerald-400">
              <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
              Update v{updateStatus.version} has been downloaded &amp; verified. Ready to install!
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleInstallAndRestart}
                disabled={installing}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition-all active:scale-[0.97] disabled:opacity-60 cursor-pointer shadow-md"
              >
                <RefreshCw size={13} className={installing ? 'animate-spin' : ''} />
                {installing ? 'Installing & restarting...' : 'Install & Restart Now'}
              </button>
              {!postponed && (
                <button
                  type="button"
                  onClick={handlePostpone}
                  className="px-3 py-2 bg-bg3 border border-border text-text rounded-xl text-xs font-semibold hover:bg-bg transition-all active:scale-[0.97] cursor-pointer"
                >
                  Later
                </button>
              )}
            </div>
          </div>
          {updateStatus.changelog && (
            <p className="text-[11px] text-muted whitespace-pre-line leading-relaxed border-t border-border/50 pt-2 font-sans">
              {updateStatus.changelog}
            </p>
          )}
        </div>
      )}

      {/* Error State */}
      {(updateStatus.state === 'error' || error || updateStatus.lastError) && (
        <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5 text-xs text-text space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-red-500 font-semibold">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{error || updateStatus.lastError || 'Update check or download failed.'}</span>
            </div>
            {updateStatus.hasUpdate && updateStatus.state !== 'downloading' && updateStatus.state !== 'ready' && (
              <button
                type="button"
                onClick={handleStartBackgroundDownload}
                disabled={downloadStarting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 transition-all cursor-pointer active:scale-[0.97] shadow-sm disabled:opacity-60"
              >
                <ArrowDownToLine size={13} className={downloadStarting ? 'animate-bounce' : ''} />
                {downloadStarting ? 'Starting...' : `Download Update (${updateStatus.totalMB > 0 ? `${updateStatus.totalMB} MB` : 'Fast Path'})`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Idle State with Update Available or Up to Date */}
      {updateStatus.state === 'idle' && (
        <div className={`p-4 rounded-2xl border text-xs ${
          updateStatus.hasUpdate
            ? 'bg-primary/5 border-primary/20 text-text'
            : 'bg-emerald-500/10 border-emerald-500/25 text-text'
        }`}>
          {updateStatus.hasUpdate ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-bold text-primary text-sm">
                  🎉 Update available — v{updateStatus.version} (Current: v{updateStatus.currentVersion})
                </span>
                <button
                  type="button"
                  onClick={handleStartBackgroundDownload}
                  disabled={downloadStarting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-xs font-black hover:bg-primary/90 transition-all cursor-pointer active:scale-[0.97] shadow-md shadow-primary/20 disabled:opacity-60"
                >
                  <ArrowDownToLine size={13} className={downloadStarting ? 'animate-bounce' : ''} />
                  {downloadStarting ? 'Starting...' : `Download Update (${updateStatus.totalMB > 0 ? `${updateStatus.totalMB} MB` : 'Fast Path'})`}
                </button>
              </div>
              {updateStatus.changelog && (
                <p className="text-[11px] text-muted whitespace-pre-line leading-relaxed border-t border-border pt-2 font-sans">
                  {updateStatus.changelog}
                </p>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-2 text-emerald-400 font-semibold">
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              You're up to date — Installed: v{updateStatus.currentVersion}
            </span>
          )}
        </div>
      )}

      {/* ── Apple-Design Embedded macOS Terminal Window Console ── */}
      {terminalOpen && (
        <div className="rounded-2xl border border-border bg-bg3 overflow-hidden shadow-xl animate-fade-in">
          {/* macOS Window Chrome Header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-bg2 border-b border-border select-none">
            {/* Traffic Light Dots */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTerminalOpen(false)}
                className="w-3 h-3 rounded-full bg-red-500 hover:opacity-80 transition-opacity cursor-pointer border border-border/40"
                title="Close console"
              />
              <button
                type="button"
                onClick={() => setTerminalOpen(false)}
                className="w-3 h-3 rounded-full bg-yellow-500 hover:opacity-80 transition-opacity cursor-pointer border border-border/40"
                title="Minimize console"
              />
              <button
                type="button"
                onClick={() => void fetchTerminalLogs()}
                className="w-3 h-3 rounded-full bg-green-500 hover:opacity-80 transition-opacity cursor-pointer border border-border/40"
                title="Refresh console"
              />
            </div>

            {/* Window Title */}
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-text">
              <Terminal size={13} className="text-primary" />
              <span>AI Pharmacy OS — Installer Console (logs/updater.log)</span>
            </div>

            {/* Right Tools */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted mr-1">
                <span className={`w-1.5 h-1.5 rounded-full ${installing ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
                <span>{installing ? 'INSTALLING' : 'IDLE'}</span>
              </div>

              <button
                type="button"
                onClick={() => setTerminalAutoScroll(v => !v)}
                className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors cursor-pointer ${
                  terminalAutoScroll
                    ? 'bg-primary/15 text-primary border-primary/30 font-bold'
                    : 'bg-bg text-muted border-border'
                }`}
                title="Toggle lock to bottom on new log lines"
              >
                Auto-scroll
              </button>

              <button
                type="button"
                onClick={handleCopyLogs}
                disabled={terminalLines.length === 0}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded bg-bg hover:bg-bg2 text-text border border-border transition-colors cursor-pointer disabled:opacity-40"
                title="Copy all logs to clipboard"
              >
                {copiedLog ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                <span>{copiedLog ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                type="button"
                onClick={() => void fetchTerminalLogs()}
                disabled={terminalLoading}
                className="p-1 rounded bg-bg hover:bg-bg2 text-text border border-border transition-colors cursor-pointer disabled:opacity-50"
                title="Reload latest logs"
              >
                <RefreshCw size={11} className={terminalLoading ? 'animate-spin text-primary' : ''} />
              </button>
            </div>
          </div>

          {/* Terminal Log Output Body */}
          <div
            ref={terminalScrollRef}
            className="p-3 max-h-72 overflow-y-auto dropdown-scroll bg-bg text-text font-mono text-[11px] space-y-0.5 select-text"
          >
            {terminalLines.length === 0 ? (
              <div className="py-8 text-center text-muted italic">
                {terminalLoading ? 'Loading latest updater logs...' : 'No updater log entries found on disk.'}
              </div>
            ) : (
              terminalLines.map((line, idx) => renderTerminalLine(line, idx))
            )}
          </div>
        </div>
      )}

      {/* Offline Standalone Installer Link if available */}
      {updateStatus.downloadUrl && (
        <div className="pt-2 text-[10px] text-muted flex items-center gap-1 border-t border-border/50">
          <span>Need full offline standalone installer for other PCs?</span>
          <a
            href={updateStatus.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5 font-medium"
          >
            Download Setup (.exe, ~980 MB) <ExternalLink size={10} />
          </a>
        </div>
      )}

      {/* Collapsible Recent Releases History */}
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={toggleHistory}
            className="flex items-center gap-2 text-xs font-bold text-text hover:text-primary transition-colors cursor-pointer"
          >
            <History size={14} className="text-primary" />
            <span>Recent Releases &amp; Changelogs</span>
            {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {historyOpen && (
            <button
              type="button"
              onClick={() => void loadHistory(true)}
              disabled={historyLoading}
              className="text-[11px] text-muted hover:text-text flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Refresh release history"
            >
              <RefreshCw size={11} className={historyLoading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          )}
        </div>

        {historyOpen && (
          <div className="mt-3 space-y-2">
            {historyLoading && !historyData && (
              <div className="p-3 text-center text-muted text-xs flex items-center justify-center gap-2">
                <RefreshCw size={13} className="animate-spin text-primary" />
                <span>Loading releases from GitHub...</span>
              </div>
            )}

            {historyData?.offline && (
              <div className="p-3 text-center text-muted text-xs italic bg-bg rounded-lg border border-border">
                Release history unavailable while offline.
              </div>
            )}

            {historyData && !historyData.offline && historyData.releases.length === 0 && (
              <div className="p-3 text-center text-muted text-xs bg-bg rounded-lg border border-border">
                No past releases recorded.
              </div>
            )}

            {historyData?.releases.map((rel) => {
              const isInstalled = rel.version === updateStatus.currentVersion;
              return (
                <div key={rel.version} className="p-3 rounded-xl bg-bg border border-border space-y-1.5 text-xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-text">v{rel.version}</span>
                      {rel.name && rel.name !== `v${rel.version}` && (
                        <span className="text-muted text-[11px]">({rel.name})</span>
                      )}
                      {isInstalled && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">
                          Installed
                        </span>
                      )}
                      {rel.isNewerThanInstalled && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                          Newer
                        </span>
                      )}
                    </div>
                    {rel.publishedAt && (
                      <span className="text-muted text-[11px]">{formatReleaseDate(rel.publishedAt)}</span>
                    )}
                  </div>
                  {rel.changelog && (
                    <p className="text-[11px] text-muted whitespace-pre-line leading-relaxed font-sans pt-1">
                      {rel.changelog}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-Tab 8: License & Software Updates ─────────────────────────────────────
export function LicenseAndUpdatesTab() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-bg2 border border-border rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text">License, Machine Binding & Software Updates</h2>
            <p className="text-xs text-muted mt-0.5">
              Manage your hardware-locked anti-piracy activation, review machine fingerprint, and install real-time application updates.
            </p>
          </div>
        </div>
      </div>

      <LicenseManagementCard />
      <SoftwareUpdateCard />
    </div>
  );
}

