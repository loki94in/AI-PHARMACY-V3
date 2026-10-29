/**
 * AI Automation Gate
 * Central gate for AI-dependent work across background schedulers and operational tasks.
 * Enforces Class A/B/C classification and persistent manual pause in SQLite app_settings.
 */

import { qwenReadinessService } from './qwenReadinessService.js';
import { dbManager } from '../../database/connection.js';
import { eventService } from '../eventService.js';

export type AutomationClass =
  | 'CLASS_A_DEPENDENT'  // Strictly requires Qwen (intent parsing, AI summaries)
  | 'CLASS_B_OPTIONAL'   // Core deterministic logic runs, AI enrichment optional
  | 'CLASS_C_INDEPENDENT'; // Normal pharmacy flows (POS, stock, queue delivery)

export interface GateExecutionResult<T> {
  success: boolean;
  executed: boolean;
  classType: AutomationClass;
  result?: T;
  skippedReason?: string;
  gateState: 'open' | 'paused' | 'blocked';
}

export interface AiGateStatus {
  gate: 'open' | 'paused' | 'blocked';
  isPausedByUser: boolean;
  pauseReason: string | null;
  qwenReady: boolean;
  qwenState: string;
}

export class AiAutomationGate {
  private isPausedCache: boolean | null = null;
  private pauseReason: string | null = null;

  /**
   * Initializes or loads gate pause setting from SQLite.
   */
  public async isPaused(): Promise<boolean> {
    if (this.isPausedCache !== null) {
      return this.isPausedCache;
    }

    try {
      const db = await dbManager.getConnection();
      const row = await db.get<{ value: string }>(
        `SELECT value FROM app_settings WHERE key = 'ai_automation_paused'`
      );
      this.isPausedCache = row ? row.value === 'true' : false;
    } catch {
      this.isPausedCache = false;
    }

    return this.isPausedCache;
  }

  /**
   * Toggles manual pause for AI-dependent automations.
   * Persisted safely in app_settings table.
   */
  public async setPaused(paused: boolean, reason = 'Manual operator control'): Promise<void> {
    this.isPausedCache = paused;
    this.pauseReason = paused ? reason : null;

    try {
      const db = await dbManager.getConnection();
      await db.run(
        `INSERT INTO app_settings (key, value) VALUES ('ai_automation_paused', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [paused ? 'true' : 'false']
      );
    } catch (err) {
      console.warn('[AI Automation Gate] Failed to persist pause state:', err);
    }

    eventService.broadcast('ai_gate_status_changed', await this.getStatus());
  }

  /**
   * Returns current gate status and effective gate state:
   * - 'open': Qwen is ready and not paused by user
   * - 'paused': Explicitly paused by operator
   * - 'blocked': Qwen is offline/degraded/starting
   */
  public async getStatus(): Promise<AiGateStatus> {
    const isPausedByUser = await this.isPaused();
    const qwenReady = qwenReadinessService.isReady();
    const qwenState = qwenReadinessService.getState();

    let gate: 'open' | 'paused' | 'blocked' = 'open';
    if (isPausedByUser) {
      gate = 'paused';
    } else if (!qwenReady) {
      gate = 'blocked';
    }

    return {
      gate,
      isPausedByUser,
      pauseReason: this.pauseReason,
      qwenReady,
      qwenState
    };
  }

  /**
   * Safe execution wrapper for tasks requiring AI gating.
   */
  public async executeWithGate<T>(options: {
    taskName: string;
    classType: AutomationClass;
    runAi: () => Promise<T>;
    runFallback?: (reason: string) => Promise<T>;
  }): Promise<GateExecutionResult<T>> {
    const { taskName, classType, runAi, runFallback } = options;

    // CLASS C: Independent tasks bypass the AI gate completely
    if (classType === 'CLASS_C_INDEPENDENT') {
      try {
        const result = await runAi();
        return { success: true, executed: true, classType, result, gateState: 'open' };
      } catch (err: any) {
        return { success: false, executed: false, classType, skippedReason: err.message, gateState: 'open' };
      }
    }

    const status = await this.getStatus();

    // Check manual pause
    if (status.isPausedByUser) {
      const reason = `Task '${taskName}' paused: AI automation manually paused (${this.pauseReason || 'Operator paused'}).`;
      if (classType === 'CLASS_B_OPTIONAL' && runFallback) {
        const result = await runFallback(reason);
        return { success: true, executed: false, classType, result, skippedReason: reason, gateState: 'paused' };
      }
      return { success: false, executed: false, classType, skippedReason: reason, gateState: 'paused' };
    }

    // Check Qwen runtime readiness
    if (!status.qwenReady) {
      const reason = `Task '${taskName}' deferred: Qwen runtime is currently ${status.qwenState}.`;
      if (classType === 'CLASS_B_OPTIONAL' && runFallback) {
        const result = await runFallback(reason);
        return { success: true, executed: false, classType, result, skippedReason: reason, gateState: 'blocked' };
      }
      return { success: false, executed: false, classType, skippedReason: reason, gateState: 'blocked' };
    }

    // Gate is OPEN: execute the AI operation
    try {
      const result = await runAi();
      return { success: true, executed: true, classType, result, gateState: 'open' };
    } catch (err: any) {
      if (classType === 'CLASS_B_OPTIONAL' && runFallback) {
        const result = await runFallback(err.message);
        return { success: true, executed: false, classType, result, skippedReason: err.message, gateState: 'open' };
      }
      return { success: false, executed: false, classType, skippedReason: err.message, gateState: 'open' };
    }
  }
}

export const aiAutomationGate = new AiAutomationGate();
