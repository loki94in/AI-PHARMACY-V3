import { dbManager } from '../database/connection.js';
import { normalizeWhatsAppPhone, hashMessageBody } from '../whatsappClient.js';

export interface DeliveryRegisterRecord {
  id: number;
  phone: string;
  phone_last10: string;
  message: string;
  message_hash: string;
  type: string;
  target_name?: string | null;
  reference_id?: string | null;
  wa_message_id?: string | null;
  sent_at: number;
  delivery_status: string;
  metadata?: string | null;
}

export class WhatsAppDeliveryRegister {
  private schemaEnsured = false;

  private async ensureSchema(db: any): Promise<void> {
    if (this.schemaEnsured) return;
    try {
      await db.run(`
        CREATE TABLE IF NOT EXISTS whatsapp_sent_register (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          phone_last10 TEXT NOT NULL,
          message TEXT NOT NULL,
          message_hash TEXT NOT NULL,
          type TEXT NOT NULL,
          target_name TEXT,
          reference_id TEXT,
          wa_message_id TEXT,
          sent_at INTEGER NOT NULL,
          delivery_status TEXT DEFAULT 'delivered',
          metadata TEXT
        )
      `);
      await db.run("CREATE INDEX IF NOT EXISTS idx_wa_sent_reg_lookup ON whatsapp_sent_register (phone_last10, message_hash, sent_at)");
      await db.run("CREATE INDEX IF NOT EXISTS idx_wa_sent_reg_type ON whatsapp_sent_register (type, sent_at)");
      await db.run("CREATE INDEX IF NOT EXISTS idx_wa_sent_reg_sent_at ON whatsapp_sent_register (sent_at)");
      this.schemaEnsured = true;
    } catch (_) {}
  }

  /**
   * Permanently record a successfully delivered message in the audit ledger.
   */
  public async recordDelivery(
    phone: string,
    message: string,
    type: string,
    targetName?: string | null,
    referenceId?: string | null,
    waMessageId?: string | null,
    metadata?: any
  ): Promise<number> {
    const cleanDigits = normalizeWhatsAppPhone(phone || '');
    const last10 = cleanDigits.slice(-10);
    if (!last10 || last10.length < 7) {
      console.warn('[DeliveryRegister] Cannot record message for invalid phone:', phone);
      return 0;
    }

    const msgHash = String(hashMessageBody(message || ''));
    const now = Date.now();
    const metaStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

    try {
      const db = await dbManager.getConnection();
      await this.ensureSchema(db);

      const res = await db.run(
        `INSERT INTO whatsapp_sent_register 
         (phone, phone_last10, message, message_hash, type, target_name, reference_id, wa_message_id, sent_at, delivery_status, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?)`,
        [cleanDigits, last10, message || '', msgHash, type || 'general', targetName || null, referenceId ? String(referenceId) : null, waMessageId || null, now, metaStr]
      );

      return res.lastID || 0;
    } catch (err) {
      console.error('[DeliveryRegister] Failed to record delivered message:', err);
      return 0;
    }
  }

