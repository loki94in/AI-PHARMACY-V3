import './sqlitePatch.js';
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';

import { AsyncLocalStorage } from 'node:async_hooks';
import { config, getAppDataDir, isPackagedApp } from '../config/index.js';

export type TxPriority = 'VIP' | 'NORMAL' | 'BACKGROUND';
export const txPriorityStorage = new AsyncLocalStorage<TxPriority>();

const DB_PATH = config.dbPath;

class DatabaseManager {
  private static instance: DatabaseManager;
  private connection: Database | null = null;
  private currentDbPath: string | null = null;
  // Gate against callers re-opening a connection while the underlying file is being
  // replaced on disk (e.g. migration finalize's backup/swap). Every background timer
  // in this process (messaging queue, device-connection poll, stock calculator, etc.)
  // calls getConnection() on its own schedule; without this gate one of them can reopen
  // a connection mid-swap, write a WAL against the old file layout, and corrupt the file
  // fs.copyFileSync just replaced underneath it.
  private suspendedUntil: Promise<void> | null = null;
  private resumeFn: (() => void) | null = null;

  // Prioritized transaction mutex (VIP for POS sales, NORMAL for interactive requests, BACKGROUND for workers).
  // node-sqlite3 does not queue statements against SQLite's own transaction state — two concurrent
  // requests both issuing 'BEGIN IMMEDIATE TRANSACTION' on this same connection object collide with
  // "cannot start a transaction within a transaction". This prioritized queue guarantees POS checkouts
  // jump ahead of background workers while preventing collision crashes.
  private isTxLocked = false;
  private activeTxPriority: TxPriority | null = null;
  private activeTxRelease: (() => void) | null = null;
  private activeTxTimer: NodeJS.Timeout | null = null;

  private txWaiters: {
    VIP: Array<{ priority: TxPriority; resolve: (release: () => void) => void; enqueuedAt: number }>;
    NORMAL: Array<{ priority: TxPriority; resolve: (release: () => void) => void; enqueuedAt: number }>;
    BACKGROUND: Array<{ priority: TxPriority; resolve: (release: () => void) => void; enqueuedAt: number }>;
  } = {
    VIP: [],
    NORMAL: [],
    BACKGROUND: []
  };

  private lockStats = {
    totalAcquisitions: 0,
    vipCount: 0,
    normalCount: 0,
    backgroundCount: 0,
    lastAcquiredAt: 0
  };

  public getLockStats() {
    return {
      totalAcquisitions: this.lockStats.totalAcquisitions,
      vipCount: this.lockStats.vipCount,
      normalCount: this.lockStats.normalCount,
      backgroundCount: this.lockStats.backgroundCount,
      isTxLocked: this.isTxLocked,
      activeTxPriority: this.activeTxPriority,
      currentWaiters: {
        VIP: this.txWaiters.VIP.length,
        NORMAL: this.txWaiters.NORMAL.length,
        BACKGROUND: this.txWaiters.BACKGROUND.length
      }
    };
  }

  public runWithPriority<T>(priority: TxPriority, fn: () => T): T {
    return txPriorityStorage.run(priority, fn);
  }

  private popNextWaiter(): { priority: TxPriority; resolve: (release: () => void) => void; enqueuedAt: number } | null {
    // 1. VIP waiters (POS checkout, billing) ALWAYS jump ahead
    if (this.txWaiters.VIP.length > 0) {
      return this.txWaiters.VIP.shift()!;
    }
    // 2. Interactive user operations
    if (this.txWaiters.NORMAL.length > 0) {
      return this.txWaiters.NORMAL.shift()!;
    }
    // 3. Background workers (catalog import, composition, migration)
    if (this.txWaiters.BACKGROUND.length > 0) {
      return this.txWaiters.BACKGROUND.shift()!;
    }
    return null;
  }

