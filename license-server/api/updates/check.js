// Update this file whenever you release a new version.
// Push to GitHub → Vercel auto-deploys in ~30 seconds.

const LATEST_VERSION = '1.0.0';

// Cloudflare tunnel URL to download the full installer.
// Update this when you move to a stable domain.
const DOWNLOAD_URL = process.env.DOWNLOAD_URL || 'https://your-tunnel.trycloudflare.com/download/ai-pharmacy-setup.exe';

const CHANGELOG = `
v1.0.0 — Initial Release
• AI-powered pharmacy management
• Pharmarack integration
• WhatsApp dispatch
• Customer portal
`.trim();

export default function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const clientVersion = req.query.version || '0.0.0';
  const hasUpdate = compareVersions(LATEST_VERSION, clientVersion) > 0;

  return res.status(200).json({
    hasUpdate,
    latestVersion: LATEST_VERSION,
    currentVersion: clientVersion,
    downloadUrl: hasUpdate ? DOWNLOAD_URL : null,
    changelog: hasUpdate ? CHANGELOG : null,
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
