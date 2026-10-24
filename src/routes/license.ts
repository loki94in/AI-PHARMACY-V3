import { Router } from 'express';
import { checkLicense, activateLicense, getMachineId, APP_VERSION } from '../services/licenseService.js';
import { autoUpdateService } from '../services/autoUpdateService.js';
import { getUpdateHistory } from '../services/updateHistoryService.js';

const router = Router();

/** GET /api/license/status — current license status (called by frontend on boot) */
router.get('/status', async (_req, res) => {
  try {
    const status = await checkLicense();
    res.json({
      ...status,
      appVersion: APP_VERSION,
      currentVersion: APP_VERSION,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, appVersion: APP_VERSION });
  }
});

/** GET /api/license/version — lightweight version endpoint */
router.get('/version', (_req, res) => {
  res.json({
    version: APP_VERSION,
    appVersion: APP_VERSION,
    currentVersion: APP_VERSION,
  });
});

/** POST /api/license/activate — activate a license key on this PC */
router.post('/activate', async (req, res) => {
  const { licenseId, licenseKey } = req.body || {};
  if (!licenseId?.trim() || !licenseKey?.trim()) {
    return res.status(400).json({ error: 'licenseId and licenseKey are required' });
  }
  try {
    const result = await activateLicense(licenseId.trim(), licenseKey.trim());
    if (result.success) {
      res.json({ success: true, pharmacyName: result.pharmacyName });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/license/machine-id — returns this PC's machine fingerprint (for support) */
router.get('/machine-id', (_req, res) => {
  try {
    const machineId = getMachineId();
    // Return only first 8 chars for display; full ID used internally
    res.json({ machineId: machineId.substring(0, 8) + '...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/license/update-status — query cached/staged update state on mount */
router.get('/update-status', (_req, res) => {
  const result = autoUpdateService.getStatus();
  res.json({
    hasUpdate: !!result?.hasUpdate,
    latestVersion: result?.latestVersion || null,
    currentVersion: result?.currentVersion || APP_VERSION,
    readyToInstall: !!result?.readyToInstall,
    downloading: !!result?.downloading,
    downloadProgress: result?.downloadProgress ?? (result?.readyToInstall ? 100 : 0),
    downloadUrl: result?.downloadUrl,
    updatePackageUrl: result?.updatePackageUrl,
    changelog: result?.changelog || '',
    lastCheckedAt: autoUpdateService.getLastCheckedAt() || null,
    lastError: result?.lastError || null,
  });
});

/** POST /api/license/start-download — trigger background download of 105 MB update package */
router.post('/start-download', (_req, res) => {
  try {
    autoUpdateService.startBackgroundDownload(undefined, 'manual');
    const result = autoUpdateService.getStatus();
    res.json({
      success: true,
      downloading: true,
      latestVersion: result?.latestVersion,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/license/check-update — manual update check trigger */
router.post('/check-update', async (_req, res) => {
  try {
    const result = await autoUpdateService.triggerCheck();
    res.json({
      hasUpdate: !!result?.hasUpdate,
      currentVersion: (result as any)?.currentVersion || APP_VERSION,
      latestVersion: result?.latestVersion || APP_VERSION,
      downloadUrl: result?.downloadUrl,
      updatePackageUrl: result?.updatePackageUrl,
      sha256: result?.sha256,
      changelog: result?.changelog,
      readyToInstall: result?.readyToInstall,
      downloading: result?.downloading,
      downloadProgress: result?.downloadProgress ?? (result?.readyToInstall ? 100 : 0),
    });
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      hasUpdate: false,
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
    });
  }
});

/** GET /api/license/update-history — list past releases from GitHub with changelogs */
router.get('/update-history', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const history = await getUpdateHistory(forceRefresh);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({
      installed: APP_VERSION,
      releases: [],
      offline: true,
      error: err?.message || 'Failed to fetch release history',
    });
  }
});

export default router;
