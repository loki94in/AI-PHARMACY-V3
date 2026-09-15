#!/usr/bin/env node
/**
 * Admin tool to create a new AI Pharmacy license.
 *
 * Usage:
 *   node scripts/createLicense.mjs --pharmacy "Ravi Medicals" --notes "Main counter"
 *
 * Requires:
 *   ADMIN_SECRET env var (same as set in Vercel)
 *   LICENSE_SERVER_URL env var (your Vercel deployment URL)
 *
 * Example .env or inline:
 *   LICENSE_SERVER_URL=https://ai-pharmacy-license.vercel.app \
 *   ADMIN_SECRET=your-secret \
 *   node scripts/createLicense.mjs --pharmacy "Ravi Medicals"
 */

import https from 'https';
import http from 'http';
import { parseArgs } from 'util';

// --- parse CLI args ---
const { values } = parseArgs({
  options: {
    pharmacy: { type: 'string' },
    notes:    { type: 'string', default: '' },
    server:   { type: 'string' },
    secret:   { type: 'string' },
    id:       { type: 'string' },
    key:      { type: 'string' },
  },
  strict: false,
});

const pharmacyName     = values.pharmacy;
const notes            = values.notes || '';
const serverUrl        = values.server || process.env.LICENSE_SERVER_URL;
const adminSecret      = values.secret || process.env.ADMIN_SECRET;
const customLicenseId  = values.id;
const customLicenseKey = values.key;

if (!pharmacyName) {
  console.error('❌  --pharmacy "Pharmacy Name" is required');
  process.exit(1);
}
if (!serverUrl) {
  console.error('❌  Set LICENSE_SERVER_URL env var or pass --server https://ai-pharmacy-os.vercel.app');
  process.exit(1);
}
if (!adminSecret) {
  console.error('❌  Set ADMIN_SECRET env var or pass --secret your-secret');
  process.exit(1);
}

// --- call license server ---
const url = new URL('/api/license/create', serverUrl);
const body = JSON.stringify({
  pharmacyName,
  notes,
  customLicenseId,
  customLicenseKey,
});
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
          console.error(`❌  Server error (${res.statusCode}): ${result.error || data}`);
          process.exit(1);
        }
        console.log('\n✅  License Created Successfully');
        console.log('─'.repeat(50));
        console.log(`   Pharmacy   : ${result.pharmacyName}`);
        console.log(`   License ID : ${result.licenseId}`);
        console.log(`   License Key: ${result.licenseKey}`);
        console.log(`   Created At : ${result.createdAt}`);
        console.log('─'.repeat(50));
        console.log('⚠️   Store the License Key safely — shown ONCE only.\n');
      } catch {
        console.error('❌  Failed to parse response:', data);
        process.exit(1);
      }
    });
  }
);

req.on('error', (e) => {
  console.error('❌  Connection error:', e.message);
  process.exit(1);
});

req.write(body);
req.end();
