import { Router } from 'express';
import { cloudflareTunnelService } from '../services/cloudflareTunnelService.js';

const router = Router();

// GET /api/tunnel/status — Get current live tunnel status & URL
router.get('/status', async (_req, res) => {
  try {
    const status = await cloudflareTunnelService.getStatus();
    res.json({ success: true, ...status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to get tunnel status' });
  }
});

// POST /api/tunnel/start — Launch Cloudflare tunnel
router.post('/start', async (_req, res) => {
  try {
    const status = await cloudflareTunnelService.start();
    res.json({ success: true, ...status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to start tunnel' });
  }
});

// POST /api/tunnel/stop — Stop running Cloudflare tunnel
router.post('/stop', async (_req, res) => {
  try {
    const status = await cloudflareTunnelService.stop();
    res.json({ success: true, ...status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to stop tunnel' });
  }
});

// POST /api/tunnel/configure — Save token, custom domain, and autostart preferences
router.post('/configure', async (req, res) => {
  try {
    const { token, customDomain, autostart } = req.body;
    const status = await cloudflareTunnelService.configure({ token, customDomain, autostart });
    res.json({ success: true, message: 'Tunnel settings saved successfully', ...status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to configure tunnel' });
  }
});

export default router;
