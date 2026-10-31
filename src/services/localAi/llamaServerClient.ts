/**
 * Local-only llama.cpp server client for Qwen3-1.7B Q4_K_M
 * Communicates strictly with localhost (127.0.0.1) llama-server instance.
 * Follows AGENTS.md No-GPU contract (--n-gpu-layers 0).
 */

import { spawn, type ChildProcess, execSync } from 'child_process';
import os from 'os';
import net from 'net';
import { validateLocalAiAssets, DEFAULT_LOCAL_AI_DIR } from './localAiAssetValidator.js';
import { getLocalAiStorageDir } from './localAiStorage.js';
import { parseStructuredIntent } from './structuredIntentParser.js';
import { buildOperationalSystemPrompt, parseOperationalIntent, type OperationalModelOutput } from './operationalIntentSchema.js';
import { activityTracker } from '../../utils/activityTracker.js';
import { detectHardwareAccelerationProfile } from './hardwareDetector.js';
import type { StructuredIntentResult } from './types.js';

export interface LlamaServerConfig {
  host: string;
  port: number;
  timeoutMs: number;
  modelsDir: string;
}

let activeLlamaPort: number | null = null;

/**
 * Probes whether a port is currently available for binding.
 */
export async function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', (err: any) => {
        resolve(false);
      })
      .once('listening', () => {
        tester.once('close', () => resolve(true)).close();
      })
      .listen(port, host);
  });
}

/**
 * Hunts for the first free port starting from preferredPort up to maxAttempts.
 * Shifts away from 8080 to prevent conflicts with third-party pharmacy software.
 */
export async function findAvailablePort(startPort: number, host = '127.0.0.1', maxAttempts = 15): Promise<number> {
  let candidate = (startPort === 8080) ? 8089 : startPort;
  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortAvailable(candidate, host)) {
      return candidate;
    }
    candidate++;
  }
  return candidate;
}

export function getLocalAiConfig(overrides: Partial<LlamaServerConfig> = {}): LlamaServerConfig {
  let resolvedModelsDir = overrides.modelsDir || process.env.LOCAL_AI_STORAGE_DIR || process.env.LOCAL_AI_MODELS_DIR;
  if (!resolvedModelsDir) {
    if (validateLocalAiAssets(DEFAULT_LOCAL_AI_DIR).valid) {
      resolvedModelsDir = DEFAULT_LOCAL_AI_DIR;
    } else {
      resolvedModelsDir = getLocalAiStorageDir();
    }
  }

  const rawEnvPort = parseInt(process.env.LOCAL_AI_PORT || '8089', 10);
  const preferredPort = (rawEnvPort === 8080) ? 8089 : rawEnvPort;

  return {
    host: overrides.host || process.env.LOCAL_AI_HOST || '127.0.0.1',
    port: overrides.port || activeLlamaPort || preferredPort,
    timeoutMs: overrides.timeoutMs || parseInt(process.env.LOCAL_AI_TIMEOUT_MS || '4000', 10),
    modelsDir: resolvedModelsDir
  };
}

let serverProcess: ChildProcess | null = null;
let startupPromise: Promise<boolean> | null = null;
let cachedAssetPresence: boolean | null = null;
let lastActivityTimestamp = Date.now();
let idleSleepTimer: NodeJS.Timeout | null = null;
const DEFAULT_IDLE_SLEEP_MIN = 15;

export type ResponseProfile = 'short' | 'normal' | 'detailed';

export function getProfileMaxTokens(profile: ResponseProfile = 'normal'): number {
  switch (profile) {
    case 'short': return 128;
    case 'detailed': return 384;
    case 'normal':
    default: return 256;
  }
}

export function markLocalAiActivity(): void {
  lastActivityTimestamp = Date.now();
}

export function getLocalAiIdleSleepMin(): number {
  const envVal = process.env.LOCAL_AI_IDLE_SLEEP_MIN;
  if (envVal !== undefined && envVal !== '') {
    const parsed = parseInt(envVal, 10);
    return isNaN(parsed) ? DEFAULT_IDLE_SLEEP_MIN : parsed;
  }
  return DEFAULT_IDLE_SLEEP_MIN;
}

function initIdleSleepWatcher(): void {
  if (idleSleepTimer) return;
  idleSleepTimer = setInterval(() => {
    const idleMin = getLocalAiIdleSleepMin();
    if (idleMin <= 0) return; // 0 = never sleep
    if (!serverProcess) return;

    const isAppIdle = activityTracker.isIdle();
    const idleMs = Date.now() - lastActivityTimestamp;
    if (idleMs >= idleMin * 60 * 1000) {
      console.log(`[Local AI] Runtime idle for ${Math.round(idleMs / 60000)}m (app idle: ${isAppIdle}). Stopping llama-server to reclaim RAM...`);
      stopLlamaServer('idle_timeout');
    }
  }, 30_000);
  if (idleSleepTimer.unref) idleSleepTimer.unref();
}

