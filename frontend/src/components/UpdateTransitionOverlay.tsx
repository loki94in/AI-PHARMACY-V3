import React from 'react';
import { RefreshCw, ShieldCheck, Database, BookmarkCheck } from 'lucide-react';
import { useUpdateStatus } from '../services/updateStatusStore';

interface UpdateTransitionOverlayProps {
  isInstalling: boolean;
  version?: string | null;
}

/**
 * UpdateTransitionOverlay
 * High-end fullscreen transition overlay rendered during 1-click update installation.
 * Bridges the gap between in-app trigger and native updater window render, eliminating
 * the perception of a crash or blank screen.
 */
export default function UpdateTransitionOverlay({ isInstalling, version }: UpdateTransitionOverlayProps) {
  const updateStatus = useUpdateStatus();
  const targetVersion = version || updateStatus.version || 'Latest';

  if (!isInstalling) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Software Update in Progress"
      className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in"
    >
      <div className="bg-bg2 border border-border/90 max-w-lg w-full p-8 rounded-3xl shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-emerald-500 to-sky-500" />

        {/* Pulsing App Badge */}
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/25 text-primary flex items-center justify-center mb-4 shadow-inner">
          <RefreshCw size={32} className="animate-spin text-primary" />
        </div>

        {/* Heading */}
        <h2 className="text-xl font-black text-text tracking-tight mb-2">
          Upgrading to Version v{targetVersion}
        </h2>

        {/* Subtitle */}
        <p className="text-xs text-muted leading-relaxed mb-6 max-w-sm">
          Preserving your active session and launching the dedicated update installer. The app will update seamlessly and restart right where you left off.
        </p>

        {/* Progress Bar Animation */}
        <div className="w-full bg-bg3 border border-border/80 h-3 rounded-full overflow-hidden p-0.5 shadow-inner mb-6">
          <div className="bg-gradient-to-r from-primary via-emerald-400 to-sky-400 h-full w-full rounded-full animate-pulse" />
        </div>

        {/* Reassurance Grid */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-4 border-t border-border text-left">
          <div className="flex items-center gap-2 p-2 rounded-xl bg-bg3/60 border border-border/50">
            <Database size={14} className="text-emerald-500 shrink-0" />
            <div className="text-[11px] leading-tight">
              <span className="font-bold text-text block">Data Protected</span>
              <span className="text-muted text-[10px]">Auto DB backup</span>
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-xl bg-bg3/60 border border-border/50">
            <BookmarkCheck size={14} className="text-primary shrink-0" />
            <div className="text-[11px] leading-tight">
              <span className="font-bold text-text block">Session Saved</span>
              <span className="text-muted text-[10px]">Resumes active page</span>
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-xl bg-bg3/60 border border-border/50">
            <ShieldCheck size={14} className="text-sky-500 shrink-0" />
            <div className="text-[11px] leading-tight">
              <span className="font-bold text-text block">Auto Rollback</span>
              <span className="text-muted text-[10px]">Zero corruption</span>
            </div>
          </div>
        </div>

        {/* Footer Warning */}
        <p className="text-[11px] text-muted mt-5 flex items-center justify-center gap-1.5">
          <span>⚡</span>
          <span>Please keep your PC turned on. Handing off to updater now...</span>
        </p>
      </div>
    </div>
  );
}

