import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { getAppDataDir } from '../config/index.js';

const execAsync = promisify(exec);

/**
 * Shared Chromium browser/profile helpers.
 *
 * Single source for locating a Chrome/Edge executable, copying a Chrome
 * profile directory (session-critical for Pharmarack login persistence),
 * and launching a lightweight extension-free desktop app window.
 * Previously duplicated in routes/pharmarack.ts and services/tokenRefreshScheduler.ts.
 */

/**
 * Locate an installed Chromium browser binary.
 * Pass { includeEdge: true } to also consider Microsoft Edge as a fallback
 * (used by Pharmarack cart flows); the default keeps strict Chrome-only
 * lookup semantics.
 */
export function findChromePath(options?: { includeEdge?: boolean }): string | null {
  const baseDirs = [
    process.env.PROGRAMFILES,
    process.env['ProgramFiles(x86)'],
    process.env.PROGRAMW6432,
    process.env.LOCALAPPDATA,
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ].filter(Boolean) as string[];

  const paths: string[] = [];

  for (const dir of baseDirs) {
    paths.push(path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  if (options?.includeEdge) {
    for (const dir of baseDirs) {
      paths.push(path.join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  }

  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch (_) {}
  }

  // Windows CLI search fallback using where.exe
  if (process.platform === 'win32') {
    try {
      const out = execSync('where chrome.exe', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 })
        .toString()
        .trim()
        .split(/\r?\n/)[0];
      if (out && fs.existsSync(out)) return out;
    } catch (_) {}

    if (options?.includeEdge) {
      try {
        const out = execSync('where msedge.exe', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 })
          .toString()
          .trim()
          .split(/\r?\n/)[0];
        if (out && fs.existsSync(out)) return out;
      } catch (_) {}
    }
  }

  return null;
}

/**
 * Hardened Chromium command-line flags for headless background services (WhatsApp, Pharmarack).
 * Ensures smooth child-process execution without crashing in packaged desktop environments
 * (Electron child processes, Windows service tokens, AppData).
 */
export function getCommonHeadlessChromiumArgs(additionalArgs: string[] = []): string[] {
  const defaultArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-component-update',
    '--disable-background-networking',
    '--mute-audio',
    '--renderer-process-limit=1'
  ];

  const combined = [...defaultArgs];
  for (const arg of additionalArgs) {
    if (!combined.includes(arg)) {
      combined.push(arg);
    }
  }
  return combined;
}

/** Directory entries skipped when cloning a Chrome profile (caches + lock files). */
const PROFILE_SKIP_NAMES = new Set([
  'cache',
  'code cache',
  'gpucache',
  'dawngraphitecache',
  'dawnwebgpucache',
  'gpupersistentcache',
  'grshadercache',
  'shadercache',
  'browsermetrics',
  'crashpad',
  'lockfile',
  'parent.lock',
  'singletonlock',
  'lock',
  'devtoolsactiveport'
]);

/**
 * Recursively copy a Chrome profile folder, omitting caches/locks so the copy
 * can be opened by a second browser instance without profile-lock crashes.
 * Async (fs.promises) so large profiles never block the Node event loop while
 * POS/SSE traffic keeps flowing during lock-fallback refreshes.
 */
export async function copyProfileFolder(src: string, dest: string, logPrefix = '[ChromeProfile]'): Promise<void> {
  if (!fs.existsSync(src)) return;
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (PROFILE_SKIP_NAMES.has(lowerName)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyProfileFolder(srcPath, destPath, logPrefix);
    } else {
      try {
        await fs.promises.copyFile(srcPath, destPath);
      } catch (err: any) {
        console.warn(`${logPrefix} Warning: Could not copy file ${srcPath}: ${err.message}`);
      }
    }
  }
}

/**
 * Launch the frontend UI in a dedicated, lightweight standalone app window.
 * 
 * Benefits:
 * - --app=url: Opens in clean standalone desktop window without address bar, tabs, or bookmarks.
 * - --disable-extensions: Disables all third-party extensions (Free Download Manager, IDM, adblockers, malware plugins).
 * - --user-data-dir: Dedicated isolated profile so personal browser data, cookies, and memory bloat are eliminated.
 * - --disable-background-networking / --disable-sync: Disables background telemetry, syncing, and auto-updates.
 * - Direct process spawn: Eliminates lingering cmd.exe / terminal processes.
 */
