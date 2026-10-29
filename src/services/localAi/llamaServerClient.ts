/**
 * Local-only llama.cpp server client for Qwen3-1.7B Q4_K_M
 * Communicates strictly with localhost (127.0.0.1) llama-server instance.
 * Follows AGENTS.md No-GPU contract (--n-gpu-layers 0).
 */

import { spawn, type ChildProcess, execSync } from 'child_process';
import os from 'os';
import { validateLocalAiAssets, DEFAULT_LOCAL_AI_DIR } from './localAiAssetValidator.js';
import { getLocalAiStorageDir } from './localAiStorage.js';
import { parseStructuredIntent } from './structuredIntentParser.js';
import type { StructuredIntentResult } from './types.js';

export interface LlamaServerConfig {
  host: string;
  port: number;
  timeoutMs: number;
  modelsDir: string;
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

  return {
    host: overrides.host || process.env.LOCAL_AI_HOST || '127.0.0.1',
    port: overrides.port || parseInt(process.env.LOCAL_AI_PORT || '8089', 10),
    timeoutMs: overrides.timeoutMs || parseInt(process.env.LOCAL_AI_TIMEOUT_MS || '4000', 10),
    modelsDir: resolvedModelsDir
  };
}

let serverProcess: ChildProcess | null = null;
let isStartingServer = false;

/**
 * Checks if Local AI is explicitly enabled in environment.
 * Default is FALSE (disabled by default).
 */
export function isLocalAiEnabled(): boolean {
  return process.env.LOCAL_AI_ENABLED === 'true' || process.env.LOCAL_AI_ENABLED === '1';
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
      signal: AbortSignal.timeout(1000)
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
export async function ensureLlamaServerRunning(config?: Partial<LlamaServerConfig>): Promise<boolean> {
  const cfg = getLocalAiConfig(config);
  if (!isLocalAiEnabled()) return false;
  if (await checkLlamaServerHealth(cfg)) return true;
  if (serverProcess || isStartingServer) return false;

  const assetCheck = validateLocalAiAssets(cfg.modelsDir);
  if (!assetCheck.valid || !assetCheck.details.runtimePath || !assetCheck.details.modelPath) {
    console.warn('[Local AI] Cannot start server: required offline assets missing under', cfg.modelsDir);
    return false;
  }

  isStartingServer = true;
  try {
    const cpuThreads = Math.max(1, Math.min(4, os.cpus().length - 1));
    const args = [
      '-m', assetCheck.details.modelPath,
      '--host', cfg.host,
      '--port', String(cfg.port),
      '-ngl', '0', // strictly CPU-only, No-GPU contract
      '-t', String(cpuThreads),
      '-c', '2048', // context length
      '--log-disable'
    ];

    console.log(`[Local AI] Spawning llama-server (${assetCheck.details.runtimePath}) on CPU with ${cpuThreads} threads...`);
    serverProcess = spawn(assetCheck.details.runtimePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    serverProcess.on('exit', (code) => {
      console.log(`[Local AI] llama-server exited with code ${code}`);
      serverProcess = null;
    });

    serverProcess.on('error', (err) => {
      console.warn('[Local AI] llama-server spawn error:', err.message);
      serverProcess = null;
    });

    // Wait briefly for server readiness
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 400));
      if (await checkLlamaServerHealth(cfg)) {
        console.log('[Local AI] ✓ llama-server is ready and healthy at', getLocalAiBaseUrl(cfg));
        return true;
      }
    }

    return false;
  } catch (err) {
    console.warn('[Local AI] Failed to spawn llama-server:', err instanceof Error ? err.message : err);
    return false;
  } finally {
    isStartingServer = false;
  }
}

/**
 * Shuts down background llama-server process.
 */
export function stopLlamaServer(): void {
  if (serverProcess) {
    try {
      if (process.platform === 'win32' && serverProcess.pid) {
        execSync(`taskkill /pid ${serverProcess.pid} /t /f`, { stdio: 'ignore' });
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch (_) {}
    serverProcess = null;
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
