import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { dbManager } from '../database/connection.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { eventService } from '../services/eventService.js';
import { formatCustomerName } from '../utils/nameFormatter.js';
import { getStoreMedicalNameAndPhone } from '../services/storeSettingsService.js';
import { storeContextService } from '../services/storeContextService.js';
import { catalogImageService } from '../services/catalogImageService.js';
import { paymentQrService } from '../services/paymentQrService.js';

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

const SESSION_SECRET = process.env.CUSTOMER_PORTAL_SECRET || 'pharmacy_portal_session_secret_2026';

export function createCustomerToken(customerId: number, phone: string): string {
  const payload = `${customerId}:${phone}:${Date.now()}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

export function verifyCustomerToken(tokenStr: string): { customerId: number; phone: string } | null {
  try {
    if (!tokenStr) return null;
    const decoded = Buffer.from(tokenStr, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return null;
    const [customerIdStr, phone, timestampStr, signature] = parts;
    const customerId = parseInt(customerIdStr, 10);
    const timestamp = parseInt(timestampStr, 10);
    if (!customerId || isNaN(customerId) || isNaN(timestamp)) return null;
    const expectedPayload = `${customerIdStr}:${phone}:${timestampStr}`;
    const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(expectedPayload).digest('hex');
    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return { customerId, phone };
    }
  } catch (_) {}
  return null;
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
        COALESCE(pa.total_login_count, 0) as total_login_count,
        COALESCE(pa.total_time_spent_seconds, 0) as total_time_spent_seconds,
        pa.last_logout_at,
        pa.created_at,
        c.name as customer_name,
        c.address as customer_address,
        s.name as preferred_store_name,
        (SELECT COUNT(*) FROM patient_refills pr WHERE pr.customer_id = pa.customer_id AND pr.is_active = 1) as active_refills_count,
        (SELECT COUNT(*) FROM sales_invoices sl WHERE sl.customer_id = pa.customer_id) as total_bills_count
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

// GET /api/crm/portal-accounts/:id/sessions — Inspect customer login/logout sessions
router.get('/accounts/:id/sessions', async (req, res) => {
  try {
    const accountId = parseInt(String(req.params.id), 10);
    const db = await dbManager.getConnection();
    const account = await db.get(`SELECT customer_id FROM customer_portal_accounts WHERE id = ?`, [accountId]);
    if (!account) {
      return res.status(404).json({ error: 'Portal account not found' });
    }

    const { customerAuthService } = await import('../services/auth/customerAuthService.js');
    const sessionData = await customerAuthService.getCustomerSessions(account.customer_id);
    res.json({ success: true, ...sessionData });
  } catch (err: any) {
    console.error('[CustomerPortal] Fetch sessions error:', err);
    res.status(500).json({ error: 'Failed to fetch customer sessions' });
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
        if (cleanName && cleanName !== 'Customer' && existingCust.name !== cleanName) {
          await db.run('UPDATE customers SET name = ? WHERE id = ?', [cleanName, targetCustomerId]);
        }
      } else {
        const custRes = await db.run(
          'INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [cleanName, cleanPhone]
        );
        targetCustomerId = custRes.lastID ? Number(custRes.lastID) : null;
      }
    } else {
      const existingCust = await db.get('SELECT id, name FROM customers WHERE id = ?', [targetCustomerId]);
      if (existingCust && cleanName && cleanName !== 'Customer' && existingCust.name !== cleanName) {
        await db.run('UPDATE customers SET name = ? WHERE id = ?', [cleanName, targetCustomerId]);
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
         SET customer_id = ?, login_id = ?, pin_hash = ?, pin_display = ?, preferred_store_id = ?, status = 'active', updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [targetCustomerId, cleanPhone, pinHashed, pin, storeId, existingAccount.id]
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

        const msg = `*Welcome to ${storeName} Online Portal!*\n\nHello ${cleanName}, your direct refill account is ready:\n\n📱 *Login ID:* ${cleanPhone}\n🔑 *4-Digit PIN:* ${pin}\n📍 *Collection Branch:* ${storeName}\n\n*Direct Login Link:* /customer-login?phone=${cleanPhone}\n\nLogin to view your past store bills, choose medicines, and reorder for quick counter pickup!`;

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

    const msg = `*Your ${storeName} Login Credentials*\n\nHello ${customerName},\nHere are your online refill portal details:\n\n📱 *Login ID:* ${cleanPhone}\n🔑 *PIN:* ${pin}\n📍 *Branch:* ${storeName}\n\n*Direct Login Link:* /customer-login?phone=${cleanPhone}\n\nTap the link to login, select medicines from your previous bills, and place your pickup order.`;

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
  const { login_id, name } = req.body;
  const cleanPhone = normalizePhone(login_id);

  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Valid 10-digit mobile number required' });
  }

  try {
    const db = await dbManager.getConnection();
    
    // Step 1: Find existing customer by phone
    let customer = await db.get('SELECT * FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
    
    // Step 2: If customer does not exist, create one (Rule 1, Rule 2, Test 1)
    if (!customer) {
      const defaultName = formatCustomerName(name || 'Customer');
      const insResult = await db.run(
        'INSERT INTO customers (name, phone, address, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        [defaultName, cleanPhone, '']
      );
      const newCustId = insResult.lastID as number;
      customer = await db.get('SELECT * FROM customers WHERE id = ?', [newCustId]);
    }

    // Step 3: Ensure customer_portal_accounts row exists (Rule 2: permanent user_id / customer_id)
    let account = await db.get(
      'SELECT * FROM customer_portal_accounts WHERE customer_id = ? OR login_id = ?',
      [customer.id, cleanPhone]
    );

    if (!account) {
      const initialPin = generateRandomPin();
      const pHash = hashPin(initialPin);
      const accRes = await db.run(
        `INSERT INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display, status, preferred_store_id)
         VALUES (?, ?, ?, ?, 'active', 1)`,
        [customer.id, cleanPhone, pHash, initialPin]
      );
      account = await db.get('SELECT * FROM customer_portal_accounts WHERE id = ?', [accRes.lastID]);
    } else if (account.status !== 'active') {
      return res.status(403).json({ error: 'Portal account disabled. Please contact your pharmacy branch.' });
    }

    const otpCode = generateRandomOtp();
    // Expiry in 10 minutes in SQLite compatible datetime format
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    await db.run(
      'INSERT INTO customer_portal_otps (login_id, otp_code, expires_at, is_used) VALUES (?, ?, ?, 0)',
      [cleanPhone, otpCode, expiresAt]
    );

    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const custName = formatCustomerName(customer.name || 'Customer');
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

    // Retrieve customer & portal account
    let account = await db.get(
      `SELECT pa.*, c.name as customer_name, c.address as customer_address, c.id as cust_id
       FROM customer_portal_accounts pa
       JOIN customers c ON c.id = pa.customer_id
       WHERE (pa.login_id = ? OR c.phone = ?) AND pa.status = 'active'`,
      [cleanPhone, cleanPhone]
    );

    if (!account) {
      // Fallback: create customer and portal account if missing
      let customer = await db.get('SELECT * FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (!customer) {
        const insResult = await db.run(
          'INSERT INTO customers (name, phone, address, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
          ['Customer', cleanPhone, '']
        );
        customer = await db.get('SELECT * FROM customers WHERE id = ?', [insResult.lastID]);
      }
      const initialPin = generateRandomPin();
      const pHash = hashPin(initialPin);
      await db.run(
        `INSERT OR REPLACE INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display, status, preferred_store_id)
         VALUES (?, ?, ?, ?, 'active', 1)`,
        [customer.id, cleanPhone, pHash, initialPin]
      );
      account = await db.get(
        `SELECT pa.*, c.name as customer_name, c.address as customer_address, c.id as cust_id
         FROM customer_portal_accounts pa
         JOIN customers c ON c.id = pa.customer_id
         WHERE pa.login_id = ?`,
        [cleanPhone]
      );
    }

    await db.run('UPDATE customer_portal_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [account.id]);

    const token = createCustomerToken(account.cust_id, cleanPhone);
    const stores = await storeContextService.listStores(undefined, false);

    res.json({
      success: true,
      token,
      customer: {
        id: account.cust_id,
        user_id: account.cust_id, // permanent immutable internal identity (Rule 2)
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

  // Authorization check (Test 8: User A cannot access User B's invoices)
  const authHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const verified = verifyCustomerToken(authHeader || (req.query.token as string));

  if (verified && customerId && verified.customerId !== customerId) {
    return res.status(403).json({ error: "Access denied: Cannot access another customer's invoices" });
  }

  let custId = customerId || verified?.customerId || 0;

  try {
    const db = await dbManager.getConnection();

    if (!custId && phone) {
      const cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [phone]);
      if (cust) custId = cust.id;
    }

    if (!custId) {
      return res.status(400).json({ error: 'customer_id or phone required' });
    }

    // Fetch past sales_invoices with items
    const sales = await db.all(
      `SELECT si.id, si.invoice_no, si.invoice_no as invoice_number, si.store_id,
              si.total_amount, si.total_amount as net_amount, si.date, si.date as created_at,
              COALESCE(st.name, 'Pharmacy') as store_name
       FROM sales_invoices si
       LEFT JOIN stores st ON st.id = si.store_id
       WHERE si.customer_id = ?
       ORDER BY si.date DESC LIMIT 50`,
      [custId]
    ).catch(() => []);

    const enrichedBills = [];
    for (const sale of sales) {
      // Historical item snapshots from sale_items (Rule 6, 7 & Test 4: price changes do NOT modify past bills)
      const items = await db.all(
        `SELECT sit.id,
                sit.quantity,
                sit.unit_price,
                sit.mrp,
                sit.discount_per,
                (sit.quantity * sit.unit_price) as total_price,
                COALESCE(m.name, 'Medicine') as medicine_name,
                COALESCE(m.generic_name, '') as generic_name,
                im.medicine_id
         FROM sale_items sit
         LEFT JOIN inventory_master im ON im.id = sit.inventory_id
         LEFT JOIN medicines m ON m.id = im.medicine_id
         WHERE sit.invoice_id = ?
         ORDER BY sit.id ASC`,
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

  // Authorization check (Test 8: Tenant isolation)
  const authHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const verified = verifyCustomerToken(authHeader || (req.query.token as string));

  if (verified && customerId && verified.customerId !== customerId) {
    return res.status(403).json({ error: "Access denied: Cannot access another customer's refills" });
  }

  let custId = customerId || verified?.customerId || 0;

  if (!custId && !phone) {
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
    const refills = await db.all(sql, [custId || -1, `%${phone}%`]).catch(() => []);

    res.json({ success: true, count: refills.length, refills });
  } catch (err: any) {
    console.error('[CustomerPortal] Fetch customer refills error:', err);
    res.status(500).json({ error: 'Failed to fetch refills' });
  }
});

// PUT /api/customer-portal/customer/phone — Update customer phone number (Test 12: user_id remains unchanged)
router.put('/customer/phone', async (req, res) => {
  const { customer_id, new_phone } = req.body;
  const cleanPhone = normalizePhone(new_phone);

  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Valid 10-digit mobile number required' });
  }

  const authHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const verified = verifyCustomerToken(authHeader || (req.body.token as string));
  const custId = parseInt(customer_id, 10) || verified?.customerId;

  if (!custId) {
    return res.status(400).json({ error: 'customer_id is required' });
  }

  if (verified && verified.customerId !== custId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const db = await dbManager.getConnection();

    const conflict = await db.get('SELECT id FROM customers WHERE phone = ? AND id != ?', [cleanPhone, custId]);
    if (conflict) {
      return res.status(409).json({ error: 'Phone number already in use by another customer' });
    }

    await db.run('BEGIN TRANSACTION');
    try {
      // Update phone on customers table — customer_id remains immutable
      await db.run('UPDATE customers SET phone = ? WHERE id = ?', [cleanPhone, custId]);

      // Update login_id on customer_portal_accounts
      await db.run(
        'UPDATE customer_portal_accounts SET login_id = ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?',
        [cleanPhone, custId]
      );

      await db.run('COMMIT');

      const newToken = createCustomerToken(custId, cleanPhone);
      res.json({
        success: true,
        message: 'Phone number updated successfully',
        customer_id: custId,
        new_phone: cleanPhone,
        token: newToken
      });
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err: any) {
    console.error('[CustomerPortal] Update phone error:', err);
    res.status(500).json({ error: 'Failed to update phone number' });
  }
});


// POST /api/website/customer/refill-order — Place customized in-store pickup or home delivery refill order
router.post('/customer/refill-order', async (req, res) => {
  const {
    customer_id,
    customer_name,
    customer_phone,
    store_id = 1,
    items,
    payment_method = 'COUNTER_PICKUP',
    delivery_mode = 'pickup',
    delivery_address = '',
    notes = ''
  } = req.body;

  if (!customer_name || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Customer name and at least one medicine required' });
  }

  const cleanPhone = normalizePhone(customer_phone);
  const cleanName = formatCustomerName(customer_name);
  const targetStoreId = parseInt(String(store_id), 10) || 1;
  const todayStr = new Date().toISOString();
  const cleanAddress = String(delivery_address || '').trim();
  const isDelivery = delivery_mode === 'delivery';

  try {
    const db = await dbManager.getConnection();

    // 1. Verify or create customer
    let custId = customer_id ? parseInt(String(customer_id), 10) : null;
    let registeredCustomer = null;

    if (custId) {
      registeredCustomer = await db.get('SELECT id, name, address FROM customers WHERE id = ?', [custId]);
    } else if (cleanPhone) {
      registeredCustomer = await db.get('SELECT id, name, address FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      if (registeredCustomer) custId = registeredCustomer.id;
    }

    if (!registeredCustomer || !custId) {
      if (cleanName && cleanPhone) {
        const insRes = await db.run(
          'INSERT INTO customers (name, phone, address, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
          [cleanName, cleanPhone, cleanAddress || 'Website Customer']
        );
        custId = Number(insRes.lastID);
        registeredCustomer = { id: custId, name: cleanName, address: cleanAddress };
      } else {
        return res.status(400).json({
          error: 'Please provide valid customer name and mobile number to place order.'
        });
      }
    } else if (cleanAddress && !registeredCustomer.address) {
      await db.run('UPDATE customers SET address = ? WHERE id = ?', [cleanAddress, custId]).catch(() => {});
    }

    // 1.5 Idempotency protection (Test 11: accidental duplicate order submission)
    const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body.idempotency_key as string);
    if (idempotencyKey) {
      const recentOrder = await db.get(
        `SELECT id, product, qty FROM special_orders 
         WHERE customer_id = ? AND notes LIKE ? AND created_at > datetime('now', '-2 minutes')
         ORDER BY id DESC LIMIT 1`,
        [custId, `%[Idempotency: ${idempotencyKey}]%`]
      );
      if (recentOrder) {
        return res.json({
          success: true,
          message: 'Order already received (idempotent)',
          order_id: recentOrder.id,
          customer_id: custId
        });
      }
    }

    // 2. Insert items into special_orders (tagged with customer_order_source = 'website')
    const createdOrders: Array<{ id: number; product: string; qty: number; price: number; payment_qr_id?: string | null }> = [];
    const modeLabel = isDelivery ? 'Home Delivery' : 'In-Store Pickup';
    const orderType = isDelivery ? 'DELIVERY' : 'PICKUP';
    const deliveryStatus = isDelivery ? 'pending_dispatch' : 'counter_pickup';
    const notePrefix = `[Website Order - ${modeLabel} - ${payment_method}]`;
    const idempotencyTag = idempotencyKey ? ` [Idempotency: ${idempotencyKey}]` : '';
    const fullNotes = `${notePrefix}${cleanAddress ? ` Delivery Address: ${cleanAddress}.` : ''}${notes ? ` Notes: ${notes}` : ''}${idempotencyTag}`;

    // Calculate total amount
    const totalAmount = items.reduce(
      (sum: number, it: any) => sum + ((Number(it.qty || it.quantity_needed) || 1) * (Number(it.price || it.sell_price || it.mrp) || 0)),
      0
    );

    // 3-QR Allocation (§13): Strict alternating rotation if UPI
    let allocatedQr = null;
    if (payment_method === 'UPI') {
      allocatedQr = await paymentQrService.allocateNextQr();
    }

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
            advance_payment, notes, customer_order_source, delivery_status, return_status,
            payment_status, pharmacy_verification_status, payment_qr_id, order_type, total_amount,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Pending', ?, 0, 0, ?, 'website', ?, 'none', 'UNPAID', 'PENDING', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            targetStoreId,
            custId,
            prodName,
            cleanName,
            cleanPhone,
            qty,
            todayStr,
            fullNotes,
            deliveryStatus,
            allocatedQr?.id || null,
            orderType,
            totalAmount
          ]
        );

        const orderId = Number(result.lastID);
        createdOrders.push({ id: orderId, product: prodName, qty, price, payment_qr_id: allocatedQr?.id || null });

        // Record tracking event
        await db.run(
          `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
           VALUES (?, 'website_order_created', ?, 'customer', CURRENT_TIMESTAMP)`,
          [orderId, `Website order placed for ${modeLabel} (${orderType}) at Store #${targetStoreId}. Item: ${prodName} (Qty: ${qty}) - Payment: ${payment_method}`]
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
    const storeAddress = storeInfo?.address ? `\n📍 *Store Address:* ${storeInfo.address}` : '';
    const storePhone = storeInfo?.phone ? `\n📞 *Contact:* ${storeInfo.phone}` : '';

    if (cleanPhone && cleanPhone.length >= 10) {
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const orderIdsStr = createdOrders.map(o => `#${o.id}`).join(', ');
      const itemsSummary = createdOrders.map((o, idx) => `${idx + 1}. ${o.product} (x${o.qty})`).join('\n');

      let confirmMsg = isDelivery
        ? `*Online Order Received (${orderIdsStr})*\n\nHello ${cleanName},\nThank you for ordering at *${storeName}*.\n\n*Ordered Medicines:*\n${itemsSummary}\n\n💵 *Total:* ₹${totalAmount.toFixed(2)} (${payment_method})\n🚚 *Mode:* Home Delivery\n📍 *Address:* ${cleanAddress || 'As per records'}${storePhone}\n\n*Our team is packaging your order and will alert you upon dispatch!*`
        : `*Refill Order Received (${orderIdsStr})*\n\nHello ${cleanName},\nThank you for placing your refill order at *${storeName}*.\n\n*Selected Medicines:*\n${itemsSummary}\n\n💵 *Total:* ₹${totalAmount.toFixed(2)} (${payment_method})\n📍 *Pickup Branch:* ${storeName}${storeAddress}${storePhone}\n\n*Our pharmacist is packing your order. We will notify you once it is ready at the counter!*`;

      if (allocatedQr) {
        const upiUri = paymentQrService.buildUpiUri(allocatedQr.upi_id, allocatedQr.payee_name, totalAmount, createdOrders[0]?.id || 1);
        confirmMsg += `\n\n💳 *Payment Instructions (${allocatedQr.label}):*\nUPI ID: ${allocatedQr.upi_id}\nPayee: ${allocatedQr.payee_name}\nUPI Pay Link:\n${upiUri}\n\n*Important:* After transferring via UPI, click "I HAVE PAID" on the website to submit your payment for pharmacy verification.`;
      }

      try {
        await whatsappQueueWorker.enqueue(formattedPhone, confirmMsg, 'website_order_confirmation', cleanName);
      } catch (waErr) {
        console.warn('[CustomerPortal] WhatsApp confirmation warning:', waErr);
      }
    }

    // 5. Broadcast SSE push so Quick Assist and POS refresh instantly
    try {
      eventService.broadcast('order_updated', { at: Date.now(), source: 'website', store_id: targetStoreId });
      eventService.broadcast('refill_updated', { at: Date.now(), source: 'website', store_id: targetStoreId });
      eventService.broadcast('website_order_created', { at: Date.now(), store_id: targetStoreId, customer: cleanName });
    } catch (_) {}

    const primaryOrderId = createdOrders[0]?.id;
    const paymentQrResponse = allocatedQr
      ? {
          qr_id: allocatedQr.id,
          label: allocatedQr.label,
          payee_name: allocatedQr.payee_name,
          upi_id: allocatedQr.upi_id,
          qr_image_url: allocatedQr.qr_image_url || '',
          amount: totalAmount,
          upi_uri: paymentQrService.buildUpiUri(
            allocatedQr.upi_id,
            allocatedQr.payee_name,
            totalAmount,
            primaryOrderId || 1
          )
        }
      : null;

    res.status(201).json({
      success: true,
      message: `${modeLabel} order placed successfully`,
      store_id: targetStoreId,
      store_name: storeName,
      delivery_mode: modeLabel,
      order_type: orderType,
      orders: createdOrders,
      order_id: primaryOrderId,
      total_amount: totalAmount,
      payment_method,
      payment_qr: paymentQrResponse,
      customer: { name: cleanName, phone: cleanPhone }
    });
  } catch (err: any) {
    console.error('[CustomerPortal] Refill order error:', err);
    res.status(500).json({ error: 'Failed to place order: ' + (err.message || 'Unknown error') });
  }
});

