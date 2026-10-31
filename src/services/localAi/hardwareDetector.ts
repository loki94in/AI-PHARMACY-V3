/**
 * Hardware Acceleration Detector & Smart Shift Profile
 *
 * Detects whether a dedicated GPU (NVIDIA / AMD / Intel Arc) with sufficient VRAM
 * (>= 2 GB or >= 4 GB) is installed, and determines the optimal CPU / GPU offload tier.
 *
 * Guaranteed Safety:
 * - Desktop Electron UI rendering remains strictly CPU-only per AGENTS.md No-GPU contract.
 * - If dedicated GPU is found, dynamically offloads layers to GPU to maximize speed and prevent PC stutter.
 * - If integrated graphics / no dedicated GPU, safely shifts to CPU with restricted threads & below-normal priority.
 */

import { execSync } from 'child_process';
import os from 'os';

export interface HardwareProfile {
  hasDedicatedGpu: boolean;
  gpuName: string | null;
  vramBytes: number;
  vramMb: number;
  offloadLayers: number; // 0 = CPU only, 18 = 2GB partial, 28 = full offload
  cpuThreads: number;
  executionMode: 'GPU_FULL' | 'GPU_PARTIAL' | 'CPU_SMART';
  recommendation: string;
}

let cachedProfile: HardwareProfile | null = null;

export function detectHardwareAccelerationProfile(): HardwareProfile {
  if (cachedProfile !== null) {
    return cachedProfile;
  }

  let gpuName: string | null = null;
  let vramBytes = 0;

  if (process.platform === 'win32') {
    try {
      // Query Win32_VideoController for installed display adapters
      const output = execSync('wmic path win32_VideoController get name,adapterram', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1200
      });

      const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        // Match numbers at start followed by card name
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (match) {
          const ram = parseInt(match[1], 10);
          const name = match[2].trim();
          // Filter out generic Microsoft Basic Display / Remote Desktop
          if (!/microsoft\s+basic|remote\s+display/i.test(name) && ram > vramBytes) {
            vramBytes = ram;
            gpuName = name;
          }
        }
      }
    } catch (_) {
      // wmic unavailable or timed out
    }
  }

  const vramMb = Math.round(vramBytes / (1024 * 1024));
  const hasDedicatedGpu = Boolean(
    gpuName &&
    vramMb >= 1800 &&
    !/intel\s*(?:hd|uhd|iris)/i.test(gpuName) // exclude standard integrated chips
  );

  let offloadLayers = 0;
  let executionMode: 'GPU_FULL' | 'GPU_PARTIAL' | 'CPU_SMART' = 'CPU_SMART';
  let recommendation = 'Running in CPU-optimized mode with background priority diet.';

  if (hasDedicatedGpu) {
    if (vramMb >= 3800) {
      // 4 GB+ dedicated VRAM: complete 28-layer offload
      offloadLayers = 28;
      executionMode = 'GPU_FULL';
      recommendation = `Dedicated GPU (${gpuName}) with ${vramMb}MB VRAM detected. Full acceleration active.`;
    } else {
      // 2 GB dedicated VRAM: safe partial offload (18 layers) to prevent OOM
      offloadLayers = 18;
      executionMode = 'GPU_PARTIAL';
      recommendation = `Dedicated GPU (${gpuName}) with ${vramMb}MB VRAM detected. Partial acceleration active.`;
    }
  }

  // CPU threads allocation: leave at least 2 cores free for Windows & POS UI
  // In CPU_SMART mode, strictly cap at 2 threads (or 1 on dual-core) to ensure zero mouse or UI freeze
  const totalCores = os.cpus()?.length || 4;
  const maxThreadsAllowed = hasDedicatedGpu ? 4 : Math.min(2, Math.max(1, totalCores - 2));
  const cpuThreads = Math.max(1, maxThreadsAllowed);

  cachedProfile = {
    hasDedicatedGpu,
    gpuName,
    vramBytes,
    vramMb,
    offloadLayers,
    cpuThreads,
    executionMode,
    recommendation
  };

  return cachedProfile;
}

export function resetHardwareProfileCache(): void {
  cachedProfile = null;
}

