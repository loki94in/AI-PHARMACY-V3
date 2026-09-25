/**
 * marketClosureService.ts
 *
 * Manages Wholesale Medicine Market Closures & Pharmacy Store Closures:
 * 1. Tracks market and pharmacy closure date ranges in app_settings.
 * 2. Scans upcoming 7-day patient refills to detect stock shortfalls.
 * 3. Prepares an interactive review checklist for the Pharmarack Cart so owner
 *    can order buffer stock before distributor dispatch closes.
 * 4. Generates staged patient WhatsApp notices (human-in-the-loop: owner must approve before sending).
 */

import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { getConfiguredPharmacyName } from './storeSettingsService.js';

export interface MarketClosureConfig {
  enabled: boolean;
  type: 'market_closed' | 'pharmacy_closed';
  startDate: string;
  endDate: string;
  reason?: string;
  lookaheadDays: number;
}

export interface ClosureBufferItem {
  refill_id: number;
  patient_name: string;
  patient_phone: string;
  medicine_id: number;
  medicine_name: string;
  manufacturer: string;
  pack_size: number | string;
  next_refill_date: string;
  quantity_needed: number;
  current_stock: number;
  shortfall_packs: number;
  recommended_order_qty: number;
  mrp: number;
  rate: number;
  distributor_name: string;
  status: 'shortfall' | 'sufficient';
}

const SETTING_KEY = 'pharmacy_market_closure_config';

