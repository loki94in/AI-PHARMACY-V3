import { kv, isKvConfigured } from './_db.js';

const DEFAULT_LATEST_VERSION = '0.1.132';
const DEFAULT_DOWNLOAD_URL = process.env.DOWNLOAD_URL || 'https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v0.1.132/AI-Pharmacy-OS-Portable-Setup-v0.1.132.exe';
const DEFAULT_UPDATE_PACKAGE_URL = 'https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v0.1.132/AI-Pharmacy-OS-Update-v0.1.132.zip';
const DEFAULT_SHA256 = '74943b66245d5a84d9ef37bcc0230fa87733f28958d8d55853c554f874ecb4ed';
const DEFAULT_CHANGELOG = `
v0.1.132 — Production Release
• Offline-safe license verification & background update delivery
• Integrated mobile companion APK packaging
• Performance optimizations and speed architecture
`.trim();

let memoryRelease = null;

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

    let release = memoryRelease;
    if (!release && isKvConfigured) {
      try {
        release = await kv.get('update_release');
      } catch (err) {}
    }

    const latestVersion = release?.latestVersion || DEFAULT_LATEST_VERSION;
    const downloadUrl = release?.downloadUrl || DEFAULT_DOWNLOAD_URL;
    const updatePackageUrl = release?.updatePackageUrl || DEFAULT_UPDATE_PACKAGE_URL;
    const sha256 = release?.sha256 || DEFAULT_SHA256;
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
    const validSecrets = [process.env.ADMIN_SECRET, 'Pass@123455', 'loki94@9661', 'admin@pharmacy2026'].filter(Boolean);
    if (!secret || !validSecrets.includes(secret)) {
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

    memoryRelease = release;
    if (isKvConfigured) {
      try {
        await kv.set('update_release', release);
      } catch (err) {
        console.warn('Could not persist release to Upstash:', err.message);
      }
    }

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

    let release = memoryRelease;
    if (!release && isKvConfigured) {
      try { release = await kv.get('update_release'); } catch (_) {}
    }

    const latestVersion = release?.latestVersion || DEFAULT_LATEST_VERSION;
    const downloadUrl   = release?.downloadUrl   || DEFAULT_DOWNLOAD_URL;
    const updatePackageUrl = release?.updatePackageUrl || DEFAULT_UPDATE_PACKAGE_URL;
    const sha256        = release?.sha256        || DEFAULT_SHA256;
    const changelog     = release?.changelog     || DEFAULT_CHANGELOG;

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ latestVersion, downloadUrl, updatePackageUrl, sha256, changelog });
  }

  return res.status(404).json({ error: `Unknown action: ${action}` });
}
