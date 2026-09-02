import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { StoreSyncService } from '../src/services/storeSyncService.js';

describe('Central + Local Synchronization (Offline-First)', () => {
  let db: Database;
  let service: StoreSyncService;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE store_sync_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT NOT NULL,
        sync_status TEXT DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME
      );

      CREATE TABLE special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        product TEXT,
        requester TEXT,
        phone TEXT,
        qty INTEGER DEFAULT 1,
        status TEXT DEFAULT 'Pending',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    service = new StoreSyncService();
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('queues offline change items into sync ledger', async () => {
    const ledgerId = await service.queueSyncItem(
      2,
      'special_orders',
      101,
      'insert',
      { product: 'Azithromycin 500mg', qty: 3, requester: 'Grace' },
      db
    );

    expect(ledgerId).toBeGreaterThan(0);

    const pending = await service.getPendingSyncItems(2, 10, db);
    expect(pending.length).toBe(1);
    expect(pending[0].entity_type).toBe('special_orders');
    expect(pending[0].action).toBe('insert');
    expect(pending[0].sync_status).toBe('pending');
  });

  it('pushes pending ledger items and marks them synced', async () => {
    await service.queueSyncItem(2, 'special_orders', 101, 'insert', { product: 'Item 1' }, db);
    await service.queueSyncItem(2, 'special_orders', 102, 'update', { status: 'Fulfilled' }, db);

    const pushRes = await service.pushPendingItems(2, 50, db);
    expect(pushRes.pushedCount).toBe(2);
    expect(pushRes.failedCount).toBe(0);

    const status = await service.getSyncStatus(2, db);
    expect(status.pending_count).toBe(0);
    expect(status.synced_count).toBe(2);
  });

  it('detects and handles sync conflicts cleanly without blind overwriting', async () => {
    // 1. Local store has an order edited recently
    const localUpdated = new Date('2026-09-02T12:00:00Z').toISOString();
    await db.run(
      `INSERT INTO special_orders (id, store_id, product, requester, status, updated_at)
       VALUES (500, 2, 'Insulin Glargine', 'Harry', 'Ready', ?)`,
      [localUpdated]
    );

    // 2. Incoming remote update with an older timestamp
    const remoteOlder = new Date('2026-09-02T11:00:00Z').toISOString();
    const incoming = [
      {
        entity_type: 'special_orders',
        entity_id: '500',
        action: 'update',
        payload: { status: 'Pending', notes: 'Stale remote override' },
        remote_updated_at: remoteOlder
      }
    ];

    const pullRes = await service.processIncomingSyncBatch(2, incoming, db);
    expect(pullRes.conflictsCount).toBe(1);
    expect(pullRes.appliedCount).toBe(0);

    // Verify local state was preserved and NOT overwritten
    const preserved = await db.get('SELECT * FROM special_orders WHERE id = 500 AND store_id = 2');
    expect(preserved.status).toBe('Ready');

    // Verify conflict logged in ledger
    const conflictItem = await db.get('SELECT * FROM store_sync_ledger WHERE sync_status = "conflict"');
    expect(conflictItem).toBeDefined();
    expect(conflictItem.entity_id).toBe('500');
  });
});
