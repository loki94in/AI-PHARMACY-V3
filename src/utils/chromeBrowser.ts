import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getAppDataDir } from '../config/index.js';

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
  const paths: (string | null)[] = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null
  ];

  if (options?.includeEdge) {
    paths.push(
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe') : null,
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe') : null
    );
  }

  for (const p of paths.filter(Boolean) as string[]) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
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
export function launchAppBrowser(url: string, customProfileDir?: string, onExit?: () => void): boolean {
  try {
    const browserPath = findChromePath({ includeEdge: true });
    if (browserPath) {
      const profileDir = customProfileDir || path.join(getAppDataDir(), 'data', 'app_browser_profile');
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      const args = [
        `--app=${url}`,
        `--user-data-dir=${profileDir}`,
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble'
      ];

      const child = spawn(browserPath, args, {
        detached: !onExit,
        stdio: 'ignore'
      });
      child.on('error', (err) => {
        console.warn(`[ChromeBrowser] Direct app-mode spawn error (non-fatal): ${err.message}`);
      });
      if (onExit) {
        child.on('exit', (code) => {
          console.log(`[ChromeBrowser] App browser window closed (code: ${code}). Triggering app shutdown...`);
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

