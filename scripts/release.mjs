#!/usr/bin/env node
/**
 * AI Pharmacy OS — Automated 1-Click Release & Rollout Script
 * PRODUCTION.md §19, §20, §30, §38
 *
 * Usage:
 *   npm run release            → Builds, uploads to GitHub, rolls out to ALL licensed PCs
 *   npm run release:pilot      → Builds, uploads to GitHub, rolls out ONLY to Pilot/Test PCs
 *   npm run release -- --promote  → Promotes existing PILOT release to ALL (no rebuild)
 *   npm run release -- --skip-build  → Skips build, uses existing dist artifacts
 */

import fs from 'fs';
import path from 'path';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import axios from 'axios';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir   = process.cwd();
const pkgPath   = path.join(rootDir, 'package.json');
const pkg       = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// Load .env from root directory if present so secrets/tokens are recognized
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

// ── Parse CLI flags ─────────────────────────────────────────────────────────
const args             = process.argv.slice(2);
const isPilot          = args.includes('--pilot')  || args.includes('-p');
const isPromote        = args.includes('--promote');
const skipBuild        = args.includes('--skip-build');
const skipGithub       = args.includes('--skip-github');
const isClean          = args.includes('--clean');
const isMaxCompression = args.includes('--max-compression');
const isFullInstaller  = args.includes('--full') || args.includes('--with-installer') || args.includes('--full-installer') || process.env.FULL_INSTALLER === '1';
const bumpMajor        = args.includes('--major');
const bumpMinor        = args.includes('--minor');

if (!isFullInstaller) {
  process.env.SKIP_INSTALLER = '1';
} else {
  process.env.SKIP_INSTALLER = '0';
}

// Set Inno Setup compression mode (default fast, max when explicitly asked)
if (isMaxCompression) {
  process.env.ISCC_COMPRESSION = 'lzma2/max';
} else if (!process.env.ISCC_COMPRESSION) {
  process.env.ISCC_COMPRESSION = 'lzma2/fast';
}

// Remote publishing is default whenever ADMIN_SECRET is available so running `npm run release` immediately notifies all client apps.
// Pass `--local` if you explicitly want a local-only installer build without publishing.
const isLocalExplicit = args.includes('--local') || args.includes('--offline') || args.includes('--no-remote') || args.includes('--no-vercel');
const isRemote = !isLocalExplicit && (Boolean(process.env.ADMIN_SECRET) || args.includes('--remote') || args.includes('--publish') || (args.includes('git') && args.includes('vercel')));

// ── Vercel / GitHub config ───────────────────────────────────────────────────
const vercelServer = process.env.LICENSE_SERVER_URL || 'https://website-woad-seven-26.vercel.app';
const adminSecret  = process.env.ADMIN_SECRET;
if ((isPromote || isRemote) && !adminSecret) {
  console.error('\n❌ STOP RELEASE: Missing required ADMIN_SECRET environment variable.');
  console.error('   Please set ADMIN_SECRET in your .env file or environment before running remote release.');
  process.exit(1);
}
const ghRepo       = 'loki94in/AI-PHARMACY-V3';

