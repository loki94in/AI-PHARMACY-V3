import { kv, isKvConfigured } from '../_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    // Admin or dashboard getting current release config
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    let release = null;
    if (isKvConfigured) {
      try {
        release = await kv.get('update_release');
      } catch (_) {}
    }
    return res.status(200).json(release || {
      latestVersion: '1.0.0',
      downloadUrl: process.env.DOWNLOAD_URL || '',
      changelog: 'Initial Release',
      rolloutMode: 'ALL',
      publishedAt: null,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { latestVersion, downloadUrl, changelog, rolloutMode = 'ALL' } = req.body || {};
  if (!latestVersion?.trim()) {
    return res.status(400).json({ error: 'latestVersion is required' });
  }

  const release = {
    latestVersion: latestVersion.trim(),
    downloadUrl: (downloadUrl || '').trim(),
    changelog: (changelog || '').trim(),
    rolloutMode: rolloutMode === 'PILOT' ? 'PILOT' : 'ALL',
    publishedAt: new Date().toISOString(),
  };

  await kv.set('update_release', release);

  return res.status(200).json({
    success: true,
    release,
    message: rolloutMode === 'PILOT'
      ? `Release v${release.latestVersion} published to Pilot/Tester PCs only.`
      : `Release v${release.latestVersion} published to ALL pharmacies.`,
  });
}
