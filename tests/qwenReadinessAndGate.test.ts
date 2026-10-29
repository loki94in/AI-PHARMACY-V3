import { describe, it, expect, beforeEach } from '@jest/globals';
import { qwenReadinessService } from '../src/services/localAi/qwenReadinessService.js';
import { aiAutomationGate } from '../src/services/localAi/aiAutomationGate.js';

describe('Qwen Readiness Service & AI Automation Gate', () => {
  beforeEach(() => {
    qwenReadinessService.invalidateCache();
  });

  it('reports evaluated state properly', async () => {
    const status = await qwenReadinessService.getStatus();
    expect(status).toHaveProperty('state');
    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('installed');
    expect(status).toHaveProperty('automationGate');
    expect(['UNKNOWN', 'DISABLED', 'NOT_INSTALLED', 'STARTING', 'READY', 'BUSY', 'DEGRADED', 'OFFLINE', 'ERROR']).toContain(status.state);
  });

  it('preserves single-flight probe execution for concurrent calls', async () => {
    const p1 = qwenReadinessService.getStatus(true);
    const p2 = qwenReadinessService.getStatus(false);
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1.state).toBe(s2.state);
    expect(s1.port).toBe(s2.port);
  });

  it('correctly manages AI Automation Gate status', async () => {
    const gateStatus = await aiAutomationGate.getStatus();
    expect(['open', 'paused', 'blocked']).toContain(gateStatus.gate);
    expect(typeof gateStatus.isPausedByUser).toBe('boolean');
    expect(typeof gateStatus.qwenReady).toBe('boolean');
  });

  it('allows Class C (independent) tasks to run regardless of AI gate state', async () => {
    let executed = false;
    const res = await aiAutomationGate.executeWithGate({
      taskName: 'POS Billing Calculation',
      classType: 'CLASS_C_INDEPENDENT',
      runAi: async () => {
        executed = true;
        return { total: 450 };
      }
    });

    expect(res.success).toBe(true);
    expect(res.executed).toBe(true);
    expect(executed).toBe(true);
    expect(res.result).toEqual({ total: 450 });
  });

  it('gracefully degrades Class B (optional) tasks when AI is not available', async () => {
    const res = await aiAutomationGate.executeWithGate({
      taskName: 'Refill Optional Tone Enrichment',
      classType: 'CLASS_B_OPTIONAL',
      runAi: async () => {
        return 'AI enriched text';
      },
      runFallback: async (reason) => {
        return `Deterministic template (skipped AI: ${reason})`;
      }
    });

    expect(res.success).toBe(true);
    expect(typeof res.result).toBe('string');
  });

  it('supports explicit pause and resume in automation gate', async () => {
    await aiAutomationGate.setPaused(true, 'Test operator pause');
    const pausedStatus = await aiAutomationGate.getStatus();
    expect(pausedStatus.gate).toBe('paused');
    expect(pausedStatus.isPausedByUser).toBe(true);

    // Class A should block
    const classARes = await aiAutomationGate.executeWithGate({
      taskName: 'Strict AI Intent Parsing',
      classType: 'CLASS_A_DEPENDENT',
      runAi: async () => 'Should not run'
    });
    expect(classARes.executed).toBe(false);
    expect(classARes.gateState).toBe('paused');

    // Resume
    await aiAutomationGate.setPaused(false);
    const resumedStatus = await aiAutomationGate.getStatus();
    expect(resumedStatus.isPausedByUser).toBe(false);
  });
});