// ══════════════════════════════════════════════════════════════════════════════
// PROMOTE MODE: re-publish existing Pilot version to ALL — no rebuild needed
// PRODUCTION.md §18
// ══════════════════════════════════════════════════════════════════════════════
if (isPromote) {
  const currentVersion = pkg.version;
  const tagName        = `v${currentVersion}`;
  console.log('\n=============================================================');
  console.log(`🚀  AI Pharmacy OS — Promote Pilot → Production`);
  console.log(`📌  Version: ${tagName}`);
  console.log('=============================================================\n');

  // Verify current update server still reports this version
  console.log('🔎 Verifying update server has this version...');
  try {
    const check = await axios.get(`${vercelServer}/api/updates?action=check`, {
      params: { version: '0.0.0' },
      timeout: 10000,
    });
    if (check.data.latestVersion !== currentVersion) {
      console.error(`\n❌ Server reports latestVersion="${check.data.latestVersion}", expected "${currentVersion}".`);
      console.error('   Run npm run release:pilot first to publish this version, then promote.');
      process.exit(1);
    }
    console.log(`✓ Server has v${currentVersion}. Changing rolloutMode PILOT → ALL...`);
  } catch (err) {
    console.error('\n❌ Could not reach update server:', err.message);
    process.exit(1);
  }

  // Read manifest for downloadUrl / sha256
  const manifestPath = path.join(rootDir, 'dist', 'installer', 'update-manifest.json');
  let downloadUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/AI-Pharmacy-OS-Portable-Setup-${tagName}.exe`;
  let updatePackageUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/AI-Pharmacy-OS-Update-${tagName}.zip`;
  let sha256 = '';
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    sha256 = manifest.sha256 || '';
  }

  try {
    await axios.post(`${vercelServer}/api/updates?action=publish`, {
      latestVersion:    currentVersion,
      downloadUrl,
      updatePackageUrl,
      sha256,
      changelog:        `AI Pharmacy OS ${tagName} — Production Rollout`,
      rolloutMode:      'ALL',
      releaseType:      'production',
      releaseDate:      new Date().toISOString(),
      mandatory:        false,
    }, {
      headers: { 'x-admin-secret': adminSecret },
      timeout: 10000,
    });
  } catch (err) {
    console.error('\n❌ Promote publish to Vercel/KV FAILED — release is NOT live:', err?.response?.data || err.message);
    process.exit(1);
  }

  // Re-verify
  const verify = await axios.get(`${vercelServer}/api/updates?action=check`, {
    params: { version: '0.0.0' },
    timeout: 10000,
  });
  if (verify.data.latestVersion !== currentVersion) {
    console.error(`\n❌ Post-promote verification FAILED: server reports "${verify.data.latestVersion}".`);
    process.exit(1);
  }

  console.log('\n=============================================================');
  console.log(`🎉  PROMOTED: v${currentVersion} is now rolling out to ALL customers.`);
  console.log('=============================================================\n');
  process.exit(0);
}

// ══════════════════════════════════════════════════════════════════════════════
// NORMAL RELEASE FLOW
// ══════════════════════════════════════════════════════════════════════════════

// ── Auto-bump version (patch by default) on every release ───────────────────
// When skipping build, keep existing version on disk so it matches the compiled installer artifacts
const shouldBump = !args.includes('--no-bump') && !args.includes('--skip-bump') && !skipBuild;
let version;
if (shouldBump) {
  const [major, minor, patch] = (pkg.version || '0.1.0').split('.').map(Number);
  let newVersion;
  if (bumpMajor)      newVersion = `${major + 1}.0.0`;
  else if (bumpMinor) newVersion = `${major}.${minor + 1}.0`;
  else                newVersion = `${major}.${minor}.${patch + 1}`;

  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`\n📝 Version auto-bumped: ${major}.${minor}.${patch} → ${newVersion}`);
  version = newVersion;
} else {
  version = pkg.version || '0.1.0';
  console.log(`\n📌 Using current version: v${version} (--no-bump)`);
}

const tagName   = `v${version}`;
const rollout   = isPilot ? 'PILOT' : 'ALL';

// ── Timing stopwatch ────────────────────────────────────────────────────────
const releaseStartTime = performance.now();
const formatElapsed = (start) => `${((performance.now() - start) / 1000).toFixed(1)}s`;

// Local AI offline assets bundling: OPT-IN ONLY (defaults to lightweight fast releases).
// Bundled ONLY when explicitly commanded via BUNDLE_LOCAL_AI=1 or --bundle-local-ai / --offline.
const explicitCloudOnly = process.env.BUNDLE_LOCAL_AI === '0' || process.env.BUNDLE_LOCAL_AI === 'false' || args.includes('--no-local-ai') || args.includes('--cloud-only') || args.includes('--no-qwen') || args.includes('--offline');
const explicitOffline = process.env.BUNDLE_LOCAL_AI === '1' || process.env.BUNDLE_LOCAL_AI === 'true' || args.includes('--bundle-local-ai') || args.includes('--offline');
const bundleLocalAi = !explicitCloudOnly && explicitOffline;

if (bundleLocalAi) {
  process.env.BUNDLE_LOCAL_AI = '1';
} else {
  process.env.BUNDLE_LOCAL_AI = '0';
}