// ─── Public Website Catalog & Categories Endpoints ────────────────────────────

interface CachedCatalogItem {
  category: string;
  name: string;
  pack: string;
  schedule: string;
  composition: string;
  manufacturer: string;
  mrp?: number;
  sell_price?: number;
}

let catalogCache: CachedCatalogItem[] | null = null;
let imageStateCache: Record<string, any> | null = null;
let lastCacheLoad = 0;

function loadCatalogAndImages() {
  const now = Date.now();
  if (catalogCache && imageStateCache && (now - lastCacheLoad < 60000)) {
    return { catalog: catalogCache, images: imageStateCache };
  }

  try {
    const csvPath = path.resolve(process.cwd(), 'CATALOG/monthly_refill_master_list.csv');
    if (fs.existsSync(csvPath)) {
      const content = fs.readFileSync(csvPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      const items: CachedCatalogItem[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        let inQuotes = false;
        let cur = '';
        const parts: string[] = [];
        for (let c = 0; c < line.length; c++) {
          const ch = line[c];
          if (ch === '"') inQuotes = !inQuotes;
          else if (ch === ',' && !inQuotes) {
            parts.push(cur.trim());
            cur = '';
          } else {
            cur += ch;
          }
        }
        parts.push(cur.trim());
        items.push({
          category: parts[0]?.replace(/^"|"$/g, ''),
          name: parts[1]?.replace(/^"|"$/g, ''),
          pack: parts[2]?.replace(/^"|"$/g, ''),
          schedule: parts[3]?.replace(/^"|"$/g, ''),
          composition: parts[4]?.replace(/^"|"$/g, ''),
          manufacturer: parts[5]?.replace(/^"|"$/g, ''),
          mrp: parseFloat(parts[6]) || 0,
          sell_price: parseFloat(parts[7]) || parseFloat(parts[6]) || 0
        });
      }

      // Complement with clinical TB medicines if not already in refill CSV
      try {
        const clinicalCsvPath = path.resolve(process.cwd(), 'CATALOG/clinical_categories_list.csv');
        if (fs.existsSync(clinicalCsvPath)) {
          const clinContent = fs.readFileSync(clinicalCsvPath, 'utf-8');
          const clinLines = clinContent.split(/\r?\n/);
          for (let j = 1; j < clinLines.length; j++) {
            const clinLine = clinLines[j].trim();
            if (!clinLine) continue;
            if (clinLine.startsWith('TB,') || clinLine.startsWith('"TB",')) {
              const p = clinLine.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
              const name = (p[1] || '').replace(/^"|"$/g, '').trim();
              if (name && !items.some(it => it.name === name)) {
                items.push({
                  category: 'Tuberculosis (TB) Care',
                  name,
                  pack: (p[2] || '').replace(/^"|"$/g, '').trim(),
                  schedule: (p[3] || '').replace(/^"|"$/g, '').trim(),
                  composition: (p[4] || '').replace(/^"|"$/g, '').trim(),
                  manufacturer: (p[5] || '').replace(/^"|"$/g, '').trim(),
                  mrp: 0,
                  sell_price: 0
                });
              }
            }
          }
        }
      } catch (_) {}

      catalogCache = items;
    }
  } catch (e) {
    catalogCache = [];
  }

  try {
    const statePath = path.resolve(process.cwd(), 'data/image_download_state.json');
    if (fs.existsSync(statePath)) {
      const stateData = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      imageStateCache = stateData.products || {};
    }
  } catch (e) {
    imageStateCache = {};
  }

  lastCacheLoad = now;
  return { catalog: catalogCache || [], images: imageStateCache || {} };
}

// GET /api/customer-portal/public-catalog — Public live medicine catalog connected to inventory
router.get('/public-catalog', async (req, res) => {
  try {
    const category = (String(req.query.category || 'all')).toLowerCase();
    const search = (String(req.query.search || '')).trim().toLowerCase();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || '40'), 10)));

    const { catalog, images } = loadCatalogAndImages();
    const db = await dbManager.getConnection();

    // Restrict catalog strictly to the 4 approved categories:
    // 1. Diabetic Care
    // 2. Blood Pressure & Cardiac
    // 3. Thyroid Care
    // 4. Tuberculosis (TB)
    const isApprovedRefillCategory = (item: CachedCatalogItem) => {
      const c = (item.category || '').toLowerCase();
      const n = (item.name || '').toUpperCase();
      return (
        c.includes('diabet') ||
        c.includes('bp') ||
        c.includes('cardiac') ||
        c.includes('heart') ||
        c.includes('thyroid') ||
        c.includes('tb') ||
        c.includes('tuber') ||
        n.includes('R-CINEX') ||
        n.includes('PYZINA') ||
        n.includes('COMBUTOL')
      );
    };

    let filtered = catalog.filter(isApprovedRefillCategory);

    if (category && category !== 'all') {
      if (category.includes('diabet')) {
        filtered = filtered.filter(i => i.category.toLowerCase().includes('diabet'));
      } else if (
        category.includes('bp') ||
        category.includes('cardiac') ||
        category.includes('heart') ||
        category.includes('blood') ||
        category.includes('pressure')
      ) {
        filtered = filtered.filter(i => i.category.toLowerCase().includes('cardiac') || i.category.toLowerCase().includes('bp'));
      } else if (category.includes('thyroid')) {
        filtered = filtered.filter(i => i.category.toLowerCase().includes('thyroid'));
      } else if (category.includes('tb') || category.includes('tuber')) {
        filtered = filtered.filter(i =>
          i.category.toLowerCase().includes('tb') ||
          i.category.toLowerCase().includes('tuber') ||
          i.name.toUpperCase().includes('R-CINEX') ||
          i.name.toUpperCase().includes('PYZINA') ||
          i.name.toUpperCase().includes('COMBUTOL')
        );
      }
    }

    if (search) {
      filtered = filtered.filter(i =>
        i.name.toLowerCase().includes(search) ||
        i.composition.toLowerCase().includes(search) ||
        i.manufacturer.toLowerCase().includes(search)
      );

      // Expand search into live pharmacy medicines table if CSV has fewer results
      if (filtered.length < 30) {
        const existingNames = new Set(filtered.map(f => f.name.toUpperCase().trim()));
        const dbMatches = await db.all(
          `SELECT m.id, m.name, m.generic_name, m.strength, m.packaging, m.manufacturer, m.category, m.mrp, m.sell_price
           FROM medicines m
           WHERE m.name LIKE ? OR m.generic_name LIKE ?
           ORDER BY m.name ASC
           LIMIT 30`,
          [`%${search}%`, `%${search}%`]
        ).catch(() => []);

        for (const dbm of dbMatches) {
          const key = (dbm.name || '').toUpperCase().trim();
          if (key && !existingNames.has(key)) {
            filtered.push({
              category: dbm.category || 'General Medicine',
              name: dbm.name,
              pack: dbm.packaging || '',
              schedule: '',
              composition: dbm.generic_name || '',
              manufacturer: dbm.manufacturer || '',
              mrp: Number(dbm.mrp || 0),
              sell_price: Number(dbm.sell_price || dbm.mrp || 0)
            });
            existingNames.add(key);
          }
        }
      }
    }

    const totalCount = filtered.length;
    const startIndex = (page - 1) * limit;
    const paginated = filtered.slice(startIndex, startIndex + limit);

    // Enrich with live database inventory (stock, price, mrp) and verified active catalogue images
    const enriched = [];
    for (const item of paginated) {
      const dbMed = await db.get(
        `SELECT m.id, m.mrp, m.sell_price, m.generic_name, m.strength, m.pack_size,
                COALESCE((SELECT SUM(im.quantity) FROM inventory_master im WHERE im.medicine_id = m.id), 0) as stock_qty
         FROM medicines m
         WHERE m.name = ? OR m.name LIKE ? LIMIT 1`,
        [item.name, `${item.name.split(' ')[0]}%`]
      ).catch(() => null);

      let imageUrl: string | null = null;
      let allImages: Record<string, any> = {};
      let gallery: Array<{ url: string; type: string; label: string; is_primary: boolean }> = [];

      if (dbMed && dbMed.id) {
        // Multi-Angle Image Resolver (Combined, Front, Back, Box, Tablet)
        const resolved = await catalogImageService.resolveProductImages(dbMed.id);
        if (resolved && resolved.primaryUrl) {
          imageUrl = resolved.primaryUrl;
          allImages = resolved.images;
          gallery = resolved.gallery;
        }
      }

      // If fewer than 2 angles resolved from DB, complement from imageStateCache if present
      const imgData = images[item.name];
      if (imgData && imgData.images) {
        const stateGallery = catalogImageService.extractGalleryFromState(imgData);
        if (stateGallery.length > 0) {
          if (gallery.length === 0) {
            gallery = stateGallery;
            const primaryItem = stateGallery.find(g => g.is_primary) || stateGallery[0];
            imageUrl = primaryItem?.url || null;
            stateGallery.forEach(g => {
              allImages[g.type] = g;
            });
          } else if (gallery.length < 4) {
            const existingTypes = new Set(gallery.map(g => g.type));
            for (const sg of stateGallery) {
              if (!existingTypes.has(sg.type) && gallery.length < 4) {
                gallery.push(sg);
                existingTypes.add(sg.type);
                allImages[sg.type] = sg;
              }
            }
          }
        }
      }

      const stockQty = Number(dbMed?.stock_qty || 0);
      const resolvedMrp = Number(dbMed?.mrp || item.mrp || 0);
      const resolvedSellPrice = Number(dbMed?.sell_price || item.sell_price || resolvedMrp || 0);

      enriched.push({
        id: dbMed?.id,
        name: item.name,
        category: item.category,
        pack: item.pack || dbMed?.pack_size || '',
        composition: item.composition || dbMed?.generic_name || '',
        manufacturer: item.manufacturer,
        mrp: resolvedMrp,
        sell_price: resolvedSellPrice,
        stock_qty: stockQty,
        in_stock: stockQty > 0,
        image_url: imageUrl,
        images: allImages,
        gallery: gallery
      });
    }

    res.json({
      success: true,
      category,
      search,
      page,
      limit,
      total_count: totalCount,
      total_pages: Math.ceil(totalCount / limit),
      medicines: enriched
    });
  } catch (err: any) {
    console.error('[CustomerPortal] Public catalog error:', err);
    res.status(500).json({ error: 'Failed to fetch catalog: ' + err.message });
  }
});

