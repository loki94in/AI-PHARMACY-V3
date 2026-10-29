#!/usr/bin/env node
/**
 * Cloudflare R2 Publisher & Manifest Generator for Local AI Assets
 *
 * Verifies local AI assets (Qwen GGUF model + llama-server runtime), computes
 * exact cryptographic SHA-256 checksums and byte sizes, generates the canonical
 * manifest.json, and prints step-by-step instructions or direct AWS CLI / Wrangler commands
 * to publish into your Cloudflare R2 bucket.
 *
 * Usage:
 *   node scripts/publish-local-ai-to-r2.mjs
 *   node scripts/publish-local-ai-to-r2.mjs --r2-url=https://models.yourdomain.com
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const rootDir = process.cwd();
const localAiDir = path.resolve(rootDir, 'models', 'local-ai');

function getArgValue(flag) {
  const arg = process.argv.find(a => a.startsWith(`${flag}=`));
  return arg ? arg.split('=')[1].trim() : null;
}

const customR2Url = getArgValue('--r2-url') || process.env.LOCAL_AI_ASSET_BASE_URL || process.env.R2_PUBLIC_URL || '';

console.log('\n=============================================================');
console.log(' Cloudflare R2 Publisher & Manifest Generator (Local AI)');
console.log(' Asset directory :', localAiDir);
if (customR2Url) {
  console.log(' R2 Public URL   :', customR2Url);
}
console.log('=============================================================\n');

if (!fs.existsSync(localAiDir)) {
  console.error(`❌ ERROR: Directory does not exist: ${localAiDir}`);
  process.exit(1);
}

function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', reject);
  });
}

async function run() {
  const files = fs.readdirSync(localAiDir);

  // 1. Locate GGUF model
  const modelFile = files.find(f => f.toLowerCase().endsWith('.gguf'));
  if (!modelFile) {
    console.error('❌ ERROR: No .gguf model found in models/local-ai/');
    process.exit(1);
  }

  // 2. Locate Runtime
  const runtimeFile = files.find(f => f === 'llama-server.exe' || f === 'llama-server');
  if (!runtimeFile) {
    console.error('❌ ERROR: No llama-server executable found in models/local-ai/');
    process.exit(1);
  }

  // 3. Locate License
  const licenseFile = files.find(f => f.toUpperCase().startsWith('LICENSE') || f.toUpperCase().startsWith('NOTICES'));
  if (!licenseFile) {
    console.error('❌ ERROR: No LICENSE notice file found in models/local-ai/');
    process.exit(1);
  }

  // 4. Locate Metadata
  const metadataFile = files.find(f => f === 'metadata.json');
  if (!metadataFile) {
    console.error('❌ ERROR: No metadata.json found in models/local-ai/');
    process.exit(1);
  }

  console.log('Calculating cryptographic hashes and file sizes...');

  const modelPath = path.join(localAiDir, modelFile);
  const runtimePath = path.join(localAiDir, runtimeFile);
  const licensePath = path.join(localAiDir, licenseFile);
  const metadataPath = path.join(localAiDir, metadataFile);

  const [modelSha, runtimeSha, licenseSha, metadataSha] = await Promise.all([
    computeFileSha256(modelPath),
    computeFileSha256(runtimePath),
    computeFileSha256(licensePath),
    computeFileSha256(metadataPath),
  ]);

  const modelStats = fs.statSync(modelPath);
  const runtimeStats = fs.statSync(runtimePath);
  const licenseStats = fs.statSync(licensePath);
  const metadataStats = fs.statSync(metadataPath);

  const cleanBase = customR2Url ? customR2Url.replace(/\/+$/, '') : '';

  const manifest = {
    schemaVersion: '1.0',
    releaseTag: 'v1.0.0',
    model: {
      name: modelFile.replace('.gguf', ''),
      family: 'Qwen3',
      parameterSize: '1.7B',
      quantization: 'Q4_K_M',
      contextLength: 2048,
      artifact: {
        filename: modelFile,
        sha256: modelSha,
        sizeBytes: modelStats.size,
        url: cleanBase ? `${cleanBase}/${modelFile}` : modelFile
      }
    },
    runtime: {
      name: 'llama-server',
      version: 'b11979',
      platform: 'win-cpu-x64',
      artifact: {
        filename: runtimeFile,
        sha256: runtimeSha,
        sizeBytes: runtimeStats.size,
        executable: true,
        url: cleanBase ? `${cleanBase}/${runtimeFile}` : runtimeFile
      }
    },
    license: {
      artifact: {
        filename: licenseFile,
        sha256: licenseSha,
        sizeBytes: licenseStats.size,
        url: cleanBase ? `${cleanBase}/${licenseFile}` : licenseFile
      }
    },
    metadata: {
      artifact: {
        filename: metadataFile,
        sha256: metadataSha,
        sizeBytes: metadataStats.size,
        url: cleanBase ? `${cleanBase}/${metadataFile}` : metadataFile
      }
    },
    publishedAt: new Date().toISOString()
  };

  const manifestPath = path.join(localAiDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log('\n✓ Generated canonical manifest.json successfully:');
  console.log(`  - Model   : ${modelFile} (${(modelStats.size / (1024 * 1024)).toFixed(1)} MB) | SHA: ${modelSha.slice(0, 16)}...`);
  console.log(`  - Runtime : ${runtimeFile} (${(runtimeStats.size / 1024).toFixed(1)} KB) | SHA: ${runtimeSha.slice(0, 16)}...`);
  console.log(`  - License : ${licenseFile} (${licenseStats.size} bytes)`);
  console.log(`  - Metadata: ${metadataFile} (${metadataStats.size} bytes)`);

  console.log('\n=============================================================');
  console.log(' Cloudflare R2 Upload Checklist');
  console.log('=============================================================');
  console.log('1. In your Cloudflare Dashboard -> R2 -> [your-bucket]:');
  console.log('   Upload the following files to the ROOT of the bucket:');
  console.log(`     • ${modelFile}`);
  console.log(`     • ${runtimeFile}`);
  console.log(`     • ${licenseFile}`);
  console.log(`     • ${metadataFile}`);
  console.log(`     • manifest.json`);
  console.log('\n2. Configure .env on the client/server:');
  if (cleanBase) {
    console.log(`     LOCAL_AI_ASSET_BASE_URL=${cleanBase}`);
    console.log(`     LOCAL_AI_MANIFEST_URL=${cleanBase}/manifest.json`);
  } else {
    console.log('     LOCAL_AI_ASSET_BASE_URL=https://<your-r2-subdomain-or-custom-domain>');
    console.log('     LOCAL_AI_MANIFEST_URL=https://<your-r2-subdomain-or-custom-domain>/manifest.json');
  }
  console.log('\n3. Optional: Upload via AWS S3 CLI with R2 credentials:');
  console.log('   aws s3 cp models/local-ai/ s3://<your-bucket>/ --recursive --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com --exclude "*" --include "*.gguf" --include "*.exe" --include "*.json" --include "*.txt"\n');
}

run().catch(err => {
  console.error('Fatal error generating R2 manifest:', err);
  process.exit(1);
});

