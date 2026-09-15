import { kv, isKvConfigured } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.url ? req.url.split('?')[0].split('/').filter(Boolean).pop() : '');

  // 1. REPORT ERROR (App background telemetry)
  if (action === 'report') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) return res.status(200).json({ success: false, error: 'Storage not configured' });

    try {
      const {
        machineId,
        licenseId,
        appVersion,
        errorType = 'UNKNOWN',
        message = 'No message provided',
        stack,
      } = req.body || {};

      const entry = {
        id: `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        machineId: machineId ? String(machineId).substring(0, 12) + '...' : 'unknown',
        licenseId: licenseId ? String(licenseId).substring(0, 16) : 'unlicensed',
        appVersion: appVersion ? String(appVersion).substring(0, 10) : 'unknown',
        errorType: String(errorType).substring(0, 50),
        message: String(message).substring(0, 200),
        stackSnippet: stack ? String(stack).split('\n').slice(0, 4).join('\n').substring(0, 300) : null,
        timestamp: new Date().toISOString(),
      };

      await kv.lpush('telemetry:errors', JSON.stringify(entry));
      await kv.ltrim('telemetry:errors', 0, 99);

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(200).json({ success: false, error: err.message });
    }
  }

  // 2. LIST ERRORS (Admin console)
  if (action === 'list') {
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

  return res.status(404).json({ error: `Unknown action: ${action}` });
}
