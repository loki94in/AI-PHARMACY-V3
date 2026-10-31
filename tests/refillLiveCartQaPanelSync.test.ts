import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { checkRefillCycleBooking, isRefillOrdered } from '../frontend/src/utils/refillSettled.js';

describe('Refill Live Cart to QA Panel Synchronization', () => {
  describe('Frontend Cycle Booking & Ordered Status Helpers', () => {
    it('treats a distant refill (> 7 days) without cart line as dormant', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 20);
      const med = {
        next_refill_date: futureDate.toISOString().slice(0, 10),
        last_refill_date: null,
        refill_interval_days: 30,
        status: 'pending',
        cart_store_name: null,
        cart_product_code: null
      };

      expect(isRefillOrdered(med)).toBe(false);
      const cycle = checkRefillCycleBooking(med);
      expect(cycle.alreadyDispensed).toBe(true);
      expect(cycle.canBook).toBe(false);
      expect(cycle.isEarly).toBe(true);
      expect(cycle.daysEarly).toBe(20);
    });

    it('treats a distant refill (> 7 days) with cart_store_name as actionable and bookable', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 20);
      const med = {
        next_refill_date: futureDate.toISOString().slice(0, 10),
        last_refill_date: null,
        refill_interval_days: 30,
        status: 'ordered',
        cart_store_name: 'MAHAVIR PHARMA',
        cart_product_code: 'P12345'
      };

      expect(isRefillOrdered(med)).toBe(true);
      const cycle = checkRefillCycleBooking(med);
      expect(cycle.alreadyDispensed).toBe(false);
      expect(cycle.canBook).toBe(true);
      expect(cycle.isEarly).toBe(true);
      expect(cycle.daysEarly).toBe(20);
    });

    it('treats a distant refill with in_live_cart = true as actionable and bookable', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 15);
      const med = {
        next_refill_date: futureDate.toISOString().slice(0, 10),
        last_refill_date: null,
        refill_interval_days: 30,
        status: 'pending',
        in_live_cart: true
      };

      expect(isRefillOrdered(med)).toBe(true);
      const cycle = checkRefillCycleBooking(med);
      expect(cycle.alreadyDispensed).toBe(false);
      expect(cycle.canBook).toBe(true);
      expect(cycle.isEarly).toBe(true);
      expect(cycle.daysEarly).toBe(15);
    });
  });

  describe('Backend GET /panel SQL Query Filter Verification', () => {
    let db: Database;

    beforeEach(async () => {
      db = await open({
        filename: ':memory:',
        driver: sqlite3.Database
      });

      await db.exec(`
        CREATE TABLE medicines (
          id INTEGER PRIMARY KEY,
          name TEXT,
          packaging TEXT,
          pack_size TEXT,
          sell_price REAL,
          mrp REAL
        );
        CREATE TABLE customers (
          id INTEGER PRIMARY KEY,
          phone TEXT,
          language TEXT,
          reminder_mode TEXT
        );
        CREATE TABLE patient_refills (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          store_id INTEGER DEFAULT 1,
          customer_id INTEGER,
          patient_name TEXT,
          patient_phone TEXT,
          medicine_id INTEGER,
          medicine_name TEXT,
          cart_product_name TEXT,
          cart_product_code TEXT,
          cart_store_name TEXT,
          cart_store_id INTEGER,
          cart_qty INTEGER,
          status TEXT DEFAULT 'pending',
          is_active INTEGER DEFAULT 1,
          is_ready INTEGER DEFAULT 0,
          last_refill_date DATETIME,
          next_refill_date DATETIME,
          language TEXT DEFAULT 'en',
          reminder_mode TEXT DEFAULT 'manual'
        );
      `);

      // Seed test medicines
      await db.run("INSERT INTO medicines (id, name) VALUES (1, 'TELMA 40MG TAB'), (2, 'METFORMIN 500MG'), (3, 'ATORVASTATIN 10MG')");

      // Seed test refill scenarios:
      // 1. Patient A: Refill due in 3 days (within upcoming 7 days) -> Must be returned
      await db.run(`INSERT INTO patient_refills (
        id, patient_name, patient_phone, medicine_id, status, is_active,
        next_refill_date, last_refill_date
      ) VALUES (1, 'Patient A', '9876543210', 1, 'pending', 1, DATE('now', '+3 days'), DATE('now', '-27 days'))`);

      // 2. Patient B: Refill due in 25 days, NOT added to cart -> Must NOT be returned
      await db.run(`INSERT INTO patient_refills (
        id, patient_name, patient_phone, medicine_id, status, is_active,
        next_refill_date, last_refill_date
      ) VALUES (2, 'Patient B', '9876543211', 2, 'pending', 1, DATE('now', '+25 days'), DATE('now', '-5 days'))`);

      // 3. Patient C: Refill due in 25 days, ADDED TO LIVE CART (cart_store_name set) -> MUST BE RETURNED!
      await db.run(`INSERT INTO patient_refills (
        id, patient_name, patient_phone, medicine_id, status, is_active,
        next_refill_date, last_refill_date, cart_store_name, cart_product_code, cart_qty
      ) VALUES (3, 'Patient C', '9876543212', 1, 'ordered', 1, DATE('now', '+25 days'), DATE('now', '-5 days'), 'SUN PHARMA DISTRIBUTORS', 'SUN001', 5)`);

      // 4. Patient D: Refill due in 30 days, status marked 'ordered' -> MUST BE RETURNED!
      await db.run(`INSERT INTO patient_refills (
        id, patient_name, patient_phone, medicine_id, status, is_active,
        next_refill_date, last_refill_date
      ) VALUES (4, 'Patient D', '9876543213', 3, 'ordered', 1, DATE('now', '+30 days'), DATE('now', '0 days'))`);

      // 5. Patient E: Multi-medicine patient, med 1 due in 20 days in live cart, med 2 due in 20 days without cart
      // Both medicines must be returned so patient card displays complete context
      await db.run(`INSERT INTO patient_refills (
        id, patient_name, patient_phone, medicine_id, status, is_active,
        next_refill_date, last_refill_date, cart_store_name, cart_product_code
      ) VALUES (5, 'Patient E', '9876543214', 1, 'ordered', 1, DATE('now', '+20 days'), DATE('now', '-10 days'), 'MAHAVIR PHARMA', 'MAH101')`);
      await db.run(`INSERT INTO patient_refills (
        id, patient_name, patient_phone, medicine_id, status, is_active,
        next_refill_date, last_refill_date, cart_store_name, cart_product_code
      ) VALUES (6, 'Patient E', '9876543214', 2, 'pending', 1, DATE('now', '+20 days'), DATE('now', '-10 days'), NULL, NULL)`);

      // 6. Patient F: Fulfilled today -> Must NOT be returned
      await db.run(`INSERT INTO patient_refills (
        id, patient_name, patient_phone, medicine_id, status, is_active,
        next_refill_date, last_refill_date, cart_store_name
      ) VALUES (7, 'Patient F', '9876543215', 1, 'completed', 1, DATE('now', '0 days'), DATE('now', '0 days'), 'OLD DIST')`);
    });

    afterEach(async () => {
      if (db) await db.close();
    });

    it('returns upcoming refills AND any distant refills added to live cart or ordered', async () => {
      const upcomingDays = 7;
      const targetStoreId = 1;
      const allStores = false;
      const storeCond = '(pr.store_id = ? OR (pr.store_id IS NULL AND ? = 1))';

      const query = `
        SELECT pr.*, COALESCE(m.name, pr.medicine_name, pr.cart_product_name, 'Unknown Medicine') as medicine_name,
               COALESCE(pr.language, cc.language, cp.language, 'en') as language,
               COALESCE(pr.reminder_mode, cc.reminder_mode, cp.reminder_mode, 'manual') as reminder_mode
        FROM patient_refills pr
        LEFT JOIN medicines m ON pr.medicine_id = m.id
        LEFT JOIN customers cc ON cc.id = pr.customer_id AND cc.phone IS NOT NULL AND cc.phone != ''
        LEFT JOIN customers cp ON pr.customer_id IS NULL AND cp.phone = pr.patient_phone AND cp.phone IS NOT NULL AND cp.phone != ''
        WHERE pr.is_active = 1
          AND (pr.last_refill_date IS NULL OR DATE(pr.next_refill_date) > DATE(pr.last_refill_date))
          AND (
            DATE(pr.next_refill_date) <= DATE('now', 'localtime', '+' || ? || ' days')
            OR pr.cart_store_name IS NOT NULL
            OR pr.cart_product_code IS NOT NULL
            OR pr.status = 'ordered'
            OR pr.is_ready = 1
            OR pr.patient_phone IN (
              SELECT pr2.patient_phone FROM patient_refills pr2
              WHERE pr2.is_active = 1
                AND (pr2.cart_store_name IS NOT NULL OR pr2.cart_product_code IS NOT NULL OR pr2.status = 'ordered' OR pr2.is_ready = 1)
            )
          ) AND ${storeCond}
        ORDER BY pr.next_refill_date ASC LIMIT 1000`;

      const rows: any[] = await db.all(query, [upcomingDays, targetStoreId, targetStoreId]);
      const returnedIds = rows.map(r => r.id);

      // Patient A (id 1, due in 3 days) -> Included
      expect(returnedIds).toContain(1);

      // Patient B (id 2, due in 25 days, no cart) -> Filtered out
      expect(returnedIds).not.toContain(2);

      // Patient C (id 3, due in 25 days, cart_store_name set) -> Included!
      expect(returnedIds).toContain(3);

      // Patient D (id 4, due in 30 days, status = 'ordered') -> Included!
      expect(returnedIds).toContain(4);

      // Patient E (id 5 and id 6, med 1 in cart, med 2 companion) -> Both Included!
      expect(returnedIds).toContain(5);
      expect(returnedIds).toContain(6);

      // Patient F (id 7, fulfilled today) -> Excluded because DATE(next_refill_date) > DATE(last_refill_date) is false
      expect(returnedIds).not.toContain(7);
    });

    it('strictly isolates cart attribution so Patient B and general shelf stock never hijack cart lines', () => {
      // Mock live cart contents containing:
      // 1. TELMA 40MG TAB added specifically for Patient A (storeId: 10, productCode: 'TELMA_A')
      // 2. PARACETAMOL 650MG added for general shop shelf stock (storeId: 20, productCode: 'PARA_SHELF')
      const cachedCartLines = [
        { storeId: 10, storeName: 'ALPHA PHARMA', productCode: 'TELMA_A', productName: 'TELMA 40MG TAB', qty: 10 },
        { storeId: 20, storeName: 'BETA PHARMA', productCode: 'PARA_SHELF', productName: 'PARACETAMOL 650MG', qty: 50 }
      ];

      // Patient A: Took Telma 40, explicitly ordered to cart
      const rowPatientA = {
        id: 101,
        medicine_name: 'TELMA 40MG TAB',
        cart_product_code: 'TELMA_A',
        cart_store_id: 10,
        cart_store_name: 'ALPHA PHARMA',
        cart_qty: 10
      };

      // Patient B: Also takes Telma 40, but NOT ordered to cart (due in 2 days)
      const rowPatientB = {
        id: 102,
        medicine_name: 'TELMA 40MG TAB',
        cart_product_code: null,
        cart_store_id: null,
        cart_store_name: null,
        cart_qty: null
      };

      // Patient C: Takes Paracetamol 650mg, but NOT ordered (shelf stock was bought for the shop)
      const rowPatientC = {
        id: 103,
        medicine_name: 'PARACETAMOL 650MG',
        cart_product_code: null,
        cart_store_id: null,
        cart_store_name: null,
        cart_qty: null
      };

      const resolveCartHit = (row: any) => {
        let liveCartHit: { storeName: string; qty: number } | undefined;
        if (cachedCartLines.length > 0) {
          if (row.cart_product_code) {
            liveCartHit = cachedCartLines.find(c => (row.cart_store_id ? c.storeId === Number(row.cart_store_id) : true) && c.productCode === String(row.cart_product_code));
          } else if (row.cart_product_name && row.cart_store_id) {
            const rowClean = String(row.cart_product_name).toLowerCase().replace(/[^a-z0-9]/g, '');
            liveCartHit = cachedCartLines.find(c => c.storeId === Number(row.cart_store_id) && String(c.productName || '').toLowerCase().replace(/[^a-z0-9]/g, '') === rowClean);
          }
        }
        const finalCartStoreName = liveCartHit ? liveCartHit.storeName : (row.cart_store_name || null);
        const finalCartQty = liveCartHit ? liveCartHit.qty : (row.cart_qty || null);
        const inLiveCart = !!liveCartHit || Boolean(row.cart_store_name);
        return { liveCartHit, finalCartStoreName, finalCartQty, inLiveCart };
      };

      // 1. Patient A must correctly resolve live cart
      const resA = resolveCartHit(rowPatientA);
      expect(resA.inLiveCart).toBe(true);
      expect(resA.finalCartStoreName).toBe('ALPHA PHARMA');
      expect(resA.finalCartQty).toBe(10);

      // 2. Patient B has NO cart attribution -> Must NOT match Patient A's line!
      const resB = resolveCartHit(rowPatientB);
      expect(resB.inLiveCart).toBe(false);
      expect(resB.finalCartStoreName).toBeNull();
      expect(resB.finalCartQty).toBeNull();

      // 3. Patient C has NO cart attribution -> Must NOT match general shelf stock!
      const resC = resolveCartHit(rowPatientC);
      expect(resC.inLiveCart).toBe(false);
      expect(resC.finalCartStoreName).toBeNull();
      expect(resC.finalCartQty).toBeNull();
    });
  });
});