let activeAppBrowserProcess: ChildProcess | null = null;
let activeBrowserPid: number | null = null;

export function launchAppBrowser(url: string, customProfileDir?: string, onExit?: () => void): boolean {
  try {
    const browserPath = findChromePath({ includeEdge: true });
    if (browserPath) {
      const profileDir = customProfileDir || path.join(getAppDataDir(), 'data', 'app_browser_profile');
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      const windowModeArg = process.env.APP_WINDOW_MODE === 'maximized' ? '--start-maximized' : '--start-fullscreen';
      const args = [
        `--app=${url}`,
        `--user-data-dir=${profileDir}`,
        windowModeArg,
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        '--disable-component-update',
        '--disable-features=Translate,OptimizationHints,MediaRouter',
        '--dns-prefetch-disable'
      ];

      const child = spawn(browserPath, args, {
        detached: !onExit,
        stdio: 'ignore'
      });
      activeAppBrowserProcess = child;
      activeBrowserPid = child.pid ?? null;
      child.on('error', (err) => {
        console.warn(`[ChromeBrowser] Direct app-mode spawn error (non-fatal): ${err.message}`);
      });
      if (onExit) {
        child.on('exit', (code) => {
          console.log(`[ChromeBrowser] App browser window closed (code: ${code}). Triggering app shutdown...`);
          activeAppBrowserProcess = null;
          onExit();
        });
      } else {
        child.unref();
      }
      return true;
    }
  } catch (err: any) {
    console.warn(`[ChromeBrowser] Direct app-mode launch failed: ${err.message}`);
  }

  // Fallback to standard OS opener if Chrome/Edge not found
  try {
    const openerArgs: [string, string[]] = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', url]]
      : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
    spawn(openerArgs[0], openerArgs[1], { detached: true, stdio: 'ignore' })
      .on('error', (err) => {
        console.warn(`[ChromeBrowser] Fallback browser opener error (non-fatal): ${err.message}`);
      })
      .unref();
    return true;
  } catch (err: any) {
    console.warn(`[ChromeBrowser] Fallback opener failed: ${err.message}`);
    return false;
  }
}

/**
 * Terminate the dedicated desktop app window (Chrome / Edge in --app mode).
 * Called during clean backend shutdown so both backend and frontend terminate together.
 */
