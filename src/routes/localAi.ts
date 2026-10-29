/**
 * Local AI Management Endpoints
 * Provides status, progress, download control, cancellation, and retry for offline AI assets.
 */

import express, { Request, Response } from 'express';
import { localAiLifecycleManager } from '../services/localAi/localAiLifecycleManager.js';
import { modelDownloadManager } from '../services/localAi/modelDownloadManager.js';
import { dbManager } from '../database/connection.js';

const router = express.Router();

/**
 * GET /api/local-ai/status
 * Returns current installation status, download progress, and runtime health.
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await localAiLifecycleManager.getStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve Local AI status'
    });
  }
});

/**
 * POST /api/local-ai/download
 * Triggers background download of model and runtime assets.
 */
router.post('/download', async (req: Request, res: Response) => {
  try {
    const { manifestUrl, assetBaseUrl } = req.body || {};
    const manifest = await localAiLifecycleManager.fetchRemoteManifest(manifestUrl);

    if (!manifest) {
      return res.status(400).json({
        success: false,
        error: 'Failed to fetch or verify release manifest. Ensure the manifest is valid and signed.'
      });
    }

    // Initiate non-blocking download
    modelDownloadManager.startDownload(manifest, { assetBaseUrl });

    res.json({
      success: true,
      message: 'Download initiated successfully',
      data: modelDownloadManager.getState()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to start asset download'
    });
  }
});

/**
 * POST /api/local-ai/cancel
 * Cancels active download.
 */
router.post('/cancel', (_req: Request, res: Response) => {
  try {
    const cancelled = modelDownloadManager.cancelDownload();
    res.json({
      success: true,
      cancelled,
      data: modelDownloadManager.getState()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to cancel download'
    });
  }
});

/**
 * POST /api/local-ai/retry
 * Retries last cancelled or failed download.
 */
router.post('/retry', async (req: Request, res: Response) => {
  try {
    const { assetBaseUrl } = req.body || {};
    modelDownloadManager.retryDownload({ assetBaseUrl });

    res.json({
      success: true,
      message: 'Download retry initiated',
      data: modelDownloadManager.getState()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retry download'
    });
  }
});

/**
 * POST /api/local-ai/toggle
 * Enables or disables Local AI shadow mode.
 */
router.post('/toggle', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body || {};
    const isEnabled = Boolean(enabled);
    process.env.LOCAL_AI_ENABLED = isEnabled ? 'true' : 'false';

    try {
      const db = await dbManager.getConnection();
      await db.run(
        `INSERT INTO app_settings (key, value) VALUES ('local_ai_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [isEnabled ? 'true' : 'false']
      );
    } catch (_) {}

    res.json({
      success: true,
      enabled: isEnabled,
      message: `Local AI shadow mode has been ${isEnabled ? 'enabled' : 'disabled'}`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to toggle Local AI'
    });
  }
});

export default router;

