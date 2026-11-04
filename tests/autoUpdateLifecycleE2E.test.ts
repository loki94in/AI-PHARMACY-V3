import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import {
  saveSessionCheckpoint,
  getSessionCheckpoint,
  markCheckpointResumed,
  type SessionCheckpoint
} from '../src/services/sessionCheckpointService.js';
import { autoUpdateService, compareVersions, getStagingDir } from '../src/services/autoUpdateService.js';
import { APP_VERSION } from '../src/services/licenseService.js';
import { normalizeUpdateFrame, type UpdateStatus, type RawUpdateFrame } from '../frontend/src/services/updateStatusStore.js';

describe('Auto-Update E2E Lifecycle & Crash Resilience Suite', () => {
  const dataDir = path.join(process.cwd(), 'data');
  const checkpointPath = path.join(dataDir, 'session_checkpoint.json');
  let originalCheckpoint: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(checkpointPath)) {
      originalCheckpoint = fs.readFileSync(checkpointPath, 'utf8');
    }
  });

  afterEach(() => {
    if (originalCheckpoint !== null) {
      fs.writeFileSync(checkpointPath, originalCheckpoint, 'utf8');
    } else if (fs.existsSync(checkpointPath)) {
      try { fs.unlinkSync(checkpointPath); } catch (_) {}
    }
  });

  describe('1. Session Checkpoint & Restoration Flow (Zero Data Loss)', () => {
    it('saves active route and target version atomically', () => {
      saveSessionCheckpoint({
        route: '/pos?bill=active',
        targetVersion: '0.1.209',
        previousVersion: APP_VERSION,
        timestamp: Date.now(),
        resumed: false,
      });

      const checkpoint = getSessionCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.route).toBe('/pos?bill=active');
      expect(checkpoint?.targetVersion).toBe('0.1.209');
      expect(checkpoint?.resumed).toBe(false);
    });

    it('marks checkpoint as resumed after successful post-update boot', () => {
      saveSessionCheckpoint({
        route: '/inventory',
        targetVersion: '0.1.209',
        resumed: false,
      });

      markCheckpointResumed();
      const checkpoint = getSessionCheckpoint();
      expect(checkpoint?.resumed).toBe(true);
    });

    it('ignores expired checkpoints older than 1 hour to prevent stale route traps', () => {
      const ancientTime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
      saveSessionCheckpoint({
        route: '/reports',
        timestamp: ancientTime,
        resumed: false,
      });

      const checkpoint = getSessionCheckpoint();
      expect(checkpoint).toBeNull();
    });
  });

  describe('2. Safety Gates & Crash Prevention during Apply Update', () => {
    it('safely rejects applyUpdate if no pending update was staged', async () => {
      (autoUpdateService as any).lastResult = null;
      await expect(autoUpdateService.applyUpdate()).rejects.toThrow('No pending update found.');
    });

    it('blocks downgrades and same-version re-installs before any process shutdown', async () => {
      (autoUpdateService as any).lastResult = { latestVersion: APP_VERSION };
      await expect(autoUpdateService.applyUpdate()).rejects.toThrow();
    });

    it('handles failure.json cleanly on boot without crashing', async () => {
      const stagingDir = getStagingDir();
      if (!fs.existsSync(stagingDir)) {
        fs.mkdirSync(stagingDir, { recursive: true });
      }
      const failurePath = path.join(stagingDir, 'failure.json');
      fs.writeFileSync(failurePath, JSON.stringify({ version: '0.1.209', error: 'SIMULATED_TEST_ROLLBACK' }), 'utf8');

      const result = await autoUpdateService.checkFailedUpdate();
      expect(result).toContain('SIMULATED_TEST_ROLLBACK');
      expect(fs.existsSync(failurePath)).toBe(false); // Flag must be cleanly consumed
    });
  });

  describe('3. Frontend State Machine & Transition Invariants', () => {
    const baseStatus: UpdateStatus = {
      version: null,
      currentVersion: APP_VERSION,
      state: 'idle',
      percent: 0,
      downloadedMB: 0,
      totalMB: 0,
      changelog: '',
      hasUpdate: false,
      isInstalling: false,
    };

    it('transitions smoothly from downloading to ready without state flickers', () => {
      const downloadingFrame: RawUpdateFrame = {
        latestVersion: '99.0.0',
        currentVersion: APP_VERSION,
        hasUpdate: true,
        downloading: true,
        readyToInstall: false,
        downloadProgress: 65,
        downloadedBytes: 15 * 1048576,
        totalBytes: 23 * 1048576,
      };

      const s1 = normalizeUpdateFrame(downloadingFrame, baseStatus);
      expect(s1.state).toBe('downloading');
      expect(s1.percent).toBe(65);
      expect(s1.downloadedMB).toBe(15);
      expect(s1.totalMB).toBe(23);

      const readyFrame: RawUpdateFrame = {
        latestVersion: '99.0.0',
        currentVersion: APP_VERSION,
        hasUpdate: true,
        downloading: false,
        readyToInstall: true,
        downloadProgress: 100,
      };

      const s2 = normalizeUpdateFrame(readyFrame, s1);
      expect(s2.state).toBe('ready');
      expect(s2.percent).toBe(100);
      expect(s2.hasUpdate).toBe(true);
    });

    it('never accepts an older version than running APP_VERSION', () => {
      const staleFrame: RawUpdateFrame = {
        latestVersion: '0.0.1',
        currentVersion: APP_VERSION,
        hasUpdate: true,
      };

      const result = normalizeUpdateFrame(staleFrame, baseStatus);
      expect(result.hasUpdate).toBe(false);
      expect(result.state).toBe('idle');
    });
  });
});