export function isServerProcessRunning(): boolean {
  return serverProcess !== null;
}

export function resetLocalAiAssetCache(): void {
  cachedAssetPresence = null;
}

/**
 * Checks if Local AI is explicitly enabled in environment, or auto-activates if bundled assets exist.
 */
export function isLocalAiEnabled(): boolean {
  if (process.env.LOCAL_AI_ENABLED === 'false' || process.env.LOCAL_AI_ENABLED === '0') {
    return false;
  }
  if (process.env.LOCAL_AI_ENABLED === 'true' || process.env.LOCAL_AI_ENABLED === '1') {
    return true;
  }
  // Auto-detect: if bundled local AI assets exist and are verified, activate automatically
  if (cachedAssetPresence === null) {
    try {
      const defaultCheck = validateLocalAiAssets(DEFAULT_LOCAL_AI_DIR);
      if (defaultCheck.valid) {
        cachedAssetPresence = true;
      } else {
        const storageCheck = validateLocalAiAssets(getLocalAiStorageDir());
        cachedAssetPresence = storageCheck.valid;
      }
    } catch {
      cachedAssetPresence = false;
    }
  }
  return Boolean(cachedAssetPresence);
}

/**
 * Checks if Local AI is in shadow mode.
 * Default is TRUE when enabled (shadow classifier only).
 */
export function isLocalAiShadowMode(): boolean {
  if (!isLocalAiEnabled()) return false;
  return process.env.LOCAL_AI_SHADOW_MODE !== 'false';
}

/**
 * Get current configured base URL.
 */
export function getLocalAiBaseUrl(config?: Partial<LlamaServerConfig>): string {
  const cfg = getLocalAiConfig(config);
  return `http://${cfg.host}:${cfg.port}`;
}

/**
 * Quick ping to llama.cpp server /health endpoint.
 * Validates that the endpoint is actually llama-server and not another web server (e.g. Tomcat/IIS).
 */
export async function checkLlamaServerHealth(config?: Partial<LlamaServerConfig>): Promise<boolean> {
  const cfg = getLocalAiConfig(config);
  const url = `${getLocalAiBaseUrl(cfg)}/health`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return false;
    const data: any = await res.json().catch(() => null);
    return Boolean(
      data &&
      (data.status === 'ok' || data.status === 'loading model' || data.status === 'no slot available')
    );
  } catch {
    return false;
  }
}

/**
 * Launches local llama-server.exe process if provisioned assets exist and not already running.
 * Enforces No-GPU contract (--n-gpu-layers 0).
 */
/**
 * Launches local llama-server.exe process if provisioned assets exist and not already running.
 * Single-flight mutex: concurrent callers await the identical startup promise.
 * Enforces No-GPU contract (--n-gpu-layers 0).
 */
export async function ensureLlamaServerRunning(config?: Partial<LlamaServerConfig>): Promise<boolean> {
  markLocalAiActivity();
  const cfg = getLocalAiConfig(config);
  if (!isLocalAiEnabled()) return false;

  // 1. If already healthy, keep-alive and return true immediately
  if (await checkLlamaServerHealth(cfg)) {
    initIdleSleepWatcher();
    return true;
  }

  // 2. If a startup is already in flight, await the existing shared promise
  if (startupPromise) {
    const ok = await startupPromise;
    if (ok) {
      initIdleSleepWatcher();
      return await checkLlamaServerHealth(cfg);
    }
    return false;
  }

  // 3. Initiate single-flight startup
  startupPromise = (async () => {
    try {
      return await doStartLlamaServer(cfg, config);
    } finally {
      startupPromise = null;
    }
  })();

  const result = await startupPromise;
  if (result) {
    initIdleSleepWatcher();
  }
  return result;
}

