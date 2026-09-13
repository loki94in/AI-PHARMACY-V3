import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { licenseId, isPilot } = req.body || {};
  if (!licenseId) {
    return res.status(400).json({ error: 'licenseId is required' });
  }

  const record = await kv.get(`license:${licenseId}`);
  if (!record) {
    return res.status(404).json({ error: 'License not found' });
  }

  const newPilotState = typeof isPilot === 'boolean' ? isPilot : !record.isPilot;
  const updated = {
    ...record,
    isPilot: newPilotState,
  };

  await kv.set(`license:${licenseId}`, updated);

  return res.status(200).json({
    success: true,
    licenseId,
    pharmacyName: updated.pharmacyName,
    isPilot: updated.isPilot,
    message: updated.isPilot ? 'Pharmacy marked as Pilot tester' : 'Pharmacy set to Standard production',
  });
}
