/**
 * Qwen Readiness Service
 * Implements a strict 5-level health monitor and 9-state machine for the local Qwen runtime.
 * Provides single-flight probe execution, stale-state expiry, and non-blocking status caching.
 */

import {
  isLocalAiEnabled,
  getLocalAiConfig,
  getLocalAiBaseUrl,
  queryLocalAiChat
} from './llamaServerClient.js';
import { validateLocalAiAssets } from './localAiAssetValidator.js';
import { eventService } from '../eventService.js';

export type QwenReadinessState =
  | 'UNKNOWN'
  | 'DISABLED'
  | 'NOT_INSTALLED'
  | 'STARTING'
  | 'READY'
  | 'BUSY'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'ERROR';

export interface QwenDetailedStatus {
  state: QwenReadinessState;
  enabled: boolean;
  installed: boolean;
  runtimeRunning: boolean;
  runtimeHealthy: boolean;
  inferenceReady: boolean;
  modelName: string;
  runtimeName: string;
  port: number;
  lastCheckedAt: string | null;
  lastSuccessfulInferenceAt: string | null;
  latencyMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  automationGate: 'open' | 'paused' | 'blocked';
}

export class QwenReadinessService {
  private currentState: QwenReadinessState = 'UNKNOWN';
  private lastCheckedAt: Date | null = null;
  private lastSuccessfulInferenceAt: Date | null = null;
  private lastLatencyMs = 0;
  private lastErrorCode: string | null = null;
  private lastErrorMessage: string | null = null;

  // Single-flight probe mutex
  private activeProbePromise: Promise<QwenDetailedStatus> | null = null;

  // Cache TTL: 45 seconds so frequent UI pollings do not trigger repeated inferences on CPU
  private readonly CACHE_TTL_MS = 45000;

  /**
   * Retrieves the current readiness status.
   * Uses cached status if fresh (<45s), otherwise triggers a single-flight probe.
   */
  public async getStatus(forceRefresh = false): Promise<QwenDetailedStatus> {
    const isStale =
      !this.lastCheckedAt ||
      Date.now() - this.lastCheckedAt.getTime() > this.CACHE_TTL_MS;

    if (!forceRefresh && !isStale && this.currentState !== 'UNKNOWN') {
      return this.buildStatusPayload();
    }

    if (this.activeProbePromise) {
      return this.activeProbePromise;
    }

    this.activeProbePromise = this.executeProbe()
      .finally(() => {
        this.activeProbePromise = null;
      });

    return this.activeProbePromise;
  }

