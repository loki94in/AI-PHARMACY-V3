#!/usr/bin/env node
/**
 * scripts/predev-clean.mjs
 * 
 * Auto-clears leftover or orphaned Node.js processes holding dev ports (5173, 5174)
 * before starting `npm run dev`. This prevents "Port 5173 is already in use" crashes.
 */

import { execSync } from 'child_process';
import process from 'process';

const TARGET_PORTS = [5173, 5174];

function getProcessesUsingPortWin32(port) {
  try {
    const stdout = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pids = new Set();
    const lines = stdout.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes('LISTENING')) continue;
      const parts = trimmed.split(/\s+/);
      const pidStr = parts[parts.length - 1];
      const pid = parseInt(pidStr, 10);
      if (pid && pid !== process.pid && pid !== process.ppid) {
        pids.add(pid);
      }
    }
    return Array.from(pids);
  } catch {
    return [];
  }
}

function getProcessesUsingPortUnix(port) {
  try {
    const stdout = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return stdout
      .split('\n')
      .map(p => parseInt(p.trim(), 10))
      .filter(p => p && p !== process.pid && p !== process.ppid);
  } catch {
    return [];
  }
}

function isSafeToKill(pid) {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const lower = out.toLowerCase();
      // Only kill node or tsx or electron holding dev ports
      return lower.includes('node.exe') || lower.includes('electron.exe');
    } catch {
      return false;
    }
  }
  return true;
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch {
    return false;
  }
}

function cleanPorts() {
  let clearedCount = 0;
  for (const port of TARGET_PORTS) {
    const pids = process.platform === 'win32'
      ? getProcessesUsingPortWin32(port)
      : getProcessesUsingPortUnix(port);

    for (const pid of pids) {
      if (isSafeToKill(pid)) {
        if (killPid(pid)) {
          console.log(`[PreDev] Cleared leftover process (PID: ${pid}) holding port ${port}`);
          clearedCount++;
        }
      }
    }
  }
  if (clearedCount > 0) {
    console.log(`[PreDev] Ports ${TARGET_PORTS.join(', ')} are clean and ready.`);
  }
}

try {
  cleanPorts();
} catch (e) {
  // Never block startup if cleanup encounters an edge case
}

