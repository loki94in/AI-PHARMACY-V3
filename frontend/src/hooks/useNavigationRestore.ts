import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { toastEvent } from '../services/events';

export const CHECKPOINT_STORAGE_KEY = 'pharmacy_update_checkpoint';
export const LAST_ROUTE_STORAGE_KEY = 'pharmacy_last_active_route';

const IGNORED_PATHS = [
  '/',
  '/portal',
  '/customer-login',
  '/customer/login',
  '/owner/login',
  '/owner-login',
];

/**
 * Hook to track current route and handle post-update session state restoration.
 * Coucou parity: Resumes the user's active screen and sub-tab seamlessly on relaunch.
 */
export function useNavigationRestore() {
  const location = useLocation();

  // 1. Continuously record the active route
  useEffect(() => {
    const fullPath = location.pathname + location.search + location.hash;
    if (fullPath && !IGNORED_PATHS.includes(location.pathname)) {
      try {
        localStorage.setItem(LAST_ROUTE_STORAGE_KEY, fullPath);
      } catch (_) {}
    }
  }, [location]);

  // 2. On boot, detect if the app was restarted after an update and confirm resumption
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHECKPOINT_STORAGE_KEY);
      if (raw) {
        const cp = JSON.parse(raw);
        if (cp && !cp.resumed) {
          cp.resumed = true;
          localStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(cp));

          // Notify backend that checkpoint was consumed
          fetch('/api/system/session-checkpoint/resumed', { method: 'POST' }).catch(() => {});

          // Display reassuring Coucou-style restoration toast
          const versionText = cp.targetVersion ? ` to v${cp.targetVersion}` : '';
          setTimeout(() => {
            toastEvent.trigger(`Updated${versionText} — Restored your session where you left off.`, 'success');
          }, 800);
        }
      }
    } catch (_) {}
  }, []);
}

