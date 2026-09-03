import {
  normalizePhone,
  hashPin,
  generateRandomPin,
  generateRandomOtp,
  customerAuthService
} from '../src/services/auth/customerAuthService.js';
import { dbManager } from '../src/database/connection.js';

describe('CustomerAuthService', () => {
  beforeAll(async () => {
    const db = await dbManager.getConnection();
    await db.run(`
      CREATE TABLE IF NOT EXISTS customer_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        phone TEXT NOT NULL,
        session_token TEXT NOT NULL UNIQUE,
        channel TEXT DEFAULT 'portal',
        device_info TEXT,
        ip_address TEXT,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS customer_portal_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL UNIQUE,
        login_id TEXT NOT NULL UNIQUE,
        pin_hash TEXT NOT NULL,
        pin_display TEXT,
        preferred_store_id INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active',
        last_login_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS customer_portal_otps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login_id TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        is_used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        credit_balance REAL DEFAULT 0,
        credit_enabled INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  test('normalizes Indian phone numbers accurately', () => {
    expect(normalizePhone('919876543210')).toBe('9876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone('9876543210')).toBe('9876543210');
  });

  test('generates valid 4-digit PINs and 6-digit OTPs', () => {
    const pin = generateRandomPin();
    expect(pin).toHaveLength(4);
    expect(Number(pin)).toBeGreaterThanOrEqual(1000);
    expect(Number(pin)).toBeLessThanOrEqual(9999);

    const otp = generateRandomOtp();
    expect(otp).toHaveLength(6);
    expect(Number(otp)).toBeGreaterThanOrEqual(100000);
    expect(Number(otp)).toBeLessThanOrEqual(999999);
  });

  test('creates and verifies cryptographically signed session tokens', async () => {
    const customerId = 42;
    const phone = '9876543210';
    const token = await customerAuthService.createSession(customerId, phone, 'portal');

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const verified = await customerAuthService.verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified?.customerId).toBe(customerId);
    expect(verified?.phone).toBe(phone);

    // Tampered token fails
    const tampered = token.slice(0, -4) + 'AAAA';
    const invalid = await customerAuthService.verifySession(tampered);
    expect(invalid).toBeNull();
  });

  test('hashes PIN consistently', () => {
    const hash1 = hashPin('1234');
    const hash2 = hashPin('1234');
    const hashDifferent = hashPin('1235');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDifferent);
  });
});
