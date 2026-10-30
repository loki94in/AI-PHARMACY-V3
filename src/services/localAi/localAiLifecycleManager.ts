/**
 * Local AI Lifecycle Manager
 * Connects WhatsApp lifecycle events to Local AI verification, background asset download,
 * runtime startup, and health monitoring with non-blocking resilience.
 */

import fs from 'fs';
import path from 'path';
import { isLocalAiEnabled, checkLlamaServerHealth, ensureLlamaServerRunning } from './llamaServerClient.js';
import { qwenReadinessService, type QwenReadinessState } from './qwenReadinessService.js';
import { getLocalAiStorageDir, verifyArtifactIntegrity } from './localAiStorage.js';
import { validateManifestStructure, verifyManifestAuthenticity, type LocalAiReleaseManifest } from './manifestSchema.js';
import { modelDownloadManager, type DownloadProgressState } from './modelDownloadManager.js';
import { eventService } from '../eventService.js';

export interface LocalAiSystemStatus {
  enabled: boolean;
  installed: boolean;
  runtimeRunning: boolean;
  runtimeHealthy: boolean;
  state?: QwenReadinessState;
  inferenceReady?: boolean;
  latencyMs?: number;
  automationGate?: 'open' | 'paused' | 'blocked';
  downloadState: DownloadProgressState;
  storageDir: string;
}

export class LocalAiLifecycleManager {
  private isProcessingWhatsAppReady = false;

  /**
   * Returns current full system status.
   */
  public async getStatus(): Promise<LocalAiSystemStatus> {
    const readiness = await qwenReadinessService.getStatus();

    return {
      enabled: readiness.enabled,
      installed: readiness.installed,
      runtimeRunning: readiness.runtimeRunning,
      runtimeHealthy: readiness.runtimeHealthy,
      state: readiness.state,
      inferenceReady: readiness.inferenceReady,
      latencyMs: readiness.latencyMs,
      automationGate: readiness.automationGate,
      downloadState: modelDownloadManager.getState(),
      storageDir: getLocalAiStorageDir()
    };
  }

