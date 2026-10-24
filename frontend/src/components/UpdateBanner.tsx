import { useState } from 'react';
import { RefreshCw, ArrowDownToLine, Sparkles } from 'lucide-react';
import { toastEvent } from '../services/events';
import { useUpdateStatus } from '../services/updateStatusStore';

/**
 * UpdateBanner — Ready-only banner rendered when update package has downloaded
 * and verified in background. Progress is owned by the Topbar ticker.
 */
export default function UpdateBanner() {
  const updateStatus = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const targetVersion = updateStatus.version;
  const isSkipped = Boolean(targetVersion && sessionStorage.getItem(`update_later_${targetVersion}`) === 'true');

  if (updateStatus.state !== 'ready' || !targetVersion || dismissed || isSkipped) {
    return null;
  }

  const handleInstallNow = async () => {
    setIsInstalling(true);
    const timeout = setTimeout(() => {
      setIsInstalling(false);
    }, 15000);

    try {
      const res = await fetch('/api/system/apply-update', { method: 'POST' });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!data.success) {
        clearTimeout(timeout);
        toastEvent.trigger(data.error || 'Failed to start update installation.', 'error');
        setIsInstalling(false);
      }
    } catch (err: unknown) {
      clearTimeout(timeout);
      setIsInstalling(false);
      toastEvent.trigger((err as Error)?.message || 'Update request failed.', 'error');
    }
  };

  const handleLater = () => {
    if (targetVersion) {
      sessionStorage.setItem(`update_later_${targetVersion}`, 'true');
    }
    setDismissed(true);
    toastEvent.trigger(`Update v${targetVersion} postponed until next app restart.`, 'info');
  };

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-[9999] flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-primary text-white shadow-[0_4px_20px_rgba(0,0,0,0.25)] text-sm animate-fade-in border-b border-white/10">
        {/* Left: icon + version info */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-white/20 text-white shrink-0">
            <Sparkles size={16} />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
            <span className="font-extrabold text-white text-xs sm:text-sm tracking-wide">
              Update Available: v{targetVersion}
            </span>
            <span className="text-white/80 text-[11px] sm:text-xs">
              Downloaded in background &amp; ready to install
            </span>
          </div>
          {updateStatus.changelog && (
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
                <span>Launching Updater...</span>
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
        {showChangelog && updateStatus.changelog && (
          <div className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-xs whitespace-pre-line shadow-lg mt-1">
            <strong className="text-primary font-bold">Release Notes — v{targetVersion}</strong>
            <p className="mt-1 text-muted leading-relaxed font-sans">{updateStatus.changelog}</p>
          </div>
        )}
      </div>

      {/* State C: Fullscreen transition overlay when user clicks Install Now */}
      {isInstalling && (
        <div className="fixed inset-0 z-[10000] bg-black/75 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-bg2 border border-border max-w-md w-full p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/20 text-primary flex items-center justify-center">
              <RefreshCw size={28} className="animate-spin" />
            </div>
            <h3 className="text-lg font-black text-text">Launching Update Installer...</h3>
            <p className="text-xs text-muted leading-relaxed">
              AI Pharmacy OS is closing to apply version <span className="font-bold text-text">v{targetVersion}</span>. 
              The update console window will show live installation progress and restart the application automatically in a few seconds.
            </p>
            <div className="w-full bg-bg3 h-1.5 rounded-full overflow-hidden mt-2">
              <div className="bg-primary h-full w-full animate-pulse rounded-full" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