export function closeAppBrowser(): void {
  const pid = activeAppBrowserProcess?.pid || activeBrowserPid;
  if (pid) {
    console.log(`[ChromeBrowser] Terminating app browser window process (PID: ${pid})...`);
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
      } else if (activeAppBrowserProcess) {
        activeAppBrowserProcess.kill('SIGTERM');
      }
    } catch (err: any) {
      console.warn(`[ChromeBrowser] Error terminating browser process: ${err.message}`);
    }
    activeAppBrowserProcess = null;
    activeBrowserPid = null;
  }

  // Windows safety fallback: cleanly terminate any remaining chrome/edge process running our isolated app_browser_profile or matching our app port
  if (process.platform === 'win32') {
    try {
      const psScript = [
        "$ProgressPreference = 'SilentlyContinue'",
        "$targets = Get-CimInstance Win32_Process | Where-Object {",
        "  ($_.Name -match 'chrome|msedge|GoogleChromePortable') -and (",
        "    $_.CommandLine -like '*app_browser_profile*' -or",
        "    $_.CommandLine -like '*localhost:5175*' -or",
        "    $_.CommandLine -like '*localhost:5173*' -or",
        "    $_.CommandLine -like '*127.0.0.1:5175*' -or",
        "    $_.CommandLine -like '*127.0.0.1:5173*'",
        "  )",
        "}",
        "foreach ($p in $targets) {",
        "  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue",
        "}",
        "Get-Process | Where-Object { ($_.ProcessName -match 'chrome|msedge|GoogleChromePortable') -and ($_.MainWindowTitle -match 'AI PHARMACY|AI Pharmacy') } | ForEach-Object {",
        "  $_.CloseMainWindow() | Out-Null",
        "  Start-Sleep -Milliseconds 100",
        "  if (!$_.HasExited) {",
        "    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue",
        "  }",
        "}"
      ].join('\n');

      const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
      execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${b64}`, {
        stdio: 'ignore',
        timeout: 3000
      });
    } catch (fallbackErr: any) {
      console.warn(`[ChromeBrowser] Browser process fallback termination notice: ${fallbackErr?.message || fallbackErr}`);
    }
  }
}

/**
 * Kill any orphan Chrome or Edge processes locking a specific profile folder.
 */
export async function killOrphanChromeProcesses(
  keyword: string = 'pharmarack_profile',
  options?: { protectedPids?: number[]; dryRun?: boolean }
): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    const resolvedPath = path.isAbsolute(keyword)
      ? keyword
      : path.join(getAppDataDir(), 'data', keyword);
    const filterPattern = resolvedPath.replace(/\\/g, '%').replace(/\//g, '%');

    const execResult = await execAsync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"(name='chrome.exe' or name='msedge.exe') and commandline like '%${filterPattern}%'\\" | Select-Object -ExpandProperty ProcessId"`,
      { timeout: 4000 }
    ).catch(async () => {
      return await execAsync(
        `wmic process where "(name='chrome.exe' or name='msedge.exe') and CommandLine like '%${filterPattern}%'" get ProcessId`,
        { timeout: 3000 }
      ).catch(() => ({ stdout: '' }));
    });

    const stdout = execResult.stdout || '';
    const protectedSet = new Set(options?.protectedPids || []);
    const pids = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.toLowerCase().includes('processid'))
      .map(pid => parseInt(pid, 10))
      .filter(pid => !isNaN(pid) && pid > 0 && !protectedSet.has(pid));

    if (options?.dryRun) {
      console.log(`[ProcessGuardian] Dry-run: found ${pids.length} lock-holding candidate(s) for ${keyword}: ${pids.join(', ')}`);
      return;
    }

    for (const pid of pids) {
      console.log(`[ProcessGuardian] Killing lock-holding Chrome process: ${pid}`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch (_) {
        try {
          await execAsync(`taskkill /F /PID ${pid}`);
        } catch (_) {}
      }
    }
    if (pids.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (err: any) {
    console.error(`[ProcessGuardian] Failed to kill lock-holding Chrome processes for ${keyword}:`, err.message);
  }
}

/**
 * System-wide sweep of orphaned Chromium processes holding locks on our data profile folders.
 * Excludes active registered sessions, WhatsApp browser instance, and Pharmarack in-flight browsers.
 * Records all kills into action_logs.
 */
export async function reapSystemProfileOrphans(options?: { dryRun?: boolean }): Promise<{ killed: number; freedMB: number }> {
  if (process.platform !== 'win32') return { killed: 0, freedMB: 0 };
  if (isShutdownInProgress()) return { killed: 0, freedMB: 0 };

  try {
    const { isWhatsAppBusyOrRestoring, getWhatsAppBrowserPid } = await import('../whatsappClient.js');
    if (isWhatsAppBusyOrRestoring()) {
      console.log('[ProcessGuardian] WhatsApp is actively initializing or syncing. Skipping orphan reap.');
      return { killed: 0, freedMB: 0 };
    }

    const protectedPids = getActiveHeadlessPids();
    const waPid = getWhatsAppBrowserPid();
    if (waPid && waPid > 0) protectedPids.add(waPid);

    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"(name='chrome.exe' or name='msedge.exe')\\" | Select-Object ProcessId, WorkingSetSize, CommandLine | ConvertTo-Json -Compress"`,
      { timeout: 4000 }
    ).catch(() => ({ stdout: '' }));

    const trimmed = (stdout || '').trim();
    if (!trimmed) return { killed: 0, freedMB: 0 };

    let parsed: any[];
    try {
      const data = JSON.parse(trimmed);
      parsed = Array.isArray(data) ? data : [data];
    } catch {
      return { killed: 0, freedMB: 0 };
    }

    let killed = 0;
    let freedBytes = 0;
    const { dbManager } = await import('../database/connection.js');
    const db = await dbManager.getConnection().catch(() => null);

    for (const item of parsed) {
      const pid = Number(item.ProcessId);
      if (!pid || isNaN(pid) || protectedPids.has(pid)) continue;

      const cmdLine = String(item.CommandLine || '');
      const lower = cmdLine.toLowerCase();

      // Only sweep processes running our profile folders (never touch unrelated user Chrome)
      const isOurProfile =
        lower.includes('pharmarack_profile') ||
        lower.includes('pharmarack_profile_temp_') ||
        lower.includes('.wwebjs_auth');

      if (!isOurProfile) continue;

      const workingSet = Number(item.WorkingSetSize) || 0;
      console.log(`[ProcessGuardian] Reaping zombie Chromium process: PID ${pid} (${Math.round(workingSet / (1024 * 1024))} MB)`);

      if (!options?.dryRun) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (_) {
          try {
            await execAsync(`taskkill /F /PID ${pid}`);
          } catch (_) {}
        }

        if (db) {
          try {
            await db.run(
              `INSERT INTO action_logs (action, entity, entity_id, notes, timestamp)
               VALUES ('reap_zombie', 'system_resource', ?, ?, datetime('now', 'localtime'))`,
              [String(pid), JSON.stringify({ rssKB: Math.round(workingSet / 1024), cmd: cmdLine.slice(0, 120) })]
            );
          } catch (_) {}
        }
      }

      killed++;
      freedBytes += workingSet;
    }

    const freedMB = Math.round(freedBytes / (1024 * 1024));
    if (killed > 0) {
      console.log(`[ProcessGuardian] Zombie sweep complete: ${killed} process(es) reaped, ${freedMB} MB freed.`);
    }
    return { killed, freedMB };
  } catch (err: any) {
    console.error('[ProcessGuardian] Error in reapSystemProfileOrphans:', err?.message || err);
    return { killed: 0, freedMB: 0 };
  }
}

