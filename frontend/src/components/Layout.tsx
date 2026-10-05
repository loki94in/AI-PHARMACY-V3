import React, { useState, useEffect, useRef, useCallback, useMemo, memo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  PackageSearch,
  ShoppingCart,
  Receipt,
  Users,
  Settings as SettingsIcon,
  Activity,
  Brain,
  LogOut,
  Database,
  RotateCcw,
  ClipboardList,
  Plus,
  Check,
  AlertTriangle,
  Bell,
  BellRing,
  X,
  Trash2,
  ExternalLink,
  Info,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Mail as MailIcon,
  Smartphone,
  ClipboardPlus,
  RefreshCw,
  Building2,
  Clock,
  Edit,
  Edit3,
  Menu,
  Truck,
  Package,
  Keyboard,
  FileText,
  Loader2,
  ChevronDown,
  BrainCircuit,
  MessageCircle,
  MessageSquareText,
  Zap,
  Globe,
  Image as ImageIcon,
  Power,
  Store as StoreIcon,
} from 'lucide-react';
import { shortcutEvent, SHORTCUT_DIRECTORY, modalManager, useModalEscape } from '../services/keyboardShortcuts';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Activity as ActivityIcon,
  ShieldCheck as ShieldCheckIcon,
  Clock as ClockIcon,
  AlertTriangle as AlertIcon,
  MessageSquare as MessageSquareIcon,
  Send as SendIcon,
  Calendar,
  RotateCw,
} from 'lucide-react';


import { toastEvent, quickOrderEvent, liveCartAddEvent, refillEvent, whatsappQueueEvent, messageSendEvent, specialOrdersEvent, automationHubEvent, whatsappReadinessEvent } from '../services/events';
import type { ToastEventDetail } from '../services/events';
import type { WhatsAppReadinessState } from '../types/api';
import { subscribeRefillCartJobs, getRefillCartJobs, isRefillJobRunning, openRefillCartJob, startRefillCartJob } from '../services/refillCartJobs';
// Lazy-loaded modals & popovers — prevents bundling heavy components into the main shell
const QuickOrderModal = lazy(() => import('./QuickOrderModal').then(m => ({ default: m.QuickOrderModal })));
const LiveCartAddModal = lazy(() => import('./LiveCartAddModal').then(m => ({ default: m.LiveCartAddModal })));
// Refill → Live Cart popup + background-run result cards (store: services/refillCartJobs.ts)
const RefillCartJobHost = lazy(() => import('./RefillCartModal').then(m => ({ default: m.RefillCartJobHost })));
const WhatsAppQueuePopover = lazy(() => import('./WhatsAppQueuePopover').then(m => ({ default: m.WhatsAppQueuePopover })));
const AutomationHubPopover = lazy(() => import('./AutomationHubPopover'));
const StagedReviewModal = lazy(() => import('./StagedReviewModal').then(m => ({ default: m.StagedReviewModal })));
const MobileConnectionModal = lazy(() => import('./MobileConnectionModal').then(m => ({ default: m.MobileConnectionModal })));
const BackupCenterModal = lazy(() => import('./BackupCenterModal'));

import { ConnectedDevicesFooterBar } from './ConnectedDevicesFooterBar';
import { QuickAssistSidebar } from './QuickAssistSidebar';
import { DailyCommunicationsModal } from './DailyCommunicationsModal';
import { api, apiClient, isCompactInventoryCacheReady, setCompactInventoryCache } from '../services/api';
import type { SpecialOrder, Refill, AutomationNotification } from '../services/api';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { useApiQuery } from '../hooks/useApiQuery';
import { pageImports } from '../lib/pageImports';
import { useFetchMode } from '../hooks/useFetchMode';
import { useGlobalSseInvalidation } from '../hooks/useGlobalSseInvalidation';
import { getFormattedFailureReason } from '../utils/whatsappFailureReason';
import { isOnlineOrder } from '../utils/onlineOrders';
import { getToastStyle, type ToastStyle } from '../utils/toastStyle';

export interface AppNotification {
  id: number | string;
  message: string;
  type: 'success' | 'error' | 'info' | 'mail' | 'automation';
  time: Date;
  read: boolean;
  link?: string;
  distributor?: string;
  qty?: string | number;
}

// Defer non-critical startup work until the browser is idle (falls back to a 2s
// timeout where requestIdleCallback isn't available, e.g. Safari), so it doesn't
// compete with first paint / LCP. Returns a cancel function for effect cleanup.

// ──────────────────────────────────────────────
// Notification Types
// ──────────────────────────────────────────────
export interface AppNotification {
  id: number | string;
  message: string;
  type: 'success' | 'error' | 'info' | 'mail' | 'automation';
  time: Date;
  read: boolean;
  link?: string;
  distributor?: string;
  qty?: string | number;
}

interface LocalActionLogRow {
  id: number;
  action_type?: string | null;
  description?: string | null;
  created_at?: string;
}

interface LocalApiErrorShape {
  response?: { status?: number; data?: { error?: string } };
  message?: string;
}

