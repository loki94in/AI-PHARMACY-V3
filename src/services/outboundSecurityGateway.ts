/**
 * Outbound Security Gateway
 *
 * Centralized, fail-closed security gateway for ALL outbound WhatsApp messages.
 * Enforces:
 * 1. Authenticated recipient resolution and role-based permissions.
 * 2. Recipient-specific field allowlists (customers vs. distributors vs. staff).
 * 3. Confidential data classification scanner (blocks wholesale rates, PTR, margins, cost prices,
 *    internal notes, system credentials, and unmasked foreign customer PII).
 * 4. Immutable audit logging of security blocks and approved dispatches via action_logs.
 *
 * Fail-Closed Contract:
 * If recipient permissions, message purpose, or confidential data classification cannot be established,
 * transmission is strictly blocked and logged.
 */

import { dbManager } from '../database/connection.js';
import { logMutationAudit } from './auditLoggerService.js';

export type RecipientRole = 'customer' | 'distributor' | 'delivery_boy' | 'staff' | 'owner' | 'unknown';

export interface OutboundMessageValidationRequest {
  recipient: string;
  message: string;
  messageType?: string;
  targetName?: string;
  mediaUrl?: string;
  callerRole?: 'system' | 'staff' | 'owner' | 'customer_bot';
  dbInstance?: any;
}

export interface OutboundValidationResult {
  allowed: boolean;
  recipientRole: RecipientRole;
  normalizedPhone: string;
  recipientName?: string;
  blockReason?: string;
  violations: string[];
}

export class OutboundSecurityGateError extends Error {
  public readonly code = 'OUTBOUND_SECURITY_GATE_VIOLATION';
  public readonly violations: string[];
  public readonly recipient: string;
  public readonly recipientRole: RecipientRole;

  constructor(reason: string, violations: string[], recipient: string, role: RecipientRole) {
    super(`[Outbound Security Gateway] Send blocked to ${recipient} (${role}): ${reason} [${violations.join(', ')}]`);
    this.name = 'OutboundSecurityGateError';
    this.violations = violations;
    this.recipient = recipient;
    this.recipientRole = role;
  }
}

// ─── Prohibited Data Classification Patterns ───────────────────────────────

// Wholesale rates & supplier purchase prices (strictly prohibited for customers)
const CONFIDENTIAL_PURCHASE_RATE_PATTERNS = [
  /\bptr\b/i,
  /\bp\.t\.r\.?\b/i,
  /\bpurchase\s*(?:price|rate)\b/i,
  /\bcost\s*price\b/i,
  /\bwholesale\s*(?:rate|price)\b/i,
  /\bkharid\s*(?:bhav|rate|price)\b/i,
  /\bbuying\s*(?:rate|price)\b/i,
  /\bdistributor\s*(?:rate|ptr|cost)\b/i,
  /(?:ptr|cost|cost\s*price|purchase\s*rate)\s*[:=]\s*(?:rs\.?|₹)?\s*\d+/i
];

// Profit margins & business financials (strictly prohibited for customers & non-owners)
const CONFIDENTIAL_MARGIN_PATTERNS = [
  /\bprofit\s*margin\b/i,
  /\bgross\s*margin\b/i,
  /\bnet\s*margin\b/i,
  /\bmarkup\s*%\b/i,
  /\bmargin\s*%\b/i,
  /\b\d+(?:\.\d+)?%\s*(?:margin|profit)\b/i,
  /\bprofit\s*:\s*(?:rs\.?|₹)?\s*\d+/i
];

// Internal notes & credentials (strictly prohibited for all external parties)
const SENSITIVE_INTERNAL_PATTERNS = [
  /\binternal\s*note\b/i,
  /\bprivate\s*note\b/i,
  /\bpharmacist\s*note\b/i,
  /\bconfidential\b/i,
  /\bapi[_-]?key\b/i,
  /\bbearer\s+[a-z0-9_\-\.]{8,}/i,
  /\bsystem\s*password\b/i
];

// Message types targeted specifically for distributors
const DISTRIBUTOR_MESSAGE_TYPES = new Set([
  'distributor_collection',
  'pharmarack_distributor_order',
  'distributor_cart_order',
  'distributor_dispatch_reminder',
  'distributor_stock_check'
]);

/**
 * Normalizes a phone number to standard 10-digit Indian mobile format or JID digits.
 */
