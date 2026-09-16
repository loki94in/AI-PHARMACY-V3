import { kv, isKvConfigured } from './_db.js';

const DEFAULT_LATEST_VERSION = '1.0.0';
const DEFAULT_DOWNLOAD_URL = process.env.DOWNLOAD_URL || 'https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v0.1.0/AI-Pharmacy-OS-Portable-Setup-v0.1.0.exe';
const DEFAULT_CHANGELOG = `
v1.0.0 — Initial Release
• AI-powered pharmacy management
• Pharmarack integration
• WhatsApp dispatch
• Customer portal
`.trim();

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.url ? req.url.split('?')[0].split('/').filter(Boolean).pop() : '');

  // 1. CHECK FOR UPDATES (Desktop app boot / manual check)
  if (action === 'check') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const clientVersion = req.query.version || '0.0.0';
    const clientLicenseId = req.query.licenseId || null;

    let release = null;
    if (isKvConfigured) {
      try {
        release = await kv.get('update_release');
      } catch (err) {}
    }

    const latestVersion = release?.latestVersion || DEFAULT_LATEST_VERSION;
    const downloadUrl = release?.downloadUrl || DEFAULT_DOWNLOAD_URL;
    const updatePackageUrl = release?.updatePackageUrl || null;
    const sha256 = release?.sha256 || null;
    const changelog = release?.changelog || DEFAULT_CHANGELOG;
    const rolloutMode = release?.rolloutMode || 'ALL';

    let isTargetEligible = true;

    if (rolloutMode === 'PILOT') {
      isTargetEligible = false;
      if (clientLicenseId) {
        try {
          const licenseRecord = await kv.get(`license:${clientLicenseId}`);
          if (licenseRecord?.isPilot === true) {
            isTargetEligible = true;
          }
        } catch {}
      }
    }

    const hasNewerVersion = compareVersions(latestVersion, clientVersion) > 0;
    const hasUpdate = hasNewerVersion && isTargetEligible;

    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');

    return res.status(200).json({
      hasUpdate,
      latestVersion,
      currentVersion: clientVersion,
      rolloutMode,
      isPilot: isTargetEligible && rolloutMode === 'PILOT',
      downloadUrl: hasUpdate ? downloadUrl : null,
      updatePackageUrl: hasUpdate ? updatePackageUrl : null,
      sha256: hasUpdate ? sha256 : null,
      changelog: hasUpdate ? changelog : null,
      checkedAt: new Date().toISOString(),
    });
  }

  // 2. PUBLISH / GET RELEASE CONFIG (Admin console)
  if (action === 'publish') {
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'GET') {
      let release = null;
      if (isKvConfigured) {
        try {
          release = await kv.get('update_release');
        } catch (_) {}
      }
      return res.status(200).json(release || {
        latestVersion: '1.0.0',
        downloadUrl: process.env.DOWNLOAD_URL || '',
        updatePackageUrl: '',
        sha256: '',
        changelog: 'Initial Release',
        rolloutMode: 'ALL',
        publishedAt: null,
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { latestVersion, downloadUrl, updatePackageUrl, sha256, changelog, rolloutMode = 'ALL' } = req.body || {};
    if (!latestVersion?.trim()) {
      return res.status(400).json({ error: 'latestVersion is required' });
    }

    const release = {
      latestVersion: latestVersion.trim(),
      downloadUrl: (downloadUrl || '').trim(),
      updatePackageUrl: (updatePackageUrl || '').trim(),
      sha256: (sha256 || '').trim(),
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

  // 3. LATEST RELEASE (Stub installer — new customer download, no rollout filter)
  if (action === 'latest') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    let release = null;
    if (isKvConfigured) {
      try { release = await kv.get('update_release'); } catch (_) {}
    }

    const latestVersion = release?.latestVersion || DEFAULT_LATEST_VERSION;
    const downloadUrl   = release?.downloadUrl   || DEFAULT_DOWNLOAD_URL;
    const updatePackageUrl = release?.updatePackageUrl || null;
    const sha256        = release?.sha256        || null;
    const changelog     = release?.changelog     || DEFAULT_CHANGELOG;

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ latestVersion, downloadUrl, updatePackageUrl, sha256, changelog });
  }

  return res.status(404).json({ error: `Unknown action: ${action}` });
}
