import { kv, isKvConfigured } from '../_db.js';

// Admin: reset machine binding so license can be activated on a new PC
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isKvConfigured) {
    return res.status(500).json({ error: 'Upstash Redis not configured on server' });
  }

  const { licenseId, action } = req.body || {};
  if (!licenseId) return res.status(400).json({ error: 'licenseId is required' });

  const record = await kv.get(`license:${licenseId}`);
  if (!record) return res.status(404).json({ error: 'License not found' });

  let updated = { ...record };

  if (action === 'reset_machine') {
    // Allow re-activation on a new PC
    updated.machineId = null;
    updated.machineName = null;
    updated.activatedAt = null;
  } else if (action === 'suspend') {
    updated.status = 'suspended';
  } else if (action === 'reactivate') {
    updated.status = 'active';
  } else if (action === 'revoke') {
    updated.status = 'revoked';
  } else {
    return res.status(400).json({ error: 'action must be: reset_machine | suspend | reactivate | revoke' });
  }

  await kv.set(`license:${licenseId}`, updated);

  return res.status(200).json({
    success: true,
    licenseId,
    action,
    status: updated.status,
    machineId: updated.machineId,
  });
}
