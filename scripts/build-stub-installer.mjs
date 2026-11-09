#!/usr/bin/env node
/**
 * Compiles the lightweight Web / Stub Installer (~2.5 MB) for AI Pharmacy OS.
 * Reads version from package.json and compiles installer-stub.iss using Inno Setup.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version || '0.1.230';

console.log('=============================================================');
console.log(`📦 Building AI Pharmacy OS Web Stub Installer (v${version})`);
console.log('=============================================================');

const isccCandidates = [
  'iscc',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity IDE', 'resources', 'app', 'node_modules', 'innosetup', 'bin', 'ISCC.exe')
];

let isccExe = null;
for (const cand of isccCandidates) {
  try {
    if (cand === 'iscc') {
      execSync('iscc /?', { stdio: 'ignore' });
      isccExe = 'iscc';
      break;
    } else if (fs.existsSync(cand)) {
      isccExe = cand;
      break;
    }
  } catch (_) {}
}

if (!isccExe) {
  console.warn('⚠️ Notice: Inno Setup Compiler (ISCC.exe) not found in standard system locations.');
  console.log('   installer-stub.iss is configured and ready. Install Inno Setup 6 to compile the .exe locally.');
  process.exit(0);
}

const issPath = path.join(rootDir, 'installer-stub.iss');
const outDir = path.join(rootDir, 'dist', 'installer');
fs.mkdirSync(outDir, { recursive: true });

const payloadUrl = process.env.PAYLOAD_URL || '';
const payloadArg = payloadUrl ? ` "/DPayloadUrl=${payloadUrl}"` : '';

console.log(`🔨 Compiling installer-stub.iss with ${isccExe}...`);
try {
  execSync(`"${isccExe}" "/DMyAppVersion=${version}"${payloadArg} "${issPath}"`, {
    stdio: 'inherit',
    cwd: rootDir,
  });
  console.log('\n=============================================================');
  console.log(`🎉 Web Stub Installer compiled successfully!`);
  console.log(`   Location: dist/installer/AI-Pharmacy-OS-WebSetup-v${version}.exe`);
  console.log('=============================================================\n');
} catch (err) {
  console.error('\n❌ Inno Setup compilation failed:', err.message);
  process.exit(1);
}