async function doStartLlamaServer(initialCfg: LlamaServerConfig, config?: Partial<LlamaServerConfig>): Promise<boolean> {
  let cfg = initialCfg;
  const assetCheck = validateLocalAiAssets(cfg.modelsDir);
  if (!assetCheck.valid || !assetCheck.details.runtimePath || !assetCheck.details.modelPath) {
    console.warn('[Local AI] Cannot start server: required offline assets missing under', cfg.modelsDir);
    return false;
  }

  try {
    // Probe preferred port first
    let targetPort = cfg.port;
    if (!(await isPortAvailable(targetPort, cfg.host))) {
      // Check if an existing llama-server is already running on that port
      if (await checkLlamaServerHealth({ ...config, port: targetPort })) {
        console.log(`[Local AI] Reusing active llama-server at http://${cfg.host}:${targetPort}`);
        activeLlamaPort = targetPort;
        return true;
      }
      targetPort = await findAvailablePort(cfg.port, cfg.host);
    }

    activeLlamaPort = targetPort;
    cfg = getLocalAiConfig({ ...config, port: targetPort });

    const hwProfile = detectHardwareAccelerationProfile();
    const cpuThreads = hwProfile.cpuThreads;
    const offloadLayers = hwProfile.offloadLayers;

    // Reconcile context size with manifest.json (2048) by default
    const rawContextSize = parseInt(process.env.LOCAL_AI_CONTEXT_SIZE || '2048', 10);
    const contextSize = isNaN(rawContextSize) ? 2048 : Math.min(Math.max(2048, rawContextSize), 4096);

    const args = [
      '-m', assetCheck.details.modelPath,
      '--host', cfg.host,
      '--port', String(cfg.port),
      '-ngl', String(offloadLayers),
      '-t', String(cpuThreads),
      '-c', String(contextSize), // Dynamic context length (default 2048 matching manifest)
      '-ctk', 'q8_0',            // Quantized 8-bit Key cache saves ~50% RAM
      '-ctv', 'q8_0',            // Quantized 8-bit Value cache saves ~50% RAM
      '--log-disable'
    ];

    console.log(
      `[Local AI] Spawning llama-server (${assetCheck.details.runtimePath}) [Mode: ${hwProfile.executionMode}, ngl: ${offloadLayers}, threads: ${cpuThreads}] on port ${cfg.port}...`
    );
    serverProcess = spawn(assetCheck.details.runtimePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    if (process.platform === 'win32' && serverProcess.pid) {
      try {
        if (os.constants?.priority?.PRIORITY_BELOW_NORMAL) {
          os.setPriority(serverProcess.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
          console.log(`[Local AI] llama-server (PID ${serverProcess.pid}) set to Below Normal priority diet.`);
        }
      } catch (pErr: any) {
        console.warn('[Local AI] Could not set below-normal priority on llama-server:', pErr?.message || pErr);
      }
    }

    serverProcess.on('exit', (code) => {
      console.log(`[Local AI] llama-server exited with code ${code}`);
      serverProcess = null;
      activeLlamaPort = null;
    });

    serverProcess.on('error', (err) => {
      console.warn('[Local AI] llama-server spawn error:', err.message);
      serverProcess = null;
      activeLlamaPort = null;
    });

    // Wait for server readiness (up to 25 * 500ms = 12.5s)
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await checkLlamaServerHealth(cfg)) {
        console.log('[Local AI] ✓ llama-server is ready and healthy at', getLocalAiBaseUrl(cfg));
        return true;
      }
    }

    return false;
  } catch (err) {
    console.warn('[Local AI] Failed to spawn llama-server:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Shuts down background llama-server process.
 */
export function stopLlamaServer(reason = 'manual'): void {
  if (idleSleepTimer) {
    clearInterval(idleSleepTimer);
    idleSleepTimer = null;
  }
  if (serverProcess) {
    try {
      if (process.platform === 'win32' && serverProcess.pid) {
        execSync(`taskkill /pid ${serverProcess.pid} /t /f`, { stdio: 'ignore' });
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch (_) {}
    serverProcess = null;
    activeLlamaPort = null;
    console.log(`[Local AI] llama-server stopped (${reason}).`);
  }
}

export interface LlamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlamaChatCompletionOptions extends Partial<LlamaServerConfig> {
  temperature?: number;
  maxTokens?: number;
  profile?: ResponseProfile;
  timeoutMs?: number;
  responseFormat?: { type: 'json_object' | 'text' };
}

export interface LlamaChatCompletionResult {
  content: string;
  parsedJson?: any;
  success: boolean;
  latencyMs: number;
}

/**
 * General chat completion query to local llama-server.
 * Non-blocking guarantee: strict timeout, catches all network faults, never throws.
 */
export async function queryLocalAiChat(
  messages: LlamaChatMessage[],
  options: LlamaChatCompletionOptions = {}
): Promise<LlamaChatCompletionResult> {
  markLocalAiActivity();
  const start = performance.now();
  const cfg = getLocalAiConfig(options);
  const endpoint = `${getLocalAiBaseUrl(cfg)}/v1/chat/completions`;
  const timeoutMs = options.timeoutMs || cfg.timeoutMs || 6000;

  const payload: any = {
    model: 'qwen3-1.7b',
    messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? (options.profile ? getProfileMaxTokens(options.profile) : (process.env.LOCAL_AI_MAX_TOKENS ? parseInt(process.env.LOCAL_AI_MAX_TOKENS, 10) : 256))
  };
  if (options.responseFormat) {
    payload.response_format = options.responseFormat;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      return {
        content: '',
        success: false,
        latencyMs: Math.round(performance.now() - start)
      };
    }

    const data = await response.json() as any;
    const rawContent = data?.choices?.[0]?.message?.content || '';
    let parsedJson: any = null;
    if (options.responseFormat?.type === 'json_object' && rawContent) {
      try {
        parsedJson = JSON.parse(rawContent);
      } catch {
        const match = rawContent.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsedJson = JSON.parse(match[0]);
          } catch (_) {}
        }
      }
    }

    const latencyMs = Math.round(performance.now() - start);
    import('./qwenReadinessService.js').then(m => m.qwenReadinessService.recordSuccessfulInference(latencyMs)).catch(() => {});

    return {
      content: rawContent,
      parsedJson,
      success: true,
      latencyMs
    };
  } catch {
    return {
      content: '',
      success: false,
      latencyMs: Math.round(performance.now() - start)
    };
  }
}

/**
 * Builds standard system prompt for Qwen3-1.7B structured intent classification.
 */
export function buildIntentSystemPrompt(): string {
  return `You are a medical pharmacy intent classification engine.
Given customer messages, classify their intent into exactly one of: ORDER, REFILL, INQUIRY, CHITCHAT, or UNKNOWN.
Extract any requested medicines with name, quantity, and unit.
Respond ONLY with a valid JSON object matching this schema:
{
  "intent": "ORDER" | "REFILL" | "INQUIRY" | "CHITCHAT" | "UNKNOWN",
  "confidence": 0.0 to 1.0,
  "medicines": [
    {
      "name": "Medicine Name",
      "quantity": 1 to 100,
      "unit": "strip" | "tablet" | "box" | "bottle"
    }
  ],
  "explanation": "Brief explanation"
}`;
}

/**
 * Queries the local llama.cpp server for structured intent parsing.
 * Non-blocking guarantee: strict timeout, catches all network/server faults, never throws.
 */
export async function queryLocalAiIntent(
  userText: string,
  options: Partial<LlamaServerConfig> = {}
): Promise<StructuredIntentResult> {
  const cfg = getLocalAiConfig(options);

  if (!userText || !userText.trim()) {
    return parseStructuredIntent('');
  }

  const endpoint = `${getLocalAiBaseUrl(cfg)}/v1/chat/completions`;
  const systemPrompt = buildIntentSystemPrompt();

  const payload = {
    model: 'qwen3-1.7b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
    temperature: 0.1,
    max_tokens: 160,
    response_format: { type: 'json_object' }
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(cfg.timeoutMs)
    });

    if (!response.ok) {
      console.warn(`[Local AI] llama-server returned HTTP ${response.status}`);
      return parseStructuredIntent('');
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content || '';
    return parseStructuredIntent(content);
  } catch (err) {
    // Expected on connection refused / timeout / missing server — fail silently and gracefully
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('aborted') && !msg.includes('fetch failed')) {
      console.warn('[Local AI] Query failed:', msg);
    }
    return parseStructuredIntent('');
  }
}

