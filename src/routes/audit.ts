import express from 'express';
import { dbManager } from '../database/connection.js';
import { runAudit } from '../utils/auditEngine.js';
import { getMutationAuditLogs } from '../services/auditLoggerService.js';
import { resolveStoreId } from '../services/storeContextService.js';
import { eventService } from '../services/eventService.js';

const router = express.Router();

async function logAudit(db: any, report: Awaited<ReturnType<typeof runAudit>>) {
  const description = `${report.status} — ${report.blockingCount} blocking issue(s) across ${report.issueCategories}/${report.totalCategories} categories with findings`;
  const result = await db.run(
    'INSERT INTO action_logs (action_type, description, metadata) VALUES (?, ?, ?)',
    ['AUDIT', description, JSON.stringify(report)]
  );
  return result.lastID;
}

// Run a fresh audit against live data and persist the result.
router.post('/run', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const report = await runAudit(db);
    const id = await logAudit(db, report);
    try {
      eventService.broadcast('audit_updated', { at: Date.now(), id, status: report.status });
    } catch (_) {}
    res.json({ id, ...report });
  } catch (err: any) {
    console.error('Audit run error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Most recently stored audit result, if any.
router.get('/latest', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get(
      "SELECT id, metadata, created_at FROM action_logs WHERE action_type = 'AUDIT' ORDER BY id DESC LIMIT 1"
    );
    if (!row) return res.json(null);
    res.json({ id: row.id, storedAt: row.created_at, ...JSON.parse(row.metadata) });
  } catch (err: any) {
    console.error('Audit latest error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lightweight history list for reopening a past audit.
router.get('/history', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      "SELECT id, description, metadata, created_at FROM action_logs WHERE action_type = 'AUDIT' ORDER BY id DESC LIMIT 50"
    );
    const history = rows.map((r: any) => {
      let status = 'UNKNOWN';
      let blockingCount = 0;
      try {
        const meta = JSON.parse(r.metadata);
        status = meta.status;
        blockingCount = meta.blockingCount;
      } catch (_e) { /* tolerate malformed legacy rows */ }
      return { id: r.id, storedAt: r.created_at, description: r.description, status, blockingCount };
    });
    res.json(history);
  } catch (err: any) {
    console.error('Audit history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Query mutation audit trail (§29)
router.get('/mutations', async (req, res) => {
  try {
    const storeId = req.query.all_stores === 'true' ? undefined : resolveStoreId(req);
    const userId = req.query.user_id ? Number(req.query.user_id) : undefined;
    const entity = req.query.entity ? String(req.query.entity) : undefined;
    const entityId = req.query.entity_id ? String(req.query.entity_id) : undefined;
    const action = req.query.action ? String(req.query.action) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const logs = await getMutationAuditLogs({
      storeId,
      userId,
      entity,
      entityId,
      action,
      limit,
      offset
    });
    res.json(logs);
  } catch (err: any) {
    console.error('Mutation audit logs fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// A specific past audit by id.
router.get('/:id', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get(
      "SELECT id, metadata, created_at FROM action_logs WHERE action_type = 'AUDIT' AND id = ?",
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Audit not found' });
    res.json({ id: row.id, storedAt: row.created_at, ...JSON.parse(row.metadata) });
  } catch (err: any) {
    console.error('Audit fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