console.log('\n=============================================================');
console.log(`🚀  AI Pharmacy OS — Release ${isRemote ? 'Publisher' : 'Builder'} (${tagName})`);
console.log(`🎯  Rollout Target: ${isPilot ? 'PILOT ONLY (Only test/pilot licensed PCs)' : 'ALL (Production — all customers)'}`);
console.log(`🌐  Mode: ${isRemote ? 'REMOTE (GitHub + Vercel)' : 'LOCAL ONLY (Installer & Update Package)'}`);
console.log(`⚙️   Build Mode: ${skipBuild ? 'SKIP BUILD (--skip-build)' : isClean ? 'CLEAN REBUILD (--clean)' : 'INCREMENTAL (fast cached)'}`);
console.log(`📦  Package   : ${isFullInstaller ? 'FULL SETUP EXE + UPDATE ZIP (--full)' : 'FAST UPDATE-ONLY (~38 MB ZIP + ~1.7 MB WebSetup)'}`);
console.log(`🗜️   Compression: ${process.env.ISCC_COMPRESSION || 'lzma2/fast'}`);
console.log(`🧠  Local AI: ${bundleLocalAi ? 'BUNDLED OFFLINE (Qwen3-1.7B + llama-server)' : 'CLOUD DOWNLOAD (Lightweight installer)'}`);
console.log('=============================================================\n');

// ── Paths ───────────────────────────────────────────────────────────────────
const installerDir = path.join(rootDir, 'dist', 'installer');

// ── Step 1: Build ────────────────────────────────────────────────────────────
const step1Start = performance.now();
if (!skipBuild) {
  const buildCmd = isClean ? 'npm run build:exe:clean' : 'npm run build:exe:nobump';
  console.log(`📦 Step 1: Building application (${buildCmd})...`);
  execSync(buildCmd, { stdio: 'inherit', cwd: rootDir });
  console.log(`⏱️  Step 1 finished in ${formatElapsed(step1Start)}`);
} else {
  console.log('📦 Step 1: Skipping build (--skip-build).');
}

// ── Step 2: Locate installer (only required in --full mode) ──────────────────
const step2Start = performance.now();
console.log('\n🔍 Step 2: Checking installer artifacts...');
const candidateNames = bundleLocalAi
  ? [`AI-Pharmacy-OS-Offline-Setup-${tagName}.exe`, `AI-Pharmacy-OS-Cloud-Setup-${tagName}.exe`, `AI-Pharmacy-OS-Portable-Setup-${tagName}.exe`]
  : [`AI-Pharmacy-OS-Cloud-Setup-${tagName}.exe`, `AI-Pharmacy-OS-Offline-Setup-${tagName}.exe`, `AI-Pharmacy-OS-Portable-Setup-${tagName}.exe`];

let expectedInstallerName = candidateNames.find(name => fs.existsSync(path.join(installerDir, name))) || candidateNames[0];
const installerExe = path.join(installerDir, expectedInstallerName);

if (isFullInstaller) {
  if (!fs.existsSync(installerExe)) {
    const found = fs.existsSync(installerDir) ? fs.readdirSync(installerDir) : [];
    console.error(`\n❌ STOP BUILD: Versioned installer not found: ${expectedInstallerName}`);
    console.error(`   Expected: ${installerExe}`);
    console.error(`   Found in dist/installer: ${found.join(', ') || '(empty)'}`);
    console.error('   This prevents a stale installer from being released. Fix the build and retry.');
    process.exit(1);
  }
  console.log(`✓ Installer: ${expectedInstallerName} (${formatElapsed(step2Start)})`);
} else {
  console.log(`✓ Fast mode: skipped 639 MB full setup EXE (pass --full to build it).`);
}

// ── Step 3: Build update package + SHA-256 ──────────────────────────────────
const step3Start = performance.now();
console.log('\n📦 Step 3: Building update package...');
let updateManifest;
try {
  const { buildUpdatePackage } = await import('./build-update-package.mjs');
  updateManifest = await buildUpdatePackage();
} catch (pkgErr) {
  console.error('\n❌ STOP BUILD: Update package creation failed:', pkgErr.message);
  process.exit(1);
}

const updateZipPath = updateManifest.zipPath;
const sha256        = updateManifest.sha256;
const expectedZipName = `AI-Pharmacy-OS-Update-${tagName}.zip`;