  /**
   * Verifies if valid active model, runtime, license, and metadata exist in storage.
   */
  public async isInstalledAndVerified(): Promise<boolean> {
    const storageDir = getLocalAiStorageDir();
    if (!fs.existsSync(storageDir)) return false;

    const manifestPath = path.join(storageDir, 'manifest.json');
    const metadataPath = path.join(storageDir, 'metadata.json');
    const fileToInspect = fs.existsSync(manifestPath) ? manifestPath : (fs.existsSync(metadataPath) ? metadataPath : null);

    if (!fileToInspect) return false;

    try {
      const content = fs.readFileSync(fileToInspect, 'utf8');
      const manifest = JSON.parse(content) as LocalAiReleaseManifest;
      const validation = validateManifestStructure(manifest);
      if (!validation.valid || !validation.manifest) {
        // Fallback: check presence of standard files if legacy or offline bundled
        const runtimeWin = path.join(storageDir, 'llama-server.exe');
        const runtimePosix = path.join(storageDir, 'llama-server');
        const hasRuntime = fs.existsSync(runtimeWin) || fs.existsSync(runtimePosix);
        const files = fs.readdirSync(storageDir);
        const hasModel = files.some(f => f.toLowerCase().endsWith('.gguf'));
        return hasRuntime && hasModel;
      }

      const m = validation.manifest;
      const artifacts = [m.runtime.artifact, m.model.artifact, m.license.artifact, m.metadata.artifact];
      for (const art of artifacts) {
        const filePath = path.join(storageDir, art.filename);
        const check = await verifyArtifactIntegrity(filePath, art.sha256, art.sizeBytes);
        if (!check.valid) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetches and verifies remote release manifest from configured URL.
   */
  public async fetchRemoteManifest(customUrl?: string): Promise<LocalAiReleaseManifest | null> {
    const rawManifestUrl = (customUrl || process.env.LOCAL_AI_MANIFEST_URL || '').trim();
    const rawBaseUrl = (process.env.LOCAL_AI_ASSET_BASE_URL || '').trim().replace(/\/+$/, '');
    const manifestUrl = rawManifestUrl || (rawBaseUrl ? `${rawBaseUrl}/manifest.json` : 'https://assets.aipharmacy.internal/releases/local-ai/manifest.json');

    try {
      const response = await fetch(manifestUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'AI-Pharmacy-OS-Lifecycle/1.0' },
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        console.warn(`[Local AI Lifecycle] Failed to fetch manifest: HTTP ${response.status}`);
        return null;
      }

      const rawJson = await response.text();
      const parsed = JSON.parse(rawJson);

      const validation = validateManifestStructure(parsed);
      if (!validation.valid || !validation.manifest) {
        console.warn('[Local AI Lifecycle] Invalid manifest structure:', validation.error);
        return null;
      }

      // If signature is present, verify authenticity
      if (validation.manifest.signature) {
        const isValidSignature = verifyManifestAuthenticity(rawJson, validation.manifest.signature);
        if (!isValidSignature) {
          console.error('[Local AI Lifecycle] ❌ Manifest signature verification failed! Rejecting unverified manifest.');
          return null;
        }
      }

      return validation.manifest;
    } catch (err) {
      console.warn('[Local AI Lifecycle] Manifest fetch error:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Triggered asynchronously when WhatsApp connects.
   * Never blocks WhatsApp connection or message routing.
   */
  public async onWhatsAppConnected(): Promise<void> {
    if (this.isProcessingWhatsAppReady) return;
    this.isProcessingWhatsAppReady = true;

    // Run in background without throwing
    try {
      if (!isLocalAiEnabled()) {
        console.log('[Local AI Lifecycle] WhatsApp connected. Local AI is disabled (default). Skipping asset check.');
        return;
      }

      console.log('[Local AI Lifecycle] WhatsApp connected. Checking local AI asset installation...');
      const installed = await this.isInstalledAndVerified();

      if (installed) {
        if (process.env.LOCAL_AI_PREWARM === 'true') {
          console.log('[Local AI Lifecycle] ✓ Local AI assets installed and prewarm enabled. Ensuring runtime is active...');
          const isRunning = await ensureLlamaServerRunning({
            host: process.env.LOCAL_AI_HOST || '127.0.0.1',
            port: parseInt(process.env.LOCAL_AI_PORT || '8089', 10),
            timeoutMs: 4000,
            modelsDir: getLocalAiStorageDir()
          });

          if (isRunning) {
            console.log('[Local AI Lifecycle] ✓ Local AI runtime is healthy and ready in shadow mode.');
            eventService.broadcast('local_ai_status_changed', { status: 'ready', runtimeHealthy: true });
          } else {
            console.warn('[Local AI Lifecycle] ⚠️ Runtime failed to start or health-check failed. Deterministic chatbot remains fully operational.');
            eventService.broadcast('local_ai_status_changed', { status: 'runtime_error', runtimeHealthy: false });
          }
        } else {
          console.log('[Local AI Lifecycle] ✓ Local AI assets verified. Deferred startup active (Qwen will load on first inference request).');
          eventService.broadcast('local_ai_status_changed', { status: 'installed', runtimeHealthy: false });
        }
        return;
      }

      // Assets are missing — initiate non-blocking background download if auto-download is enabled
      const autoDownload = process.env.LOCAL_AI_AUTO_DOWNLOAD !== 'false';
      if (autoDownload) {
        console.log('[Local AI Lifecycle] Assets missing. Fetching manifest for non-blocking background download...');
        const manifest = await this.fetchRemoteManifest();
        if (manifest) {
          console.log(`[Local AI Lifecycle] Starting background download for release ${manifest.releaseTag} (${manifest.model.name})...`);
          // Start download asynchronously
          modelDownloadManager.startDownload(manifest).then(async (success) => {
            if (success) {
              console.log('[Local AI Lifecycle] Download completed successfully. Starting runtime...');
              await ensureLlamaServerRunning({
                host: process.env.LOCAL_AI_HOST || '127.0.0.1',
                port: parseInt(process.env.LOCAL_AI_PORT || '8089', 10),
                timeoutMs: 4000,
                modelsDir: getLocalAiStorageDir()
              });
            }
          }).catch((err) => {
            console.warn('[Local AI Lifecycle] Background download encountered error:', err);
          });
        } else {
          console.warn('[Local AI Lifecycle] Could not retrieve verified remote manifest. Deterministic chatbot remains active.');
        }
      } else {
        console.log('[Local AI Lifecycle] Assets missing. Auto-download is off; user can initiate via Settings/API.');
      }
    } catch (err) {
      console.warn('[Local AI Lifecycle] Error during WhatsApp connected lifecycle:', err);
    } finally {
      this.isProcessingWhatsAppReady = false;
    }
  }
}

export const localAiLifecycleManager = new LocalAiLifecycleManager();
