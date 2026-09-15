/**
 * AutoUpdateService — checks for new app versions daily.
 * Runs silently on boot. Auto-downloads new update installer in the background.
 * Fires SSE event when an update is downloaded and ready to install.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import { spawn } from 'child_process';
import { dbManager } from '../database/connection.js';
import { checkForUpdate } from './licenseService.js';
import { eventService } from './eventService.js';
import { activityTracker } from '../utils/activityTracker.js';

const BOOT_DELAY_MS    = 60_000;
// Check every 2 hours if 24 hours have elapsed since the last daily check
const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000;

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempDest = dest + '.tmp';
    const client = url.startsWith('https') ? https : http;

    function makeRequest(currentUrl: string, redirectCount = 0) {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects while downloading update'));
      }
      client.get(currentUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return makeRequest(res.headers.location, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
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
        reject(err);
      });
    }

    makeRequest(url);
  });
}

class AutoUpdateService {
  private static instance: AutoUpdateService;
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastResult: {
    hasUpdate: boolean;
    latestVersion?: string;
    downloadUrl?: string;
    changelog?: string;
    downloading?: boolean;
    readyToInstall?: boolean;
  } | null = null;
  private isDownloading = false;

  static getInstance(): AutoUpdateService {
    if (!AutoUpdateService.instance) AutoUpdateService.instance = new AutoUpdateService();
    return AutoUpdateService.instance;
  }

  /** Start the scheduler. Called once from server.ts after schema is ready. */
  start(): void {
    // Delay first check so it doesn't compete with boot DB/schema work
    setTimeout(() => this.runCheck('auto'), BOOT_DELAY_MS);

    // Poll every 2h but only run the actual network check if 1 day has elapsed
    // AND the PC is idle (gated on activityTracker — no check during active billing)
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
        const lastMs = new Date(row.last_checked_at).getTime();
        const intervalDays = row.check_interval_days ?? 1; // Daily check
        const intervalMs   = intervalDays * 24 * 60 * 60 * 1000;
        if (Date.now() - lastMs < intervalMs) return; // not yet due
      }

      const result = await checkForUpdate();
      if (!result) return; // offline

      const updateDir = path.join(os.tmpdir(), 'AIPharmacyUpdate');
      if (!fs.existsSync(updateDir)) fs.mkdirSync(updateDir, { recursive: true });
      const updateExePath = result.latestVersion ? path.join(updateDir, `setup_${result.latestVersion}.exe`) : null;
      const alreadyDownloaded = updateExePath ? fs.existsSync(updateExePath) : false;

      this.lastResult = {
        ...result,
        downloading: false,
        readyToInstall: alreadyDownloaded
      };

      if (result.hasUpdate) {
        console.log(`[AutoUpdate] New version available: ${result.latestVersion}`);

        if (alreadyDownloaded) {
          eventService.broadcast('update_available', {
            latestVersion: result.latestVersion,
            downloadUrl:   result.downloadUrl,
            changelog:     result.changelog,
            readyToInstall: true,
            reason,
          });
        } else if (result.downloadUrl && !this.isDownloading) {
          // Notify that update is detected and downloading in background
          eventService.broadcast('update_available', {
            latestVersion: result.latestVersion,
            downloadUrl:   result.downloadUrl,
            changelog:     result.changelog,
            downloading:   true,
            readyToInstall: false,
            reason,
          });

          // Silently download the installer in background
          this.isDownloading = true;
          this.downloadUpdateSilently(result.downloadUrl, updateExePath!, result.latestVersion!, result.changelog, reason);
        }
      } else {
        if (reason === 'manual') {
          eventService.broadcast('update_check_complete', {
            hasUpdate: false,
            latestVersion: result.latestVersion,
            reason,
          });
        }
        console.log(`[AutoUpdate] App is up to date (${result.latestVersion}).`);
      }
    } catch (err) {
      console.warn('[AutoUpdate] Check failed (offline?):', (err as Error).message);
    }
  }

  private async downloadUpdateSilently(url: string, dest: string, version: string, changelog?: string, reason = 'auto'): Promise<void> {
    try {
      console.log(`[AutoUpdate] Silently downloading update v${version} in background...`);
      await downloadFile(url, dest);
      this.isDownloading = false;
      if (this.lastResult) {
        this.lastResult.downloading = false;
        this.lastResult.readyToInstall = true;
      }
      console.log(`[AutoUpdate] Download complete. Update v${version} is ready to install.`);
      eventService.broadcast('update_available', {
        latestVersion: version,
        changelog: changelog || '',
        readyToInstall: true,
        downloading: false,
        reason,
      });
    } catch (err: any) {
      this.isDownloading = false;
      console.warn('[AutoUpdate] Silent background download failed:', err.message);
    }
  }

  /**
   * 1-Click silent install & auto-restart.
   * Spawns a detached Windows helper script that waits for current process to exit,
   * runs the downloaded installer silently, and relaunches the app.
   */
  async applyUpdate(): Promise<{ success: boolean; message: string }> {
    if (!this.lastResult?.latestVersion) {
      throw new Error('No pending update found.');
    }
    const updateDir    = path.join(os.tmpdir(), 'AIPharmacyUpdate');
    const updateExePath = path.join(updateDir, `setup_${this.lastResult.latestVersion}.exe`);
    if (!fs.existsSync(updateExePath)) {
      throw new Error('Update file has not finished downloading yet.');
    }

    const scriptPath  = path.join(updateDir, 'install_and_restart.bat');
    const appDir      = path.dirname(process.execPath);
    const currentExe  = process.execPath;          // e.g. C:\...\PharmacyOS.exe
    const backupExe   = currentExe + '.bak';       // PharmacyOS.exe.bak
    const failFlagPath = path.join(updateDir, 'update_failed.json');
    const version      = this.lastResult.latestVersion;
    const toWin        = (p: string) => p.replace(/\//g, '\\');
    const winCurrentExe   = toWin(currentExe);
    const winBackupExe    = toWin(backupExe);
    const winFailFlagPath = toWin(failFlagPath);
    const winAppDir       = toWin(appDir);

    // Bat: backup current exe → run installer → on failure restore backup + write fail flag
    const scriptContent = `@echo off
timeout /t 2 /nobreak >nul
taskkill /F /IM PharmacyOS.exe >nul 2>&1

rem --- Backup current executable before overwriting ---
if exist "${winCurrentExe}" copy /Y "${winCurrentExe}" "${winBackupExe}" >nul

rem --- Run new installer ---
"%~1" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-
set INSTALL_ERR=%ERRORLEVEL%

if %INSTALL_ERR% NEQ 0 (
  rem --- Install failed: write failure flag and restore backup ---
  echo {"version":"${version}","error":"Installer exited with code %INSTALL_ERR%","ts":"%DATE% %TIME%"} > "${winFailFlagPath}"
  if exist "${winBackupExe}" (
    copy /Y "${winBackupExe}" "${winCurrentExe}" >nul
  )
  start "" "${winCurrentExe}"
  exit /b 1
)

rem --- Install succeeded: launch new version ---
timeout /t 3 /nobreak >nul
if exist "${winAppDir}\\RUN-PharmacyOS-Silent.vbs" (
  wscript.exe "${winAppDir}\\RUN-PharmacyOS-Silent.vbs"
) else if exist "${winAppDir}\\PharmacyOS.exe" (
  start "" "${winAppDir}\\PharmacyOS.exe"
) else (
  start "" "%LOCALAPPDATA%\\AI Pharmacy OS\\PharmacyOS.exe"
)
exit
`;
    fs.writeFileSync(scriptPath, scriptContent, 'utf8');

    console.log('[AutoUpdate] Spawning detached installer helper script (with rollback)...');
    const child = spawn('cmd.exe', ['/c', scriptPath, updateExePath, appDir], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    return { success: true, message: 'Installing update and restarting AI Pharmacy OS...' };
  }

  getLastResult() { return this.lastResult; }

  /**
   * Call once on boot. Detects if previous update install failed,
   * sends telemetry to Vercel, and returns a message to show the user.
   */
  async checkFailedUpdate(): Promise<string | null> {
    const failFlagPath = path.join(os.tmpdir(), 'AIPharmacyUpdate', 'update_failed.json');
    if (!fs.existsSync(failFlagPath)) return null;
    try {
      const raw  = fs.readFileSync(failFlagPath, 'utf8');
      const info = JSON.parse(raw) as { version?: string; error?: string };
      fs.unlinkSync(failFlagPath); // consume flag

      // Send telemetry so developer sees it
      const { reportCrashTelemetry } = await import('./licenseService.js');
      await reportCrashTelemetry({
        errorType: 'UPDATE_INSTALL_FAILED',
        message:   `Update to v${info.version || '?'} failed: ${info.error || 'unknown'}`,
      }).catch(() => {});

      console.warn(`[AutoUpdate] Previous update v${info.version} failed — rolled back to previous version.`);
      return `⚠️ Update to v${info.version} failed. Rolled back to previous version. Our team has been notified.`;
    } catch {
      return null;
    }
  }
}

export const autoUpdateService = AutoUpdateService.getInstance();

