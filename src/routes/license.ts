import { Router } from 'express';
import { checkLicense, activateLicense, getMachineId } from '../services/licenseService.js';
import { autoUpdateService } from '../services/autoUpdateService.js';

const router = Router();

/** GET /api/license/status — current license status (called by frontend on boot) */
router.get('/status', async (req, res) => {
  try {
    const status = await checkLicense();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
router.get('/machine-id', (req, res) => {
  try {
    const machineId = getMachineId();
    // Return only first 8 chars for display; full ID used internally
    res.json({ machineId: machineId.substring(0, 8) + '...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/license/check-update — manual update check trigger */
router.post('/check-update', async (req, res) => {
  try {
    const result = await autoUpdateService.triggerCheck();
    res.json(result || { hasUpdate: false, latestVersion: null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
