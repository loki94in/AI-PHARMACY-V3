#!/usr/bin/env node
/**
 * Admin tool to reset machine binding for an AI Pharmacy license.
 * Use this when a customer changes their PC, hard drive, or motherboard.
 *
 * Usage:
 *   node scripts/resetLicense.mjs --id "PHARM-A3B2"
 *
 * Requires:
 *   ADMIN_SECRET env var (same as set in Vercel)
 *   LICENSE_SERVER_URL env var (your Vercel deployment URL)
 */

import https from 'https';
import http from 'http';
import { parseArgs } from 'util';

const { values } = parseArgs({
  options: {
    id:     { type: 'string' },
    server: { type: 'string' },
    secret: { type: 'string' },
  },
  strict: false,
});

const licenseId   = values.id;
const serverUrl   = values.server || process.env.LICENSE_SERVER_URL || 'https://ai-pharmacy-license.vercel.app';
const adminSecret = values.secret || process.env.ADMIN_SECRET;

if (!licenseId) {
  console.error('\n❌  --id "PHARM-XXXX" is required.');
  console.error('    Example: node scripts/resetLicense.mjs --id "PHARM-A3B2"\n');
  process.exit(1);
}
if (!adminSecret) {
  console.error('\n❌  Set ADMIN_SECRET env var or pass --secret your-secret\n');
  process.exit(1);
}

const url = new URL('/api/license/reset', serverUrl);
const body = JSON.stringify({ licenseId: licenseId.trim().toUpperCase(), action: 'reset_machine' });
const lib = url.protocol === 'https:' ? https : http;

const req = lib.request(
  url.toString(),
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-admin-secret': adminSecret,
    },
  },
  (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (res.statusCode !== 200) {
          console.error(`\n❌  Server error (${res.statusCode}): ${result.error || data}\n`);
          process.exit(1);
        }
        console.log('\n✅  Machine Binding Reset Successfully!');
        console.log('─'.repeat(50));
        console.log(`   License ID : ${result.licenseId}`);
        console.log(`   Status     : ${result.status}`);
        console.log(`   Machine ID : ${result.machineId || '(None — Unbound)'}`);
        console.log('─'.repeat(50));
        console.log('👉  The customer can now enter this same key on their new PC.');
        console.log('    Their pharmacy database and data remain 100% untouched.\n');
      } catch {
        console.error('❌  Failed to parse response:', data);
        process.exit(1);
      }
    });
  }
);

req.on('error', (e) => {
  console.error('\n❌  Connection error:', e.message, '\n');
  process.exit(1);
});

req.write(body);
req.end();
