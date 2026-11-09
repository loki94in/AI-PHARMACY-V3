import React, { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../services/api';
import {
  ShieldAlert,
  ShieldCheck,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Lock,
  AlertTriangle,
  Building2,
  ExternalLink,
  Laptop
} from 'lucide-react';

interface LicenseState {
  valid: boolean;
  mode: 'testing' | 'licensed' | 'grace' | 'expired' | 'revoked' | 'unlicensed' | 'mismatch';
  pharmacyName: string | null;
  licenseId: string | null;
  daysUntilExpiry: number | null;
  message: string;
  appVersion?: string;
}

interface LicenseGateProps {
  children: React.ReactNode;
}

export const LicenseGate: React.FC<LicenseGateProps> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<LicenseState | null>(null);
  const [machineId, setMachineId] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Form states for activation
  const [inputLicenseId, setInputLicenseId] = useState('');
  const [inputLicenseKey, setInputLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activateSuccess, setActivateSuccess] = useState<string | null>(null);

  // Form states for self-renewal
  const [renewalKey, setRenewalKey] = useState('');
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState<string | null>(null);
  const [renewSuccess, setRenewSuccess] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchLicenseStatus = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [statusRes, machineRes] = await Promise.allSettled([
        apiClient.get<LicenseState>('/license/status'),
        apiClient.get<{ machineId: string }>('/license/machine-id'),
      ]);

      if (statusRes.status === 'fulfilled' && statusRes.value.data) {
        setStatus(statusRes.value.data);
      }
      if (machineRes.status === 'fulfilled' && machineRes.value.data?.machineId) {
        setMachineId(machineRes.value.data.machineId);
      }
    } catch (_) {
      // Offline fallback: keep current status or set minimal unverified
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLicenseStatus();

    // Listen to SSE updates from backend
    const onLicenseChange = (e: Event) => {
      const customEvt = e as CustomEvent;
      if (customEvt.detail) {
        fetchLicenseStatus(true);
      }
    };
    window.addEventListener('sse-license-changed', onLicenseChange);

    return () => {
      window.removeEventListener('sse-license-changed', onLicenseChange);
    };
  }, [fetchLicenseStatus]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputLicenseId.trim() || !inputLicenseKey.trim()) {
      setActivateError('Please enter both License ID and License Key.');
      return;
    }
    setActivating(true);
    setActivateError(null);
    setActivateSuccess(null);

    try {
      const res = await apiClient.post('/license/activate', {
        licenseId: inputLicenseId.trim().toUpperCase(),
        licenseKey: inputLicenseKey.trim().toUpperCase(),
      });
      if (res.data?.success) {
        setActivateSuccess(`Activated successfully for ${res.data.pharmacyName || 'this PC'}!`);
        await fetchLicenseStatus();
      } else {
        setActivateError(res.data?.error || 'Activation failed.');
      }
    } catch (err: any) {
      setActivateError(err.response?.data?.error || err.message || 'Connection error with activation server.');
    } finally {
      setActivating(false);
    }
  };

  const handleRenew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewalKey.trim()) {
      setRenewError('Please enter a valid renewal key.');
      return;
    }
    setRenewing(true);
    setRenewError(null);
    setRenewSuccess(null);

    try {
      const res = await apiClient.post('/license/renew', {
        renewalKey: renewalKey.trim().toUpperCase(),
      });
      if (res.data?.success) {
        setRenewSuccess(res.data.message || 'License renewed for 1 Year!');
        setRenewalKey('');
        await fetchLicenseStatus();
      } else {
        setRenewError(res.data?.error || 'Renewal failed.');
      }
    } catch (err: any) {
      setRenewError(err.response?.data?.error || err.message || 'Renewal validation failed.');
    } finally {
      setRenewing(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await apiClient.post<LicenseState>('/license/sync');
      if (res.data) {
        setStatus(res.data);
      }
    } catch (err: any) {
      // Non-blocking sync error
    } finally {
      setSyncing(false);
    }
  };

  const copyMachineId = () => {
    if (machineId) {
      navigator.clipboard.writeText(machineId.replace('...', ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // If loading initially, show a subtle branded loading screen
  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-bg text-text">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <span className="text-xs text-muted font-semibold tracking-wider uppercase">Verifying License...</span>
        </div>
      </div>
    );
  }

  // If license is valid, unlock and render the full application!
  if (status?.valid) {
    return <>{children}</>;
  }

  // ── HARD LOCKOUT BARRIER ──────────────────────────────────────────────────────
  const mode = status?.mode || 'unlicensed';
  const isSuspended = mode === 'revoked';
  const isExpired = mode === 'expired';
  const isMismatch = mode === 'mismatch';
  const isUnlicensed = mode === 'unlicensed';

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-bg p-4 sm:p-6 text-text select-none">
      <div className="w-full max-w-lg bg-bg2 border border-border rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-text">AI Pharmacy OS</h1>
              <p className="text-[11px] text-muted">Intelligent Pharmacy Management & POS</p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-bg3 text-muted border border-border">
            {status?.appVersion ? `v${status.appVersion}` : 'Enterprise'}
          </span>
        </div>

        {/* Status Alert Banner */}
        <div className={`p-4 rounded-xl border flex items-start gap-3.5 ${
          isSuspended
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            : isExpired
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            : isMismatch
            ? 'bg-orange-500/10 border-orange-500/30 text-orange-300'
            : 'bg-primary/10 border-primary/30 text-text'
        }`}>
          {isSuspended ? (
            <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
          ) : isExpired ? (
            <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
          ) : isMismatch ? (
            <Laptop className="w-6 h-6 text-orange-400 shrink-0 mt-0.5" />
          ) : (
            <Lock className="w-6 h-6 text-primary shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <h2 className="text-xs font-bold uppercase tracking-wider">
              {isSuspended
                ? 'Subscription Access Suspended'
                : isExpired
                ? 'Annual License Expired'
                : isMismatch
                ? 'Hardware Device Mismatch'
                : 'License Activation Required'}
            </h2>
            <p className="text-xs leading-relaxed opacity-90">
              {status?.message || 'Access is locked until this device is authenticated with a valid license.'}
            </p>
          </div>
        </div>

        {/* Hardware Fingerprint Card */}
        <div className="p-3.5 rounded-xl bg-bg3 border border-border flex items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <span className="text-[10px] text-muted uppercase font-semibold tracking-wider block">PC Hardware Fingerprint</span>
            <div className="font-mono text-xs font-bold text-text truncate">
              {machineId || 'Generating device signature...'}
            </div>
          </div>
          <button
            type="button"
            onClick={copyMachineId}
            disabled={!machineId}
            className="px-2.5 py-1.5 rounded-lg bg-bg2 hover:bg-bg border border-border text-xs font-medium text-text flex items-center gap-1.5 transition-colors shrink-0"
            title="Copy hardware ID"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-muted" />}
            <span className="text-[11px]">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        {/* Case 1: First-time activation / Unlicensed */}
        {(isUnlicensed || isMismatch) && (
          <form onSubmit={handleActivate} className="space-y-3.5 pt-1">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">License ID</label>
              <input
                type="text"
                required
                value={inputLicenseId}
                onChange={e => setInputLicenseId(e.target.value.toUpperCase())}
                placeholder="e.g. PHARM-8A2F"
                className="w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-text font-mono text-xs uppercase focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">License Key</label>
              <input
                type="text"
                required
                value={inputLicenseKey}
                onChange={e => setInputLicenseKey(e.target.value.toUpperCase())}
                placeholder="e.g. A9X2-B14F-88C2-00E1"
                className="w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-text font-mono text-xs uppercase focus:outline-none focus:border-primary"
              />
            </div>

            {activateError && (
              <p className="text-xs text-rose-400 font-medium">{activateError}</p>
            )}
            {activateSuccess && (
              <p className="text-xs text-emerald-400 font-medium">{activateSuccess}</p>
            )}

            <button
              type="submit"
              disabled={activating}
              className="w-full py-2.5 bg-primary hover:bg-primary/90 active:scale-[0.99] text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 mt-2"
            >
              {activating ? (
                <div className="w-4 h-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
              ) : (
                <KeyRound className="w-4 h-4" />
              )}
              <span>{activating ? 'Verifying with License Server...' : 'Activate & Launch AI Pharmacy OS'}</span>
            </button>
          </form>
        )}

        {/* Case 2: Expired — Self-Renewal Form */}
        {isExpired && (
          <form onSubmit={handleRenew} className="space-y-3.5 pt-1">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
                Enter 1-Year Renewal Key
              </label>
              <input
                type="text"
                required
                value={renewalKey}
                onChange={e => setRenewalKey(e.target.value.toUpperCase())}
                placeholder="Enter renewal voucher or license key..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-text font-mono text-xs uppercase focus:outline-none focus:border-primary"
              />
            </div>

            {renewError && (
              <p className="text-xs text-rose-400 font-medium">{renewError}</p>
            )}
            {renewSuccess && (
              <p className="text-xs text-emerald-400 font-medium">{renewSuccess}</p>
            )}

            <button
              type="submit"
              disabled={renewing}
              className="w-full py-2.5 bg-primary hover:bg-primary/90 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
            >
              {renewing ? (
                <div className="w-4 h-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>{renewing ? 'Applying Renewal...' : 'Renew for Next Year (+365 Days)'}</span>
            </button>
          </form>
        )}

        {/* Secondary Actions & Sync Check */}
        <div className="pt-2 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted">
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing}
            className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-bg hover:bg-bg3 border border-border text-text font-semibold flex items-center justify-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-primary' : 'text-muted'}`} />
            <span>{syncing ? 'Checking Server...' : 'Sync / Check Status'}</span>
          </button>

          <span className="text-[11px] text-muted text-center sm:text-right">
            Need support? Contact your software administrator.
          </span>
        </div>
      </div>
    </div>
  );
};
