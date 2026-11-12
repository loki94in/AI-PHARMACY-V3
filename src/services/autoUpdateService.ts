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

/**
 * Extracts the "What's new" section from a GitHub release markdown body,
 * or returns the full body if no specific section heading is present (Coucou parity).
 */
export function extractWhatsNewSection(body: string): string {
  if (!body) return '';
  const match = body.match(/##\s*(?:what['’]?s\s*new|changelog|improvements|changes)([\s\S]*?)(?=\n##\s|\n---\s*|\s*$)/i);
  if (match && match[1] && match[1].trim()) {
    return match[1].trim();
  }
  return body.trim();
}

/**
 * Resolves release notes/changelog for a version from GitHub Releases
 * if the update server didn't provide one (matching Coucou's release notes behavior).
 */
export async function resolveChangelogForVersion(version: string, existingChangelog?: string): Promise<string | undefined> {
  if (existingChangelog && existingChangelog.trim()) {
    return extractWhatsNewSection(existingChangelog.trim());
  }
  try {
    const { getUpdateHistory } = await import('./updateHistoryService.js');
    const history = await getUpdateHistory(false);
    const targetVer = version.replace(/^v/, '');
    const matched = history.releases?.find(r => r.version.replace(/^v/, '') === targetVer);
    if (matched?.changelog && matched.changelog.trim()) {
      return extractWhatsNewSection(matched.changelog.trim());
    }
  } catch (_) {}
  return existingChangelog;
}

// ── Update staging directory ─────────────────────────────────────────────────
// PRODUCTION.md §21: download to {app}\updates\staging, NOT os.tmpdir()
export function getStagingDir(): string {
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

function getUpdateGuiPath(): string {
  // UpdateGUI.ps1 lives next to PharmacyOS.exe in the install dir
  const appDir = path.dirname(process.execPath);
  const isSeaBinary = !process.execPath.endsWith('node.exe') &&
                      !process.execPath.endsWith('node') &&
                      !process.execPath.includes('tsx');
  if (isSeaBinary) return path.join(appDir, 'UpdateGUI.ps1');
  return path.join(process.cwd(), 'packaging', 'UpdateGUI.ps1');
}

export function getLogPath(): string {
  const appDir = path.dirname(process.execPath);
  const isSeaBinary = !process.execPath.endsWith('node.exe') &&
                      !process.execPath.endsWith('node') &&
                      !process.execPath.includes('tsx');
  const baseDir = isSeaBinary ? appDir : path.join(os.homedir(), 'AppData', 'Local', 'AI Pharmacy OS');
  return path.join(baseDir, 'logs', 'updater.log');
}

// ── Download helper ──────────────────────────────────────────────────────────
const DOWNLOAD_STALL_TIMEOUT_MS = 120_000;
const DOWNLOAD_MAX_REDIRECTS = 5;
const DOWNLOAD_MAX_TRANSIENT_RETRIES = 4;
const PARALLEL_MIN_BYTES = 2 * 1024 * 1024; // Only parallelize >= 2 MB packages
const PARALLEL_CHUNKS = 6;
const DOWNLOAD_HEADERS = {
  'User-Agent': 'AI-Pharmacy-OS-AutoUpdater/1.0',
  Accept: '*/*',
};

function getHttpClient(targetUrl: string) {
  return targetUrl.startsWith('https') ? https : http;
}

function isTransientStatus(statusCode?: number): boolean {
  return Boolean(statusCode && [502, 503, 504].includes(statusCode));
}

function isTransientSocketError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return Boolean(code && ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code));
}

interface DownloadProbeResult {
  resolvedUrl: string;
  acceptRanges: boolean;
  totalBytes: number;
}

/**
 * Resolves redirects via HEAD and checks whether the target supports byte-range requests.
 * Returns null if HEAD is unsupported so callers can fall back to single-stream GET.
 */