  private releaseTxLock(): void {
    if (this.activeTxTimer) {
      clearTimeout(this.activeTxTimer);
      this.activeTxTimer = null;
    }

    const next = this.popNextWaiter();
    if (next) {
      this.activeTxPriority = next.priority;
      this.lockStats.totalAcquisitions++;
      if (next.priority === 'VIP') this.lockStats.vipCount++;
      else if (next.priority === 'NORMAL') this.lockStats.normalCount++;
      else this.lockStats.backgroundCount++;
      this.lockStats.lastAcquiredAt = Date.now();

      // Arm safety watchdog for next holder (max 60s transaction duration)
      this.activeTxTimer = setTimeout(() => {
        console.warn(`[DB-MUTEX] Transaction held for >60s by priority [${next.priority}]. Forcing release to prevent deadlock.`);
        this.releaseTxLock();
      }, 60000);
      this.activeTxTimer.unref();

      const releaseFn = () => this.releaseTxLock();
      this.activeTxRelease = releaseFn;
      next.resolve(releaseFn);
    } else {
      this.isTxLocked = false;
      this.activeTxPriority = null;
      this.activeTxRelease = null;
    }
  }

  public acquireTxLock(hintPriority?: TxPriority): Promise<() => void> {
    const priority: TxPriority = hintPriority || txPriorityStorage.getStore() || 'NORMAL';
    const releaseFn = () => this.releaseTxLock();

    if (!this.isTxLocked) {
      this.isTxLocked = true;
      this.activeTxPriority = priority;
      this.activeTxRelease = releaseFn;
      this.lockStats.totalAcquisitions++;
      if (priority === 'VIP') this.lockStats.vipCount++;
      else if (priority === 'NORMAL') this.lockStats.normalCount++;
      else this.lockStats.backgroundCount++;
      this.lockStats.lastAcquiredAt = Date.now();

      // Arm safety watchdog (max 60s transaction duration)
      this.activeTxTimer = setTimeout(() => {
        console.warn(`[DB-MUTEX] Transaction held for >60s by priority [${priority}]. Forcing release to prevent deadlock.`);
        this.releaseTxLock();
      }, 60000);
      this.activeTxTimer.unref();

      return Promise.resolve(releaseFn);
    }

    // Queue waiter in prioritized bucket
    return new Promise<() => void>((resolve) => {
      this.txWaiters[priority].push({
        priority,
        resolve,
        enqueuedAt: Date.now()
      });
    });
  }

  public isBooting = false;

  private constructor() {}

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  /** Block new connections (existing callers already mid-call are unaffected) until resume(). */
  public suspend(): void {
    if (this.suspendedUntil) return;
    this.suspendedUntil = new Promise(resolve => { this.resumeFn = resolve; });
  }

  public resume(): void {
    if (this.resumeFn) {
      this.resumeFn();
      this.resumeFn = null;
    }
    this.suspendedUntil = null;
  }

