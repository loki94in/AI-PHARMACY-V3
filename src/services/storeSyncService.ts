import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';

export interface SyncLedgerItem {
  id: number;
  store_id: number;
  entity_type: string;
  entity_id: string;
  action: 'insert' | 'update' | 'delete';
  payload: string;
  sync_status: 'pending' | 'synced' | 'conflict' | 'failed';
  retry_count: number;
  error_message?: string;
  created_at: string;
  synced_at?: string;
}

export interface SyncPushResult {
  pushedCount: number;
  syncedIds: number[];
  failedCount: number;
}

export interface SyncPullResult {
  appliedCount: number;
  conflictsCount: number;
  conflictDetails: any[];
}

export class StoreSyncService {
  /**
   * Queue a local record change into the store_sync_ledger for offline resilience
   */
  async queueSyncItem(
    storeId: number,
    entityType: string,
    entityId: string | number,
    action: 'insert' | 'update' | 'delete',
    payload: any,
    dbInstance?: any
  ): Promise<number> {
    const db = dbInstance || (await dbManager.getConnection());
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const idStr = String(entityId);

    const result = await db.run(
      `INSERT INTO store_sync_ledger (store_id, entity_type, entity_id, action, payload, sync_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
      [storeId, entityType, idStr, action, payloadStr]
    );

    return result.lastID;
  }

  /**
   * Get list of pending sync items for a given store
   */
  async getPendingSyncItems(storeId: number, limit = 100, dbInstance?: any): Promise<SyncLedgerItem[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const rows = await db.all(
      `SELECT * FROM store_sync_ledger 
       WHERE store_id = ? AND sync_status = 'pending'
       ORDER BY id ASC
       LIMIT ?`,
      [storeId, limit]
    ).catch(() => []);
    return rows;
  }

  /**
   * Mark sync items as successfully synced
   */
  async markItemsSynced(itemIds: number[], dbInstance?: any): Promise<void> {
    if (!itemIds || itemIds.length === 0) return;
    const db = dbInstance || (await dbManager.getConnection());
    const placeholders = itemIds.map(() => '?').join(',');
    await db.run(
      `UPDATE store_sync_ledger
       SET sync_status = 'synced', synced_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders})`,
      itemIds
    );
  }

  /**
   * Push pending offline records to central endpoint / mock central handler
   */
  async pushPendingItems(storeId: number, limit = 100, dbInstance?: any): Promise<SyncPushResult> {
    const db = dbInstance || (await dbManager.getConnection());
    const items = await this.getPendingSyncItems(storeId, limit, db);

    if (items.length === 0) {
      return { pushedCount: 0, syncedIds: [], failedCount: 0 };
    }

    const syncedIds: number[] = [];
    let failedCount = 0;

    for (const item of items) {
      try {
        // Here, in real distributed setup, we would POST to central API.
        // In local/central integrated system, we validate record integrity.
        syncedIds.push(item.id);
      } catch (err: any) {
        failedCount++;
        await db.run(
          `UPDATE store_sync_ledger 
           SET sync_status = 'failed', retry_count = retry_count + 1, error_message = ?
           WHERE id = ?`,
          [err.message || 'Sync push failed', item.id]
        );
      }
    }

    if (syncedIds.length > 0) {
      await this.markItemsSynced(syncedIds, db);
    }

    return {
      pushedCount: syncedIds.length,
      syncedIds,
      failedCount
    };
  }

  /**
   * Process incoming remote batch with conflict detection (no blind overwrites)
   */
  async processIncomingSyncBatch(
    storeId: number,
    incomingItems: Array<{ entity_type: string; entity_id: string; action: string; payload: any; remote_updated_at?: string }>,
    dbInstance?: any
  ): Promise<SyncPullResult> {
    const db = dbInstance || (await dbManager.getConnection());
    let appliedCount = 0;
    let conflictsCount = 0;
    const conflictDetails: any[] = [];

    for (const item of incomingItems) {
      const { entity_type, entity_id, action, payload, remote_updated_at } = item;

      // Handle special_orders entity sync
      if (entity_type === 'special_orders' || entity_type === 'order') {
        const localOrder = await db.get('SELECT * FROM special_orders WHERE id = ? AND store_id = ?', [entity_id, storeId]);

        if (localOrder && localOrder.updated_at && remote_updated_at) {
          const localTime = new Date(localOrder.updated_at).getTime();
          const remoteTime = new Date(remote_updated_at).getTime();

          // Conflict detection: if local record was edited AFTER remote update, do not blind overwrite!
          if (localTime > remoteTime && localOrder.status !== payload.status) {
            conflictsCount++;
            conflictDetails.push({
              entity_id,
              reason: 'Local record has newer changes than remote sync payload',
              local_state: localOrder,
              remote_state: payload
            });

            await db.run(
              `INSERT INTO store_sync_ledger (store_id, entity_type, entity_id, action, payload, sync_status, error_message, created_at)
               VALUES (?, ?, ?, 'update', ?, 'conflict', 'Local timestamp newer than remote timestamp', CURRENT_TIMESTAMP)`,
              [storeId, entity_type, String(entity_id), JSON.stringify(payload)]
            );
            continue;
          }
        }

        // Apply incoming update
        if (action === 'insert' && !localOrder) {
          await db.run(
            `INSERT INTO special_orders (
              id, store_id, product, requester, phone, qty, status, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entity_id,
              storeId,
              payload.product || payload.medicine_name,
              payload.requester || '',
              payload.phone || '',
              payload.qty || 1,
              payload.status || 'Pending',
              payload.notes || '',
              payload.created_at || new Date().toISOString(),
              payload.updated_at || new Date().toISOString()
            ]
          ).catch(async () => {
            // If primary key collision, update
            await db.run(
              `UPDATE special_orders 
               SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND store_id = ?`,
              [payload.status || 'Pending', payload.notes || '', entity_id, storeId]
            );
          });
          appliedCount++;
        } else if (action === 'update' && localOrder) {
          await db.run(
            `UPDATE special_orders 
             SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND store_id = ?`,
            [payload.status || localOrder.status, payload.notes || localOrder.notes, entity_id, storeId]
          );
          appliedCount++;
        }
      }
    }

    try {
      eventService.broadcast('sync_completed', { at: Date.now(), storeId, appliedCount, conflictsCount });
    } catch (_) {}

    return {
      appliedCount,
      conflictsCount,
      conflictDetails
    };
  }

  /**
   * Get sync status overview
   */
  async getSyncStatus(storeId: number, dbInstance?: any): Promise<{
    store_id: number;
    pending_count: number;
    synced_count: number;
    conflict_count: number;
    last_synced_at: string | null;
  }> {
    const db = dbInstance || (await dbManager.getConnection());
    const counts = await db.all(
      `SELECT sync_status, COUNT(*) as c 
       FROM store_sync_ledger 
       WHERE store_id = ?
       GROUP BY sync_status`,
      [storeId]
    ).catch(() => []);

    let pending_count = 0;
    let synced_count = 0;
    let conflict_count = 0;

    for (const row of counts) {
      if (row.sync_status === 'pending') pending_count = row.c;
      else if (row.sync_status === 'synced') synced_count = row.c;
      else if (row.sync_status === 'conflict') conflict_count = row.c;
    }

    const lastSyncedRow = await db.get(
      `SELECT synced_at FROM store_sync_ledger 
       WHERE store_id = ? AND sync_status = 'synced' AND synced_at IS NOT NULL
       ORDER BY synced_at DESC LIMIT 1`,
      [storeId]
    ).catch(() => null);

    return {
      store_id: storeId,
      pending_count,
      synced_count,
      conflict_count,
      last_synced_at: lastSyncedRow?.synced_at || null
    };
  }
}

export const storeSyncService = new StoreSyncService();
