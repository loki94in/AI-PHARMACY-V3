#!/usr/bin/env node
/**
 * AI Pharmacy OS — Automated 1-Click Release & Rollout Script
 *
 * Usage:
 *   npm run release          -> Builds, uploads to GitHub, rolls out to ALL licensed PCs
 *   npm run release:pilot    -> Builds, uploads to GitHub, rolls out ONLY to Pilot/Test licensed PCs
 *   npm run release -- --skip-build   -> Skips build, uploads existing installer to GitHub & Vercel
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import axios from 'axios';

const rootDir = process.cwd();
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// Parse CLI flags
const args = process.argv.slice(2);
const isPilot   = args.includes('--pilot')  || args.includes('-p');
const skipBuild = args.includes('--skip-build');
const bumpMajor = args.includes('--major');
const bumpMinor = args.includes('--minor');

// --- Auto-bump version (patch by default) ---
const [major, minor, patch] = (pkg.version || '0.1.0').split('.').map(Number);
let newVersion;
if (bumpMajor)      newVersion = `${major + 1}.0.0`;
else if (bumpMinor) newVersion = `${major}.${minor + 1}.0`;
else                newVersion = `${major}.${minor}.${patch + 1}`; // patch (default)

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`\n📝 Version bumped: ${major}.${minor}.${patch} → ${newVersion}`);

const version = newVersion;
const tagName = `v${version}`;

console.log('\n=============================================================');
console.log(`🚀  AI Pharmacy OS — Release Publisher (${tagName})`);
console.log(`🎯  Rollout Target: ${isPilot ? 'PILOT ONLY (Only test/pilot licensed PCs)' : 'ALL (Production - all customers)'}`);
console.log('=============================================================\n');

// 1. Locate or build installer
const installerDir = path.join(rootDir, 'dist', 'installer');
let installerExe = null;

if (fs.existsSync(installerDir)) {
  const files = fs.readdirSync(installerDir);
  const matched = files.find(f => f.endsWith('.exe') && f.includes('Setup'));
  if (matched) installerExe = path.join(installerDir, matched);
}

if (!installerExe || !skipBuild) {
  console.log('📦 Step 1: Building standalone installer (npm run build:exe)...');
  execSync('npm run build:exe', { stdio: 'inherit', cwd: rootDir });
  if (fs.existsSync(installerDir)) {
    const files = fs.readdirSync(installerDir);
    const matched = files.find(f => f.endsWith('.exe') && f.includes('Setup'));
    if (matched) installerExe = path.join(installerDir, matched);
  }
} else {
  console.log('📦 Step 1: Using existing built installer (--skip-build)...');
}

if (!installerExe || !fs.existsSync(installerExe)) {
  console.error('\n❌ Installer not found in dist/installer. Aborting.');
  process.exit(1);
}

console.log(`✓ Installer file ready: ${path.basename(installerExe)}`);

// 2. Upload to GitHub Releases via gh CLI
console.log('\n📤 Step 2: Uploading asset to GitHub Releases...');
try {
  let releaseExists = false;
  try {
    execSync(`gh release view ${tagName}`, { stdio: 'ignore' });
    releaseExists = true;
  } catch (_) {}

  if (releaseExists) {
    console.log(`   Release ${tagName} already exists on GitHub. Updating asset (--clobber)...`);
    execSync(`gh release upload ${tagName} "${installerExe}" --clobber`, { stdio: 'inherit', cwd: rootDir });
  } else {
    console.log(`   Creating new GitHub release ${tagName}...`);
    const notes = isPilot
      ? `AI Pharmacy OS ${tagName} — Pilot / Staging Release`
      : `AI Pharmacy OS ${tagName} — Production Release`;
    execSync(`gh release create ${tagName} "${installerExe}" --title "AI Pharmacy OS ${tagName}" --notes "${notes}"`, { stdio: 'inherit', cwd: rootDir });
  }
  console.log('✓ Upload to GitHub complete.');
} catch (ghErr) {
  console.error('\n❌ GitHub upload failed. Ensure \`gh auth status\` is authenticated:', ghErr.message);
  process.exit(1);
}

// 3. Publish metadata to Vercel/Redis
const downloadUrl = `https://github.com/loki94in/AI-PHARMACY-V3/releases/download/${tagName}/${path.basename(installerExe)}`;
const vercelServer = process.env.LICENSE_SERVER_URL || 'https://ai-pharmacy-license.vercel.app';
const adminSecret = process.env.ADMIN_SECRET || 'admin@pharmacy2026';

console.log('\n🌐 Step 3: Publishing version metadata to Vercel & Redis...');
console.log(`   Server: ${vercelServer}`);
console.log(`   Download URL: ${downloadUrl}`);
console.log(`   Rollout Mode: ${isPilot ? 'PILOT' : 'ALL'}`);

try {
  await axios.post(`${vercelServer}/api/updates?action=publish`, {
    latestVersion: version,
    downloadUrl,
    changelog: `AI Pharmacy OS ${tagName}\n• Auto fullscreen launch\n• Clean shutdown on Exit App\n• Safe 1-click in-place update`,
    rolloutMode: isPilot ? 'PILOT' : 'ALL',
  }, {
    headers: { 'x-admin-secret': adminSecret },
    timeout: 10000,
  });

  console.log('\n=============================================================');
  console.log('🎉  RELEASE PUBLISHED SUCCESSFULLY!');
  if (isPilot) {
    console.log('🔒  Status: In PILOT MODE.');
    console.log('    Only licensed PCs marked as "Pilot" will receive this update.');
    console.log('    All other customer PCs will stay on their current version.');
    console.log('    Once tested, run \`npm run release\` to roll out to EVERYONE.');
  } else {
    console.log('🌍  Status: In PRODUCTION MODE.');
    console.log('    Every customer PC will auto-detect and update within 24 hours.');
  }
  console.log('=============================================================\n');
} catch (publishErr) {
  console.warn('\n⚠️  Could not reach Vercel API automatically:', publishErr?.response?.data || publishErr.message);
  console.log(`   Asset is live on GitHub: ${downloadUrl}`);
  console.log(`   You can publish directly from https://ai-pharmacy-os.vercel.app/license`);
}
