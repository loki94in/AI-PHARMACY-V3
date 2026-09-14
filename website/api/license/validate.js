import { kv, isKvConfigured } from '../_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!isKvConfigured) {
    return res.status(500).json({ valid: false, error: 'Upstash Redis not configured on server' });
  }

  const { licenseId, machineId } = req.query;

  if (!licenseId || !machineId) {
    return res.status(400).json({ valid: false, error: 'licenseId and machineId are required' });
  }

  const record = await kv.get(`license:${licenseId}`);

  if (!record) {
    return res.status(404).json({ valid: false, error: 'License not found' });
  }
  if (record.status !== 'active') {
    return res.status(403).json({ valid: false, error: `License is ${record.status}` });
  }
  if (record.machineId !== machineId) {
    return res.status(403).json({ valid: false, error: 'Machine mismatch', code: 'MACHINE_MISMATCH' });
  }

  // Check license expiration
  const nowMs = Date.now();
  let daysUntilExpiry = null;
  if (record.expiresAt) {
    const expiresMs = new Date(record.expiresAt).getTime();
    if (nowMs > expiresMs) {
      return res.status(403).json({
        valid: false,
        error: 'License has expired. Please renew your license.',
        code: 'EXPIRED',
        expiresAt: record.expiresAt,
        daysUntilExpiry: 0,
      });
    }
    daysUntilExpiry = Math.max(0, Math.floor((expiresMs - nowMs) / (24 * 60 * 60 * 1000)));
  }

  // Update heartbeat timestamp (non-blocking)
  kv.set(`license:${licenseId}`, {
    ...record,
    lastValidatedAt: new Date().toISOString(),
  }).catch(() => {});

  return res.status(200).json({
    valid: true,
    pharmacyName: record.pharmacyName,
    licenseId,
    activatedAt: record.activatedAt,
    expiresAt: record.expiresAt || null,
    daysUntilExpiry,
    isPilot: Boolean(record.isPilot),
  });
}