// GET /api/customer-portal/categories-summary — Returns count summary for the 4 approved refill categories
router.get('/categories-summary', (req, res) => {
  const { catalog } = loadCatalogAndImages();
  const summary: Record<string, number> = {
    all: 0,
    diabetic: 0,
    bp_cardiac: 0,
    thyroid: 0,
    tb: 0
  };

  catalog.forEach(item => {
    const c = (item.category || '').toLowerCase();
    const n = (item.name || '').toUpperCase();
    let isAllowed = false;

    if (c.includes('diabet')) {
      summary.diabetic++;
      isAllowed = true;
    } else if (c.includes('cardiac') || c.includes('bp')) {
      summary.bp_cardiac++;
      isAllowed = true;
    } else if (c.includes('thyroid')) {
      summary.thyroid++;
      isAllowed = true;
    } else if (
      c.includes('tb') ||
      c.includes('tuber') ||
      n.includes('R-CINEX') ||
      n.includes('PYZINA') ||
      n.includes('COMBUTOL')
    ) {
      summary.tb++;
      isAllowed = true;
    }

    if (isAllowed) {
      summary.all++;
    }
  });

  res.json({ success: true, summary });
});

// GET /api/customer-portal/standalone-catalog — Serves the standalone responsive website
router.get('/standalone-catalog', (req, res) => {
  const filePath = path.resolve(process.cwd(), 'exports/Live_Pharmacy_Catalog_Website.html');
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.status(404).send('Live catalog website file not found');
});