  /**
   * Executes a bounded 5-level health evaluation.
   */
  private async executeProbe(): Promise<QwenDetailedStatus> {
    const previousState = this.currentState;
    this.lastCheckedAt = new Date();
    this.lastErrorCode = null;
    this.lastErrorMessage = null;

    // LEVEL 1: CONFIGURATION
    const enabled = isLocalAiEnabled();
    if (!enabled) {
      this.currentState = 'DISABLED';
      this.lastErrorMessage = 'Local AI is disabled by application configuration.';
      this.notifyIfStateChanged(previousState);
      return this.buildStatusPayload();
    }

    // LEVEL 2: ASSET VALIDATION
    const cfg = getLocalAiConfig();
    const assets = validateLocalAiAssets(cfg.modelsDir);
    if (!assets.valid || !assets.details.modelPresent || !assets.details.runtimePresent) {
      this.currentState = 'NOT_INSTALLED';
      this.lastErrorCode = 'ASSETS_MISSING';
      this.lastErrorMessage = `Model or runtime assets missing under: ${cfg.modelsDir}`;
      this.notifyIfStateChanged(previousState);
      return this.buildStatusPayload();
    }

    // LEVEL 3: PROCESS & LOOPBACK ENDPOINT
    const healthUrl = `${getLocalAiBaseUrl(cfg)}/health`;
    let endpointStatus: string | null = null;

    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000)
      });

      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const data = (await res.json().catch(() => null)) as any;
          endpointStatus = data?.status || null;
        }
      }
    } catch (err: any) {
      endpointStatus = null;
    }

    if (!endpointStatus) {
      this.currentState = 'OFFLINE';
      this.lastErrorCode = 'ENDPOINT_UNREACHABLE';
      this.lastErrorMessage = `Local AI runtime at 127.0.0.1:${cfg.port} is not responding (idle or stopped).`;
      this.notifyIfStateChanged(previousState);
      return this.buildStatusPayload();
    }

    if (endpointStatus === 'loading model') {
      this.currentState = 'STARTING';
      this.lastErrorMessage = 'Runtime is currently loading model weights into memory.';
      this.notifyIfStateChanged(previousState);
      return this.buildStatusPayload();
    }

    if (endpointStatus === 'no slot available') {
      this.currentState = 'BUSY';
      this.lastErrorMessage = 'Runtime is active but all inference slots are currently busy.';
      this.notifyIfStateChanged(previousState);
      return this.buildStatusPayload();
    }

    if (endpointStatus !== 'ok') {
      this.currentState = 'DEGRADED';
      this.lastErrorCode = 'UNEXPECTED_STATUS';
      this.lastErrorMessage = `Runtime returned unexpected status: ${endpointStatus}`;
      this.notifyIfStateChanged(previousState);
      return this.buildStatusPayload();
    }

    // LEVEL 4: BOUNDED NON-DESTRUCTIVE INFERENCE PROBE
    // Probe with a minimal 1-token test prompt bounded by a 6000ms timeout
    const testResult = await queryLocalAiChat(
      [{ role: 'user', content: 'test' }],
      { maxTokens: 1, timeoutMs: 6000 }
    );

    if (testResult.success) {
      this.currentState = 'READY';
      this.lastSuccessfulInferenceAt = new Date();
      this.lastLatencyMs = testResult.latencyMs;
      this.lastErrorMessage = null;
      this.lastErrorCode = null;
    } else {
      this.currentState = 'DEGRADED';
      this.lastErrorCode = 'INFERENCE_FAILED';
      this.lastErrorMessage = `Server answered health check but inference failed or timed out (${testResult.latencyMs}ms).`;
      this.lastLatencyMs = testResult.latencyMs;
    }

    this.notifyIfStateChanged(previousState);
    return this.buildStatusPayload();
  }

  /**
   * Fast synchronous check whether Qwen is currently ready.
   */
  public isReady(): boolean {
    if (this.currentState !== 'READY') return false;
    if (!this.lastSuccessfulInferenceAt) return false;
    // Stale protection: max 90s without successful verification
    const ageMs = Date.now() - this.lastSuccessfulInferenceAt.getTime();
    return ageMs < 90000;
  }

  /**
   * Returns current raw state.
   */
  public getState(): QwenReadinessState {
    return this.currentState;
  }

  /**
   * Resets status cache (e.g. after restarting runtime).
   */
  public invalidateCache(): void {
    this.lastCheckedAt = null;
  }

  /**
   * Emits SSE event if state transitioned.
   */
  private notifyIfStateChanged(previousState: QwenReadinessState): void {
    if (previousState !== this.currentState) {
      eventService.broadcast('local_ai_status_changed', {
        state: this.currentState,
        previousState,
        payload: this.buildStatusPayload()
      });
    }
  }

  /**
   * Constructs the structured JSON response payload.
   */
  private buildStatusPayload(): QwenDetailedStatus {
    const cfg = getLocalAiConfig();
    const isReady = this.isReady();

    let automationGate: 'open' | 'paused' | 'blocked' = 'open';
    if (!isReady) {
      automationGate = 'blocked';
    }

    return {
      state: this.currentState,
      enabled: isLocalAiEnabled(),
      installed: this.currentState !== 'NOT_INSTALLED' && this.currentState !== 'UNKNOWN',
      runtimeRunning: this.currentState === 'READY' || this.currentState === 'BUSY' || this.currentState === 'STARTING',
      runtimeHealthy: this.currentState === 'READY' || this.currentState === 'BUSY',
      inferenceReady: isReady,
      modelName: 'Qwen3-1.7B-Q4_K_M',
      runtimeName: 'llama-server.exe',
      port: cfg.port,
      lastCheckedAt: this.lastCheckedAt ? this.lastCheckedAt.toISOString() : null,
      lastSuccessfulInferenceAt: this.lastSuccessfulInferenceAt ? this.lastSuccessfulInferenceAt.toISOString() : null,
      latencyMs: this.lastLatencyMs,
      errorCode: this.lastErrorCode,
      errorMessage: this.lastErrorMessage,
      automationGate
    };
  }
}

export const qwenReadinessService = new QwenReadinessService();

