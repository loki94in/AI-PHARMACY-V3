import { kv, isKvConfigured } from '../_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isKvConfigured) {
    return res.status(200).json({ errors: [], total: 0 });
  }

  try {
    const rawList = await kv.lrange('telemetry:errors', 0, 99);
    const errors = (rawList || []).map(item => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return null;
      }
    }).filter(Boolean);

    return res.status(200).json({ errors, total: errors.length });
  } catch (err) {
    return res.status(500).json({ error: err.message, errors: [], total: 0 });
  }
}