if (!fs.existsSync(updateZipPath)) {
  console.error(`\n❌ STOP BUILD: Update zip not found after build: ${updateZipPath}`);
  process.exit(1);
}
console.log(`✓ Update ZIP: ${expectedZipName}`);
console.log(`✓ SHA-256: ${sha256}`);
console.log(`⏱️  Step 3 finished in ${formatElapsed(step3Start)}`);

// ── Step 3b: Build lightweight Web Stub Installer (~2.5 MB) ────────────────
const webSetupName = `AI-Pharmacy-OS-WebSetup-${tagName}.exe`;
const webSetupExe  = path.join(installerDir, webSetupName);
try {
  console.log('\n📦 Step 3b: Building Web Stub Installer...');
  execSync('npm run build:stub', { stdio: 'inherit', cwd: rootDir });
  if (fs.existsSync(webSetupExe)) {
    console.log(`✓ Web Stub Installer ready: ${webSetupName}`);
  }
} catch (stubErr) {
  console.warn('⚠️  Notice: Web Stub Installer build warning:', stubErr.message);
}

// ── Housekeeping: Retention pruning in dist/installer ──────────────────────
console.log('\n🧹 Housekeeping: Pruning old installer and update artifacts...');
try {
  if (fs.existsSync(installerDir)) {
    const files = fs.readdirSync(installerDir);
    const setupFiles = files
      .filter(f => f.startsWith('AI-Pharmacy-OS-Portable-Setup-') && f.endsWith('.exe'))
      .map(f => ({ name: f, path: path.join(installerDir, f), mtime: fs.statSync(path.join(installerDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const updateFiles = files
      .filter(f => f.startsWith('AI-Pharmacy-OS-Update-') && f.endsWith('.zip'))
      .map(f => ({ name: f, path: path.join(installerDir, f), mtime: fs.statSync(path.join(installerDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    let prunedCount = 0;
    let reclaimedBytes = 0;
    // Keep newest 2 setups, delete older
    for (const item of setupFiles.slice(2)) {
      try {
        const size = fs.statSync(item.path).size;
        fs.unlinkSync(item.path);
        reclaimedBytes += size;
        prunedCount++;
        console.log(`   - Pruned old setup: ${item.name} (${(size / (1024 * 1024)).toFixed(1)} MB)`);
      } catch (_) {}
    }
    // Keep newest 2 updates, delete older
    for (const item of updateFiles.slice(2)) {
      try {
        const size = fs.statSync(item.path).size;
        fs.unlinkSync(item.path);
        reclaimedBytes += size;
        prunedCount++;
        console.log(`   - Pruned old update: ${item.name} (${(size / (1024 * 1024)).toFixed(1)} MB)`);
      } catch (_) {}
    }
    if (prunedCount > 0) {
      console.log(`✓ Cleaned ${prunedCount} old files, reclaimed ${(reclaimedBytes / (1024 * 1024)).toFixed(1)} MB.`);
    } else {
      console.log('✓ No old artifacts to prune (kept newest 2 setups & updates).');
    }
  }
} catch (pruneErr) {
  console.warn('⚠️  Notice: Housekeeping prune warning:', pruneErr.message);
}

// ── Local Mode Exit ──────────────────────────────────────────────────────────
if (!isRemote) {
  console.log('\n=============================================================');
  console.log('🎉  LOCAL RELEASE BUILD COMPLETED & VERIFIED!');
  console.log(`    Version  : ${version}`);
  console.log(`    Rollout  : ${rollout}`);
  console.log(`    Installer: ${installerExe}`);
  console.log(`    Update   : ${updateZipPath}`);
  console.log(`    SHA-256  : ${sha256}`);
  console.log(`    Duration : ${formatElapsed(releaseStartTime)}`);
  console.log('\n💡  Fast Path & Release Options:');
  console.log('    • Re-publish without rebuild : npm run release -- --skip-build');
  console.log('    • Promote PILOT to ALL       : npm run release -- --promote');
  console.log('    • Force fresh full build     : npm run release -- --clean');
  console.log('    • Maximum compression        : npm run release -- --max-compression');
  console.log('    • Publish installer & updates : npm run release -- --remote');
  console.log('=============================================================\n');
  process.exit(0);
}

// ── Step 4: Upload to GitHub Releases ───────────────────────────────────────
console.log('\n📤 Step 4: Uploading assets to GitHub Releases...');

const webSetupUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/${webSetupName}`;
const updatePackageUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/${expectedZipName}`;
let downloadUrl = isFullInstaller
  ? `https://github.com/${ghRepo}/releases/download/${tagName}/${expectedInstallerName}`
  : webSetupUrl;

if (!isFullInstaller) {
  try {
    const prevCheck = await axios.get(`${vercelServer}/api/updates?action=check`, {
      params: { version: '0.0.0' },
      timeout: 5000,
    });
    if (prevCheck.data?.downloadUrl && typeof prevCheck.data.downloadUrl === 'string' && prevCheck.data.downloadUrl.startsWith('http')) {
      downloadUrl = prevCheck.data.downloadUrl;
      console.log(`   Preserving existing full installer URL: ${downloadUrl}`);
    }
  } catch (_) {
    // Fallback to webSetupUrl if server check fails
  }
}

const releaseNotes = isPilot
  ? `AI Pharmacy OS ${tagName} — Pilot / Staging Release`
  : `AI Pharmacy OS ${tagName} — Production Release`;

const apkFile = path.join(rootDir, 'data', 'pharmacy-mobile.apk');
const apkName = `AI-Pharmacy-Mobile-${tagName}.apk`;

const assetsToUpload = [
  { filePath: updateZipPath, fileName: expectedZipName },
];
if (isFullInstaller && fs.existsSync(installerExe)) {
  assetsToUpload.push({ filePath: installerExe, fileName: expectedInstallerName });
}
if (fs.existsSync(webSetupExe)) {
  assetsToUpload.push({ filePath: webSetupExe, fileName: webSetupName });
  console.log(`   Found Web Stub installer: ${webSetupName}`);
}
if (isFullInstaller && fs.existsSync(apkFile)) {
  assetsToUpload.push({ filePath: apkFile, fileName: apkName });
  console.log(`   Found mobile companion APK: ${apkName}`);
}

let uploadedViaGh = false;
let hasGhCli = false;
try {
  execSync('gh --version', { stdio: 'ignore' });
  hasGhCli = true;
} catch (_) {
  hasGhCli = false;
}

if (skipGithub) {
  console.log('   ⏩ Skipping GitHub asset upload (--skip-github specified).');
} else if (hasGhCli) {
  try {
    let releaseExists = false;
    try {
      execSync(`gh release view ${tagName}`, { stdio: 'ignore' });
      releaseExists = true;
    } catch (_) {}

    const quotedAssets = assetsToUpload.map(a => `"${a.filePath}"`).join(' ');
    if (releaseExists) {
      console.log(`   Release ${tagName} already exists. Uploading ${assetsToUpload.length} asset(s) (--clobber)...`);
      execSync(`gh release upload ${tagName} ${quotedAssets} --clobber`, { stdio: 'inherit', cwd: rootDir });
    } else {
      console.log(`   Creating new GitHub release ${tagName} via gh CLI (${assetsToUpload.length} asset(s))...`);
      execSync(
        `gh release create ${tagName} ${quotedAssets} --title "AI Pharmacy OS ${tagName}" --notes "${releaseNotes}"`,
        { stdio: 'inherit', cwd: rootDir }
      );
    }
    console.log(`✓ GitHub upload complete via gh CLI (${assetsToUpload.map(a => a.fileName).join(', ')}).`);
    uploadedViaGh = true;
  } catch (ghErr) {
    console.warn(`   Notice: gh CLI upload failed (${ghErr.message}). Attempting GitHub REST API fallback...`);
  }
}

if (!skipGithub && !uploadedViaGh) {
  let ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!ghToken) {
    try {
      const creds = execSync('git credential fill', {
        input: 'protocol=https\nhost=github.com\n\n',
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const pwLine = creds.split('\n').find(l => l.startsWith('password='));
      if (pwLine) ghToken = pwLine.slice(9).trim();
    } catch (_) {}
  }
  if (!ghToken) {
    console.warn('\n⚠️  Notice: GitHub asset upload skipped:');
    console.warn('   1. GitHub CLI (`gh`) is not installed or authenticated (`gh auth login`).');
    console.warn('   2. OR set GITHUB_TOKEN=... in your .env file or environment (needs repo permissions).');
    console.warn(`   Direct download URLs that will be expected once uploaded:`);
    console.warn(`     - Installer : ${downloadUrl}`);
    console.warn(`     - Update ZIP: ${updatePackageUrl}`);
    console.warn('   Proceeding to publish version metadata to update server...\n');
  } else {
    console.log(`   Uploading ${assetsToUpload.length} asset(s) in parallel via GitHub REST API...`);
    const ghHeaders = {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'AI-Pharmacy-Release-Builder',
    };

    try {
      let release;
      try {
        const getRes = await axios.get(`https://api.github.com/repos/${ghRepo}/releases/tags/${tagName}`, { headers: ghHeaders });
        release = getRes.data;
        console.log(`   Found existing release ${tagName} (ID: ${release.id})`);
      } catch (err) {
        if (err.response?.status === 404) {
          console.log(`   Creating release ${tagName}...`);
          const createRes = await axios.post(
            `https://api.github.com/repos/${ghRepo}/releases`,
            {
              tag_name: tagName,
              name: `AI Pharmacy OS ${tagName}`,
              body: releaseNotes,
              draft: false,
              prerelease: isPilot,
            },
            { headers: ghHeaders }
          );
          release = createRes.data;
          console.log(`   Release created (ID: ${release.id})`);
        } else {
          throw err;
        }
      }

      let hasCurl = false;
      try {
        execSync('curl.exe --version', { stdio: 'ignore' });
        hasCurl = true;
      } catch (_) {}

      await Promise.all(assetsToUpload.map(async ({ filePath, fileName }) => {
        const fileSize = fs.statSync(filePath).size;
        if (release.assets && release.assets.length > 0) {
          const existing = release.assets.find(a => a.name === fileName);
          if (existing) {
            console.log(`   Replacing existing asset ${fileName}...`);
            await axios.delete(`https://api.github.com/repos/${ghRepo}/releases/assets/${existing.id}`, { headers: ghHeaders });
          }
        }

        console.log(`   Uploading ${fileName} (${(fileSize / (1024 * 1024)).toFixed(1)} MB)...`);
        const uploadUrl = `https://uploads.github.com/repos/${ghRepo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`;
        let uploadSuccess = false;
        if (hasCurl) {
          try {
            await execFileAsync('curl.exe', [
              '-f', '-s', '-S', '-L', '-X', 'POST',
              '-T', filePath,
              '-H', `Authorization: Bearer ${ghToken}`,
              '-H', 'Content-Type: application/octet-stream',
              '-H', 'Accept: application/vnd.github.v3+json',
              '--retry', '3', '--retry-delay', '5',
              uploadUrl,
            ], { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 });
            uploadSuccess = true;
          } catch (curlErr) {
            console.warn(`   ⚠️ curl.exe upload failed for ${fileName} (${curlErr.message}), falling back to axios...`);
          }
        }
        if (!uploadSuccess) {
          const fileStream = fs.createReadStream(filePath);
          await axios.post(uploadUrl, fileStream, {
            headers: {
              ...ghHeaders,
              'Content-Type': 'application/octet-stream',
              'Content-Length': fileSize,
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          });
        }
        console.log(`   ✓ Uploaded ${fileName}`);
      }));
      console.log('✓ GitHub REST API parallel upload complete.');
    } catch (apiErr) {
      console.error('\n❌ GitHub REST API upload failed:', apiErr.response?.data || apiErr.message);
      process.exit(1);
    }
  }
}

// ── Step 4b: Pre-warm GitHub Release CDN edge before announcing update ──────
if (!skipGithub) {
  console.log('\n🔥 Step 4b: Pre-warming GitHub Release CDN edge for update ZIP...');
  const warmStart = performance.now();
  try {
    const warmRes = await axios.get(updatePackageUrl, {
      responseType: 'stream',
      timeout: 90_000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'AI-Pharmacy-Release-Prewarm/1.0' },
    });
    let warmBytes = 0;
    await new Promise((resolve, reject) => {
      warmRes.data.on('data', (chunk) => { warmBytes += chunk.length; });
      warmRes.data.on('end', resolve);
      warmRes.data.on('error', reject);
    });
    const warmSec = Math.max(0.01, (performance.now() - warmStart) / 1000);
    console.log(`✓ CDN edge warm: ${(warmBytes / (1024 * 1024)).toFixed(2)} MB in ${warmSec.toFixed(1)}s (${(warmBytes / 1024 / warmSec).toFixed(0)} KB/s).`);
  } catch (warmErr) {
    console.warn(`⚠️  Notice: CDN pre-warm skipped (${warmErr.message}) — release still proceeds.`);
  }
}

// ── Step 5: Publish metadata to Vercel/Redis ─────────────────────────────────
console.log('\n🌐 Step 5: Publishing version metadata to update server...');
console.log(`   Server       : ${vercelServer}`);
console.log(`   Version      : ${version}`);
console.log(`   Rollout      : ${rollout}`);
console.log(`   Installer URL: ${downloadUrl}`);
console.log(`   Update URL   : ${updatePackageUrl}`);
console.log(`   SHA-256      : ${sha256}`);

try {
  await axios.post(`${vercelServer}/api/updates?action=publish`, {
    latestVersion:    version,
    downloadUrl,
    updatePackageUrl,
    sha256,
    changelog:        `AI Pharmacy OS ${tagName}\n• Production-stable installer\n• Auto background update\n• Safe updater with rollback`,
    rolloutMode:      rollout,
    releaseType:      isPilot ? 'pilot' : 'production',
    releaseDate:      new Date().toISOString(),
    mandatory:        false,
  }, {
    headers: { 'x-admin-secret': adminSecret },
    timeout: 10000,
  });
} catch (publishErr) {
  // PRODUCTION.md §20 — GitHub asset uploaded but update server NOT published → RELEASE NOT LIVE
  console.error('\n❌ RELEASE NOT LIVE: Publish to Vercel/KV FAILED — no PC will detect this update.');
  console.error('   GitHub assets ARE uploaded. The update-check server was NOT updated.');
  console.error('   Reason:', publishErr?.response?.data || publishErr.message);
  console.error(`   Installer URL: ${downloadUrl}`);
  console.error('   Fix ADMIN_SECRET / LICENSE_SERVER_URL and re-run with --skip-build, or publish manually.');
  process.exit(1);
}

// ── Step 6: Verify server now reports the new version ───────────────────────
console.log('\n🔎 Step 6: Verifying update server reports new version...');
let verified = false;
let lastServerVersion = '';
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const verify = await axios.get(`${vercelServer}/api/updates?action=check`, {
      params: { version: '0.0.0', _t: Date.now() },
      timeout: 10000,
    });
    lastServerVersion = verify.data?.latestVersion;
    if (lastServerVersion === version) {
      verified = true;
      console.log(`✓ Server confirmed: latestVersion="${verify.data.latestVersion}".`);
      break;
    }
  } catch (err) {
    // retry
  }
  if (attempt < 4) {
    console.log(`   Waiting for edge replication (attempt ${attempt}/4)...`);
    await new Promise(r => setTimeout(r, 2000));
  }
}
if (!verified) {
  console.error(`\n❌ Verification FAILED: server reports latestVersion="${lastServerVersion}", expected "${version}".`);
  console.error('   PCs will keep reporting "up to date" on the OLD version. Do not consider this release done.');
  process.exit(1);
}

// ── Success summary ──────────────────────────────────────────────────────────
console.log('\n=============================================================');
console.log('🎉  RELEASE PUBLISHED & VERIFIED!');
console.log(`    Version  : ${version}`);
console.log(`    Rollout  : ${rollout}`);
console.log(`    Installer: ${downloadUrl}`);
console.log(`    Update   : ${updatePackageUrl}`);
console.log(`    SHA-256  : ${sha256}`);
console.log(`    Duration : ${formatElapsed(releaseStartTime)}`);
if (isPilot) {
  console.log('\n🔒  Status: PILOT MODE.');
  console.log('    Only Pilot-licensed PCs will receive this update.');
  console.log('    All other customers stay on their current version.');
  console.log(`    Once tested, run: npm run release -- --promote`);
  console.log('    (promotes the EXACT same build to ALL — no rebuild)');
} else {
  console.log('\n🌍  Status: PRODUCTION MODE.');
  console.log('    Every licensed PC will auto-detect and safely update.');
}
console.log('=============================================================\n');
