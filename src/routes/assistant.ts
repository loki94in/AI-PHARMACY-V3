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
import { conversationalAgentEngine } from '../services/localAi/conversationalAgentEngine.js';
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
      storeId,
      pageContext,
      imageBase64,
      docType
    } = req.body || {};

    let imageBuffer: Buffer | undefined;
    if (imageBase64 && typeof imageBase64 === 'string') {
      try {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        imageBuffer = Buffer.from(cleanBase64, 'base64');
      } catch (_) {}
    }

    if ((!message || typeof message !== 'string' || !message.trim()) && !imageBuffer) {
      return res.status(400).json({
        success: false,
        error: 'Message parameter or image payload is required.'
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

    const agentResult = await conversationalAgentEngine.processMessage({
      message: (message || '').trim(),
      sessionId,
      role: resolvedRole,
      userId: userId ? Number(userId) : undefined,
      username: username ? String(username) : undefined,
      storeId: storeId ? Number(storeId) : undefined,
      language,
      pageContext,
      imageBuffer,
      docType
    });

    const response = {
      sessionId: agentResult.sessionId,
      query: (message || '').trim() || '[Document Image]',
      reply: agentResult.replyText,
      actionType: agentResult.intent,
      proposedAction: agentResult.proposedAction ? {
        id: agentResult.proposedAction.id || `prop_${Date.now()}`,
        actionType: agentResult.proposedAction.type,
        description: agentResult.proposedAction.summary,
        payload: agentResult.proposedAction.data,
        requiresConfirmation: agentResult.requiresConfirmation,
        status: agentResult.proposedAction.status || 'PENDING_CONFIRMATION',
        createdAt: new Date().toISOString()
      } : undefined,
      cards: agentResult.cards || [],
      suggestedFollowUps: agentResult.suggestedFollowUps || [],
      requiresConfirmation: agentResult.requiresConfirmation,
      latencyMs: agentResult.latencyMs || 0
    };

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

    // 1. Check conversational agent engine confirmation
    const agentConfirm = await conversationalAgentEngine.processMessage({
      sessionId,
      message: 'yes',
      userId: userId ? Number(userId) : undefined,
      username: username ? String(username) : 'staff',
      storeId: storeId ? Number(storeId) : 1
    });

    if (agentConfirm.actionTaken) {
      return res.json({
        success: true,
        message: agentConfirm.replyText,
        data: agentConfirm.proposedAction || { id: proposalId, status: 'EXECUTED' }
      });
    }

    // 2. Fall back to unifiedAssistantOrchestrator
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
 * POST /api/assistant/upload-document
 * Uploads prescription, invoice, or medicine packaging image for OCR intelligence
 */
router.post('/upload-document', async (req: Request, res: Response) => {
  try {
    const {
      imageBase64,
      docType = 'prescription',
      sessionId = 'default-staff-session',
      role = 'staff',
      storeId = 1
    } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'imageBase64 parameter is required.'
      });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    const agentResult = await conversationalAgentEngine.processMessage({
      message: `Process uploaded ${docType} document`,
      sessionId,
      role: role === 'owner' ? 'owner' : (role === 'customer' ? 'customer' : 'staff'),
      storeId: Number(storeId),
      imageBuffer: buffer,
      docType: docType as any
    });

    return res.json({
      success: true,
      data: {
        sessionId: agentResult.sessionId,
        reply: agentResult.replyText,
        actionType: agentResult.intent,
        proposedAction: agentResult.proposedAction,
        cards: agentResult.cards || [],
        suggestedFollowUps: agentResult.suggestedFollowUps || []
      }
    });
  } catch (err: any) {
    console.error('[Assistant Route] Upload error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to process document upload.'
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

/**
 * GET /api/assistant/capabilities
 * Reports the full capabilities registry, supported roles, and confirmation gates
 */
router.get('/capabilities', (_req: Request, res: Response) => {
  try {
    const registry = unifiedAssistantOrchestrator.getCapabilityRegistry();
    return res.json({
      success: true,
      data: registry
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to retrieve capability registry.'
    });
  }
});

export default router;
