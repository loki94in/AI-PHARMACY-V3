import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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
  });
}
