/**
 * Unified Pharmacy Operations Assistant API Routes
 *
 * Provides REST endpoints for the unified operational assistant:
 * - Natural language commands across Refills, Tasks, Enquiries, WhatsApp, OCR, Inventory & POS
 * - Two-stage confirmation flow (propose -> confirm / cancel)
 * - Session state and context management
 * - Health and readiness status
 */

import express, { Request, Response } from 'express';
import { unifiedAssistantOrchestrator, AssistantRole } from '../services/localAi/unifiedAssistantOrchestrator.js';
import { isLocalAiEnabled, checkLlamaServerHealth } from '../services/localAi/llamaServerClient.js';

const router = express.Router();

/**
 * POST /api/assistant/chat
 * Primary entry point for natural language operations commands and Q&A
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const {
      message,
      sessionId = 'default-staff-session',
      role = 'staff',
      language,
      userId,
      username,
      storeId
    } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message parameter is required and cannot be empty.'
      });
    }

    let resolvedRole: AssistantRole = 'staff';
    if (role === 'customer') {
      resolvedRole = 'customer';
    } else if (role === 'owner') {
      let isVerifiedOwner = false;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const { verifyStaffToken } = await import('../middleware/tenantAuth.js');
          const decoded = verifyStaffToken(authHeader.slice(7));
          if (decoded && decoded.role === 'owner') {
            isVerifiedOwner = true;
          }
        } catch (_) {}
      } else if (userId) {
        try {
          const { dbManager } = await import('../database/connection.js');
          const db = await dbManager.getConnection();
          const userRow = await db.get('SELECT role FROM pharmacy_users WHERE id = ? AND is_active = 1', [userId]);
          if (userRow?.role === 'owner') {
            isVerifiedOwner = true;
          }
        } catch (_) {}
      } else {
        try {
          const { isLocalRequest } = await import('../middleware/tenantAuth.js');
          if (isLocalRequest(req)) {
            isVerifiedOwner = true;
          }
        } catch (_) {}
      }
      resolvedRole = isVerifiedOwner ? 'owner' : 'staff';
    }

    const sessionContext = unifiedAssistantOrchestrator.getSessionContext(
      sessionId,
      resolvedRole,
      language
    );

    if (userId) sessionContext.userId = Number(userId);
    if (username) sessionContext.username = String(username);
    if (storeId) sessionContext.storeId = Number(storeId);

    const response = await unifiedAssistantOrchestrator.processCommand(message.trim(), sessionContext);

    return res.json({
      success: true,
      data: response
    });
  } catch (err: any) {
    console.error('[Assistant Route] Chat error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error processing assistant command.'
    });
  }
});

/**
 * POST /api/assistant/confirm
 * Approves and executes a pending proposed consequential action (Rule 6 Human-in-the-Loop)
 */
router.post('/confirm', async (req: Request, res: Response) => {
  try {
    const {
      proposalId,
      sessionId = 'default-staff-session',
      userId,
      username,
      storeId
    } = req.body || {};

    if (!proposalId) {
      return res.status(400).json({
        success: false,
        error: 'proposalId is required to confirm an action.'
      });
    }

    const operator = {
      userId: userId ? Number(userId) : undefined,
      username: username ? String(username) : 'staff',
      storeId: storeId ? Number(storeId) : 1
    };

    const result = await unifiedAssistantOrchestrator.confirmProposal(proposalId, sessionId, operator);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.message
      });
    }

    return res.json({
      success: true,
      message: result.message,
      data: result.proposal
    });
  } catch (err: any) {
    console.error('[Assistant Route] Confirm error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error confirming assistant proposal.'
    });
  }
});

/**
 * POST /api/assistant/cancel
 * Rejects or cancels a pending proposed action without making changes
 */
router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const { proposalId, sessionId = 'default-staff-session' } = req.body || {};

    if (!proposalId) {
      return res.status(400).json({
        success: false,
        error: 'proposalId is required to cancel an action.'
      });
    }

    const cancelled = unifiedAssistantOrchestrator.cancelProposal(proposalId, sessionId);

    return res.json({
      success: true,
      cancelled,
      message: cancelled ? 'Proposal cancelled successfully.' : 'Proposal not found or already executed.'
    });
  } catch (err: any) {
    console.error('[Assistant Route] Cancel error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error cancelling assistant proposal.'
    });
  }
});

/**
 * POST /api/assistant/clear-session
 * Clears conversational memory for a given session ID
 */
router.post('/clear-session', (req: Request, res: Response) => {
  try {
    const { sessionId = 'default-staff-session' } = req.body || {};
    unifiedAssistantOrchestrator.clearSession(sessionId);

    return res.json({
      success: true,
      message: `Session ${sessionId} cleared.`
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to clear session.'
    });
  }
});

/**
 * GET /api/assistant/status
 * Reports operational readiness, local AI model server health, and memory stats
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const localAiConfigured = isLocalAiEnabled();
    const serverHealthy = localAiConfigured ? await checkLlamaServerHealth() : false;

    return res.json({
      success: true,
      data: {
        status: 'ready',
        localAiConfigured,
        localAiServerHealthy: serverHealthy,
        capabilities: [
          'refills',
          'tasks',
          'enquiries',
          'whatsapp',
          'ocr_review',
          'inventory_pos',
          'pharmacy_qa'
        ],
        supportedLanguages: ['en', 'hi', 'mr', 'hinglish']
      }
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to retrieve assistant status.'
    });
  }
});

export default router;
