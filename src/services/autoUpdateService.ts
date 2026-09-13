/**
 * AutoUpdateService — checks for new app versions every 15 days.
 * Runs silently on boot. Fires SSE event when an update is available.
 * Manual check also available via triggerCheck().
 */

import { dbManager } from '../database/connection.js';
import { checkForUpdate } from './licenseService.js';
import { eventService } from './eventService.js';
import { activityTracker } from '../utils/activityTracker.js';

const BOOT_DELAY_MS    = 60_000;
// ponytail: poll every 6h only to check IF a 15-day check is due — not to run it unconditionally
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

class AutoUpdateService {
  private static instance: AutoUpdateService;
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastResult: { hasUpdate: boolean; latestVersion?: string; downloadUrl?: string; changelog?: string } | null = null;

  static getInstance(): AutoUpdateService {
    if (!AutoUpdateService.instance) AutoUpdateService.instance = new AutoUpdateService();
    return AutoUpdateService.instance;
  }

  /** Start the scheduler. Called once from server.ts after schema is ready. */
  start(): void {
    // Delay first check so it doesn't compete with boot DB/schema work
    setTimeout(() => this.runCheck('auto'), BOOT_DELAY_MS);

    // Poll every 6h but only run the actual network check if 15 days have elapsed
    // AND the PC is idle (B1: gated on activityTracker — no check during active sessions)
    this.intervalHandle = setInterval(async () => {
      if (!activityTracker.isIdle(30 * 60 * 1000)) return; // skip if active in last 30 min
      await this.runCheck('auto');
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null; }
  }

  /** Manual trigger from Settings "Check Now" button. Always runs regardless of interval. */
  async triggerCheck(): Promise<typeof this.lastResult> {
    await this.runCheck('manual');
    return this.lastResult;
  }

  private async runCheck(reason: 'auto' | 'manual'): Promise<void> {
    try {
      const db = await dbManager.getConnection();
      const row = await db.get<any>('SELECT last_checked_at, check_interval_days FROM update_checks WHERE id = 1');

      // Auto checks: skip if within the configured interval
      if (reason === 'auto' && row?.last_checked_at) {
        const lastMs = new Date(row.last_checked_at).getTime();
        const intervalDays = row.check_interval_days ?? 15;
        const intervalMs   = intervalDays * 24 * 60 * 60 * 1000;
        if (Date.now() - lastMs < intervalMs) return; // not yet due
      }

      const result = await checkForUpdate();
      if (!result) return; // offline

      this.lastResult = result;

      if (result.hasUpdate) {
        console.log(`[AutoUpdate] New version available: ${result.latestVersion}`);
        eventService.broadcast('update_available', {
          latestVersion: result.latestVersion,
          downloadUrl:   result.downloadUrl,
          changelog:     result.changelog,
          reason,
        });
      } else {
        if (reason === 'manual') {
          // Notify frontend that check is complete and app is up-to-date
          eventService.broadcast('update_check_complete', {
            hasUpdate: false,
            latestVersion: result.latestVersion,
            reason,
          });
        }
        console.log(`[AutoUpdate] App is up to date (${result.latestVersion}).`);
      }
    } catch (err) {
      // Never crash the boot process over an update check
      console.warn('[AutoUpdate] Check failed (offline?):', (err as Error).message);
    }
  }

  getLastResult() { return this.lastResult; }
}

export const autoUpdateService = AutoUpdateService.getInstance();
