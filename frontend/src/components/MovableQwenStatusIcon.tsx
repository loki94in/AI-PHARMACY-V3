import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Sparkles, RefreshCw, AlertCircle, CheckCircle2, Pause, Play, Move, ExternalLink } from 'lucide-react';
import { apiClient } from '../services/api';
import { toastEvent } from '../services/events';

export type QwenState =
  | 'UNKNOWN'
  | 'DISABLED'
  | 'NOT_INSTALLED'
  | 'STARTING'
  | 'READY'
  | 'BUSY'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'ERROR';

export interface QwenStatusData {
  state: QwenState;
  enabled: boolean;
  installed: boolean;
  runtimeRunning: boolean;
  runtimeHealthy: boolean;
  inferenceReady: boolean;
  modelName: string;
  runtimeName: string;
  port: number;
  lastCheckedAt: string | null;
  lastSuccessfulInferenceAt: string | null;
  latencyMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  automationGate: 'open' | 'paused' | 'blocked';
  isPausedByUser?: boolean;
}

interface MovableQwenStatusIconProps {
  onOpenAssistant: () => void;
}

const STORAGE_KEY = 'qwen_icon_pos';
const ICON_SIZE = 52;
const PADDING = 16;

export const MovableQwenStatusIcon: React.FC<MovableQwenStatusIconProps> = ({ onOpenAssistant }) => {
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
      }
    } catch (_) {}
    return {
      x: typeof window !== 'undefined' ? window.innerWidth - ICON_SIZE - PADDING - 10 : 800,
      y: typeof window !== 'undefined' ? window.innerHeight - ICON_SIZE - PADDING - 70 : 600
    };
  });

  const [status, setStatus] = useState<QwenStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [showPopover, setShowPopover] = useState(false);

  const dragStartRef = useRef<{ mouseX: number; mouseY: number; posX: number; posY: number } | null>(null);
  const hasMovedRef = useRef<boolean>(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Clamp position to stay safely within viewport boundaries
  const clampPosition = useCallback((x: number, y: number) => {
    const maxX = Math.max(PADDING, window.innerWidth - ICON_SIZE - PADDING);
    const maxY = Math.max(PADDING, window.innerHeight - ICON_SIZE - PADDING);
    return {
      x: Math.min(Math.max(PADDING, x), maxX),
      y: Math.min(Math.max(PADDING, y), maxY)
    };
  }, []);

  // Fetch status from backend
  const fetchStatus = useCallback(async (refresh = false) => {
    try {
      setIsLoading(true);
      const res = await apiClient.get<{ success: boolean; data: QwenStatusData }>(
        `/local-ai/status${refresh ? '?refresh=true' : ''}`
      );
      if (res.data?.success && res.data.data) {
        setStatus(res.data.data);
      }
    } catch (_) {
      // Backend status probe fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch and SSE event listeners
  useEffect(() => {
    fetchStatus();

    const handleSse = () => {
      fetchStatus();
    };

    window.addEventListener('sse-local-ai-status', handleSse);
    window.addEventListener('sse-ai-gate-status', handleSse);

    return () => {
      window.removeEventListener('sse-local-ai-status', handleSse);
      window.removeEventListener('sse-ai-gate-status', handleSse);
    };
  }, [fetchStatus]);

  // Viewport resize boundary check
  useEffect(() => {
    const handleResize = () => {
      setPosition(prev => {
        const clamped = clampPosition(prev.x, prev.y);
        if (clamped.x !== prev.x || clamped.y !== prev.y) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped));
          return clamped;
        }
        return prev;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  // Click outside to close popover
  useEffect(() => {
    if (!showPopover) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [showPopover]);

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Primary button only
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y
    };
    hasMovedRef.current = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = moveEvent.clientX - dragStartRef.current.mouseX;
      const dy = moveEvent.clientY - dragStartRef.current.mouseY;

      if (!hasMovedRef.current && Math.hypot(dx, dy) > 5) {
        hasMovedRef.current = true;
      }

      if (hasMovedRef.current) {
        const nextX = dragStartRef.current.posX + dx;
        const nextY = dragStartRef.current.posY + dy;
        setPosition(clampPosition(nextX, nextY));
      }
    };

    const onMouseUp = () => {
      if (hasMovedRef.current) {
        setPosition(current => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
          return current;
        });
      }
      dragStartRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Touch drag handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    dragStartRef.current = {
      mouseX: touch.clientX,
      mouseY: touch.clientY,
      posX: position.x,
      posY: position.y
    };
    hasMovedRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragStartRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - dragStartRef.current.mouseX;
    const dy = touch.clientY - dragStartRef.current.mouseY;

    if (!hasMovedRef.current && Math.hypot(dx, dy) > 5) {
      hasMovedRef.current = true;
    }

    if (hasMovedRef.current) {
      const nextX = dragStartRef.current.posX + dx;
      const nextY = dragStartRef.current.posY + dy;
      setPosition(clampPosition(nextX, nextY));
    }
  };

  const handleTouchEnd = () => {
    if (hasMovedRef.current) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    }
    dragStartRef.current = null;
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowUp') dy = -20;
    else if (e.key === 'ArrowDown') dy = 20;
    else if (e.key === 'ArrowLeft') dx = -20;
    else if (e.key === 'ArrowRight') dx = 20;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenAssistant();
      return;
    } else if (e.key === 'Escape') {
      setShowPopover(false);
      return;
    }

    if (dx !== 0 || dy !== 0) {
      e.preventDefault();
      setPosition(prev => {
        const next = clampPosition(prev.x + dx, prev.y + dy);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    }
  };

  // Quick Action: Retry or Start runtime
  const handleRetryStart = async () => {
    try {
      setIsRetrying(true);
      const res = await apiClient.post<{ success: boolean; message: string; data: QwenStatusData }>(
        '/local-ai/retry-start'
      );
      if (res.data?.success) {
        setStatus(res.data.data);
        toastEvent.trigger(res.data.message || 'Qwen runtime started.', 'success');
      } else {
        toastEvent.trigger('Failed to start Qwen runtime.', 'error');
      }
    } catch (err: any) {
      toastEvent.trigger(`Start error: ${err.message}`, 'error');
    } finally {
      setIsRetrying(false);
    }
  };

  // Quick Action: Toggle AI automation pause
  const handleToggleGatePause = async () => {
    try {
      const isPaused = status?.automationGate === 'paused' || status?.isPausedByUser;
      const endpoint = isPaused ? '/local-ai/automation-resume' : '/local-ai/automation-pause';
      const res = await apiClient.post<{ success: boolean; message: string }>(endpoint, {
        reason: 'Toggled via status icon'
      });
      if (res.data?.success) {
        toastEvent.trigger(res.data.message, 'info');
        fetchStatus(true);
      }
    } catch (err: any) {
      toastEvent.trigger(`Gate toggle error: ${err.message}`, 'error');
    }
  };

  // Determine semantic color and badge text
  const state: QwenState = status?.state || 'UNKNOWN';
  let badgeColor = 'bg-gray-400';
  let badgeLabel = 'Checking...';
  let statusText = 'Unknown';

  if (state === 'READY') {
    badgeColor = 'bg-green';
    badgeLabel = 'Ready';
    statusText = 'Qwen Ready';
  } else if (state === 'STARTING') {
    badgeColor = 'bg-amber-500';
    badgeLabel = 'Starting';
    statusText = 'Model Loading';
  } else if (state === 'BUSY') {
    badgeColor = 'bg-amber-500';
    badgeLabel = 'Busy';
    statusText = 'Slots Busy';
  } else if (state === 'DEGRADED') {
    badgeColor = 'bg-red-500';
    badgeLabel = 'Degraded';
    statusText = 'Inference Degraded';
  } else if (state === 'OFFLINE') {
    badgeColor = 'bg-red-500';
    badgeLabel = 'Offline';
    statusText = 'Offline';
  } else if (state === 'ERROR') {
    badgeColor = 'bg-red-500';
    badgeLabel = 'Error';
    statusText = 'Error';
  } else if (state === 'DISABLED') {
    badgeColor = 'bg-gray-400';
    badgeLabel = 'Disabled';
    statusText = 'AI Disabled';
  } else if (state === 'NOT_INSTALLED') {
    badgeColor = 'bg-gray-400';
    badgeLabel = 'Missing';
    statusText = 'Not Installed';
  }

  // Calculate popover positioning relative to icon
  const isTopHalf = position.y < window.innerHeight / 2;
  const isLeftHalf = position.x < window.innerWidth / 2;

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        touchAction: 'none'
      }}
      className="z-40 select-none"
    >
      {/* Floating Draggable Icon Button */}
      <button
        type="button"
        tabIndex={0}
        role="button"
        aria-label={`Qwen AI Assistant: ${statusText}. Click to open chat or view status, drag or use arrow keys to move.`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (!hasMovedRef.current) {
            setShowPopover(prev => !prev);
          }
        }}
        onDoubleClick={() => {
          onOpenAssistant();
        }}
        className="relative group w-13 h-13 rounded-2xl bg-bg2 border border-border shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <Bot className="w-6 h-6 text-text group-hover:scale-105 transition-transform" />

        {/* Live Status Indicator Dot */}
        <span
          className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-bg2 ${badgeColor} transition-colors`}
        />

        {/* Small drag hint icon on hover */}
        <span className="absolute -bottom-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 bg-bg3 rounded text-muted">
          <Move className="w-2.5 h-2.5" />
        </span>
      </button>

      {/* Floating Status Popover Card */}
      {showPopover && (
        <div
          className={`absolute w-72 bg-bg2 border border-border rounded-xl shadow-2xl p-4 text-text text-xs space-y-3 animate-in fade-in zoom-in-95 duration-100 ${
            isTopHalf ? 'top-15' : 'bottom-15'
          } ${isLeftHalf ? 'left-0' : 'right-0'}`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <div>
                <div className="font-semibold text-sm leading-none">Qwen Local AI</div>
                <div className="text-[10px] text-muted mt-0.5">CPU-only · Qwen3-1.7B</div>
              </div>
            </div>
            {state === 'READY' && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider bg-green text-white">
                Ready
              </span>
            )}
            {state === 'STARTING' && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider bg-amber-500 text-white">
                Starting
              </span>
            )}
            {state === 'BUSY' && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider bg-amber-500 text-white">
                Busy
              </span>
            )}
            {(state === 'OFFLINE' || state === 'DEGRADED' || state === 'ERROR') && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider bg-red-500 text-white">
                {badgeLabel}
              </span>
            )}
            {(state === 'DISABLED' || state === 'NOT_INSTALLED' || state === 'UNKNOWN') && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider bg-bg3 text-muted border border-border">
                {badgeLabel}
              </span>
            )}
          </div>

          {/* Diagnostics Info */}
          <div className="space-y-1.5 py-1 text-muted text-[11px]">
            <div className="flex justify-between">
              <span>Readiness State:</span>
              <span className="font-medium text-text">{state}</span>
            </div>
            {status?.port ? (
              <div className="flex justify-between">
                <span>Active Port:</span>
                <span className="font-mono text-text">127.0.0.1:{status.port}</span>
              </div>
            ) : null}
            {status?.latencyMs ? (
              <div className="flex justify-between">
                <span>Inference Latency:</span>
                <span className="font-medium text-text">{status.latencyMs} ms</span>
              </div>
            ) : null}
            <div className="flex justify-between items-center">
              <span>Automation Gate:</span>
              <span
                className={`font-semibold capitalize ${
                  status?.automationGate === 'open'
                    ? 'text-green'
                    : status?.automationGate === 'paused'
                    ? 'text-amber-500'
                    : 'text-red-500'
                }`}
              >
                {status?.automationGate || 'Unknown'}
              </span>
            </div>

            {status?.errorMessage && (
              <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] leading-tight">
                {status.errorMessage}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 border-t border-border space-y-1.5">
            <button
              type="button"
              onClick={() => {
                setShowPopover(false);
                onOpenAssistant();
              }}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-primary text-white font-medium hover:brightness-110 active:scale-[0.99] transition-all"
            >
              <Bot className="w-3.5 h-3.5" />
              Open Assistant Chat <span className="text-[10px] opacity-75 font-mono">(Ctrl+Space)</span>
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={isRetrying}
                onClick={handleRetryStart}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-bg3 border border-border text-muted hover:text-text hover:bg-bg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                <span>{state === 'READY' ? 'Refresh' : 'Start / Retry'}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleGatePause}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-bg3 border border-border text-muted hover:text-text hover:bg-bg transition-colors"
              >
                {status?.automationGate === 'paused' ? (
                  <>
                    <Play className="w-3 h-3 text-green" />
                    <span>Resume AI</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3 text-amber-500" />
                    <span>Pause AI</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
