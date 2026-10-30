/**
 * Local AI Management Endpoints
 * Provides status, progress, download control, cancellation, and retry for offline AI assets.
 */

import express, { Request, Response } from 'express';
import { localAiLifecycleManager } from '../services/localAi/localAiLifecycleManager.js';
import { qwenReadinessService } from '../services/localAi/qwenReadinessService.js';
import { aiAutomationGate } from '../services/localAi/aiAutomationGate.js';
import { ensureLlamaServerRunning, checkLlamaServerHealth } from '../services/localAi/llamaServerClient.js';
import { detectHardwareAccelerationProfile } from '../services/localAi/hardwareDetector.js';
import { modelDownloadManager } from '../services/localAi/modelDownloadManager.js';
import { dbManager } from '../database/connection.js';

const router = express.Router();

/**
 * GET /api/local-ai/status
 * Returns authoritative 5-level readiness state, download progress, and runtime health.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const readiness = await qwenReadinessService.getStatus(forceRefresh);
    const gateStatus = await aiAutomationGate.getStatus();
    const downloadState = modelDownloadManager.getState();
    const hardwareProfile = detectHardwareAccelerationProfile();

    res.json({
      success: true,
      data: {
        ...readiness,
        automationGate: gateStatus.gate,
        isPausedByUser: gateStatus.isPausedByUser,
        pauseReason: gateStatus.pauseReason,
        downloadState,
        hardwareProfile
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve Local AI status'
    });
  }
});

/**
 * POST /api/local-ai/retry-start
 * Non-blocking start: launches runtime in background and returns immediate STARTING state,
 * preventing frontend 15000ms timeouts while SSE broadcasts final readiness.
 */
router.post('/retry-start', async (_req: Request, res: Response) => {
  try {
    qwenReadinessService.invalidateCache();
    const isHealthy = await checkLlamaServerHealth();
    if (isHealthy) {
      const status = await qwenReadinessService.getStatus(true);
      return res.json({
        success: true,
        message: status.inferenceReady
          ? 'Qwen runtime successfully verified and ready.'
          : `Qwen runtime status: ${status.state}`,
        data: status
      });
    }

    // Launch asynchronously in background so client never blocks or times out
    ensureLlamaServerRunning()
      .then(() => qwenReadinessService.getStatus(true))
      .catch((err) => {
        console.warn('[Local AI] Background startup error:', err?.message || err);
      });

    // Immediate non-blocking response with STARTING state
    const currentStatus = await qwenReadinessService.getStatus(false);
    res.json({
      success: true,
      message: 'Qwen runtime is starting in background...',
      data: {
        ...currentStatus,
        state: 'STARTING'
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to start Qwen runtime'
    });
  }
});

/**
 * GET /api/local-ai/automation-status
 * Returns AI execution gate status and pause state.
 */
router.get('/automation-status', async (_req: Request, res: Response) => {
  try {
    const status = await aiAutomationGate.getStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to retrieve automation gate status'
    });
  }
});

/**
 * POST /api/local-ai/automation-pause
 * Sets manual operator pause for AI-dependent background automation.
 */
router.post('/automation-pause', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body || {};
    await aiAutomationGate.setPaused(true, reason || 'Operator paused via UI');
    res.json({
      success: true,
      message: 'AI automation has been paused.',
      data: await aiAutomationGate.getStatus()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to pause AI automation'
    });
  }
});

/**
 * POST /api/local-ai/automation-resume
 * Resumes AI-dependent background automation after operator pause.
 */
router.post('/automation-resume', async (_req: Request, res: Response) => {
  try {
    await aiAutomationGate.setPaused(false);
    res.json({
      success: true,
      message: 'AI automation has been resumed.',
      data: await aiAutomationGate.getStatus()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to resume AI automation'
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

