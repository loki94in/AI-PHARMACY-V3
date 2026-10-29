#!/usr/bin/env node
/**
 * CLI verification script for offline Local AI assets (Qwen3-1.7B Q4_K_M + llama-server).
 * Usage:
 *   node scripts/verify-local-ai-assets.mjs          # Informative check
 *   node scripts/verify-local-ai-assets.mjs --strict # Exits with code 1 if assets are missing
 */

import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const customDirArg = process.argv.find((a, i) => i > 1 && !a.startsWith('--'));
const localAiDir = customDirArg
  ? path.resolve(customDirArg)
  : (process.env.LOCAL_AI_MODELS_DIR ? path.resolve(process.env.LOCAL_AI_MODELS_DIR) : path.resolve(rootDir, 'models', 'local-ai'));
const isStrict = process.argv.includes('--strict') || process.env.BUNDLE_LOCAL_AI === '1' || process.env.BUNDLE_LOCAL_AI === 'true';

console.log('\n=============================================================');
console.log(' Local AI Asset Verification (Qwen3-1.7B Q4_K_M)');
console.log(' Target directory:', localAiDir);
console.log(' Strict enforcement:', isStrict ? 'YES (BUNDLE_LOCAL_AI=1)' : 'NO (Advisory)');
console.log('=============================================================\n');

if (!fs.existsSync(localAiDir)) {
  console.log(`Directory does not exist: ${localAiDir}`);
  if (isStrict) {
    console.error('\n❌ ERROR: models/local-ai directory is missing!');
    console.error('The large GGUF model and llama-server.exe are not stored in Git.');
    console.error('Please provision assets into models/local-ai before building an offline installer.');
    process.exit(1);
  } else {
    console.log('Notice: Local AI directory not yet provisioned. (Normal for fresh git clone)');
    process.exit(0);
  }
}

const missing = [];
const found = [];

// 1. Runtime
const runtimeCandidates = ['llama-server.exe', 'llama-server'];
const foundRuntime = runtimeCandidates.find(f => fs.existsSync(path.join(localAiDir, f)));
if (foundRuntime) {
  found.push(`Runtime: ${foundRuntime}`);
} else {
  missing.push('Runtime executable (llama-server.exe / llama-server)');
}

// 2. GGUF Model
let foundModel = null;
try {
  const files = fs.readdirSync(localAiDir);
  const gguf = files.find(f => f.toLowerCase().endsWith('.gguf'));
  if (gguf) {
    const stats = fs.statSync(path.join(localAiDir, gguf));
    foundModel = `${gguf} (${(stats.size / (1024 * 1024)).toFixed(1)} MB)`;
  }
} catch (_) {}

if (foundModel) {
  found.push(`Model: ${foundModel}`);
} else {
  missing.push('Model GGUF file (qwen3-1.7b-q4_k_m.gguf or *.gguf)');
}

// 3. License Notice
const licenseCandidates = ['LICENSE.txt', 'LICENSE', 'NOTICES.txt', 'THIRD_PARTY_LICENSES.txt'];
const foundLicense = licenseCandidates.find(f => fs.existsSync(path.join(localAiDir, f)));
if (foundLicense) {
  found.push(`License: ${foundLicense}`);
} else {
  missing.push('License notices (LICENSE.txt or NOTICES.txt)');
}

// 4. Metadata
const metadataCandidates = ['metadata.json', 'manifest.json', 'model-metadata.json'];
const foundMetadata = metadataCandidates.find(f => fs.existsSync(path.join(localAiDir, f)));
if (foundMetadata) {
  found.push(`Metadata: ${foundMetadata}`);
} else {
  missing.push('Metadata manifest (metadata.json or manifest.json)');
}

// Output summary
console.log('Status:');
for (const item of found) {
  console.log(`  ✓ ${item}`);
}

if (missing.length > 0) {
  console.log('\nMissing Components:');
  for (const item of missing) {
    console.log(`  ✗ ${item}`);
  }

  if (isStrict) {
    console.error('\n❌ BUILD FAILED: BUNDLE_LOCAL_AI=1 requires all local AI assets to be present!');
    console.error('The large GGUF model and llama-server.exe are not stored in Git.');
    console.error('See docs/LOCAL_AI_OFFLINE_SETUP.md for offline asset layout and rollout instructions.');
    process.exit(1);
  } else {
    console.log('\n⚠️  Local AI assets are incomplete. Offline installer bundling will be skipped.');
    console.log('   (Set BUNDLE_LOCAL_AI=1 after provisioning assets under models/local-ai/)');
    process.exit(0);
  }
} else {
  console.log('\n🎉 All Local AI assets are present and ready for offline bundling!');
  process.exit(0);
}

