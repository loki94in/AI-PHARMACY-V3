/**
 * Owner Identity, Authentication & Replay Shield Gateway
 *
 * Provides authoritative backend identity resolution, role evaluation,
 * replay protection, and action idempotency locks across WhatsApp and App channels.
 */

import { dbManager } from '../../database/connection.js';
import { normalizePhoneDigits } from '../../utils/phoneValidation.js';

export type UserRole = 'owner' | 'staff' | 'customer' | 'guest';

export interface EvaluatedIdentity {
  role: UserRole;
  phone: string;
  isOwner: boolean;
  isStaff: boolean;
  customerId?: number;
  customerName?: string;
  userId?: number;
  username?: string;
}

const ADMIN_PHONE_SETTING_KEYS = [
  'owner_whatsapp_number',
  'admin_whatsapp_number',
  'admin_whatsapp',
  'shop_phone',
  'store_phone'
];

// In-memory nonce tracking for replay prevention (60s sliding window)
const seenNonces = new Map<string, number>();
const NONCE_TTL_MS = 60_000;

// Active action locks to prevent duplicate execution of the same proposal
const activeActionLocks = new Set<string>();

// High-impact action challenge codes (e.g. 4-digit PIN / OTP for sensitive actions)
interface PendingChallenge {
  code: string;
  phone: string;
  actionId: string;
  expiresAt: number;
}
const pendingChallenges = new Map<string, PendingChallenge>();

/**
 * Normalizes phone number to last 10 digits.
 */
function cleanPhoneDigits(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Periodically prunes expired nonces and challenges.
 */
function pruneExpiredEntries(): void {
  const now = Date.now();
  for (const [nonce, ts] of seenNonces.entries()) {
    if (now - ts > NONCE_TTL_MS) {
      seenNonces.delete(nonce);
    }
  }
  for (const [key, ch] of pendingChallenges.entries()) {
    if (now > ch.expiresAt) {
      pendingChallenges.delete(key);
    }
  }
}

/**
 * Evaluates sender identity against SQLite app_settings, pharmacy_users, and customers.
 */
export async function evaluateSenderIdentity(
  rawPhone: string,
  channel: 'whatsapp' | 'portal' | 'in_app' | 'staff_modal',
  dbOverride?: any
): Promise<EvaluatedIdentity> {
  const phone = cleanPhoneDigits(rawPhone);
  if (!phone) {
    return { role: 'guest', phone: '', isOwner: false, isStaff: false };
  }

  const db = dbOverride || (await dbManager.getConnection());

  // 1. Check Owner WhatsApp setting keys
  for (const key of ADMIN_PHONE_SETTING_KEYS) {
    try {
      const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
      if (row?.value) {
        const adminDigits = cleanPhoneDigits(row.value);
        if (adminDigits && adminDigits === phone) {
          return {
            role: 'owner',
            phone,
            isOwner: true,
            isStaff: true,
            username: 'Store Owner'
          };
        }
      }
    } catch (_) {}
  }

  // 2. Check pharmacy_users table (staff / owner users)
  try {
    const userRow = await db.get(
      `SELECT id, username, role FROM pharmacy_users 
       WHERE (phone LIKE ? OR phone = ?) AND is_active = 1 LIMIT 1`,
      [`%${phone}`, phone]
    );
    if (userRow) {
      const isOwnerRole = userRow.role === 'owner' || userRow.role === 'admin';
      return {
        role: isOwnerRole ? 'owner' : 'staff',
        phone,
        isOwner: isOwnerRole,
        isStaff: true,
        userId: userRow.id,
        username: userRow.username
      };
    }
  } catch (_) {}

  // 3. Check customers table
  try {
    const custRow = await db.get(
      `SELECT id, name FROM customers 
       WHERE (phone LIKE ? OR phone = ?) LIMIT 1`,
      [`%${phone}`, phone]
    );
    if (custRow) {
      return {
        role: 'customer',
        phone,
        isOwner: false,
        isStaff: false,
        customerId: custRow.id,
        customerName: custRow.name
      };
    }
  } catch (_) {}

  return {
    role: 'guest',
    phone,
    isOwner: false,
    isStaff: false
  };
}

/**
 * Replay Shield: Ensures a message or confirmation nonce has not been seen within TTL.
 * Returns true if fresh (allowed), false if replayed (blocked).
 */
export function checkAndRecordNonce(nonce: string, ttlMs: number = NONCE_TTL_MS): boolean {
  if (!nonce) return true;
  pruneExpiredEntries();

  const now = Date.now();
  const lastSeen = seenNonces.get(nonce);
  if (lastSeen && (now - lastSeen < ttlMs)) {
    return false; // Replay detected!
  }

  seenNonces.set(nonce, now);
  return true;
}

/**
 * Action Idempotency Lock: Ensures a proposed action is only executed once.
 * Returns true if lock acquired, false if already in progress or executed.
 */
export function acquireActionLock(proposalId: string): boolean {
  if (!proposalId) return false;
  if (activeActionLocks.has(proposalId)) {
    return false;
  }
  activeActionLocks.add(proposalId);
  return true;
}

/**
 * Releases action lock upon completion or rejection.
 */
export function releaseActionLock(proposalId: string): void {
  if (proposalId) {
    activeActionLocks.delete(proposalId);
  }
}

/**
 * Issues a 4-digit challenge code for sensitive consequential actions.
 */
export function issueOwnerChallenge(actionId: string, phone: string, ttlMs: number = 300_000): string {
  pruneExpiredEntries();
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const key = `${cleanPhoneDigits(phone)}:${actionId}`;
  pendingChallenges.set(key, {
    code,
    phone: cleanPhoneDigits(phone),
    actionId,
    expiresAt: Date.now() + ttlMs
  });
  return code;
}

/**
 * Verifies a challenge response from the owner.
 */
export function verifyOwnerChallenge(actionId: string, phone: string, responseCode: string): boolean {
  pruneExpiredEntries();
  const key = `${cleanPhoneDigits(phone)}:${actionId}`;
  const pending = pendingChallenges.get(key);
  if (!pending) return false;

  const valid = pending.code === responseCode.trim() && Date.now() <= pending.expiresAt;
  if (valid) {
    pendingChallenges.delete(key);
  }
  return valid;
}

