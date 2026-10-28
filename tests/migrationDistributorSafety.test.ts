import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import {
  createPreMigrationSnapshot,
  captureDistributorAudit,
  validateDistributorContacts,
  restorePreMigrationSnapshot,
  acquireMigrationLock,
  verifyPreMigrationIntegrityAndDiskSpace,
  verifyBackupReadability,
  runPostMigrationIntegrityCheck,
  verifyRestoredDatabaseAndContacts,
} from '../src/utils/migrationSafety.js';

describe('Distributor Contact Migration Safety & Data Preservation', () => {
  const testDbDir = path.join(process.cwd(), 'temp_test_db');

  beforeAll(() => {
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(testDbDir)) {
        fs.rmSync(testDbDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('Preserves diverse real-world distributor contacts without data loss or overwrites', async () => {
    const dbPath = path.join(testDbDir, 'test_safety_1.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    // 1. Setup initial pre-migration schema (legacy table without newer columns)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        contact TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        city TEXT,
        gstin TEXT,
        state_code TEXT
      );
      CREATE TABLE IF NOT EXISTS pharmarack_distributor_mappings (
        store_name TEXT PRIMARY KEY,
        distributor_id INTEGER,
        phone TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Insert real-world edge cases:
    await db.run(
      `INSERT INTO distributors (id, name, contact, phone, email, address, city, gstin, state_code)
       VALUES (1, 'Apollo Pharmaceuticals', 'Mr. Ramesh Gupta (Manager)', '9876543210', 'orders@apollo.com', '123 Market Yard', 'Pune', '27AABCA1234B1Z5', '27')`
    );
    await db.run(
      `INSERT INTO distributors (id, name, contact, phone, email, address, city, gstin, state_code)
       VALUES (2, 'MedPlus Agencies', '020-24451234', '9822012345', 'medplus@agency.in', '45 Station Road', 'Mumbai', '27XYZPA9876C2Z1', '27')`
    );
    await db.run(
      `INSERT INTO distributors (id, name, contact, phone, email, address, city, gstin, state_code)
       VALUES (3, 'Cipla Depot Distribution', NULL, '09822011111', 'depot@cipla.com', 'MIDC Hinjawadi', 'Pune', NULL, '27')`
    );
    await db.run(
      `INSERT INTO distributors (id, name, contact, phone, email, address, city, gstin, state_code)
       VALUES (4, 'Sun Pharma Direct', 'Sharma Ji', '9890012345', 'sun@pharma.com', 'Sector 12', 'Nagpur', '27SUNPH1111A1Z9', '27')`
    );

    await db.run(
      `INSERT INTO pharmarack_distributor_mappings (store_name, distributor_id, phone)
       VALUES ('Apollo Pharmaceuticals', 1, '9876543210')`
    );
    await db.run(
      `INSERT INTO pharmarack_distributor_mappings (store_name, distributor_id, phone)
       VALUES ('MedPlus Agencies', 2, '020-24451234')`
    );

    // 3. Create pre-migration backup and audit snapshot
    const snapshotPath = await createPreMigrationSnapshot(db, dbPath, 83, 84);
    expect(snapshotPath).toBeTruthy();
    expect(fs.existsSync(snapshotPath!)).toBe(true);

    const preAudit = await captureDistributorAudit(db, 83);
    expect(preAudit.distributors.size).toBe(4);
    expect(preAudit.mappings.size).toBe(2);

    // 4. Simulate safe migration updates:
    // A: Add new columns with defaults
    await db.run('ALTER TABLE distributors ADD COLUMN delivery_boy_id INTEGER DEFAULT NULL');
    await db.run('ALTER TABLE distributors ADD COLUMN min_order_value REAL DEFAULT NULL');
    await db.run('ALTER TABLE distributors ADD COLUMN min_order_items INTEGER DEFAULT NULL');

    // B: Execute safe sync statements
    await db.run(`
      UPDATE distributors SET
        email = CASE
          WHEN (email IS NULL OR email = '') AND (contact LIKE '%@%' OR contact LIKE '%.com%') THEN contact
          WHEN (email IS NULL OR email = '') AND (phone LIKE '%@%' OR phone LIKE '%.com%') THEN phone
          ELSE email
        END
      WHERE (email IS NULL OR email = '')
        AND (contact LIKE '%@%' OR contact LIKE '%.com%' OR phone LIKE '%@%' OR phone LIKE '%.com%')
    `);

    // Synchronize missing phone only if contact contains numeric digits
    await db.run("UPDATE distributors SET phone = contact WHERE (phone IS NULL OR phone = '') AND contact IS NOT NULL AND contact != '' AND (contact GLOB '[0-9]*' OR contact LIKE '+%')");
    // Synchronize contact only if contact is NULL or empty
    await db.run("UPDATE distributors SET contact = phone WHERE (contact IS NULL OR contact = '') AND phone IS NOT NULL AND phone != ''");

    // 5. Run validation gate
    const validation = await validateDistributorContacts(preAudit, db);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);

    // 6. Verify exact preserved fields in database
    const dist1 = await db.get('SELECT * FROM distributors WHERE id = 1');
    expect(dist1.name).toBe('Apollo Pharmaceuticals');
    expect(dist1.contact).toBe('Mr. Ramesh Gupta (Manager)'); // Contact person name preserved! NOT overwritten by phone!
    expect(dist1.phone).toBe('9876543210');
    expect(dist1.email).toBe('orders@apollo.com');
    expect(dist1.address).toBe('123 Market Yard');
    expect(dist1.gstin).toBe('27AABCA1234B1Z5');

    const dist2 = await db.get('SELECT * FROM distributors WHERE id = 2');
    expect(dist2.contact).toBe('020-24451234'); // Landline preserved!
    expect(dist2.phone).toBe('9822012345');

    const dist3 = await db.get('SELECT * FROM distributors WHERE id = 3');
    expect(dist3.contact).toBe('09822011111'); // Backfilled safely since contact was NULL
    expect(dist3.phone).toBe('09822011111');

    await db.close();

    if (snapshotPath && fs.existsSync(snapshotPath)) {
      try { fs.unlinkSync(snapshotPath); } catch (_) {}
    }
  });

  test('Validation detects and reports data loss if contact person is overwritten by phone', async () => {
    const dbPath = path.join(testDbDir, 'test_safety_2.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        contact TEXT,
        phone TEXT,
        email TEXT,
        address TEXT
      );
    `);

    await db.run(
      `INSERT INTO distributors (id, name, contact, phone, email)
       VALUES (10, 'Universal Pharma', 'Mr. Verma', '9123456780', 'verma@universal.com')`
    );

    const preAudit = await captureDistributorAudit(db, 83);

    // Simulate legacy destructive bug: contact overwritten with phone
    await db.run("UPDATE distributors SET contact = phone WHERE id = 10");

    const validation = await validateDistributorContacts(preAudit, db);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.some(e => e.includes('contact person name was overwritten by phone number'))).toBe(true);

    await db.close();
  });

  test('Rollback cleanly restores original database state from pre-migration snapshot', async () => {
    const dbPath = path.join(testDbDir, 'test_safety_3.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact TEXT,
        phone TEXT
      );
    `);

    await db.run("INSERT INTO distributors (id, name, contact, phone) VALUES (1, 'Test Dist', 'Kiran Patel', '9988776655')");
    await db.close();

    // Create snapshot
    const snapshotPath = path.join(testDbDir, 'test_snapshot_before_fail.db');
    fs.copyFileSync(dbPath, snapshotPath);

    // Simulate accidental corruption or bad migration
    const corruptDb = await open({ filename: dbPath, driver: sqlite3.Database });
    await corruptDb.run("DELETE FROM distributors");
    await corruptDb.close();

    // Verify corrupted
    const checkDb = await open({ filename: dbPath, driver: sqlite3.Database });
    const emptyCount = await checkDb.get("SELECT COUNT(*) as c FROM distributors");
    expect(emptyCount.c).toBe(0);
    await checkDb.close();

    // Execute rollback from snapshot
    await restorePreMigrationSnapshot(dbPath, snapshotPath);

    // Verify restored
    const restoredDb = await open({ filename: dbPath, driver: sqlite3.Database });
    const row = await restoredDb.get("SELECT * FROM distributors WHERE id = 1");
    expect(row).toBeTruthy();
    expect(row.name).toBe('Test Dist');
    expect(row.contact).toBe('Kiran Patel');
    expect(row.phone).toBe('9988776655');
    await restoredDb.close();

    if (fs.existsSync(snapshotPath)) {
      try { fs.unlinkSync(snapshotPath); } catch (_) {}
    }
  });

  test('Re-running an already-applied migration is idempotent and causes zero data loss', async () => {
    const dbPath = path.join(testDbDir, 'test_safety_4.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        contact TEXT,
        phone TEXT,
        email TEXT,
        address TEXT
      );
    `);

    await db.run(
      `INSERT INTO distributors (id, name, contact, phone, email, address)
       VALUES (1, 'Alpha Distributors', 'Suresh Kumar', '9811122233', 'suresh@alpha.com', '78 Ring Road')`
    );

    const preAudit = await captureDistributorAudit(db, 84);

    // Run migration operations pass 1
    await db.run("UPDATE distributors SET phone = contact WHERE (phone IS NULL OR phone = '') AND contact IS NOT NULL AND contact != '' AND (contact GLOB '[0-9]*' OR contact LIKE '+%')");
    await db.run("UPDATE distributors SET contact = phone WHERE (contact IS NULL OR contact = '') AND phone IS NOT NULL AND phone != ''");

    // Run migration operations pass 2 (re-run)
    await db.run("UPDATE distributors SET phone = contact WHERE (phone IS NULL OR phone = '') AND contact IS NOT NULL AND contact != '' AND (contact GLOB '[0-9]*' OR contact LIKE '+%')");
    await db.run("UPDATE distributors SET contact = phone WHERE (contact IS NULL OR contact = '') AND phone IS NOT NULL AND phone != ''");

    // Validate
    const validation = await validateDistributorContacts(preAudit, db);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);

    const row = await db.get("SELECT * FROM distributors WHERE id = 1");
    expect(row.name).toBe('Alpha Distributors');
    expect(row.contact).toBe('Suresh Kumar');
    expect(row.phone).toBe('9811122233');
    expect(row.email).toBe('suresh@alpha.com');
    expect(row.address).toBe('78 Ring Road');

    await db.close();
  });

  test('Acquires migration lock, blocks concurrent migrations, and releases cleanly', async () => {
    const dbPath = path.join(testDbDir, 'test_safety_lock.db');
    const lock1 = acquireMigrationLock(dbPath);
    expect(lock1).toBeTruthy();
    expect(fs.existsSync(lock1.lockPath)).toBe(true);

    // Attempting second lock while first is held must throw
    expect(() => {
      acquireMigrationLock(dbPath);
    }).toThrow(/Another process/);

    // Release first lock
    lock1.release();
    expect(fs.existsSync(lock1.lockPath)).toBe(false);

    // Now acquiring lock again must succeed
    const lock2 = acquireMigrationLock(dbPath);
    expect(fs.existsSync(lock2.lockPath)).toBe(true);
    lock2.release();
    expect(fs.existsSync(lock2.lockPath)).toBe(false);
  });

  test('Pre-flight integrity and disk headroom check passes on healthy database', async () => {
    const dbPath = path.join(testDbDir, 'test_safety_preflight.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.exec('CREATE TABLE test (id INT)');
    const result = await verifyPreMigrationIntegrityAndDiskSpace(db, dbPath);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    await db.close();
  });

  test('Backup readability check validates valid backups and rejects corrupt or empty files', async () => {
    const validDbPath = path.join(testDbDir, 'test_backup_valid.db');
    if (fs.existsSync(validDbPath)) fs.unlinkSync(validDbPath);

    const db = await open({ filename: validDbPath, driver: sqlite3.Database });
    await db.exec('CREATE TABLE distributors (id INT, name TEXT)');
    await db.run("INSERT INTO distributors VALUES (1, 'Valid Dist')");
    await db.close();

    const validCheck = await verifyBackupReadability(validDbPath);
    expect(validCheck.ok).toBe(true);

    // Empty file test
    const emptyDbPath = path.join(testDbDir, 'test_backup_empty.db');
    fs.writeFileSync(emptyDbPath, '');
    const emptyCheck = await verifyBackupReadability(emptyDbPath);
    expect(emptyCheck.ok).toBe(false);
    expect(emptyCheck.error).toMatch(/empty/i);

    // Corrupted file test
    const corruptDbPath = path.join(testDbDir, 'test_backup_corrupt.db');
    fs.writeFileSync(corruptDbPath, 'NOT A SQLITE DATABASE HEADER GIBBERISH');
    const corruptCheck = await verifyBackupReadability(corruptDbPath);
    expect(corruptCheck.ok).toBe(false);

    try { fs.unlinkSync(emptyDbPath); } catch (_) {}
    try { fs.unlinkSync(corruptDbPath); } catch (_) {}
  });

  test('Post-migration integrity checks pass on complete schema and detect missing required tables', async () => {
    const dbPath = path.join(testDbDir, 'test_post_integrity.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    // Incomplete schema: missing app_settings and medicines
    await db.exec('CREATE TABLE distributors (id INT, name TEXT)');

    const failedCheck = await runPostMigrationIntegrityCheck(db);
    expect(failedCheck.ok).toBe(false);
    expect(failedCheck.error).toMatch(/medicines.*missing/i);

    // Now add the remaining tables
    await db.exec('CREATE TABLE medicines (id INT, name TEXT); CREATE TABLE app_settings (key TEXT, value TEXT);');
    const passedCheck = await runPostMigrationIntegrityCheck(db);
    expect(passedCheck.ok).toBe(true);

    await db.close();
  });

  test('Post-restore verification validates that restored database matches pre-migration audit', async () => {
    const dbPath = path.join(testDbDir, 'test_restore_verify.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.exec('CREATE TABLE distributors (id INT PRIMARY KEY, name TEXT, phone TEXT, contact TEXT, email TEXT, address TEXT, city TEXT, gstin TEXT, state_code TEXT, dl_no TEXT)');
    await db.run("INSERT INTO distributors (id, name, phone, contact) VALUES (1, 'Restore Dist', '9898989898', 'Owner')");

    const preAudit = await captureDistributorAudit(db, 84);
    await db.close();

    // Verify healthy restored database matches audit
    const verifyResult = await verifyRestoredDatabaseAndContacts(dbPath, preAudit);
    expect(verifyResult.ok).toBe(true);

    // Modify file to cause mismatch
    const modifyDb = await open({ filename: dbPath, driver: sqlite3.Database });
    await modifyDb.run("UPDATE distributors SET contact = '9898989898' WHERE id = 1"); // Overwrote name with phone
    await modifyDb.close();

    const mismatchResult = await verifyRestoredDatabaseAndContacts(dbPath, preAudit);
    expect(mismatchResult.ok).toBe(false);
    expect(mismatchResult.error).toMatch(/contact person name was overwritten/i);
  });
});