  /**
   * Check if an identical message has already been delivered to this phone within the specified window (default: 48 hours).
   * Also checks the active whatsapp_messages outbox table as a secondary safety shield.
   */
  public async isAlreadyDelivered(
    phone: string,
    message: string,
    withinHours = 48
  ): Promise<{ delivered: boolean; sentAt?: number; registerId?: number; waMessageId?: string }> {
    const cleanDigits = normalizeWhatsAppPhone(phone || '');
    const last10 = cleanDigits.slice(-10);
    if (!last10 || last10.length < 7) {
      return { delivered: false };
    }

    const msgHash = String(hashMessageBody(message || ''));
    const cutoffTs = Date.now() - (withinHours * 60 * 60 * 1000);

    try {
      const db = await dbManager.getConnection();
      await this.ensureSchema(db);

      // 1. Primary check: permanent whatsapp_sent_register
      const record = await db.get(
        `SELECT id, sent_at, wa_message_id, message 
         FROM whatsapp_sent_register
         WHERE (phone_last10 = ? OR phone LIKE ?)
           AND message_hash = ?
           AND sent_at >= ?
         ORDER BY sent_at DESC LIMIT 1`,
        [last10, `%${last10}%`, msgHash, cutoffTs]
      );

      if (record) {
        // Double check length match to avoid rare 32-bit hash collision
        const trimmedSrc = (message || '').trim();
        const trimmedRec = (record.message || '').trim();
        if (trimmedSrc.length === trimmedRec.length) {
          return {
            delivered: true,
            sentAt: record.sent_at,
            registerId: record.id,
            waMessageId: record.wa_message_id || undefined
          };
        }
      }

      // 2. Secondary check: real WhatsApp outbox in whatsapp_messages table (from_me = 1)
      const cutoffSeconds = Math.floor(cutoffTs / 1000);
      const outboxRows = await db.all(
        `SELECT id, body, timestamp 
         FROM whatsapp_messages
         WHERE from_me = 1
           AND id NOT LIKE 'msg_out_%'
           AND (id LIKE 'true_%' OR id LIKE '3EB%' OR id LIKE 'wamid%' OR LENGTH(id) > 20)
           AND (chat_id LIKE ? OR chat_id LIKE ?)
           AND timestamp >= ?
         ORDER BY timestamp DESC LIMIT 20`,
        [`%${last10}%`, `%${cleanDigits}%`, cutoffSeconds]
      );

      const targetHashNum = Number(msgHash);
      const targetLen = (message || '').trim().length;

      for (const row of outboxRows || []) {
        const body = String(row.body || '').trim();
        if (hashMessageBody(body) === targetHashNum && body.length === targetLen) {
          // Retroactively record this verified outbox delivery in the register for future instant lookups
          void this.recordDelivery(phone, message, 'outbox_verified', undefined, undefined, row.id);
          return {
            delivered: true,
            sentAt: (row.timestamp || 0) * 1000,
            waMessageId: row.id
          };
        }
      }

      return { delivered: false };
    } catch (err) {
      console.warn('[DeliveryRegister] Lookup error (failing open):', err);
      return { delivered: false };
    }
  }

  /**
   * Fetch permanent delivery history for UI or reporting across sessions and updates.
   */
  public async getDeliveryHistory(options: {
    limit?: number;
    offset?: number;
    search?: string;
    type?: string;
  } = {}): Promise<{ items: DeliveryRegisterRecord[]; total: number }> {
    const limit = Math.min(300, Math.max(1, options.limit || 50));
    const offset = Math.max(0, options.offset || 0);

    try {
      const db = await dbManager.getConnection();
      await this.ensureSchema(db);

      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (options.type && options.type !== 'all') {
        whereClause += ' AND type = ?';
        params.push(options.type);
      }

      if (options.search?.trim()) {
        const q = `%${options.search.trim()}%`;
        whereClause += ' AND (phone LIKE ? OR message LIKE ? OR target_name LIKE ?)';
        params.push(q, q, q);
      }

      const countRow = await db.get(`SELECT COUNT(*) as total FROM whatsapp_sent_register ${whereClause}`, params);
      const total = Number(countRow?.total || 0);

      const items: DeliveryRegisterRecord[] = await db.all(
        `SELECT * FROM whatsapp_sent_register 
         ${whereClause} 
         ORDER BY sent_at DESC 
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      return { items: items || [], total };
    } catch (err) {
      console.error('[DeliveryRegister] Failed to fetch history:', err);
      return { items: [], total: 0 };
    }
  }

  /**
   * Purge entries older than retention period (default 90 days).
   */
  public async purgeExpiredRegisterEntries(retentionDays = 90): Promise<number> {
    try {
      const db = await dbManager.getConnection();
      await this.ensureSchema(db);
      const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      const res = await db.run("DELETE FROM whatsapp_sent_register WHERE sent_at < ?", [cutoff]);
      return res.changes || 0;
    } catch (err) {
      return 0;
    }
  }
}

export const whatsappDeliveryRegister = new WhatsAppDeliveryRegister();
