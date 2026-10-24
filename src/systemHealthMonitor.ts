/**
 * System Health Monitor & Chromium Telemetry (P2-105)
 *
 * Continuously measures host memory, process memory, event-loop lag, and Chromium process census.
 * Protects 12 GB / 4-core desktop from thrashing and freezing by detecting zombie processes
 * and memory pressure early.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getAppDataDir } from './config/index.js';
import { activityTracker } from './utils/activityTracker.js';
import { getActiveHeadlessPids } from './utils/chromeBrowser.js';
import { getWhatsAppBrowserPid } from './whatsappClient.js';
import { toLocalSqlDateTime } from './utils/localTime.js';

const execAsync = promisify(exec);

export type ProfileMatchType = 'pharmarack_profile' | '.wwebjs_auth' | 'temp' | 'other';

export interface ChromiumProcCensus {
  pid: number;
  name: 'chrome.exe' | 'msedge.exe';
  rssKB: number;
  profileMatch: ProfileMatchType;
  protected: boolean;
  commandLine?: string;
}

export interface HealthTick {
  ts: string;
  freeMB: number;
  totalMB: number;
  backendRssMB: number;
  backendHeapMB: number;
  eventLagMs: number;
  cpuDeltaPct: number;
  chrome: {
    zombieMB: number;
    zombieCount: number;
    activeCount: number;
    list: ChromiumProcCensus[];
  };
}

// ── In-Memory Ring Buffer (last 120 ticks = 60 min at 30s cadence) ───────────
const RING_BUFFER_CAP = 120;
const tickHistory: HealthTick[] = [];
let latestTick: HealthTick | null = null;

// ── Boot Milestone Performance Registry ──────────────────────────────────────
const bootMilestones: Record<string, number> = {};

export function recordBootMilestone(name: string, ms: number): void {
  bootMilestones[name] = Math.round(ms);
}

export function getBootMilestones(): Record<string, number> {
  return { ...bootMilestones };
}

// ── Pure Helpers for Command Line Classification ─────────────────────────────

export function classifyChromiumCommandLine(cmdLine: string): ProfileMatchType {
  if (!cmdLine) return 'other';
  const lower = cmdLine.toLowerCase();
  if (lower.includes('pharmarack_profile_temp_')) return 'temp';
  if (lower.includes('pharmarack_profile')) return 'pharmarack_profile';
  if (lower.includes('.wwebjs_auth')) return '.wwebjs_auth';
  return 'other';
}

// ── Windows Process Census via Win32_Process ─────────────────────────────────

let isCensusRunning = false;

export async function runCensusQuery(): Promise<{
  zombieMB: number;
  zombieCount: number;
  activeCount: number;
  list: ChromiumProcCensus[];
}> {
  if (process.platform !== 'win32') {
    return { zombieMB: 0, zombieCount: 0, activeCount: 0, list: [] };
  }

  const protectedPids = getActiveHeadlessPids();
  try {
    const waPid = getWhatsAppBrowserPid();
    if (waPid && waPid > 0) protectedPids.add(waPid);
  } catch (_) {}

  try {
    // Single PowerShell CIM query extracting PID, WorkingSetSize, and CommandLine
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"(name='chrome.exe' or name='msedge.exe')\\" | Select-Object ProcessId, WorkingSetSize, CommandLine | ConvertTo-Json -Compress"`,
      { timeout: 3500 }
    ).catch(() => ({ stdout: '' }));

    const trimmed = (stdout || '').trim();
    if (!trimmed) {
      return { zombieMB: 0, zombieCount: 0, activeCount: 0, list: [] };
    }

    let parsed: any[];
    try {
      const data = JSON.parse(trimmed);
      parsed = Array.isArray(data) ? data : [data];
    } catch {
      return { zombieMB: 0, zombieCount: 0, activeCount: 0, list: [] };
    }

    const list: ChromiumProcCensus[] = [];
    let zombieCount = 0;
    let zombieBytes = 0;
    let activeCount = 0;

    for (const item of parsed) {
      const pid = Number(item.ProcessId);
      if (!pid || isNaN(pid)) continue;

      const workingSet = Number(item.WorkingSetSize) || 0;
      const rssKB = Math.round(workingSet / 1024);
      const cmdLine = String(item.CommandLine || '');
      const profileMatch = classifyChromiumCommandLine(cmdLine);
      const isProtected = protectedPids.has(pid);

      list.push({
        pid,
        name: 'chrome.exe',
        rssKB,
        profileMatch,
        protected: isProtected,
        commandLine: cmdLine.length > 200 ? cmdLine.slice(0, 200) + '...' : cmdLine,
      });

      if (profileMatch !== 'other') {
        if (!isProtected) {
          zombieCount++;
          zombieBytes += workingSet;
        } else {
          activeCount++;
        }
      }
    }

    return {
      zombieMB: Math.round(zombieBytes / (1024 * 1024)),
      zombieCount,
      activeCount,
      list,
    };
  } catch (err: any) {
    console.warn('[SystemHealthMonitor] Census query warning:', err?.message || err);
    return { zombieMB: 0, zombieCount: 0, activeCount: 0, list: [] };
  }
}

// ── JSONL Logging, Rotation & Pruning ─────────────────────────────────────────

export function rotateHealthLogs(dataDir: string, logPath: string): void {
  try {
    const path3 = path.join(dataDir, 'system-health.jsonl.3');
    const path2 = path.join(dataDir, 'system-health.jsonl.2');
    const path1 = path.join(dataDir, 'system-health.jsonl.1');

    if (fs.existsSync(path2)) {
      if (fs.existsSync(path3)) fs.unlinkSync(path3);
      fs.renameSync(path2, path3);
    }
    if (fs.existsSync(path1)) {
      fs.renameSync(path1, path2);
    }
    if (fs.existsSync(logPath)) {
      fs.renameSync(logPath, path1);
    }
  } catch (err: any) {
    console.warn('[SystemHealthMonitor] Error rotating health logs:', err?.message || err);
  }
}

export function pruneOldHealthLogs(dataDir: string): void {
  try {
    if (!fs.existsSync(dataDir)) return;
    const now = Date.now();
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(dataDir);
    for (const f of files) {
      if (f.startsWith('system-health.jsonl')) {
        const fullPath = path.join(dataDir, f);
        const st = fs.statSync(fullPath);
        if (now - st.mtimeMs > FOURTEEN_DAYS_MS) {
          fs.unlinkSync(fullPath);
          console.log(`[SystemHealthMonitor] Pruned old health log: ${f}`);
        }
      }
    }
  } catch (_) {}
}

function appendHealthLog(tick: HealthTick): void {
  try {
    const dataDir = path.resolve(getAppDataDir(), 'data', 'logs');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const logPath = path.join(dataDir, 'system-health.jsonl');

    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      // Rotate if > 2 MB
      if (stats.size >= 2 * 1024 * 1024) {
        rotateHealthLogs(dataDir, logPath);
      }
    }

    fs.appendFileSync(logPath, JSON.stringify(tick) + '\n', 'utf8');
  } catch (err: any) {
    console.warn('[SystemHealthMonitor] Failed to write health log:', err?.message || err);
  }
}

// ── Resource Measurement Helpers ─────────────────────────────────────────────

let lastCpuUsage = process.cpuUsage();
let lastCpuTime = performance.now();

function getCpuDeltaPct(): number {
  const elapsedMs = performance.now() - lastCpuTime;
  if (elapsedMs <= 0) return 0;
  const delta = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  lastCpuTime = performance.now();
  const totalCpuMs = (delta.user + delta.system) / 1000;
  const numCpus = os.cpus().length || 4;
  const pct = Math.round((totalCpuMs / (elapsedMs * numCpus)) * 100);
  return Math.min(100, Math.max(0, pct));
}

let lastLagMs = 0;
function measureEventLag(): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    setImmediate(() => {
      lastLagMs = Math.max(0, Math.round(performance.now() - start));
      resolve(lastLagMs);
    });
  });
}

// ── Memory Pressure Guard (Phase B.2 Ladder) ──────────────────────────────────

let consecutiveLowMemoryTicks = 0;
let lastPressureAlertAt = 0;

export async function evaluateMemoryPressure(freeMB: number, zombieMB: number): Promise<boolean> {
  if (freeMB < 800 && zombieMB > 400) {
    consecutiveLowMemoryTicks++;
  } else {
    consecutiveLowMemoryTicks = 0;
    return false;
  }

  if (consecutiveLowMemoryTicks >= 3) {
    consecutiveLowMemoryTicks = 0;
    const now = Date.now();
    if (now - lastPressureAlertAt > 30 * 60 * 1000) {
      lastPressureAlertAt = now;
      console.warn(`[SystemHealthMonitor] Sustained memory pressure: ${freeMB} MB free, ${zombieMB} MB zombies.`);
      try {
        const { reapSystemProfileOrphans } = await import('./utils/chromeBrowser.js');
        const reapResult = await reapSystemProfileOrphans();
        const { eventService } = await import('./services/eventService.js');
        eventService.broadcast('toast', {
          message: `System memory low (${freeMB} MB free). Reclaimed ${reapResult.freedMB} MB from idle background processes.`,
          type: 'info',
        });
        return true;
      } catch (err: any) {
        console.error('[SystemHealthMonitor] Error during memory pressure response:', err?.message || err);
      }
    }
  }
  return false;
}

// ── Main Monitor Loop ────────────────────────────────────────────────────────

let monitorInterval: NodeJS.Timeout | null = null;
let tickCount = 0;

async function runHealthTick(): Promise<void> {
  tickCount++;
  const eventLagMs = await measureEventLag();
  const cpuDeltaPct = getCpuDeltaPct();
  const mem = process.memoryUsage();
  const freeMB = Math.round(os.freemem() / (1024 * 1024));
  const totalMB = Math.round(os.totalmem() / (1024 * 1024));
  const backendRssMB = Math.round(mem.rss / (1024 * 1024));
  const backendHeapMB = Math.round(mem.heapUsed / (1024 * 1024));

  // If idle, stretch census to run on every 2nd tick (every 60s) to keep CPU < 0.1%
  const isAppIdle = activityTracker.isIdle(5 * 60 * 1000);
  let chromeCensus = { zombieMB: 0, zombieCount: 0, activeCount: 0, list: [] as ChromiumProcCensus[] };

  if (!isCensusRunning) {
    if (!isAppIdle || tickCount % 2 === 0) {
      isCensusRunning = true;
      try {
        chromeCensus = await runCensusQuery();
      } finally {
        isCensusRunning = false;
      }
    } else if (latestTick) {
      // Reuse previous census on skipped idle ticks
      chromeCensus = latestTick.chrome;
    }
  }

  const tick: HealthTick = {
    ts: toLocalSqlDateTime(new Date()),
    freeMB,
    totalMB,
    backendRssMB,
    backendHeapMB,
    eventLagMs,
    cpuDeltaPct,
    chrome: chromeCensus,
  };

  latestTick = tick;
  tickHistory.push(tick);
  if (tickHistory.length > RING_BUFFER_CAP) {
    tickHistory.shift();
  }

  // Persist to rotational JSONL log
  appendHealthLog(tick);

  // Evaluate memory pressure ladder
  void evaluateMemoryPressure(freeMB, chromeCensus.zombieMB);
}

/**
 * Start the system health monitor.
 * Registered in server.ts at T+90s (never stops entirely; idle hours are exactly
 * when lane jobs/backups run and when freezes happen).
 */
export function startSystemHealthMonitor(): void {
  if (monitorInterval) return;

  // Prune any logs > 14 days old on startup
  try {
    const dataDir = path.resolve(getAppDataDir(), 'data', 'logs');
    pruneOldHealthLogs(dataDir);
  } catch (_) {}

  // Initial immediate sample
  runHealthTick().catch(() => {});

  // 30s cadence
  monitorInterval = setInterval(() => {
    runHealthTick().catch(err => {
      console.warn('[SystemHealthMonitor] Tick execution error:', err?.message || err);
    });
  }, 30_000);

  console.log('[SystemHealthMonitor] Started 30s telemetry tick loop.');
}

export function stopSystemHealthMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

export function getLiveHealthSnapshot(): {
  snapshot: HealthTick | null;
  history: HealthTick[];
  bootPerf: Record<string, number>;
} {
  return {
    snapshot: latestTick,
    history: [...tickHistory],
    bootPerf: getBootMilestones(),
  };
}
