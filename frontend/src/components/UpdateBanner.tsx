import { useState, useEffect, useRef } from 'react';
import { ArrowDownToLine, Sparkles, X, ChevronDown, ChevronUp } from 'lucide-react';
import { toastEvent } from '../services/events';
import { useUpdateStatus, applyUpdateNow } from '../services/updateStatusStore';
import UpdateTransitionOverlay from './UpdateTransitionOverlay';

function renderFormattedChangelog(text: string) {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('##'));

  if (lines.length === 0) {
    return <p className="mt-2 text-muted leading-relaxed font-sans">{text}</p>;
  }

  return (
    <ul className="mt-2 space-y-1.5 text-xs text-text leading-relaxed">
      {lines.map((line, idx) => {
        const clean = line.replace(/^[-*•]\s*/, '');
        const parts = clean.split(/(\*\*[^*]+\*\*)/g);
        return (
          <li key={idx} className="flex items-start gap-2">
            <span className="text-primary font-bold text-sm leading-none shrink-0 mt-0.5">•</span>
            <span className="leading-snug">
              {parts.map((part, pIdx) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return <strong key={pIdx} className="font-bold text-text">{part.slice(2, -2)}</strong>;
                }
                return <span key={pIdx} className="text-muted">{part}</span>;
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * UpdateBanner — Discreet, non-intrusive floating card in the bottom-right corner.
 * Never obscures top navigation or active counter-billing views.
 * Owns the full-screen UpdateTransitionOverlay during active installation.
 */
export default function UpdateBanner() {
  const updateStatus = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const lastNotifiedRef = useRef<string | null>(null);

  const targetVersion = updateStatus.version;
  const isSkipped = Boolean(targetVersion && sessionStorage.getItem(`update_later_${targetVersion}`) === 'true');

  // Surface update card when update is downloaded and ready to install
  const isSilentOptionB = false;

  useEffect(() => {
    if (updateStatus.state === 'ready' && targetVersion && lastNotifiedRef.current !== targetVersion && !isSkipped) {
      lastNotifiedRef.current = targetVersion;
      toastEvent.trigger(`🚀 AI Pharmacy OS v${targetVersion} is ready to install!`, 'success');
    }
  }, [updateStatus.state, targetVersion, isSkipped]);

  const handleInstallNow = async () => {
    const res = await applyUpdateNow();
    if (!res.success) {
      toastEvent.trigger(res.error || 'Failed to start update installation.', 'error');
    }
  };

  const handleLater = () => {
    if (targetVersion) {
      sessionStorage.setItem(`update_later_${targetVersion}`, 'true');
    }
    setDismissed(true);
    toastEvent.trigger(`Update v${targetVersion} postponed until next restart. You can install anytime in Settings.`, 'info');
  };

  return (
    <>
      {/* Full-screen seamless transition screen when update install is executing */}
      <UpdateTransitionOverlay isInstalling={updateStatus.isInstalling} version={targetVersion} />

      {/* Floating Ready Pill / Card (Suppressed under Option B to protect counter billing) */}
      {!isSilentOptionB && updateStatus.state === 'ready' && targetVersion && !dismissed && !isSkipped && !updateStatus.isInstalling && (
        <aside
          role="region"
          aria-label="Software update ready"
          className="fixed bottom-5 right-5 z-[9990] max-w-sm w-[calc(100vw-2.5rem)] bg-bg2 border border-border/90 rounded-2xl shadow-2xl p-4 animate-fade-in text-text"
        >
          {/* Card Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                <Sparkles size={16} />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-text text-sm tracking-tight">
                    Update Ready
                  </span>
                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-500 font-mono text-[10px] font-bold border border-emerald-500/20">
                    v{targetVersion}
                  </span>
                </div>
                <p className="text-muted text-[11px] leading-tight mt-0.5">
                  Downloaded in background &amp; verified.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLater}
              className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer"
              title="Postpone update"
            >
              <X size={15} />
            </button>
          </div>

          {/* Collapsible Release Highlights */}
          {updateStatus.changelog && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowChangelog(v => !v)}
                className="flex items-center justify-between w-full text-[11px] font-semibold text-primary hover:underline cursor-pointer"
              >
                <span>{showChangelog ? 'Hide notes' : "What's new in this update"}</span>
                {showChangelog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>

              {showChangelog && (
                <div className="mt-2 p-2.5 rounded-xl bg-bg border border-border/80 max-h-48 overflow-y-auto text-xs">
                  {renderFormattedChangelog(updateStatus.changelog)}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-3.5 pt-3 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleLater}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-muted hover:text-text hover:bg-bg3 border border-border/70 transition-all cursor-pointer"
            >
              Later
            </button>

            <button
              type="button"
              onClick={handleInstallNow}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md transition-all cursor-pointer active:scale-[0.97]"
            >
              <ArrowDownToLine size={13} />
              <span>Install &amp; Restart</span>
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
