import { kv, isKvConfigured } from '../_db.js';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isKvConfigured) {
    return res.status(500).json({ error: 'Upstash Redis is not connected yet in Vercel.' });
  }

  const { licenseId, days = 365 } = req.body || {};
  if (!licenseId) {
    return res.status(400).json({ error: 'licenseId is required' });
  }

  try {
    const record = await kv.get(`license:${licenseId}`);
    if (!record) {
      return res.status(404).json({ error: 'License not found' });
    }

    const nowMs = Date.now();
    const currentExpiresMs = record.expiresAt ? new Date(record.expiresAt).getTime() : nowMs;
    // If already expired, start fresh from today; otherwise extend the remaining time
    const baseMs = currentExpiresMs > nowMs ? currentExpiresMs : nowMs;
    const newExpiresMs = baseMs + Number(days) * 24 * 60 * 60 * 1000;
    const newExpiresAt = new Date(newExpiresMs).toISOString();

    const updated = {
      ...record,
      expiresAt: newExpiresAt,
      status: record.status === 'revoked' ? 'revoked' : 'active',
    };

    await kv.set(`license:${licenseId}`, updated);

    const daysUntilExpiry = Math.max(0, Math.floor((newExpiresMs - nowMs) / (24 * 60 * 60 * 1000)));

    return res.status(200).json({
      success: true,
      licenseId,
      pharmacyName: updated.pharmacyName,
      expiresAt: newExpiresAt,
      daysUntilExpiry,
      message: `License renewed for ${days} days (Expires ${newExpiresAt.split('T')[0]})`,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Storage error: ${err.message}. Connect KV database in Vercel.`,
    });
  }
}