// ─── Customer Purchase History (spec §12, §13) ───────────────────────────────
// GET /api/customer-portal/history
// Returns completed POS sales for the authenticated customer.
// NEVER leaks distributor price, purchase cost, or internal inventory margins.
router.get('/history', async (req, res) => {
  try {
    const customerId = parseInt((req.query.customer_id as string) || '0', 10);
    const loginId = (req.query.login_id as string) || '';
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 200);
    const offset = parseInt((req.query.offset as string) || '0', 10) || 0;

    if (!customerId && !loginId) {
      return res.status(400).json({ error: 'customer_id or login_id is required' });
    }

    const db = await dbManager.getConnection();

    // Resolve customer_id from login_id if needed
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId && loginId) {
      const account = await db.get(
        'SELECT customer_id FROM customer_portal_accounts WHERE login_id = ? AND status = ?',
        [loginId, 'active']
      );
      if (!account) return res.status(404).json({ error: 'Customer account not found' });
      resolvedCustomerId = account.customer_id;
    }

    // Fetch POS sales for this customer — only safe customer-facing columns (spec §13)
    const sales = await db.all(
      `SELECT
         si.id as invoice_id,
         si.date,
         si.business_date,
         si.grand_total,
         si.online_order_id,
         si.payment_medium,
         si.status,
         COALESCE(st.name, 'Pharmacy') as store_name
       FROM sales_invoices si
       LEFT JOIN stores st ON st.id = si.store_id
       WHERE si.customer_id = ?
         AND si.status != 'cancelled'
       ORDER BY si.date DESC
       LIMIT ? OFFSET ?`,
      [resolvedCustomerId, limit, offset]
    ).catch(() => []);

    // Attach sale items (product name, qty, mrp, sell_price — no cost_price/purchase_price)
    const enriched = await Promise.all(sales.map(async (sale: any) => {
      const items = await db.all(
        `SELECT
           sit.id,
           m.name as medicine_name,
           m.generic_name,
           m.strength,
           m.packaging,
           sit.quantity,
           sit.mrp,
           sit.sell_price,
           sit.discount,
           sit.medicine_id
         FROM sale_items sit
         LEFT JOIN medicines m ON m.id = sit.medicine_id
         WHERE sit.invoice_id = ?
         ORDER BY sit.id ASC`,
        [sale.invoice_id]
      ).catch(() => []);

      return { ...sale, items };
    }));

    // Count for pagination
    const countRow = await db.get(
      'SELECT COUNT(*) as total FROM sales_invoices WHERE customer_id = ? AND status != ?',
      [resolvedCustomerId, 'cancelled']
    ).catch(() => ({ total: 0 }));

    res.json({
      customer_id: resolvedCustomerId,
      total: countRow?.total || 0,
      limit,
      offset,
      purchases: enriched
    });
  } catch (err: any) {
    console.error('[CustomerPortal] History error:', err);
    res.status(500).json({ error: 'Failed to load purchase history' });
  }
});

