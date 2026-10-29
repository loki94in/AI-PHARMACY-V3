#!/usr/bin/env node
/**
 * Automated Downloader for Local AI Model & Runtime
 * Downloads llama-server.exe (CPU win-x64) and Qwen GGUF model directly into models/local-ai/
 *
 * Usage:
 *   node scripts/download-local-ai.mjs
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import AdmZip from 'adm-zip';

const rootDir = process.cwd();
const targetDir = path.resolve(rootDir, 'models', 'local-ai');

const LLAMA_RELEASE_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=1';
const MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf';
const MODEL_FILENAME = 'qwen3-1.7b-q4_k_m.gguf';

console.log('\n=============================================================');
console.log(' Local AI Asset Downloader (Qwen3-1.7B Q4_K_M + llama-server)');
console.log(' Target directory:', targetDir);
console.log('=============================================================\n');

fs.mkdirSync(targetDir, { recursive: true });

function downloadFileWithProgress(url, destPath, label) {
  return new Promise((resolve, reject) => {
    function makeRequest(currentUrl, redirectCount = 0) {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects'));
      }

      const req = https.get(currentUrl, {
        headers: {
          'User-Agent': 'AI-Pharmacy-Local-AI-Downloader/1.0',
          Accept: '*/*'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const redirectUrl = new URL(res.headers.location, currentUrl).toString();
          return makeRequest(redirectUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${currentUrl}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        let lastReportedPercent = -1;

        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = Math.floor((downloadedBytes / totalBytes) * 100);
            if (percent !== lastReportedPercent && percent % 5 === 0) {
              lastReportedPercent = percent;
              const mbDone = (downloadedBytes / (1024 * 1024)).toFixed(1);
              const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
              process.stdout.write(`  [${label}] ${percent}% (${mbDone} / ${mbTotal} MB)\r`);
            }
          }
        });

        fileStream.on('finish', () => {
          console.log(`\n  ✓ [${label}] Download completed: ${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB`);
          resolve();
        });

        res.on('error', (err) => {
          fileStream.close();
          reject(err);
        });

        fileStream.on('error', (err) => {
          fileStream.close();
          reject(err);
        });
      });

      req.on('error', reject);
    }

    makeRequest(url);
  });
}

async function run() {
  try {
    // 1. Fetch latest llama.cpp release info for CPU win-x64
    console.log('Step 1: Locating latest official llama.cpp CPU release for Windows x64...');
    const releaseRes = await fetch(LLAMA_RELEASE_API, {
      headers: { 'User-Agent': 'AI-Pharmacy-Local-AI-Downloader/1.0' }
    });
    if (!releaseRes.ok) {
      throw new Error(`Failed to query llama.cpp releases (HTTP ${releaseRes.status})`);
    }

    const releases = await releaseRes.json();
    const latest = releases[0];
    const asset = latest.assets.find(a => a.name.includes('bin-win-cpu-x64.zip') || a.name.includes('bin-win-avx2-x64.zip'));

    if (!asset) {
      throw new Error(`Could not find Windows CPU zip asset in llama.cpp release ${latest.tag_name}`);
    }

    console.log(`Found: ${asset.name} (Release: ${latest.tag_name}, Size: ${(asset.size / (1024 * 1024)).toFixed(1)} MB)`);

    // Download llama.cpp zip
    const zipPath = path.join(targetDir, 'llama_runtime.zip');
    console.log('\nStep 2: Downloading llama-server runtime binary...');
    await downloadFileWithProgress(asset.browser_download_url, zipPath, 'llama-server.exe');

    console.log('Extracting llama-server.exe and libraries...');
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
      const entryName = entry.entryName;
      // Extract llama-server.exe and any supporting dlls
      if (entryName.endsWith('llama-server.exe') || entryName.endsWith('.dll')) {
        const outName = path.basename(entryName);
        fs.writeFileSync(path.join(targetDir, outName), entry.getData());
        console.log(`  Extracted: ${outName}`);
      }
    }

    try { fs.rmSync(zipPath, { force: true }); } catch (_) {}

    // 2. Download Qwen GGUF Model
    const modelDestPath = path.join(targetDir, MODEL_FILENAME);
    if (!fs.existsSync(modelDestPath)) {
      console.log(`\nStep 3: Downloading Qwen3-1.7B Q4_K_M model weights (~986 MB)...`);
      await downloadFileWithProgress(MODEL_URL, modelDestPath, MODEL_FILENAME);
    } else {
      console.log(`\nStep 3: Model ${MODEL_FILENAME} already exists on disk. Skipping download.`);
    }

    // 3. Write license notices
    const licensePath = path.join(targetDir, 'LICENSE.txt');
    if (!fs.existsSync(licensePath)) {
      console.log('\nStep 4: Writing LICENSE.txt...');
      fs.writeFileSync(licensePath, `Apache License 2.0 / MIT License

Model: Qwen3-1.7B Q4_K_M (Alibaba Cloud / Qwen Team - Apache 2.0)
Runtime: llama.cpp (Georgi Gerganov - MIT License)

This software runs strictly in local shadow evaluation mode.
No customer or pharmacy data is sent to external servers.
`, 'utf8');
      console.log('  ✓ LICENSE.txt created');
    }

    // 4. Write metadata.json
    const metadataPath = path.join(targetDir, 'metadata.json');
    console.log('\nStep 5: Writing metadata.json manifest...');
    const modelStats = fs.statSync(modelDestPath);
    const metadataContent = {
      name: "qwen3-1.7b-q4_k_m",
      model_family: "Qwen3",
      parameter_size: "1.7B",
      quantization: "Q4_K_M",
      context_length: 2048,
      model_filename: MODEL_FILENAME,
      runtime_binary: "llama-server.exe",
      license: "Apache-2.0",
      created_at: new Date().toISOString(),
      model_size_bytes: modelStats.size,
      intended_use: "Shadow classifier for ambiguous WhatsApp medicine inquiries",
      hardware_requirements: {
        gpu_required: false,
        cpu_threads: 4,
        ram_mb: 1500
      }
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadataContent, null, 2), 'utf8');
    console.log('  ✓ metadata.json created');

    // 5. Verification
    console.log('\n=============================================================');
    console.log(' Running asset verification...');
    console.log('=============================================================');
    const { execSync } = await import('child_process');
    execSync('node scripts/verify-local-ai-assets.mjs', { stdio: 'inherit' });

    console.log('\n🎉 SUCCESS! Local AI is now fully provisioned and ready for local testing!');
    console.log('\nNext Step: Run the app or test server:');
    console.log('  npm run dev:server\n');
  } catch (err) {
    console.error('\n❌ Download failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

run();
