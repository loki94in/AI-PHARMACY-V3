import { Router } from 'express';
import { checkLicense, activateLicense, getMachineId, APP_VERSION } from '../services/licenseService.js';
import { autoUpdateService } from '../services/autoUpdateService.js';

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

export default router;
