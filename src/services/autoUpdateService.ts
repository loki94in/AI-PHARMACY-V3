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
import { checkForUpdate, APP_VERSION } from './licenseService.js';
import { eventService } from './eventService.js';
import { activityTracker } from '../utils/activityTracker.js';


/** Compare two semver strings (e.g. "0.1.139" vs "0.1.135"). Returns > 0 if a > b, < 0 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

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
function downloadFile(url: string, dest: string, onProgress?: (downloaded: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempDest = dest + '.tmp';

    function makeRequest(currentUrl: string, redirectCount = 0) {
      if (redirectCount > 5) {
        return reject(new Error('DOWNLOAD_FAILED: Too many redirects while downloading update'));
      }
      const client = currentUrl.startsWith('https') ? https : http;

      const req = client.get(
        currentUrl,
        {
          headers: {
            'User-Agent': 'AI-Pharmacy-OS-AutoUpdater/1.0',
            Accept: '*/*',
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume(); // Free previous response socket back to agent pool
            const redirectUrl = new URL(res.headers.location, currentUrl).toString();
            return makeRequest(redirectUrl, redirectCount + 1);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`DOWNLOAD_FAILED: HTTP ${res.statusCode}`));
          }
          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let downloadedBytes = 0;
          let lastReport = 0;

          const fileStream = fs.createWriteStream(tempDest);
          res.on('data', (chunk: Buffer) => {
            req.setTimeout(120_000);
            downloadedBytes += chunk.length;
            const now = Date.now();
            if (onProgress && (now - lastReport > 600 || downloadedBytes === totalBytes)) {
              lastReport = now;
              onProgress(downloadedBytes, totalBytes);
            }
          });
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
          fileStream.on('error', (err) => {
            try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch (_) {}
            reject(err);
          });
        }
      );
      req.setTimeout(120_000, () => {
        req.destroy(new Error('DOWNLOAD_TIMEOUT: Connection stalled for 120s with no data'));
      });
      req.on('error', (err) => {
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
  private retryHandle: NodeJS.Timeout | null = null;
  private hasRetriedDownload = false;
  private lastCheckedAt?: string;
  private lastResult: {
    hasUpdate: boolean;
    currentVersion?: string;
    latestVersion?: string;
    downloadUrl?: string;
    updatePackageUrl?: string;
    sha256?: string;
    changelog?: string;
    downloading?: boolean;
    downloadProgress?: number;
    readyToInstall?: boolean;
    lastError?: string;
  } | null = null;
  private isDownloading = false;
  private zipFailures = 0;
  private currentDownloadingVersion?: string;

  static getInstance(): AutoUpdateService {
    if (!AutoUpdateService.instance) AutoUpdateService.instance = new AutoUpdateService();
    return AutoUpdateService.instance;
  }

  /**
   * Start the update scheduler. Called once from server.ts after schema is ready.
   * PRODUCTION.md §13: every boot checks for an update in background.
   */
  start(): void {
    // Sync current binary's APP_VERSION to update_checks so DB reflects actual running version
    (async () => {
      try {
        const db = await dbManager.getConnection();
        const checkRow = await db.get<{ last_checked_at?: string }>('SELECT last_checked_at FROM update_checks WHERE id = 1');
        if (checkRow?.last_checked_at) {
          this.lastCheckedAt = checkRow.last_checked_at;
        }

        const { APP_VERSION } = await import('./licenseService.js');
        if (APP_VERSION && APP_VERSION !== '1.0.0') {
          await db.run(
            'UPDATE update_checks SET current_version = ? WHERE id = 1 AND (current_version != ? OR current_version IS NULL)',
            [APP_VERSION, APP_VERSION]
          );
        }

        // Check if an update package is already fully staged on disk from previous session
        const stagingDir = getStagingDir();
        if (fs.existsSync(stagingDir)) {
          const files = fs.readdirSync(stagingDir).filter(f =>
            (f.startsWith('AI-Pharmacy-OS-Update-v') && f.endsWith('.zip')) ||
            (f.startsWith('AI-Pharmacy-OS-Portable-Setup-v') && f.endsWith('.exe'))
          );
          for (const file of files) {
            const match = file.match(/v([0-9.]+)\.(zip|exe)/);
            const filePath = path.join(stagingDir, file);
            if (match && match[1]) {
              const stagedVersion = match[1];
              // If staged version is older or equal to running APP_VERSION, purge it immediately
              if (compareVersions(stagedVersion, APP_VERSION) <= 0) {
                console.log(`[AutoUpdate] Purging obsolete staged update package: ${file} (current is v${APP_VERSION})`);
                try { fs.unlinkSync(filePath); } catch (_) {}
                continue;
              }

              // Only accept if strictly newer than currently running APP_VERSION
              if (!this.lastResult && compareVersions(stagedVersion, APP_VERSION) > 0) {
                this.lastResult = {
                  hasUpdate: true,
                  latestVersion: stagedVersion,
                  readyToInstall: true,
                  downloading: false,
                };
                setTimeout(() => {
                  eventService.broadcast('update_available', {
                    latestVersion:  stagedVersion,
                    currentVersion: APP_VERSION,
                    hasUpdate:      true,
                    readyToInstall: true,
                    downloading:    false,
                    reason:         'boot_staged',
                  });
                }, 3000);
              }
            }
          }

          // Clean up stale temporary download files older than 30 minutes
          const tmpFiles = fs.readdirSync(stagingDir).filter(f => f.endsWith('.tmp'));
          const now = Date.now();
          for (const tmpFile of tmpFiles) {
            try {
              const tmpPath = path.join(stagingDir, tmpFile);
              const stat = fs.statSync(tmpPath);
              if (now - stat.mtimeMs > 30 * 60 * 1000) {
                fs.unlinkSync(tmpPath);
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    })();

    // Automatically check for new releases in the background on every boot (T+10s after app services settle)
    setTimeout(() => {
      void this.runCheck('boot');
    }, 10_000);
  }

  stop(): void {
    if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null; }
    if (this.retryHandle) { clearTimeout(this.retryHandle); this.retryHandle = null; }
  }

  /** Return last known update check result with semver floor against running binary */
  getStatus() {
    if (!this.lastResult) return null;
    const isNewer = this.lastResult.latestVersion ? compareVersions(this.lastResult.latestVersion, APP_VERSION) > 0 : false;
    return {
      ...this.lastResult,
      latestVersion: isNewer ? this.lastResult.latestVersion : APP_VERSION,
      hasUpdate: Boolean(this.lastResult.hasUpdate && isNewer),
      currentVersion: APP_VERSION,
      downloading: Boolean(this.isDownloading && isNewer),
      downloadProgress: isNewer ? (this.lastResult.downloadProgress ?? 0) : 0,
      readyToInstall: Boolean(this.lastResult.readyToInstall && isNewer),
    };
  }

  /** Return ISO string of last update check timestamp */
  getLastCheckedAt(): string | undefined {
    return this.lastCheckedAt;
  }

  /** Manual trigger from Settings "Check Now" button. Always runs regardless of interval. */
  async triggerCheck(): Promise<typeof this.lastResult> {
    await this.runCheck('manual');
    return this.lastResult;
  }

  private async runCheck(reason: 'boot' | 'interval' | 'manual' | 'auto'): Promise<void> {
    try {
      const db = await dbManager.getConnection();
      const row = await db.get<any>('SELECT last_checked_at, check_interval_days FROM update_checks WHERE id = 1');

      // Periodic interval checks: skip if within the configured daily interval (default 1 day)
      // 'boot' and 'manual' checks ALWAYS run regardless of last_checked_at so new releases are caught immediately
      if ((reason === 'interval' || reason === 'auto') && row?.last_checked_at) {
        const lastMs      = new Date(row.last_checked_at).getTime();
        const intervalDays = row.check_interval_days ?? 1;
        const intervalMs  = intervalDays * 24 * 60 * 60 * 1000;
        if (Date.now() - lastMs < intervalMs) return;
      }

      // PRODUCTION.md §14: update check is separate from license check
      const result = await checkForUpdate(); // returns null when offline — never throws
      if (!result) {
        // UPDATE_SERVER_UNAVAILABLE — do not freeze, do not mark license invalid
        console.log('[AutoUpdate] UPDATE_SERVER_UNAVAILABLE (Offline) — update server unreachable. Continuing normally offline.');
        if (this.lastResult) {
          this.lastResult.lastError = 'Update server unreachable';
        }
        return;
      }

      this.lastCheckedAt = new Date().toISOString();

      // Client-side semver gate: verify latestVersion is strictly newer than running APP_VERSION
      const isNewer = result.latestVersion ? compareVersions(result.latestVersion, APP_VERSION) > 0 : false;
      const trulyHasUpdate = Boolean(result.hasUpdate && isNewer);

      const stagingDir   = getStagingDir();
      const zipFileName  = result.latestVersion ? `AI-Pharmacy-OS-Update-v${result.latestVersion}.zip` : null;
      const zipPath      = zipFileName ? path.join(stagingDir, zipFileName) : null;
      const exeFileName  = result.latestVersion ? `AI-Pharmacy-OS-Portable-Setup-v${result.latestVersion}.exe` : null;
      const exePath      = exeFileName ? path.join(stagingDir, exeFileName) : null;
      const alreadyDownloaded = Boolean(
        trulyHasUpdate && (
          (zipPath && fs.existsSync(zipPath)) ||
          (exePath && fs.existsSync(exePath))
        )
      );

      this.lastResult = {
        ...result,
        latestVersion: isNewer ? result.latestVersion : APP_VERSION,
        hasUpdate: trulyHasUpdate,
        currentVersion: APP_VERSION,
        downloading: Boolean(this.isDownloading && isNewer),
        downloadProgress: trulyHasUpdate ? (this.lastResult?.downloadProgress || (alreadyDownloaded ? 100 : 0)) : 0,
        readyToInstall: alreadyDownloaded,
        lastError: undefined,
      };

      if (trulyHasUpdate) {
        console.log(`[AutoUpdate] New version available: ${result.latestVersion}`);

        if (alreadyDownloaded) {
          eventService.broadcast('update_available', {
            latestVersion:    result.latestVersion,
            currentVersion:   APP_VERSION,
            hasUpdate:        true,
            downloadUrl:      result.downloadUrl,
            updatePackageUrl: result.updatePackageUrl,
            changelog:        result.changelog,
            readyToInstall:   true,
            downloading:      false,
            downloadProgress: 100,
            reason,
          });
        } else if ((result.updatePackageUrl || result.downloadUrl) && !this.isDownloading) {
          this.startBackgroundDownload(this.lastResult, reason);
        }
      } else {
        if (result.hasUpdate && !isNewer) {
          console.log(`[AutoUpdate] Server reported update v${result.latestVersion}, but app is already running v${APP_VERSION}. Skipping download.`);
        }
        if (reason === 'manual') {
          eventService.broadcast('update_check_complete', {
            hasUpdate:        false,
            latestVersion:    APP_VERSION,
            currentVersion:   APP_VERSION,
            downloading:      false,
            downloadProgress: 0,
            readyToInstall:   false,
            reason,
          });
        }
        console.log(`[AutoUpdate] App is up to date (v${APP_VERSION}).`);
      }
    } catch (err) {
      // PRODUCTION.md §13: never freeze on update check failure
      console.warn('[AutoUpdate] Check failed (offline?):', (err as Error).message);
      if (this.lastResult) {
        this.lastResult.lastError = `Update check failed: ${(err as Error).message}`;
      }
    }
  }

  /**
   * Start downloading the update package in the background.
   * Priority ladder:
   *   1. Small update ZIP (updatePackageUrl) — fast path (~1-2 min).
   *   2. Full Setup EXE (downloadUrl) — last-resort fallback if ZIP missing or fails twice.
   */
  startBackgroundDownload(info?: any, reason = 'auto'): void {
    const target = info || this.lastResult;
    if (!target || !target.hasUpdate || !target.latestVersion || (!target.updatePackageUrl && !target.downloadUrl)) {
      return;
    }
    // Client-side semver gate: never download packages for versions older than or equal to running binary
    if (compareVersions(target.latestVersion, APP_VERSION) <= 0) {
      console.log(`[AutoUpdate] Skipping background download: target version v${target.latestVersion} is not newer than running v${APP_VERSION}.`);
      return;
    }
    if (this.isDownloading) return;

    if (this.currentDownloadingVersion !== target.latestVersion) {
      this.currentDownloadingVersion = target.latestVersion;
      this.zipFailures = 0;
    }

    const stagingDir = getStagingDir();
    const zipFileName = `AI-Pharmacy-OS-Update-v${target.latestVersion}.zip`;
    const zipPath = path.join(stagingDir, zipFileName);
    const exeFileName = `AI-Pharmacy-OS-Portable-Setup-v${target.latestVersion}.exe`;
    const exePath = path.join(stagingDir, exeFileName);

    if (fs.existsSync(zipPath) || fs.existsSync(exePath)) {
      if (this.lastResult) {
        this.lastResult.readyToInstall = true;
        this.lastResult.downloading = false;
        this.lastResult.downloadProgress = 100;
      }
      eventService.broadcast('update_available', {
        latestVersion: target.latestVersion,
        readyToInstall: true,
        downloading: false,
        downloadProgress: 100,
        reason,
      });
      return;
    }

    // Determine download mode: prefer ZIP, fall back to Setup EXE if ZIP missing or failed twice
    const useZip = Boolean(target.updatePackageUrl && this.zipFailures < 2);
    const downloadUrl = useZip ? target.updatePackageUrl : target.downloadUrl;
    const destPath = useZip ? zipPath : exePath;
    const expectedSha256 = useZip ? target.sha256 : undefined;

    if (!downloadUrl) {
      console.warn('[AutoUpdate] No valid download URL available for update.');
      return;
    }

    this.isDownloading = true;
    this.lastResult = {
      ...(this.lastResult || {}),
      ...target,
      downloading: true,
      downloadProgress: 0,
      readyToInstall: false,
    };

    eventService.broadcast('update_available', {
      latestVersion: target.latestVersion,
      currentVersion: APP_VERSION,
      hasUpdate: true,
      downloadUrl: target.downloadUrl,
      updatePackageUrl: target.updatePackageUrl,
      changelog: target.changelog,
      downloading: true,
      downloadProgress: 0,
      readyToInstall: false,
      reason,
    });

    this.downloadUpdateSilently({
      url: downloadUrl,
      dest: destPath,
      version: target.latestVersion,
      sha256: expectedSha256,
      changelog: target.changelog,
      isZip: useZip,
      reason,
    });
  }

  private async downloadUpdateSilently(opts: {
    url: string;
    dest: string;
    version: string;
    sha256?: string;
    changelog?: string;
    isZip: boolean;
    reason?: string;
  }): Promise<void> {
    const { url, dest, version, sha256: expectedSha256, changelog, isZip, reason = 'auto' } = opts;
    try {
      const stagingDir = getStagingDir();
      fs.mkdirSync(stagingDir, { recursive: true });

      const pkgType = isZip ? 'update ZIP (fast path)' : 'full Setup EXE (fallback path)';
      console.log(`[AutoUpdate] Silently downloading ${pkgType} for v${version} to staging...`);
      await downloadFile(url, dest, (downloaded, total) => {
        const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        if (this.lastResult) {
          this.lastResult.downloadProgress = percent;
        }
        eventService.broadcast('update_progress', {
          latestVersion: version,
          currentVersion: APP_VERSION,
          hasUpdate: true,
          downloading: true,
          downloadProgress: percent,
          downloadedBytes: downloaded,
          totalBytes: total,
        });
      });

      // SHA-256 verification (PRODUCTION.md §31) for ZIP packages
      if (expectedSha256 && isZip) {
        console.log('[AutoUpdate] Verifying SHA-256...');
        const actualSha256 = await computeSha256(dest);
        if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
          console.error(`[AutoUpdate] CHECKSUM_MISMATCH — aborting. Expected: ${expectedSha256}, got: ${actualSha256}`);
          try { fs.unlinkSync(dest); } catch (_) {}
          this.isDownloading = false;
          this.zipFailures++;

          if (this.lastResult) {
            this.lastResult.downloading = false;
            this.lastResult.readyToInstall = false;
            this.lastResult.lastError = this.zipFailures >= 2
              ? 'ZIP checksum failed twice — falling back to Setup installer'
              : 'Checksum mismatch — package discarded, retry scheduled';
          }
          eventService.broadcast('update_available', {
            latestVersion: version,
            currentVersion: APP_VERSION,
            hasUpdate: true,
            changelog: changelog || '',
            readyToInstall: false,
            downloading: false,
            error: this.lastResult?.lastError || 'Checksum mismatch',
            reason,
          });

          // Fall back to Setup EXE if ZIP failed twice, otherwise retry ZIP once after 15 min
          if (this.zipFailures >= 2 && this.lastResult?.downloadUrl) {
            console.log('[AutoUpdate] ZIP checksum failed twice. Switching immediately to Setup EXE fallback...');
            this.startBackgroundDownload(this.lastResult, 'setup-fallback');
          } else if (reason !== 'auto-retry') {
            console.log('[AutoUpdate] Scheduling single retry in 15 minutes due to checksum mismatch...');
            this.retryHandle = setTimeout(() => {
              this.retryHandle = null;
              if (!this.isDownloading && this.lastResult?.hasUpdate && this.lastResult?.latestVersion) {
                this.startBackgroundDownload(this.lastResult, 'auto-retry');
              }
            }, 15 * 60 * 1000);
          }
          return;
        }
        console.log('[AutoUpdate] SHA-256 verified OK.');
      }

      this.isDownloading = false;
      if (this.retryHandle) {
        clearTimeout(this.retryHandle);
        this.retryHandle = null;
      }
      if (this.lastResult) {
        this.lastResult.downloading    = false;
        this.lastResult.readyToInstall = true;
        this.lastResult.downloadProgress = 100;
        this.lastResult.lastError = undefined;
      }
      console.log(`[AutoUpdate] Download complete. Update v${version} is ready to install.`);
      eventService.broadcast('update_available', {
        latestVersion:  version,
        currentVersion: APP_VERSION,
        hasUpdate:      true,
        changelog:      changelog || '',
        readyToInstall: true,
        downloading:    false,
        downloadProgress: 100,
        reason,
      });
    } catch (err: any) {
      this.isDownloading = false;
      if (isZip) {
        this.zipFailures++;
      }
      const errorMsg = `Download failed: ${err.message}`;
      if (this.lastResult) {
        this.lastResult.downloading = false;
        this.lastResult.readyToInstall = false;
        this.lastResult.lastError = errorMsg;
      }
      try { if (fs.existsSync(dest + '.tmp')) fs.unlinkSync(dest + '.tmp'); } catch (_) {}
      console.warn('[AutoUpdate] DOWNLOAD_FAILED:', err.message);
      eventService.broadcast('update_available', {
        latestVersion: version,
        currentVersion: APP_VERSION,
        hasUpdate: true,
        changelog: changelog || '',
        readyToInstall: false,
        downloading: false,
        error: errorMsg,
        reason,
      });

      if (isZip && this.zipFailures >= 2 && this.lastResult?.downloadUrl) {
        console.log('[AutoUpdate] ZIP download failed twice. Switching to Setup EXE fallback...');
        this.startBackgroundDownload(this.lastResult, 'setup-fallback');
      } else if (reason !== 'auto-retry') {
        console.log('[AutoUpdate] Scheduling retry in 15 minutes due to download failure...');
        this.retryHandle = setTimeout(() => {
          this.retryHandle = null;
          if (!this.isDownloading && this.lastResult?.hasUpdate && this.lastResult?.latestVersion) {
            this.startBackgroundDownload(this.lastResult, 'auto-retry');
          }
        }, 15 * 60 * 1000);
      }
    }
  }

  /**
   * Apply the downloaded update.
   * Priority:
   *   1. If ZIP update exists: Spawns dedicated Updater.bat (safe in-place update with rollback)
   *   2. If Setup EXE exists: Spawns the Setup installer (fallback)
   *
   * PRODUCTION.md §22, §23
   */
  async applyUpdate(): Promise<{ success: boolean; message: string }> {
    if (!this.lastResult?.latestVersion) {
      throw new Error('No pending update found.');
    }

    const isSeaBinary = !process.execPath.endsWith('node.exe') &&
                        !process.execPath.endsWith('node') &&
                        !process.execPath.includes('tsx');
    if (!isSeaBinary) {
      throw new Error('Updates can only be applied from the installed application (PharmacyOS.exe), not from development mode.');
    }

    const { APP_VERSION } = await import('./licenseService.js');
    if (this.lastResult?.latestVersion && compareVersions(this.lastResult.latestVersion, APP_VERSION) <= 0) {
      throw new Error(`Cannot install update: version v${this.lastResult.latestVersion} is not newer than currently running v${APP_VERSION}.`);
    }

    const stagingDir = getStagingDir();
    const zipFileName = `AI-Pharmacy-OS-Update-v${this.lastResult.latestVersion}.zip`;
    const zipPath     = path.join(stagingDir, zipFileName);
    const exeFileName = `AI-Pharmacy-OS-Portable-Setup-v${this.lastResult.latestVersion}.exe`;
    const exePath     = path.join(stagingDir, exeFileName);

    if (fs.existsSync(zipPath)) {
      const updaterPath = getUpdaterPath();
      if (!fs.existsSync(updaterPath)) {
        throw new Error(`Updater.bat not found at: ${updaterPath}`);
      }

      const installDir = path.dirname(process.execPath);
      const logPath    = getLogPath();
      const sha256     = this.lastResult.sha256 || '';

      console.log('[AutoUpdate] Spawning dedicated Updater.bat (ZIP fast path)...');
      console.log(`[AutoUpdate]   ZIP      : ${zipPath}`);
      console.log(`[AutoUpdate]   InstDir  : ${installDir}`);
      console.log(`[AutoUpdate]   Version  : ${this.lastResult.latestVersion}`);
      console.log(`[AutoUpdate]   SHA-256  : ${sha256 || '(not provided)'}`);

      // Spawn Updater.bat detached in a dedicated visible console progress window
      const targetVersion = this.lastResult.latestVersion;
      const windowTitle = `"AI Pharmacy OS — Updating to v${targetVersion}"`;
      const fullCommand = `call "${updaterPath}" "${zipPath}" "${installDir}" "${targetVersion}" "${sha256}" "${logPath}"`;

      const child = spawn('cmd.exe', ['/c', 'start', windowTitle, 'cmd.exe', '/c', fullCommand], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();

      return { success: true, message: 'Installing update and restarting AI Pharmacy OS...' };
    }

    if (fs.existsSync(exePath)) {
      console.log('[AutoUpdate] Spawning Setup installer (fallback path)...');
      console.log(`[AutoUpdate]   EXE      : ${exePath}`);
      console.log(`[AutoUpdate]   Version  : ${this.lastResult.latestVersion}`);

      const child = spawn(exePath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();

      return { success: true, message: 'Installing update package via Setup and restarting...' };
    }

    throw new Error('Update file has not finished downloading yet.');
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
