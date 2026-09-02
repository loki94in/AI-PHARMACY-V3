import express from 'express';
import crypto from 'crypto';
import { dbManager } from '../database/connection.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { eventService } from '../services/eventService.js';
import { formatCustomerName } from '../utils/nameFormatter.js';
import { getStoreMedicalNameAndPhone } from '../services/storeSettingsService.js';
import { storeContextService } from '../services/storeContextService.js';

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function normalizePhone(raw: string | number): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

export function hashPin(pin: string): string {
  const salt = 'pharmacy_portal_salt_2026';
  return crypto.pbkdf2Sync(pin, salt, 1000, 32, 'sha256').toString('hex');
}

export function generateRandomPin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export function generateRandomOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Pharmacist / Admin CRM Management Routes ────────────────────────────────

// GET /api/crm/portal-accounts — List all customer portal accounts
router.get('/accounts', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const query = ((req.query.search as string) || '').trim();
    const storeFilter = req.query.store_id ? parseInt(req.query.store_id as string, 10) : null;

    let sql = `
      SELECT 
        pa.id,
        pa.customer_id,
        pa.login_id,
        pa.pin_display,
        pa.preferred_store_id,
        pa.status,
        pa.last_login_at,
        pa.created_at,
        c.name as customer_name,
        c.address as customer_address,
        s.name as preferred_store_name,
        (SELECT COUNT(*) FROM patient_refills pr WHERE pr.customer_id = pa.customer_id AND pr.is_active = 1) as active_refills_count,
        (SELECT COUNT(*) FROM sales sl WHERE sl.customer_id = pa.customer_id) as total_bills_count
      FROM customer_portal_accounts pa
      JOIN customers c ON c.id = pa.customer_id
      LEFT JOIN stores s ON s.id = pa.preferred_store_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (query) {
      sql += ` AND (c.name LIKE ? OR pa.login_id LIKE ?)`;
      params.push(`%${query}%`, `%${query}%`);
    }

    if (storeFilter && !isNaN(storeFilter)) {
      sql += ` AND pa.preferred_store_id = ?`;
      params.push(storeFilter);
    }

    sql += ` ORDER BY pa.created_at DESC LIMIT 100`;

    const accounts = await db.all(sql, params);
    res.json({ success: true, count: accounts.length, accounts });
  } catch (err: any) {
    console.error('[CustomerPortal] List accounts error:', err);
    res.status(500).json({ error: 'Failed to fetch portal accounts' });
  }
});

// POST /api/crm/portal-accounts/generate — Create or Reset PIN for a customer
router.post('/accounts/generate', async (req, res) => {
  const {
    customer_id,
    phone,
    name,
    preferred_store_id = 1,
    custom_pin,
    send_whatsapp = true
  } = req.body;

  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Valid 10-digit mobile number is required' });
  }

  try {
    const db = await dbManager.getConnection();
    let targetCustomerId = customer_id ? parseInt(String(customer_id), 10) : null;
    const cleanName = formatCustomerName(name || 'Customer');

    // 1. Ensure customer exists
    if (!targetCustomerId) {
      const existingCust = await db.get('SELECT id, name FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (existingCust) {
        targetCustomerId = existingCust.id;
      } else {
        const custRes = await db.run(
          'INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [cleanName, cleanPhone]
        );
        targetCustomerId = custRes.lastID ? Number(custRes.lastID) : null;
      }
    }

    const pin = custom_pin && String(custom_pin).length === 4 ? String(custom_pin) : generateRandomPin();
    const pinHashed = hashPin(pin);
    const storeId = parseInt(String(preferred_store_id), 10) || 1;

    // 2. Insert or update portal account
    const existingAccount = await db.get('SELECT id FROM customer_portal_accounts WHERE customer_id = ? OR login_id = ?', [
      targetCustomerId,
      cleanPhone
    ]);

    let accountId: number;
    if (existingAccount) {
      await db.run(
        `UPDATE customer_portal_accounts 
         SET pin_hash = ?, pin_display = ?, preferred_store_id = ?, status = 'active', updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [pinHashed, pin, storeId, existingAccount.id]
      );
      accountId = existingAccount.id;
    } else {
      const accRes = await db.run(
        `INSERT INTO customer_portal_accounts 
         (customer_id, login_id, pin_hash, pin_display, preferred_store_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [targetCustomerId, cleanPhone, pinHashed, pin, storeId]
      );
      accountId = Number(accRes.lastID);
    }

    // 3. Send WhatsApp credentials invite if enabled
    let whatsappQueued = false;
    if (send_whatsapp) {
      try {
        const storeInfo = await storeContextService.getStoreById(storeId);
        const storeName = storeInfo?.name || (await getStoreMedicalNameAndPhone(db));
        const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

        const msg = `*Welcome to ${storeName} Online Portal!*\n\nHello ${cleanName}, your direct refill account is ready:\n\n📱 *Login ID:* ${cleanPhone}\n🔑 *4-Digit PIN:* ${pin}\n📍 *Collection Branch:* ${storeName}\n\n*Website:* /portal\n\nLogin to view your past store bills, choose medicines, and reorder for quick counter pickup!`;

        await whatsappQueueWorker.enqueue(formattedPhone, msg, 'portal_credentials', cleanName);
        whatsappQueued = true;
      } catch (waErr) {
        console.warn('[CustomerPortal] WhatsApp send warning:', waErr);
      }
    }

    res.status(201).json({
      success: true,
      account_id: accountId,
      customer_id: targetCustomerId,
      login_id: cleanPhone,
      pin,
      preferred_store_id: storeId,
      whatsapp_queued: whatsappQueued
    });
  } catch (err: any) {
    console.error('[CustomerPortal] Generate account error:', err);
    res.status(500).json({ error: 'Failed to generate portal credentials: ' + (err.message || 'Unknown error') });
  }
});

// POST /api/crm/portal-accounts/:id/send-credentials — Resend credentials via WhatsApp
router.post('/accounts/:id/send-credentials', async (req, res) => {
  const accountId = parseInt(req.params.id, 10);
  if (isNaN(accountId)) return res.status(400).json({ error: 'Invalid account ID' });

  try {
    const db = await dbManager.getConnection();
    const account = await db.get(
      `SELECT pa.*, c.name as customer_name, s.name as store_name
       FROM customer_portal_accounts pa
       JOIN customers c ON c.id = pa.customer_id
       LEFT JOIN stores s ON s.id = pa.preferred_store_id
       WHERE pa.id = ?`,
      [accountId]
    );

    if (!account) return res.status(404).json({ error: 'Portal account not found' });

    // Generate new PIN if display PIN missing
    let pin = account.pin_display;
    if (!pin) {
      pin = generateRandomPin();
      const pinHashed = hashPin(pin);
      await db.run(
        'UPDATE customer_portal_accounts SET pin_hash = ?, pin_display = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [pinHashed, pin, accountId]
      );
    }

    const cleanPhone = account.login_id;
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const storeName = account.store_name || (await getStoreMedicalNameAndPhone(db));
    const customerName = formatCustomerName(account.customer_name);

    const msg = `*Your ${storeName} Login Credentials*\n\nHello ${customerName},\nHere are your online refill portal details:\n\n📱 *Login ID:* ${cleanPhone}\n🔑 *PIN:* ${pin}\n📍 *Branch:* ${storeName}\n\n*Website:* /portal\n\nTap the link to login, select medicines from your previous bills, and place your pickup order.`;

    const queueId = await whatsappQueueWorker.enqueue(formattedPhone, msg, 'portal_credentials_resend', customerName);

    res.json({
      success: true,
      message: 'Credentials sent to WhatsApp',
      queue_id: queueId,
      login_id: cleanPhone,
      pin
    });
  } catch (err: any) {
    console.error('[CustomerPortal] Resend credentials error:', err);
    res.status(500).json({ error: 'Failed to send credentials' });
  }
});

// PUT /api/crm/portal-accounts/:id — Update status, preferred branch, or override PIN
router.put('/accounts/:id', async (req, res) => {
  const accountId = parseInt(req.params.id, 10);
  const { status, preferred_store_id, custom_pin, override_pin, send_whatsapp = true } = req.body;

  try {
    const db = await dbManager.getConnection();
    const updates: string[] = [];
    const params: any[] = [];

    if (status && ['active', 'disabled', 'suspended'].includes(status)) {
      updates.push('status = ?');
      params.push(status);
    }

    if (preferred_store_id) {
      updates.push('preferred_store_id = ?');
      params.push(parseInt(String(preferred_store_id), 10) || 1);
    }

    let updatedPin: string | null = null;
    const pinToSet = String(custom_pin || override_pin || '').trim();
    if (pinToSet && pinToSet.length >= 4) {
      const hashed = hashPin(pinToSet);
      updates.push('pin_hash = ?', 'pin_display = ?');
      params.push(hashed, pinToSet);
      updatedPin = pinToSet;
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(accountId);

    await db.run(`UPDATE customer_portal_accounts SET ${updates.join(', ')} WHERE id = ?`, params);

    // If PIN was manually overridden by pharmacy and send_whatsapp is enabled, notify customer
    if (updatedPin && send_whatsapp) {
      try {
        const account = await db.get(
          `SELECT pa.*, c.name as customer_name, s.name as store_name
           FROM customer_portal_accounts pa
           JOIN customers c ON c.id = pa.customer_id
           LEFT JOIN stores s ON s.id = pa.preferred_store_id
           WHERE pa.id = ?`,
          [accountId]
        );
        if (account) {
          const cleanPhone = account.login_id;
          const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
          const storeName = account.store_name || (await getStoreMedicalNameAndPhone(db));
          const customerName = formatCustomerName(account.customer_name);
          const msg = `*Your ${storeName} PIN Has Been Reset*\n\nHello ${customerName},\nYour online refill portal PIN has been reset by the pharmacy.\n\n📱 *Login ID:* ${cleanPhone}\n🔑 *New PIN:* ${updatedPin}\n📍 *Branch:* ${storeName}\n\n*Website:* /portal`;
          await whatsappQueueWorker.enqueue(formattedPhone, msg, 'portal_pin_override', customerName);
        }
      } catch (_) {}
    }

    res.json({ success: true, message: 'Portal account updated successfully', pin: updatedPin });
  } catch (err: any) {
    console.error('[CustomerPortal] Update account error:', err);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// ─── Customer-Facing Website Authentication & Refill Routes ──────────────────

// POST /api/website/auth/change-pin — Customer changes their own PIN on the portal
router.post('/auth/change-pin', async (req, res) => {
  const { customer_id, phone, current_pin, new_pin } = req.body;
  const cleanPhone = normalizePhone(phone);
  const cleanCurrentPin = String(current_pin || '').trim();
  const cleanNewPin = String(new_pin || '').trim();

  if (!cleanNewPin || cleanNewPin.length < 4) {
    return res.status(400).json({ error: 'New PIN must be at least 4 digits' });
  }

  try {
    const db = await dbManager.getConnection();
    let account = null;

    if (customer_id) {
      account = await db.get('SELECT * FROM customer_portal_accounts WHERE customer_id = ?', [customer_id]);
    } else if (cleanPhone) {
      account = await db.get('SELECT * FROM customer_portal_accounts WHERE login_id = ?', [cleanPhone]);
    }

    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Verify current PIN if provided
    if (cleanCurrentPin) {
      const currentHashed = hashPin(cleanCurrentPin);
      if (account.pin_hash !== currentHashed) {
        return res.status(401).json({ error: 'Current PIN is incorrect' });
      }
    }

    const newHashed = hashPin(cleanNewPin);
    await db.run(
      'UPDATE customer_portal_accounts SET pin_hash = ?, pin_display = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newHashed, cleanNewPin, account.id]
    );

    // Notify via WhatsApp
    try {
      const cust = await db.get('SELECT name FROM customers WHERE id = ?', [account.customer_id]);
      const custName = formatCustomerName(cust?.name || 'Customer');
      const formattedPhone = account.login_id.length === 10 ? `91${account.login_id}` : account.login_id;
      const storeName = await getStoreMedicalNameAndPhone(db);
      const msg = `*Security Update — ${storeName}*\n\nHello ${custName},\nYour online refill portal PIN has been successfully changed.\n\n🔑 *New PIN:* ${cleanNewPin}\n\nIf you did not make this change, please contact your pharmacy immediately.`;
      await whatsappQueueWorker.enqueue(formattedPhone, msg, 'pin_changed_alert', custName);
    } catch (_) {}

    res.json({ success: true, message: 'PIN updated successfully', pin: cleanNewPin });
  } catch (err: any) {
    console.error('[CustomerPortal] Change PIN error:', err);
    res.status(500).json({ error: 'Failed to update PIN' });
  }
});

// POST /api/website/auth/login — Customer Login with Phone + PIN
router.post('/auth/login', async (req, res) => {
  const { login_id, pin } = req.body;
  const cleanPhone = normalizePhone(login_id);
  const cleanPin = String(pin || '').trim();

  if (!cleanPhone || cleanPhone.length < 10 || !cleanPin) {
    return res.status(400).json({ error: 'Phone number and 4-digit PIN are required' });
  }

  try {
    const db = await dbManager.getConnection();
    const hashed = hashPin(cleanPin);

    // Look up account
    const account = await db.get(
      `SELECT pa.*, c.name as customer_name, c.address as customer_address, c.id as cust_id
       FROM customer_portal_accounts pa
       JOIN customers c ON c.id = pa.customer_id
       WHERE pa.login_id = ? AND pa.pin_hash = ? AND pa.status = 'active'`,
      [cleanPhone, hashed]
    );

    if (!account) {
      return res.status(401).json({ error: 'Invalid phone number or PIN. Please try again or request OTP.' });
    }

    // Update last login
    await db.run(
      'UPDATE customer_portal_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
      [account.id]
    );

    // Fetch active stores list
    const stores = await storeContextService.listStores(undefined, false);

    res.json({
      success: true,
      customer: {
        id: account.cust_id,
        name: account.customer_name,
        phone: account.login_id,
        address: account.customer_address || '',
        preferred_store_id: account.preferred_store_id || 1
      },
      stores: stores.map(s => ({
        id: s.id,
        name: s.name,
        address: s.address || '',
        phone: s.phone || ''
      }))
    });
  } catch (err: any) {
    console.error('[CustomerPortal] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/website/auth/request-otp — Customer requests 6-digit WhatsApp OTP
router.post('/auth/request-otp', async (req, res) => {
  const { login_id } = req.body;
  const cleanPhone = normalizePhone(login_id);

  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Valid 10-digit mobile number required' });
  }

  try {
    const db = await dbManager.getConnection();
    // Portal access is strictly managed by pharmacy — verify account exists
    const account = await db.get(
      `SELECT pa.*, c.name as customer_name 
       FROM customer_portal_accounts pa
       JOIN customers c ON c.id = pa.customer_id
       WHERE pa.login_id = ? AND pa.status = 'active'`,
      [cleanPhone]
    );

    if (!account) {
      return res.status(404).json({
        error: 'Refill account not found or disabled. Please contact your pharmacy branch to set up portal access.'
      });
    }

    const otpCode = generateRandomOtp();
    // Expiry in 10 minutes in SQLite compatible datetime format
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    await db.run(
      'INSERT INTO customer_portal_otps (login_id, otp_code, expires_at, is_used) VALUES (?, ?, ?, 0)',
      [cleanPhone, otpCode, expiresAt]
    );

    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const custName = formatCustomerName(account.customer_name || 'Customer');
    const medicalName = await getStoreMedicalNameAndPhone(db);

    const otpMsg = `🔐 *Your ${medicalName} Login OTP is: ${otpCode}*\n\nValid for 10 minutes. Please do not share this code with anyone.`;

    await whatsappQueueWorker.enqueue(formattedPhone, otpMsg, 'portal_otp', custName);

    res.json({
      success: true,
      message: 'OTP sent to your registered WhatsApp number',
      login_id: cleanPhone
    });
  } catch (err: any) {
    console.error('[CustomerPortal] Request OTP error:', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /api/website/auth/verify-otp — Verify WhatsApp OTP and log in
router.post('/auth/verify-otp', async (req, res) => {
  const { login_id, otp_code } = req.body;
  const cleanPhone = normalizePhone(login_id);
  const cleanOtp = String(otp_code || '').trim();

  if (!cleanPhone || !cleanOtp) {
    return res.status(400).json({ error: 'Phone number and OTP are required' });
  }

  try {
    const db = await dbManager.getConnection();
    const otpRow = await db.get(
      `SELECT * FROM customer_portal_otps 
       WHERE login_id = ? AND otp_code = ? AND is_used = 0 AND expires_at > datetime('now')
       ORDER BY id DESC LIMIT 1`,
      [cleanPhone, cleanOtp]
    );

    if (!otpRow) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Mark OTP as used
    await db.run('UPDATE customer_portal_otps SET is_used = 1 WHERE id = ?', [otpRow.id]);

    // Verify customer & portal account exists (strictly pharmacy managed)
    const account = await db.get(
      `SELECT pa.*, c.name as customer_name, c.address as customer_address, c.id as cust_id
       FROM customer_portal_accounts pa
       JOIN customers c ON c.id = pa.customer_id
       WHERE pa.login_id = ? AND pa.status = 'active'`,
      [cleanPhone]
    );

    if (!account) {
      return res.status(404).json({
        error: 'Refill account not found or disabled. Please contact your pharmacy branch.'
      });
    }

    await db.run('UPDATE customer_portal_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [account.id]);

    const stores = await storeContextService.listStores(undefined, false);

    res.json({
      success: true,
      customer: {
        id: account.cust_id,
        name: account.customer_name,
        phone: cleanPhone,
        address: account.customer_address || '',
        preferred_store_id: account.preferred_store_id || 1
      },
      stores: stores.map(s => ({
        id: s.id,
        name: s.name,
        address: s.address || '',
        phone: s.phone || ''
      }))
    });
  } catch (err: any) {
    console.error('[CustomerPortal] Verify OTP error:', err);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// GET /api/website/customer/bills — Past Store Bills for Customer
router.get('/customer/bills', async (req, res) => {
  const customerId = parseInt(req.query.customer_id as string, 10);
  const phone = normalizePhone(req.query.phone as string);

  if (!customerId && !phone) {
    return res.status(400).json({ error: 'customer_id or phone required' });
  }

  try {
    const db = await dbManager.getConnection();
    let custId = customerId;

    if (!custId && phone) {
      const cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [phone]);
      if (cust) custId = cust.id;
    }

    if (!custId) {
      return res.json({ bills: [] });
    }

    // Fetch past sales with items
    const sales = await db.all(
      `SELECT s.id, s.invoice_number, s.store_id, s.total_amount, s.net_amount, s.created_at, st.name as store_name
       FROM sales s
       LEFT JOIN stores st ON st.id = s.store_id
       WHERE s.customer_id = ?
       ORDER BY s.created_at DESC LIMIT 20`,
      [custId]
    ).catch(() => []);

    const enrichedBills = [];
    for (const sale of sales) {
      const items = await db.all(
        `SELECT si.id, si.medicine_id, m.name as medicine_name, m.generic_name, si.quantity, si.unit_price, si.total_price
         FROM sale_items si
         JOIN medicines m ON m.id = si.medicine_id
         WHERE si.sale_id = ?`,
        [sale.id]
      ).catch(() => []);

      enrichedBills.push({
        ...sale,
        items
      });
    }

    res.json({ success: true, count: enrichedBills.length, bills: enrichedBills });
  } catch (err: any) {
    console.error('[CustomerPortal] Fetch customer bills error:', err);
    res.status(500).json({ error: 'Failed to fetch customer bills' });
  }
});

// GET /api/website/customer/refills — Active Recurring Refills for Customer
router.get('/customer/refills', async (req, res) => {
  const customerId = parseInt(req.query.customer_id as string, 10);
  const phone = normalizePhone(req.query.phone as string);

  if (!customerId && !phone) {
    return res.status(400).json({ error: 'customer_id or phone required' });
  }

  try {
    const db = await dbManager.getConnection();

    let sql = `
      SELECT 
        pr.id,
        pr.medicine_id,
        m.name as medicine_name,
        m.generic_name,
        m.strength,
        m.mrp,
        m.sell_price,
        pr.refill_interval_days,
        pr.quantity_needed,
        pr.last_refill_date,
        pr.next_refill_date,
        pr.store_id,
        s.name as store_name
      FROM patient_refills pr
      JOIN medicines m ON m.id = pr.medicine_id
      LEFT JOIN stores s ON s.id = pr.store_id
      WHERE pr.is_active = 1 AND (pr.customer_id = ? OR pr.patient_phone LIKE ?)
      ORDER BY pr.next_refill_date ASC
    `;
    const refills = await db.all(sql, [customerId || -1, `%${phone}%`]).catch(() => []);

    res.json({ success: true, count: refills.length, refills });
  } catch (err: any) {
    console.error('[CustomerPortal] Fetch customer refills error:', err);
    res.status(500).json({ error: 'Failed to fetch refills' });
  }
});

// POST /api/website/customer/refill-order — Place customized in-store pickup refill order
router.post('/customer/refill-order', async (req, res) => {
  const {
    customer_id,
    customer_name,
    customer_phone,
    store_id = 1,
    items,
    payment_method = 'COUNTER_PICKUP',
    notes
  } = req.body;

  if (!customer_name || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Customer name and at least one medicine required' });
  }

  const cleanPhone = normalizePhone(customer_phone);
  const cleanName = formatCustomerName(customer_name);
  const targetStoreId = parseInt(String(store_id), 10) || 1;
  const todayStr = new Date().toISOString();

  try {
    const db = await dbManager.getConnection();

    // 1. Verify customer exists (pharmacy-managed only)
    let custId = customer_id ? parseInt(String(customer_id), 10) : null;
    let registeredCustomer = null;

    if (custId) {
      registeredCustomer = await db.get('SELECT id, name FROM customers WHERE id = ?', [custId]);
    } else if (cleanPhone) {
      registeredCustomer = await db.get('SELECT id, name FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (registeredCustomer) custId = registeredCustomer.id;
    }

    if (!registeredCustomer || !custId) {
      return res.status(403).json({
        error: 'Customer profile not found. Online refill ordering is only available for registered pharmacy customers.'
      });
    }

    const officialCustomerName = registeredCustomer.name || cleanName;

    // 2. Insert items into special_orders (with collection_mode = 'counter_pickup')
    const createdOrders: Array<{ id: number; product: string; qty: number; price: number }> = [];

    await db.run('BEGIN TRANSACTION');
    try {
      for (const item of items) {
        const prodName = (item.product || item.medicine_name || item.name || '').trim();
        if (!prodName) continue;
        const qty = Number(item.qty || item.quantity_needed) || 1;
        const price = Number(item.price || item.sell_price || item.mrp || 0);

        const result = await db.run(
          `INSERT INTO special_orders (
            store_id, customer_id, product, requester, phone, qty, priority, status, date, notified,
            advance_payment, notes, customer_order_source, delivery_status, return_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Pending', ?, 0, 0, ?, 'website_refill', 'counter_pickup', 'none', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            targetStoreId,
            custId,
            prodName,
            cleanName,
            cleanPhone,
            qty,
            todayStr,
            notes ? `[Refill Collection - ${payment_method}] ${notes}` : `[Refill Collection - ${payment_method}]`
          ]
        );

        const orderId = Number(result.lastID);
        createdOrders.push({ id: orderId, product: prodName, qty, price });

        // Record tracking event
        await db.run(
          `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
           VALUES (?, 'refill_order_created', ?, 'customer', CURRENT_TIMESTAMP)`,
          [orderId, `Refill order placed for In-Store Pickup at Store #${targetStoreId}. Item: ${prodName} (Qty: ${qty}) - Payment: ${payment_method}`]
        );
      }

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    // 3. Update customer's preferred store
    if (custId) {
      await db.run(
        `UPDATE customer_portal_accounts SET preferred_store_id = ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?`,
        [targetStoreId, custId]
      ).catch(() => {});
    }

    // 4. Send WhatsApp Confirmation to Customer
    const storeInfo = await storeContextService.getStoreById(targetStoreId);
    const storeName = storeInfo?.name || (await getStoreMedicalNameAndPhone(db));
    const storeAddress = storeInfo?.address ? `\n📍 *Address:* ${storeInfo.address}` : '';
    const storePhone = storeInfo?.phone ? `\n📞 *Contact:* ${storeInfo.phone}` : '';

    if (cleanPhone && cleanPhone.length >= 10) {
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const orderIdsStr = createdOrders.map(o => `#${o.id}`).join(', ');
      const itemsSummary = createdOrders.map((o, idx) => `${idx + 1}. ${o.product} (x${o.qty})`).join('\n');
      const totalAmount = createdOrders.reduce((sum, o) => sum + (o.price * o.qty), 0);

      const pickupMsg = `*Refill Order Received (${orderIdsStr})*\n\nHello ${cleanName},\nThank you for placing your refill order at *${storeName}*.\n\n*Selected Medicines:*\n${itemsSummary}\n\n💵 *Total:* ₹${totalAmount.toFixed(2)} (${payment_method})\n📍 *Pickup Branch:* ${storeName}${storeAddress}${storePhone}\n\n*Our pharmacist is packing your order. We will notify you once it is ready at the counter!*`;

      try {
        await whatsappQueueWorker.enqueue(formattedPhone, pickupMsg, 'refill_collection_confirmation', cleanName);
      } catch (waErr) {
        console.warn('[CustomerPortal] WhatsApp confirmation warning:', waErr);
      }
    }

    // 5. Broadcast SSE push so store POS refreshes instantly
    try {
      eventService.broadcast('order_updated', { at: Date.now(), source: 'customer_portal', store_id: targetStoreId });
      eventService.broadcast('refill_updated', { at: Date.now(), source: 'customer_portal', store_id: targetStoreId });
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Refill collection order placed successfully',
      store_id: targetStoreId,
      store_name: storeName,
      orders: createdOrders,
      customer: { name: cleanName, phone: cleanPhone }
    });
  } catch (err: any) {
    console.error('[CustomerPortal] Refill order error:', err);
    res.status(500).json({ error: 'Failed to place refill order: ' + (err.message || 'Unknown error') });
  }
});

export default router;