function probeDownload(url: string, redirectCount = 0): Promise<DownloadProbeResult | null> {
  return new Promise((resolve) => {
    if (redirectCount > DOWNLOAD_MAX_REDIRECTS) return resolve(null);
    const client = getHttpClient(url);
    const req = client.request(
      url,
      { method: 'HEAD', headers: DOWNLOAD_HEADERS },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, url).toString();
          return resolve(probeDownload(nextUrl, redirectCount + 1));
        }
        if (res.statusCode !== 200) {
          return resolve(null);
        }
        const totalBytes = parseInt(res.headers['content-length'] || '0', 10) || 0;
        const acceptRanges = String(res.headers['accept-ranges'] || '').toLowerCase() === 'bytes';
        resolve({ resolvedUrl: url, acceptRanges, totalBytes });
      }
    );
    req.setTimeout(15_000, () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

function downloadSingleStream(
  url: string,
  dest: string,
  expectedTotalBytes?: number,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempDest = dest + '.tmp';
    let retryAttempt = 0;

    function makeRequest(currentUrl: string, redirectCount = 0) {
      if (redirectCount > DOWNLOAD_MAX_REDIRECTS) {
        return reject(new Error('DOWNLOAD_FAILED: Too many redirects while downloading update'));
      }
      const client = getHttpClient(currentUrl);

      const req = client.get(
        currentUrl,
        { headers: DOWNLOAD_HEADERS },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume(); // Free previous response socket back to agent pool
            const redirectUrl = new URL(res.headers.location, currentUrl).toString();
            return makeRequest(redirectUrl, redirectCount + 1);
          }
          if (isTransientStatus(res.statusCode) && retryAttempt < DOWNLOAD_MAX_TRANSIENT_RETRIES) {
            res.resume();
            retryAttempt++;
            const backoffMs = retryAttempt * 3000;
            console.log(`[AutoUpdate] HTTP ${res.statusCode} from CDN/gateway. Retrying in ${backoffMs / 1000}s (attempt ${retryAttempt}/${DOWNLOAD_MAX_TRANSIENT_RETRIES})...`);
            setTimeout(() => {
              makeRequest(currentUrl, redirectCount);
            }, backoffMs);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`DOWNLOAD_FAILED: HTTP ${res.statusCode}`));
          }
          const headerBytes = parseInt(res.headers['content-length'] || '0', 10);
          const totalBytes = headerBytes > 0 ? headerBytes : (expectedTotalBytes && expectedTotalBytes > 0 ? expectedTotalBytes : 0);
          let downloadedBytes = 0;
          let lastReport = 0;

          if (onProgress && totalBytes > 0) {
            onProgress(0, totalBytes);
          }

          const fileStream = fs.createWriteStream(tempDest, { highWaterMark: 256 * 1024 });
          res.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            const now = Date.now();
            if (onProgress && (now - lastReport > 300 || (totalBytes > 0 && downloadedBytes === totalBytes))) {
              lastReport = now;
              onProgress(downloadedBytes, totalBytes);
            }
          });
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close(() => {
              if (totalBytes > 0 && downloadedBytes < totalBytes) {
                try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch (_) {}
                return reject(new Error(`DOWNLOAD_INCOMPLETE: Received ${downloadedBytes} of ${totalBytes} bytes`));
              }
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
            try { fileStream.destroy(); } catch (_) {}
            try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch (_) {}
            reject(err);
          });
        }
      );
      req.setTimeout(DOWNLOAD_STALL_TIMEOUT_MS, () => {
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

class RangeUnsupportedError extends Error {}

function fetchRangeSlice(
  url: string,
  start: number,
  end: number,
  activeRequests: Set<http.ClientRequest>,
  redirectCount = 0
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (redirectCount > DOWNLOAD_MAX_REDIRECTS) {
      return reject(new Error('DOWNLOAD_FAILED: Too many redirects while fetching range slice'));
    }
    const client = getHttpClient(url);
    const req = client.get(
      url,
      {
        headers: {
          ...DOWNLOAD_HEADERS,
          Range: `bytes=${start}-${end}`,
        },
      },
      (res) => {
        activeRequests.delete(req);
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          return fetchRangeSlice(nextUrl, start, end, activeRequests, redirectCount + 1).then(resolve, reject);
        }
        if (res.statusCode === 200) {
          res.resume();
          return reject(new RangeUnsupportedError('Server ignored Range header and returned 200'));
        }
        if (res.statusCode !== 206) {
          res.resume();
          const err = new Error(`DOWNLOAD_FAILED: HTTP ${res.statusCode}`) as Error & { statusCode?: number };
          err.statusCode = res.statusCode;
          return reject(err);
        }
        resolve(res);
      }
    );
    activeRequests.add(req);
    req.setTimeout(DOWNLOAD_STALL_TIMEOUT_MS, () => {
      activeRequests.delete(req);
      req.destroy(new Error('DOWNLOAD_TIMEOUT: Connection stalled for 120s with no data'));
    });
    req.on('error', (err) => {
      activeRequests.delete(req);
      reject(err);
    });
  });
}

