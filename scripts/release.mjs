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
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import axios from 'axios';

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
const bumpMajor        = args.includes('--major');
const bumpMinor        = args.includes('--minor');

// Set Inno Setup compression mode (default fast, max when explicitly asked)
if (isMaxCompression) {
  process.env.ISCC_COMPRESSION = 'lzma2/max';
} else if (!process.env.ISCC_COMPRESSION) {
  process.env.ISCC_COMPRESSION = 'lzma2/fast';
}

// Remote publishing is default whenever ADMIN_SECRET is available so running `npm run release` immediately notifies all client apps.
// Pass `--local` if you explicitly want a local-only installer build without publishing.
const isLocalExplicit = args.includes('--local');
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

console.log('\n=============================================================');
console.log(`🚀  AI Pharmacy OS — Release ${isRemote ? 'Publisher' : 'Builder'} (${tagName})`);
console.log(`🎯  Rollout Target: ${isPilot ? 'PILOT ONLY (Only test/pilot licensed PCs)' : 'ALL (Production — all customers)'}`);
console.log(`🌐  Mode: ${isRemote ? 'REMOTE (GitHub + Vercel)' : 'LOCAL ONLY (Installer & Update Package)'}`);
console.log(`⚙️   Build Mode: ${skipBuild ? 'SKIP BUILD (--skip-build)' : isClean ? 'CLEAN REBUILD (--clean)' : 'INCREMENTAL (fast cached)'}`);
console.log(`🗜️   Compression: ${process.env.ISCC_COMPRESSION || 'lzma2/fast'}`);
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

// ── Step 2: Locate installer — must contain the bumped version ──────────────
const step2Start = performance.now();
console.log('\n🔍 Step 2: Locating versioned installer...');
const bundleLocalAi = process.env.BUNDLE_LOCAL_AI === '1' || process.env.BUNDLE_LOCAL_AI === 'true';
const candidateNames = bundleLocalAi
  ? [`AI-Pharmacy-OS-Offline-Setup-${tagName}.exe`, `AI-Pharmacy-OS-Cloud-Setup-${tagName}.exe`, `AI-Pharmacy-OS-Portable-Setup-${tagName}.exe`]
  : [`AI-Pharmacy-OS-Cloud-Setup-${tagName}.exe`, `AI-Pharmacy-OS-Offline-Setup-${tagName}.exe`, `AI-Pharmacy-OS-Portable-Setup-${tagName}.exe`];

let expectedInstallerName = candidateNames.find(name => fs.existsSync(path.join(installerDir, name))) || candidateNames[0];
const installerExe = path.join(installerDir, expectedInstallerName);

if (!fs.existsSync(installerExe)) {
  // List what's actually there for diagnostics
  const found = fs.existsSync(installerDir) ? fs.readdirSync(installerDir) : [];
  console.error(`\n❌ STOP BUILD: Versioned installer not found: ${expectedInstallerName}`);
  console.error(`   Expected: ${installerExe}`);
  console.error(`   Found in dist/installer: ${found.join(', ') || '(empty)'}`);
  console.error('   This prevents a stale installer from being released. Fix the build and retry.');
  process.exit(1);
}
console.log(`✓ Installer: ${expectedInstallerName} (${formatElapsed(step2Start)})`);

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
  console.log('    • Publish to GitHub & Vercel : npm run release -- git vercel');
  console.log('=============================================================\n');
  process.exit(0);
}

// ── Step 4: Upload to GitHub Releases ───────────────────────────────────────
console.log('\n📤 Step 4: Uploading assets to GitHub Releases...');

const downloadUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/${expectedInstallerName}`;
const updatePackageUrl = `https://github.com/${ghRepo}/releases/download/${tagName}/${expectedZipName}`;
const releaseNotes = isPilot
  ? `AI Pharmacy OS ${tagName} — Pilot / Staging Release`
  : `AI Pharmacy OS ${tagName} — Production Release`;

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

    if (releaseExists) {
      console.log(`   Release ${tagName} already exists. Updating assets (--clobber)...`);
      execSync(`gh release upload ${tagName} "${installerExe}" --clobber`, { stdio: 'inherit', cwd: rootDir });
      execSync(`gh release upload ${tagName} "${updateZipPath}" --clobber`, { stdio: 'inherit', cwd: rootDir });
    } else {
      console.log(`   Creating new GitHub release ${tagName} via gh CLI...`);
      execSync(
        `gh release create ${tagName} "${installerExe}" "${updateZipPath}" --title "AI Pharmacy OS ${tagName}" --notes "${releaseNotes}"`,
        { stdio: 'inherit', cwd: rootDir }
      );
    }
    console.log('✓ GitHub upload complete via gh CLI (installer + update package).');
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
    console.log('   Uploading via GitHub REST API (token authenticated)...');
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

    const apkFile = path.join(rootDir, 'data', 'pharmacy-mobile.apk');
    const apkName = `AI-Pharmacy-Mobile-${tagName}.apk`;

    const assetsToUpload = [
      { filePath: installerExe, fileName: expectedInstallerName },
      { filePath: updateZipPath, fileName: expectedZipName },
    ];
    if (fs.existsSync(apkFile)) {
      assetsToUpload.push({ filePath: apkFile, fileName: apkName });
      console.log(`   Found mobile companion APK: ${apkName}`);
    }

    for (const { filePath, fileName } of assetsToUpload) {
      const fileSize = fs.statSync(filePath).size;
      // If asset already exists on this release, delete it first
      if (release.assets && release.assets.length > 0) {
        const existing = release.assets.find(a => a.name === fileName);
        if (existing) {
          console.log(`   Replacing existing asset ${fileName}...`);
          await axios.delete(`https://api.github.com/repos/${ghRepo}/releases/assets/${existing.id}`, { headers: ghHeaders });
        }
      }

      console.log(`   Uploading ${fileName} (${(fileSize / (1024 * 1024)).toFixed(1)} MB)...`);
      const fileStream = fs.createReadStream(filePath);
      await axios.post(
        `https://uploads.github.com/repos/${ghRepo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`,
        fileStream,
        {
          headers: {
            ...ghHeaders,
            'Content-Type': 'application/octet-stream',
            'Content-Length': fileSize,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );
      console.log(`   ✓ Uploaded ${fileName}`);
    }
    console.log('✓ GitHub REST API upload complete (installer + update package + APK if present).');
  } catch (apiErr) {
    console.error('\n❌ GitHub REST API upload failed:', apiErr.response?.data || apiErr.message);
    process.exit(1);
  }
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
try {
  const verify = await axios.get(`${vercelServer}/api/updates?action=check`, {
    params: { version: '0.0.0' },
    timeout: 10000,
  });
  if (verify.data.latestVersion !== version) {
    console.error(`\n❌ Verification FAILED: server reports latestVersion="${verify.data.latestVersion}", expected "${version}".`);
    console.error('   PCs will keep reporting "up to date" on the OLD version. Do not consider this release done.');
    process.exit(1);
  }
  console.log(`✓ Server confirmed: latestVersion="${verify.data.latestVersion}".`);
} catch (verifyErr) {
  console.error('\n❌ Could not verify publish — treat this release as NOT confirmed:', verifyErr?.response?.data || verifyErr.message);
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
