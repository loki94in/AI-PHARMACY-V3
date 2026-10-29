/**
 * Model Download Manager for Local AI Assets
 * Handles resilient HTTPS streaming, byte-range resume, SHA-256 verification, cancellation, and progress telemetry.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { eventService } from '../eventService.js';
import type { LocalAiReleaseManifest, ManifestArtifact } from './manifestSchema.js';
import {
  getLocalAiStagingDir,
  checkSufficientDiskSpace,
  verifyArtifactIntegrity,
  activateStagedAssets,
  getLocalAiStorageDir
} from './localAiStorage.js';

export type DownloadStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'activating'
  | 'ready'
  | 'error'
  | 'cancelled';

export interface DownloadProgressState {
  status: DownloadStatus;
  progress: number; // 0 to 100 percentage
  downloadedBytes: number;
  totalBytes: number;
  currentArtifact?: string;
  error?: string | null;
  canCancel: boolean;
  canRetry: boolean;
  releaseTag?: string;
}

export interface DownloadManagerOptions {
  assetBaseUrl?: string;
  allowInsecureHttpForTests?: boolean;
}

export class ModelDownloadManager {
  private state: DownloadProgressState = {
    status: 'idle',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    canCancel: false,
    canRetry: false
  };

  private isInFlight = false;
  private currentAbortController: AbortController | null = null;
  private lastManifest: LocalAiReleaseManifest | null = null;

  public getState(): DownloadProgressState {
    return { ...this.state };
  }

  private updateState(updates: Partial<DownloadProgressState>): void {
    this.state = { ...this.state, ...updates };
    try {
      eventService.broadcast('local_ai_download_progress', this.state);
      eventService.broadcast('local_ai_status_changed', {
        status: this.state.status,
        progress: this.state.progress,
        error: this.state.error
      });
    } catch (_) {}
  }

  /**
   * Resolves absolute download URL for an artifact.
   * If baseUrl or LOCAL_AI_ASSET_BASE_URL is configured (e.g. Cloudflare R2),
   * all artifact filenames resolve directly against that base bucket URL.
   */
  public resolveArtifactUrl(art: ManifestArtifact, baseUrl?: string): string {
    const configuredBase = (baseUrl || process.env.LOCAL_AI_ASSET_BASE_URL || '').trim().replace(/\/+$/, '');
    if (configuredBase) {
      const cleanRel = (art.filename || path.basename(art.url || '')).replace(/^\/+/, '');
      return `${configuredBase}/${cleanRel}`;
    }
    if (art.url && (art.url.startsWith('https://') || art.url.startsWith('http://'))) {
      return art.url;
    }
    const cleanBase = 'https://assets.aipharmacy.internal/releases/local-ai';
    const cleanRel = (art.url || art.filename).replace(/^\/+/, '');
    return `${cleanBase}/${cleanRel}`;
  }

  /**
   * Starts or resumes background download of all required assets from release manifest.
   */
  public async startDownload(
    manifest: LocalAiReleaseManifest,
    options: DownloadManagerOptions = {}
  ): Promise<boolean> {
    if (
      this.isInFlight ||
      this.state.status === 'downloading' ||
      this.state.status === 'checking' ||
      this.state.status === 'verifying' ||
      this.state.status === 'activating'
    ) {
      console.warn('[Model Download Manager] Download is already in progress, ignoring duplicate start request.');
      return false;
    }

    this.isInFlight = true;
    this.lastManifest = manifest;
    this.currentAbortController = new AbortController();

    const artifacts: ManifestArtifact[] = [
      manifest.runtime.artifact,
      manifest.model.artifact,
      manifest.license.artifact,
      manifest.metadata.artifact
    ];

    const totalExpectedBytes = artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);

    this.updateState({
      status: 'checking',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: totalExpectedBytes,
      error: null,
      canCancel: true,
      canRetry: false,
      releaseTag: manifest.releaseTag
    });

    const stagingDir = getLocalAiStagingDir();
    const activeDir = getLocalAiStorageDir();

    try {
      await fs.promises.mkdir(stagingDir, { recursive: true });

      // 1. Check if assets are already completely installed and verified in active directory
      let allInstalled = true;
      for (const art of artifacts) {
        const activeFilePath = path.join(activeDir, art.filename);
        const integrity = await verifyArtifactIntegrity(activeFilePath, art.sha256, art.sizeBytes);
        if (!integrity.valid) {
          allInstalled = false;
          break;
        }
      }

      if (allInstalled) {
        console.log('[Model Download Manager] ✓ All assets already installed and verified. Skipping download.');
        this.updateState({
          status: 'ready',
          progress: 100,
          downloadedBytes: totalExpectedBytes,
          totalBytes: totalExpectedBytes,
          canCancel: false,
          canRetry: false
        });
        return true;
      }

      // 2. Pre-check disk space
      const diskCheck = await checkSufficientDiskSpace(stagingDir, totalExpectedBytes);
      if (!diskCheck.sufficient) {
        const err = `Insufficient disk space: required ${(totalExpectedBytes / (1024 * 1024)).toFixed(0)} MB, available ${((diskCheck.availableBytes || 0) / (1024 * 1024)).toFixed(0)} MB`;
        this.updateState({
          status: 'error',
          error: err,
          canCancel: false,
          canRetry: true
        });
        return false;
      }

      // 3. Download artifacts sequentially with byte-range resume
      this.updateState({ status: 'downloading' });
      const stagedFilePaths: string[] = [];

      for (const art of artifacts) {
        if (this.currentAbortController?.signal.aborted) {
          throw new Error('DOWNLOAD_CANCELLED');
        }

        const stagedPath = path.join(stagingDir, art.filename);
        stagedFilePaths.push(stagedPath);
        this.updateState({ currentArtifact: art.filename });

        // Check if already completely downloaded and valid in staging
        const existingCheck = await verifyArtifactIntegrity(stagedPath, art.sha256, art.sizeBytes);
        if (existingCheck.valid) {
          console.log(`[Model Download Manager] Reusing verified staged artifact: ${art.filename}`);
          continue;
        }

        const downloadUrl = this.resolveArtifactUrl(art, options.assetBaseUrl);
        await this.downloadSingleArtifact(art, stagedPath, downloadUrl, options);
      }

      // 4. Verification phase
      this.updateState({ status: 'verifying', canCancel: false });
      for (const art of artifacts) {
        const stagedPath = path.join(stagingDir, art.filename);
        const check = await verifyArtifactIntegrity(stagedPath, art.sha256, art.sizeBytes);
        if (!check.valid) {
          throw new Error(`Integrity check failed for ${art.filename}: ${check.reason}`);
        }
      }

      // 5. Atomic activation phase
      this.updateState({ status: 'activating' });
      await activateStagedAssets(stagedFilePaths, manifest);

      this.updateState({
        status: 'ready',
        progress: 100,
        canCancel: false,
        canRetry: false,
        error: null
      });

      console.log('[Model Download Manager] 🎉 Local AI model and runtime successfully installed and activated!');
      return true;
    } catch (err) {
      const isCancelled =
        this.state.status === 'cancelled' ||
        (err instanceof Error && (err.name === 'AbortError' || err.message === 'DOWNLOAD_CANCELLED' || /aborted/i.test(err.message))) ||
        Boolean(this.currentAbortController?.signal.aborted);

      this.updateState({
        status: isCancelled ? 'cancelled' : 'error',
        error: isCancelled ? 'Download was cancelled by user' : (err instanceof Error ? err.message : String(err)),
        canCancel: false,
        canRetry: true
      });
      return false;
    } finally {
      this.isInFlight = false;
      this.currentAbortController = null;
    }
  }

  /**
   * Downloads a single artifact supporting HTTP Range resume.
   */
  private downloadSingleArtifact(
    art: ManifestArtifact,
    stagedDestPath: string,
    urlStr: string,
    options: DownloadManagerOptions
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const partPath = `${stagedDestPath}.part`;
      let existingBytes = 0;

      if (fs.existsSync(partPath)) {
        try {
          existingBytes = fs.statSync(partPath).size;
        } catch (_) {}
      }

      // If existing .part file is already larger than total size, reset it
      if (existingBytes >= art.sizeBytes) {
        existingBytes = 0;
        try { fs.rmSync(partPath, { force: true }); } catch (_) {}
      }

      const headers: Record<string, string> = {
        'User-Agent': 'AI-Pharmacy-OS-ModelDownloader/1.0',
        Accept: '*/*'
      };

      if (existingBytes > 0) {
        headers['Range'] = `bytes=${existingBytes}-`;
      }

      const client = urlStr.startsWith('https') ? https : http;

      const req = client.get(urlStr, { headers, signal: this.currentAbortController?.signal }, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          return this.downloadSingleArtifact(art, stagedDestPath, redirectUrl, options)
            .then(resolve)
            .catch(reject);
        }

        const isPartial = res.statusCode === 206;
        const isOk = res.statusCode === 200;

        if (!isPartial && !isOk) {
          res.resume();
          return reject(new Error(`HTTP_${res.statusCode} while downloading ${art.filename}`));
        }

        const appendMode = isPartial && existingBytes > 0;
        const fileStream = fs.createWriteStream(partPath, { flags: appendMode ? 'a' : 'w' });

        let currentDownloaded = appendMode ? existingBytes : 0;

        res.on('data', (chunk: Buffer) => {
          fileStream.write(chunk);
          currentDownloaded += chunk.length;
          this.state.downloadedBytes += chunk.length;
          if (this.state.totalBytes > 0) {
            const pct = Math.min(99, Math.round((this.state.downloadedBytes / this.state.totalBytes) * 100));
            this.updateState({ progress: pct });
          }
        });

        res.on('end', () => {
          fileStream.end(async () => {
            try {
              // Move completed .part file to target staged file name
              if (fs.existsSync(stagedDestPath)) {
                await fs.promises.rm(stagedDestPath, { force: true });
              }
              await fs.promises.rename(partPath, stagedDestPath);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        res.on('error', (err) => {
          fileStream.close();
          reject(err);
        });
      });

      req.on('error', (err) => {
        if (this.currentAbortController?.signal.aborted) {
          reject(new Error('DOWNLOAD_CANCELLED'));
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Cancels in-flight download.
   */
  public cancelDownload(): boolean {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
      this.updateState({
        status: 'cancelled',
        canCancel: false,
        canRetry: true,
        error: 'Download cancelled by user'
      });
      return true;
    }
    return false;
  }

  /**
   * Retries last failed or cancelled download.
   */
  public retryDownload(options?: DownloadManagerOptions): Promise<boolean> {
    if (!this.lastManifest) {
      throw new Error('No previous manifest available to retry.');
    }
    return this.startDownload(this.lastManifest, options);
  }
}

export const modelDownloadManager = new ModelDownloadManager();