async function downloadParallelRanges(
  resolvedUrl: string,
  dest: string,
  totalBytes: number,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const tempDest = dest + '.tmp';
  const chunkCount = Math.min(PARALLEL_CHUNKS, Math.max(2, Math.floor(totalBytes / (1024 * 1024))));
  const sliceSize = Math.ceil(totalBytes / chunkCount);
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * sliceSize;
    if (start >= totalBytes) break;
    const end = Math.min(totalBytes - 1, start + sliceSize - 1);
    ranges.push({ start, end });
  }

  let totalDownloaded = 0;
  let lastReport = 0;
  let aborted = false;
  const activeRequests = new Set<http.ClientRequest>();
  const activeStreams = new Set<http.IncomingMessage>();
  const fh = await fs.promises.open(tempDest, 'w');

  const reportProgress = (force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (force || now - lastReport > 250 || totalDownloaded === totalBytes) {
      lastReport = now;
      onProgress(totalDownloaded, totalBytes);
    }
  };

  try {
    await fh.truncate(totalBytes);
    reportProgress(true);

    const runSlice = async (start: number, end: number) => {
      const expectedSliceLen = end - start + 1;
      let sliceWritten = 0;
      let retries = 0;

      while (sliceWritten < expectedSliceLen) {
        if (aborted) throw new Error('DOWNLOAD_ABORTED');
        const currentStart = start + sliceWritten;
        let res: http.IncomingMessage | null = null;
        try {
          res = await fetchRangeSlice(resolvedUrl, currentStart, end, activeRequests);
          activeStreams.add(res);
          for await (const chunk of res) {
            if (aborted) {
              res.destroy();
              throw new Error('DOWNLOAD_ABORTED');
            }
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const remaining = expectedSliceLen - sliceWritten;
            const toWrite = buf.length > remaining ? buf.subarray(0, remaining) : buf;
            if (toWrite.length > 0) {
              await fh.write(toWrite, 0, toWrite.length, start + sliceWritten);
              sliceWritten += toWrite.length;
              totalDownloaded += toWrite.length;
              reportProgress();
            }
            if (sliceWritten >= expectedSliceLen) {
              res.destroy();
              break;
            }
          }
          activeStreams.delete(res);
          if (sliceWritten < expectedSliceLen) {
            throw new Error(`DOWNLOAD_INCOMPLETE: Slice stopped at ${sliceWritten}/${expectedSliceLen} bytes`);
          }
        } catch (err: any) {
          if (res) {
            activeStreams.delete(res);
            if (!res.destroyed) res.destroy();
          }
          if (err instanceof RangeUnsupportedError) throw err;
          if (aborted) throw err;
          const status = err?.statusCode as number | undefined;
          const retryable = isTransientStatus(status) || isTransientSocketError(err) || String(err?.message || '').startsWith('DOWNLOAD_INCOMPLETE');
          if (!retryable || retries >= DOWNLOAD_MAX_TRANSIENT_RETRIES) {
            throw err;
          }
          retries++;
          await new Promise((r) => setTimeout(r, retries * 1500));
        }
      }
    };

    await Promise.all(ranges.map((r) => runSlice(r.start, r.end)));

    if (totalDownloaded !== totalBytes) {
      throw new Error(`DOWNLOAD_INCOMPLETE: Received ${totalDownloaded} of ${totalBytes} bytes`);
    }
    reportProgress(true);
    await fh.close();
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(tempDest, dest);
  } catch (err) {
    aborted = true;
    for (const req of activeRequests) {
      try { req.destroy(); } catch (_) {}
    }
    for (const stream of activeStreams) {
      try { stream.destroy(); } catch (_) {}
    }
    try { await fh.close(); } catch (_) {}
    try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch (_) {}
    throw err;
  }
}