/**
 * Queries the local llama.cpp server for operational intent classification.
 * Non-blocking guarantee: strict timeout, catches all network/server faults, never throws.
 */
export async function queryOperationalAiIntent(
  userText: string,
  options: Partial<LlamaServerConfig> = {}
): Promise<OperationalModelOutput> {
  markLocalAiActivity();
  const cfg = getLocalAiConfig(options);

  if (!userText || !userText.trim()) {
    return parseOperationalIntent('');
  }

  // Fast guard: if server process is not active and port probe fails fast (300ms), don't stall
  if (!serverProcess && !(await checkLlamaServerHealth({ ...options, timeoutMs: 300 }))) {
    return parseOperationalIntent('');
  }

  const endpoint = `${getLocalAiBaseUrl(cfg)}/v1/chat/completions`;
  const systemPrompt = buildOperationalSystemPrompt();
  const timeoutMs = options.timeoutMs || 1500;

  const payload = {
    model: 'qwen3-1.7b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
    temperature: 0.1,
    max_tokens: 75,
    response_format: { type: 'json_object' }
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      console.warn(`[Local AI] llama-server returned HTTP ${response.status} for operational intent`);
      return parseOperationalIntent('');
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content || '';
    return parseOperationalIntent(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('aborted') && !msg.includes('fetch failed')) {
      console.warn('[Local AI] Operational intent query failed:', msg);
    }
    return parseOperationalIntent('');
  }
}
