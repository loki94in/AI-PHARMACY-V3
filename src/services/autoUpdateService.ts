/**
 * AutoUpdateService — checks for new app versions on every boot.
 * Runs silently after application is available. Downloads update in background.
 * Fires SSE event when an update is detected or downloaded and ready.
 *
 * PRODUCTION.md §13, §21, §22, §28, §29, §31, §33, §34, §35
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { dbManager } from '../database/connection.js';
import { checkForUpdate } from './licenseService.js';
import { eventService } from './eventService.js';
import { activityTracker } from '../utils/activityTracker.js';

// ── Timing constants ─────────────────────────────────────────────────────────
// PRODUCTION.md §33: update check runs in background after startup
const BOOT_DELAY_MS    = 60_000;  // wait 60s after boot before first check
const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000; // poll every 2h (daily gate in runCheck)

// ── Update staging directory ─────────────────────────────────────────────────
// PRODUCTION.md §21: download to {app}\updates\staging, NOT os.tmpdir()
function getStagingDir(): string {
  // In production: app exe is in %LOCALAPPDATA%\AI Pharmacy OS\
  // In dev: falls back to a sibling of process.cwd()
  const appDir = path.dirname(process.execPath);
  const isSeaBinary = !process.execPath.endsWith('node.exe') &&
                      !process.execPath.endsWith('node') &&
                      !process.execPath.includes('tsx');
  const baseDir = isSeaBinary
    ? appDir
    : path.join(os.homedir(), 'AppData', 'Local', 'AI Pharmacy OS');
  return path.join(baseDir, 'updates', 'staging');
}

function getUpdaterPath(): string {
  // Updater.bat lives next to PharmacyOS.exe in the install dir
  const appDir = path.dirname(process.execPath);
  const isSeaBinary = !process.execPath.endsWith('node.exe') &&
                      !process.execPath.endsWith('node') &&
                      !process.execPath.includes('tsx');
  if (isSeaBinary) return path.join(appDir, 'Updater.bat');
  // Dev fallback (Updater.bat not built yet in dev) — return the packaging source
  return path.join(process.cwd(), 'packaging', 'Updater.bat');
}

function getLogPath(): string {
  const appDir = path.dirname(process.execPath);
  const isSeaBinary = !process.execPath.endsWith('node.exe') &&
                      !process.execPath.endsWith('node') &&
                      !process.execPath.includes('tsx');
  const baseDir = isSeaBinary ? appDir : path.join(os.homedir(), 'AppData', 'Local', 'AI Pharmacy OS');
  return path.join(baseDir, 'logs', 'updater.log');
}

// ── Download helper ──────────────────────────────────────────────────────────
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempDest = dest + '.tmp';
    const client = url.startsWith('https') ? https : http;

    function makeRequest(currentUrl: string, redirectCount = 0) {
      if (redirectCount > 5) {
        return reject(new Error('DOWNLOAD_FAILED: Too many redirects while downloading update'));
      }
      client.get(currentUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return makeRequest(res.headers.location, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`DOWNLOAD_FAILED: HTTP ${res.statusCode}`));
        }
        const fileStream = fs.createWriteStream(tempDest);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              if (fs.existsSync(dest)) fs.unlinkSync(dest);
              fs.renameSync(tempDest, dest);
              resolve();
            } catch (renameErr) {
              reject(renameErr);
            }
          });
        });
      }).on('error', (err) => {
        try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch (_) {}
        reject(new Error(`DOWNLOAD_FAILED: ${err.message}`));
      });
    }

    makeRequest(url);
  });
}

// ── SHA-256 verification ──────────────────────────────────────────────────────
// PRODUCTION.md §31
function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk as Buffer));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── Service ──────────────────────────────────────────────────────────────────
class AutoUpdateService {
  private static instance: AutoUpdateService;
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastResult: {
    hasUpdate: boolean;
    latestVersion?: string;
    downloadUrl?: string;
    updatePackageUrl?: string;
    sha256?: string;
    changelog?: string;
    downloading?: boolean;
    readyToInstall?: boolean;
  } | null = null;
  private isDownloading = false;

  static getInstance(): AutoUpdateService {
    if (!AutoUpdateService.instance) AutoUpdateService.instance = new AutoUpdateService();
    return AutoUpdateService.instance;
  }

  /**
   * Start the update scheduler. Called once from server.ts after schema is ready.
   * PRODUCTION.md §13: every boot checks for an update in background.
   */
  start(): void {
    // Delay first check so it doesn't compete with boot DB/schema work (§28)
    setTimeout(() => this.runCheck('auto'), BOOT_DELAY_MS);

    // Poll every 2h but only run the actual network check if 1 day has elapsed
    // AND the PC is idle (no check during active billing)
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

      // Auto checks: skip if within the configured daily interval (default 1 day)
      if (reason === 'auto' && row?.last_checked_at) {
        const lastMs      = new Date(row.last_checked_at).getTime();
        const intervalDays = row.check_interval_days ?? 1;
        const intervalMs  = intervalDays * 24 * 60 * 60 * 1000;
        if (Date.now() - lastMs < intervalMs) return;
      }

      // PRODUCTION.md §14: update check is separate from license check
      const result = await checkForUpdate(); // returns null when offline — never throws
      if (!result) {
        // UPDATE_SERVER_UNAVAILABLE — do not freeze, do not mark license invalid
        console.log('[AutoUpdate] UPDATE_SERVER_UNAVAILABLE — offline or server unreachable. Continuing normally.');
        return;
      }

      const stagingDir   = getStagingDir();
      const zipFileName  = result.latestVersion ? `AI-Pharmacy-OS-Update-v${result.latestVersion}.zip` : null;
      const zipPath      = zipFileName ? path.join(stagingDir, zipFileName) : null;
      const alreadyDownloaded = zipPath ? fs.existsSync(zipPath) : false;

      this.lastResult = {
        ...result,
        downloading: false,
        readyToInstall: alreadyDownloaded,
      };

      if (result.hasUpdate) {
        console.log(`[AutoUpdate] New version available: ${result.latestVersion}`);

        if (alreadyDownloaded) {
          eventService.broadcast('update_available', {
            latestVersion:  result.latestVersion,
            downloadUrl:    result.downloadUrl,
            changelog:      result.changelog,
            readyToInstall: true,
            reason,
          });
        } else if (result.downloadUrl && !this.isDownloading) {
          eventService.broadcast('update_available', {
            latestVersion:  result.latestVersion,
            downloadUrl:    result.downloadUrl,
            changelog:      result.changelog,
            downloading:    true,
            readyToInstall: false,
            reason,
          });

          // Silently download the update ZIP in background (§29)
          this.isDownloading = true;
          this.downloadUpdateSilently({
            url:       result.downloadUrl,
            dest:      zipPath!,
            version:   result.latestVersion!,
            sha256:    (result as any).sha256,
            changelog: result.changelog,
            reason,
          });
        }
      } else {
        if (reason === 'manual') {
          eventService.broadcast('update_check_complete', {
            hasUpdate:     false,
            latestVersion: result.latestVersion,
            reason,
          });
        }
        console.log(`[AutoUpdate] App is up to date (${result.latestVersion}).`);
      }
    } catch (err) {
      // PRODUCTION.md §13: never freeze on update check failure
      console.warn('[AutoUpdate] Check failed (offline?):', (err as Error).message);
    }
  }

  private async downloadUpdateSilently(opts: {
    url: string;
    dest: string;
    version: string;
    sha256?: string;
    changelog?: string;
    reason?: string;
  }): Promise<void> {
    const { url, dest, version, sha256: expectedSha256, changelog, reason = 'auto' } = opts;
    try {
      const stagingDir = getStagingDir();
      fs.mkdirSync(stagingDir, { recursive: true });

      console.log(`[AutoUpdate] Silently downloading update v${version} to staging...`);
      await downloadFile(url, dest);

      // SHA-256 verification (PRODUCTION.md §31)
      if (expectedSha256) {
        console.log('[AutoUpdate] Verifying SHA-256...');
        const actualSha256 = await computeSha256(dest);
        if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
          console.error(`[AutoUpdate] CHECKSUM_MISMATCH — aborting. Expected: ${expectedSha256}, got: ${actualSha256}`);
          // Delete corrupted package — keep current version
          try { fs.unlinkSync(dest); } catch (_) {}
          this.isDownloading = false;
          return;
        }
        console.log('[AutoUpdate] SHA-256 verified OK.');
      }

      this.isDownloading = false;
      if (this.lastResult) {
        this.lastResult.downloading    = false;
        this.lastResult.readyToInstall = true;
      }
      console.log(`[AutoUpdate] Download complete. Update v${version} is ready to install.`);
      eventService.broadcast('update_available', {
        latestVersion:  version,
        changelog:      changelog || '',
        readyToInstall: true,
        downloading:    false,
        reason,
      });
    } catch (err: any) {
      this.isDownloading = false;
      // Delete incomplete temp file if it exists
      try { if (fs.existsSync(dest + '.tmp')) fs.unlinkSync(dest + '.tmp'); } catch (_) {}
      console.warn('[AutoUpdate] DOWNLOAD_FAILED:', err.message);
    }
  }

  /**
   * Apply the downloaded update.
   * Spawns the dedicated Updater.bat which:
   *   - waits for app to exit
   *   - verifies SHA-256
   *   - backs up install dir
   *   - extracts update ZIP
   *   - rolls back on failure
   *   - starts new (or old) PharmacyOS.exe
   *
   * PRODUCTION.md §22, §23
   */
  async applyUpdate(): Promise<{ success: boolean; message: string }> {
    if (!this.lastResult?.latestVersion) {
      throw new Error('No pending update found.');
    }

    const stagingDir = getStagingDir();
    const zipFileName = `AI-Pharmacy-OS-Update-v${this.lastResult.latestVersion}.zip`;
    const zipPath     = path.join(stagingDir, zipFileName);

    if (!fs.existsSync(zipPath)) {
      throw new Error('Update file has not finished downloading yet.');
    }

    const updaterPath = getUpdaterPath();
    if (!fs.existsSync(updaterPath)) {
      throw new Error(`Updater.bat not found at: ${updaterPath}`);
    }

    const installDir = path.dirname(process.execPath);
    const logPath    = getLogPath();
    const sha256     = this.lastResult.sha256 || '';

    console.log('[AutoUpdate] Spawning dedicated Updater.bat...');
    console.log(`[AutoUpdate]   ZIP      : ${zipPath}`);
    console.log(`[AutoUpdate]   InstDir  : ${installDir}`);
    console.log(`[AutoUpdate]   Version  : ${this.lastResult.latestVersion}`);
    console.log(`[AutoUpdate]   SHA-256  : ${sha256 || '(not provided)'}`);

    // Spawn Updater.bat detached — it will wait for this process to exit
    const child = spawn('cmd.exe', [
      '/c', updaterPath,
      zipPath,
      installDir,
      this.lastResult.latestVersion,
      sha256,
      logPath,
    ], {
      detached: true,
      stdio:    'ignore',
    });
    child.unref();

    return { success: true, message: 'Installing update and restarting AI Pharmacy OS...' };
  }

  getLastResult() { return this.lastResult; }

  /**
   * Call once on boot. Detects if previous update install failed (rollback already happened).
   * PRODUCTION.md §26, §35
   */
  async checkFailedUpdate(): Promise<string | null> {
    const stagingDir   = getStagingDir();
    const failurePath  = path.join(stagingDir, 'failure.json');
    if (!fs.existsSync(failurePath)) return null;
    try {
      const raw  = fs.readFileSync(failurePath, 'utf8');
      const info = JSON.parse(raw) as { version?: string; error?: string };
      fs.unlinkSync(failurePath); // consume flag

      const { reportCrashTelemetry } = await import('./licenseService.js');
      await reportCrashTelemetry({
        errorType: 'UPDATE_INSTALL_FAILED',
        message:   `Update to v${info.version || '?'} failed: ${info.error || 'unknown'}`,
      }).catch(() => {});

      console.warn(`[AutoUpdate] Previous update v${info.version} failed — rolled back to previous version.`);
      return `⚠️ Update to v${info.version} failed (${info.error || 'unknown error'}). Rolled back to previous version.`;
    } catch {
      return null;
    }
  }
}

export const autoUpdateService = AutoUpdateService.getInstance();
