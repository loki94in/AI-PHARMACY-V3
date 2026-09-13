import { kv } from '@vercel/kv';
import crypto from 'crypto';

// --- helpers ---

function randomChars(len) {
  const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let s = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += pool[bytes[i] % pool.length];
  return s;
}

function generateLicenseId() {
  return `PHARM-${randomChars(4)}`;
}

function generateLicenseKey() {
  return `${randomChars(4)}-${randomChars(4)}-${randomChars(4)}-${randomChars(4)}`;
}

// --- handler ---

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { pharmacyName, notes, validityDays = 365, isPilot = false } = req.body || {};
  if (!pharmacyName?.trim()) {
    return res.status(400).json({ error: 'pharmacyName is required' });
  }

  const licenseId = generateLicenseId();
  const licenseKey = generateLicenseKey();
  const keyHash = crypto.createHash('sha256').update(licenseKey).digest('hex');

  const nowMs = Date.now();
  const expiresMs = nowMs + Number(validityDays) * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(expiresMs).toISOString();

  const record = {
    licenseId,
    keyHash,
    pharmacyName: pharmacyName.trim(),
    notes: notes?.trim() || '',
    status: 'active',      // active | suspended | revoked
    machineId: null,       // null = not yet activated
    machineName: null,
    activatedAt: null,
    expiresAt,
    isPilot: Boolean(isPilot),
    createdAt: new Date(nowMs).toISOString(),
    lastValidatedAt: null,
  };

  await kv.set(`license:${licenseId}`, record);

  // Return key only once — never stored in plain text
  return res.status(200).json({
    licenseId,
    licenseKey,
    pharmacyName: record.pharmacyName,
    expiresAt: record.expiresAt,
    isPilot: record.isPilot,
    createdAt: record.createdAt,
    _note: 'Store the licenseKey safely — it is shown ONCE and not stored in plain text.',
  });
}