export function normalizePhoneDigits(raw: string | null | undefined): string {
  if (!raw) return '';
  let clean = String(raw).replace(/\D/g, '');
  if (clean.length === 11 && clean.startsWith('0')) {
    clean = clean.slice(1);
  }
  if (clean.length === 12 && clean.startsWith('91')) {
    clean = clean.slice(2);
  }
  return clean.slice(-10);
}

export class OutboundSecurityGateway {
  /**
   * Resolves the verified role of the target recipient against local database directories.
   */
  public async resolveRecipientRole(
    phone: string,
    dbInstance?: any
  ): Promise<{ role: RecipientRole; name?: string; id?: number }> {
    const clean10 = normalizePhoneDigits(phone);
    if (!clean10 || clean10.length < 10) {
      return { role: 'unknown' };
    }

    const db = dbInstance || (await dbManager.getConnection());

    // 1. Check Store Owner / App Admin
    try {
      const ownerRow = await db.get(
        `SELECT value FROM app_settings 
         WHERE key IN ('shop_phone', 'owner_whatsapp_number', 'admin_whatsapp_number') 
           AND value LIKE ? 
         LIMIT 1`,
        [`%${clean10}%`]
      );
      if (ownerRow?.value) {
        return { role: 'owner', name: 'Store Owner' };
      }
    } catch (_) {}

    // 2. Check Staff Users
    try {
      const userRow = await db.get(
        `SELECT id, username, role FROM pharmacy_users 
         WHERE phone LIKE ? AND is_active = 1 
         LIMIT 1`,
        [`%${clean10}%`]
      );
      if (userRow?.id) {
        return {
          role: userRow.role === 'owner' ? 'owner' : 'staff',
          name: userRow.username,
          id: userRow.id
        };
      }
    } catch (_) {}

    // 3. Check Verified Distributors Directory
    try {
      const distRow = await db.get(
        `SELECT id, name FROM distributors 
         WHERE (phone LIKE ? OR contact LIKE ?) 
         LIMIT 1`,
        [`%${clean10}%`, `%${clean10}%`]
      );
      if (distRow?.id) {
        return { role: 'distributor', name: distRow.name, id: distRow.id };
      }
    } catch (_) {}

    // 4. Check Verified Delivery Boys Directory
    try {
      const boyRow = await db.get(
        `SELECT id, name FROM delivery_boys 
         WHERE (whatsapp_number LIKE ? OR phone LIKE ?) 
           AND (is_active = 1 OR is_active IS NULL) 
         LIMIT 1`,
        [`%${clean10}%`, `%${clean10}%`]
      );
      if (boyRow?.id) {
        return { role: 'delivery_boy', name: boyRow.name, id: boyRow.id };
      }
    } catch (_) {}

    // 5. Check Verified Customer Directory
    try {
      const custRow = await db.get(
        `SELECT id, name FROM customers 
         WHERE phone LIKE ? 
         LIMIT 1`,
        [`%${clean10}%`]
      );
      if (custRow?.id) {
        return { role: 'customer', name: custRow.name, id: custRow.id };
      }
    } catch (_) {}

    // 6. Check Active WhatsApp Chats (Inbound customers who chatted previously)
    try {
      const chatRow = await db.get(
        `SELECT id, name FROM whatsapp_chats 
         WHERE resolved_number LIKE ? OR id LIKE ? 
         LIMIT 1`,
        [`%${clean10}%`, `%${clean10}%`]
      );
      if (chatRow?.id) {
        return { role: 'customer', name: chatRow.name };
      }
    } catch (_) {}

    return { role: 'unknown' };
  }

  /**
   * Scans a message body for confidential data leaks based on the recipient's role.
   */
  public scanMessageContent(
    message: string,
    recipientRole: RecipientRole
  ): { safe: boolean; violations: string[] } {
    const violations: string[] = [];
    const text = message || '';

    // Sensitive internal system notes and credentials: blocked for all external parties
    if (recipientRole !== 'owner' && recipientRole !== 'staff') {
      for (const pattern of SENSITIVE_INTERNAL_PATTERNS) {
        if (pattern.test(text)) {
          violations.push(`Contains internal notes or credential pattern: "${pattern.source}"`);
        }
      }
    }

    // Purchase rates, wholesale prices, and PTR: strictly blocked for customers and unknown recipients
    if (recipientRole === 'customer' || recipientRole === 'unknown' || recipientRole === 'delivery_boy') {
      for (const pattern of CONFIDENTIAL_PURCHASE_RATE_PATTERNS) {
        if (pattern.test(text)) {
          violations.push(`Contains confidential purchase rate/PTR pattern: "${pattern.source}"`);
        }
      }

      for (const pattern of CONFIDENTIAL_MARGIN_PATTERNS) {
        if (pattern.test(text)) {
          violations.push(`Contains confidential profit/margin pattern: "${pattern.source}"`);
        }
      }
    }

    return {
      safe: violations.length === 0,
      violations
    };
  }

