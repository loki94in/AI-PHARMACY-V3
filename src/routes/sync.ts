import express from 'express';
import { dbManager } from '../database/connection.js';
import { storeSyncService } from '../services/storeSyncService.js';
import { resolveStoreId } from '../services/storeContextService.js';
import { eventService } from '../services/eventService.js';

const router = express.Router();

// GET /api/sync/status — Get synchronization ledger metrics for active store
router.get('/status', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const status = await storeSyncService.getSyncStatus(storeId);
    res.json(status);
  } catch (err: any) {
    console.error('[SyncRoute] Get status error:', err);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// POST /api/sync/push — Push pending changes to central database
router.post('/push', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const limit = parseInt((req.body.limit as string) || '100', 10) || 100;
    const result = await storeSyncService.pushPendingItems(storeId, limit);
    res.json({ success: true, store_id: storeId, ...result });
  } catch (err: any) {
    console.error('[SyncRoute] Push sync error:', err);
    res.status(500).json({ error: 'Failed to push sync items' });
  }
});

// POST /api/sync/pull — Pull remote changes into local store database with conflict check
router.post('/pull', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { items = [] } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    const result = await storeSyncService.processIncomingSyncBatch(storeId, items);
    res.json({ success: true, store_id: storeId, ...result });
  } catch (err: any) {
    console.error('[SyncRoute] Pull sync error:', err);
    res.status(500).json({ error: 'Failed to apply pull sync' });
  }
});

// POST /api/sync/resolve-conflict — Pharmacist manually resolves a detected sync conflict
router.post('/resolve-conflict', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { conflict_id, resolution = 'keep_local' } = req.body;

    if (!conflict_id) {
      return res.status(400).json({ error: 'conflict_id is required' });
    }

    const db = await dbManager.getConnection();
    const ledgerItem = await db.get(
      'SELECT * FROM store_sync_ledger WHERE id = ? AND store_id = ?',
      [conflict_id, storeId]
    );

    if (!ledgerItem) {
      return res.status(404).json({ error: 'Conflict item not found' });
    }

    if (resolution === 'keep_remote') {
      const payload = JSON.parse(ledgerItem.payload);
      if (ledgerItem.entity_type === 'special_orders' || ledgerItem.entity_type === 'order') {
        await db.run(
          `UPDATE special_orders 
           SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND store_id = ?`,
          [payload.status, payload.notes || '', ledgerItem.entity_id, storeId]
        );
      }
    }

    await db.run(
      `UPDATE store_sync_ledger 
       SET sync_status = 'synced', synced_at = CURRENT_TIMESTAMP, error_message = ?
       WHERE id = ?`,
      [`Resolved manually: ${resolution}`, conflict_id]
    );

    try {
      eventService.broadcast('sync_completed', { at: Date.now(), storeId, resolvedConflict: conflict_id });
    } catch (_) {}

    res.json({ success: true, message: `Conflict #${conflict_id} resolved with ${resolution}` });
  } catch (err: any) {
    console.error('[SyncRoute] Resolve conflict error:', err);
    res.status(500).json({ error: 'Failed to resolve conflict' });
  }
});

export default router;
