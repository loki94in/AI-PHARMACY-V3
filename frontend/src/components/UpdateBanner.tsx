import { useEffect, useState } from 'react';
import { Download, X, RefreshCw } from 'lucide-react';

interface UpdateInfo {
  latestVersion: string;
  downloadUrl: string;
  changelog: string;
}

/**
 * UpdateBanner — floats at the top of the app when a new version is available.
 * Listens to DOM CustomEvents dispatched by the global SSE handler (F3 rule:
 * no second EventSource connection — consume useGlobalSseInvalidation events).
 */
export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    // Consume SSE via DOM CustomEvent dispatched by the global SSE listener
    const handler = (e: Event) => {
      const raw = (e as CustomEvent).detail;
      const data = raw?.payload || raw;
      if (!data || !data.latestVersion) return;
      setUpdate({
        latestVersion: data.latestVersion,
        downloadUrl:   data.downloadUrl,
        changelog:     data.changelog || '',
      });
      setDismissed(false);
    };

    window.addEventListener('sse:update_available', handler);
    return () => window.removeEventListener('sse:update_available', handler);
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 px-4 py-2.5 bg-primary text-white shadow-lg text-sm">
      <div className="flex items-center gap-2">
        <RefreshCw size={15} className="shrink-0 animate-spin" style={{ animationDuration: '3s' }} />
        <span className="font-medium">
          AI Pharmacy v{update.latestVersion} is available!
        </span>
        {update.changelog && (
          <button
            onClick={() => setShowChangelog(v => !v)}
            className="underline underline-offset-2 opacity-80 hover:opacity-100 text-xs text-white"
          >
            {showChangelog ? 'Hide' : "What's new"}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <a
          href={update.downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 border border-white/30 px-3 py-1 rounded-lg font-medium transition-colors text-white text-xs"
        >
          <Download size={13} />
          Download Update
        </a>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 opacity-70 hover:opacity-100 transition-opacity text-white"
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

