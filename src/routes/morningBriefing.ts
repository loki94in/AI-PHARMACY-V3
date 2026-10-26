/**
 * morningBriefing.ts
 * Express router for Morning Briefing & Reorder Hub Flow
 *
 * GET  /api/morning-briefing                 - Fetch consolidated morning briefing & card counts
 * POST /api/morning-briefing/route-channel   - Route item to WhatsApp Queue or Call Task Queue
 * POST /api/morning-briefing/update-contact  - Correct missing/invalid phone number & re-route
 * POST /api/morning-briefing/call-outcome    - Advance call outcome state machine
 */

import { Router, Request, Response } from 'express';
import {
  getMorningBriefing,
  routeToWhatsAppQueue,
  routeToCallTaskQueue,
  updateContactDetails,
  advanceCallOutcome
} from '../services/morningBriefingService.js';

const router: Router = Router();

// GET /api/morning-briefing
router.get('/', async (_req: Request, res: Response) => {
  try {
    const summary = await getMorningBriefing();
    return res.json({ success: true, ...summary });
  } catch (err: any) {
    console.error('[MorningBriefing] GET error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch morning briefing' });
  }
});

// POST /api/morning-briefing/route-channel
router.post('/route-channel', async (req: Request, res: Response) => {
  try {
    const { channel, item } = req.body;
    if (!channel || !item) {
      return res.status(400).json({ success: false, error: 'channel and item are required' });
    }

    if (channel === 'whatsapp') {
      const result = await routeToWhatsAppQueue({
        customer_name: item.customer_name,
        customer_phone: item.customer_phone,
        source_type: item.source_type || 'order',
        reference_id: item.reference_id,
        message: item.message
      });
      return res.json(result);
    } else if (channel === 'call_task') {
      const result = await routeToCallTaskQueue({
        customer_name: item.customer_name,
        customer_phone: item.customer_phone,
        task_type: item.source_type === 'special_order' ? 'special_order' : (item.source_type === 'online_order' ? 'online_order' : 'refill'),
        reference_id: item.reference_id,
        reason: item.reason || item.title,
        priority: item.priority || 'normal',
        details: item.details
      });
      return res.json(result);
    } else {
      return res.status(400).json({ success: false, error: `Invalid channel: ${channel}` });
    }
  } catch (err: any) {
    console.error('[MorningBriefing] Route channel error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/morning-briefing/update-contact
router.post('/update-contact', async (req: Request, res: Response) => {
  try {
    const { customer_name, old_phone, new_phone, reference_id, source_type } = req.body;
    if (!new_phone) {
      return res.status(400).json({ success: false, error: 'new_phone is required' });
    }

    const result = await updateContactDetails({
      customer_name,
      old_phone,
      new_phone,
      reference_id,
      source_type
    });

    return res.json(result);
  } catch (err: any) {
    console.error('[MorningBriefing] Update contact error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/morning-briefing/call-outcome
router.post('/call-outcome', async (req: Request, res: Response) => {
  try {
    const { task_id, outcome, outcome_notes, reschedule_date, priority } = req.body;
    if (!task_id || !outcome) {
      return res.status(400).json({ success: false, error: 'task_id and outcome are required' });
    }

    const result = await advanceCallOutcome(Number(task_id), outcome, {
      outcome_notes,
      reschedule_date,
      priority
    });

    return res.json(result);
  } catch (err: any) {
    console.error('[MorningBriefing] Call outcome error:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
