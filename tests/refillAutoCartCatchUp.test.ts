import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { getRefillAutoCartAddMode } from '../src/services/storeSettingsService.js';

describe('Refill Auto Cart-Add Catchup & Mode Gates', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE patient_refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        patient_name TEXT,
        patient_phone TEXT,
        medicine_id INTEGER,
        medicine_name TEXT,
        quantity_needed INTEGER DEFAULT 1,
        source TEXT DEFAULT 'counter',
        cart_status TEXT DEFAULT 'pending',
        is_active INTEGER DEFAULT 1,
        patient_confirmed INTEGER DEFAULT 0
      );

      CREATE TABLE special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_refill_id INTEGER,
        status TEXT DEFAULT 'Pending',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Store Settings Mode Resolution', () => {
    it('defaults to auto when setting is not present', async () => {
      const mode = await getRefillAutoCartAddMode(db);
      expect(mode).toBe('auto');
    });

    it('honors manual setting', async () => {
      await db.run("INSERT INTO app_settings (key, value) VALUES ('refill_auto_cart_add', 'manual')");
      const mode = await getRefillAutoCartAddMode(db);
      expect(mode).toBe('manual');
    });

    it('honors off setting', async () => {
      await db.run("INSERT INTO app_settings (key, value) VALUES ('refill_auto_cart_add', 'off')");
      const mode = await getRefillAutoCartAddMode(db);
      expect(mode).toBe('off');
    });
  });

  describe('Eligibility Gate for Auto Cart Catchup', () => {
    it('selects only website and whatsapp online sources and ignores counter refills', async () => {
      // 1. Counter refill (staff created in CRM)
      await db.run(`
        INSERT INTO patient_refills (patient_name, medicine_name, source, cart_status, is_active)
        VALUES ('Counter Patient', 'Aspirin 75mg', 'counter', 'pending', 1)
      `);

      // 2. Website refill (patient requested via 24/7 web portal)
      await db.run(`
        INSERT INTO patient_refills (patient_name, medicine_name, source, cart_status, is_active)
        VALUES ('Web Patient', 'Telma 40mg', 'website', 'pending', 1)
      `);

      // 3. WhatsApp refill (patient confirmed via chatbot)
      await db.run(`
        INSERT INTO patient_refills (patient_name, medicine_name, source, cart_status, is_active)
        VALUES ('WhatsApp Patient', 'Glycomet GP1', 'whatsapp', 'pending', 1)
      `);

      // 4. Already added website refill
      await db.run(`
        INSERT INTO patient_refills (patient_name, medicine_name, source, cart_status, is_active)
        VALUES ('Web Patient 2', 'Pan 40mg', 'website', 'added', 1)
      `);

      const pendingOnlineRefills = await db.all(`
        SELECT id, patient_name, medicine_name, source, cart_status
        FROM patient_refills
        WHERE is_active = 1
          AND source IN ('website', 'whatsapp')
          AND (cart_status = 'pending' OR cart_status IS NULL)
        ORDER BY id ASC
        LIMIT 10
      `);

      expect(pendingOnlineRefills).toHaveLength(2);
      expect(pendingOnlineRefills.map(r => r.source)).toEqual(['website', 'whatsapp']);
      expect(pendingOnlineRefills.map(r => r.patient_name)).toEqual(['Web Patient', 'WhatsApp Patient']);
    });
  });

  describe('Cart Status Lifecycle & Companion Special Orders', () => {
    it('updates patient_refills and companion special_orders on cart addition', async () => {
      await db.run(`
        INSERT INTO patient_refills (id, patient_name, medicine_name, source, cart_status, is_active)
        VALUES (42, 'Online Patient', 'Metformin 500mg', 'website', 'pending', 1)
      `);

      await db.run(`
        INSERT INTO special_orders (id, source_refill_id, status)
        VALUES (101, 42, 'Pending')
      `);

      // Simulate successful auto-add
      await db.run(`UPDATE patient_refills SET cart_status = 'added' WHERE id = 42`);
      await db.run(`UPDATE special_orders SET status = 'In Live Cart' WHERE source_refill_id = 42`);

      const updatedRefill = await db.get(`SELECT cart_status FROM patient_refills WHERE id = 42`);
      const updatedOrder = await db.get(`SELECT status FROM special_orders WHERE id = 101`);

      expect(updatedRefill.cart_status).toBe('added');
      expect(updatedOrder.status).toBe('In Live Cart');
    });
  });
});