  public async getConnection(): Promise<Database> {
    if (this.suspendedUntil) await this.suspendedUntil;
    const dbPath = config.dbPath;
    if (this.connection) {
      try {
        await this.connection.get('SELECT 1');
      } catch (err: any) {
        if (err?.code === 'SQLITE_MISUSE' || err?.message?.includes('closed') || err?.message?.includes('MISUSE')) {
          this.connection = null;
        }
      }
    }

    if (!this.connection || this.currentDbPath !== dbPath) {
      if (this.connection) {
        try {
          await this.connection.close();
        } catch (e) {}
        this.connection = null;
      }

      const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
      const busyTimeout = isTest ? 5000 : 30000;
      const maxAttempts = 10;
      let lastError: any = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let db = new Database({ filename: dbPath, driver: sqlite3.Database });
        let needsHeal = false;
        let initialErrorMsg = '';
        let openSuccess = false;

        try {
          await db.open();
          await db.run(`PRAGMA busy_timeout = ${busyTimeout};`);
          await db.run('PRAGMA journal_mode = WAL;');
          await db.run('PRAGMA synchronous = NORMAL;');
          await db.run('PRAGMA cache_size = -16000;');
          await db.run('PRAGMA temp_store = MEMORY;');
          await db.run('PRAGMA mmap_size = 268435456;');
          openSuccess = true;
        } catch (err: any) {
          lastError = err;
          const isBusy = err?.message?.includes('SQLITE_BUSY') || err?.message?.includes('locked') || err?.code === 'SQLITE_BUSY';
          if (!isBusy) {
            needsHeal = true;
            initialErrorMsg = err.message || 'Failed to open database file';
          } else {
            console.warn(`[DB] Database busy on connection open (attempt ${attempt}/${maxAttempts}), retrying...`);
          }
          try {
            await db.close();
          } catch (_) {}
        }

        if (needsHeal) {
          try {
            db = await this.runSelfHealing(dbPath, busyTimeout, initialErrorMsg);
            openSuccess = true;
          } catch (healErr) {
            lastError = healErr;
            openSuccess = false;
          }
        }

        if (openSuccess) {
          this.setupWriteInterceptor(db);
          this.connection = db;
          this.currentDbPath = dbPath;
          break;
        }

        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 300 * attempt));
        }
      }

      if (!this.connection) {
        throw new Error(`Database connection is currently busy or unavailable. Please retry. (${lastError?.message || 'SQLITE_BUSY'})`);
      }


    }
    return this.connection;
  }

  private setupWriteInterceptor(db: Database) {
    const originalRun = db.run.bind(db);
    const originalExec = db.exec.bind(db);
    const self = this;

    // Classify BEGIN/COMMIT/ROLLBACK and detect transaction priority (VIP, NORMAL, BACKGROUND)
    const txPhase = (sql: string): { phase: 'begin' | 'end' | null; priority: TxPriority } => {
      const trimmed = sql.trim().toUpperCase();
      let priority: TxPriority = txPriorityStorage.getStore() || 'NORMAL';

      if (trimmed.includes('IMMEDIATE') || trimmed.includes('/* VIP */')) {
        priority = 'VIP';
      } else if (trimmed.includes('/* BACKGROUND */')) {
        priority = 'BACKGROUND';
      }

      if (trimmed.startsWith('BEGIN')) return { phase: 'begin', priority };
      if (trimmed === 'COMMIT' || trimmed.startsWith('ROLLBACK')) return { phase: 'end', priority };
      return { phase: null, priority };
    };

    const releaseIfHeld = () => {
      if (self.activeTxRelease) {
        const release = self.activeTxRelease;
        self.activeTxRelease = null;
        release();
      }
    };

    const checkWriteQuery = (sql: string): { isInventoryWrite: boolean } => {
      if (!sql) return { isInventoryWrite: false };
      const sqlLower = sql.toLowerCase();
      const isWrite = sqlLower.includes('insert') || sqlLower.includes('update') || sqlLower.includes('delete');
      const isInternal = sqlLower.includes('action_logs') || sqlLower.includes('app_settings') || sqlLower.includes('processed_emails') || sqlLower.includes('processed_files') || sqlLower.includes('push_tokens');
      if (isWrite && !isInternal && !self.isBooting && process.env.NODE_ENV !== 'test') {
        const isInventoryWrite = sqlLower.includes('inventory_master') || 
                                 sqlLower.includes('sale_items') || 
                                 sqlLower.includes('sales_invoices') || 
                                 sqlLower.includes('purchase_items') || 
                                 sqlLower.includes('purchases') || 
                                 sqlLower.includes('return_items') || 
                                 sqlLower.includes('returns');
        return { isInventoryWrite };
      }
      return { isInventoryWrite: false };
    };

    db.run = async function (sql: any, ...params: any[]) {
      if (typeof sql === 'string') {
        const { phase, priority } = txPhase(sql);
        if (phase === 'begin') {
          const release = await self.acquireTxLock(priority);
          self.activeTxRelease = release;
          try {
            return await originalRun(sql, ...params);
          } catch (err) {
            releaseIfHeld();
            throw err;
          }
        }
        if (phase === 'end') {
          try {
            return await originalRun(sql, ...params);
          } finally {
            releaseIfHeld();
          }
        }

        const sqlLower = sql.toLowerCase();
        const { isInventoryWrite } = checkWriteQuery(sql);
        if (isInventoryWrite) {
          let inventoryIds: number[] | undefined;
          if (sqlLower.includes('update') && sqlLower.includes('inventory_master') && sqlLower.includes('where')) {
            const flatParams: any[] = [];
            for (const p of params) {
              if (Array.isArray(p)) flatParams.push(...p);
              else if (p !== undefined && p !== null) flatParams.push(p);
            }
            const lastNum = [...flatParams].reverse().find(v => typeof v === 'number' && Number.isInteger(v) && v > 0);
            if (lastNum !== undefined) inventoryIds = [lastNum as number];
          }
          import('../services/expiryAlertService.js')
            .then(m => m.triggerExpiryCacheRebuildDebounced(inventoryIds))
            .catch(err => console.error('Failed to trigger expiry cache rebuild:', err));
          import('../worker/stockCalculatorWorker.js')
            .then(m => m.triggerPreCalculatedStockRebuildDebounced(inventoryIds))
            .catch(err => console.error('Failed to trigger precalculated stock rebuild:', err));
          import('../routes/inventory.js')
            .then(m => m.invalidateInventoryCountCache())
            .catch(() => {});
          // Investigation timeline cache: any transactional write (sales,
          // purchases, returns, inventory) invalidates cached ledger pages so
          // the next fetch recomputes with fresh data instead of serving a
          // stale 60s entry after a stock-affecting change.
          import('../routes/investigation.js')
            .then(m => m.invalidateInvestigationTimelineCache())
            .catch(() => {});
          import('../services/nonMovingReportService.js')
            .then(m => m.invalidateNonMovingReportCache())
            .catch(() => {});
          import('../routes/reports.js')
            .then(m => m.invalidateReportsSummaryCache())
            .catch(() => {});
        }
      }
      return originalRun(sql, ...params);
    } as any;

    db.exec = async function (sql: string) {
      const { phase, priority } = txPhase(sql);
      if (phase === 'begin') {
        const release = await self.acquireTxLock(priority);
        self.activeTxRelease = release;
        try {
          return await originalExec(sql);
        } catch (err) {
          releaseIfHeld();
          throw err;
        }
      }
      if (phase === 'end') {
        try {
          return await originalExec(sql);
        } finally {
          releaseIfHeld();
        }
      }
      checkWriteQuery(sql);
      return originalExec(sql);
    };
  }

  private async runSelfHealing(dbPath: string, busyTimeout: number, initialErrorMsg: string, oldDb?: Database): Promise<Database> {
    if (process.env.DISABLE_SELF_HEALING_WORKERS !== 'false') {
      console.warn('[DB] Self-healing DB worker is DISABLED. Skipping silent DB auto-restoration.');
      throw new Error(`DB_INTEGRITY_FAILURE: ${initialErrorMsg}`);
    }

    if (oldDb) {
      try {
        await oldDb.close();
      } catch (_) {}
    }

    console.error('[DB] Database load failed. Starting silent self-healing database restoration...');
    const logPath = path.join(path.dirname(dbPath), 'self_healing.log');
    const appendLog = (msg: string) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
    };
    appendLog(`[ERROR] DB_CORRUPT: ${initialErrorMsg}`);

    // Find backups
    const backups: { path: string; name: string; mtime: number; type: 'bak' | 'gz' }[] = [];

    // 1. Check data folder for raw backups app.db.bak_*
    const dataDir = path.dirname(dbPath);
    if (fs.existsSync(dataDir)) {
      fs.readdirSync(dataDir).forEach(file => {
        if (file.startsWith('app.db.bak_')) {
          const fp = path.join(dataDir, file);
          backups.push({
            path: fp,
            name: file,
            mtime: fs.statSync(fp).mtime.getTime(),
            type: 'bak'
          });
        }
      });
    }

    // 2. Check backup/snapshots for snapshot_*.db.gz
    const snapshotsDir = path.join(getAppDataDir(), 'backup', 'snapshots');
    if (fs.existsSync(snapshotsDir)) {
      fs.readdirSync(snapshotsDir).forEach(file => {
        if (file.startsWith('snapshot_') && file.endsWith('.db.gz')) {
          const fp = path.join(snapshotsDir, file);
          backups.push({
            path: fp,
            name: file,
            mtime: fs.statSync(fp).mtime.getTime(),
            type: 'gz'
          });
        }
      });
    }

    // Sort backups newest first
    backups.sort((a, b) => b.mtime - a.mtime);

    if (backups.length === 0) {
      appendLog('[FATAL] Restoration failed: No backups available.');
      throw new Error('DB_INTEGRITY_FAILURE');
    }

    const targetBackup = backups[0];
    appendLog(`[ACTION] RENAME: ${dbPath} -> ${dbPath}.corrupt`);

    try {
      if (fs.existsSync(dbPath)) {
        if (fs.existsSync(dbPath + '.corrupt')) {
          fs.unlinkSync(dbPath + '.corrupt');
        }
        fs.renameSync(dbPath, dbPath + '.corrupt');
      }
      // Clean up logs to prevent carry-over corruption
      if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
      if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
    } catch (err: any) {
      appendLog(`[ERROR] Failed to rename corrupt database or clean logs: ${err.message}`);
      throw new Error('DB_INTEGRITY_FAILURE');
    }

    appendLog(`[ACTION] RESTORE: Restoring from backup ${targetBackup.name}`);
    try {
      if (targetBackup.type === 'gz') {
        const gunzip = zlib.createGunzip();
        const source = fs.createReadStream(targetBackup.path);
        const destination = fs.createWriteStream(dbPath);
        await pipeline(source, gunzip, destination);
      } else {
        fs.copyFileSync(targetBackup.path, dbPath);
      }
    } catch (err: any) {
      appendLog(`[ERROR] Failed to restore backup file: ${err.message}`);
      throw new Error('DB_INTEGRITY_FAILURE');
    }

    // Re-open DB
    try {
      const healedDb = await open({ filename: dbPath, driver: sqlite3.Database });
      await healedDb.run(`PRAGMA busy_timeout = ${busyTimeout};`);

      // Re-verify
      const healedIntegrity = await healedDb.get('PRAGMA integrity_check');
      if (healedIntegrity?.integrity_check !== 'ok') {
        appendLog(`[ERROR] Restored database from ${targetBackup.name} failed integrity check.`);
        await healedDb.close();
        throw new Error('DB_INTEGRITY_FAILURE');
      }

      appendLog('[SUCCESS] Boot self-healing finished. System resumed successfully.');
      console.log('[DB] Silent self-healing database recovery succeeded.');

      return healedDb;
    } catch (err: any) {
      appendLog(`[FATAL] Failed to open healed database: ${err.message}`);
      throw new Error('DB_INTEGRITY_FAILURE');
    }
  }

  /**
   * Close active SQLite database connection.
   * Routine calls without force=true are safe no-ops to protect the shared singleton pool.
   * Explicit maintenance/shutdown calls pass force=true to release file handles.
   */
  public async close(force: boolean = false): Promise<void> {
    if (!force) return;
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (e) {}
      this.connection = null;
      this.currentDbPath = null;
    }
  }

  public async transaction<T>(callback: (db: Database) => Promise<T>): Promise<T> {
    const db = await this.getConnection();
    try {
      await db.run('BEGIN IMMEDIATE TRANSACTION');
      const result = await callback(db);
      await db.run('COMMIT');
      return result;
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }
}

export const dbManager = DatabaseManager.getInstance();