// ──────────────────────────────────────────────
// Sidebar
// ──────────────────────────────────────────────
const ExitAppButton = () => {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [shutdownSettled, setShutdownSettled] = useState(false);

  const handleConfirmExit = async () => {
    setIsShuttingDown(true);
    (window as any).__AI_PHARMACY_EXITING__ = true;
    try {
      toastEvent.trigger('Shutting down AI Pharmacy OS...', 'info');
      await api.shutdownSystem();
    } catch (_) {}

    try {
      window.open('', '_self', '');
      window.close();
    } catch (_) {}

    // In case running in a browser tab where script cannot close the tab directly,
    // transition the overlay state cleanly after a short grace period
    setTimeout(() => {
      setShutdownSettled(true);
    }, 2500);
  };

  return (
    <>
      <button
        onClick={() => setShowConfirmModal(true)}
        className="w-full flex items-center gap-3 px-4 py-2 rounded-xl text-xs font-semibold text-red-500/80 hover:text-white hover:bg-red-500 transition-all cursor-pointer border border-red-500/20"
        title="Shut down AI Pharmacy OS and close application"
      >
        <Power size={16} />
        <span>Exit App</span>
      </button>

      {/* Confirmation Modal */}
      {showConfirmModal && !isShuttingDown && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 text-left animate-fade-in">
          <div className="bg-bg border border-glass-border w-[95vw] max-w-md rounded-3xl p-6 space-y-4 text-left shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-2xl bg-red-500/10 text-red-500 border border-red-500/20 shrink-0">
                <Power size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-base text-text">Exit AI Pharmacy OS?</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  This will cleanly create an auto-backup, stop all background services, release port 5175, and close the application.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-bg2 border border-border text-[11px] text-muted space-y-1.5">
              <div className="flex items-center gap-2 text-text font-medium">
                <Check size={13} className="text-emerald-500 shrink-0" />
                <span>Auto-backup and database safely closed</span>
              </div>
              <div className="flex items-center gap-2 text-text font-medium">
                <Check size={13} className="text-emerald-500 shrink-0" />
                <span>Background sync workers and sidecars terminated</span>
              </div>
              <div className="flex items-center gap-2 text-text font-medium">
                <Check size={13} className="text-emerald-500 shrink-0" />
                <span>Frontend window and backend server terminate together</span>
              </div>
            </div>

            <div className="flex justify-end items-center gap-2 pt-2 border-t border-glass-border/40">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 text-xs font-semibold text-muted hover:text-text rounded-xl hover:bg-bg3 transition-colors cursor-pointer border border-border"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmExit}
                className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors cursor-pointer flex items-center gap-2 shadow-lg shadow-red-600/25 active:scale-95"
              >
                <Power size={14} />
                <span>Shut Down & Exit</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Shutdown in Progress Fullscreen Overlay */}
      {isShuttingDown && createPortal(
        <div className="fixed inset-0 z-[999999] bg-bg/95 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 select-none animate-fade-in">
          <div className="p-4 rounded-3xl bg-red-500/10 text-red-500 mb-4 animate-pulse border border-red-500/20">
            <Power size={36} />
          </div>
          <h2 className="text-lg font-extrabold text-text tracking-tight mb-1.5">
            {shutdownSettled ? 'AI Pharmacy OS Shut Down' : 'Shutting Down AI Pharmacy OS...'}
          </h2>
          <p className="text-xs text-muted max-w-sm leading-relaxed">
            {shutdownSettled
              ? 'The backend server process has terminated cleanly and port 5175 is free. You can safely close this tab or window (Ctrl+W or Alt+F4).'
              : 'Creating database shutdown backup and stopping background services...'}
          </p>
          {!shutdownSettled ? (
            <div className="mt-5 flex items-center gap-2 text-xs text-muted font-medium bg-bg2 px-4 py-2 rounded-full border border-glass-border">
              <Loader2 size={14} className="animate-spin text-red-500" />
              <span>Closing application completely...</span>
            </div>
          ) : (
            <button
              onClick={() => {
                try {
                  window.open('', '_self', '');
                  window.close();
                } catch (_) {}
                setTimeout(() => {
                  try {
                    window.location.href = 'about:blank';
                  } catch (_) {}
                }, 200);
              }}
              className="mt-5 px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all cursor-pointer shadow-md"
            >
              Close Window (Ctrl+W)
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
};

// memo: chrome is isolated from navigation re-renders — Sidebar subscribes to
// the router itself so the active highlight updates without Layout re-renders.
const Sidebar = memo(({
  stagedSalesCount = 0,
  stagedPurchasesCount = 0,
  onOpenReview,
  mobileOpen = false,
  onClose,
}: {
  stagedSalesCount?: number;
  stagedPurchasesCount?: number;
  onOpenReview?: () => void;
  mobileOpen?: boolean;
  onClose?: () => void;
}) => {
  const queryClient = useQueryClient();
  const routeLoc = useLocation();
  const hoverPrefetchControl = useFetchMode('layout.hoverPrefetch');
  const menuItems = [
    { path: '/pos', label: 'Sales / POS', icon: <ShoppingCart size={18} /> },
    { path: '/sells', label: 'Sell', icon: <Receipt size={18} /> },
    { path: '/inventory', label: 'Inventory', icon: <PackageSearch size={18} /> },
    { path: '/purchase-history', label: 'Purchase History', icon: <ClipboardList size={18} /> },
    { path: '/purchases', label: 'Purchases', icon: <Receipt size={18} /> },
    { path: '/mail', label: 'Distributor Mail', icon: <Activity size={18} /> },
    { path: '/reports', label: 'Reports', icon: <LayoutDashboard size={18} /> },
    { path: '/pharmarack-cart', label: 'Pharmarack Cart', icon: <ShoppingCart size={18} /> },
    { path: '/investigation', label: 'Investigation Center', icon: <PackageSearch size={18} /> },
    { path: '/ai-engineering', label: 'Pharma Intelligence', icon: <BrainCircuit size={18} /> },
    { path: '/learning', label: 'AI Learning', icon: <Brain size={18} /> },
    { path: '/dispatch', label: 'Dispatch', icon: <Truck size={18} /> },
    { path: '/website-orders', label: 'Online Orders', icon: <Globe size={18} /> },
    { path: '/online-catalog', label: 'Online Store Catalog', icon: <StoreIcon size={18} /> },
    { path: '/live-cart', label: 'Pharmacy Live Cart', icon: <ShoppingCart size={18} /> },
    { path: '/portal', label: 'Customer Portal', icon: <Globe size={18} /> },
    { path: '/crm', label: 'CRM & Messages', icon: <Users size={18} /> },
    { path: '/returns', label: 'Supplier Returns', icon: <RotateCcw size={18} /> },
    { path: '/database', label: 'Master Database', icon: <Database size={18} /> },
    { path: '/phone-sales', label: 'Phone Sales', icon: <Smartphone size={18} /> },
    { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { path: '/migration', label: 'Data Migration', icon: <Database size={18} /> },
    { path: '/settings', label: 'Settings', icon: <SettingsIcon size={18} /> },
    { path: '/audit', label: 'Audit Center', icon: <ShieldCheckIcon size={18} /> },
  ];

  return (
    <>
      {/* Mobile/tablet backdrop — click to dismiss */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[8999] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        className={`
          fixed inset-y-0 left-0 z-drawer w-72 max-w-[85vw]
          lg:static lg:z-auto lg:w-64 lg:max-w-none
          bg-glass-bg border-r border-glass-border backdrop-blur-xl flex flex-col h-full
          transition-transform duration-300 ease-in-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
        `}
      >
        <div className="p-5 border-b border-glass-border flex flex-col gap-1 bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3 w-full relative">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-sky/20 to-sky/5 border border-sky/30 shadow-[0_0_15px_rgba(14,165,233,0.2)] shrink-0 transition-all duration-300">
              <svg className="w-6 h-6 text-sky drop-shadow-[0_0_6px_rgba(14,165,233,0.6)]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 4V20M4 12H20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                <path d="M12 8.5V15.5M8.5 12H15.5" stroke="#fafafa" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="flex-1">
              <h1 className="text-base font-black tracking-wider bg-gradient-to-r from-text to-sky bg-clip-text text-transparent leading-none">
                AI PHARMACY
              </h1>
              <p className="text-[9px] text-muted tracking-wider uppercase font-bold mt-1.5 leading-none flex items-center gap-1.5">
                <span>OS 2.0</span>
                <span className="text-primary font-mono text-[9.5px]">v0.1.27</span>
              </p>
            </div>
            <div className="shrink-0 pl-2 flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green"></span>
              </span>
              <button
                onClick={onClose}
                aria-label="Close navigation menu"
                className="lg:hidden p-1.5 -mr-1.5 rounded-lg text-muted hover:text-text hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Sync Review Indicator */}
        {(stagedSalesCount > 0 || stagedPurchasesCount > 0) && (
          <button
            onClick={onOpenReview}
            className="mx-4 my-2.5 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-left hover:bg-amber-500/20 transition-all duration-300 animate-pulse cursor-pointer shrink-0"
          >
            <div className="flex-1 min-w-0 pr-1">
              <div className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Sync Reviews Pending</div>
              <div className="text-[9px] text-muted truncate mt-0.5">
                {stagedSalesCount > 0 ? `${stagedSalesCount} sales ` : ''}
                {stagedSalesCount > 0 && stagedPurchasesCount > 0 ? '& ' : ''}
                {stagedPurchasesCount > 0 ? `${stagedPurchasesCount} purchases` : ''}
              </div>
            </div>
            <ChevronRight size={14} className="text-amber-500 shrink-0" />
          </button>
        )}

        <div className="py-4 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          <div className="px-5 mb-2 text-[10px] font-bold tracking-[0.15em] uppercase text-muted/70">Main Menu</div>
          <nav className="flex flex-col gap-1">
            {menuItems.map((item) => {
              const isActive = (() => {
                const [basePath, queryStr] = item.path.split('?');
                if (routeLoc.pathname !== basePath) return false;
                const targetTab = queryStr ? new URLSearchParams(queryStr).get('tab') : null;
                const currentTab = new URLSearchParams(routeLoc.search).get('tab');
                if (targetTab) {
                  return currentTab === targetTab;
                } else {
                  if (basePath === '/reports') return true;
                  if (basePath === '/database') return !currentTab || currentTab === 'products';
                  if (basePath === '/learning') return !currentTab || currentTab === 'clinical';
                  if (basePath === '/returns') return !currentTab || currentTab === 'returns';
                  if (basePath === '/pharmarack-cart') return !currentTab || currentTab === 'cart';
                  return true;
                }
              })();

              // Staged sync count badges
              let badge = null;
              if (item.path.startsWith('/sells') && stagedSalesCount > 0) {
                badge = (
                  <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[9px] font-black text-white px-1 border border-black/40 animate-pulse">
                    {stagedSalesCount}
                  </span>
                );
              } else if (item.path.startsWith('/purchases') && stagedPurchasesCount > 0) {
                badge = (
                  <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-accent text-[9px] font-black text-black px-1 border border-black/40 animate-pulse">
                    {stagedPurchasesCount}
                  </span>
                );
              }

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onMouseEnter={() => {
                    const basePath = item.path.split('?')[0];
                    pageImports[basePath]?.();

                    if (!hoverPrefetchControl.shouldFetch) return;

                    // Prefetch API data for primary queries on hover (improved page switch response time)
                    try {
                      if (basePath === '/dashboard') {
                        queryClient.prefetchQuery({
                          queryKey: ['dashboard'],
                          queryFn: () => api.getDashboard(),
                          staleTime: 5 * 60_000,
                        });
                      } else if (basePath === '/pos') {
                        queryClient.prefetchQuery({
                          queryKey: ['pos-common-combinations'],
                          queryFn: () => api.getDoctors(),
                          staleTime: 5 * 60_000,
                        });
                      } else if (basePath === '/mail') {
                        queryClient.prefetchQuery({
                          queryKey: ['email-inbox'],
                          queryFn: () => api.getEmailInbox(50),
                          staleTime: 5 * 60_000,
                        });
                      } else if (basePath === '/pharmarack-cart') {
                        queryClient.prefetchQuery({
                          queryKey: ['pharmarack-cart'],
                          queryFn: () => api.getPharmarackCart(),
                          staleTime: 5 * 60_000,
                        });
                      }
                    } catch (err) {
                      console.warn('Prefetch error:', err);
                    }
                  }}
                  onClick={onClose}
                  className={`
                  flex items-center gap-3 px-5 py-2.5 mx-2 rounded-lg text-sm font-medium uppercase transition-all duration-200
                  ${isActive
                      ? 'text-white bg-gradient-to-r from-primary/20 to-transparent border-l-2 border-primary shadow-[inset_0_0_20px_rgba(59,130,246,0.1)]'
                      : 'text-muted hover:text-white hover:bg-white/5 hover:translate-x-1 border-l-2 border-transparent'}
                `}
                >
                  <span className={`${isActive ? 'text-primary drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]' : ''}`}>
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {badge}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Bottom Footer: Exit App */}
        <div className="p-3 mx-2 border-t border-glass-border/60 shrink-0">
          <ExitAppButton />
        </div>

      </div>
    </>
  );
});

// ──────────────────────────────────────────────
// Flash Toast — small pop at top-center
// ──────────────────────────────────────────────
const FlashToast = ({
  toast,
  onDismiss,
  onOpenReview,
  onOpenAutomationHub,
}: {
  toast: (ToastEventDetail & { id: number }) | null;
  onDismiss: () => void;
  onOpenReview: () => void;
  onOpenAutomationHub?: () => void;
}) => {
  const [style, setStyle] = useState<ToastStyle>(getToastStyle);
  useEffect(() => {
    const sync = () => setStyle(getToastStyle());
    window.addEventListener('toast-style-changed', sync);
    return () => window.removeEventListener('toast-style-changed', sync);
  }, []);

  if (!toast) return null;

  const placement = {
    1: 'top-4 left-1/2 -translate-x-1/2 rounded-2xl animate-soft-toast',
    2: 'top-16 right-5 w-[320px] rounded-xl animate-soft-toast-side',
    3: 'top-0 inset-x-0 rounded-none justify-center animate-soft-toast-side',
    4: 'top-4 right-5 rounded-full py-1.5 animate-soft-toast-side',
    5: 'top-16 right-5 w-[340px] rounded-2xl animate-soft-toast-side',
  }[style];

  const cfg = {
    success: { bg: 'bg-bg2 border-emerald-500/50 text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <Check size={15} className="shrink-0 text-emerald-400" /> },
    error: { bg: 'bg-bg2 border-red-500/50 text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <AlertTriangle size={15} className="shrink-0 text-red-400" /> },
    info: { bg: 'bg-bg2 border-border text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <Info size={15} className="shrink-0 text-muted" /> },
    mail: { bg: 'bg-bg2 border-indigo-500/50 text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <MailIcon size={15} className="shrink-0 text-indigo-400" /> },
    automation: { bg: 'bg-bg2 border-purple-500/50 text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <Activity size={15} className="shrink-0 text-purple-400" /> },
  }[toast.type] || { bg: 'bg-bg2 border-border text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]', icon: <Info size={15} className="shrink-0 text-muted" /> };

  const isStagedSync = toast.message.toLowerCase().includes('sync') || toast.message.toLowerCase().includes('staged');
  const isWaFailure = toast.type === 'error' && (toast.message.toLowerCase().includes('whatsapp') || toast.message.toLowerCase().includes('automation'));

  return (
    <div
      key={toast.id}
      onClick={() => {
        if (isWaFailure && onOpenAutomationHub) {
          onOpenAutomationHub();
          onDismiss();
        }
      }}
      className={`
        fixed z-toast ${placement}
        flex items-center gap-2.5 px-4 py-2.5
        border ${cfg.bg}
        ${style === 2 ? 'border-l-4' : ''}
        opacity-100
        ${style === 3 || style === 2 || style === 5 ? '' : 'min-w-[260px] max-w-[450px]'}
        ${isWaFailure ? 'cursor-pointer hover:border-red-400/80 transition-colors' : ''}
      `}
    >
      {cfg.icon}
      <span className="text-sm font-semibold flex-1 leading-snug">
        {toast.message}
        {isWaFailure && (
          <span className="block text-[10px] text-sky-400 font-bold uppercase tracking-wider mt-0.5">
            Click to view in Automation Hub →
          </span>
        )}
      </span>
      {isStagedSync && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenReview();
            onDismiss();
          }}
          className="ml-2 bg-primary hover:bg-primary/80 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors shrink-0"
        >
          Proceed
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className={`ml-1.5 ${style === 5 ? 'opacity-100' : 'opacity-50'} hover:opacity-100 transition-opacity shrink-0`}
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
};

// ──────────────────────────────────────────────
// Notification Panel
// ──────────────────────────────────────────────
const NotificationPanel = ({
  notifications,
  onClearAll,
  onClearOne,
  onMarkRead,
  onClose,
}: {
  notifications: AppNotification[];
  onClearAll: () => void;
  onClearOne: (id: number | string) => void;
  onMarkRead: (id: number | string) => void;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'alerts'>('all');
  const [actionLogs, setActionLogs] = useState<LocalActionLogRow[]>([]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const typeConfig = (type: string) => {
    if (type === 'success') return { badgeBg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', icon: <Check size={13} />, label: 'Success' };
    if (type === 'error') return { badgeBg: 'bg-rose-500/10 border-rose-500/20 text-rose-400', icon: <AlertTriangle size={13} />, label: 'Error' };
    if (type === 'mail') return { badgeBg: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400', icon: <MailIcon size={13} />, label: 'Mail' };
    if (type === 'automation') return { badgeBg: 'bg-purple-500/10 border-purple-500/20 text-purple-400', icon: <Activity size={13} />, label: 'Automation' };
    return { badgeBg: 'bg-sky-500/10 border-sky-500/20 text-sky-400', icon: <Info size={13} />, label: 'Info' };
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const fetchLogs = useCallback(async () => {
    try {
      const res = await apiClient.get('/notifications/action-logs?limit=150');
      if (res.data?.success && Array.isArray(res.data?.logs)) {
        setActionLogs(res.data.logs);
      }
    } catch (_) { }
  }, []);

  useEffect(() => {
    fetchLogs();
    // P1 "events, not timers": refresh the log list only when a new activity
    // is actually logged server-side (SSE push) — no 5s polling.
    window.addEventListener('sse-activity-logged', fetchLogs);
    return () => window.removeEventListener('sse-activity-logged', fetchLogs);
  }, [fetchLogs]);

  // Combine real-time toasts and persistent DB action_logs into unified Activity feed
  const combinedActivities = useMemo(() => {
    const toastItems: AppNotification[] = notifications.map(n => ({
      ...n,
      time: n.time instanceof Date ? n.time : new Date(n.time)
    }));

    const logItems: AppNotification[] = actionLogs.map(l => {
      let type: AppNotification['type'] = 'info';
      const actionType = String(l.action_type || '').toUpperCase();
      if (actionType.includes('FAIL') || actionType.includes('ERROR')) type = 'error';
      else if (actionType.includes('SALE') || actionType.includes('SUCCESS') || actionType.includes('ADD') || actionType.includes('SAVE')) type = 'success';
      else if (actionType.includes('AUTOMATION') || actionType.includes('WHATSAPP')) type = 'automation';
      else if (actionType.includes('MAIL')) type = 'mail';

      return {
        id: `log-${l.id}`,
        message: l.description || 'System Activity Logged',
        type,
        time: new Date(l.created_at || Date.now()),
        read: true,
      };
    });

    const merged = [...toastItems];
    const existingMessages = new Set(toastItems.map(t => t.message));
    logItems.forEach(item => {
      if (!existingMessages.has(item.message)) {
        merged.push(item);
      }
    });

    return merged.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [notifications, actionLogs]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const alertCount = combinedActivities.filter(n => n.type === 'error' || n.type === 'automation').length;

  const filteredNotifications = combinedActivities.filter(n => {
    if (activeFilter === 'unread') return !n.read;
    if (activeFilter === 'alerts') return n.type === 'error' || n.type === 'automation';
    return true;
  });

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-3 w-[420px] max-w-[calc(100vw-1.5rem)] z-dropdown flex flex-col rounded-3xl overflow-hidden bg-bg2 border border-border shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 opacity-100"
      style={{
        boxShadow: '0 25px 65px rgba(0,0,0,0.5), 0 0 35px rgba(0, 0, 0, 0.2)',
      }}
    >
      {/* Header Bar */}
      <div className="p-4 border-b border-border bg-bg flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm relative">
              <BellRing size={17} className="animate-pulse" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-sky-400 border-2 border-bg2 animate-ping" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-text tracking-tight">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-400 text-[10px] font-extrabold tracking-wide shadow-sm shadow-sky-500/10">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    <span>{unreadCount} unread</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted font-medium">Real-time store events & system status</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseEnter={() => import('./WhatsAppQueuePopover').catch(() => {})}
              onFocus={() => import('./WhatsAppQueuePopover').catch(() => {})}
              onClick={() => {
                whatsappQueueEvent.triggerOpen();
                onClose();
              }}
              className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition-all px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 cursor-pointer shadow-sm"
              title="Open WhatsApp Queue Controller"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
              <MessageSquareIcon size={12} />
              <span>Queue</span>
            </button>
            <button
              type="button"
              onClick={() => {
                navigate('/settings');
                onClose();
              }}
              className="p-1.5 rounded-xl text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
              title="Notification Settings"
            >
              <SettingsIcon size={15} />
            </button>
            {combinedActivities.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  setActionLogs([]);
                  await onClearAll();
                  toastEvent.trigger('All notifications & activity alerts wiped out', 'info');
                }}
                className="p-1.5 rounded-xl text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer"
                title="Clear All Notifications & Activity Alerts"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-muted hover:text-text hover:bg-bg3 transition-all cursor-pointer"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Filter Segmented Control Bar */}
        <div className="flex items-center justify-between bg-bg3/60 p-1 rounded-2xl border border-border/50">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeFilter === 'all'
                  ? 'bg-bg text-text shadow-sm border border-border'
                  : 'text-muted hover:text-text hover:bg-bg3'
                }`}
            >
              All ({combinedActivities.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('unread')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeFilter === 'unread'
                  ? 'bg-bg text-sky-400 shadow-sm border border-border'
                  : 'text-muted hover:text-text hover:bg-bg3'
                }`}
            >
              <span>Unread</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 text-[10px] font-extrabold font-mono leading-none border border-sky-500/30">
                  {unreadCount}
                </span>
              )}
            </button>
            {alertCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilter('alerts')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${activeFilter === 'alerts'
                    ? 'bg-bg text-purple-400 shadow-sm border border-border'
                    : 'text-muted hover:text-text hover:bg-bg3'
                  }`}
              >
                Alerts ({alertCount})
              </button>
            )}
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => notifications.forEach(n => { if (!n.read) onMarkRead(n.id); })}
              className="text-[11px] font-bold text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 cursor-pointer px-2 py-1 rounded-xl hover:bg-sky-500/10"
              title="Mark all notifications as read"
            >
              <Check size={12} />
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* Notification Cards List Container */}
      <div className="max-h-[400px] min-h-[180px] overflow-y-auto custom-scrollbar p-3 space-y-2">
        {filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-14 h-14 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3 shadow-inner">
              <Bell size={24} className="text-primary opacity-80" />
            </div>
            <h4 className="text-text text-sm font-bold">
              {activeFilter === 'unread' ? 'No unread notifications' : activeFilter === 'alerts' ? 'No system alerts' : 'All caught up!'}
            </h4>
            <p className="text-muted text-xs mt-1 max-w-[240px] leading-relaxed">
              {activeFilter === 'all'
                ? 'You have reviewed all recent updates and operational alerts.'
                : 'No pending items matching this view.'}
            </p>
          </div>
        ) : (
          filteredNotifications.map((notif) => {
            const cfg = typeConfig(notif.type);
            return (
              <div
                key={notif.id}
                onClick={() => { if (!notif.read) onMarkRead(notif.id); }}
                className={`
                  group rounded-2xl p-3.5 border transition-all duration-200 cursor-pointer relative overflow-hidden flex flex-col gap-2
                  ${!notif.read
                    ? 'bg-sky-500/[0.04] border-sky-500/30 shadow-sm hover:border-sky-500/50'
                    : 'bg-bg/40 border-border/60 hover:bg-bg3/60 hover:border-border'}
                `}
              >
                {/* Vertical Indicator Strip for Unread Items */}
                {!notif.read && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-sky-400 to-indigo-500 rounded-l-2xl" />
                )}

                {/* Top Row: Type Pill + Time + Unread Dot */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase tracking-wider ${cfg.badgeBg}`}>
                      {cfg.icon}
                      <span>{cfg.label}</span>
                    </span>
                    <span className="text-[10px] text-muted font-mono font-medium">{formatTime(notif.time)}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    {!notif.read && (
                      <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
                    )}
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onMarkRead(notif.id);
                      }}
                      className={`p-1 rounded-lg transition-all ${notif.read
                          ? 'text-muted/40 hover:text-sky-400 hover:bg-sky-500/10'
                          : 'text-sky-400 hover:bg-sky-500/20'
                        }`}
                      title={notif.read ? "Mark as unread" : "Mark as read"}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={async e => {
                        e.stopPropagation();
                        if (typeof notif.id === 'string' && notif.id.startsWith('log-')) {
                          const numId = parseInt(notif.id.replace('log-', ''), 10);
                          if (!isNaN(numId)) {
                            setActionLogs(prev => prev.filter(l => l.id !== numId));
                          }
                        }
                        onClearOne(notif.id);
                      }}
                      className="p-1 rounded-lg text-muted/40 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                      title="Remove notification"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {/* Middle Content */}
                <p className={`text-xs leading-relaxed ${!notif.read ? 'text-text font-semibold' : 'text-muted font-medium'}`}>
                  {notif.message}
                </p>

                {/* Metadata Tags & Action Row */}
                <div className="flex items-center justify-between pt-1 border-t border-border/30 mt-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {notif.distributor && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold">
                        <Building2 size={10} />
                        {notif.distributor}
                      </span>
                    )}
                    {notif.qty !== undefined && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                        Qty: {notif.qty}
                      </span>
                    )}
                  </div>

                  {(notif.link || notif.message.toLowerCase().includes('whatsapp') || notif.type === 'automation') && (
                    <button
                      type="button"
                      onMouseEnter={() => {
                        if (notif.message.toLowerCase().includes('whatsapp') || notif.type === 'automation' || !notif.link) {
                          import('./WhatsAppQueuePopover').catch(() => {});
                        }
                      }}
                      onClick={e => {
                        e.stopPropagation();
                        if (!notif.read) onMarkRead(notif.id);
                        if (notif.message.toLowerCase().includes('whatsapp') || notif.type === 'automation' || !notif.link) {
                          whatsappQueueEvent.triggerOpen();
                        } else {
                          navigate(notif.link!);
                        }
                        onClose();
                      }}
                      className={`inline-flex items-center gap-1 text-[11px] font-bold transition-all px-2.5 py-1 rounded-xl cursor-pointer ${notif.message.toLowerCase().includes('whatsapp') || notif.type === 'automation'
                          ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25'
                          : 'text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25'
                        }`}
                    >
                      {notif.message.toLowerCase().includes('whatsapp') || notif.type === 'automation' ? (
                        <>
                          <MessageSquareIcon size={11} />
                          <span>View Queue</span>
                        </>
                      ) : (
                        <>
                          <ExternalLink size={11} />
                          <span>Open</span>
                        </>
                      )}
                      <ChevronRight size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Summary */}
      {combinedActivities.length > 0 && (
        <div className="px-4 py-2.5 border-t border-border bg-bg/40 flex items-center justify-between text-xs text-muted font-medium">
          <span>{combinedActivities.length} total item{combinedActivities.length !== 1 ? 's' : ''}</span>
          <span className="text-[10px] font-mono text-muted/70">Live Activity Feed</span>
        </div>
      )}
    </div>
  );
};

const DeviceIcon = ({ os, size = 16, className = "" }: { os: string; size?: number; className?: string }) => {
  const normalizedOs = os.toLowerCase();
  if (normalizedOs.includes('ios') || normalizedOs.includes('apple') || normalizedOs.includes('mac') || normalizedOs.includes('iphone') || normalizedOs.includes('ipad')) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.21.67-2.93 1.49-.62.69-1.16 1.84-1.01 2.96 1.12.09 2.27-.56 2.95-1.39z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
      <path d="M17.5 8c.46 0 .89.11 1.28.31l1.58-1.58c.2-.2.51-.2.71 0s.2.51 0 .71l-1.63 1.63C19.78 9.77 20 10.86 20 12v3H4v-3c0-1.14.22-2.23.63-3.12L3 7.25c-.2-.2-.2-.51 0-.71s.51-.2.71 0l1.58 1.58C5.68 8.11 6.11 8 6.5 8h11M7 11.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1m10 0c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1M16 16v4.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V16H11v4.5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5V16H4.5C3.67 16 3 15.33 3 14.5V14h18v.5c0 .83-.67 1.5-1.5 1.5H16z" />
    </svg>
  );
};

// ──────────────────────────────────────────────
// Live Header Clock
// ──────────────────────────────────────────────
const LiveHeaderClock = () => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-glass-border bg-glass-bg text-text shadow-sm hover:border-primary/30 transition-all cursor-default select-none shrink-0"
      title={`Live System Clock (${now.toLocaleString()})`}
    >
      <Clock size={13} className="text-sky-400 animate-pulse shrink-0" />
      <div className="flex items-center gap-1.5 font-mono text-xs">
        <span className="font-bold text-text tracking-wide">{timeStr}</span>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// Live Cart Countdown Pill Button
// ──────────────────────────────────────────────
const LiveCartCountdownPill: React.FC = memo(() => {
  const navigate = useNavigate();
  const [cartCount, setCartCount] = useState<number>(0);
  const [cutoffTime, setCutoffTime] = useState<string>('11:00');
  const [pausedDates, setPausedDates] = useState<string[]>([]);
  const [isSentToday, setIsSentToday] = useState<boolean>(false);
  const [missingPhoneCount, setMissingPhoneCount] = useState<number>(0);
  const [nowTime, setNowTime] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadCartData = useCallback(async () => {
    try {
      // 1. Fetch live cart summary
      const cartRes = await apiClient.get('/pharmarack/live-cart-summary').catch(() => null);
      if (cartRes?.data?.success) {
        const total = typeof cartRes.data.totalItems === 'number'
          ? cartRes.data.totalItems
          : (cartRes.data.distributors || cartRes.data.cart?.distributors || []).reduce((acc: number, d: any) => acc + (d.items?.length || 0), 0);
        setCartCount(total);

        if (typeof cartRes.data.missingDistributorsCount === 'number') {
          setMissingPhoneCount(cartRes.data.missingDistributorsCount);
        } else {
          const dists = cartRes.data.distributors || cartRes.data.cart?.distributors || [];
          let missing = 0;
          for (const d of dists) {
            const rawP = d.phone || '';
            const cleanP = String(rawP).replace(/\D/g, '').slice(-10);
            if (!cleanP || cleanP.length !== 10) {
              missing++;
            }
          }
          setMissingPhoneCount(missing);
        }
      }

      // 2. Fetch dispatch schedule (paused dates)
      // Check localStorage first so instantaneous UI changes are immediately respected
      try {
        const stored = localStorage.getItem('pharmarack_paused_dispatch_dates');
        if (stored) setPausedDates(JSON.parse(stored));
      } catch (_) {}

      const schedRes = await apiClient.get('/pharmarack/dispatch-schedule').catch(() => null);
      if (schedRes?.data?.success && Array.isArray(schedRes.data.pausedDates)) {
        setPausedDates(schedRes.data.pausedDates);
      }

      // 3. Fetch app settings for cutoff time and sent date
      const settingsRes = await apiClient.get('/settings').catch(() => null);
      if (settingsRes?.data) {
        if (settingsRes.data.trigger_pharmarack_cart_send_time) {
          setCutoffTime(settingsRes.data.trigger_pharmarack_cart_send_time);
        }
        if (settingsRes.data.pharmarack_batch_last_sent_date) {
          const now = new Date();
          const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
          const todayIso = ist.toISOString().split('T')[0];
          setIsSentToday(settingsRes.data.pharmarack_batch_last_sent_date === todayIso);
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadCartData();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const debouncedLoad = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadCartData, 600);
    };

    const handleCartRefresh = (e?: Event) => {
      const customDetail = (e as CustomEvent)?.detail;
      if (customDetail?.pausedDates && Array.isArray(customDetail.pausedDates)) {
        setPausedDates(customDetail.pausedDates);
      } else {
        try {
          const stored = localStorage.getItem('pharmarack_paused_dispatch_dates');
          if (stored) setPausedDates(JSON.parse(stored));
        } catch (_) {}
      }
      debouncedLoad();
    };

    window.addEventListener('refresh-pharmarack-cart', handleCartRefresh);
    window.addEventListener('pharmarack-session-updated', debouncedLoad);
    window.addEventListener('sse-pharmarack-refreshed', debouncedLoad);
    window.addEventListener('focus', loadCartData);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('refresh-pharmarack-cart', handleCartRefresh);
      window.removeEventListener('pharmarack-session-updated', debouncedLoad);
      window.removeEventListener('sse-pharmarack-refreshed', debouncedLoad);
      window.removeEventListener('focus', loadCartData);
    };
  }, [loadCartData]);

  const todayStr = useMemo(() => {
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().split('T')[0];
  }, [nowTime]);

  const isTodayPaused = pausedDates.includes(todayStr);

  const countdownInfo = useMemo(() => {
    if (isTodayPaused) {
      return { status: 'PAUSED' as const, label: '⏸️ Paused' };
    }
    if (isSentToday) {
      return { status: 'SENT' as const, label: '✅ Sent' };
    }
    const [hStr, mStr] = (cutoffTime || '11:00').split(':');
    const targetH = parseInt(hStr, 10) || 11;
    const targetM = parseInt(mStr, 10) || 0;

    const targetDate = new Date(nowTime);
    targetDate.setHours(targetH, targetM, 0, 0);

    const diffMs = targetDate.getTime() - nowTime.getTime();
    if (diffMs <= 0) {
      return { status: 'CUTOFF' as const, label: '⏱️ Cutoff' };
    }

    const totalSec = Math.floor(diffMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const timeStr = `${mins}m ${String(secs).padStart(2, '0')}s`;

    if (mins < 10) {
      return { status: 'WARNING' as const, label: `⚠️ ${timeStr}` };
    }
    return { status: 'COUNTING' as const, label: timeStr };
  }, [cutoffTime, nowTime, isTodayPaused, isSentToday]);

  let pillCls = 'bg-glass-bg border-glass-border text-emerald-400 hover:bg-bg3/60';
  if (countdownInfo.status === 'WARNING') {
    pillCls = 'bg-amber-500/15 border-amber-500/40 text-amber-400 hover:bg-amber-500/25 animate-pulse';
  } else if (countdownInfo.status === 'PAUSED') {
    pillCls = 'bg-bg3/60 border-glass-border text-amber-400 hover:bg-bg3';
  } else if (countdownInfo.status === 'SENT') {
    pillCls = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20';
  }

  return (
    <div
      className={`px-2.5 py-1 rounded-xl border transition-all duration-200 flex items-center gap-1.5 text-xs font-bold select-none shrink-0 ${pillCls}`}
    >
      {/* 1. Direct navigation to Pharmarack Cart Page */}
      <button
        type="button"
        onClick={() => navigate('/pharmarack-cart')}
        className="relative p-1 rounded-lg text-inherit hover:text-primary hover:bg-bg3/60 transition-all flex items-center justify-center cursor-pointer group shrink-0"
        title={`Open Pharmarack Cart page (${cartCount} items)`}
        aria-label="Open Pharmarack Cart page"
      >
        <ShoppingCart size={14} className="shrink-0 group-hover:scale-105 transition-transform" />
        {cartCount > 0 && (
          <span className="absolute -top-1 -right-1.5 px-1 min-w-[13px] h-3.5 rounded-full text-[9px] bg-primary text-white font-mono font-black flex items-center justify-center leading-none shadow-xs pointer-events-none">
            {cartCount}
          </span>
        )}
      </button>

      {/* Subtle separator */}
      <span className="w-px h-3.5 bg-glass-border shrink-0" />

      {/* 2. Open Add to Live Cart Modal */}
      <button
        type="button"
        onClick={() => liveCartAddEvent.triggerOpen()}
        onMouseEnter={() => api.warmupPharmarackSession()}
        className="flex items-center gap-1.5 text-inherit hover:opacity-85 transition-opacity cursor-pointer"
        title={`Add to Live Cart — Cutoff: ${countdownInfo.label}`}
        aria-label="Add to Live Cart"
      >
        <span className="font-mono text-xs font-black whitespace-nowrap">{countdownInfo.label}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-0.5 hover:bg-emerald-500/25 transition-colors">
          <Plus size={10} className="stroke-[3]" /> Add
        </span>
      </button>

      {missingPhoneCount > 0 && (
        <button
          type="button"
          onClick={() => navigate('/pharmarack-cart?filter=unmapped')}
          className="px-1.5 py-0.5 rounded text-[10px] font-black bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30 flex items-center gap-1 shadow-xs transition-colors cursor-pointer shrink-0"
          title={`${missingPhoneCount} distributor(s) missing WhatsApp phone number — Click to view in Pharmarack Cart`}
        >
          <span>⚠️</span>
          <span>{missingPhoneCount}</span>
        </button>
      )}
    </div>
  );
});
LiveCartCountdownPill.displayName = 'LiveCartCountdownPill';

// ──────────────────────────────────────────────
// Isolated Live Sending Countdown Chip
// Renders the in-flight WhatsApp sending animation (0-100%, 10s-0s) in an
// isolated leaf node so Topbar and parent pages never re-render on progress ticks.
// ──────────────────────────────────────────────
interface LiveSendProgressChipProps {
  recipient: string;
  durationSec?: number;
  completed?: boolean;
  type?: string;
  waSent?: number;
  waPending?: number;
  waFailed?: number;
  onClick?: () => void;
  showQueueCounts?: boolean;
}

const LiveSendProgressChip = memo(({
  recipient,
  durationSec = 10,
  completed = false,
  waSent = 0,
  waPending = 0,
  waFailed = 0,
  onClick,
  showQueueCounts = true,
}: LiveSendProgressChipProps) => {
  const [progress, setProgress] = useState(completed ? 100 : 0);
  const [secondsLeft, setSecondsLeft] = useState(completed ? 0 : durationSec);
  const [isDone, setIsDone] = useState(completed);

  useEffect(() => {
    if (completed) {
      setProgress(100);
      setSecondsLeft(0);
      setIsDone(true);
      return;
    }

    setIsDone(false);
    setProgress(0);
    setSecondsLeft(durationSec);

    const startTime = Date.now();
    const durationMs = durationSec * 1000;

    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - startTime;
      const fraction = Math.min(1, elapsed / durationMs);
      const pct = Math.min(100, Math.round(fraction * 100));
      const secs = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));

      setProgress(pct);
      setSecondsLeft(secs);

      if (fraction >= 1) {
        clearInterval(timer);
        setProgress(100);
        setSecondsLeft(0);
        setIsDone(true);
      }
    }, 250);

    return () => clearInterval(timer);
  }, [recipient, durationSec, completed]);

  return (
    <div
      onClick={onClick}
      className="w-full flex flex-col justify-center gap-1 h-full relative cursor-pointer group/progress animate-hub-enter"
      title="Click to open Dispatch & Messaging Hub"
    >
      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <SendIcon size={12} className={`text-sky-400 shrink-0 ${isDone ? '' : 'animate-pulse'}`} />
          <span className="truncate text-text font-bold text-xs tracking-tight">
            {isDone ? `✓ Sent to ${recipient}` : `Sending WhatsApp to ${recipient}`}
          </span>
          <span className="text-[10px] font-mono font-bold text-sky-400 shrink-0">
            {isDone ? '100% Complete' : `${progress}% (${secondsLeft}s left)`}
          </span>
        </div>

        {showQueueCounts && (
          <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-bold">
            {waSent > 0 && <span className="text-emerald-400">✓ {waSent}</span>}
            {waPending > 0 && <span className="text-amber-400">⏰ {waPending}</span>}
            {waFailed > 0 && <span className="text-rose-400 animate-pulse">⚠️ {waFailed}</span>}
          </div>
        )}
      </div>

      <div className="w-full h-1.5 bg-bg border border-glass-border/40 rounded-full overflow-hidden relative shadow-inner">
        <div
          className="h-full rounded-full relative bg-gradient-to-r from-sky-500 via-teal-400 to-emerald-400 transition-[width] duration-300 ease-out"
          style={
            isDone
              ? { width: '100%' }
              : {
                  animation: `liveProgressFill ${durationSec}s linear forwards`,
                  willChange: 'width'
                }
          }
        >
          <div className="absolute right-0 top-0 bottom-0 w-2 bg-sky-100 rounded-full shadow-sm shadow-sky-400/50" />
        </div>
      </div>
    </div>
  );
});
LiveSendProgressChip.displayName = 'LiveSendProgressChip';

// ──────────────────────────────────────────────
// Topbar
// ──────────────────────────────────────────────
const Topbar = memo(({
  notifications,
  hasUnread,
  onNewNotification,
  onClearAll,
  onClearOne,
  onMarkRead,
  onOpenStagedReview,
  onOpenConnectModal,
  onOpenWaQueue,
  onOpenAutomationHub,
  automationHubHeadline = 'idle',
  onMenuClick,
  compactCacheLoaded = false,
}: {
  notifications: AppNotification[];
  hasUnread: boolean;
  onNewNotification: (n: ToastEventDetail) => void;
  onClearAll: () => void;
  onClearOne: (id: number | string) => void;
  onMarkRead: (id: number | string) => void;
  onOpenStagedReview: () => void;
  onOpenConnectModal: () => void;
  onOpenWaQueue?: () => void;
  onOpenAutomationHub?: () => void;
  automationHubHeadline?: 'sending' | 'failed' | 'idle';
  onMenuClick?: () => void;
  compactCacheLoaded?: boolean;
}) => {
  const navigate = useNavigate();
  const [showPanel, setShowPanel] = useState(false);
  const [flashToast, setFlashToast] = useState<(ToastEventDetail & { id: number }) | null>(null);
  const [catalogJob, setCatalogJob] = useState<{
    id: number;
    status: string;
    progress: number;
    total_count?: number;
    processed_count?: number;
  } | null>(null);
  const [enrichmentRunning, setEnrichmentRunning] = useState(false);

  useEffect(() => {
    const fetchActiveJob = async () => {
      try {
        const { data } = await apiClient.get('/jobs');
        if (Array.isArray(data)) {
          const activeJob = data.find(j => ['processing', 'pending', 'pending_analysis', 'processing_analysis'].includes(j.status));
          if (activeJob) {
            setCatalogJob({
              id: activeJob.id,
              status: activeJob.status,
              progress: activeJob.progress || 0,
              total_count: activeJob.total_count,
              processed_count: activeJob.processed_count
            });
          } else {
            setCatalogJob(null);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch active catalog job in Topbar:', err);
      }
    };
    fetchActiveJob();

    if (!compactCacheLoaded) return;

    // Background enrichment permanently stopped by user
    setEnrichmentRunning(false);
  }, [compactCacheLoaded]);

  const [backupStatus, setBackupStatus] = useState<{ active: boolean; label: string }>({ active: false, label: '' });
  const [ocrStatus, setOcrStatus] = useState<{ active: boolean; label?: string; progress?: number; reviewNeeded?: boolean }>({ active: false });
  const [isHoverExpanded, setIsHoverExpanded] = useState(false);
  const hubHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHubMouseEnter = () => {
    if (hubHoverTimerRef.current) {
      clearTimeout(hubHoverTimerRef.current);
      hubHoverTimerRef.current = null;
    }
    setIsCarouselHovered(true);
    setIsHoverExpanded(true);
  };

  const handleHubMouseLeave = () => {
    if (hubHoverTimerRef.current) {
      clearTimeout(hubHoverTimerRef.current);
    }
    hubHoverTimerRef.current = setTimeout(() => {
      setIsCarouselHovered(false);
      setIsHoverExpanded(false);
      hubHoverTimerRef.current = null;
    }, 350);
  };

  useEffect(() => {
    return () => {
      if (hubHoverTimerRef.current) {
        clearTimeout(hubHoverTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleBackupStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ active?: boolean; label?: string }>).detail;
      if (detail) {
        setBackupStatus({ active: !!detail.active, label: detail.label || 'Database Backup in progress...' });
      }
    };
    const handleOcrStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ active?: boolean; label?: string; progress?: number; reviewNeeded?: boolean }>).detail;
      if (detail) {
        setOcrStatus({
          active: !!detail.active,
          label: detail.label || 'Scanning Distributor Invoice...',
          progress: detail.progress !== undefined ? detail.progress : 65,
          reviewNeeded: !!detail.reviewNeeded
        });
      }
    };
    window.addEventListener('backup-status-changed', handleBackupStatus);
    window.addEventListener('ocr-status-changed', handleOcrStatus);
    return () => {
      window.removeEventListener('backup-status-changed', handleBackupStatus);
      window.removeEventListener('ocr-status-changed', handleOcrStatus);
    };
  }, []);

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [connectedDevices, setConnectedDevices] = useState<{ token: string; device_name: string; os: string; is_online: number; last_seen: string; offline_seconds?: number }[]>([]);
  const [showDevicesPopover, setShowDevicesPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [renamingToken, setRenamingToken] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fetchDevices = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/notifications/devices');
      if (data && Array.isArray(data.devices)) {
        setConnectedDevices(data.devices);
      }
    } catch (err) {
      console.warn('Failed to fetch connected devices:', err);
    }
  }, []);

  const handleRenameDevice = useCallback(async (token: string, name: string) => {
    if (!name.trim()) return;
    try {
      await apiClient.patch(`/notifications/devices/${token}/rename`, { name: name.trim() });
      setConnectedDevices(prev => prev.map(d => d.token === token ? { ...d, device_name: name.trim() } : d));
    } catch (err) {
      console.warn('Failed to rename device:', err);
    } finally {
      setRenamingToken(null);
      setRenameValue('');
    }
  }, []);

  const [servicesStatus, setServicesStatus] = useState<{
    pharmarack: { connected: boolean; isRefreshing: boolean; lastError: string | null };
    whatsapp: { connected: boolean; initializing: boolean; isSyncing: boolean; pendingQueueCount: number; sleeping?: boolean; readiness?: WhatsAppReadinessState };
    gaters?: { automation: boolean; whatsapp: boolean; telegram: boolean; email: boolean };
  } | null>(null);
  const servicesStatusRef = useRef(servicesStatus);
  servicesStatusRef.current = servicesStatus;

  const [waReadiness, setWaReadiness] = useState<WhatsAppReadinessState | null>(null);

  const [waQueueDetail, setWaQueueDetail] = useState<{
    isProcessing: boolean;
    isPaused?: boolean;
    activeTargetName?: string | null;
    counts: { pending: number; sending: number; sent: number; failed_offline: number; failed_perm: number };
  } | null>(null);

  const [isQueueActive, setIsQueueActive] = useState<boolean>(false);

  const notifiedFailedQueueIdsRef = useRef<Set<number>>(new Set());

  const [lastQueueCompletedAt, setLastQueueCompletedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!lastQueueCompletedAt) return;
    const elapsed = Date.now() - lastQueueCompletedAt;
    const remaining = Math.max(0, 5000 - elapsed);
    const timer = setTimeout(() => setLastQueueCompletedAt(null), remaining);
    return () => clearTimeout(timer);
  }, [lastQueueCompletedAt]);

  const fetchServicesStatus = useCallback(async () => {
    try {
      const { api } = await import('../services/api.js');
      const res = await api.getServicesStatus();
      if (res && res.success && res.services) {
        servicesStatusRef.current = res.services;
        setServicesStatus(res.services);
        if (res.services.whatsapp?.readiness) {
          setWaReadiness(res.services.whatsapp.readiness);
        }
      }
    } catch (err) {
      console.warn('[Layout] Failed to fetch services status:', err);
    }
  }, []);

  // Active Manual/Automated Message Send Meta (stable metadata, only updates on start, complete, and dismiss)
  const [activeSendMeta, setActiveSendMeta] = useState<{
    id: string;
    recipient: string;
    type?: string;
    durationSec: number;
    completed: boolean;
  } | null>(null);
  const activeSendMetaRef = useRef(activeSendMeta);
  activeSendMetaRef.current = activeSendMeta;
  const lastAnimatedSendingKeyRef = useRef<string | null>(null);

  const fetchWhatsAppQueueStatus = useCallback(async () => {
    try {
      const { api } = await import('../services/api.js');
      const qData = await api.getWhatsAppQueueStatus();
      if (qData) {
        setWaQueueDetail({
          isProcessing: qData.isProcessing,
          isPaused: qData.isPaused,
          activeTargetName: qData.activeTargetName,
          counts: qData.counts || { pending: 0, sending: 0, sent: 0, failed_offline: 0, failed_perm: 0 }
        });
        const pending = qData.counts?.pending || 0;
        const sending = qData.counts?.sending || 0;
        const active = pending > 0 || sending > 0 || !!qData.isProcessing;
        setIsQueueActive(active);

        // Live in-flight sync: start countdown ONCE per sending target, never loop on polls
        if (qData.activeTargetName && sending > 0) {
          const sendingKey = `${qData.currentSendingItemId || qData.activeTargetName}`;
          if (lastAnimatedSendingKeyRef.current !== sendingKey && !activeSendMetaRef.current) {
            lastAnimatedSendingKeyRef.current = sendingKey;
            messageSendEvent.triggerSendProgress(qData.activeTargetName, 'Queue Dispatch', 10);
          }
        } else if (sending === 0) {
          lastAnimatedSendingKeyRef.current = null;
        }

        if (Array.isArray(qData.recentItems)) {
          qData.recentItems.forEach((item) => {
            // Freshness guard: only surface failures from the last 15 minutes so
            // persisted historical rows don't re-toast on every new UI session.
            const isRecent = !item.created_at || (Date.now() - Number(item.created_at)) < 15 * 60 * 1000;
            if ((item.status === 'failed_perm' || (item.status === 'failed_offline' && item.retry_count >= 3)) && isRecent && !notifiedFailedQueueIdsRef.current.has(item.id)) {
              notifiedFailedQueueIdsRef.current.add(item.id);
              const target = item.target_name || (item.number ? `+${item.number}` : 'Recipient');
              const failureReason = getFormattedFailureReason(item.error_message, item.status);
              toastEvent.trigger(`❌ WhatsApp message to ${target} failed: ${failureReason}`, 'error');
            }
          });
        }
      }
    } catch (err) {
      console.warn('[Layout] Failed to fetch whatsapp queue status:', err);
    }
  }, []);

  // Services status: fetch on mount, on focus, and on SSE push events.
  // No interval — P1 "events, not timers" (API_OPTIMIZATION plan Phase 3).
  useEffect(() => {
    if (!compactCacheLoaded) return;
    fetchServicesStatus();
    fetchWhatsAppQueueStatus();

    const handleRefreshStatus = () => {
      fetchServicesStatus();
      fetchWhatsAppQueueStatus();
    };

    const unsubReadiness = whatsappReadinessEvent.subscribeReadinessProgress((detail) => {
      setWaReadiness(prev => ({
        isReady: detail.isReady,
        isSleeping: detail.isSleeping,
        isInitializing: detail.isInitializing,
        progress: detail.progress,
        stage: detail.stage as any,
        status: detail.status,
        lastError: detail.error || null,
        hasSavedSession: prev?.hasSavedSession ?? true
      }));
    });

    window.addEventListener('focus', handleRefreshStatus);
    window.addEventListener('pharmarack-auth-changed', handleRefreshStatus);
    window.addEventListener('sse-wa-status-changed', handleRefreshStatus);
    window.addEventListener('sse-pharmarack-refreshed', fetchServicesStatus);

    return () => {
      unsubReadiness();
      window.removeEventListener('focus', handleRefreshStatus);
      window.removeEventListener('pharmarack-auth-changed', handleRefreshStatus);
      window.removeEventListener('sse-wa-status-changed', handleRefreshStatus);
      window.removeEventListener('sse-pharmarack-refreshed', fetchServicesStatus);
    };
  }, [fetchServicesStatus, fetchWhatsAppQueueStatus, compactCacheLoaded]);

  // WhatsApp queue status: event-driven. Poll ONLY while the queue is actively
  // sending (3s) AND the window is visible; hidden windows pause polling and
  // refresh once on return-to-visible plus via queue events / focus / SSE.
  useEffect(() => {
    if (!compactCacheLoaded) return;
    fetchWhatsAppQueueStatus();
    const qInterval = isQueueActive && document.visibilityState === 'visible'
      ? setInterval(fetchWhatsAppQueueStatus, 3000)
      : null;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isQueueActive) fetchWhatsAppQueueStatus();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const unsubOpen = whatsappQueueEvent.subscribeOpen(() => {
      onOpenWaQueue?.();
      fetchWhatsAppQueueStatus();
    });

    const unsubUpdated = whatsappQueueEvent.subscribeUpdated(() => {
      fetchWhatsAppQueueStatus();
    });

    const handleSseQueue = () => {
      fetchWhatsAppQueueStatus();
      fetchServicesStatus();
    };
    window.addEventListener('sse-wa-queue-updated', handleSseQueue);

    return () => {
      if (qInterval) clearInterval(qInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubOpen();
      unsubUpdated();
      window.removeEventListener('sse-wa-queue-updated', handleSseQueue);
    };
  }, [compactCacheLoaded, isQueueActive, fetchWhatsAppQueueStatus, fetchServicesStatus, onOpenWaQueue]);

  useEffect(() => {
    let doneTimer: ReturnType<typeof setTimeout> | undefined;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;

    const unsubSend = messageSendEvent.subscribeSendProgress((detail) => {
      const durationSec = detail.durationSec || 10;
      if (doneTimer) clearTimeout(doneTimer);
      if (clearTimer) clearTimeout(clearTimer);

      setActiveSendMeta({
        id: detail.id || `msg-${Date.now()}`,
        recipient: detail.recipient,
        type: detail.messagePreview,
        durationSec,
        completed: false,
      });

      doneTimer = setTimeout(() => {
        setActiveSendMeta(prev => (prev ? { ...prev, completed: true } : null));

        clearTimer = setTimeout(() => {
          setActiveSendMeta(null);
        }, 2500);
      }, durationSec * 1000);
    });

    return () => {
      if (doneTimer) clearTimeout(doneTimer);
      if (clearTimer) clearTimeout(clearTimer);
      unsubSend();
    };
  }, []);

  // Upcoming Automations (5-Minute Prior Notification) State & Polling
  const [upcomingTriggers, setUpcomingTriggers] = useState<Array<{
    id: string;
    name: string;
    category: string;
    secondsUntilRun: number;
    nextRunIso: string;
    isSnoozed: boolean;
    description: string;
  }>>([]);

  const fetchUpcomingTriggers = useCallback(async () => {
    try {
      const res = await api.getUpcomingTriggers(5);
      if (res?.success && Array.isArray(res.upcoming)) {
        setUpcomingTriggers(res.upcoming.filter(t => !t.isSnoozed && t.secondsUntilRun > 0));
      }
    } catch (_) { }
  }, []);

  // Upcoming triggers: fetch on mount / focus / relevant SSE events; the local
  // countdown ticks are UI-only (no network). When a countdown expires we
  // re-fetch once to pick up the next run time — no fixed interval.
  useEffect(() => {
    fetchUpcomingTriggers();

    const handleSseTriggers = () => fetchUpcomingTriggers();
    window.addEventListener('focus', fetchUpcomingTriggers);
    window.addEventListener('refresh-special-orders', handleSseTriggers);
    window.addEventListener('app-refills-updated', handleSseTriggers);
    window.addEventListener('sse-dispatch-updated', handleSseTriggers);
    return () => {
      window.removeEventListener('focus', fetchUpcomingTriggers);
      window.removeEventListener('refresh-special-orders', handleSseTriggers);
      window.removeEventListener('app-refills-updated', handleSseTriggers);
      window.removeEventListener('sse-dispatch-updated', handleSseTriggers);
    };
  }, [fetchUpcomingTriggers]);

  const triggersRefetchLockRef = useRef(0);

  useEffect(() => {
    if (upcomingTriggers.length === 0) return;
    const tick = setInterval(() => {
      // Hidden window: pause countdown churn and the throttled network refetch;
      // the visibilitychange handler resyncs from the server on return.
      if (document.visibilityState !== 'visible') return;
      setUpcomingTriggers(prev =>
        prev.map(t => ({ ...t, secondsUntilRun: Math.max(0, t.secondsUntilRun - 1) }))
          .filter(t => t.secondsUntilRun > 0)
      );
      // A countdown just expired → a trigger likely ran server-side. Refresh
      // the upcoming list at most once per minute.
      if (upcomingTriggers.some(t => t.secondsUntilRun <= 1)) {
        const now = Date.now();
        if (now - triggersRefetchLockRef.current > 60000) {
          triggersRefetchLockRef.current = now;
          fetchUpcomingTriggers();
        }
      }
    }, 1000);
    const handleTriggerVisibility = () => {
      // Resync countdowns from the server on return-to-visible (same 60s lock).
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - triggersRefetchLockRef.current > 60000) {
        triggersRefetchLockRef.current = now;
        fetchUpcomingTriggers();
      }
    };
    document.addEventListener('visibilitychange', handleTriggerVisibility);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', handleTriggerVisibility);
    };
  }, [upcomingTriggers.length, upcomingTriggers, fetchUpcomingTriggers]);

  // Consolidate Active Header Notification Carousel Items
  const isWaActive = (waQueueDetail?.counts?.pending || 0) > 0 || (waQueueDetail?.counts?.sending || 0) > 0 || waQueueDetail?.isProcessing;
  const isWaRecentlyDone = !isWaActive && (waQueueDetail?.counts?.sent || 0) > 0 && lastQueueCompletedAt !== null;

  const cartJobs = React.useSyncExternalStore(subscribeRefillCartJobs, getRefillCartJobs);
  const activeCartJob = cartJobs.find(j => isRefillJobRunning(j));

  const activeHeaderItems = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'whatsapp' | 'backup' | 'catalog' | 'notification';
      title: string;
      subtitle?: string;
      progress?: number;
      badge?: string;
      color: 'emerald' | 'purple' | 'sky' | 'amber';
      action?: () => void;
      actionLabel?: string;
      icon: React.ReactNode;
    }> = [];

    // 0. Active Refill Cart Order Progress (Highest Priority)
    if (activeCartJob) {
      const total = activeCartJob.rows.length;
      const done = activeCartJob.rows.filter(r => r.state !== 'queued' && r.state !== 'working').length;
      const added = activeCartJob.rows.filter(r => r.state === 'added' || r.state === 'in_cart').length;
      const needsLink = activeCartJob.rows.filter(r => r.state === 'needs_link' || r.state === 'linked_oos').length;
      const failed = activeCartJob.rows.filter(r => r.state === 'failed' || r.state === 'not_found').length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

      items.push({
        id: `cart-job-${activeCartJob.id}`,
        type: 'notification',
        title: `🛒 Cart Order: ${activeCartJob.patientName} (${done}/${total})`,
        subtitle: `${added} in cart${needsLink > 0 ? ` • ${needsLink} need link` : ''}${failed > 0 ? ` • ${failed} failed` : ''}`,
        progress: pct,
        badge: pct === 100 ? 'Done' : 'Adding...',
        color: failed > 0 ? 'amber' : 'emerald',
        action: () => openRefillCartJob(activeCartJob.id),
        actionLabel: 'Inspect',
        icon: <ShoppingCart size={12} className="text-primary animate-pulse shrink-0" />
      });
    }

    // 0.1. Active Manual/Automated Message Send (10s Animation)
    if (activeSendMeta) {
      items.push({
        id: activeSendMeta.id,
        type: 'whatsapp',
        title: activeSendMeta.completed ? `✓ Message Delivered to ${activeSendMeta.recipient}` : `Sending Message to ${activeSendMeta.recipient}`,
        subtitle: activeSendMeta.completed ? '✓ Delivery confirmed (100% Complete)' : `▶ Dispatching live to ${activeSendMeta.recipient}...`,
        progress: activeSendMeta.completed ? 100 : 50,
        badge: activeSendMeta.completed ? '100% Done' : 'Sending...',
        color: 'emerald',
        icon: <SendIcon size={12} className="text-emerald-400 animate-pulse shrink-0" />
      });
    }

    // 0.5. WhatsApp Readiness Waking Progress (0-100%)
    if (waReadiness && waReadiness.isInitializing && waReadiness.progress > 0 && waReadiness.progress < 100 && !activeSendMeta) {
      items.push({
        id: 'wa-waking',
        type: 'whatsapp',
        title: `WhatsApp: ${waReadiness.status} (${waReadiness.progress}%)`,
        subtitle: 'Preparing WhatsApp session & connection...',
        progress: waReadiness.progress,
        badge: `${waReadiness.progress}%`,
        color: 'amber',
        action: onOpenAutomationHub,
        actionLabel: 'Hub',
        icon: <RefreshCw size={12} className="text-amber-400 animate-spin shrink-0" />
      });
    }

    // 1. WhatsApp Queue Progress
    const waTotal = (waQueueDetail?.counts?.sent || 0) + (waQueueDetail?.counts?.pending || 0) + (waQueueDetail?.counts?.sending || 0);
    const waSent = waQueueDetail?.counts?.sent || 0;
    const waPercent = waTotal > 0 ? Math.round((waSent / waTotal) * 100) : 100;

    if (isWaActive || isWaRecentlyDone) {
      items.push({
        id: 'wa-queue',
        type: 'whatsapp',
        title: waQueueDetail?.isPaused
          ? `⏰ Scheduled: WhatsApp ${waQueueDetail?.counts?.pending || waTotal} Messages Ready`
          : isWaRecentlyDone ? 'WhatsApp: All Sent' : `WhatsApp: ${waSent}/${waTotal} Sent (${waPercent}%)`,
        subtitle: waQueueDetail?.isPaused
          ? '⏸ Waiting for Play button to send'
          : waQueueDetail?.activeTargetName ? `▶ ${waQueueDetail.activeTargetName}` : undefined,
        progress: waPercent,
        badge: isWaRecentlyDone ? 'Done' : waQueueDetail?.isPaused ? 'Waiting Play' : 'Sending',
        color: waQueueDetail?.isPaused ? 'amber' : 'emerald',
        action: waQueueDetail?.isPaused
          ? async () => {
            try {
              await apiClient.post('/whatsapp/queue/toggle-pause');
              window.dispatchEvent(new CustomEvent('cache-invalidate'));
            } catch (err) {
              console.error('Failed to unpause queue:', err);
            }
          }
          : onOpenWaQueue,
        actionLabel: waQueueDetail?.isPaused ? '▶ SEND NOW' : 'View Queue',
        icon: waQueueDetail?.isPaused ? <ClockIcon size={12} className="text-amber-400 animate-pulse shrink-0" /> : <MessageSquareIcon size={12} className="text-emerald-400 animate-pulse shrink-0" />
      });
    }

    // 2. Database Backup Progress
    if (backupStatus.active) {
      items.push({
        id: 'backup',
        type: 'backup',
        title: 'Database Backup Running',
        subtitle: backupStatus.label || 'Creating compressed database backup...',
        progress: 100,
        badge: 'Backing Up',
        color: 'purple',
        icon: <Database size={12} className="text-purple-400 animate-spin shrink-0" />
      });
    }

    // 3. Catalog Sync Progress
    if (catalogJob && catalogJob.status === 'processing') {
      items.push({
        id: 'catalog',
        type: 'catalog',
        title: `Catalog Syncing (${catalogJob.progress || 0}%)`,
        subtitle: 'Updating inventory reference catalog...',
        progress: catalogJob.progress || 0,
        badge: 'Syncing',
        color: 'sky',
        icon: <RefreshCw size={12} className="text-sky-400 animate-spin shrink-0" />
      });
    }

    // 4. Invoice OCR Scanning Progress
    if (ocrStatus.active) {
      items.push({
        id: 'ocr-scan',
        type: 'notification',
        title: `📄 Invoice OCR: ${ocrStatus.label || 'Scanning'} (${ocrStatus.progress || 0}%)`,
        subtitle: 'Parsing invoice lines & GST tax fields...',
        progress: ocrStatus.progress || 0,
        badge: 'Scanning',
        color: 'sky',
        action: () => navigate('/learning?tab=ocr'),
        actionLabel: 'Review',
        icon: <FileText size={12} className="text-sky-400 animate-pulse shrink-0" />
      });
    }


    return items;
  }, [activeCartJob, activeSendMeta, waQueueDetail, isWaActive, isWaRecentlyDone, backupStatus, catalogJob, ocrStatus, onOpenWaQueue, navigate]);


  const [carouselIndex, setCarouselIndex] = useState(0);
  const [isCarouselHovered, setIsCarouselHovered] = useState(false);
  const [isManualCarouselPaused, setIsManualCarouselPaused] = useState(false);

  // Auto-rotate ticker every 4 seconds unless hovered or manually paused
  useEffect(() => {
    if (activeHeaderItems.length <= 1 || isCarouselHovered || isManualCarouselPaused) return;
    const timer = setInterval(() => {
      setCarouselIndex(prev => (prev + 1) % activeHeaderItems.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [activeHeaderItems.length, isCarouselHovered, isManualCarouselPaused]);

  const activeIndex = carouselIndex >= activeHeaderItems.length ? 0 : carouselIndex;
  const currentHeaderItem = activeHeaderItems[activeIndex];

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // 1-time startup check for Pharmarack cart sync status after initial window.
  // Two windows: 46s (original) plus a 110s re-check giving the backend boot cart
  // warm-up time to resolve the coordinator after a slow headless session refresh.
  useEffect(() => {
    let toasted = false;
    const checkSyncStatus = async () => {
      try {
        const syncStatus = await api.getStartupSyncStatus();
        if (syncStatus.timedOut && !syncStatus.cartLoaded && !toasted) {
          toasted = true;
          toastEvent.trigger(
            '⚠️ Pharmarack cart sync pending — Session may need refresh from Learning page.',
            'info'
          );
        }
      } catch (_) {}
    };
    const timer1 = setTimeout(checkSyncStatus, 46000);
    const timer2 = setTimeout(checkSyncStatus, 110000);

    return () => { clearTimeout(timer1); clearTimeout(timer2); };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowDevicesPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // Global App-Wide Keyboard Shortcuts System (Ctrl+S, Escape, Ctrl+/, ?)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag);

      // 1. Intercept Ctrl + S or Cmd + S globally
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        shortcutEvent.triggerSave();
        return;
      }

      // 2. Intercept Escape globally
      if (e.key === 'Escape') {
        // Priority 1: Dismiss topmost open modal or popup
        if (modalManager.handleEscape()) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          return;
        }

        // Priority 2: Dismiss shortcuts cheat sheet
        if (showShortcutHelp) {
          e.preventDefault();
          e.stopPropagation();
          setShowShortcutHelp(false);
          return;
        }

        // Priority 3: Dismiss popovers and activity panel
        setShowPanel(false);
        setShowDevicesPopover(false);
        shortcutEvent.triggerCloseModal();
        return;
      }

      // 3. Intercept Ctrl + / or ? to toggle Keyboard Shortcuts Cheat Sheet
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShowShortcutHelp(prev => !prev);
        return;
      }
      if (e.key === '?' && !isInputFocused) {
        e.preventDefault();
        setShowShortcutHelp(prev => !prev);
        return;
      }

      // 4. Universal F11 full-screen toggle fallback
      if (e.key === 'F11') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    const unsubscribeHelp = shortcutEvent.subscribeToggleHelp(() => {
      setShowShortcutHelp(prev => !prev);
    });

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      unsubscribeHelp();
    };
  }, [showShortcutHelp]);

  // Flash toast only for errors — success/info/mail/automation log silently to Activity panel only
  // Appearance tab "Preview": shows one sample of any type in the chosen style (not logged).
  useEffect(() => {
    const onPreview = (e: Event) => {
      const detail = (e as CustomEvent<ToastEventDetail>).detail;
      setFlashToast({ ...detail, id: Date.now() });
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashToast(null), 4200);
    };
    window.addEventListener('toast-preview', onPreview);
    return () => window.removeEventListener('toast-preview', onPreview);
  }, []);

  useEffect(() => {
    return toastEvent.subscribe((detail) => {
      onNewNotification(detail);
      // ponytail: only errors surface as flash popups; everything else is panel-only
      if (detail.type !== 'error') return;
      const id = Date.now();
      setFlashToast({ ...detail, id });
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashToast(null), 4200);
    });
  }, [onNewNotification]);

  const onlineDevicesCount = connectedDevices.filter(d => d.is_online === 1).length;

  return (
    <>
      <FlashToast
        toast={flashToast}
        onDismiss={() => setFlashToast(null)}
        onOpenReview={onOpenStagedReview}
        onOpenAutomationHub={onOpenAutomationHub}
      />

      <header className="h-14 bg-glass-bg border-b border-glass-border backdrop-blur-xl flex items-center justify-between px-3 sm:px-6 relative z-sticky-header shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="lg:hidden shrink-0 p-1.5 -ml-1 rounded-lg text-muted hover:text-text hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Menu size={20} />
          </button>
          {/* In-App Browser Navigation Controls (Back & Forward) */}
          <div className="flex items-center gap-0.5 bg-bg2/80 border border-border/70 rounded-xl p-0.5 shrink-0 shadow-xs">
            <button
              type="button"
              onClick={() => {
                if (window.history.length > 1) {
                  navigate(-1);
                } else {
                  navigate('/dashboard');
                }
              }}
              title="Go Back (Alt + Left Arrow)"
              aria-label="Go Back"
              className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 active:scale-95 transition-all cursor-pointer"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => navigate(1)}
              title="Go Forward (Alt + Right Arrow)"
              aria-label="Go Forward"
              className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 active:scale-95 transition-all cursor-pointer"
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <LiveHeaderClock />
          {catalogJob && (
            <div className="flex items-center gap-2.5 px-3 py-1 bg-primary/10 border border-primary/20 rounded-xl text-primary animate-pulse">
              <RefreshCw size={12} className="animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                Catalog: {catalogJob.status === 'pending_analysis' ? 'Analyzing' : catalogJob.status === 'processing_analysis' ? 'Processing analysis' : 'Ingesting'} ({Math.round(catalogJob.progress)}%)
              </span>
            </div>
          )}
          {enrichmentRunning && (
            <div className="flex items-center gap-2 px-3 py-1 bg-violet-500/10 border border-violet-500/20 rounded-xl text-violet-400">
              <RefreshCw size={12} className="animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Enriching compositions...</span>
            </div>
          )}
        </div>

        {/* CENTER SECTION: Multi-Segment Storage Progress Bar & Smart Contextual Auto-Focus Hub */}
        <div
          className="flex-1 flex justify-center items-center px-2 sm:px-4 max-w-[460px] mx-auto min-w-0 h-full relative"
          onMouseEnter={handleHubMouseEnter}
          onMouseLeave={handleHubMouseLeave}
        >
          {(() => {
            // Metrics for Storage-Style Progress Bar
            const waSent = waQueueDetail?.counts?.sent || 0;
            const waSending = (waQueueDetail?.counts?.sending || 0) + (activeSendMeta && !activeSendMeta.completed ? 1 : 0);
            const waPending = waQueueDetail?.counts?.pending || 0;
            const waFailed = (waQueueDetail?.counts?.failed_offline || 0) + (waQueueDetail?.counts?.failed_perm || 0);
            const waTotal = waSent + waSending + waPending + waFailed;

            const sentPct = waTotal > 0 ? (waSent / waTotal) * 100 : 0;
            const sendingPct = waTotal > 0 ? (waSending / waTotal) * 100 : 0;
            const pendingPct = waTotal > 0 ? (waPending / waTotal) * 100 : 0;
            const failedPct = waTotal > 0 ? (waFailed / waTotal) * 100 : 0;

            // 1. EXPANDED HUB VIEW (On Hover - 1580ms grace delay buffer)
            if (isHoverExpanded) {
              if (activeSendMeta && !activeSendMeta.completed) {
                return (
                  <LiveSendProgressChip
                    recipient={activeSendMeta.recipient}
                    durationSec={activeSendMeta.durationSec}
                    completed={activeSendMeta.completed}
                    waSent={waSent}
                    waPending={waPending}
                    waFailed={waFailed}
                    onClick={() => {
                      if (onOpenAutomationHub) onOpenAutomationHub();
                      else if (onOpenWaQueue) onOpenWaQueue();
                    }}
                    showQueueCounts={true}
                  />
                );
              }

              return (
                <div
                  onClick={() => {
                    if (onOpenAutomationHub) onOpenAutomationHub();
                    else if (onOpenWaQueue) onOpenWaQueue();
                  }}
                  className="w-full flex flex-col justify-center gap-1 h-full relative cursor-pointer group/progress animate-hub-enter"
                  title="Click to open Dispatch & WhatsApp Automation Hub"
                >
                  {/* Top Stats Breakdown */}
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <Zap size={12} className="text-primary animate-pulse shrink-0" />
                      <span className="truncate text-text font-bold text-xs tracking-tight">
                        Dispatch & Messaging Hub
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-bold">
                      {waSent > 0 && <span className="text-emerald-400">✓ {waSent}</span>}
                      {waSending > 0 && <span className="text-sky-400 animate-pulse">▶ {waSending}</span>}
                      {waPending > 0 && <span className="text-amber-400">⏰ {waPending}</span>}
                      {waFailed > 0 && <span className="text-rose-400 animate-pulse">⚠️ {waFailed}</span>}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onOpenAutomationHub) onOpenAutomationHub();
                          else if (onOpenWaQueue) onOpenWaQueue();
                        }}
                        className="text-[9px] font-black text-sky-400 hover:text-sky-300 hover:underline uppercase tracking-wider pl-1"
                      >
                        Open Hub
                      </button>
                    </div>
                  </div>

                  {/* Multi-Segment Storage-Style Progress Bar */}
                  <div className="w-full h-1.5 bg-bg border border-glass-border/60 rounded-full overflow-hidden flex relative shadow-inner">
                    {sentPct > 0 && (
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-300 ease-out"
                        style={{ width: `${sentPct}%` }}
                        title={`${waSent} Sent (${Math.round(sentPct)}%)`}
                      />
                    )}
                    {sendingPct > 0 && (
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 to-blue-400 animate-pulse transition-[width] duration-300 ease-out"
                        style={{ width: `${sendingPct}%` }}
                        title={`${waSending} Sending (${Math.round(sendingPct)}%)`}
                      />
                    )}
                    {pendingPct > 0 && (
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-orange-400 transition-[width] duration-300 ease-out"
                        style={{ width: `${pendingPct}%` }}
                        title={`${waPending} Pending / Retrying (${Math.round(pendingPct)}%)`}
                      />
                    )}
                    {failedPct > 0 && (
                      <div
                        className="h-full bg-gradient-to-r from-rose-500 to-red-500 animate-pulse transition-[width] duration-300 ease-out"
                        style={{ width: `${failedPct}%` }}
                        title={`${waFailed} Failed (${Math.round(failedPct)}%)`}
                      />
                    )}
                    {waTotal === 0 && (
                      <div className="h-full bg-emerald-500/60 w-full" title="All Clean" />
                    )}
                  </div>
                </div>
              );
            }

            // 2. CONTEXTUAL AUTO-FOCUS MODES (When NOT Hovered)

            // (0) Active Live Refill Cart Order in Progress
            if (activeCartJob) {
              const total = activeCartJob.rows.length;
              const added = activeCartJob.rows.filter(r => r.state === 'added' || r.state === 'in_cart').length;
              const working = activeCartJob.rows.filter(r => r.state === 'queued' || r.state === 'working').length;
              const needsLink = activeCartJob.rows.filter(r => r.state === 'needs_link' || r.state === 'linked_oos').length;
              const failed = activeCartJob.rows.filter(r => r.state === 'failed' || r.state === 'not_found').length;
              const done = total - working;
              const addedPct = total > 0 ? (added / total) * 100 : 0;
              const workingPct = total > 0 ? (working / total) * 100 : 0;
              const needsLinkPct = total > 0 ? (needsLink / total) * 100 : 0;
              const failedPct = total > 0 ? (failed / total) * 100 : 0;

              return (
                <div
                  onClick={() => openRefillCartJob(activeCartJob.id)}
                  className="w-full flex flex-col justify-center gap-1 h-full relative cursor-pointer group/progress animate-hub-enter"
                  title="Click to inspect Refill Cart background run"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <ShoppingCart size={12} className="text-primary animate-pulse shrink-0" />
                      <span className="truncate text-text font-bold text-xs tracking-tight">
                        Cart Order: {activeCartJob.patientName} ({done}/{total})
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-bold">
                      {added > 0 && <span className="text-emerald-400">✓ {added}</span>}
                      {working > 0 && <span className="text-sky-400 animate-pulse">▶ {working}</span>}
                      {needsLink > 0 && <span className="text-amber-400">🔗 {needsLink}</span>}
                      {failed > 0 && <span className="text-rose-400 animate-pulse">⚠️ {failed}</span>}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRefillCartJob(activeCartJob.id);
                        }}
                        className="text-[9px] font-black text-primary hover:underline uppercase tracking-wider pl-1"
                      >
                        Inspect
                      </button>
                    </div>
                  </div>

                  {/* Multi-Segment Storage-Style Progress Bar */}
                  <div className="w-full h-1.5 bg-bg border border-glass-border/60 rounded-full overflow-hidden flex relative shadow-inner">
                    {addedPct > 0 && (
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-300 ease-out"
                        style={{ width: `${addedPct}%` }}
                        title={`${added} In Cart (${Math.round(addedPct)}%)`}
                      />
                    )}
                    {workingPct > 0 && (
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 to-blue-400 animate-pulse transition-[width] duration-300 ease-out"
                        style={{ width: `${workingPct}%` }}
                        title={`${working} Searching / Adding (${Math.round(workingPct)}%)`}
                      />
                    )}
                    {needsLinkPct > 0 && (
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-orange-400 transition-[width] duration-300 ease-out"
                        style={{ width: `${needsLinkPct}%` }}
                        title={`${needsLink} Needs Link / OOS (${Math.round(needsLinkPct)}%)`}
                      />
                    )}
                    {failedPct > 0 && (
                      <div
                        className="h-full bg-gradient-to-r from-rose-500 to-red-500 animate-pulse transition-[width] duration-300 ease-out"
                        style={{ width: `${failedPct}%` }}
                        title={`${failed} Failed (${Math.round(failedPct)}%)`}
                      />
                    )}
                  </div>
                </div>
              );
            }

            // (A) Active Live Send in Progress
            if (activeSendMeta && !activeSendMeta.completed) {
              return (
                <LiveSendProgressChip
                  recipient={activeSendMeta.recipient}
                  durationSec={activeSendMeta.durationSec}
                  completed={activeSendMeta.completed}
                  waSent={waSent}
                  waPending={waPending}
                  waFailed={waFailed}
                  onClick={() => {
                    if (onOpenAutomationHub) onOpenAutomationHub();
                    else if (onOpenWaQueue) onOpenWaQueue();
                  }}
                  showQueueCounts={true}
                />
              );
            }

            // (B) Failed Messages Alert Mode
            if (waFailed > 0) {
              return (
                <div
                  onClick={() => {
                    if (onOpenAutomationHub) onOpenAutomationHub();
                    else if (onOpenWaQueue) onOpenWaQueue();
                  }}
                  className="w-full flex flex-col justify-center gap-0.5 h-full relative cursor-pointer group/progress animate-hub-enter"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 text-rose-400">
                      <AlertTriangle size={12} className="animate-pulse shrink-0" />
                      <span className="truncate font-bold text-xs tracking-tight">
                        ⚠️ {waFailed} Message{waFailed > 1 ? 's' : ''} Failed / Retrying
                      </span>
                    </div>
                    <button
                      type="button"
                      className="text-[10px] font-bold text-rose-400 hover:text-rose-300 hover:underline uppercase tracking-wider shrink-0"
                    >
                      Fix Now
                    </button>
                  </div>
                  <div className="w-full h-1 bg-bg border-t border-rose-500/40 rounded-full overflow-hidden relative shadow-inner">
                    <div className="h-full rounded-full bg-rose-500 animate-pulse w-full" />
                  </div>
                </div>
              );
            }

            // (C) Pending Messages / Silent Retries Heartbeat Mode
            if (waPending > 0 || waQueueDetail?.isPaused) {
              return (
                <div
                  onClick={onOpenWaQueue}
                  className="w-full flex flex-col justify-center gap-0.5 h-full relative cursor-pointer group/progress animate-hub-enter"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <ClockIcon size={12} className="text-amber-400 animate-pulse shrink-0" />
                      <span className="truncate text-text font-bold text-xs tracking-tight">
                        {waQueueDetail?.isPaused ? `Scheduled: ${waPending} Messages Paused` : `${waPending} Scheduled / Pending Retries`}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider shrink-0">
                      {waQueueDetail?.isPaused ? 'Paused' : 'Queue'}
                    </span>
                  </div>
                  <div className="w-full h-1 bg-bg border-t border-amber-500/40 rounded-full overflow-hidden relative shadow-inner">
                    <div className="h-full rounded-full bg-amber-400/80 animate-pulse w-full" />
                  </div>
                </div>
              );
            }

            // (D) Other Global Tasks Carousel (Catalog Sync / Backup / OCR)
            if (activeHeaderItems.length > 0 && currentHeaderItem) {
              return (
                <div
                  key={currentHeaderItem.id}
                  className="w-full flex flex-col justify-center gap-0.5 h-full relative cursor-pointer group/progress animate-hub-enter"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {currentHeaderItem.icon}
                      <span className="truncate text-text font-bold text-xs tracking-tight">
                        {currentHeaderItem.title}
                      </span>
                    </div>
                    {currentHeaderItem.action && (
                      <button
                        type="button"
                        onClick={currentHeaderItem.action}
                        className="text-[10px] font-bold text-sky-400 hover:text-sky-300 hover:underline cursor-pointer uppercase tracking-wider pl-1"
                      >
                        {currentHeaderItem.actionLabel || 'View'}
                      </button>
                    )}
                  </div>
                  {currentHeaderItem.progress !== undefined && (
                    <div className="w-full h-1 bg-bg border-t border-glass-border/40 rounded-full overflow-hidden relative shadow-inner">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ease-out relative bg-gradient-to-r ${currentHeaderItem.color === 'purple'
                            ? 'from-purple-500 via-indigo-500 to-sky-400'
                            : currentHeaderItem.color === 'sky'
                              ? 'from-sky-500 via-blue-500 to-cyan-400'
                              : currentHeaderItem.color === 'amber'
                                ? 'from-amber-500 to-orange-400'
                                : 'from-emerald-500 via-teal-400 to-emerald-400'
                          }`}
                        style={{ width: `${Math.min(100, Math.max(0, currentHeaderItem.progress))}%` }}
                      >
                        <div className="absolute right-0 top-0 bottom-0 w-2 bg-text/80 rounded-full shadow-sm" />
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // (E) Completely Idle / All Done (Auto-Hides cleanly; reveals on hover)
            return (
              <div
                className="w-full h-full flex items-center justify-center cursor-pointer group/idle"
                title="Hover to inspect Dispatch & Messaging Hub"
              >
                <div className="w-16 h-1 bg-glass-border/60 group-hover/idle:bg-glass-border group-hover/idle:w-24 rounded-full transition-all duration-300" />
              </div>
            );
          })()}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mobile Connection / Devices Status (Auto-hides when no devices connected) */}
          {(connectedDevices.length > 0 || onlineDevicesCount > 0) && (
            <div className="relative" ref={popoverRef}>
              <button
                onClick={() => setShowDevicesPopover(prev => !prev)}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer text-xs font-semibold uppercase tracking-wider
                  ${onlineDevicesCount > 0
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-glass-bg border-glass-border text-muted hover:text-text hover:bg-white/5'}
                `}
                title="Connected Mobile Devices"
              >
                <Smartphone size={14} className={onlineDevicesCount > 0 ? "animate-pulse" : ""} />
                <span>{onlineDevicesCount > 0 ? `${onlineDevicesCount} Online` : 'Offline'}</span>
              </button>

              {showDevicesPopover && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-glass-bg border border-glass-border backdrop-blur-2xl rounded-2xl shadow-2xl p-4 z-dropdown">
                  <div className="flex items-center justify-between pb-3 border-b border-glass-border mb-3">
                    <span className="text-xs font-bold uppercase text-text/80 tracking-wide">Sync Devices</span>
                    <button
                      onClick={() => { setShowDevicesPopover(false); onOpenConnectModal(); }}
                      className="flex items-center gap-1 text-[10px] font-black uppercase text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      <Plus size={12} />
                      Add Device
                    </button>
                  </div>

                  {connectedDevices.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted/60">
                      No devices registered. Click "Add Device" to pair a mobile phone.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto pr-1">
                      {connectedDevices.map(device => (
                        <div key={device.token} className="flex items-start justify-between p-2 rounded-xl bg-white/[0.02] border border-glass-border hover:bg-white/[0.04] transition-all">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <div className={`mt-0.5 p-1 rounded-lg ${device.is_online ? 'bg-emerald-500/10 text-emerald-400' : 'bg-black/20 text-muted'}`}>
                              <DeviceIcon os={device.os} size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              {renamingToken === device.token ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    className="w-full bg-black/40 border border-primary/40 rounded px-1.5 py-0.5 text-xs text-text focus:outline-none"
                                    autoFocus
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleRenameDevice(device.token, renameValue);
                                      if (e.key === 'Escape') setRenamingToken(null);
                                    }}
                                  />
                                  <button onClick={() => handleRenameDevice(device.token, renameValue)} className="text-emerald-400 hover:text-emerald-300">
                                    <Check size={12} />
                                  </button>
                                  <button onClick={() => setRenamingToken(null)} className="text-red-400 hover:text-red-300">
                                    <X size={12} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 group/name">
                                  <span className="text-xs font-semibold text-text truncate max-w-[120px]">{device.device_name}</span>
                                  <button
                                    onClick={() => { setRenamingToken(device.token); setRenameValue(device.device_name); }}
                                    className="opacity-0 group-hover/name:opacity-100 text-[10px] text-muted hover:text-text transition-opacity"
                                  >
                                    <Edit size={10} />
                                  </button>
                                </div>
                              )}
                              <div className="text-[9px] text-muted uppercase font-bold tracking-wider mt-0.5">{device.os}</div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${device.is_online ? 'bg-emerald-400 animate-pulse' : 'bg-muted/30'}`} />
                            <span className="text-[8px] text-muted font-mono whitespace-nowrap">
                              {device.is_online ? 'ONLINE' : (device.offline_seconds && device.offline_seconds > 86400) ? 'OFFLINE' : 'RECENT'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}


          {/* Live Cart Integrated Countdown Pill Button */}
          <LiveCartCountdownPill />

          {/* Quick Special Request Shortcut Button */}
          <button
            type="button"
            onClick={() => quickOrderEvent.triggerOpen()}
            onMouseEnter={() => api.warmupPharmarackSession()}
            className="relative p-2 rounded-xl transition-all duration-200 flex items-center justify-center border border-glass-border bg-glass-bg text-muted hover:text-text hover:bg-bg3/60 cursor-pointer group shrink-0"
            title="Quick Special Request (Alt+O)"
            aria-label="Quick special request"
          >
            <ClipboardPlus size={18} className="text-amber-400 group-hover:scale-110 transition-transform" />
          </button>

          {/* Single Shared WhatsApp Status Indicator & Automation Hub Launchpad */}
          {(() => {
            const isReady = waReadiness ? waReadiness.isReady : !!servicesStatus?.whatsapp?.connected;
            const isInitializing = waReadiness ? (waReadiness.isInitializing || (waReadiness.progress > 0 && waReadiness.progress < 100)) : !!servicesStatus?.whatsapp?.initializing;
            const isSleeping = waReadiness ? waReadiness.isSleeping : !!servicesStatus?.whatsapp?.sleeping;
            const progress = waReadiness ? waReadiness.progress : (isReady ? 100 : 0);
            const statusLabel = waReadiness?.status || (isReady ? 'Ready (100%)' : isInitializing ? `Connecting (${progress}%)` : isSleeping ? 'Sleeping (Auto-wakes on demand)' : 'Disconnected');

            // Single shared status styling: 🟢 Green (Ready) / 🟡 Amber (Waking) / 🔴 Red (Sleeping/Error)
            let statusBtnCls = 'bg-glass-bg border-glass-border text-muted hover:text-text hover:bg-bg3/60';
            let dotEl = null;

            if (automationHubHeadline === 'failed' || (waReadiness?.lastError && !isReady)) {
              statusBtnCls = 'bg-rose-500/15 border-rose-500/40 text-rose-400';
              dotEl = <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-bg animate-bounce" />;
            } else if (isInitializing || automationHubHeadline === 'sending') {
              statusBtnCls = 'bg-amber-500/15 border-amber-500/40 text-amber-400';
              dotEl = (
                <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-[9px] font-black text-bg ring-2 ring-bg animate-pulse font-mono">
                  {progress > 0 && progress < 100 ? `${progress}%` : <RefreshCw size={8} className="animate-spin" />}
                </span>
              );
            } else if (isReady) {
              statusBtnCls = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20';
              dotEl = (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
                </span>
              );
            } else if (isSleeping) {
              statusBtnCls = 'bg-rose-500/10 border-rose-500/20 text-rose-400/90 hover:bg-rose-500/20';
              dotEl = <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-rose-400/80 ring-2 ring-bg" />;
            } else {
              statusBtnCls = 'bg-rose-500/10 border-rose-500/25 text-rose-400 hover:bg-rose-500/20';
              dotEl = <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-bg" />;
            }

            return (
              <button
                type="button"
                onClick={onOpenAutomationHub}
                onMouseEnter={() => { import('./AutomationHubPopover').then(m => m.prefetchAutomationHub?.()).catch(() => {}); }}
                className={`relative p-2 rounded-xl transition-all duration-200 flex items-center justify-center border cursor-pointer group ${statusBtnCls}`}
                aria-label="WhatsApp Status & Automation Hub"
                title={`WhatsApp: ${statusLabel} — Click to open Automation Hub`}
              >
                {isInitializing ? (
                  <RefreshCw size={18} className="animate-spin group-hover:scale-110 transition-transform" />
                ) : (
                  <MessageSquareText size={18} className="group-hover:scale-110 transition-transform" />
                )}
                {dotEl}
              </button>
            );
          })()}

          {/* Notification bell */}
          <div className="relative">
            <button
              onClick={() => setShowPanel(prev => !prev)}
              className={`relative p-2 rounded-xl transition-all duration-200 flex items-center justify-center border cursor-pointer group ${showPanel
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-400 shadow-sm'
                  : hasUnread
                    ? 'bg-glass-bg border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:border-sky-500/50'
                    : 'bg-glass-bg border-glass-border text-muted hover:text-text hover:bg-bg3/60'
                }`}
              aria-label="Notifications"
              title="Notifications"
            >
              <div className="relative flex items-center justify-center">
                {hasUnread ? (
                  <BellRing size={18} className="animate-pulse text-sky-400 group-hover:scale-110 transition-transform" />
                ) : (
                  <Bell size={18} className="group-hover:scale-110 transition-transform" />
                )}
              </div>
              {hasUnread && (
                <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 text-white text-[10px] font-black shadow-md shadow-sky-500/30 ring-2 ring-bg border border-sky-300/40">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-40"></span>
                  <span className="relative z-10">{notifications.filter(n => !n.read).length > 99 ? '99+' : notifications.filter(n => !n.read).length}</span>
                </span>
              )}
            </button>

            {showPanel && (
              <NotificationPanel
                notifications={notifications}
                onClearAll={onClearAll}
                onClearOne={onClearOne}
                onMarkRead={onMarkRead}
                onClose={() => setShowPanel(false)}
              />
            )}
          </div>

          <KeyboardShortcutsModal
            isOpen={showShortcutHelp}
            onClose={() => setShowShortcutHelp(false)}
          />
        </div>
      </header>
    </>
  );
});

// ──────────────────────────────────────────────
// Quick Assist Sidebar
// ──────────────────────────────────────────────
// QuickAssistSidebar has been extracted to ./QuickAssistSidebar.tsx

// Module-level cache for staged counts to prevent redundant database fetches on page switches (G4)
let cachedStagedSalesCount: number | null = null;
let cachedStagedPurchasesCount: number | null = null;
let lastStagedCountsFetchTime = 0;

// Stable empty-array identities — memoized QuickAssistSidebar props must not
// churn (new [] each render) while the queries are still resolving.
const NO_SPECIAL_ORDERS: SpecialOrder[] = [];
const NO_REFILLS: Refill[] = [];

// ──────────────────────────────────────────────
// Layout (holds notification state globally)
// ──────────────────────────────────────────────
export const Layout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const location = useLocation();
  const queryClient = useQueryClient();
  const isPortalPage = ['/portal', '/refill-portal', '/customer-login', '/customer/login', '/my-bills', '/customer-bills'].includes(location.pathname);
  const isFitPage = ['/pos', '/inventory', '/database', '/returns', '/purchases', '/manual-purchase', '/sells', '/purchase-history', '/crm', '/reports', '/settings', '/pharmarack-cart', '/investigation', '/phone-sales', '/migration', '/online-catalog'].includes(location.pathname);
  const isLocalOrigin = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '0.0.0.0' ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.') ||
    window.location.hostname.endsWith('.local')
  );

  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const stored = localStorage.getItem('app_notifications');
      if (stored) {
        const parsed = JSON.parse(stored);
        return (parsed as AppNotification[]).map((n) => ({ ...n, time: new Date(n.time) }));
      }
    } catch (e) {
      console.warn('Failed to load notifications from localStorage:', e);
    }
    return [];
  });
  const [hasUnread, setHasUnread] = useState(() => {
    try {
      const stored = localStorage.getItem('app_notifications');
      if (stored) {
        const parsed = JSON.parse(stored);
        return (parsed as AppNotification[]).some((n) => !n.read);
      }
    } catch { }
    return false;
  });

  useEffect(() => {
    try {
      localStorage.setItem('app_notifications', JSON.stringify(notifications));
    } catch (e) {
      console.warn('Failed to save notifications to localStorage:', e);
    }
  }, [notifications]);

  const [showStagedReview, setShowStagedReview] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showWaQueuePopover, setShowWaQueuePopover] = useState(false);
  const [pendingStagedSalesCount, setPendingStagedSalesCount] = useState(0);
  const [pendingStagedPurchasesCount, setPendingStagedPurchasesCount] = useState(0);
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [showLiveCartAdd, setShowLiveCartAdd] = useState(false);
  const [liveCartAddSearch, setLiveCartAddSearch] = useState<string | undefined>(undefined);
  const [liveCartAddQty, setLiveCartAddQty] = useState<number | undefined>(undefined);
  const [liveCartAddSourceOrderId, setLiveCartAddSourceOrderId] = useState<number | undefined>(undefined);
  const [liveCartAddSourceRefillId, setLiveCartAddSourceRefillId] = useState<number | undefined>(undefined);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // Intercept window close ('X' button or Alt+F4) to confirm before exiting
  useEffect(() => {
    // Cancel any pending tab-close shutdown if this is a page reload or a new tab opened
    const cancelShutdown = () => {
      apiClient.post('/system/cancel-shutdown').catch(() => {});
    };

    cancelShutdown();

    const handleFocus = () => {
      cancelShutdown();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        cancelShutdown();
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // If user already initiated an intentional exit via Exit App button, don't show secondary prompt
      if ((window as any).__AI_PHARMACY_EXITING__) {
        return;
      }
      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    const handlePageHide = () => {
      // If user already exited intentionally, or window is navigating within app, skip
      if ((window as any).__AI_PHARMACY_EXITING__) {
        return;
      }
      // When closing the window or tab, send a graceful tab-close shutdown beacon with a grace period
      // (If user merely refreshed the page, the newly loaded page immediately cancels it via cancel-shutdown)
      try {
        const url = '/api/system/shutdown?type=tab_close';
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url);
        } else {
          fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
        }
      } catch (_) {}
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    return whatsappQueueEvent.subscribeOpen(() => {
      setShowWaQueuePopover(true);
    });
  }, []);

  const [showAutomationHub, setShowAutomationHub] = useState(false);
  const [automationHubHeadline, setAutomationHubHeadline] = useState<'sending' | 'failed' | 'idle'>('idle');

  useEffect(() => {
    const unsubscribeOpen = automationHubEvent.subscribeOpen(() => setShowAutomationHub(true));
    return unsubscribeOpen;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pollHeadline = async () => {
      try {
        const summary = await api.getAutomationHubSummary();
        if (!cancelled) setAutomationHubHeadline(summary.headline);
      } catch (_) {
        // Non-fatal — badge just stays at its last known state
      }
    };
    pollHeadline();
    const unsubscribeUpdated = automationHubEvent.subscribeUpdated(pollHeadline);
    const unsubscribeQueueUpdated = whatsappQueueEvent.subscribeUpdated(pollHeadline);
    return () => {
      cancelled = true;
      unsubscribeUpdated();
      unsubscribeQueueUpdated();
    };
  }, []);

  const handleAutomationHubClose = () => {
    setShowAutomationHub(false);
  };

  const [stagedNotifications, setStagedNotifications] = useState<AutomationNotification[]>([]);
  const [compactCacheLoaded, setCompactCacheLoaded] = useState(() => isCompactInventoryCacheReady());
  const [isSystemReady, setIsSystemReady] = useState(true);

  useEffect(() => {
    let mounted = true;
    const checkReadiness = async () => {
      try {
        const res = await apiClient.get('/health/ready');
        if (mounted) {
          setIsSystemReady(res.data?.ready !== false);
        }
      } catch (err: unknown) {
        if (mounted && (err as LocalApiErrorShape)?.response?.status === 503) {
          setIsSystemReady(false);
        }
      }
    };
    checkReadiness();
    return () => { mounted = false; };
  }, []);

  // Priority 0 on cold boot: compact inventory cache before other startup polls
  useEffect(() => {
    if (compactCacheLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        await api.getCompactInventory();
        if (!cancelled) {
          console.log('[Layout] Compact inventory cache loaded.');
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[Layout] Failed to load compact inventory:', err);
          if (!isCompactInventoryCacheReady()) {
            setCompactInventoryCache([]);
          }
        }
      } finally {
        // ALWAYS mark cache loaded so POS search bar unlocks even if 401 or DB empty
        if (!cancelled) setCompactCacheLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [compactCacheLoaded]);

  const { data: specialOrdersList = NO_SPECIAL_ORDERS, refetch: refetchSpecialOrders } = useApiQuery<SpecialOrder[]>(
    'orders',
    async () => {
      const data = await api.getOrders();
      return Array.isArray(data) ? data : [];
    },
    { staleTime: 30000, enabled: compactCacheLoaded }
  );

  const { data: refillsList = NO_REFILLS, refetch: refetchRefills } = useApiQuery<Refill[]>(
    'refills',
    async () => {
      const data = await api.getRefills();
      return Array.isArray(data) ? data : [];
    },
    { staleTime: 30000, enabled: compactCacheLoaded }
  );

  // P1 "events, not timers": ONE global SSE listener replaces all periodic
  // background polling (API_OPTIMIZATION_IMPLEMENTATION_PLAN.md Phase 3).
  useGlobalSseInvalidation(compactCacheLoaded);

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      refetchSpecialOrders();
    };
    window.addEventListener('refresh-special-orders', handleRefresh);
    window.addEventListener('app-special-orders-updated', handleRefresh);
    return () => {
      window.removeEventListener('refresh-special-orders', handleRefresh);
      window.removeEventListener('app-special-orders-updated', handleRefresh);
    };
  }, [queryClient, refetchSpecialOrders]);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem('quick_assist_sidebar_expanded') ?? localStorage.getItem('refill_sidebar_expanded');
      return stored !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('quick_assist_sidebar_expanded', String(isSidebarExpanded));
    } catch { }
  }, [isSidebarExpanded]);

  // Daily Communications Modal state — lifted here so modal renders at root level
  // (avoids z-index / overflow-hidden stacking context issues from sidebar)
  const [isDailyModalOpen, setIsDailyModalOpen] = useState(false);
  const [dailySummary, setDailySummary] = useState<{
    sentTodayCount: number;
    stagedCount: number;
    sentPhones: Array<{ recipient_phone: string; last_sent_at: string; recipient_name?: string }>;
  }>({
    sentTodayCount: 0,
    stagedCount: 0,
    sentPhones: []
  });

  const loadDailySummary = useCallback(() => {
    api.getDailyNotificationSummary()
      .then(res => {
        if (res && res.success) {
          setDailySummary({
            sentTodayCount: res.sentTodayCount || 0,
            stagedCount: res.stagedCount || 0,
            sentPhones: res.sentPhones || []
          });
        }
      })
      .catch(() => {});
  }, []);

  // Close daily modal whenever the sidebar collapses
  useEffect(() => {
    if (!isSidebarExpanded) {
      setIsDailyModalOpen(false);
    }
  }, [isSidebarExpanded]);

  const fetchStagedNotifications = useCallback(async () => {
    try {
      const notifications = await api.getAutomationNotifications({ status: 'staged' });
      setStagedNotifications(Array.isArray(notifications) ? notifications : []);
    } catch (err) {
      console.warn('Failed to load staged notifications in layout:', err);
    }
  }, []);

  useEffect(() => {
    if (!compactCacheLoaded) return;
    loadDailySummary();
    fetchStagedNotifications();
    // focus + visibilitychange + app-purchases-updated can all fire within the
    // same tab-switch — one leading-edge throttled refresh instead of 2-3
    // identical fetch bursts (same pattern as useGlobalSseInvalidation dedupe)
    let lastRefreshAt = 0;
    const refreshAll = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 3000) return;
      lastRefreshAt = now;
      loadDailySummary();
      fetchStagedNotifications();
      refetchSpecialOrders();
      refetchRefills();
    };
    const unsubRefill = refillEvent.subscribeRefresh(refreshAll);

    window.addEventListener('focus', refreshAll);
    document.addEventListener('visibilitychange', refreshAll);
    window.addEventListener('app-purchases-updated', refreshAll);

    return () => {
      unsubRefill();
      window.removeEventListener('focus', refreshAll);
      document.removeEventListener('visibilitychange', refreshAll);
      window.removeEventListener('app-purchases-updated', refreshAll);
    };
  }, [compactCacheLoaded, loadDailySummary, fetchStagedNotifications, refetchSpecialOrders, refetchRefills]);

  const [showBackupModal, setShowBackupModal] = useState(false);
  const [isBackupStartupMode, setIsBackupStartupMode] = useState(false);

  useEffect(() => {
    if (!compactCacheLoaded) return;

    const checkBackupStatus = async () => {
      try {
        const { data } = await apiClient.get('/utilities/backup/status');
        if (data.success && data.showRestorePopup) {
          setIsBackupStartupMode(true);
          setShowBackupModal(true);
        }
      } catch (err) {
        console.warn('Failed to check startup restore status:', err);
      }
    };
    checkBackupStatus();

    window.openBackupCenter = () => {
      setIsBackupStartupMode(false);
      setShowBackupModal(true);
    };

    return () => {
      delete window.openBackupCenter;
    };
  }, [compactCacheLoaded]);

  const fetchStagedCounts = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && cachedStagedSalesCount !== null && cachedStagedPurchasesCount !== null && (now - lastStagedCountsFetchTime < 30000)) {
      setPendingStagedSalesCount(cachedStagedSalesCount);
      setPendingStagedPurchasesCount(cachedStagedPurchasesCount);
      return;
    }

    try {
      const [sales, purchases] = await Promise.all([
        api.getStagedSales(),
        api.getStagedPurchases(),
      ]);
      cachedStagedSalesCount = sales.length;
      cachedStagedPurchasesCount = purchases.length;
      lastStagedCountsFetchTime = now;
      setPendingStagedSalesCount(sales.length);
      setPendingStagedPurchasesCount(purchases.length);
    } catch (err) {
      console.warn('Failed to load staged counts:', err);
    }
  }, []);

  useEffect(() => {
    fetchStagedCounts();
    window.refreshStagedCounts = fetchStagedCounts;
    return () => {
      delete window.refreshStagedCounts;
    };
  }, [fetchStagedCounts]);

  // Subscribe to global open events for modals (G2)
  useEffect(() => {
    const unsubscribeQuickOrder = quickOrderEvent.subscribeOpen(() => setShowQuickOrder(true));
    const unsubscribeLiveCartAdd = liveCartAddEvent.subscribeOpen((detail) => {
      setLiveCartAddSearch(detail?.search);
      setLiveCartAddQty(detail?.qty);
      setLiveCartAddSourceOrderId(detail?.sourceOrderId);
      setLiveCartAddSourceRefillId(detail?.sourceRefillId);
      setShowLiveCartAdd(true);
    });
    return () => {
      unsubscribeQuickOrder();
      unsubscribeLiveCartAdd();
    };
  }, []);

  // Listen to global keyboard shortcuts for modals (G2)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isQuickOrderKey =
        (e.altKey && (e.key === 'o' || e.key === 'O')) ||
        (e.altKey && (e.key === 'n' || e.key === 'N')) ||
        (e.ctrlKey && e.shiftKey && (e.key === 'o' || e.key === 'O'));

      if (isQuickOrderKey) {
        e.preventDefault();
        setShowQuickOrder(prev => !prev);
      }

      const isLiveCartKey =
        (e.altKey && (e.key === 'l' || e.key === 'L')) ||
        (e.ctrlKey && e.shiftKey && (e.key === 'l' || e.key === 'L'));

      if (isLiveCartKey) {
        e.preventDefault();
        setShowLiveCartAdd(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Global Arrow Key Navigation (Shift columns / Move focus, do not change numbers)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      const target = e.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT' && target.tagName !== 'TEXTAREA') return;

      if (e.defaultPrevented) return;

      if (target instanceof HTMLInputElement && target.type === 'number') {
        e.preventDefault();
      }

      const focusableSelector = 'input:not([disabled]):not([readonly]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';
      const elements = Array.from(document.querySelectorAll(focusableSelector)) as HTMLElement[];
      const index = elements.indexOf(target);

      if (index > -1) {
        e.preventDefault();

        let nextEl: HTMLElement | undefined;
        if (e.key === 'ArrowDown') {
          nextEl = elements[index + 1];
        } else if (e.key === 'ArrowUp') {
          nextEl = elements[index - 1];
        }

        if (nextEl) {
          nextEl.focus();
          if (nextEl instanceof HTMLInputElement && nextEl.type !== 'checkbox' && nextEl.type !== 'radio') {
            nextEl.select();
          }
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleNewNotification = useCallback((detail: ToastEventDetail) => {
    const newNotif: AppNotification = {
      id: Date.now(),
      message: detail.message,
      type: detail.type,
      time: new Date(),
      read: false,
      link: detail.link,
      distributor: detail.distributor,
      qty: detail.qty,
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 50));
    setHasUnread(true);

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const title = `AI Pharmacy - ${detail.type.toUpperCase()}`;
        const options = {
          body: detail.message,
          icon: '/favicon.ico',
          tag: 'ai-pharmacy-notification',
        };
        new window.Notification(title, options);
      } catch (err) {
        console.warn('Failed to fire native Notification:', err);
      }
    }
  }, []);

  const handleClearAll = useCallback(async () => {
    setNotifications([]);
    setHasUnread(false);
    try {
      localStorage.removeItem('app_notifications');
    } catch (_) {}
    try {
      await api.clearActionLogs();
    } catch (err) {
      console.warn('Failed to clear action logs from DB:', err);
    }
  }, []);

  const handleClearOne = useCallback(async (id: number | string) => {
    const idStr = String(id);
    if (idStr.startsWith('log-')) {
      const numId = parseInt(idStr.replace('log-', ''), 10);
      if (!isNaN(numId)) {
        try {
          await api.deleteActionLog(numId);
        } catch (err) {
          console.warn('Failed to delete action log from DB:', err);
        }
      }
    }
    setNotifications(prev => {
      const updated = prev.filter(n => String(n.id) !== idStr);
      if (updated.length === 0 || updated.every(n => n.read)) setHasUnread(false);
      return updated;
    });
  }, []);

  const handleMarkRead = useCallback((id: number | string) => {
    setNotifications(prev => {
      const updated = prev.map(n => String(n.id) === String(id) ? { ...n, read: !n.read } : n);
      if (updated.every(n => n.read)) setHasUnread(false);
      return updated;
    });
  }, []);

  // Stable chrome callbacks — memoized Sidebar/Topbar/QuickAssist bail out on
  // navigation re-renders only if every prop keeps its identity.
  const openStagedReview = useCallback(() => setShowStagedReview(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const openConnectModal = useCallback(() => setShowConnectModal(true), []);
  const openWaQueuePopover = useCallback(() => setShowWaQueuePopover(true), []);
  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const openDailyModal = useCallback(() => {
    loadDailySummary();
    setIsDailyModalOpen(true);
  }, [loadDailySummary]);
  const handleQuickAssistActionComplete = useCallback(() => {
    fetchStagedNotifications();
    refetchSpecialOrders();
    refetchRefills();
  }, [fetchStagedNotifications, refetchSpecialOrders, refetchRefills]);

  if (!isLocalOrigin && !isPortalPage) {
    return <Navigate to="/portal" replace />;
  }

  if (isPortalPage) {
    return (
      <div className="min-h-screen w-full bg-bg text-text selection:bg-primary/30 flex flex-col overflow-y-auto">
        <main className="flex-1 w-full flex flex-col min-h-0">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text selection:bg-primary/30">
      <Sidebar
        stagedSalesCount={pendingStagedSalesCount}
        stagedPurchasesCount={pendingStagedPurchasesCount}
        onOpenReview={openStagedReview}
        mobileOpen={mobileNavOpen}
        onClose={closeMobileNav}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {!isSystemReady && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-700 px-4 py-2 text-xs font-semibold flex items-center justify-between shrink-0 z-global-modal">
            <div className="flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin text-amber-500" />
              <span>Database initialization in progress — verifying schemas & integrity...</span>
            </div>
          </div>
        )}
        <Topbar
          notifications={notifications}
          hasUnread={hasUnread}
          onNewNotification={handleNewNotification}
          onClearAll={handleClearAll}
          onClearOne={handleClearOne}
          onMarkRead={handleMarkRead}
          onOpenStagedReview={openStagedReview}
          onOpenConnectModal={openConnectModal}
          onOpenWaQueue={openWaQueuePopover}
          onOpenAutomationHub={() => setShowAutomationHub(true)}
          automationHubHeadline={automationHubHeadline}
          onMenuClick={openMobileNav}
          compactCacheLoaded={compactCacheLoaded}
        />
        <div className="flex-1 flex flex-row overflow-hidden relative min-h-0">
          <main className={`flex-1 flex flex-col min-h-0 ${isPortalPage ? 'overflow-y-auto p-0' : isFitPage ? 'overflow-hidden p-3 pt-1.5 pb-3' : 'overflow-y-auto p-4 pt-3 pb-4'} relative transition-all duration-200`}>
            {children}
          </main>

          <QuickAssistSidebar
            expanded={isSidebarExpanded}
            setExpanded={setIsSidebarExpanded}
            refills={refillsList}
            notifications={stagedNotifications}
            specialOrders={specialOrdersList}
            onActionComplete={handleQuickAssistActionComplete}
            dailySummary={dailySummary}
            onOpenDailyModal={openDailyModal}
            onRefreshDailyLog={loadDailySummary}
          />
        </div>

        {/* Real-Time Connected Mobile Devices Status Footer Bar */}
        <ConnectedDevicesFooterBar
          onOpenConnectModal={openConnectModal}
        />

        {/* Global Modals */}
        <Suspense fallback={null}>
          <RefillCartJobHost />
        </Suspense>
        {showQuickOrder && (
          <Suspense fallback={null}>
            <QuickOrderModal onClose={() => setShowQuickOrder(false)} />
          </Suspense>
        )}
        {showLiveCartAdd && (
          <Suspense fallback={null}>
            <LiveCartAddModal
              initialSearch={liveCartAddSearch}
              initialQty={liveCartAddQty}
              sourceOrderId={liveCartAddSourceOrderId}
              sourceRefillId={liveCartAddSourceRefillId}
              onClose={() => {
                setShowLiveCartAdd(false);
                setLiveCartAddSearch(undefined);
                setLiveCartAddQty(undefined);
                setLiveCartAddSourceOrderId(undefined);
                setLiveCartAddSourceRefillId(undefined);
              }}
            />
          </Suspense>
        )}

        {showStagedReview && (
          <Suspense fallback={null}>
            <StagedReviewModal
              onClose={() => setShowStagedReview(false)}
              onActionComplete={() => fetchStagedCounts(true)}
            />
          </Suspense>
        )}

        {showConnectModal && (
          <Suspense fallback={null}>
            <MobileConnectionModal
              onClose={() => setShowConnectModal(false)}
            />
          </Suspense>
        )}

        {showWaQueuePopover && (
          <Suspense fallback={null}>
            <WhatsAppQueuePopover
              onClose={() => setShowWaQueuePopover(false)}
            />
          </Suspense>
        )}

        {showAutomationHub && (
          <Suspense fallback={null}>
            <AutomationHubPopover
              onClose={handleAutomationHubClose}
            />
          </Suspense>
        )}

        {showBackupModal && (
          <Suspense fallback={null}>
            <BackupCenterModal
              isOpen={showBackupModal}
              onClose={() => setShowBackupModal(false)}
              isStartupMode={isBackupStartupMode}
            />
          </Suspense>
        )}

        {/* Daily Communications Modal — rendered at root to escape sidebar stacking context */}
        {isDailyModalOpen && (
          <DailyCommunicationsModal
            isOpen={isDailyModalOpen}
            onClose={() => setIsDailyModalOpen(false)}
            onRefresh={() => {
              loadDailySummary();
              handleQuickAssistActionComplete();
            }}
          />
        )}

        {/* Subtle background glow */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[100px]" />
          <div className="absolute bottom-[-10%] left-[-5%] w-[40%] h-[40%] bg-purple/5 rounded-full blur-[100px]" />
        </div>
      </div>
    </div>
  );
};

export default Layout;
