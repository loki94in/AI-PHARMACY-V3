/**
 * Regression Tests for Cloud-Hosted Local AI Model Installation & Lifecycle
 * Spec: Mock downloads, checksums, resume, cancel/retry, path traversal protection,
 * manifest signatures, runtime startup, WhatsApp connection lifecycle, and build gates.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import {
  sanitizeManifestFilename,
  validateManifestStructure,
  verifyManifestAuthenticity,
  type LocalAiReleaseManifest
} from '../src/services/localAi/manifestSchema.js';
import {
  verifyArtifactIntegrity,
  computeFileSha256,
  activateStagedAssets,
  checkSufficientDiskSpace
} from '../src/services/localAi/localAiStorage.js';
import {
  ModelDownloadManager
} from '../src/services/localAi/modelDownloadManager.js';
import {
  LocalAiLifecycleManager
} from '../src/services/localAi/localAiLifecycleManager.js';
import { execFileSync } from 'child_process';

describe('Cloud-Hosted Local AI Installation & Download Manager', () => {
  let tempStorageDir: string;
  let testServer: http.Server;
  let serverPort: number;
  let serverBaseUrl: string;

  // Mock server content
  const mockFiles: Record<string, Buffer> = {
    'llama-server.exe': Buffer.from('mock-llama-server-binary-content-v1.0'),
    'qwen3-1.7b-q4_k_m.gguf': Buffer.from('mock-qwen-gguf-weights-data-sample-content'),
    'LICENSE.txt': Buffer.from('Apache 2.0 / MIT License notices text'),
    'metadata.json': Buffer.from(JSON.stringify({ model: 'Qwen3-1.7B' }))
  };

  function getFileSha256(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
  }

  beforeAll((done) => {
    // Start lightweight local HTTP server for mock downloads
    testServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${serverPort}`);
      const filename = path.basename(url.pathname);
      const fileBuf = mockFiles[filename];

      if (!fileBuf) {
        res.writeHead(404);
        return res.end('Not Found');
      }

      // If slow query param is passed, delay response to test cancellation
      if (url.searchParams.get('slow')) {
        setTimeout(() => {
          res.writeHead(200, {
            'Content-Length': fileBuf.length,
            'Accept-Ranges': 'bytes',
            'Content-Type': 'application/octet-stream'
          });
          res.end(fileBuf);
        }, 150);
        return;
      }

      const totalSize = fileBuf.length;
      const range = req.headers.range;

      if (range) {
        // Handle Range requests (e.g. "bytes=10-")
        const match = range.match(/bytes=(\d+)-/);
        if (match) {
          const start = parseInt(match[1], 10);
          if (start < totalSize) {
            const partial = fileBuf.subarray(start);
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${totalSize - 1}/${totalSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': partial.length,
              'Content-Type': 'application/octet-stream'
            });
            return res.end(partial);
          }
        }
      }

      res.writeHead(200, {
        'Content-Length': totalSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/octet-stream'
      });
      res.end(fileBuf);
    });

    testServer.listen(0, '127.0.0.1', () => {
      const addr = testServer.address() as any;
      serverPort = addr.port;
      serverBaseUrl = `http://127.0.0.1:${serverPort}`;
      done();
    });
  });

  afterAll((done) => {
    testServer.close(done);
  });

  beforeEach(() => {
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-storage-test-'));
    process.env.LOCAL_AI_STORAGE_DIR = tempStorageDir;
    process.env.LOCAL_AI_PORT = '59998'; // Use unused port to avoid conflict
  });

  afterEach(() => {
    try {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    } catch (_) {}
  });

  function createValidMockManifest(slow = false): LocalAiReleaseManifest {
    const query = slow ? '?slow=true' : '';
    return {
      schemaVersion: '1.0',
      releaseTag: 'v1.0.0-test',
      model: {
        name: 'qwen3-1.7b-q4_k_m',
        family: 'Qwen3',
        parameterSize: '1.7B',
        quantization: 'Q4_K_M',
        contextLength: 2048,
        artifact: {
          filename: 'qwen3-1.7b-q4_k_m.gguf',
          sha256: getFileSha256(mockFiles['qwen3-1.7b-q4_k_m.gguf']),
          sizeBytes: mockFiles['qwen3-1.7b-q4_k_m.gguf'].length,
          url: `${serverBaseUrl}/qwen3-1.7b-q4_k_m.gguf${query}`
        }
      },
      runtime: {
        name: 'llama-server',
        version: 'b4500',
        platform: 'win32-x64',
        artifact: {
          filename: 'llama-server.exe',
          sha256: getFileSha256(mockFiles['llama-server.exe']),
          sizeBytes: mockFiles['llama-server.exe'].length,
          url: `${serverBaseUrl}/llama-server.exe${query}`,
          executable: true
        }
      },
      license: {
        artifact: {
          filename: 'LICENSE.txt',
          sha256: getFileSha256(mockFiles['LICENSE.txt']),
          sizeBytes: mockFiles['LICENSE.txt'].length,
          url: `${serverBaseUrl}/LICENSE.txt${query}`
        }
      },
      metadata: {
        artifact: {
          filename: 'metadata.json',
          sha256: getFileSha256(mockFiles['metadata.json']),
          sizeBytes: mockFiles['metadata.json'].length,
          url: `${serverBaseUrl}/metadata.json${query}`
        }
      },
      publishedAt: new Date().toISOString()
    };
  }

  // =========================================================================
  // 1. Path Traversal & Security Validation
  // =========================================================================
  describe('Path Traversal & Security Guards', () => {
    it('sanitizes valid basename filenames correctly', () => {
      expect(sanitizeManifestFilename('qwen3-1.7b-q4_k_m.gguf')).toBe('qwen3-1.7b-q4_k_m.gguf');
      expect(sanitizeManifestFilename('llama-server.exe')).toBe('llama-server.exe');
    });

    it('strictly rejects path traversal patterns', () => {
      expect(() => sanitizeManifestFilename('../evil.exe')).toThrow(/Potential path traversal/);
      expect(() => sanitizeManifestFilename('..\\evil.exe')).toThrow(/Potential path traversal/);
      expect(() => sanitizeManifestFilename('/etc/passwd')).toThrow(/Potential path traversal/);
      expect(() => sanitizeManifestFilename('C:\\Windows\\system32\\cmd.exe')).toThrow(/Potential path traversal/);
      expect(() => sanitizeManifestFilename('dir/file.gguf')).toThrow(/Potential path traversal/);
      expect(() => sanitizeManifestFilename('file\0.gguf')).toThrow(/Potential path traversal/);
    });

    it('verifies manifest HMAC signatures and rejects tampered data', () => {
      const secret = 'super-secret-release-signing-key';
      const manifestStr = JSON.stringify({ version: '1.0', release: '2026-10' });
      const validHmac = crypto.createHmac('sha256', secret).update(manifestStr).digest('hex');

      expect(verifyManifestAuthenticity(manifestStr, validHmac, secret)).toBe(true);
      expect(verifyManifestAuthenticity(manifestStr, 'invalid-signature-hex', secret)).toBe(false);
      expect(verifyManifestAuthenticity(manifestStr + 'tampered', validHmac, secret)).toBe(false);
    });

    it('resolves Cloudflare R2 bucket URLs cleanly for relative artifact paths', () => {
      const downloader = new ModelDownloadManager();
      const r2Base = 'https://pub-123456789abcdef.r2.dev';
      const art = {
        filename: 'qwen3-1.7b-q4_k_m.gguf',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
        url: 'qwen3-1.7b-q4_k_m.gguf'
      };

      const resolved = downloader.resolveArtifactUrl(art, r2Base);
      expect(resolved).toBe('https://pub-123456789abcdef.r2.dev/qwen3-1.7b-q4_k_m.gguf');
    });
  });

  // =========================================================================
  // 2. Download & SHA-256 Checksum Verification
  // =========================================================================
  describe('Download & SHA-256 Verification', () => {
    it('downloads all artifacts, verifies checksums, and atomically activates them', async () => {
      const downloader = new ModelDownloadManager();
      const manifest = createValidMockManifest();

      const success = await downloader.startDownload(manifest, { allowInsecureHttpForTests: true });
      expect(success).toBe(true);

      const state = downloader.getState();
      expect(state.status).toBe('ready');
      expect(state.progress).toBe(100);
      expect(state.error).toBeNull();

      // Verify active files on disk
      const targetDir = tempStorageDir;
      expect(fs.existsSync(path.join(targetDir, 'llama-server.exe'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'qwen3-1.7b-q4_k_m.gguf'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'LICENSE.txt'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'metadata.json'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'manifest.json'))).toBe(true);

      // Verify checksum on disk
      const modelHash = await computeFileSha256(path.join(targetDir, 'qwen3-1.7b-q4_k_m.gguf'));
      expect(modelHash).toBe(manifest.model.artifact.sha256);
    });

    it('rejects corrupt/tampered artifact when SHA-256 does not match', async () => {
      const downloader = new ModelDownloadManager();
      const manifest = createValidMockManifest();

      // Tamper expected checksum in manifest
      manifest.model.artifact.sha256 = '0000000000000000000000000000000000000000000000000000000000000000';

      const success = await downloader.startDownload(manifest, { allowInsecureHttpForTests: true });
      expect(success).toBe(false);

      const state = downloader.getState();
      expect(state.status).toBe('error');
      expect(state.error).toContain('Integrity check failed');

      // The corrupt file must NOT be activated into targetDir
      expect(fs.existsSync(path.join(tempStorageDir, 'qwen3-1.7b-q4_k_m.gguf'))).toBe(false);
    });
  });

  // =========================================================================
  // 3. Range Resume & Cancellation & Duplicate Prevention
  // =========================================================================
  describe('Resume, Cancellation, and Duplicate Prevention', () => {
    it('resumes interrupted download using HTTP Range header', async () => {
      const downloader = new ModelDownloadManager();
      const manifest = createValidMockManifest();

      // Pre-seed a partial .part file in staging
      const stagingDir = path.join(tempStorageDir, '.staging');
      fs.mkdirSync(stagingDir, { recursive: true });
      const modelPartPath = path.join(stagingDir, 'qwen3-1.7b-q4_k_m.gguf.part');
      const fullBuffer = mockFiles['qwen3-1.7b-q4_k_m.gguf'];
      const halfSize = Math.floor(fullBuffer.length / 2);
      fs.writeFileSync(modelPartPath, fullBuffer.subarray(0, halfSize));

      // Resume download
      const success = await downloader.startDownload(manifest, { allowInsecureHttpForTests: true });
      expect(success).toBe(true);

      // Verify final file is complete and intact
      const activeModel = path.join(tempStorageDir, 'qwen3-1.7b-q4_k_m.gguf');
      expect(fs.existsSync(activeModel)).toBe(true);
      const hash = await computeFileSha256(activeModel);
      expect(hash).toBe(manifest.model.artifact.sha256);
    });

    it('cancels active download and marks state as cancelled', async () => {
      const downloader = new ModelDownloadManager();
      const manifest = createValidMockManifest(true); // slow download

      const downloadPromise = downloader.startDownload(manifest, { allowInsecureHttpForTests: true });
      // Call cancel shortly after starting
      setTimeout(() => {
        downloader.cancelDownload();
      }, 10);

      await downloadPromise;
      const state = downloader.getState();
      expect(state.status).toBe('cancelled');
      expect(state.canRetry).toBe(true);
    });

    it('prevents duplicate concurrent download invocations', async () => {
      const downloader = new ModelDownloadManager();
      const manifest = createValidMockManifest(true); // slow download

      const p1 = downloader.startDownload(manifest, { allowInsecureHttpForTests: true });
      const p2 = await downloader.startDownload(manifest, { allowInsecureHttpForTests: true });

      expect(p2).toBe(false); // Second invocation rejected synchronously
      downloader.cancelDownload();
      await p1;
    });

    it('avoids re-downloading when assets already exist and are verified', async () => {
      const downloader = new ModelDownloadManager();
      const manifest = createValidMockManifest();

      // Initial download
      await downloader.startDownload(manifest, { allowInsecureHttpForTests: true });
      expect(downloader.getState().status).toBe('ready');

      // Second download call with same manifest should immediately finish as ready
      const downloader2 = new ModelDownloadManager();
      const success = await downloader2.startDownload(manifest, { allowInsecureHttpForTests: true });
      expect(success).toBe(true);
      expect(downloader2.getState().status).toBe('ready');
      expect(downloader2.getState().progress).toBe(100);
    });
  });

  // =========================================================================
  // 4. Lifecycle Manager & WhatsApp Non-Blocking Resilience
  // =========================================================================
  describe('Lifecycle Manager & WhatsApp Non-Blocking Resilience', () => {
    it('isInstalledAndVerified returns true only when all files and hashes match', async () => {
      const lifecycle = new LocalAiLifecycleManager();
      expect(await lifecycle.isInstalledAndVerified()).toBe(false);

      // Populate valid assets
      const downloader = new ModelDownloadManager();
      await downloader.startDownload(createValidMockManifest(), { allowInsecureHttpForTests: true });

      expect(await lifecycle.isInstalledAndVerified()).toBe(true);
    });

    it('onWhatsAppConnected runs without throwing when AI is disabled or missing', async () => {
      process.env.LOCAL_AI_ENABLED = 'false';
      const lifecycle = new LocalAiLifecycleManager();

      // Must complete smoothly without throwing
      await expect(lifecycle.onWhatsAppConnected()).resolves.toBeUndefined();
    });

    it('deterministic chatbot remains operational if AI server fails health check', async () => {
      process.env.LOCAL_AI_ENABLED = 'true';
      process.env.LOCAL_AI_PORT = '59998'; // Unused port guarantees health check failure
      const lifecycle = new LocalAiLifecycleManager();

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(lifecycle.onWhatsAppConnected()).resolves.toBeUndefined();
        const status = await lifecycle.getStatus();
        expect(status.runtimeHealthy).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  // =========================================================================
  // 5. BUNDLE_LOCAL_AI=1 Build Gate Enforcement
  // =========================================================================
  describe('BUNDLE_LOCAL_AI=1 Build Gate Enforcement', () => {
    it('fails build when BUNDLE_LOCAL_AI=1 and required assets are missing', () => {
      const scriptPath = path.resolve(process.cwd(), 'scripts', 'verify-local-ai-assets.mjs');
      const emptyDir = path.resolve(tempStorageDir, 'empty-missing-models');
      fs.mkdirSync(emptyDir, { recursive: true });

      expect(() => {
        execFileSync(process.execPath, [scriptPath, '--strict'], {
          env: { ...process.env, BUNDLE_LOCAL_AI: '1', LOCAL_AI_MODELS_DIR: emptyDir },
          stdio: 'pipe'
        });
      }).toThrow();
    });

    it('passes verification when all required assets are present', () => {
      const scriptPath = path.resolve(process.cwd(), 'scripts', 'verify-local-ai-assets.mjs');
      const out = execFileSync(process.execPath, [scriptPath, '--strict'], {
        env: { ...process.env, BUNDLE_LOCAL_AI: '1' },
        encoding: 'utf8',
        stdio: 'pipe'
      });
      expect(out).toContain('All Local AI assets are present and ready');
    });
  });
});
