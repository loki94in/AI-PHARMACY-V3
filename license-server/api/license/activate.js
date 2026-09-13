import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { licenseId, licenseKey, machineId, machineName } = req.body || {};

  if (!licenseId || !licenseKey || !machineId) {
    return res.status(400).json({ error: 'licenseId, licenseKey, and machineId are required' });
  }

  const record = await kv.get(`license:${licenseId}`);

  if (!record) {
    return res.status(404).json({ error: 'License not found. Check your License ID.' });
  }

  if (record.status !== 'active') {
    return res.status(403).json({ error: `License is ${record.status}. Contact support.` });
  }

  // Verify key
  const keyHash = crypto.createHash('sha256').update(licenseKey).digest('hex');
  if (keyHash !== record.keyHash) {
    return res.status(401).json({ error: 'Invalid License Key. Check and try again.' });
  }

  // Already bound to a different machine → reject (1 key = 1 PC)
  if (record.machineId && record.machineId !== machineId) {
    return res.status(403).json({
      error: 'This license is already activated on another PC. Contact support to transfer.',
      code: 'MACHINE_MISMATCH',
    });
  }

  // Activate or re-confirm on same machine
  const now = new Date().toISOString();
  const updated = {
    ...record,
    machineId,
    machineName: machineName || 'Unknown PC',
    activatedAt: record.activatedAt || now,
    lastValidatedAt: now,
  };

  await kv.set(`license:${licenseId}`, updated);

  return res.status(200).json({
    success: true,
    pharmacyName: record.pharmacyName,
    licenseId,
    activatedAt: updated.activatedAt,
  });
}
