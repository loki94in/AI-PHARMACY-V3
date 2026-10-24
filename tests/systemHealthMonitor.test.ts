import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  classifyChromiumCommandLine,
  evaluateMemoryPressure,
  rotateHealthLogs,
  recordBootMilestone,
  getBootMilestones
} from '../src/systemHealthMonitor.js';

describe('System Health Monitor (P2-105)', () => {
  describe('classifyChromiumCommandLine', () => {
    test('classifies pharmarack_profile correctly', () => {
      const cmd = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\Users\\User\\AppData\\Local\\AI Pharmacy OS\\data\\pharmarack_profile" --headless';
      expect(classifyChromiumCommandLine(cmd)).toBe('pharmarack_profile');
    });

    test('classifies temporary profile as temp', () => {
      const cmd = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\Users\\User\\AppData\\Local\\AI Pharmacy OS\\data\\pharmarack_profile_temp_1729700000_123456" --headless';
      expect(classifyChromiumCommandLine(cmd)).toBe('temp');
    });

    test('classifies WhatsApp auth directory as .wwebjs_auth', () => {
      const cmd = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\Users\\User\\AppData\\Local\\AI Pharmacy OS\\.wwebjs_auth\\session"';
      expect(classifyChromiumCommandLine(cmd)).toBe('.wwebjs_auth');
    });

    test('classifies unrelated personal chrome instances as other', () => {
      const cmd = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --profile-directory="Default" https://youtube.com';
      expect(classifyChromiumCommandLine(cmd)).toBe('other');
    });

    test('handles empty or missing command lines safely', () => {
      expect(classifyChromiumCommandLine('')).toBe('other');
      expect(classifyChromiumCommandLine(null as any)).toBe('other');
      expect(classifyChromiumCommandLine(undefined as any)).toBe('other');
    });
  });

  describe('Boot Milestones Telemetry', () => {
    test('records and retrieves boot performance milestones accurately', () => {
      recordBootMilestone('schemaMs', 42);
      recordBootMilestone('phase2Ms', 115);
      recordBootMilestone('firstHeartbeatMs', 290);

      const milestones = getBootMilestones();
      expect(milestones.schemaMs).toBe(42);
      expect(milestones.phase2Ms).toBe(115);
      expect(milestones.firstHeartbeatMs).toBe(290);
    });
  });

  describe('evaluateMemoryPressure Ladder', () => {
    test('triggers memory pressure only after 3 consecutive low-memory ticks with high zombies', async () => {
      // Tick 1: low RAM & high zombies -> counter 1, returns false
      const tick1 = await evaluateMemoryPressure(700, 500);
      expect(tick1).toBe(false);

      // Tick 2: low RAM & high zombies -> counter 2, returns false
      const tick2 = await evaluateMemoryPressure(650, 520);
      expect(tick2).toBe(false);

      // Tick 3: sustained low RAM -> counter 3, triggers reap/alert ladder
      const tick3 = await evaluateMemoryPressure(600, 550);
      expect(tick3).toBe(true);

      // Subsequent tick with normal RAM resets counter
      const tick4 = await evaluateMemoryPressure(2500, 100);
      expect(tick4).toBe(false);
    });

    test('resets consecutive low-memory counter when RAM recovers above 800MB', async () => {
      // 2 low ticks
      await evaluateMemoryPressure(600, 600);
      await evaluateMemoryPressure(600, 600);

      // Recovery tick
      const recovery = await evaluateMemoryPressure(1200, 200);
      expect(recovery).toBe(false);

      // Next low tick should start back at 1, not trigger
      const nextLow = await evaluateMemoryPressure(600, 600);
      expect(nextLow).toBe(false);
    });
  });

  describe('rotateHealthLogs Retention', () => {
    const testDir = path.join(os.tmpdir(), `health-monitor-test-${Date.now()}`);
    const logPath = path.join(testDir, 'system-health.jsonl');

    beforeEach(() => {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(logPath, '{"tick": 0}\n', 'utf8');
    });

    afterEach(() => {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch (_) {}
    });

    test('rotates .jsonl through .1, .2, and .3 cleanly without data loss', () => {
      // Rotation 1
      rotateHealthLogs(testDir, logPath);
      expect(fs.existsSync(path.join(testDir, 'system-health.jsonl.1'))).toBe(true);
      expect(fs.existsSync(logPath)).toBe(false);

      // Create new active log
      fs.writeFileSync(logPath, '{"tick": 1}\n', 'utf8');

      // Rotation 2
      rotateHealthLogs(testDir, logPath);
      expect(fs.existsSync(path.join(testDir, 'system-health.jsonl.2'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'system-health.jsonl.1'))).toBe(true);

      // Create new active log
      fs.writeFileSync(logPath, '{"tick": 2}\n', 'utf8');

      // Rotation 3
      rotateHealthLogs(testDir, logPath);
      expect(fs.existsSync(path.join(testDir, 'system-health.jsonl.3'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'system-health.jsonl.2'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'system-health.jsonl.1'))).toBe(true);
    });
  });
});
