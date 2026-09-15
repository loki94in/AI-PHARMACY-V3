import { useEffect, useState } from 'react';
import { RefreshCw, X, ArrowDownToLine } from 'lucide-react';
import { toastEvent } from '../services/events';

interface UpdateInfo {
  latestVersion: string;
  downloadUrl?: string;
  changelog: string;
  downloading?: boolean;
  readyToInstall?: boolean;
}

/**
 * UpdateBanner — floats at the top of the app when a new version is available.
 * Shows ONE button only — no raw GitHub URL exposed to the user.
 * States: downloading → ready to install → installing.
 */
export default function UpdateBanner() {
  const [update, setUpdate]           = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed]     = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [isInstalling, setIsInstalling]   = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const raw  = (e as CustomEvent).detail;
      const data = raw?.payload || raw;
      if (!data?.latestVersion) return;
      setUpdate({
        latestVersion:  data.latestVersion,
        downloadUrl:    data.downloadUrl,
        changelog:      data.changelog || '',
        downloading:    !!data.downloading,
        readyToInstall: !!data.readyToInstall,
      });
      setDismissed(false);
    };
    window.addEventListener('sse:update_available', handler);
    return () => window.removeEventListener('sse:update_available', handler);
  }, []);

  const handleInstallAndRestart = async () => {
    setIsInstalling(true);
    try {
      const res  = await fetch('/api/system/apply-update', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        toastEvent.trigger(data.error || 'Failed to start update installation.', 'error');
        setIsInstalling(false);
      }
      // On success the backend kills the process — no need to reset state
    } catch (_) {
      // Backend terminates server during install — this catch is expected
    }
  };

  if (!update || dismissed) return null;

  // Determine label & action for the single action button
  const isSpinning = isInstalling || update.downloading;

  const statusText = isInstalling
    ? 'Installing & restarting...'
    : update.readyToInstall
    ? `v${update.latestVersion} ready — click to install`
    : update.downloading
    ? `Downloading v${update.latestVersion}...`
    : `AI Pharmacy v${update.latestVersion} available`;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 px-4 py-2.5 bg-primary text-white shadow-lg text-sm animate-fade-in">
      {/* Left: status text + what's new */}
      <div className="flex items-center gap-2 min-w-0">
        <RefreshCw size={15} className={`shrink-0 ${isSpinning ? 'animate-spin' : ''}`} />
        <span className="font-semibold text-white truncate">{statusText}</span>
        {update.changelog && (
          <button
            onClick={() => setShowChangelog(v => !v)}
            className="underline underline-offset-2 opacity-80 hover:opacity-100 text-xs text-white cursor-pointer shrink-0"
          >
            {showChangelog ? 'Hide' : "What's new"}
          </button>
        )}
      </div>

      {/* Right: single action button + dismiss */}
      <div className="flex items-center gap-2 shrink-0">
        {!isInstalling && (
          <button
            id="update-action-btn"
            onClick={update.readyToInstall ? handleInstallAndRestart : undefined}
            disabled={update.downloading && !update.readyToInstall}
            className={`flex items-center gap-1.5 px-3.5 py-1 rounded-lg font-bold text-white text-xs shadow-md transition-all cursor-pointer active:scale-95
              ${update.readyToInstall
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-white/20 opacity-70 cursor-default'}`}
            title={update.readyToInstall
              ? 'Install update and restart AI Pharmacy OS'
              : 'Update is downloading in background — please wait'}
          >
            {update.readyToInstall
              ? <><RefreshCw size={13} /> Install &amp; Restart</>
              : <><ArrowDownToLine size={13} /> Downloading...</>}
          </button>
        )}

        <button
          onClick={() => setDismissed(true)}
          className="p-1 opacity-70 hover:opacity-100 transition-opacity text-white cursor-pointer"
          title="Dismiss"
        >
          <X size={15} />
        </button>
      </div>

      {/* Changelog dropdown */}
      {showChangelog && update.changelog && (
        <div className="absolute top-full left-0 right-0 bg-bg border-b border-border px-4 py-3 text-text text-xs whitespace-pre-line shadow-md">
          <strong className="text-primary">Release Notes — v{update.latestVersion}</strong>
          <p className="mt-1 text-muted leading-relaxed">{update.changelog}</p>
        </div>
      )}
    </div>
  );
}
