#!/usr/bin/env node
/**
 * Admin CLI tool to permanently delete an AI Pharmacy license from Redis.
 *
 * Usage:
 *   node scripts/deleteLicense.mjs --id "PHARM-A3B2"
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
const serverUrl   = values.server || process.env.LICENSE_SERVER_URL || 'https://ai-pharmacy-os.vercel.app';
const adminSecret = values.secret || process.env.ADMIN_SECRET;

if (!licenseId) {
  console.error('\n❌  --id "PHARM-XXXX" is required.');
  console.error('    Example: node scripts/deleteLicense.mjs --id "PHARM-A3B2"\n');
  process.exit(1);
}
if (!adminSecret) {
  console.error('\n❌  Set ADMIN_SECRET env var or pass --secret your-secret\n');
  process.exit(1);
}

const url = new URL('/api/license/delete', serverUrl);
const body = JSON.stringify({ licenseId: licenseId.trim().toUpperCase() });
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
        if (res.statusCode === 200) {
          console.log('\n========================================');
          console.log('  🗑️  LICENSE DELETED SUCCESSFULLY');
          console.log('========================================');
          console.log(`  License ID : ${result.licenseId}`);
          console.log(`  Message    : ${result.message}`);
          console.log('========================================\n');
        } else {
          console.error(`\n❌  Server error (${res.statusCode}):`, result.error || data);
          process.exit(1);
        }
      } catch (err) {
        console.error('\n❌  Failed to parse response:', data);
        process.exit(1);
      }
    });
  }
);

req.on('error', (err) => {
  console.error('\n❌  Network error:', err.message);
  process.exit(1);
});

req.write(body);
req.end();
