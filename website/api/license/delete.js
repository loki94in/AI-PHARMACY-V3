import { kv, isKvConfigured } from '../_db.js';

// Admin: delete a license permanently from KV
export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin auth
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isKvConfigured) {
    return res.status(500).json({ error: 'Upstash Redis is not connected yet in Vercel.' });
  }

  const { licenseId } = req.body || req.query || {};
  if (!licenseId?.trim()) {
    return res.status(400).json({ error: 'licenseId is required' });
  }

  const cleanId = licenseId.trim().toUpperCase();

  try {
    const record = await kv.get(`license:${cleanId}`);
    if (!record) {
      return res.status(404).json({ error: `License ${cleanId} not found` });
    }

    await kv.del(`license:${cleanId}`);

    return res.status(200).json({
      success: true,
      licenseId: cleanId,
      pharmacyName: record.pharmacyName || null,
      message: `License ${cleanId} has been permanently deleted from the database.`,
    });
  } catch (err) {
    return res.status(500).json({
      error: `Storage error: ${err.message}. Check KV database in Vercel.`,
    });
  }
}
