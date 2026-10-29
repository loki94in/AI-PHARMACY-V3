/**
 * Local AI Storage & Directory Manager
 * Handles per-user AppData storage, disk space pre-checks, and atomic activation of assets.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAppDataDir } from '../../config/index.js';
import type { LocalAiReleaseManifest } from './manifestSchema.js';

export interface DiskSpaceCheckResult {
  sufficient: boolean;
  availableBytes?: number;
  requiredBytes: number;
  error?: string;
}

/**
 * Returns the permanent per-user directory for Local AI assets.
 * Respects per-user AppData conventions (never Program Files).
 */
export function getLocalAiStorageDir(): string {
  if (process.env.LOCAL_AI_STORAGE_DIR && process.env.LOCAL_AI_STORAGE_DIR.trim()) {
    return path.resolve(process.env.LOCAL_AI_STORAGE_DIR.trim());
  }
  return path.join(getAppDataDir(), 'models', 'local-ai');
}

/**
 * Returns the staging directory where files are assembled before atomic activation.
 */
export function getLocalAiStagingDir(): string {
  return path.join(getLocalAiStorageDir(), '.staging');
}

/**
 * Returns backup directory for rollback in case activation encounters an error.
 */
export function getLocalAiBackupDir(): string {
  return path.join(getLocalAiStorageDir(), '.backup');
}

/**
 * Checks if sufficient disk space exists in the target directory.
 * Adds a 250 MB safety margin.
 */
export async function checkSufficientDiskSpace(
  targetDir: string,
  requiredBytes: number
): Promise<DiskSpaceCheckResult> {
  const marginBytes = 250 * 1024 * 1024; // 250 MB safety buffer
  const totalNeeded = requiredBytes + marginBytes;

  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
    // fs.promises.statfs is standard in Node 18.15+
    if (typeof fs.promises.statfs === 'function') {
      const stats = await fs.promises.statfs(targetDir);
      const availableBytes = Number(stats.bavail) * Number(stats.bsize);
      return {
        sufficient: availableBytes >= totalNeeded,
        availableBytes,
        requiredBytes
      };
    }
  } catch (err) {
    // If statfs fails or is unavailable on platform, log warning and allow proceed with advisory note
    console.warn('[Local AI Storage] Could not determine disk space via statfs:', err instanceof Error ? err.message : err);
  }

  return {
    sufficient: true,
    requiredBytes
  };
}

/**
 * Calculates SHA-256 hash of a file on disk.
 */
export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Verifies that a file on disk matches its expected SHA-256 hash and file size.
 */
export async function verifyArtifactIntegrity(
  filePath: string,
  expectedSha256: string,
  expectedSize?: number
): Promise<{ valid: boolean; reason?: string }> {
  if (!fs.existsSync(filePath)) {
    return { valid: false, reason: 'File does not exist on disk' };
  }

  try {
    const stats = await fs.promises.stat(filePath);
    if (expectedSize !== undefined && expectedSize > 0 && stats.size !== expectedSize) {
      return {
        valid: false,
        reason: `File size mismatch: expected ${expectedSize} bytes, got ${stats.size} bytes`
      };
    }

    const actualHash = await computeFileSha256(filePath);
    if (actualHash !== expectedSha256.toLowerCase()) {
      return {
        valid: false,
        reason: `SHA-256 hash mismatch: expected ${expectedSha256}, got ${actualHash}`
      };
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: `Integrity check failed with error: ${err instanceof Error ? err.message : err}`
    };
  }
}

/**
 * Atomically activates staged assets into the main storage directory.
 * Implements backup and rollback to prevent corrupting a previously working installation.
 */
export async function activateStagedAssets(
  stagedFiles: string[],
  manifest: LocalAiReleaseManifest
): Promise<void> {
  const targetDir = getLocalAiStorageDir();
  const backupDir = getLocalAiBackupDir();

  await fs.promises.mkdir(targetDir, { recursive: true });
  await fs.promises.mkdir(backupDir, { recursive: true });

  const backedUpFiles: Array<{ original: string; backup: string }> = [];

  try {
    // 1. Move existing active files to backup folder
    for (const stagedPath of stagedFiles) {
      const filename = path.basename(stagedPath);
      const activePath = path.join(targetDir, filename);
      if (fs.existsSync(activePath)) {
        const backupPath = path.join(backupDir, `${filename}.${Date.now()}.bak`);
        await fs.promises.rename(activePath, backupPath);
        backedUpFiles.push({ original: activePath, backup: backupPath });
      }
    }

    // 2. Move staged files into active directory
    for (const stagedPath of stagedFiles) {
      const filename = path.basename(stagedPath);
      const activePath = path.join(targetDir, filename);
      await fs.promises.rename(stagedPath, activePath);
    }

    // 3. Write manifest.json to active directory (metadata.json remains the downloaded metadata artifact)
    const activeManifestPath = path.join(targetDir, 'manifest.json');
    await fs.promises.writeFile(activeManifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    // 4. Remove backup files upon successful activation
    for (const item of backedUpFiles) {
      try {
        await fs.promises.rm(item.backup, { force: true });
      } catch (_) {}
    }
    try {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
    } catch (_) {}
  } catch (activationErr) {
    console.error('[Local AI Storage] Activation failed, performing atomic rollback:', activationErr);
    // Rollback: restore backed up files
    for (const item of backedUpFiles) {
      try {
        if (fs.existsSync(item.backup)) {
          await fs.promises.rename(item.backup, item.original);
        }
      } catch (rollbackErr) {
        console.error('[Local AI Storage] Rollback error for', item.original, rollbackErr);
      }
    }
    throw activationErr;
  }
}
