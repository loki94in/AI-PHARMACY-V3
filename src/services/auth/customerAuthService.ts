import crypto from 'crypto';
import { dbManager } from '../../database/connection.js';
import { whatsappQueueWorker } from '../whatsappQueueWorker.js';
import { logger } from '../../utils/logger.js';
import { formatCustomerName } from '../../utils/nameFormatter.js';
import { getStoreMedicalName } from '../storeSettingsService.js';

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

export interface CustomerAuthPayload {
  customerId: number;
  phone: string;
  name: string;
  loginId: string;
  preferredStoreId: number;
}

class CustomerAuthService {
  /**
   * Create an HMAC-signed token and store session in customer_sessions
   */
  async createSession(customerId: number, phone: string, channel = 'portal', reqMetadata?: { ip?: string; userAgent?: string }): Promise<string> {
    const payload = `${customerId}:${phone}:${Date.now()}`;
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    const token = Buffer.from(`${payload}:${signature}`).toString('base64');

    try {
      const db = await dbManager.getConnection();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
      await db.run(
        `INSERT INTO customer_sessions (
           customer_id, phone, session_token, channel, device_info, ip_address,
           logged_in_at, last_active_at, duration_seconds, is_active, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 1, ?)`,
        [
          customerId,
          phone,
          token,
          channel,
          reqMetadata?.userAgent || null,
          reqMetadata?.ip || null,
          expiresAt
        ]
      );
    } catch (err) {
      logger.warn('Failed to record customer session in DB', { module: 'CustomerAuthService', error: err });
    }

    return token;
  }

