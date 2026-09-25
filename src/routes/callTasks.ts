/**
 * callTasks.ts
 * API routes for the non-WhatsApp patient call task board.
 *
 * GET    /api/call-tasks              - list tasks (filterable by status, type)
 * GET    /api/call-tasks/count        - pending count badge
 * POST   /api/call-tasks              - manually create a call task
 * PATCH  /api/call-tasks/:id/complete - mark called, record outcome
 * PATCH  /api/call-tasks/:id/reschedule - snooze to a future date
 * PATCH  /api/call-tasks/:id/dismiss  - dismiss / cancel
 * PATCH  /api/call-tasks/:id         - generic update (notes, call_outcome, etc.)
 */

import { Router } from 'express';
import { dbManager } from '../database/connection.js';
import { nonWaFallbackService } from '../services/nonWaFallbackService.js';
import { eventService } from '../services/eventService.js';

const router: Router = Router();

// GET /api/call-tasks?status=pending&type=refill&limit=50&offset=0
router.get('/', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { status, type, limit = '50', offset = '0' } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: any[] = [];

    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }
    if (type && type !== 'all') {
      conditions.push('task_type = ?');
      params.push(type);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const tasks = await db.all(
      `SELECT * FROM patient_call_tasks ${where} ORDER BY
         CASE WHEN status = 'pending' THEN 0 WHEN status = 'rescheduled' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), parseInt(offset, 10)]
    );

    const total = await db.get(
      `SELECT COUNT(*) as c FROM patient_call_tasks ${where}`,
      params
    );

    return res.json({ success: true, tasks, total: total?.c ?? 0 });
  } catch (err: any) {
    console.error('[CallTasks] GET error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/call-tasks/count
router.get('/count', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get(
      "SELECT COUNT(*) as c FROM patient_call_tasks WHERE status IN ('pending', 'rescheduled')"
    );
    return res.json({ success: true, count: row?.c ?? 0 });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/call-tasks - manual task creation
router.post('/', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { task_type, patient_name, patient_phone, details, reference_id } = req.body;

    if (!task_type || !patient_name || !patient_phone) {
      return res.status(400).json({ success: false, error: 'task_type, patient_name, and patient_phone are required' });
    }
    if (!['refill', 'credit'].includes(task_type)) {
      return res.status(400).json({ success: false, error: 'task_type must be refill or credit' });
    }

    const result = await db.run(
      `INSERT INTO patient_call_tasks
         (task_type, patient_name, patient_phone, reference_id, details_json, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [task_type, patient_name, patient_phone, reference_id || null, JSON.stringify({ details: details || '' })]
    );

    eventService.broadcast('call_tasks_updated', { taskId: result.lastID, taskType: task_type });
    return res.json({ success: true, id: result.lastID });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/call-tasks/:id/complete
router.patch('/:id/complete', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { id } = req.params;
    const { call_outcome, notes } = req.body;

    await db.run(
      `UPDATE patient_call_tasks
       SET status = 'completed', call_outcome = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [call_outcome || 'called', notes || null, parseInt(id, 10)]
    );

    eventService.broadcast('call_tasks_updated', { taskId: parseInt(id, 10), status: 'completed' });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/call-tasks/:id/reschedule
router.patch('/:id/reschedule', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { id } = req.params;
    const { reschedule_date, notes } = req.body;

    if (!reschedule_date) {
      return res.status(400).json({ success: false, error: 'reschedule_date is required (YYYY-MM-DD)' });
    }

    await db.run(
      `UPDATE patient_call_tasks
       SET status = 'rescheduled', reschedule_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reschedule_date, notes || null, parseInt(id, 10)]
    );

    eventService.broadcast('call_tasks_updated', { taskId: parseInt(id, 10), status: 'rescheduled' });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/call-tasks/:id/dismiss
router.patch('/:id/dismiss', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { id } = req.params;
    const { notes } = req.body;

    await db.run(
      `UPDATE patient_call_tasks
       SET status = 'dismissed', notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [notes || null, parseInt(id, 10)]
    );

    eventService.broadcast('call_tasks_updated', { taskId: parseInt(id, 10), status: 'dismissed' });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/call-tasks/:id  - generic update (notes, call_outcome)
router.patch('/:id', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { id } = req.params;
    const { notes, call_outcome } = req.body;

    await db.run(
      `UPDATE patient_call_tasks
       SET notes = COALESCE(?, notes), call_outcome = COALESCE(?, call_outcome), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [notes ?? null, call_outcome ?? null, parseInt(id, 10)]
    );

    eventService.broadcast('call_tasks_updated', { taskId: parseInt(id, 10) });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;