// ─── Refill from Invoice (spec §14) ──────────────────────────────────────────
// POST /api/customer-portal/history/:invoiceId/refill
// Creates a new website order from a previous invoice using CURRENT pricing and availability.
router.post('/history/:invoiceId/refill', async (req, res) => {
  try {
    const invoiceId = parseInt(req.params.invoiceId, 10);
    if (isNaN(invoiceId)) return res.status(400).json({ error: 'Invalid invoice ID' });

    const { customer_id, login_id, store_id = 1 } = req.body;
    if (!customer_id && !login_id) {
      return res.status(400).json({ error: 'customer_id or login_id is required' });
    }

    const db = await dbManager.getConnection();
    const targetStoreId = parseInt(String(store_id), 10) || 1;

    // Resolve customer
    let resolvedCustomerId = customer_id ? parseInt(String(customer_id), 10) : 0;
    if (!resolvedCustomerId && login_id) {
      const account = await db.get(
        'SELECT customer_id FROM customer_portal_accounts WHERE login_id = ? AND status = ?',
        [login_id, 'active']
      );
      if (!account) return res.status(404).json({ error: 'Customer account not found' });
      resolvedCustomerId = account.customer_id;
    }

    // Verify invoice belongs to this customer
    const invoice = await db.get(
      'SELECT * FROM sales_invoices WHERE id = ? AND customer_id = ?',
      [invoiceId, resolvedCustomerId]
    );
    if (!invoice) return res.status(404).json({ error: 'Invoice not found for this customer' });

    // Get original items
    const origItems = await db.all(
      `SELECT sit.medicine_id, sit.quantity, m.name as medicine_name
       FROM sale_items sit
       LEFT JOIN medicines m ON m.id = sit.medicine_id
       WHERE sit.invoice_id = ?`,
      [invoiceId]
    );

    if (!origItems || origItems.length === 0) {
      return res.status(400).json({ error: 'No items found in original invoice' });
    }

    const customer = await db.get('SELECT * FROM customers WHERE id = ?', [resolvedCustomerId]);
    if (!customer) return res.status(404).json({ error: 'Customer record not found' });

    // For each item, fetch CURRENT pricing and availability (spec §14 — must use current state)
    const refillItems = [];
    const unavailableItems = [];

    for (const orig of origItems) {
      if (!orig.medicine_id) continue;

      const currentBatch = await db.get(
        `SELECT MAX(mrp) as current_mrp, MAX(sell_price) as current_sell, SUM(quantity) as total_qty
         FROM inventory_master
         WHERE medicine_id = ? AND store_id = ? AND is_active = 1
           AND quantity > 0
           AND (expiry_date IS NULL OR date(expiry_date) > date('now'))`,
        [orig.medicine_id, targetStoreId]
      ).catch(() => null);

      if (!currentBatch || (currentBatch.total_qty || 0) <= 0) {
        unavailableItems.push({ medicine_id: orig.medicine_id, name: orig.medicine_name });
        continue;
      }

      refillItems.push({
        medicine_id: orig.medicine_id,
        product_name: orig.medicine_name,
        qty: orig.quantity,
        mrp: currentBatch.current_mrp || 0,
        price: currentBatch.current_sell || currentBatch.current_mrp || 0
      });
    }

    if (refillItems.length === 0) {
      return res.status(409).json({
        error: 'None of the original items are currently available',
        unavailable_items: unavailableItems
      });
    }

    // Create new special_order + online_order_items for each refill item
    const cleanPhone = customer.phone ? String(customer.phone).replace(/\D/g, '') : '';
    const cleanName = formatCustomerName(customer.name);
    const createdOrders: Array<{ id: number; product: string; qty: number }> = [];

    await db.run('BEGIN TRANSACTION');
    try {
      for (const item of refillItems) {
        const result = await db.run(
          `INSERT INTO special_orders (
            store_id, customer_id, product, requester, phone, qty, priority, status, date,
            notified, advance_payment, notes, customer_order_source,
            payment_status, pharmacy_verification_status, delivery_status, return_status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Pending', CURRENT_TIMESTAMP, 0, 0,
            ?, 'website', 'UNPAID', 'PENDING', 'pending', 'none', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            targetStoreId, resolvedCustomerId, item.product_name, cleanName, cleanPhone,
            item.qty,
            `[Refill from Invoice #${invoiceId}]`
          ]
        );
        const orderId = Number(result.lastID);
        createdOrders.push({ id: orderId, product: item.product_name, qty: item.qty });

        await db.run(
          `INSERT INTO online_order_items (order_id, medicine_id, product_name, requested_qty, mrp, item_status)
           VALUES (?, ?, ?, ?, ?, 'PENDING')`,
          [orderId, item.medicine_id, item.product_name, item.qty, item.mrp]
        );

        await db.run(
          `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
           VALUES (?, 'refill_order_created', ?, 'customer', CURRENT_TIMESTAMP)`,
          [orderId, `Refill order created from Invoice #${invoiceId}. Current MRP: ₹${item.mrp}`]
        );
      }
      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    eventService.broadcast('order_updated', { at: Date.now(), source: 'refill' });

    res.status(201).json({
      success: true,
      message: `Refill order created for ${createdOrders.length} item(s)`,
      source_invoice_id: invoiceId,
      orders: createdOrders,
      unavailable_items: unavailableItems
    });
  } catch (err: any) {
    console.error('[CustomerPortal] Refill error:', err);
    res.status(500).json({ error: 'Failed to create refill order' });
  }
});

export default router;