/**
 * Remove orphaned temporary profile folders created during profile-lock fallbacks.
 */
export function cleanTempProfileFolders(): void {
  try {
    const dataDir = path.resolve(getAppDataDir(), 'data');
    if (!fs.existsSync(dataDir)) return;
    const entries = fs.readdirSync(dataDir);
    for (const entry of entries) {
      if (entry.startsWith('pharmarack_profile_temp_')) {
        const fullPath = path.join(dataDir, entry);
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`[ChromeBrowser] Removed orphaned temp profile folder: ${entry}`);
        } catch (_) {}
      }
    }
  } catch (err: any) {
    console.warn('[ChromeBrowser] Error cleaning temp profile folders:', err.message);
  }
}

/**
 * Unlink lingering Chromium lock files (SingletonLock, lockfile, devtoolsactiveport, etc.).
 */
export function cleanProfileLockFiles(profilePath: string): void {
  if (!fs.existsSync(profilePath)) return;
  const lockFiles = [
    'SingletonLock',
    'lockfile',
    'parent.lock',
    'Singleton Cookie',
    'Singleton Socket',
    'Singleton Preference',
    'devtoolsactiveport'
  ];
  for (const file of lockFiles) {
    const filePath = path.join(profilePath, file);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[ChromeBrowser] Removed stale lock file: ${filePath}`);
      } catch (err: any) {
        console.warn(`[ChromeBrowser] Could not remove lock file ${filePath}: ${err.message}`);
      }
    }
  }
}

/**
 * Central registry for active headless/background browser sessions.
 * Allows gracefulShutdown to terminate in-flight Puppeteer browsers or
 * spawned Chrome instances before closing, preventing locked profiles on re-open.
 */
interface TrackedHeadlessSession {
  id: string;
  tag: string;
  target: any; // Puppeteer Browser, ChildProcess, or PID
  startedAt: number;
}

const activeHeadlessRegistry = new Map<string, TrackedHeadlessSession>();
let shutdownInProgressFlag = false;
let nextHeadlessId = 1;

/** Check whether application shutdown is currently in progress. */
export function isShutdownInProgress(): boolean {
  return shutdownInProgressFlag;
}

/** Signal that application shutdown has started to prevent new browser launches. */
export function markShutdownInProgress(): void {
  shutdownInProgressFlag = true;
}

/** Demote a background process or browser to BELOW_NORMAL priority on Windows to protect CPU rendering */
export function demoteProcessPriority(target: any): void {
  if (process.platform !== 'win32') return;
  try {
    let pid: number | null = null;
    if (typeof target === 'number' && target > 0) pid = target;
    else if (target?.pid && typeof target.pid === 'number') pid = target.pid;
    else if (typeof target?.process === 'function') {
      const proc = target.process();
      if (proc?.pid && typeof proc.pid === 'number') pid = proc.pid;
    }
    if (pid && (os.constants?.priority as any)?.PRIORITY_BELOW_NORMAL) {
      os.setPriority(pid, (os.constants.priority as any).PRIORITY_BELOW_NORMAL);
    }
  } catch (_) {}
}

/** Get all PIDs of currently tracked active headless sessions */
export function getActiveHeadlessPids(): Set<number> {
  const pids = new Set<number>();
  for (const session of activeHeadlessRegistry.values()) {
    const t = session.target;
    if (!t) continue;
    if (typeof t === 'number' && t > 0) {
      pids.add(t);
    } else if (typeof t.pid === 'number' && t.pid > 0) {
      pids.add(t.pid);
    } else if (typeof t.process === 'function') {
      try {
        const proc = t.process();
        if (proc && typeof proc.pid === 'number') pids.add(proc.pid);
      } catch (_) {}
    }
  }
  return pids;
}

/** Register a headless browser or spawned chrome process for clean shutdown tracking. */
export function trackHeadless(target: any, tag: string): string {
  const id = `hl_${Date.now()}_${nextHeadlessId++}`;
  activeHeadlessRegistry.set(id, {
    id,
    tag,
    target,
    startedAt: Date.now()
  });
  // Priority Diet: Demote spawned background browser processes to BELOW_NORMAL
  demoteProcessPriority(target);
  return id;
}

/** Deregister a headless browser or spawned process when it finishes normally. */
export function untrackHeadless(idOrTarget: any): void {
  if (typeof idOrTarget === 'string') {
    activeHeadlessRegistry.delete(idOrTarget);
    return;
  }
  for (const [id, item] of activeHeadlessRegistry.entries()) {
    if (item.target === idOrTarget) {
      activeHeadlessRegistry.delete(id);
      break;
    }
  }
}

/**
 * Gracefully close all registered headless/background browser sessions with a 1.5s timeout,
 * then clean up orphan processes, temp profile directories, and lock files.
 */
export async function closeAllHeadlessBrowsers(): Promise<void> {
  markShutdownInProgress();
  const entries = Array.from(activeHeadlessRegistry.values());
  activeHeadlessRegistry.clear();

  if (entries.length > 0) {
    console.log(`[ChromeBrowser] Closing ${entries.length} tracked headless browser session(s)...`);
  }

  // 1. Concurrently close all tracked instances with a 1500ms timeout per instance
  await Promise.allSettled(
    entries.map(async (entry) => {
      try {
        const target = entry.target;
        if (!target) return;

        // Puppeteer Browser instance
        if (typeof target.close === 'function') {
          console.log(`[ChromeBrowser] Closing tracked headless browser (${entry.tag})...`);
          await Promise.race([
            target.close().catch(() => {}),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Browser.close() timed out')), 1500))
          ]).catch(err => {
            console.warn(`[ChromeBrowser] Headless browser close notice (${entry.tag}): ${err.message}`);
          });
          return;
        }

        // ChildProcess instance
        if (typeof target.kill === 'function') {
          console.log(`[ChromeBrowser] Terminating tracked child process (${entry.tag}, PID: ${target.pid})...`);
          try {
            if (process.platform === 'win32' && target.pid) {
              execSync(`taskkill /pid ${target.pid} /t /f`, { stdio: 'ignore' });
            } else {
              target.kill('SIGTERM');
            }
          } catch (_) {}
          return;
        }

        // Raw PID number
        if (typeof target === 'number' && target > 0) {
          try {
            if (process.platform === 'win32') {
              execSync(`taskkill /pid ${target} /t /f`, { stdio: 'ignore' });
            } else {
              process.kill(target, 'SIGTERM');
            }
          } catch (_) {}
        }
      } catch (err: any) {
        console.warn(`[ChromeBrowser] Error closing tracked instance (${entry.tag}):`, err.message || err);
      }
    })
  );

  // 2. Kill orphan Chrome processes holding locks on pharmarack_profile
  try {
    await killOrphanChromeProcesses('pharmarack_profile');
  } catch (_) {}

  // 3. Remove any orphaned temp profile folders
  try {
    cleanTempProfileFolders();
  } catch (_) {}

  // 4. Clean lock files on main pharmarack profile
  try {
    const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
    cleanProfileLockFiles(mainProfilePath);
  } catch (_) {}
}


