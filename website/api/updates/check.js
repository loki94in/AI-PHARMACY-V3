import { kv, isKvConfigured } from '../_db.js';

const DEFAULT_LATEST_VERSION = '1.0.0';
const DEFAULT_DOWNLOAD_URL = process.env.DOWNLOAD_URL || 'https://your-tunnel.trycloudflare.com/download/ai-pharmacy-setup.exe';
const DEFAULT_CHANGELOG = `
v1.0.0 — Initial Release
• AI-powered pharmacy management
• Pharmarack integration
• WhatsApp dispatch
• Customer portal
`.trim();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const clientVersion = req.query.version || '0.0.0';
  const clientLicenseId = req.query.licenseId || null;

  // Retrieve active release from KV (or fallback to defaults)
  let release = null;
  if (isKvConfigured) {
    try {
      release = await kv.get('update_release');
    } catch (err) {
      // KV unavailable, proceed with defaults
    }
  }

  const latestVersion = release?.latestVersion || DEFAULT_LATEST_VERSION;
  const downloadUrl = release?.downloadUrl || DEFAULT_DOWNLOAD_URL;
  const changelog = release?.changelog || DEFAULT_CHANGELOG;
  const rolloutMode = release?.rolloutMode || 'ALL'; // 'ALL' or 'PILOT'

  let isTargetEligible = true;

  // If release is in PILOT mode, only clients marked as pilot get the update
  if (rolloutMode === 'PILOT') {
    isTargetEligible = false;
    if (clientLicenseId) {
      try {
        const licenseRecord = await kv.get(`license:${clientLicenseId}`);
        if (licenseRecord?.isPilot === true) {
          isTargetEligible = true;
        }
      } catch {
        // Fallback to false if lookup fails
      }
    }
  }

  const hasNewerVersion = compareVersions(latestVersion, clientVersion) > 0;
  const hasUpdate = hasNewerVersion && isTargetEligible;

  return res.status(200).json({
    hasUpdate,
    latestVersion,
    currentVersion: clientVersion,
    rolloutMode,
    isPilot: isTargetEligible && rolloutMode === 'PILOT',
    downloadUrl: hasUpdate ? downloadUrl : null,
    changelog: hasUpdate ? changelog : null,
    checkedAt: new Date().toISOString(),
  });
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}
