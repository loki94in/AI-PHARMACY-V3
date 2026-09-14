import { kv, isKvConfigured } from '../_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    // Sanitize: strictly technical data only
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

    // Store in capped KV list (keep only latest 100 technical errors)
    await kv.lpush('telemetry:errors', JSON.stringify(entry));
    await kv.ltrim('telemetry:errors', 0, 99);

    return res.status(200).json({ success: true });
  } catch (err) {
    // Non-blocking: never fail loudly for telemetry
    return res.status(200).json({ success: false, error: err.message });
  }
}