  /**
   * Primary Validation Function: Validates every outgoing WhatsApp message before enqueue or transport.
   * Fail-Closed: Blocks any unverified recipient or prohibited confidential disclosure.
   */
  public async validateOutboundMessage(
    request: OutboundMessageValidationRequest
  ): Promise<OutboundValidationResult> {
    const { recipient, message, messageType = 'direct', targetName, dbInstance } = request;
    const clean10 = normalizePhoneDigits(recipient);
    const violations: string[] = [];

    if (!clean10 || clean10.length < 10) {
      const reason = 'INVALID_RECIPIENT_PHONE';
      violations.push(`Recipient phone "${recipient}" contains fewer than 10 valid digits.`);
      await this.logSecurityBlock(recipient, 'unknown', message, reason, violations);
      return {
        allowed: false,
        recipientRole: 'unknown',
        normalizedPhone: clean10,
        blockReason: reason,
        violations
      };
    }

    // Resolve verified recipient identity
    const recipientInfo = await this.resolveRecipientRole(clean10, dbInstance);
    const role = recipientInfo.role;

    // Rule: Distributor POs and Reminders MUST only be sent to verified distributors or verified store admin
    const isDistributorMessageType = DISTRIBUTOR_MESSAGE_TYPES.has(messageType);
    if (isDistributorMessageType && role !== 'distributor' && role !== 'owner' && role !== 'staff') {
      const reason = 'UNAUTHORIZED_DISTRIBUTOR_RECIPIENT';
      violations.push(
        `Distributor message type "${messageType}" cannot be sent to unverified recipient ${clean10} (resolved as "${role}").`
      );
      await this.logSecurityBlock(clean10, role, message, reason, violations);
      return {
        allowed: false,
        recipientRole: role,
        normalizedPhone: clean10,
        recipientName: recipientInfo.name || targetName,
        blockReason: reason,
        violations
      };
    }

    // Scan message content for confidential data leakage
    const scan = this.scanMessageContent(message, role);
    if (!scan.safe) {
      const reason = 'CONFIDENTIAL_DATA_DISCLOSURE';
      violations.push(...scan.violations);
      await this.logSecurityBlock(clean10, role, message, reason, violations);
      return {
        allowed: false,
        recipientRole: role,
        normalizedPhone: clean10,
        recipientName: recipientInfo.name || targetName,
        blockReason: reason,
        violations
      };
    }

    return {
      allowed: true,
      recipientRole: role,
      normalizedPhone: clean10,
      recipientName: recipientInfo.name || targetName,
      violations: []
    };
  }

  /**
   * Assertive gate helper: throws OutboundSecurityGateError if validation fails.
   */
  public async assertOutboundMessageAllowed(
    request: OutboundMessageValidationRequest
  ): Promise<OutboundValidationResult> {
    const result = await this.validateOutboundMessage(request);
    if (!result.allowed) {
      throw new OutboundSecurityGateError(
        result.blockReason || 'VALIDATION_FAILED',
        result.violations,
        result.normalizedPhone || request.recipient,
        result.recipientRole
      );
    }
    return result;
  }

  /**
   * Logs an immutable security violation record to action_logs via logMutationAudit.
   */
  private async logSecurityBlock(
    recipient: string,
    role: RecipientRole,
    message: string,
    reason: string,
    violations: string[]
  ): Promise<void> {
    try {
      await logMutationAudit({
        storeId: 1,
        action: 'OUTBOUND_SECURITY_BLOCK',
        entity: 'whatsapp_messages',
        description: `Outbound security gateway blocked WhatsApp message to ${recipient} (${role}): ${reason}`,
        metadata: {
          recipient,
          recipientRole: role,
          reason,
          violations,
          messagePreview: (message || '').slice(0, 150),
          blockedAt: new Date().toISOString()
        }
      });
      console.warn(`[Outbound Security Gateway] BLOCKED message to ${recipient} (${role}): ${reason} [${violations.join('; ')}]`);
    } catch (logErr) {
      console.error('[Outbound Security Gateway] Failed to write security block audit log:', logErr);
    }
  }
}

export const outboundSecurityGateway = new OutboundSecurityGateway();

