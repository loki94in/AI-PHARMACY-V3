import { useEffect, useState } from 'react';
import { RefreshCw, ArrowDownToLine, Sparkles } from 'lucide-react';
import { toastEvent } from '../services/events';

interface UpdateInfo {
  latestVersion: string;
  downloadUrl?: string;
  changelog: string;
  readyToInstall?: boolean;
}

interface DownloadProgress {
  version: string;
  percent: number;
  downloaded: number;
  total: number;
}

/**
 * UpdateBanner — end-to-end update notification, live progress, and handoff.
 */
export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
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
        } else if (data?.downloading && data?.latestVersion) {
          setDownloadProgress({
            version: data.latestVersion,
            percent: data.downloadProgress || 0,
            downloaded: 0,
            total: 0,
          });
        }
      })
      .catch(() => {});

    // 2. Real-time SSE listener for update status
    const updateHandler = (e: Event) => {
      const raw = (e as CustomEvent).detail;
      const data = raw?.payload || raw;
      if (!data?.latestVersion) return;

      if (data.readyToInstall) {
        setDownloadProgress(null);
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

    // 3. Real-time SSE listener for download progress
    const progressHandler = (e: Event) => {
      const raw = (e as CustomEvent).detail;
      const data = raw?.payload || raw;
      if (!data) return;

      if (data.status === 'downloading') {
        setDownloadProgress({
          version: data.version || '',
          percent: data.percent || 0,
          downloaded: data.downloaded || 0,
          total: data.total || 0,
        });
      } else if (data.status === 'ready') {
        setDownloadProgress(null);
      }
    };

    window.addEventListener('sse:update_available', updateHandler);
    window.addEventListener('sse:update_progress', progressHandler);
    return () => {
      window.removeEventListener('sse:update_available', updateHandler);
      window.removeEventListener('sse:update_progress', progressHandler);
    };
  }, []);

  const handleInstallNow = async () => {
    setIsInstalling(true);
    const timeout = setTimeout(() => {
      setIsInstalling(false);
    }, 15000);

    try {
      const res = await fetch('/api/system/apply-update', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        clearTimeout(timeout);
        toastEvent.trigger(data.error || 'Failed to start update installation.', 'error');
        setIsInstalling(false);
      }
    } catch (err: any) {
      clearTimeout(timeout);
      setIsInstalling(false);
      toastEvent.trigger(err?.message || 'Update request failed.', 'error');
    }
  };

  const handleLater = () => {
    if (update?.latestVersion) {
      sessionStorage.setItem(`update_later_${update.latestVersion}`, 'true');
    }
    setDismissed(true);
    toastEvent.trigger(`Update v${update?.latestVersion || ''} postponed until next app restart.`, 'info');
  };

  // State A: Download in progress banner
  if (downloadProgress && !update?.readyToInstall) {
    const downloadedMB = (downloadProgress.downloaded / (1024 * 1024)).toFixed(1);
    const totalMB = (downloadProgress.total / (1024 * 1024)).toFixed(1);
    const hasSize = downloadProgress.total > 0;

    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-bg2 text-text shadow-[0_4px_20px_rgba(0,0,0,0.25)] text-sm animate-fade-in border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-500 shrink-0">
            <RefreshCw size={15} className="animate-spin" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
            <span className="font-extrabold text-xs sm:text-sm tracking-wide">
              Downloading Update v{downloadProgress.version}
            </span>
            <span className="text-muted text-[11px] sm:text-xs">
              {hasSize ? `${downloadedMB} MB of ${totalMB} MB` : 'Downloading in background...'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="w-32 sm:w-48 bg-bg3 h-2 rounded-full overflow-hidden border border-border">
            <div
              className="bg-primary h-full transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, Math.max(2, downloadProgress.percent))}%` }}
            />
          </div>
          <span className="text-xs font-mono font-bold text-primary min-w-[36px]">
            {downloadProgress.percent}%
          </span>
        </div>
      </div>
    );
  }

  // State B: Ready to install banner (or dismissed)
  if (!update || !update.readyToInstall || dismissed) return null;

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
        {showChangelog && update.changelog && (
          <div className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-xs whitespace-pre-line shadow-lg mt-1">
            <strong className="text-primary font-bold">Release Notes — v{update.latestVersion}</strong>
            <p className="mt-1 text-muted leading-relaxed font-sans">{update.changelog}</p>
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
              AI Pharmacy OS is closing to apply version <span className="font-bold text-text">v{update?.latestVersion}</span>. 
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
