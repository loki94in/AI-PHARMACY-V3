import fs from 'fs';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { dbManager } from '../database/connection.js';
import { config } from '../config/index.js';

export interface DistributorContactRecord {
  id: number;
  name: string;
  phone: string | null;
  contact: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  gstin: string | null;
  state_code: string | null;
  dl_no: string | null;
}

export interface MappingContactRecord {
  store_name: string;
  distributor_id: number | null;
  phone: string | null;
}

export interface DistributorAuditSnapshot {
  distributors: Map<number, DistributorContactRecord>;
  mappings: Map<string, MappingContactRecord>;
  timestamp: number;
  fromVersion: number;
}

/**
 * Ensures the pre-migration backup directory exists.
 */
export function getPreMigrationBackupDir(): string {
  const baseDir = config.backupDir || path.join(process.cwd(), 'backup');
  const preMigrationDir = path.join(baseDir, 'pre_migration');
  if (!fs.existsSync(preMigrationDir)) {
    fs.mkdirSync(preMigrationDir, { recursive: true });
  }
  return preMigrationDir;
}

/**
 * Prunes older pre-migration backups, retaining the most recent keepCount copies.
 */
export function pruneOldPreMigrationBackups(keepCount: number = 5): void {
  try {
    const dir = getPreMigrationBackupDir();
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('pre_migration_') && f.endsWith('.db'))
      .map(f => {
        const fullPath = path.join(dir, f);
        const stats = fs.statSync(fullPath);
        return { name: f, path: fullPath, mtimeMs: stats.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (files.length > keepCount) {
      for (const oldFile of files.slice(keepCount)) {
        try {
          fs.unlinkSync(oldFile.path);
        } catch (_) {}
      }
    }
  } catch (err: any) {
    console.warn('[Migration Safety] Backup prune warning:', err?.message || err);
  }
}

/**
 * Creates an atomic pre-migration backup snapshot before any migration DDL/script runs.
 */
export async function createPreMigrationSnapshot(
  db: any,
  dbPath: string,
  fromVersion: number,
  toVersion: number
): Promise<string | null> {
  if (!fs.existsSync(dbPath)) return null;

  const dir = getPreMigrationBackupDir();
  const timestamp = Date.now();
  const snapshotFilename = `pre_migration_v${fromVersion}_to_v${toVersion}_${timestamp}.db`;
  const snapshotPath = path.join(dir, snapshotFilename);

  // Checkpoint WAL first to ensure all uncommitted pages are flushed to disk
  try {
    await db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (_) {}

  // Attempt atomic SQLite VACUUM INTO for consistent online snapshot
  let snapshotSuccess = false;
  try {
    // Normalise path with forward slashes for SQLite string literal
    const safeSqlitePath = snapshotPath.replace(/\\/g, '/');
    await db.run(`VACUUM INTO '${safeSqlitePath}'`);
    if (fs.existsSync(snapshotPath) && fs.statSync(snapshotPath).size > 0) {
      snapshotSuccess = true;
    }
  } catch (vacuumErr: any) {
    console.warn('[Migration Safety] VACUUM INTO snapshot warning, using fallback copy:', vacuumErr?.message || vacuumErr);
  }

  // Fallback: Copy database file directly after checkpoint
  if (!snapshotSuccess) {
    try {
      fs.copyFileSync(dbPath, snapshotPath);
      snapshotSuccess = true;
    } catch (copyErr: any) {
      console.error('[Migration Safety] Failed to copy pre-migration database snapshot:', copyErr?.message || copyErr);
      return null;
    }
  }

  // Enforce retention policy
  pruneOldPreMigrationBackups(5);

  return snapshotPath;
}

/**
 * Captures an audit snapshot of all distributor contact data prior to migration.
 */
export async function captureDistributorAudit(
  db: any,
  fromVersion: number = 0
): Promise<DistributorAuditSnapshot> {
  const distMap = new Map<number, DistributorContactRecord>();
  const mappingMap = new Map<string, MappingContactRecord>();

  // 1. Audit distributors table
  try {
    const tableExists = await db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='distributors'");
    if (tableExists) {
      const rows = await db.all('SELECT * FROM distributors');
      if (Array.isArray(rows)) {
        for (const r of rows) {
          distMap.set(r.id, {
            id: r.id,
            name: r.name || '',
            phone: r.phone !== undefined && r.phone !== null ? String(r.phone) : null,
            contact: r.contact !== undefined && r.contact !== null ? String(r.contact) : null,
            email: r.email !== undefined && r.email !== null ? String(r.email) : null,
            address: r.address !== undefined && r.address !== null ? String(r.address) : null,
            city: r.city !== undefined && r.city !== null ? String(r.city) : null,
            gstin: r.gstin !== undefined && r.gstin !== null ? String(r.gstin) : null,
            state_code: r.state_code !== undefined && r.state_code !== null ? String(r.state_code) : null,
            dl_no: r.dl_no !== undefined && r.dl_no !== null ? String(r.dl_no) : null,
          });
        }
      }
    }
  } catch (err: any) {
    console.warn('[Migration Safety] Could not audit distributors table:', err?.message || err);
  }

  // 2. Audit pharmarack_distributor_mappings table
  try {
    const mapTableExists = await db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pharmarack_distributor_mappings'");
    if (mapTableExists) {
      const mapRows = await db.all('SELECT store_name, distributor_id, phone FROM pharmarack_distributor_mappings');
      if (Array.isArray(mapRows)) {
        for (const m of mapRows) {
          if (m.store_name) {
            mappingMap.set(m.store_name, {
              store_name: m.store_name,
              distributor_id: m.distributor_id || null,
              phone: m.phone !== undefined && m.phone !== null ? String(m.phone) : null,
            });
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[Migration Safety] Could not audit mappings table:', err?.message || err);
  }

  return {
    distributors: distMap,
    mappings: mappingMap,
    timestamp: Date.now(),
    fromVersion,
  };
}

/**
 * Validates post-migration distributor records against the pre-migration snapshot.
 * Verifies that zero records or contact fields were unintentionally deleted, reset, or overwritten.
 */
export async function validateDistributorContacts(
  preAudit: DistributorAuditSnapshot,
  postDb: any
): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];

  if (preAudit.distributors.size === 0) {
    return { isValid: true, errors: [] };
  }

  let postRows: any[] = [];
  try {
    postRows = await postDb.all('SELECT * FROM distributors');
  } catch (err: any) {
    return { isValid: false, errors: [`Failed to query distributors table after migration: ${err?.message}`] };
  }

  const postDistMap = new Map<number, any>();
  for (const r of postRows) {
    postDistMap.set(r.id, r);
  }

  // 1. Check total count did not drop
  if (postRows.length < preAudit.distributors.size) {
    errors.push(
      `Distributor count dropped from ${preAudit.distributors.size} to ${postRows.length}. Some distributor records were deleted during migration.`
    );
  }

  // Helper to extract numeric phone digits for comparison
  const digitsOnly = (val: string | null | undefined): string => {
    if (!val) return '';
    return String(val).replace(/\D/g, '');
  };

  // 2. Verify each pre-existing distributor
  for (const [id, pre] of preAudit.distributors.entries()) {
    const post = postDistMap.get(id);
    if (!post) {
      errors.push(`Distributor ID ${id} ("${pre.name}") is missing after migration.`);
      continue;
    }

    // Name must be preserved
    if (pre.name && (!post.name || String(post.name).trim() === '')) {
      errors.push(`Distributor ID ${id} name was cleared or lost (was: "${pre.name}").`);
    }

    // Phone preservation
    if (pre.phone && String(pre.phone).trim() !== '') {
      if (!post.phone || String(post.phone).trim() === '') {
        errors.push(`Distributor ID ${id} ("${pre.name}") phone was cleared or lost (was: "${pre.phone}").`);
      } else {
        const preDigits = digitsOnly(pre.phone);
        const postDigits = digitsOnly(post.phone);
        // If pre-migration phone had digits, post phone must retain those digits or 10-digit clean version
        if (preDigits && !postDigits.includes(preDigits) && !preDigits.includes(postDigits)) {
          errors.push(
            `Distributor ID ${id} ("${pre.name}") phone was unexpectedly modified (was: "${pre.phone}", now: "${post.phone}").`
          );
        }
      }
    }

    // Contact field preservation: Must never be cleared or overwritten
    if (pre.contact && String(pre.contact).trim() !== '') {
      if (!post.contact || String(post.contact).trim() === '') {
        errors.push(`Distributor ID ${id} ("${pre.name}") contact was cleared or lost (was: "${pre.contact}").`);
      } else {
        const preIsAlphabetic = /[a-zA-Z]/.test(pre.contact);
        const postIsAlphabetic = /[a-zA-Z]/.test(post.contact);
        // If contact stored a person's name (e.g. "Ramesh Gupta"), it must NOT have been replaced by phone digits
        if (preIsAlphabetic && !postIsAlphabetic) {
          errors.push(
            `Distributor ID ${id} ("${pre.name}") contact person name was overwritten by phone number (was: "${pre.contact}", now: "${post.contact}").`
          );
        }
      }
    }

    // Email preservation
    if (pre.email && String(pre.email).trim() !== '') {
      if (!post.email || String(post.email).trim() === '') {
        errors.push(`Distributor ID ${id} ("${pre.name}") email was cleared or lost (was: "${pre.email}").`);
      }
    }

    // Address & GSTIN preservation
    if (pre.address && String(pre.address).trim() !== '' && (!post.address || String(post.address).trim() === '')) {
      errors.push(`Distributor ID ${id} ("${pre.name}") address was cleared or lost.`);
    }
    if (pre.gstin && String(pre.gstin).trim() !== '' && (!post.gstin || String(post.gstin).trim() === '')) {
      errors.push(`Distributor ID ${id} ("${pre.name}") GSTIN was cleared or lost.`);
    }
  }

  // 3. Verify pharmarack_distributor_mappings phone numbers
  if (preAudit.mappings.size > 0) {
    try {
      const postMapRows = await postDb.all('SELECT store_name, phone FROM pharmarack_distributor_mappings');
      const postMappingMap = new Map<string, string>();
      for (const m of postMapRows) {
        if (m.store_name) postMappingMap.set(m.store_name, m.phone || '');
      }

      for (const [storeName, preMap] of preAudit.mappings.entries()) {
        if (preMap.phone && String(preMap.phone).trim() !== '') {
          const postPhone = postMappingMap.get(storeName);
          if (postPhone === undefined || postPhone === null || String(postPhone).trim() === '') {
            errors.push(
              `Pharmarack distributor mapping for "${storeName}" had its phone cleared to NULL or empty string (was: "${preMap.phone}").`
            );
          }
        }
      }
    } catch (_) {}
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Restores the database file from a pre-migration snapshot in the event of migration failure.
 * Ensures the previous application version can continue running on a consistent, compatible database.
 */
export async function restorePreMigrationSnapshot(
  dbPath: string,
  snapshotPath: string
): Promise<void> {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Cannot restore snapshot: snapshot file not found at ${snapshotPath}`);
  }

  // 1. Suspend database manager and close any active connection pool
  dbManager.suspend();
  try {
    await dbManager.close(true);
  } catch (closeErr: any) {
    console.warn('[Migration Safety] Error closing connection pool during snapshot rollback:', closeErr?.message);
  }

  // 2. Allow Windows OS kernel / libuv file handles to settle
  await new Promise(resolve => setTimeout(resolve, 300));

  // 3. Copy snapshot back to dbPath
  try {
    fs.copyFileSync(snapshotPath, dbPath);
    console.log(`[Migration Safety] Restored database from snapshot: ${snapshotPath} -> ${dbPath}`);
  } catch (copyErr: any) {
    console.error(`[Migration Safety] Failed to restore database snapshot from ${snapshotPath}:`, copyErr);
    throw copyErr;
  } finally {
    // 4. Clean any leftover WAL/SHM files
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = path.join(dir, base + suffix);
      if (fs.existsSync(sidecar)) {
        try { fs.unlinkSync(sidecar); } catch (_) {}
      }
    }
    // 5. Resume database manager
    dbManager.resume();
  }
}

/**
 * Helper to check whether a process ID is currently alive.
 */
function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

export interface MigrationLockHandle {
  lockPath: string;
  release: () => void;
}

/**
 * Step G: Acquires an exclusive file lock for the database migration pipeline.
 * Guards against concurrent processes or multiple app windows modifying the database at once.
 */
export function acquireMigrationLock(dbPath: string): MigrationLockHandle {
  const lockPath = `${dbPath}.migration.lock`;
  const maxStaleMs = 15 * 60 * 1000; // 15 minutes timeout

  if (fs.existsSync(lockPath)) {
    try {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const lockData = JSON.parse(raw);
      const isAlive = lockData.pid ? isProcessAlive(lockData.pid) : false;
      const isStale = (Date.now() - (lockData.acquiredAt || 0)) > maxStaleMs;

      if (!isAlive || isStale) {
        console.warn(`[Migration Safety] Overriding stale migration lock (PID: ${lockData.pid}, stale: ${isStale}, alive: ${isAlive})`);
        try { fs.unlinkSync(lockPath); } catch (_) {}
      } else {
        throw new Error(
          `[Migration Safety] Another process (PID ${lockData.pid}) is currently applying migrations to ${dbPath}. ` +
          `Locked since ${new Date(lockData.acquiredAt).toISOString()}. Aborting concurrent update.`
        );
      }
    } catch (parseErr: any) {
      if (parseErr.message && parseErr.message.includes('[Migration Safety] Another process')) {
        throw parseErr;
      }
      try { fs.unlinkSync(lockPath); } catch (_) {}
    }
  }

  const payload = {
    pid: process.pid,
    acquiredAt: Date.now(),
    dbPath,
  };
  fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), 'utf8');

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } catch (_) {}
  };

  return { lockPath, release };
}

/**
 * Step H: Verifies database integrity and ensures sufficient disk space headroom before migration.
 */
export async function verifyPreMigrationIntegrityAndDiskSpace(
  db: any,
  dbPath: string
): Promise<{ ok: boolean; error?: string }> {
  // 1. Verify database integrity
  try {
    const quickCheck = await db.get('PRAGMA quick_check(1)');
    const checkResult = quickCheck ? Object.values(quickCheck)[0] : 'unknown';
    if (checkResult !== 'ok') {
      return { ok: false, error: `Pre-migration database integrity check failed: ${checkResult}` };
    }
  } catch (checkErr: any) {
    return { ok: false, error: `Could not run database integrity check: ${checkErr?.message || checkErr}` };
  }

  // 2. Verify disk space headroom
  try {
    let dbSizeBytes = 0;
    if (fs.existsSync(dbPath)) {
      dbSizeBytes += fs.statSync(dbPath).size;
    }
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = dbPath + suffix;
      if (fs.existsSync(sidecar)) {
        dbSizeBytes += fs.statSync(sidecar).size;
      }
    }

    // Require at least 3x database size or 50MB
    const requiredBytes = Math.max(dbSizeBytes * 3, 50 * 1024 * 1024);
    const dbDir = path.dirname(dbPath);

    if (typeof fs.statfsSync === 'function') {
      const stat = fs.statfsSync(dbDir);
      const availableBytes = BigInt(stat.bavail) * BigInt(stat.bsize);
      if (availableBytes < BigInt(requiredBytes)) {
        const freeMB = (Number(availableBytes) / (1024 * 1024)).toFixed(1);
        const reqMB = (requiredBytes / (1024 * 1024)).toFixed(1);
        return {
          ok: false,
          error: `Insufficient disk space for safe pre-migration backup. Required: ${reqMB} MB, Available: ${freeMB} MB`,
        };
      }
    }
  } catch (fsErr: any) {
    console.warn('[Migration Safety] Disk headroom check note:', fsErr?.message || fsErr);
  }

  return { ok: true };
}

/**
 * Step J: Verifies that the created pre-migration backup snapshot is valid, consistent, and readable.
 */
export async function verifyBackupReadability(
  snapshotPath: string
): Promise<{ ok: boolean; error?: string }> {
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    return { ok: false, error: `Snapshot file not found: ${snapshotPath}` };
  }
  const stat = fs.statSync(snapshotPath);
  if (stat.size === 0) {
    return { ok: false, error: `Snapshot file is empty (0 bytes): ${snapshotPath}` };
  }

  let testDb: any = null;
  try {
    testDb = await open({
      filename: snapshotPath,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY,
    });
    const check = await testDb.get('PRAGMA quick_check(1)');
    const checkVal = check ? Object.values(check)[0] : 'unknown';
    if (checkVal !== 'ok') {
      return { ok: false, error: `Snapshot PRAGMA quick_check failed: ${checkVal}` };
    }
    const tableExists = await testDb.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='distributors'");
    if (tableExists) {
      await testDb.get('SELECT COUNT(*) FROM distributors');
    }
    return { ok: true };
  } catch (err: any) {
    if (err?.message?.includes('SQLITE_READONLY') || err?.code === 'SQLITE_READONLY') {
      try {
        if (testDb) { await testDb.close(); testDb = null; }
        testDb = await open({
          filename: snapshotPath,
          driver: sqlite3.Database,
        });
        const check = await testDb.get('PRAGMA quick_check(1)');
        const checkVal = check ? Object.values(check)[0] : 'unknown';
        if (checkVal === 'ok') {
          return { ok: true };
        }
      } catch (_) {}
    }
    return { ok: false, error: `Snapshot verification failed: ${err?.message || err}` };
  } finally {
    if (testDb) {
      try { await testDb.close(); } catch (_) {}
    }
  }
}

/**
 * Step T & U: Verifies database integrity and critical tables post-migration.
 */
export async function runPostMigrationIntegrityCheck(
  db: any
): Promise<{ ok: boolean; error?: string }> {
  try {
    const check = await db.get('PRAGMA quick_check(1)');
    const checkVal = check ? Object.values(check)[0] : 'unknown';
    if (checkVal !== 'ok') {
      return { ok: false, error: `Post-migration database quick_check failed: ${checkVal}` };
    }

    const requiredTables = ['distributors', 'medicines', 'app_settings'];
    for (const table of requiredTables) {
      const row = await db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", [table]);
      if (!row) {
        return { ok: false, error: `Post-migration integrity error: required table "${table}" is missing` };
      }
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Post-migration integrity check exception: ${err?.message || err}` };
  }
}

/**
 * Step AA: Verifies that the restored database is healthy and all distributor contacts match the pre-migration audit.
 */
export async function verifyRestoredDatabaseAndContacts(
  dbPath: string,
  preAudit: DistributorAuditSnapshot | null
): Promise<{ ok: boolean; error?: string }> {
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: `Restored database file not found at ${dbPath}` };
  }

  let restoredDb: any = null;
  try {
    restoredDb = await open({
      filename: dbPath,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY,
    });
    const check = await restoredDb.get('PRAGMA quick_check(1)');
    const checkVal = check ? Object.values(check)[0] : 'unknown';
    if (checkVal !== 'ok') {
      return { ok: false, error: `Restored database quick_check failed: ${checkVal}` };
    }

    if (preAudit && preAudit.distributors.size > 0) {
      const validation = await validateDistributorContacts(preAudit, restoredDb);
      if (!validation.isValid) {
        return {
          ok: false,
          error: `Restored database distributor contact mismatch: ${validation.errors.join('; ')}`,
        };
      }
    }
    return { ok: true };
  } catch (err: any) {
    if (err?.message?.includes('SQLITE_READONLY') || err?.code === 'SQLITE_READONLY') {
      try {
        if (restoredDb) { await restoredDb.close(); restoredDb = null; }
        restoredDb = await open({
          filename: dbPath,
          driver: sqlite3.Database,
        });
        const check = await restoredDb.get('PRAGMA quick_check(1)');
        const checkVal = check ? Object.values(check)[0] : 'unknown';
        if (checkVal === 'ok') {
          return { ok: true };
        }
      } catch (_) {}
    }
    return { ok: false, error: `Verification of restored database failed: ${err?.message || err}` };
  } finally {
    if (restoredDb) {
      try { await restoredDb.close(); } catch (_) {}
    }
  }
}
