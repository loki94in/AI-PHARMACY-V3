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
import { whatsappQueueWorker } from './whatsappQueueWorker.js';

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

export interface AffectedClosureCustomer {
  phone: string;
  name: string;
  sourceTypes: string[];        // ['Special Order', 'Refill', 'Online Order', 'CRM']
  orderRefs: string[];          // ['SO-TMSA-10452', 'RF-8821']
  medicines: Array<{
    name: string;
    qty: number;
    unit?: string;
    mrp?: number;
  }>;
  totalItems: number;
  notes?: string;
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
          (product, qty, requester, created_at, status, notes, pharmarack_mapped)
         VALUES (?, ?, ?, ?, 'Pending', ?, 0)`,
        [it.medicine_name, it.qty, 'Pharmacist', now, reason]
      );
      addedCount++;
    }

    eventService.broadcast('special_orders_updated', { addedCount });
    return { addedCount };
  }

  /**
   * Harvest all affected customers across:
   * 1. Special Orders (pending / confirmed / waiting)
   * 2. Patient Refills (due in closure window)
   * 3. CRM Patient Call Tasks (pending)
   * Deduplicates by patient phone and groups medicines.
   */
  async getAffectedClosureCustomers(
    dateRange?: { startDate?: string; endDate?: string },
    dbInstance?: any
  ): Promise<AffectedClosureCustomer[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const todayStr = new Date().toISOString().slice(0, 10);
    const start = dateRange?.startDate ? dateRange.startDate.slice(0, 10) : todayStr;
    const end = dateRange?.endDate ? dateRange.endDate.slice(0, 10) : start;

    const byPhone = new Map<string, AffectedClosureCustomer>();

    const getOrCreate = (rawPhone: string, rawName: string): AffectedClosureCustomer | null => {
      const cleanDigits = String(rawPhone || '').replace(/\D/g, '').slice(-10);
      if (!cleanDigits || cleanDigits.length < 10) return null;
      let existing = byPhone.get(cleanDigits);
      if (!existing) {
        existing = {
          phone: cleanDigits,
          name: (rawName && rawName.trim().length > 1) ? rawName.trim() : 'Customer',
          sourceTypes: [],
          orderRefs: [],
          medicines: [],
          totalItems: 0,
        };
        byPhone.set(cleanDigits, existing);
      }
      if (rawName && rawName.trim().length > 1 && existing.name === 'Customer') {
        existing.name = rawName.trim();
      }
      return existing;
    };

    // 1. Special Orders & Online Order Items
    try {
      const specialOrderRows = await db.all(`
        SELECT so.id, so.requester, so.phone, so.medicine_name, so.product, so.qty, so.status,
               so.customer_order_source, so.pharmarack_mrp, so.total_amount, so.created_at,
               ooi.product_name, ooi.requested_qty, ooi.mrp as ooi_mrp
        FROM special_orders so
        LEFT JOIN online_order_items ooi ON ooi.order_id = so.id
        WHERE so.status NOT IN ('Cancelled', 'Fulfilled', 'Delivered')
          AND date(so.created_at) >= date('now', '-7 days')
        ORDER BY so.id DESC
      `);

      for (const row of specialOrderRows) {
        const cust = getOrCreate(row.phone, row.requester);
        if (!cust) continue;

        const isOnline = row.customer_order_source === 'online' || row.customer_order_source === 'website';
        const sourceLabel = isOnline ? 'Online Order' : 'Special Order';
        if (!cust.sourceTypes.includes(sourceLabel)) cust.sourceTypes.push(sourceLabel);

        const soRef = `SO-${row.id}`;
        if (!cust.orderRefs.includes(soRef)) cust.orderRefs.push(soRef);

        const medName = row.product_name || row.medicine_name || row.product;
        const medQty = Number(row.requested_qty || row.qty || 1);
        const medMrp = Number(row.ooi_mrp || row.pharmarack_mrp || 0);

        if (medName) {
          const already = cust.medicines.find(m => m.name.toLowerCase() === medName.toLowerCase());
          if (!already) {
            cust.medicines.push({ name: medName, qty: medQty, mrp: medMrp > 0 ? medMrp : undefined });
            cust.totalItems += medQty;
          }
        }
      }
    } catch (soErr) {
      console.warn('[MarketClosure] Error fetching special orders for closure:', soErr);
    }

    // 2. Patient Refills due in range
    try {
      const refillRows = await db.all(`
        SELECT pr.id, pr.patient_name, pr.patient_phone, pr.quantity_needed,
               pr.next_refill_date, m.name as medicine_name, COALESCE(m.mrp, 0) as mrp
        FROM patient_refills pr
        JOIN medicines m ON m.id = pr.medicine_id
        WHERE pr.is_active = 1
          AND (pr.status IS NULL OR pr.status != 'cancelled')
          AND date(pr.next_refill_date) BETWEEN date(?) AND date(?)
        ORDER BY pr.next_refill_date ASC
      `, [start, end]);

      for (const row of refillRows) {
        const cust = getOrCreate(row.patient_phone, row.patient_name);
        if (!cust) continue;

        if (!cust.sourceTypes.includes('Refill')) cust.sourceTypes.push('Refill');
        const rfRef = `RF-${row.id}`;
        if (!cust.orderRefs.includes(rfRef)) cust.orderRefs.push(rfRef);

        const medName = row.medicine_name;
        const medQty = Number(row.quantity_needed || 1);
        const medMrp = Number(row.mrp || 0);

        if (medName) {
          const already = cust.medicines.find(m => m.name.toLowerCase() === medName.toLowerCase());
          if (!already) {
            cust.medicines.push({ name: medName, qty: medQty, mrp: medMrp > 0 ? medMrp : undefined });
            cust.totalItems += medQty;
          }
        }
      }
    } catch (rfErr) {
      console.warn('[MarketClosure] Error fetching refills for closure:', rfErr);
    }

    // 3. CRM Call Tasks
    try {
      const crmRows = await db.all(`
        SELECT id, patient_name, patient_phone, task_type, details_json, notes
        FROM patient_call_tasks
        WHERE status = 'pending'
          AND date(created_at) >= date('now', '-3 days')
      `);

      for (const row of crmRows) {
        const cust = getOrCreate(row.patient_phone, row.patient_name);
        if (!cust) continue;

        if (!cust.sourceTypes.includes('CRM')) cust.sourceTypes.push('CRM');
        const crmRef = `CRM-${row.id}`;
        if (!cust.orderRefs.includes(crmRef)) cust.orderRefs.push(crmRef);
      }
    } catch (crmErr) {
      console.warn('[MarketClosure] Error fetching CRM tasks for closure:', crmErr);
    }

    return Array.from(byPhone.values());
  }

  /**
   * Send WhatsApp notice to human-approved selected patients.
   * Strict Human-in-the-loop: Dispatches ONLY to explicitly checked patients.
   */
  async sendApprovedClosureNotices(
    params: {
      selectedPatients: Array<{
        phone: string;
        name: string;
        orderRef?: string;
        medicines?: string[];
      }>;
      messageTemplate: string;
      nextWorkingDate?: string;
      nextDeliveryTime?: string;
      reason?: string;
    },
//     dbInstance?: any
  ): Promise<{ sentCount: number }> {
//     const _db = dbInstance || (await dbManager.getConnection());
    const pharmacyName = (await getConfiguredPharmacyName()) || 'Pharmacy';
    const patients = Array.isArray(params.selectedPatients) ? params.selectedPatients : [];

    let sentCount = 0;
    for (const p of patients) {
      const cleanDigits = String(p.phone || '').replace(/\D/g, '').slice(-10);
      if (!cleanDigits || cleanDigits.length < 10) continue;

      const medList = Array.isArray(p.medicines) && p.medicines.length > 0
        ? p.medicines.join(', ')
        : 'your prescribed medicines';

      let msg = params.messageTemplate
        .replace(/\{\{PATIENT_NAME\}\}/g, p.name || 'Customer')
        .replace(/\{patient_name\}/g, p.name || 'Customer')
        .replace(/\{\{ORDER_REF\}\}/g, p.orderRef || 'your order')
        .replace(/\{order_ref\}/g, p.orderRef || 'your order')
        .replace(/\{\{MEDICINES\}\}/g, medList)
        .replace(/\{medicines\}/g, medList)
        .replace(/\{\{NEXT_WORKING_DATE\}\}/g, params.nextWorkingDate || 'our next working day')
        .replace(/\{next_date\}/g, params.nextWorkingDate || 'our next working day')
        .replace(/\{\{NEXT_DELIVERY_TIME\}\}/g, params.nextDeliveryTime || '9:00 AM – 11:00 AM')
        .replace(/\{delivery_time\}/g, params.nextDeliveryTime || '9:00 AM – 11:00 AM')
        .replace(/\{\{PHARMACY_NAME\}\}/g, pharmacyName)
        .replace(/\{pharmacy_name\}/g, pharmacyName);

      try {
        await whatsappQueueWorker.enqueue(
          cleanDigits,
          msg,
          'customer_order_status',
          p.name || 'Customer'
        );
        sentCount++;
      } catch (sendErr) {
        console.warn(`[MarketClosure] Failed to enqueue notice to ${cleanDigits}:`, sendErr);
      }
    }

    return { sentCount };
  }
}

export const marketClosureService = new MarketClosureService();

