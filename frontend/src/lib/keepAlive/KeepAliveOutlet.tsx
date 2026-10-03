import { Suspense, useState, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PageActiveProvider } from './PageActiveContext';
import { PageQueryTracker } from './PageQueryTracker';
import { PageErrorBoundary } from './PageErrorBoundary';

export { usePageActive } from './PageActiveContext';

export interface KeepAliveRoute {
  path: string;
  element: ReactNode;
}

interface Props {
  routes: KeepAliveRoute[];
  notFoundElement: ReactNode;
  fallback?: ReactNode;
}

/**
 * High-frequency workhorse pages that stay mounted in the DOM once visited
 * (hidden via display: none when inactive) to provide instantaneous 0ms page switching.
 * Low-frequency or heavy modules (e.g. Reports, Migration, Database, AI Engineering)
 * unmount cleanly when navigating away to keep RAM and CPU controlled.
 */
const HIGH_PRIORITY_PATHS = new Set([
  '/pos',
  '/dashboard',
  '/inventory',
  '/sells',
  '/purchases',
  '/manual-purchase',
  '/crm',
  '/pharmarack-cart'
]);

// Essential workhorse pages that should be pre-mounted in the DOM at boot for 0ms instant access
export const BOOT_PREMOUNT_PATHS = ['/inventory', '/sells'] as const;

export function isKeepAliveEssentialEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem('keep_alive_essential_pages') !== 'false';
  } catch {
    return true;
  }
}

export function KeepAliveOutlet({ routes, notFoundElement, fallback }: Props) {
  const location = useLocation();
  const currentPath = location.pathname;

  // Track high-priority routes that have been visited and should remain in the DOM
  const [mountedHighPriorityPaths, setMountedHighPriorityPaths] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (HIGH_PRIORITY_PATHS.has(currentPath)) {
      initial.add(currentPath);
    }
    return initial;
  });

  // Delayed 12-second warm-mount of essential pages so POS gets 100% CPU during initial boot
  useEffect(() => {
    if (!isKeepAliveEssentialEnabled()) return;
    const timer = setTimeout(() => {
      setMountedHighPriorityPaths(prev => {
        let changed = false;
        const next = new Set(prev);
        BOOT_PREMOUNT_PATHS.forEach(p => {
          if (!next.has(p)) {
            next.add(p);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 12_000); // 12 seconds (in 10-14s window)

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (HIGH_PRIORITY_PATHS.has(currentPath)) {
      setMountedHighPriorityPaths(prev => {
        if (prev.has(currentPath)) return prev;
        const next = new Set(prev);
        next.add(currentPath);
        return next;
      });
    }
  }, [currentPath]);

  const matched = routes.find(r => r.path === currentPath);

  if (!matched) {
    return <>{notFoundElement}</>;
  }

  // Routes to render in the DOM:
  // 1. All visited high-priority routes (rendered, toggled via CSS display: none when inactive)
  // 2. The current active route (if not already in high-priority routes)
  const routesToRender = routes.filter(r => {
    return mountedHighPriorityPaths.has(r.path) || r.path === currentPath;
  });

  return (
    <div className="h-full w-full flex-1 flex flex-col min-h-0 relative">
      {routesToRender.map(route => {
        const isActive = route.path === currentPath;

        return (
          <div
            key={route.path}
            className={isActive ? "h-full w-full flex-1 flex flex-col min-h-0" : "hidden"}
            style={!isActive ? { display: 'none' } : undefined}
            aria-hidden={!isActive}
          >
            <PageQueryTracker pagePath={route.path} active={isActive} />
            <PageActiveProvider value={isActive}>
              <PageErrorBoundary pagePath={route.path}>
                <Suspense fallback={fallback || null}>
                  {route.element}
                </Suspense>
              </PageErrorBoundary>
            </PageActiveProvider>
          </div>
        );
      })}
    </div>
  );
}

