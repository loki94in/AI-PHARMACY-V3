import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, api } from '../../services/api';
import { toastEvent } from '../../services/events';
import type { LocalApiError, StorageLocation, RegisteredDevice } from './settingsTypes';
import { RefreshCw, Clock, Shield, ShieldCheck, AlertTriangle, CheckCircle2, Check, ArrowDownToLine, ExternalLink, Copy } from 'lucide-react';

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

// ── Software Update Card ──────────────────────────────────────────────────────
// Isolated component so its state doesn't re-render the entire Settings page
function SoftwareUpdateCard() {
  const [checking, setChecking] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [downloadStarting, setDownloadStarting] = React.useState(false);
  const [downloadProgress, setDownloadProgress] = React.useState<{
    percent: number;
    transferredMB: number;
    totalMB: number;
    status: string;
  } | null>(null);
  const [installedVersion, setInstalledVersion] = React.useState<string>('0.1.27');
  const [result, setResult] = React.useState<{
    hasUpdate: boolean;
    currentVersion?: string;
    latestVersion?: string;
    downloadUrl?: string;
    changelog?: string;
    downloading?: boolean;
    readyToInstall?: boolean;
    downloadProgress?: {
      percent: number;
      transferredMB: number;
      totalMB: number;
      status: string;
    };
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lastChecked, setLastChecked] = React.useState<string | null>(null);
  const [postponed, setPostponed] = React.useState(false);

  React.useEffect(() => {
    apiClient.get('/license/version').then((res) => {
      if (res.data?.version || res.data?.appVersion) {
        setInstalledVersion(res.data.version || res.data.appVersion);
      }
    }).catch(() => {});

    apiClient.get('/license/update-status').then((res) => {
      const data = res.data;
      if (data && (data.hasUpdate || data.readyToInstall || data.downloading)) {
        if (data.currentVersion) setInstalledVersion(data.currentVersion);
        setResult(data);
        if (data.downloadProgress) {
          setDownloadProgress(data.downloadProgress);
        }
      }
    }).catch(() => {});
  }, []);

  const handleCheckNow = async () => {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiClient.post('/license/check-update');
      const data = res.data;
      if (data?.currentVersion) setInstalledVersion(data.currentVersion);
      setResult(data);
      if (data?.downloadProgress) setDownloadProgress(data.downloadProgress);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not reach update server. Check internet connection.');
    } finally {
      setChecking(false);
    }
  };

  const handleStartBackgroundDownload = async () => {
    setDownloadStarting(true);
    setError(null);
    try {
      await apiClient.post('/license/start-download');
      setResult((prev) => prev ? { ...prev, downloading: true, readyToInstall: false } : prev);
      toastEvent.trigger('Background update download started...', 'info');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to start download.');
    } finally {
      setDownloadStarting(false);
    }
  };

  React.useEffect(() => {
    const updateHandler = (e: Event) => {
      const raw  = (e as CustomEvent).detail;
      const data = raw?.payload || raw;
      if (!data?.latestVersion) return;
      setResult((prev) => ({
        hasUpdate:      true,
        currentVersion: data.currentVersion || prev?.currentVersion || installedVersion,
        latestVersion:  data.latestVersion,
        downloadUrl:    data.downloadUrl || prev?.downloadUrl,
        changelog:      data.changelog !== undefined ? data.changelog : (prev?.changelog || ''),
        downloading:    !!data.downloading,
        readyToInstall: !!data.readyToInstall,
      }));
    };

    const progressHandler = (e: Event) => {
      const raw = (e as CustomEvent).detail;
      const data = raw?.payload || raw;
      if (!data) return;
      setDownloadProgress(data);
      if (data.status === 'downloading') {
        setResult((prev) => prev ? { ...prev, downloading: true, readyToInstall: false } : prev);
      } else if (data.status === 'ready') {
        setResult((prev) => prev ? { ...prev, downloading: false, readyToInstall: true } : prev);
      } else if (data.status === 'error') {
        setResult((prev) => prev ? { ...prev, downloading: false } : prev);
        setError(data.error || 'Failed to download update.');
      }
    };

    window.addEventListener('sse:update_available', updateHandler);
    window.addEventListener('sse:update_progress', progressHandler);
    return () => {
      window.removeEventListener('sse:update_available', updateHandler);
      window.removeEventListener('sse:update_progress', progressHandler);
    };
  }, [installedVersion]);

  const handleInstallAndRestart = async () => {
    setInstalling(true);
    try {
      const res  = await fetch('/api/system/apply-update', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        toastEvent.trigger(data.error || 'Failed to start update installation.', 'error');
        setInstalling(false);
      }
      // On success the backend kills the process — no need to reset state
    } catch (_) {
      // Backend terminates server during install — this catch is expected
    }
  };

  const handlePostpone = () => {
    if (result?.latestVersion) {
      sessionStorage.setItem(`update_later_${result.latestVersion}`, 'true');
    }
    setPostponed(true);
    toastEvent.trigger(`Update v${result?.latestVersion || ''} postponed. You can install anytime from here.`, 'info');
  };

  return (
    <div className="bg-bg2 border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <RefreshCw size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-text">Software Update</h3>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                Installed: v{installedVersion}
              </span>
            </div>
            <p className="text-[11px] text-muted mt-0.5">
              AI Pharmacy OS — auto-checks every 15 days when internet is available
              {lastChecked && <span className="ml-1">· Last checked {lastChecked}</span>}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCheckNow}
          disabled={checking}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 text-xs font-bold rounded-lg hover:bg-primary/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
          {checking ? 'Checking...' : 'Check Now'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`p-3 rounded-xl border text-xs ${
          result.hasUpdate
            ? 'bg-primary/5 border-primary/20 text-text'
            : 'bg-emerald-500/10 border-emerald-500/25 text-text'
        }`}>
          {result.hasUpdate ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-bold text-primary">
                  🎉 Update available — v{result.latestVersion} (Current: v{result.currentVersion || installedVersion})
                </span>
                {result.readyToInstall ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleInstallAndRestart}
                      disabled={installing}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60 cursor-pointer shadow-sm"
                    >
                      <RefreshCw size={12} className={installing ? 'animate-spin' : ''} />
                      {installing ? 'Installing & restarting...' : 'Install & Restart Now'}
                    </button>
                    {!postponed && (
                      <button
                        type="button"
                        onClick={handlePostpone}
                        className="px-2.5 py-1.5 bg-bg3 border border-border text-text rounded-lg text-xs font-semibold hover:bg-bg transition-colors cursor-pointer"
                      >
                        Later
                      </button>
                    )}
                  </div>
                ) : result.downloading ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-xs font-bold">
                    <ArrowDownToLine size={13} className="animate-bounce" />
                    Downloading in background... {downloadProgress?.percent != null ? `${downloadProgress.percent}%` : ''}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartBackgroundDownload}
                    disabled={downloadStarting}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/90 transition-all cursor-pointer shadow-sm shadow-primary/20 disabled:opacity-60"
                  >
                    <ArrowDownToLine size={13} className={downloadStarting ? 'animate-bounce' : ''} />
                    {downloadStarting ? 'Starting...' : 'Download Update (105 MB)'}
                  </button>
                )}
              </div>

              {/* Progress bar when downloading */}
              {result.downloading && (
                <div className="space-y-1.5 p-2.5 rounded-lg bg-bg border border-border">
                  <div className="flex justify-between text-[11px] font-semibold text-primary">
                    <span className="flex items-center gap-1">
                      <ArrowDownToLine size={12} />
                      Downloading OTA update package in background...
                    </span>
                    <span>{downloadProgress?.transferredMB || 0} MB / {downloadProgress?.totalMB || 105} MB ({downloadProgress?.percent || 0}%)</span>
                  </div>
                  <div className="w-full bg-border rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-300 rounded-full"
                      style={{ width: `${downloadProgress?.percent || 0}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted">
                    You can continue working normally. Once download completes and is verified, you will be prompted to install.
                  </p>
                </div>
              )}

              {/* Verified ready notice */}
              {result.readyToInstall && (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                    Update v{result.latestVersion} has been downloaded &amp; verified. Ready to install!
                  </span>
                  {postponed && (
                    <button
                      type="button"
                      onClick={handleInstallAndRestart}
                      disabled={installing}
                      className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white rounded-md text-[11px] font-bold hover:bg-emerald-700 transition-colors shrink-0 cursor-pointer"
                    >
                      <RefreshCw size={11} className={installing ? 'animate-spin' : ''} />
                      Install Now
                    </button>
                  )}
                </div>
              )}

              {result.changelog && (
                <p className="text-[11px] text-muted whitespace-pre-line leading-relaxed border-t border-border pt-2">
                  {result.changelog}
                </p>
              )}

              {result.downloadUrl && (
                <div className="pt-2 text-[10px] text-muted flex items-center gap-1 border-t border-border/50">
                  <span>Need full offline standalone installer for other PCs?</span>
                  <a
                    href={result.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-0.5 font-medium"
                  >
                    Download Setup (.exe, ~980 MB) <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              You're up to date — Installed: v{result.currentVersion || result.latestVersion || installedVersion}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-xs text-red-500 flex items-center gap-2">
          <AlertTriangle size={13} className="shrink-0" />
          {error}
        </div>
      )}
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

