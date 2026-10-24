import { kv, isKvConfigured } from './_db.js';

const DEFAULT_LATEST_VERSION = '0.1.154';
const DEFAULT_DOWNLOAD_URL = process.env.DOWNLOAD_URL || 'https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v0.1.154/AI-Pharmacy-OS-Portable-Setup-v0.1.154.exe';
const DEFAULT_UPDATE_PACKAGE_URL = 'https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v0.1.154/AI-Pharmacy-OS-Update-v0.1.154.zip';
const DEFAULT_SHA256 = 'c07fb6b4667c3133ca973bd38c83c02326511cc7d6b534ad1f96b2e4811cff5f';
const DEFAULT_CHANGELOG = `
v0.1.154 — Production Release
• Production-stable installer & portable package
• Auto background update delivery with zero-downtime staging
• Refill Auto Cart-Add and Website Payment Verification
• System health and memory protection
`.trim();

let memoryRelease = null;
let githubCache = null;
let lastGithubFetch = 0;

async function fetchLatestGitHubRelease() {
  const now = Date.now();
  if (githubCache && (now - lastGithubFetch < 5 * 60 * 1000)) {
    return githubCache;
  }
  try {
    const headers = {
      'User-Agent': 'AI-Pharmacy-Vercel-Updater/1.0',
      Accept: 'application/vnd.github.v3+json',
    };
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (ghToken) headers.Authorization = `Bearer ${ghToken}`;

    const res = await fetch('https://api.github.com/repos/loki94in/AI-PHARMACY-V3/releases/latest', {
      headers,
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return githubCache || null;
    const data = await res.json();
    const tag = (data.tag_name || '').replace(/^v/, '');
    if (!tag) return githubCache || null;

    const installerAsset = data.assets?.find(a => a.name.endsWith('.exe'));
    const updateZipAsset = data.assets?.find(a => a.name.startsWith('AI-Pharmacy-OS-Update-') && a.name.endsWith('.zip'));

    let assetSha = null;
    if (updateZipAsset && updateZipAsset.digest) {
      assetSha = updateZipAsset.digest.replace(/^sha256:/i, '').trim();
    }
    if (!assetSha && data.body) {
      const match = data.body.match(/sha256[:\s]+([a-f0-9]{64})/i) ||
                    data.body.match(/([a-f0-9]{64})\s+\*?AI-Pharmacy-OS-Update/i);
      if (match) assetSha = match[1].toLowerCase();
    }

    githubCache = {
      latestVersion: tag,
      downloadUrl: installerAsset?.browser_download_url || `https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v${tag}/AI-Pharmacy-OS-Portable-Setup-v${tag}.exe`,
      updatePackageUrl: updateZipAsset?.browser_download_url || `https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v${tag}/AI-Pharmacy-OS-Update-v${tag}.zip`,
      sha256: assetSha,
      changelog: data.body || `AI Pharmacy OS v${tag} Release`,
      rolloutMode: 'ALL',
      publishedAt: data.published_at,
    };
    lastGithubFetch = now;
    return githubCache;
  } catch (_) {
    return githubCache || null;
  }
}

function compareVersions(a, b) {
  const pa = (a || '').replace(/^v/, '').split('.').map(Number);
  const pb = (b || '').replace(/^v/, '').split('.').map(Number);
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

    // Resilient fallback: If no release in KV or KV version is older than latest GitHub release
    const ghRelease = await fetchLatestGitHubRelease();
    if (ghRelease && (!release || compareVersions(ghRelease.latestVersion, release.latestVersion) > 0)) {
      release = {
        ...(release || {}),
        ...ghRelease,
        sha256: ghRelease.sha256 || release?.sha256 || DEFAULT_SHA256,
      };
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
    const reportedLatestVersion = hasNewerVersion ? latestVersion : clientVersion;

    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');

    return res.status(200).json({
      hasUpdate,
      latestVersion: reportedLatestVersion,
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

    const trimmedVersion = latestVersion.trim();
    let currentLatest = memoryRelease?.latestVersion || DEFAULT_LATEST_VERSION;
    if (isKvConfigured) {
      try {
        const stored = await kv.get('update_release');
        if (stored?.latestVersion) currentLatest = stored.latestVersion;
      } catch (_) {}
    }
    if (compareVersions(trimmedVersion, currentLatest) < 0) {
      return res.status(400).json({
        error: `Cannot publish v${trimmedVersion} because it is older than current known latest v${currentLatest}`,
      });
    }

    const release = {
      latestVersion: trimmedVersion,
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

    const ghRelease = await fetchLatestGitHubRelease();
    if (ghRelease && (!release || compareVersions(ghRelease.latestVersion, release.latestVersion) > 0)) {
      release = {
        ...(release || {}),
        ...ghRelease,
        sha256: ghRelease.sha256 || release?.sha256 || DEFAULT_SHA256,
      };
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
