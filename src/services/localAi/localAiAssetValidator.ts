/**
 * Local AI Asset Validator
 * Verifies that the required offline assets for Qwen3-1.7B Q4_K_M and llama-server.exe
 * exist under models/local-ai/ before packaging or launching local AI.
 */

import fs from 'fs';
import path from 'path';
import type { LocalAiAssetVerification } from './types.js';

export const DEFAULT_LOCAL_AI_DIR = path.resolve(process.cwd(), 'models', 'local-ai');

/**
 * Validates presence of all 4 required local AI components:
 * 1. Runtime executable (llama-server.exe or llama-server)
 * 2. Model file (*.gguf)
 * 3. License notices (LICENSE / LICENSE.txt / NOTICES.txt)
 * 4. Model metadata (metadata.json / manifest.json)
 */
export function validateLocalAiAssets(customDir?: string): LocalAiAssetVerification {
  const targetDir = customDir ? path.resolve(customDir) : DEFAULT_LOCAL_AI_DIR;
  const missing: string[] = [];

  const verification: LocalAiAssetVerification = {
    valid: false,
    missing: [],
    details: {
      runtimePresent: false,
      modelPresent: false,
      licensePresent: false,
      metadataPresent: false,
    }
  };

  if (!fs.existsSync(targetDir)) {
    verification.missing.push(`Directory does not exist: ${targetDir}`);
    return verification;
  }

  // 1. Runtime executable check
  const runtimeWin = path.join(targetDir, 'llama-server.exe');
  const runtimePosix = path.join(targetDir, 'llama-server');
  if (fs.existsSync(runtimeWin)) {
    verification.details.runtimePresent = true;
    verification.details.runtimePath = runtimeWin;
  } else if (fs.existsSync(runtimePosix)) {
    verification.details.runtimePresent = true;
    verification.details.runtimePath = runtimePosix;
  } else {
    missing.push('Runtime executable missing (llama-server.exe / llama-server)');
  }

  // 2. GGUF Model check (specifically qwen3-1.7b-q4_k_m.gguf or any .gguf file)
  const candidateModels = [
    path.join(targetDir, 'qwen3-1.7b-q4_k_m.gguf'),
    path.join(targetDir, 'qwen3-1.7b.gguf'),
    path.join(targetDir, 'model.gguf')
  ];

  let foundModel = candidateModels.find(m => fs.existsSync(m));
  if (!foundModel) {
    // Scan directory for any .gguf file
    try {
      const files = fs.readdirSync(targetDir);
      const gguf = files.find(f => f.toLowerCase().endsWith('.gguf'));
      if (gguf) {
        foundModel = path.join(targetDir, gguf);
      }
    } catch (_) {}
  }

  if (foundModel) {
    verification.details.modelPresent = true;
    verification.details.modelPath = foundModel;
  } else {
    missing.push('Model file missing (qwen3-1.7b-q4_k_m.gguf or *.gguf)');
  }

  // 3. License notices check
  const candidateLicenses = [
    path.join(targetDir, 'LICENSE.txt'),
    path.join(targetDir, 'LICENSE'),
    path.join(targetDir, 'NOTICES.txt'),
    path.join(targetDir, 'THIRD_PARTY_LICENSES.txt')
  ];
  const foundLicense = candidateLicenses.find(l => fs.existsSync(l));
  if (foundLicense) {
    verification.details.licensePresent = true;
    verification.details.licensePath = foundLicense;
  } else {
    missing.push('License notice missing (LICENSE.txt or NOTICES.txt)');
  }

  // 4. Metadata check
  const candidateMetadata = [
    path.join(targetDir, 'metadata.json'),
    path.join(targetDir, 'manifest.json'),
    path.join(targetDir, 'model-metadata.json')
  ];
  const foundMetadata = candidateMetadata.find(m => fs.existsSync(m));
  if (foundMetadata) {
    verification.details.metadataPresent = true;
    verification.details.metadataPath = foundMetadata;
  } else {
    missing.push('Metadata missing (metadata.json or manifest.json)');
  }

  verification.missing = missing;
  verification.valid = missing.length === 0;

  return verification;
}

/**
 * Asserts all required local AI assets are present; throws if any are missing.
 */
export function assertLocalAiAssetsPresent(customDir?: string): void {
  const result = validateLocalAiAssets(customDir);
  if (!result.valid) {
    throw new Error(
      `[Local AI] Asset verification failed!\n` +
      `Directory: ${customDir || DEFAULT_LOCAL_AI_DIR}\n` +
      `Missing items:\n` +
      result.missing.map(m => ` - ${m}`).join('\n') +
      `\n\nRelease Limitation: The large GGUF model and llama-server.exe are not stored in Git.` +
      ` Provision all assets into models/local-ai/ before enabling or packaging.`
    );
  }
}

