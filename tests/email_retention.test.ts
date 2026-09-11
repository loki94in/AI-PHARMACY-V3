import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import { emailService } from '../src/services/emailService.js';
import { getEmailRetentionLimit, getEmailRetentionDays } from '../src/services/storeSettingsService.js';

describe('Email Retention & Automatic Pruning', () => {
  let tmpDir: string;
  let dbPath: string;
  let uploadsDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-retention-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    process.env.UPLOADS_DIR = uploadsDir;
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('default retention limit is 15', async () => {
    const db = await dbManager.getConnection();
    const limit = await getEmailRetentionLimit(db);
    expect(limit).toBe(15);
  });

  test('prunes non-saved emails down to retention limit (15) and deletes disk files', async () => {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM email_attachments');
    await db.run('DELETE FROM emails');

    // Insert 20 non-saved emails with mock attachments
    for (let i = 1; i <= 20; i++) {
      await db.run(
        `INSERT INTO emails (uid, subject, from_addr, date, is_saved) VALUES (?, ?, ?, ?, 0)`,
        [i, `Test Email ${i}`, `sender${i}@example.com`, new Date(Date.now() - (20 - i) * 60000).toISOString()]
      );

      const filePath = path.join(uploadsDir, `att-${i}-invoice.csv`);
      fs.writeFileSync(filePath, 'dummy csv content');

      await db.run(
        `INSERT INTO email_attachments (uid, filename, local_path) VALUES (?, ?, ?)`,
        [i, `att-${i}-invoice.csv`, filePath]
      );
    }

    const initialCount = await db.get('SELECT COUNT(*) as cnt FROM emails');
    expect(initialCount.cnt).toBe(20);

    // Run pruning
    const result = await emailService.pruneOldEmails(db);
    expect(result.deletedCount).toBe(5); // 20 - 15 = 5 deleted

    const remainingCount = await db.get('SELECT COUNT(*) as cnt FROM emails');
    expect(remainingCount.cnt).toBe(15);

    // Oldest emails (1..5) should be deleted from DB and files unlinked
    for (let i = 1; i <= 5; i++) {
      const email = await db.get('SELECT uid FROM emails WHERE uid = ?', [i]);
      expect(email).toBeUndefined();

      const filePath = path.join(uploadsDir, `att-${i}-invoice.csv`);
      expect(fs.existsSync(filePath)).toBe(false);
    }

    // Latest emails (6..20) should remain intact
    for (let i = 6; i <= 20; i++) {
      const email = await db.get('SELECT uid FROM emails WHERE uid = ?', [i]);
      expect(email).toBeDefined();
    }
  });

  test('saved emails (is_saved = 1) are exempt from auto-deletion', async () => {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM email_attachments');
    await db.run('DELETE FROM emails');

    // Insert 5 saved emails + 15 non-saved emails (total 20)
    for (let i = 1; i <= 5; i++) {
      await db.run(
        `INSERT INTO emails (uid, subject, from_addr, date, is_saved) VALUES (?, ?, ?, ?, 1)`,
        [i, `Saved Email ${i}`, `sender${i}@example.com`, new Date(Date.now() - (30 - i) * 60000).toISOString()]
      );
    }

    for (let i = 6; i <= 25; i++) {
      await db.run(
        `INSERT INTO emails (uid, subject, from_addr, date, is_saved) VALUES (?, ?, ?, ?, 0)`,
        [i, `Normal Email ${i}`, `sender${i}@example.com`, new Date(Date.now() - (30 - i) * 60000).toISOString()]
      );
    }

    // 5 saved + 20 non-saved = 25 total emails
    const result = await emailService.pruneOldEmails(db);
    expect(result.deletedCount).toBe(5); // 20 non-saved pruned to 15

    const savedRemaining = await db.all('SELECT uid FROM emails WHERE is_saved = 1');
    expect(savedRemaining.length).toBe(5); // All 5 saved emails are preserved!

    const totalRemaining = await db.get('SELECT COUNT(*) as cnt FROM emails');
    expect(totalRemaining.cnt).toBe(20); // 5 saved + 15 non-saved = 20 total
  });

  test('custom retention limit in app_settings (e.g. 5) is respected', async () => {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('email_retention_limit', '5')");

    const limit = await getEmailRetentionLimit(db);
    expect(limit).toBe(5);

    await db.run('DELETE FROM email_attachments');
    await db.run('DELETE FROM emails');

    for (let i = 1; i <= 10; i++) {
      await db.run(
        `INSERT INTO emails (uid, subject, from_addr, date, is_saved) VALUES (?, ?, ?, ?, 0)`,
        [i, `Email ${i}`, `sender${i}@example.com`, new Date(Date.now() - (10 - i) * 60000).toISOString()]
      );
    }

    const result = await emailService.pruneOldEmails(db);
    expect(result.deletedCount).toBe(5);

    const remaining = await db.get('SELECT COUNT(*) as cnt FROM emails');
    expect(remaining.cnt).toBe(5);
  });

  test('default retention days is 14', async () => {
    const db = await dbManager.getConnection();
    const days = await getEmailRetentionDays(db);
    expect(days).toBe(14);
  });

  test('prunes emails older than 14 days even if is_saved = 1 and unlinks disk files', async () => {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM app_settings WHERE key = \'email_retention_days\'');
    await db.run('DELETE FROM email_attachments');
    await db.run('DELETE FROM emails');

    const now = Date.now();
    const sixteenDaysAgo = new Date(now - 16 * 24 * 60 * 60 * 1000).toISOString();
    const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Email older than 14 days (16 days old, is_saved = 1)
    await db.run(
      `INSERT INTO emails (uid, subject, from_addr, date, is_saved) VALUES (?, ?, ?, ?, 1)`,
      [101, 'Old Saved Bill 101', 'distributor@test.com', sixteenDaysAgo]
    );
    const oldFile1 = path.join(uploadsDir, 'att-101.pdf');
    fs.writeFileSync(oldFile1, 'old invoice content');
    await db.run(
      `INSERT INTO email_attachments (uid, filename, local_path) VALUES (?, ?, ?)`,
      [101, 'att-101.pdf', oldFile1]
    );

    // 2. Email older than 14 days (20 days old, is_saved = 0)
    await db.run(
      `INSERT INTO emails (uid, subject, from_addr, date, is_saved) VALUES (?, ?, ?, ?, 0)`,
      [102, 'Old Unsaved Email 102', 'promo@test.com', twentyDaysAgo]
    );
    const oldFile2 = path.join(uploadsDir, 'att-102.pdf');
    fs.writeFileSync(oldFile2, 'old promo content');
    await db.run(
      `INSERT INTO email_attachments (uid, filename, local_path) VALUES (?, ?, ?)`,
      [102, 'att-102.pdf', oldFile2]
    );

    // 3. Recent Saved email (3 days old, is_saved = 1) -> must be KEPT
    await db.run(
      `INSERT INTO emails (uid, subject, from_addr, date, is_saved) VALUES (?, ?, ?, ?, 1)`,
      [103, 'Recent Saved Bill 103', 'distributor@test.com', threeDaysAgo]
    );
    const recentFile1 = path.join(uploadsDir, 'att-103.pdf');
    fs.writeFileSync(recentFile1, 'recent saved content');
    await db.run(
      `INSERT INTO email_attachments (uid, filename, local_path) VALUES (?, ?, ?)`,
      [103, 'att-103.pdf', recentFile1]
    );

    // 4. Recent Unsaved email (1 day old, is_saved = 0) -> must be KEPT
    await db.run(
      `INSERT INTO emails (uid, subject, from_addr, date, is_saved) VALUES (?, ?, ?, ?, 0)`,
      [104, 'Recent Normal Email 104', 'info@test.com', oneDayAgo]
    );

    // Run pruning
    const result = await emailService.pruneOldEmails(db);
    expect(result.deletedCount).toBe(2); // UIDs 101 and 102 deleted!

    // Files on disk for 101 and 102 must be unlinked
    expect(fs.existsSync(oldFile1)).toBe(false);
    expect(fs.existsSync(oldFile2)).toBe(false);

    // Recent file 103 must still exist
    expect(fs.existsSync(recentFile1)).toBe(true);

    // UIDs 101 and 102 removed from DB
    const deleted101 = await db.get('SELECT uid FROM emails WHERE uid = 101');
    const deleted102 = await db.get('SELECT uid FROM emails WHERE uid = 102');
    expect(deleted101).toBeUndefined();
    expect(deleted102).toBeUndefined();

    // UIDs 103 and 104 preserved
    const kept103 = await db.get('SELECT uid FROM emails WHERE uid = 103');
    const kept104 = await db.get('SELECT uid FROM emails WHERE uid = 104');
    expect(kept103).toBeDefined();
    expect(kept104).toBeDefined();
  });
});