  /**
   * Verify customer session token
   */
  async verifySession(tokenStr: string): Promise<{ customerId: number; phone: string } | null> {
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

  /**
   * Request OTP for customer mobile login - strictly for existing CRM patients
   */
  async requestOtp(phoneRaw: string): Promise<{ success: boolean; message: string; debugOtp?: string }> {
    const phone = normalizePhone(phoneRaw);
    if (!phone || phone.length < 10) {
      throw new Error('Valid 10-digit mobile number is required');
    }

    const db = await dbManager.getConnection();

    // 1. Locate existing customer in CRM / pharmacy database
    const customer = await db.get(
      `SELECT id, name, phone FROM customers WHERE phone LIKE ? OR phone = ? LIMIT 1`,
      [`%${phone}%`, phone]
    );

    if (!customer) {
      throw new Error('This mobile number is not registered in pharmacy records. Please contact the pharmacy to register.');
    }

    // 2. Ensure customer_portal_accounts entry exists for this registered customer
    const loginId = phone;
    let account = await db.get(
      `SELECT id, customer_id, login_id FROM customer_portal_accounts WHERE customer_id = ? OR login_id = ?`,
      [customer.id, loginId]
    );

    if (!account) {
      const pin = generateRandomPin();
      const pHash = hashPin(pin);
      await db.run(
        `INSERT INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display, preferred_store_id, status)
         VALUES (?, ?, ?, ?, 1, 'active')`,
        [customer.id, loginId, pHash, pin]
      );
    }

    // 3. Invalidate previous pending OTPs
    await db.run(
      `UPDATE customer_portal_otps SET is_used = 1 WHERE login_id = ? AND is_used = 0`,
      [loginId]
    );

    // 4. Generate & store new OTP
    const otp = generateRandomOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    await db.run(
      `INSERT INTO customer_portal_otps (login_id, otp_code, expires_at, is_used)
       VALUES (?, ?, ?, 0)`,
      [loginId, otp, expiresAt]
    );

    // 5. Send OTP via WhatsApp
    try {
      const storeName = await getStoreMedicalName(db, 1) || 'Your Pharmacy';
      const msgText = `*${storeName} Portal Login*\n\nYour One-Time Password (OTP) is: *${otp}*\n\nValid for 10 minutes. Do not share this OTP with anyone.`;

      await whatsappQueueWorker.enqueue(
        `91${phone}`,
        msgText,
        'portal_otp',
        customer?.name || 'Customer'
      );
      logger.info(`OTP queued for 91${phone}`, { module: 'CustomerAuthService', operation: 'requestOtp' });
    } catch (msgErr) {
      logger.warn('Failed to queue WhatsApp OTP, continuing', { module: 'CustomerAuthService', error: msgErr });
    }

    return {
      success: true,
      message: 'OTP sent to your WhatsApp number',
      debugOtp: process.env.NODE_ENV !== 'production' ? otp : undefined
    };
  }

  /**
   * Verify OTP and log customer in
   */
  async verifyOtp(phoneRaw: string, otpCode: string, reqMetadata?: { ip?: string; userAgent?: string }) {
    const phone = normalizePhone(phoneRaw);
    const otp = (otpCode || '').trim();

    if (!phone || !otp) {
      throw new Error('Phone and OTP code are required');
    }

    const db = await dbManager.getConnection();
    const loginId = phone;

    // Verify OTP
    const now = new Date().toISOString();
    const otpRecord = await db.get(
      `SELECT * FROM customer_portal_otps 
       WHERE login_id = ? AND otp_code = ? AND is_used = 0 AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      [loginId, otp, now]
    );

    if (!otpRecord) {
      throw new Error('Invalid or expired OTP');
    }

    // Mark OTP used
    await db.run(`UPDATE customer_portal_otps SET is_used = 1 WHERE id = ?`, [otpRecord.id]);

    // Find account
    const account = await db.get(
      `SELECT pa.*, c.name, c.phone, c.address, s.name as store_name
       FROM customer_portal_accounts pa
       JOIN customers c ON c.id = pa.customer_id
       LEFT JOIN stores s ON s.id = pa.preferred_store_id
       WHERE pa.login_id = ? OR c.phone LIKE ?`,
      [loginId, `%${phone}%`]
    );

    if (!account) {
      throw new Error('Customer account not found');
    }

    if (account.status === 'blocked') {
      throw new Error('Your account is inactive or blocked. Please contact pharmacy staff.');
    }

    // Update last login and increment total login count
    await db.run(
      `UPDATE customer_portal_accounts 
       SET last_login_at = CURRENT_TIMESTAMP,
           total_login_count = COALESCE(total_login_count, 0) + 1 
       WHERE id = ?`,
      [account.id]
    );

    const token = await this.createSession(account.customer_id, phone, 'portal', reqMetadata);

    return {
      token,
      customer: {
        id: account.customer_id,
        name: formatCustomerName(account.name || 'Customer'),
        phone: account.phone || phone,
        address: account.address || '',
        loginId: account.login_id,
        preferredStoreId: account.preferred_store_id || 1,
        storeName: account.store_name || 'Main Pharmacy'
      },
      features: {
        bills: true,
        refills: true,
        orders: true,
        catalog: true,
        prescriptions: true
      }
    };
  }

  /**
   * Login with Login ID + PIN
   */
  async loginWithPin(loginIdRaw: string, pinRaw: string, reqMetadata?: { ip?: string; userAgent?: string }) {
    const loginId = (loginIdRaw || '').trim();
    const pin = (pinRaw || '').trim();

    if (!loginId || !pin) {
      throw new Error('Login ID and PIN are required');
    }

    const db = await dbManager.getConnection();
    const cleanPhone = normalizePhone(loginId);

    const account = await db.get(
      `SELECT pa.*, c.name, c.phone, c.address, s.name as store_name
       FROM customer_portal_accounts pa
       JOIN customers c ON c.id = pa.customer_id
       LEFT JOIN stores s ON s.id = pa.preferred_store_id
       WHERE pa.login_id = ? OR c.phone = ? OR c.phone LIKE ?`,
      [loginId, cleanPhone, `%${cleanPhone}%`]
    );

    if (!account) {
      throw new Error('Invalid Login ID or PIN');
    }

    if (account.status === 'blocked') {
      throw new Error('Your account is inactive or blocked. Please contact pharmacy staff.');
    }

    const hashedInput = hashPin(pin);
    if (hashedInput !== account.pin_hash && pin !== account.pin_display) {
      throw new Error('Invalid Login ID or PIN');
    }

    // Update last login and increment total login count
    await db.run(
      `UPDATE customer_portal_accounts 
       SET last_login_at = CURRENT_TIMESTAMP,
           total_login_count = COALESCE(total_login_count, 0) + 1 
       WHERE id = ?`,
      [account.id]
    );

    const phone = account.phone || cleanPhone;
    const token = await this.createSession(account.customer_id, phone, 'portal', reqMetadata);

    return {
      token,
      customer: {
        id: account.customer_id,
        name: formatCustomerName(account.name || 'Customer'),
        phone,
        address: account.address || '',
        loginId: account.login_id,
        preferredStoreId: account.preferred_store_id || 1,
        storeName: account.store_name || 'Main Pharmacy'
      },
      features: {
        bills: true,
        refills: true,
        orders: true,
        catalog: true,
        prescriptions: true
      }
    };
  }

  /**
   * Heartbeat to track active presence and calculate session duration
   */
  async recordHeartbeat(sessionToken: string): Promise<{ success: boolean; durationSeconds: number }> {
    try {
      const db = await dbManager.getConnection();
      const session = await db.get(
        `SELECT id, customer_id, logged_in_at FROM customer_sessions 
         WHERE session_token = ? AND is_active = 1 LIMIT 1`,
        [sessionToken]
      );

      if (!session) return { success: false, durationSeconds: 0 };

      // Calculate elapsed seconds from logged_in_at to now
      const loggedInTime = new Date(session.logged_in_at).getTime();
      const now = Date.now();
      const durationSeconds = Math.max(0, Math.floor((now - loggedInTime) / 1000));

      await db.run(
        `UPDATE customer_sessions 
         SET last_active_at = CURRENT_TIMESTAMP,
             duration_seconds = ?
         WHERE id = ?`,
        [durationSeconds, session.id]
      );

      // Keep cumulative total_time_spent_seconds updated in customer_portal_accounts
      await db.run(
        `UPDATE customer_portal_accounts 
         SET total_time_spent_seconds = COALESCE(total_time_spent_seconds, 0) + 30
         WHERE customer_id = ?`,
        [session.customer_id]
      );

      return { success: true, durationSeconds };
    } catch (err) {
      logger.warn('Heartbeat update failed', { module: 'CustomerAuthService', error: err });
      return { success: false, durationSeconds: 0 };
    }
  }

  /**
   * Terminate session on explicit customer logout and finalize duration
   */
  async logoutSession(sessionToken: string): Promise<{ success: boolean; durationSeconds: number }> {
    try {
      const db = await dbManager.getConnection();
      const session = await db.get(
        `SELECT id, customer_id, logged_in_at FROM customer_sessions 
         WHERE session_token = ? AND is_active = 1 LIMIT 1`,
        [sessionToken]
      );

      if (!session) return { success: false, durationSeconds: 0 };

      const loggedInTime = new Date(session.logged_in_at).getTime();
      const now = Date.now();
      const durationSeconds = Math.max(0, Math.floor((now - loggedInTime) / 1000));

      await db.run(
        `UPDATE customer_sessions 
         SET is_active = 0,
             logged_out_at = CURRENT_TIMESTAMP,
             duration_seconds = ?,
             last_active_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [durationSeconds, session.id]
      );

      await db.run(
        `UPDATE customer_portal_accounts 
         SET last_logout_at = CURRENT_TIMESTAMP
         WHERE customer_id = ?`,
        [session.customer_id]
      );

      logger.info(`Session logged out (duration: ${durationSeconds}s)`, {
        module: 'CustomerAuthService',
        operation: 'logoutSession',
        customerId: session.customer_id
      });

      return { success: true, durationSeconds };
    } catch (err) {
      logger.error('Logout session failed', err, { module: 'CustomerAuthService' });
      return { success: false, durationSeconds: 0 };
    }
  }

  /**
   * Get customer session history for CRM auditing
   */
  async getCustomerSessions(customerId: number) {
    const db = await dbManager.getConnection();
    const account = await db.get(
      `SELECT total_login_count, total_time_spent_seconds, last_login_at, last_logout_at
       FROM customer_portal_accounts WHERE customer_id = ?`,
      [customerId]
    );

    const sessions = await db.all(
      `SELECT id, channel, device_info, ip_address, logged_in_at, last_active_at, logged_out_at, duration_seconds, is_active
       FROM customer_sessions
       WHERE customer_id = ?
       ORDER BY id DESC LIMIT 50`,
      [customerId]
    );

    return {
      stats: {
        totalLogins: account?.total_login_count || sessions.length,
        totalTimeSpentSeconds: account?.total_time_spent_seconds || 0,
        lastLoginAt: account?.last_login_at || null,
        lastLogoutAt: account?.last_logout_at || null,
        activeSessionsCount: sessions.filter((s: any) => s.is_active === 1).length
      },
      sessions
    };
  }
}

export const customerAuthService = new CustomerAuthService();
