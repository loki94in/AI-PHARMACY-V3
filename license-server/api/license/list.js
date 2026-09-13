import { kv } from '@vercel/kv';

// Admin: list all licenses with their status
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Scan all license:* keys from KV
  const keys = await kv.keys('license:*');
  if (!keys.length) return res.status(200).json({ licenses: [], total: 0 });

  const records = await kv.mget(...keys);

  const licenses = records
    .filter(Boolean)
    .map(r => ({
      licenseId: r.licenseId,
      pharmacyName: r.pharmacyName,
      notes: r.notes,
      status: r.status,
      machineId: r.machineId ? `${r.machineId.substring(0, 8)}...` : null, // partial for privacy
      machineName: r.machineName,
      activatedAt: r.activatedAt,
      createdAt: r.createdAt,
      lastValidatedAt: r.lastValidatedAt,
    }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return res.status(200).json({ licenses, total: licenses.length });
}