export async function downloadFile(
  url: string,
  dest: string,
  expectedTotalBytes?: number,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const probe = await probeDownload(url);
  if (probe && probe.acceptRanges && probe.totalBytes >= PARALLEL_MIN_BYTES) {
    try {
      await downloadParallelRanges(probe.resolvedUrl, dest, probe.totalBytes, onProgress);
      return;
    } catch (err) {
      if (!(err instanceof RangeUnsupportedError)) {
        throw err;
      }
      // Fall through cleanly if the target ignored Range headers
    }
  }
  await downloadSingleStream(probe?.resolvedUrl || url, dest, probe?.totalBytes || expectedTotalBytes, onProgress);
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
    downloadedBytes?: number;
    totalBytes?: number | null;
    packageSizeBytes?: number | null;
    installerSizeBytes?: number | null;
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
                // Coucou parity: resolve GitHub release notes for staged package before broadcast
                resolveChangelogForVersion(stagedVersion).then(changelog => {
                  if (this.lastResult && this.lastResult.latestVersion === stagedVersion) {
                    this.lastResult.changelog = changelog;
                  }
                  setTimeout(() => {
                    eventService.broadcast('update_available', {
                      latestVersion:  stagedVersion,
                      currentVersion: APP_VERSION,
                      hasUpdate:      true,
                      changelog:      changelog || '',
                      readyToInstall: true,
                      downloading:    false,
                      reason:         'boot_staged',
                    });
                  }, 3000);
                }).catch(() => {
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
                });
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

    // P3 Gated periodic version beacon (runs every 30m when active, catching mid-day releases)
    this.intervalHandle = setInterval(() => {
      if (this.isDownloading || this.lastResult?.readyToInstall) return;
      if (activityTracker.isIdle()) return;
      void this.runCheck('auto');
    }, 30 * 60 * 1000);
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
      downloadedBytes: isNewer ? (this.lastResult.downloadedBytes ?? 0) : 0,
      totalBytes: isNewer ? (this.lastResult.totalBytes ?? 0) : 0,
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

      // Periodic checks:
      // 'boot' and 'manual' checks ALWAYS run regardless of last_checked_at so new releases are caught immediately
      // 'auto' (30-min beacon) throttles to 25m to prevent rapid server polling
      // 'interval' respects the configured check_interval_days (default 1 day)
      if (reason === 'auto' && row?.last_checked_at) {
        const lastMs = new Date(row.last_checked_at).getTime();
        if (Date.now() - lastMs < 25 * 60 * 1000) return;
      } else if (reason === 'interval' && row?.last_checked_at) {
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
        totalBytes: result.totalBytes ?? (this.lastResult?.totalBytes || 0),
        readyToInstall: alreadyDownloaded,
        lastError: undefined,
      };

      if (trulyHasUpdate) {
        console.log(`[AutoUpdate] New version available: ${result.latestVersion}`);

        // Coucou parity: auto-enrich release notes from GitHub if update server sent empty/minimal changelog
        if (!result.changelog && result.latestVersion) {
          result.changelog = await resolveChangelogForVersion(result.latestVersion);
          if (this.lastResult) {
            this.lastResult.changelog = result.changelog;
          }
        }

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
        latestVersion:  target.latestVersion,
        currentVersion: APP_VERSION,
        hasUpdate:      true,
        changelog:      target.changelog || this.lastResult?.changelog || '',
        readyToInstall: true,
        downloading:    false,
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

    const knownTotalBytes = (typeof target.totalBytes === 'number' && target.totalBytes > 0)
      ? target.totalBytes
      : ((useZip ? target.packageSizeBytes : target.installerSizeBytes) || 0);

    this.isDownloading = true;
    this.lastResult = {
      ...(this.lastResult || {}),
      ...target,
      downloading: true,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: knownTotalBytes,
      readyToInstall: false,
    };

    eventService.broadcast('update_available', {
      latestVersion: target.latestVersion,
      currentVersion: APP_VERSION,
      hasUpdate: true,
      downloadUrl: target.downloadUrl,
      updatePackageUrl: target.updatePackageUrl,
      totalBytes: knownTotalBytes,
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
      expectedTotalBytes: knownTotalBytes,
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
    expectedTotalBytes?: number;
    isZip: boolean;
    reason?: string;
  }): Promise<void> {
    const { url, dest, version, sha256: expectedSha256, changelog, expectedTotalBytes, isZip, reason = 'auto' } = opts;
    try {
      const stagingDir = getStagingDir();
      fs.mkdirSync(stagingDir, { recursive: true });

      const pkgType = isZip ? 'update ZIP (fast path)' : 'full Setup EXE (fallback path)';
      console.log(`[AutoUpdate] Silently downloading ${pkgType} for v${version} to staging...`);
      await downloadFile(url, dest, expectedTotalBytes, (downloaded, total) => {
        const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        if (this.lastResult) {
          this.lastResult.downloadProgress = percent;
          this.lastResult.downloadedBytes = downloaded;
          this.lastResult.totalBytes = total;
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
        if (this.lastResult.totalBytes && !this.lastResult.downloadedBytes) {
          this.lastResult.downloadedBytes = this.lastResult.totalBytes;
        }
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
        lastError: errorMsg,
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
  async applyUpdate(options?: { route?: string }): Promise<{ success: boolean; message: string }> {
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

    const { migrationStatus } = await import('../worker/migrationWorker.js');
    if (migrationStatus?.active) {
      throw new Error('Cannot install update: a database migration is currently in progress. Please wait for migration to complete.');
    }

    // Coucou parity: Persist session checkpoint before shutting down so app reopens where user left off
    try {
      const { saveSessionCheckpoint } = await import('./sessionCheckpointService.js');
      saveSessionCheckpoint({
        route: options?.route || '/pos',
        targetVersion: this.lastResult.latestVersion,
        previousVersion: APP_VERSION,
        timestamp: Date.now(),
        resumed: false,
      });
      console.log(`[AutoUpdate] Stored session checkpoint for relaunch: route="${options?.route || '/pos'}" target="v${this.lastResult.latestVersion}"`);
    } catch (cpErr: any) {
      console.warn('[AutoUpdate] Could not save session checkpoint:', cpErr.message);
    }

    const stagingDir = getStagingDir();
    const zipFileName = `AI-Pharmacy-OS-Update-v${this.lastResult.latestVersion}.zip`;
    const zipPath     = path.join(stagingDir, zipFileName);
    const exeFileName = `AI-Pharmacy-OS-Portable-Setup-v${this.lastResult.latestVersion}.exe`;
    const exePath     = path.join(stagingDir, exeFileName);

    // Evict stale or dead update.lock so user is never blocked by a previously crashed updater
    const updatesBaseDir = path.dirname(stagingDir);
    const lockPath = path.join(updatesBaseDir, 'update.lock');
    if (fs.existsSync(lockPath)) {
      try {
        const raw = fs.readFileSync(lockPath, 'utf8');
        const data = JSON.parse(raw);
        if (data?.pid) {
          try {
            process.kill(data.pid, 0); // Throws ESRCH if process is dead
          } catch {
            fs.unlinkSync(lockPath);
            console.log('[AutoUpdate] Evicted stale update.lock from dead process PID:', data.pid);
          }
        }
      } catch {
        try { fs.unlinkSync(lockPath); } catch {}
      }
    }

    if (fs.existsSync(zipPath)) {
      const updaterPath = getUpdaterPath();
      if (!fs.existsSync(updaterPath)) {
        throw new Error(`Updater.bat not found at: ${updaterPath}`);
      }

      const installDir = path.dirname(process.execPath).replace(/[\\/]+$/, '');
      const logPath    = getLogPath();
      const sha256     = this.lastResult.sha256 || 'NONE';

      console.log('[AutoUpdate] Spawning dedicated Updater.bat (ZIP fast path)...');
      console.log(`[AutoUpdate]   ZIP      : ${zipPath}`);
      console.log(`[AutoUpdate]   InstDir  : ${installDir}`);
      console.log(`[AutoUpdate]   Version  : ${this.lastResult.latestVersion}`);
      console.log(`[AutoUpdate]   SHA-256  : ${sha256 || '(not provided)'}`);

      // Write a dedicated launcher script to avoid cmd.exe quote-escaping bugs on paths with spaces
      const targetVersion = this.lastResult.latestVersion;
      const launcherBat = path.join(stagingDir, 'launch-update.bat');

      // Check if Apple-style native WPF Update GUI is available
      const guiPath = getUpdateGuiPath();
      const hasGui = fs.existsSync(guiPath);

      const launcherContent = hasGui
        ? [
            '@echo off',
            `title AI Pharmacy OS — Updating to v${targetVersion}`,
            `powershell.exe -Sta -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${guiPath}" -ZipPath "${zipPath}" -InstallDir "${installDir}" -TargetVersion "${targetVersion}" -ExpectedSha256 "${sha256}" -LogPath "${logPath}"`,
            'exit /b %ERRORLEVEL%',
          ].join('\r\n')
        : [
            '@echo off',
            `title AI Pharmacy OS — Updating to v${targetVersion}`,
            `call "${updaterPath}" "${zipPath}" "${installDir}" "${targetVersion}" "${sha256}" "${logPath}"`,
            'exit /b %ERRORLEVEL%',
          ].join('\r\n');
      fs.writeFileSync(launcherBat, launcherContent, 'utf8');

      console.log(`[AutoUpdate] Spawning decoupled launcher (${hasGui ? 'UpdateGUI.ps1 WPF' : 'Updater.bat CLI'})...`);
      console.log(`[AutoUpdate]   ZIP      : ${zipPath}`);
      console.log(`[AutoUpdate]   InstDir  : ${installDir}`);
      console.log(`[AutoUpdate]   Version  : ${this.lastResult.latestVersion}`);
      console.log(`[AutoUpdate]   SHA-256  : ${sha256 || '(not provided)'}`);

      // Crucial: Spawn via 'cmd.exe /c start "" cmd.exe /c launcherBat' to break away into an independent
      // Windows process tree, ensuring parent server shutdown does not kill the updater during WPF load or extraction
      const child = spawn('cmd.exe', ['/c', 'start', `AI Pharmacy OS — Updating to v${targetVersion}`, 'cmd.exe', '/c', launcherBat], {
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

      const targetVersion = this.lastResult.latestVersion;
      const installDir = path.dirname(process.execPath).replace(/[\\/]+$/, '');
      const launcherBat = path.join(stagingDir, 'launch-setup.bat');
      const setupBackupDir = path.join(installDir, 'backup', 'preupdate-setup');
      const launcherContent = [
        '@echo off',
        `title AI Pharmacy OS — Installing Setup v${targetVersion}`,
        'echo Waiting for running application processes to exit...',
        'taskkill /F /T /IM PharmacyOS.exe >nul 2>&1',
        'taskkill /F /T /IM PharmacyBackend.exe >nul 2>&1',
        'ping 127.0.0.1 -n 3 >nul',
        `if exist "${setupBackupDir}" rmdir /S /Q "${setupBackupDir}" >nul 2>&1`,
        `mkdir "${setupBackupDir}" >nul 2>&1`,
        `if exist "${path.join(installDir, 'PharmacyOS.exe')}" copy /Y "${path.join(installDir, 'PharmacyOS.exe')}" "${path.join(setupBackupDir, 'PharmacyOS.exe')}" >nul 2>&1`,
        `if exist "${path.join(installDir, 'WebView2Loader.dll')}" copy /Y "${path.join(installDir, 'WebView2Loader.dll')}" "${path.join(setupBackupDir, 'WebView2Loader.dll')}" >nul 2>&1`,
        `if exist "${path.join(installDir, 'PharmacyBackend.exe')}" copy /Y "${path.join(installDir, 'PharmacyBackend.exe')}" "${path.join(setupBackupDir, 'PharmacyBackend.exe')}" >nul 2>&1`,
        `if exist "${path.join(installDir, 'dist-pkg')}" xcopy /E /Y /I "${path.join(installDir, 'dist-pkg')}" "${path.join(setupBackupDir, 'dist-pkg')}" >nul 2>&1`,
        `if exist "${path.join(installDir, 'frontend', 'dist')}" xcopy /E /Y /I "${path.join(installDir, 'frontend', 'dist')}" "${path.join(setupBackupDir, 'frontend', 'dist')}" >nul 2>&1`,
        `start "" /wait "${exePath}" /SILENT /SUPPRESSMSGBOXES`,
        'set "SETUP_RC=%ERRORLEVEL%"',
        `if not "%SETUP_RC%"=="0" goto :RESTORE_SETUP`,
        `if not exist "${path.join(installDir, 'PharmacyOS.exe')}" goto :RESTORE_SETUP`,
        `rmdir /S /Q "${setupBackupDir}" >nul 2>&1`,
        'echo Setup completed. Starting AI Pharmacy OS...',
        'ping 127.0.0.1 -n 2 >nul',
        `start "" "${path.join(installDir, 'PharmacyOS.exe')}"`,
        'exit /b 0',
        ':RESTORE_SETUP',
        'echo Setup failed or aborted. Restoring previous version...',
        `echo {"version":"${targetVersion}","error":"SETUP_INSTALL_FAILED","rollback":"attempted"} > "${path.join(stagingDir, 'failure.json')}"`,
        `if exist "${path.join(setupBackupDir, 'PharmacyOS.exe')}" copy /Y "${path.join(setupBackupDir, 'PharmacyOS.exe')}" "${path.join(installDir, 'PharmacyOS.exe')}" >nul 2>&1`,
        `if exist "${path.join(setupBackupDir, 'WebView2Loader.dll')}" copy /Y "${path.join(setupBackupDir, 'WebView2Loader.dll')}" "${path.join(installDir, 'WebView2Loader.dll')}" >nul 2>&1`,
        `if exist "${path.join(setupBackupDir, 'PharmacyBackend.exe')}" copy /Y "${path.join(setupBackupDir, 'PharmacyBackend.exe')}" "${path.join(installDir, 'PharmacyBackend.exe')}" >nul 2>&1`,
        `if exist "${path.join(setupBackupDir, 'dist-pkg')}" xcopy /E /Y /I "${path.join(setupBackupDir, 'dist-pkg')}" "${path.join(installDir, 'dist-pkg')}" >nul 2>&1`,
        `if exist "${path.join(setupBackupDir, 'frontend', 'dist')}" xcopy /E /Y /I "${path.join(setupBackupDir, 'frontend', 'dist')}" "${path.join(installDir, 'frontend', 'dist')}" >nul 2>&1`,
        'ping 127.0.0.1 -n 2 >nul',
        `start "" "${path.join(installDir, 'PharmacyOS.exe')}"`,
        'exit /b 1',
      ].join('\r\n');
      fs.writeFileSync(launcherBat, launcherContent, 'utf8');

      const child = spawn('cmd.exe', ['/c', 'start', `AI Pharmacy OS — Setup v${targetVersion}`, 'cmd.exe', '/c', launcherBat], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();

      return { success: true, message: 'Installing update package via Setup and restarting...' };
    }

    // Resilient fallback: if the expected package is missing on disk, automatically re-trigger background download
    console.warn(`[AutoUpdate] Staged update package missing (${zipFileName}). Triggering fresh download...`);
    this.startBackgroundDownload(this.lastResult, 'redownload-missing');
    return { success: false, message: 'Update package was missing or corrupted. Fresh download initiated...' };
  }

  getLastResult() { return this.lastResult; }

  /**
   * Call once on boot. Detects if previous update install failed (rollback already happened).
   * PRODUCTION.md §26, §35
   */
  async checkFailedUpdate(): Promise<string | null> {
    const stagingDir   = getStagingDir();
    const failurePath  = path.join(stagingDir, 'failure.json');
    const rollbackPath = path.join(stagingDir, 'rollback.json');
    const hasFailure   = fs.existsSync(failurePath);
    const hasRollback  = fs.existsSync(rollbackPath);

    if (!hasFailure && !hasRollback) return null;
    try {
      const activePath = hasFailure ? failurePath : rollbackPath;
      const raw  = fs.readFileSync(activePath, 'utf8');
      const info = JSON.parse(raw) as { version?: string; error?: string };

      // Consume both failure and rollback flags
      try { if (fs.existsSync(failurePath)) fs.unlinkSync(failurePath); } catch (_) {}
      try { if (fs.existsSync(rollbackPath)) fs.unlinkSync(rollbackPath); } catch (_) {}

      // Break update loop: purge the faulty or uninstalled staged package so boot does not immediately re-arm it
      if (info.version) {
        const failedZip = path.join(stagingDir, `AI-Pharmacy-OS-Update-v${info.version}.zip`);
        try { if (fs.existsSync(failedZip)) fs.unlinkSync(failedZip); } catch (_) {}
        const failedExe = path.join(stagingDir, `AI-Pharmacy-OS-Portable-Setup-v${info.version}.exe`);
        try { if (fs.existsSync(failedExe)) fs.unlinkSync(failedExe); } catch (_) {}
        console.warn(`[AutoUpdate] Purged failed/rolled-back staged package for v${info.version} to break update loop.`);
      }

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
