/**
 * Local AI Release Manifest Schema & Authenticity Verification
 * Validates cloud-hosted model manifests and enforces cryptographic security.
 */

import crypto from 'crypto';
import path from 'path';

export interface ManifestArtifact {
  filename: string;
  sha256: string; // 64-character lowercase hex string
  sizeBytes: number;
  url?: string; // HTTPS URL or relative path to asset base URL
  executable?: boolean;
}

export interface LocalAiReleaseManifest {
  schemaVersion: '1.0';
  releaseTag: string;
  model: {
    name: string;
    family: string;
    parameterSize: string;
    quantization: string;
    contextLength: number;
    artifact: ManifestArtifact;
  };
  runtime: {
    name: string;
    version: string;
    platform: string;
    artifact: ManifestArtifact;
  };
  license: {
    artifact: ManifestArtifact;
  };
  metadata: {
    artifact: ManifestArtifact;
  };
  signature?: string;
  publishedAt: string;
}

/**
 * Default trusted public key (PEM format) for verifying release manifest signatures.
 * Configurable via LOCAL_AI_PUBLIC_KEY env variable.
 */
export const DEFAULT_TRUSTED_PUBLIC_KEY = process.env.LOCAL_AI_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7p9Jp1nUeC9tVjB+8V2GgL4+fN9z
1l4U4h7vQ3kYg2x5M5jL1QW4aZ7y8wE2b9T8l9n6c3F1j6d9h7k4z8m2vA==
-----END PUBLIC KEY-----`;

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

/**
 * Sanitizes a filename from the manifest to prevent directory traversal.
 * Strictly forbids path separators, '..', null bytes, and non-basenames.
 */
export function sanitizeManifestFilename(rawFilename: string): string {
  if (!rawFilename || typeof rawFilename !== 'string') {
    throw new Error('Invalid artifact filename: string is required');
  }

  // Reject null bytes and path traversal patterns
  if (rawFilename.includes('\0') || rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
    throw new Error(`Potential path traversal attempt detected in filename: "${rawFilename}"`);
  }

  const base = path.basename(rawFilename.trim());
  if (!base || base === '.' || base === '..') {
    throw new Error(`Unsafe filename resolved: "${rawFilename}"`);
  }

  return base;
}

/**
 * Checks whether an asset URL is secure (HTTPS) or allowed in development.
 */
export function isSecureAssetUrl(urlStr: string, allowInsecureDev = false): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol === 'https:') return true;
    if (allowInsecureDev && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validates manifest structure and artifact fields.
 */
export function validateManifestStructure(data: unknown): { valid: boolean; manifest?: LocalAiReleaseManifest; error?: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Manifest must be a JSON object' };
  }

  const m = data as Partial<LocalAiReleaseManifest>;

  if (m.schemaVersion !== '1.0') {
    return { valid: false, error: `Unsupported schemaVersion: "${m.schemaVersion}". Expected "1.0"` };
  }

  if (!m.releaseTag || typeof m.releaseTag !== 'string') {
    return { valid: false, error: 'Manifest missing releaseTag' };
  }

  // Validate artifacts
  const artifactsToValidate = [
    { name: 'model', art: m.model?.artifact },
    { name: 'runtime', art: m.runtime?.artifact },
    { name: 'license', art: m.license?.artifact },
    { name: 'metadata', art: m.metadata?.artifact }
  ];

  for (const { name, art } of artifactsToValidate) {
    if (!art) {
      return { valid: false, error: `Manifest missing ${name}.artifact specification` };
    }
    try {
      art.filename = sanitizeManifestFilename(art.filename);
    } catch (err) {
      return { valid: false, error: `${name} artifact filename invalid: ${err instanceof Error ? err.message : err}` };
    }

    if (!art.sha256 || !SHA256_HEX_REGEX.test(art.sha256)) {
      return { valid: false, error: `${name} artifact has invalid SHA-256 hash format: "${art.sha256}"` };
    }
    art.sha256 = art.sha256.toLowerCase();

    if (typeof art.sizeBytes !== 'number' || art.sizeBytes <= 0) {
      return { valid: false, error: `${name} artifact sizeBytes must be a positive integer` };
    }
  }

  return { valid: true, manifest: m as LocalAiReleaseManifest };
}

/**
 * Cryptographically verifies manifest authenticity against a trusted public key or HMAC secret.
 */
export function verifyManifestAuthenticity(
  manifestJsonStr: string,
  signature: string,
  keyOrSecret: string = DEFAULT_TRUSTED_PUBLIC_KEY
): boolean {
  if (!manifestJsonStr || !signature || !keyOrSecret) return false;

  try {
    // 1. Try public key signature verification (ECDSA / RSA)
    if (keyOrSecret.includes('-----BEGIN PUBLIC KEY-----')) {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(manifestJsonStr);
      verifier.end();
      const sigBuffer = Buffer.from(signature, signature.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(signature) ? 'hex' : 'base64');
      return verifier.verify(keyOrSecret, sigBuffer);
    }

    // 2. Fallback to HMAC-SHA256 with pre-shared release secret
    const hmac = crypto.createHmac('sha256', keyOrSecret);
    hmac.update(manifestJsonStr);
    const expected = hmac.digest('hex');
    const givenClean = signature.toLowerCase().trim();
    if (expected.length !== givenClean.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(givenClean));
  } catch (err) {
    console.warn('[Local AI Manifest] Cryptographic signature check error:', err instanceof Error ? err.message : err);
    return false;
  }
}