export class MarketClosureService {
  /**
   * Fetch current closure configuration from app_settings
   */
  async getConfig(dbInstance?: any): Promise<MarketClosureConfig> {
    const db = dbInstance || (await dbManager.getConnection());
    try {
      const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [SETTING_KEY]);
      if (row && row.value) {
        const parsed = JSON.parse(row.value);
        return {
          enabled: Boolean(parsed.enabled),
          type: parsed.type === 'pharmacy_closed' ? 'pharmacy_closed' : 'market_closed',
          startDate: String(parsed.startDate || ''),
          endDate: String(parsed.endDate || ''),
          reason: String(parsed.reason || ''),
          lookaheadDays: Number(parsed.lookaheadDays) || 7,
        };
      }
    } catch (err) {
      console.error('[MarketClosureService] Error reading config:', err);
    }
    return {
      enabled: false,
      type: 'market_closed',
      startDate: '',
      endDate: '',
      reason: '',
      lookaheadDays: 7,
    };
  }

  /**
   * Save closure configuration to app_settings and broadcast SSE
   */
  async saveConfig(config: Partial<MarketClosureConfig>, dbInstance?: any): Promise<MarketClosureConfig> {
    const db = dbInstance || (await dbManager.getConnection());
    const current = await this.getConfig(db);
    const updated: MarketClosureConfig = {
      enabled: config.enabled !== undefined ? Boolean(config.enabled) : current.enabled,
      type: config.type === 'pharmacy_closed' ? 'pharmacy_closed' : 'market_closed',
      startDate: config.startDate !== undefined ? String(config.startDate) : current.startDate,
      endDate: config.endDate !== undefined ? String(config.endDate) : current.endDate,
      reason: config.reason !== undefined ? String(config.reason) : current.reason,
      lookaheadDays: config.lookaheadDays ? Number(config.lookaheadDays) : current.lookaheadDays,
    };

    await db.run(
      'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
      [SETTING_KEY, JSON.stringify(updated)]
    );

    eventService.broadcast('market_closure_updated', updated);
    return updated;
  }

  /**
   * Analyze upcoming 7-day refill demand vs in-hand stock during closure
   */
  async getBufferAnalysis(dbInstance?: any): Promise<{
    config: MarketClosureConfig;
    items: ClosureBufferItem[];
    totalShortfallPacks: number;
    patientCount: number;
  }> {
    const db = dbInstance || (await dbManager.getConnection());
    const config = await this.getConfig(db);

    if (!config.enabled || !config.startDate) {
      return {
        config,
        items: [],
        totalShortfallPacks: 0,
        patientCount: 0,
      };
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const startDate = config.startDate < todayStr ? todayStr : config.startDate;

    // Look ahead by lookaheadDays after the closure endDate (or startDate)
    const baseEnd = new Date(config.endDate || config.startDate);
    baseEnd.setDate(baseEnd.getDate() + (config.lookaheadDays || 7));
    const rangeEndStr = baseEnd.toISOString().slice(0, 10);

    const rows = await db.all(
      `SELECT 
        pr.id AS refill_id,
        pr.patient_name,
        pr.patient_phone,
        pr.medicine_id,
        pr.next_refill_date,
        pr.quantity_needed,
        m.name AS medicine_name,
        COALESCE(m.manufacturer, '') AS manufacturer,
        COALESCE(m.pack_size, '1') AS pack_size,
        COALESCE(m.mrp, 0) AS mrp,
        COALESCE(m.sell_price, m.mrp, 0) AS sell_price,
        COALESCE(m.last_purchase_ptr, m.rate, 0) AS rate,
        COALESCE(m.last_distributor_name, '') AS distributor_name,
        COALESCE((SELECT SUM(quantity) FROM inventory_master WHERE medicine_id = pr.medicine_id), 0) AS stock_qty,
        COALESCE((SELECT SUM(loose_quantity) FROM inventory_master WHERE medicine_id = pr.medicine_id), 0) AS loose_qty
      FROM patient_refills pr
      JOIN medicines m ON m.id = pr.medicine_id
      WHERE pr.is_active = 1
        AND (pr.status IS NULL OR pr.status != 'cancelled')
        AND date(pr.next_refill_date) BETWEEN date(?) AND date(?)
      ORDER BY pr.next_refill_date ASC, m.name ASC`,
      [startDate, rangeEndStr]
    );

    const items: ClosureBufferItem[] = [];
    const patientPhones = new Set<string>();
    let totalShortfallPacks = 0;

    for (const r of rows) {
      const stock = Math.max(0, Number(r.stock_qty || 0));
      const needed = Math.max(1, Number(r.quantity_needed || 1));
      const shortfall = Math.max(0, needed - stock);
      const isShortfall = shortfall > 0;

      if (isShortfall) {
        totalShortfallPacks += shortfall;
      }
      if (r.patient_phone) {
        patientPhones.add(r.patient_phone);
      }

      items.push({
        refill_id: r.refill_id,
        patient_name: r.patient_name || 'Valued Patient',
        patient_phone: r.patient_phone || '',
        medicine_id: r.medicine_id,
        medicine_name: r.medicine_name,
        manufacturer: r.manufacturer,
        pack_size: r.pack_size,
        next_refill_date: String(r.next_refill_date || '').slice(0, 10),
        quantity_needed: needed,
        current_stock: stock,
        shortfall_packs: shortfall,
        recommended_order_qty: isShortfall ? shortfall : 0,
        mrp: Number(r.mrp || 0),
        rate: Number(r.rate || 0),
        distributor_name: r.distributor_name,
        status: isShortfall ? 'shortfall' : 'sufficient',
      });
    }

    return {
      config,
      items,
      totalShortfallPacks,
      patientCount: patientPhones.size,
    };
  }

  /**
   * Stage patient WhatsApp notices for upcoming market/store closure
   * Human-in-the-loop: Staged with status 'staged', requires owner review & send.
   */
  async stageClosureNotices(
    refillIds: number[],
    customTemplate?: string,
    dbInstance?: any
  ): Promise<{ stagedCount: number; patientCount: number }> {
    const db = dbInstance || (await dbManager.getConnection());
    const config = await this.getConfig(db);
    const pharmacyName = (await getConfiguredPharmacyName()) || 'Pharmacy';

    const placeholders = refillIds.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT 
        pr.id AS refill_id,
        pr.patient_name,
        pr.patient_phone,
        m.name AS medicine_name,
        pr.next_refill_date
      FROM patient_refills pr
      JOIN medicines m ON m.id = pr.medicine_id
      WHERE pr.id IN (${placeholders})`,
      refillIds
    );

    // Group by patient phone to send consolidated notice per patient
    const byPatient = new Map<string, { name: string; phone: string; medicines: string[]; refillDate: string; refillIds: number[] }>();

    for (const r of rows) {
      if (!r.patient_phone) continue;
      const phone = String(r.patient_phone).trim();
      const existing = byPatient.get(phone);
      if (existing) {
        if (!existing.medicines.includes(r.medicine_name)) {
          existing.medicines.push(r.medicine_name);
        }
        existing.refillIds.push(r.refill_id);
      } else {
        byPatient.set(phone, {
          name: r.patient_name || 'Customer',
          phone,
          medicines: [r.medicine_name],
          refillDate: String(r.next_refill_date || '').slice(0, 10),
          refillIds: [r.refill_id],
        });
      }
    }

    let stagedCount = 0;
    const now = new Date().toISOString();

    for (const [, p] of byPatient) {
      const isStoreClosure = config.type === 'pharmacy_closed';
      const closureSubject = isStoreClosure ? 'our pharmacy will be closed' : 'the wholesale medicine market will be closed';
      const dateContext = config.startDate && config.endDate && config.startDate !== config.endDate
        ? `from ${config.startDate} to ${config.endDate}`
        : `on ${config.startDate}`;
      const reasonContext = config.reason ? ` for ${config.reason}` : '';

      let messageText = customTemplate;
      if (!messageText) {
        messageText = `Namaste ${p.name}! 🙏\n\nPlease note that ${closureSubject} ${dateContext}${reasonContext}.\n\nTo ensure no interruption in your daily dosage of *${p.medicines.join(', ')}*, we recommend confirming your upcoming refill before the closure so we can arrange your medicines in advance.\n\nReply *YES* to confirm your refill.\n\n— *${pharmacyName}*`;
      } else {
        messageText = messageText
          .replace(/\{patient_name\}/g, p.name)
          .replace(/\{medicines\}/g, p.medicines.join(', '))
          .replace(/\{start_date\}/g, config.startDate)
          .replace(/\{end_date\}/g, config.endDate)
          .replace(/\{reason\}/g, config.reason || 'Festival / Holiday')
          .replace(/\{pharmacy_name\}/g, pharmacyName);
      }

      await db.run(
        `INSERT INTO automation_notifications 
          (type, recipient_name, recipient_phone, message, status, created_at, reference_id, needs_confirmation)
         VALUES (?, ?, ?, ?, 'staged', ?, ?, 1)`,
        [
          isStoreClosure ? 'store_closure_refill_notice' : 'market_closure_refill_notice',
          p.name,
          p.phone,
          messageText,
          now,
          p.refillIds.join(','),
        ]
      );
      stagedCount++;
    }

    eventService.broadcast('automation_notification_created', { count: stagedCount });
    return { stagedCount, patientCount: byPatient.size };
  }

  /**
   * Add selected buffer items to special_orders / PO queue
   */
  async addBufferItemsToCart(
    items: Array<{ medicine_id: number; medicine_name: string; qty: number; distributor_name?: string }>,
    dbInstance?: any
  ): Promise<{ addedCount: number }> {
    const db = dbInstance || (await dbManager.getConnection());
    const config = await this.getConfig(db);
    const closureLabel = config.type === 'pharmacy_closed' ? 'Store Closure Buffer' : 'Market Closure Buffer';
    const reason = `${closureLabel}: ${config.startDate || 'Upcoming'} (${config.reason || 'Holiday'})`;
    const now = new Date().toISOString();

    let addedCount = 0;
    for (const it of items) {
      if (!it.qty || it.qty <= 0) continue;
      await db.run(
        `INSERT INTO special_orders 
          (product, qty, requester, created_at, status, notes, is_synced_to_pharmarack)
         VALUES (?, ?, ?, ?, 'pending', ?, 0)`,
        [it.medicine_name, it.qty, 'Pharmacist', now, reason]
      );
      addedCount++;
    }

    eventService.broadcast('special_orders_updated', { addedCount });
    return { addedCount };
  }
}

export const marketClosureService = new MarketClosureService();
