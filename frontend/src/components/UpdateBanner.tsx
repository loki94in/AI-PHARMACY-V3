import { useEffect, useState } from 'react';
import { RefreshCw, ArrowDownToLine, Sparkles } from 'lucide-react';
import { toastEvent } from '../services/events';

interface UpdateInfo {
  latestVersion: string;
  downloadUrl?: string;
  changelog: string;
  readyToInstall?: boolean;
}

/**
 * UpdateBanner — non-intrusive update prompt.
 * 
 * Rules:
 * 1. Remains completely invisible while background download is in progress.
 * 2. ONLY appears when download is 100% complete and verified (readyToInstall: true).
 * 3. Shows two clear options: "Install Now" or "Later".
 * 4. "Later" stores dismissal in sessionStorage, skipping any further prompt until the next app restart.
 */
export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    // 1. Check if update was already downloaded and staged in previous session
    fetch('/api/license/update-status')
      .then(r => r.json())
      .then(data => {
        if (data?.readyToInstall && data?.latestVersion) {
          const isSkipped = sessionStorage.getItem(`update_later_${data.latestVersion}`) === 'true';
          if (!isSkipped) {
            setUpdate({
              latestVersion: data.latestVersion,
              changelog: data.changelog || '',
              readyToInstall: true,
            });
          }
        }
      })
      .catch(() => {});

    // 2. Real-time SSE listener
    const handler = (e: Event) => {
      const raw = (e as CustomEvent).detail;
      const data = raw?.payload || raw;
      if (!data?.latestVersion) return;

      // Only display prompt when download is complete and verified
      if (data.readyToInstall) {
        const isSkipped = sessionStorage.getItem(`update_later_${data.latestVersion}`) === 'true';
        if (!isSkipped) {
          setUpdate({
            latestVersion: data.latestVersion,
            downloadUrl: data.downloadUrl,
            changelog: data.changelog || '',
            readyToInstall: true,
          });
          setDismissed(false);
        }
      }
    };
    window.addEventListener('sse:update_available', handler);
    return () => window.removeEventListener('sse:update_available', handler);
  }, []);

  const handleInstallNow = async () => {
    setIsInstalling(true);
    try {
      const res = await fetch('/api/system/apply-update', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        toastEvent.trigger(data.error || 'Failed to start update installation.', 'error');
        setIsInstalling(false);
      }
      // On success the backend terminates to start Updater.bat — no reset needed
    } catch (_) {
      // Backend terminates server during install — catch is expected
    }
  };

  const handleLater = () => {
    if (update?.latestVersion) {
      sessionStorage.setItem(`update_later_${update.latestVersion}`, 'true');
    }
    setDismissed(true);
    toastEvent.trigger(`Update v${update?.latestVersion || ''} postponed until next app restart.`, 'info');
  };

  // Only render when the update is 100% downloaded and ready to install, and not skipped
  if (!update || !update.readyToInstall || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-primary text-white shadow-[0_4px_20px_rgba(0,0,0,0.25)] text-sm animate-fade-in border-b border-white/10">
      {/* Left: icon + version info */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="p-1.5 rounded-lg bg-white/20 text-white shrink-0">
          <Sparkles size={16} />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <span className="font-extrabold text-white text-xs sm:text-sm tracking-wide">
            Update Available: v{update.latestVersion}
          </span>
          <span className="text-white/80 text-[11px] sm:text-xs">
            Downloaded in background &amp; ready to install
          </span>
        </div>
        {update.changelog && (
          <button
            type="button"
            onClick={() => setShowChangelog(v => !v)}
            className="underline underline-offset-2 opacity-80 hover:opacity-100 text-xs text-white cursor-pointer shrink-0 ml-1"
          >
            {showChangelog ? 'Hide notes' : "What's new"}
          </button>
        )}
      </div>

      {/* Right: Later & Install Now actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleLater}
          disabled={isInstalling}
          className="px-3.5 py-1.5 rounded-xl font-bold text-white text-xs bg-white/15 hover:bg-white/25 border border-white/20 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
          title="Postpone update until next app restart"
        >
          Later
        </button>

        <button
          type="button"
          id="update-action-btn"
          onClick={handleInstallNow}
          disabled={isInstalling}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl font-black text-white text-xs bg-emerald-600 hover:bg-emerald-700 shadow-md transition-all cursor-pointer active:scale-95 disabled:opacity-50"
          title="Install update and restart AI Pharmacy OS"
        >
          {isInstalling ? (
            <>
              <RefreshCw size={13} className="animate-spin" />
              <span>Installing &amp; restarting...</span>
            </>
          ) : (
            <>
              <ArrowDownToLine size={13} />
              <span>Install Now</span>
            </>
          )}
        </button>
      </div>

      {/* Expandable changelog notes */}
      {showChangelog && update.changelog && (
        <div className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-xs whitespace-pre-line shadow-lg mt-1">
          <strong className="text-primary font-bold">Release Notes — v{update.latestVersion}</strong>
          <p className="mt-1 text-muted leading-relaxed font-sans">{update.changelog}</p>
        </div>
      )}
    </div>
  );
}
