#!/usr/bin/env node
/**
 * scripts/flip-electron-fuses.mjs
 *
 * Hardens the packaged Electron runtime (PharmacyOS.exe) using @electron/fuses.
 * PRODUCTION.md §13, §21; Auto-Update Reverse Engineering Report
 *
 * Security Policies Enforced:
 *  - RunAsNode: DISABLED (Prevents arbitrary JS execution via ELECTRON_RUN_AS_NODE=1)
 *  - EnableCookieEncryption: ENABLED (Encrypts Chromium cookies on disk with OS DPAPI)
 *  - EnableNodeOptionsEnvironmentVariable: DISABLED (Blocks malicious NODE_OPTIONS injection)
 *  - EnableNodeCliInspectArguments: DISABLED (Blocks --inspect debugging flags in production)
 *  - GrantFileProtocolExtraPrivileges: DISABLED (Restricts file:// URLs to standard browser policy)
 *  - EnableEmbeddedAsarIntegrityValidation: DISABLED (Retains unpacked resources/app compatibility for Updater.bat)
 *  - OnlyLoadAppFromAsar: DISABLED (Retains unpacked resources/app compatibility for Updater.bat)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { flipFuses, FuseVersion, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export async function hardenElectronBinary(targetExePath, { silent = false } = {}) {
  const fullPath = path.resolve(targetExePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Target executable not found: ${fullPath}`);
  }

  if (!silent) {
    console.log(`[fuses] Flipping security fuses on: ${path.basename(fullPath)}`);
  }

  await flipFuses(fullPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: false,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  });

  const wire = await getCurrentFuseWire(fullPath, FuseVersion.V1);
  if (!silent) {
    console.log('[fuses] ✓ Security fuses flipped successfully.');
    console.log('         RunAsNode:                             DISABLED (0)');
    console.log('         EnableCookieEncryption:                ENABLED  (1)');
    console.log('         EnableNodeOptionsEnvironmentVariable:  DISABLED (0)');
    console.log('         EnableNodeCliInspectArguments:         DISABLED (0)');
    console.log('         GrantFileProtocolExtraPrivileges:      DISABLED (0)');
    console.log('         EnableEmbeddedAsarIntegrityValidation: PRESERVED (unpacked app support)');
    console.log('         OnlyLoadAppFromAsar:                   PRESERVED (unpacked app support)');
  }

  return wire;
}

export async function verifyElectronFuses(targetExePath) {
  const fullPath = path.resolve(targetExePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Target executable not found: ${fullPath}`);
  }

  const wire = await getCurrentFuseWire(fullPath, FuseVersion.V1);
  console.log(`[fuses] Fuse state for ${path.basename(fullPath)}:`);
  console.log(`  RunAsNode:                            ${wire['0'] === 49 ? 'ENABLED (insecure)' : 'DISABLED (secure)'}`);
  console.log(`  EnableCookieEncryption:               ${wire['1'] === 49 ? 'ENABLED (secure)' : 'DISABLED (insecure)'}`);
  console.log(`  EnableNodeOptionsEnvironmentVariable: ${wire['2'] === 49 ? 'ENABLED (insecure)' : 'DISABLED (secure)'}`);
  console.log(`  EnableNodeCliInspectArguments:        ${wire['3'] === 49 ? 'ENABLED (insecure)' : 'DISABLED (secure)'}`);
  console.log(`  GrantFileProtocolExtraPrivileges:     ${wire['7'] === 49 ? 'ENABLED (insecure)' : 'DISABLED (secure)'}`);
  return wire;
}

// CLI runner
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  let target = path.join(rootDir, 'dist', 'PharmacyOS.exe');
  const targetIdx = args.indexOf('--target');
  if (targetIdx !== -1 && args[targetIdx + 1]) {
    target = args[targetIdx + 1];
  }

  const verifyOnly = args.includes('--verify') || args.includes('--verify-only');

  (async () => {
    try {
      if (verifyOnly) {
        await verifyElectronFuses(target);
      } else {
        await hardenElectronBinary(target);
      }
    } catch (err) {
      console.error('[fuses] ❌ Error:', err.message);
      process.exit(1);
    }
  })();
}

