import { Router } from 'express';
import fs from 'fs';
import { checkLicense, activateLicense, getMachineId, APP_VERSION } from '../services/licenseService.js';
import { autoUpdateService, compareVersions, getLogPath } from '../services/autoUpdateService.js';
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
  const rawLatest = result?.latestVersion;
  const isNewer = rawLatest ? compareVersions(rawLatest, APP_VERSION) > 0 : false;
  const effectiveLatest = isNewer ? rawLatest : APP_VERSION;
  const isDownloading = Boolean(result?.downloading && isNewer);
  const isReady = Boolean(result?.readyToInstall && isNewer);

  res.json({
    hasUpdate: Boolean(result?.hasUpdate && isNewer),
    latestVersion: effectiveLatest,
    currentVersion: APP_VERSION,
    readyToInstall: isReady,
    downloading: isDownloading,
    downloadProgress: isDownloading || isReady ? (result?.downloadProgress ?? (isReady ? 100 : 0)) : 0,
    downloadedBytes: isDownloading || isReady ? (result?.downloadedBytes ?? (isReady ? result?.totalBytes : 0)) : 0,
    totalBytes: result?.totalBytes ?? 0,
    downloadUrl: isNewer ? result?.downloadUrl : null,
    updatePackageUrl: isNewer ? result?.updatePackageUrl : null,
    changelog: isNewer ? (result?.changelog || '') : '',
    lastCheckedAt: autoUpdateService.getLastCheckedAt() || null,
    lastError: result?.lastError || null,
  });
});

/** POST /api/license/start-download — trigger background download of 105 MB update package */
router.post('/start-download', (_req, res) => {
  try {
    autoUpdateService.startBackgroundDownload(undefined, 'manual');
    const result = autoUpdateService.getStatus();
    const isDownloading = !!(result?.downloading);
    res.json({
      success: isDownloading,
      downloading: isDownloading,
      latestVersion: result?.latestVersion,
      message: isDownloading ? 'Download started' : 'No newer update to download',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/license/check-update — manual update check trigger */
router.post('/check-update', async (_req, res) => {
  try {
    const result = await autoUpdateService.triggerCheck();
    const rawLatest = result?.latestVersion;
    const isNewer = rawLatest ? compareVersions(rawLatest, APP_VERSION) > 0 : false;
    const effectiveLatest = isNewer ? rawLatest : APP_VERSION;
    const isDownloading = Boolean(result?.downloading && isNewer);
    const isReady = Boolean(result?.readyToInstall && isNewer);

    res.json({
      hasUpdate: Boolean(result?.hasUpdate && isNewer),
      currentVersion: APP_VERSION,
      latestVersion: effectiveLatest,
      downloadUrl: isNewer ? result?.downloadUrl : null,
      updatePackageUrl: isNewer ? result?.updatePackageUrl : null,
      sha256: isNewer ? result?.sha256 : null,
      changelog: isNewer ? result?.changelog : '',
      readyToInstall: isReady,
      downloading: isDownloading,
      downloadProgress: isDownloading || isReady ? (result?.downloadProgress ?? (isReady ? 100 : 0)) : 0,
    });
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      hasUpdate: false,
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      downloading: false,
      downloadProgress: 0,
      readyToInstall: false,
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

/** GET /api/license/updater-log — tail of latest installer / updater CLI log */
router.get('/updater-log', (_req, res) => {
  try {
    const logPath = getLogPath();
    if (!fs.existsSync(logPath)) {
      return res.json({
        success: true,
        exists: false,
        logPath,
        lines: [],
        lastModified: null,
      });
    }

    const stat = fs.statSync(logPath);
    // Read up to last 64 KB of log file for fast parsing
    const bufferSize = Math.min(stat.size, 65536);
    const fd = fs.openSync(logPath, 'r');
    const buffer = Buffer.alloc(bufferSize);
    fs.readSync(fd, buffer, 0, bufferSize, Math.max(0, stat.size - bufferSize));
    fs.closeSync(fd);

    const text = buffer.toString('utf8');
    const allLines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    // Take up to latest 150 lines
    const lines = allLines.slice(-150);

    res.json({
      success: true,
      exists: true,
      logPath,
      lines,
      lastModified: stat.mtime.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Failed to read updater log',
      lines: [],
    });
  }
});

export default router;
