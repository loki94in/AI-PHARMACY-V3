import { AUTOMATION_CATALOG, getAutomationToggleStates } from '../src/services/automationCatalog.js';
import { dbManager } from '../src/database/connection.js';
import { createBackup, enforceRetention, listBackups } from '../src/services/backupService.js';
import fs from 'fs';
import path from 'path';

describe('Complete App Automations Comprehensive Test Suite', () => {
  it('should include all 16 known WhatsApp automation catalog entries', () => {
    expect(AUTOMATION_CATALOG.length).toBe(16);

    const expectedIds = [
      'pos_bill',
      'invoice_pdf',
      'distributor_collection',
      'pharmarack_batch',
      'single_distributor_order',
      'credit_reminder',
      'payment_receipt',
      'doctor_daily_summary',
      'expiry_report',
      'bounced_products_alert',
      'shortage_notice',
      'refill_reminder',
      'dispatch_reminder',
      'monthly_report',
      'admin_escalation',
      'medicine_discovery_suggestion',
    ];

    for (const expectedId of expectedIds) {
      const entry = AUTOMATION_CATALOG.find((e) => e.id === expectedId);
      expect(entry).toBeDefined();
      expect(entry!.label).toBeTruthy();
      expect(entry!.appSettingsKey).toBeTruthy();
    }
  });

  it('should correctly query toggle states for every automation', async () => {
    const states = await getAutomationToggleStates();
    expect(states).toBeDefined();

    for (const entry of AUTOMATION_CATALOG) {
      expect(typeof states[entry.id]).toBe('boolean');
    }
  });

  it('should persist automation toggle state changes in SQLite database', async () => {
    const db = await dbManager.getConnection();
    const testEntry = AUTOMATION_CATALOG[0]; // pos_bill

    // Save disabled
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [testEntry.appSettingsKey, 'false']);
    let states = await getAutomationToggleStates();
    expect(states[testEntry.id]).toBe(false);

    // Save enabled
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [testEntry.appSettingsKey, 'true']);
    states = await getAutomationToggleStates();
    expect(states[testEntry.id]).toBe(true);

    // Clean up key
    await db.run('DELETE FROM app_settings WHERE key = ?', [testEntry.appSettingsKey]);
  });

  it('should support notification creation, lifecycle tracking, and resolution in automation_notifications table', async () => {
    const db = await dbManager.getConnection();
    const testRef = 'TEST_AUTO_' + Date.now();

    // Insert test automation notification
    const result = await db.run(
      `INSERT INTO automation_notifications 
       (type, recipient_name, recipient_phone, message, status, lifecycle_status, reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['refill_reminder', 'Test Patient', '9999988888', 'Your medicine is due for refill', 'queued', 'pending', testRef]
    );

    const notifId = result.lastID;
    expect(notifId).toBeGreaterThan(0);

    // Verify row
    let row = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [notifId]);
    expect(row).toBeDefined();
    expect(row.status).toBe('queued');
    expect(row.lifecycle_status).toBe('pending');

    // Snooze notification
    const snoozeUntil = new Date(Date.now() + 3600000).toISOString();
    await db.run(
      `UPDATE automation_notifications 
       SET lifecycle_status = 'snoozed', snoozed_until = ? WHERE id = ?`,
      [snoozeUntil, notifId]
    );
    row = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [notifId]);
    expect(row.lifecycle_status).toBe('snoozed');

    // Resolve notification
    await db.run(
      `UPDATE automation_notifications 
       SET acknowledged = 1, status = 'sent_manually', resolved_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [notifId]
    );
    row = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [notifId]);
    expect(row.acknowledged).toBe(1);
    expect(row.status).toBe('sent_manually');

    // Cleanup test record
    await db.run('DELETE FROM automation_notifications WHERE id = ?', [notifId]);
  });

  it('should execute backup automation and enforce cascade retention <= 20 files', async () => {
    // Run backup
    const backupRes = await createBackup('Manual');
    expect(backupRes.filename).toBeTruthy();
    expect(backupRes.filename.endsWith('.db.gz')).toBe(true);

    // Enforce retention
    enforceRetention();

    // Verify list of backups
    const backups = listBackups();
    expect(backups.length).toBeLessThanOrEqual(20);

    // Verify companion files (.db-shm, .db-wal) are pruned
    const backupDir = path.dirname(path.resolve('backup', backupRes.filename));
    const allFiles = fs.readdirSync(backupDir);
    const companionFiles = allFiles.filter((f) => f.endsWith('.db-shm') || f.endsWith('.db-wal') || f.endsWith('.db-journal'));
    expect(companionFiles.length).toBe(0);
  });
});
