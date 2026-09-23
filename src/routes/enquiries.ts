import { Router, Request, Response } from 'express';
import { dbManager } from '../database/connection.js';
import { eventService } from '../services/eventService.js';
import { classifyDosageGroup, getGroupSqlFilter, DosageGroup } from '../services/dosageGroupService.js';
import { orderScheduleService } from '../services/orderScheduleService.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';

export const enquiriesRouter = Router();

/**
 * POST /api/enquiries
 * Create an enquiry (manual, whatsapp, phone, repeat, walkin)
 */
enquiriesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      patient_name,
      patient_phone,
      medicine_name,
      medicine_id,
      dosage_group,
      dosage_form,
      qty = 1,
      mrp,
      enquiry_type = 'medicine_info',
      source = 'manual',
      repeat_source_invoice_id,
      notes,
      store_id = 1
    } = req.body;

    if (!patient_name || !medicine_name) {
      res.status(400).json({ error: 'patient_name and medicine_name are required.' });
      return;
    }

    const cleanPhone = patient_phone ? String(patient_phone).replace(/\D/g, '') : null;
    const db = await dbManager.getConnection();

    // 30-minute deduplication window for identical phone + medicine
    if (cleanPhone) {
      const existing = await db.get(
        `SELECT id, created_at, status FROM medicine_enquiries
         WHERE patient_phone = ? AND LOWER(medicine_name) = ? AND status = 'open'
           AND created_at >= datetime('now', 'localtime', '-30 minutes')
         ORDER BY id DESC LIMIT 1`,
        [cleanPhone, medicine_name.trim().toLowerCase()]
      );

      if (existing) {
        await db.run(
          `UPDATE medicine_enquiries SET updated_at = datetime('now', 'localtime'), notes = COALESCE(?, notes)
           WHERE id = ?`,
          [notes, existing.id]
        );
        res.json({ success: true, id: existing.id, deduped: true, message: 'Enquiry updated (deduped).' });
        return;
      }
    }

    // Resolve medicine_id and truthful MRP snapshot
    let resolvedMedId = medicine_id || null;
    let resolvedMrp = mrp !== undefined ? Number(mrp) : null;
    let resolvedForm = dosage_form || null;

    if (!resolvedMedId) {
      const medRow = await db.get(
        'SELECT id, mrp, dosage_form FROM medicines WHERE LOWER(name) = ? LIMIT 1',
        [medicine_name.trim().toLowerCase()]
      );
      if (medRow) {
        resolvedMedId = medRow.id;
        if (resolvedMrp === null) resolvedMrp = medRow.mrp;
        if (!resolvedForm) resolvedForm = medRow.dosage_form;
      }
    }

    const resolvedGroup = dosage_group || classifyDosageGroup(resolvedForm);

    // Resolve customer_id if exists
    let customerId = null;
    if (cleanPhone) {
      const cust = await db.get('SELECT id FROM customers WHERE phone LIKE ? LIMIT 1', [`%${cleanPhone.slice(-10)}`]);
      if (cust) customerId = cust.id;
    }

    const result = await db.run(
      `INSERT INTO medicine_enquiries (
        store_id, customer_id, patient_name, patient_phone,
        medicine_id, medicine_name, dosage_group, dosage_form,
        qty, mrp, enquiry_type, source, status, repeat_source_invoice_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [
        Number(store_id) || 1,
        customerId,
        patient_name.trim(),
        cleanPhone,
        resolvedMedId,
        medicine_name.trim(),
        resolvedGroup,
        resolvedForm,
        Number(qty) || 1,
        resolvedMrp,
        enquiry_type,
        source,
        repeat_source_invoice_id || null,
        notes || null
      ]
    );

    const newId = result.lastID;
    eventService.broadcast('enquiry_updated', { id: newId, status: 'open', source });

    res.json({
      success: true,
      id: newId,
      medicine_id: resolvedMedId,
      mrp: resolvedMrp,
      dosage_group: resolvedGroup
    });
  } catch (err: any) {
    console.error('[Enquiries Route] Create failed:', err);
    res.status(500).json({ error: err.message || 'Failed to create enquiry.' });
  }
});

/**
 * GET /api/enquiries
 * List enquiries
 */
enquiriesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { status, limit = 100 } = req.query;
    const db = await dbManager.getConnection();

    let query = 'SELECT * FROM medicine_enquiries';
    const params: any[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit) || 100);

    const enquiries = await db.all(query, params);
    res.json({ success: true, enquiries });
  } catch (err: any) {
    console.error('[Enquiries Route] List failed:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch enquiries.' });
  }
});

/**
 * GET /api/enquiries/panel
 * Grouped-by-phone enquiries panel (mirrors refills /panel)
 */
enquiriesRouter.get('/panel', async (req: Request, res: Response) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(`
      SELECT e.*, c.name as customer_name, m.manufacturer
      FROM medicine_enquiries e
      LEFT JOIN customers c ON c.id = e.customer_id
      LEFT JOIN medicines m ON m.id = e.medicine_id
      WHERE e.status IN ('open', 'answered')
      ORDER BY e.created_at DESC
    `);

    // Group by phone (or id if phone is missing)
    const grouped = new Map<string, any>();
    for (const r of rows) {
      const key = r.patient_phone || `walkin-${r.id}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          patient_name: r.patient_name || r.customer_name || 'Walk-in',
          patient_phone: r.patient_phone,
          customer_id: r.customer_id,
          enquiries: []
        });
      }
      grouped.get(key).enquiries.push(r);
    }

    res.json({
      success: true,
      patients: Array.from(grouped.values())
    });
  } catch (err: any) {
    console.error('[Enquiries Route] Panel fetch failed:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch enquiries panel.' });
  }
});

/**
 * GET /api/enquiries/browse
 * Dosage-based browsing without requiring free text search
 */
enquiriesRouter.get('/browse', async (req: Request, res: Response) => {
  try {
    const group = ((req.query.group as string) || 'ALL').toUpperCase() as DosageGroup;
    const q = (req.query.q as string || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const db = await dbManager.getConnection();
    const groupFilter = getGroupSqlFilter(group, 'm.dosage_form');

    let whereSql = groupFilter.sql;
    const params = [...groupFilter.params];

    if (q) {
      whereSql += ` AND (m.name LIKE ? COLLATE NOCASE)`;
      params.push(`${q}%`);
    }

    const items = await db.all(
      `SELECT m.id, m.name, m.manufacturer, m.dosage_form, m.mrp, m.packaging,
              COALESCE(SUM(CASE WHEN im.is_active = 1 THEN (im.quantity + COALESCE(im.loose_quantity, 0)) ELSE 0 END), 0) as stock
       FROM medicines m
       LEFT JOIN inventory_master im ON im.medicine_id = m.id
       WHERE ${whereSql}
       GROUP BY m.id
       ORDER BY m.name ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      group,
      page,
      items: items.map((it: any) => ({
        id: it.id,
        name: it.name,
        manufacturer: it.manufacturer,
        dosage_form: it.dosage_form,
        mrp: it.mrp,
        packaging: it.packaging,
        stock: it.stock,
        availability: it.stock > 0 ? 'IN_STOCK' : 'REGISTERED_NO_STOCK'
      }))
    });
  } catch (err: any) {
    console.error('[Enquiries Route] Browse failed:', err);
    res.status(500).json({ error: err.message || 'Failed to browse medicines.' });
  }
});

/**
 * POST /api/enquiries/:id/answer
 * Manual-only WhatsApp reply with truthful MRP and Google verify link
 */
enquiriesRouter.post('/:id/answer', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const db = await dbManager.getConnection();
    const enquiry = await db.get('SELECT * FROM medicine_enquiries WHERE id = ?', [id]);

    if (!enquiry) {
      res.status(404).json({ error: 'Enquiry not found.' });
      return;
    }

    if (!enquiry.patient_phone) {
      res.status(400).json({ error: 'Enquiry has no valid patient phone number for WhatsApp.' });
      return;
    }

    const mrpStr = enquiry.mrp ? `₹${Number(enquiry.mrp).toFixed(2)}` : 'MRP on enquiry';
    const verifyLink = `https://www.google.com/search?q=${encodeURIComponent(enquiry.medicine_name + ' MRP')}`;
    const text = `Hello ${enquiry.patient_name},\nRegarding your enquiry for *${enquiry.medicine_name}* (${enquiry.dosage_group}):\n• MRP: ${mrpStr}\n• Verify: ${verifyLink}\n\nReply 1 to book order, or 2 to cancel.`;

    await whatsappQueueWorker.enqueue(
      enquiry.patient_phone,
      text,
      'enquiry_answer',
      enquiry.patient_name
    );

    await db.run(
      `UPDATE medicine_enquiries SET status = 'answered', answered_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [id]
    );

    eventService.broadcast('enquiry_updated', { id, status: 'answered' });
    res.json({ success: true, message: 'Answer queued on WhatsApp.' });
  } catch (err: any) {
    console.error('[Enquiries Route] Answer failed:', err);
    res.status(500).json({ error: err.message || 'Failed to answer enquiry.' });
  }
});

/**
 * POST /api/enquiries/:id/convert-to-order
 * Converts enquiry into special_orders
 */
enquiriesRouter.post('/:id/convert-to-order', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const db = await dbManager.getConnection();
    const enquiry = await db.get('SELECT * FROM medicine_enquiries WHERE id = ?', [id]);

    if (!enquiry) {
      res.status(404).json({ error: 'Enquiry not found.' });
      return;
    }

    // Schedule order
    const schedule = await orderScheduleService.calculateOrderSchedule(enquiry.store_id || 1);

    const insertResult = await db.run(
      `INSERT INTO special_orders (
        store_id, customer_id, medicine_id, requester, phone,
        product, medicine_name, qty, pharmarack_mrp, status,
        source, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'enquiry', ?)`,
      [
        enquiry.store_id || 1,
        enquiry.customer_id || null,
        enquiry.medicine_id || null,
        enquiry.patient_name,
        enquiry.patient_phone,
        enquiry.medicine_name,
        enquiry.medicine_name,
        enquiry.qty || 1,
        enquiry.mrp || null,
        `Converted from enquiry #${id}. Est. delivery: ${schedule.estimatedDeliveryWindowFormatted}`
      ]
    );

    const orderId = insertResult.lastID;

    await db.run(
      `UPDATE medicine_enquiries
       SET status = 'converted', converted_order_id = ?, converted_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [orderId, id]
    );

    eventService.broadcast('order_updated', { orderId });
    eventService.broadcast('enquiry_updated', { id, status: 'converted', orderId });

    res.json({
      success: true,
      orderId,
      message: 'Enquiry successfully converted to special order.'
    });
  } catch (err: any) {
    console.error('[Enquiries Route] Convert to order failed:', err);
    res.status(500).json({ error: err.message || 'Failed to convert enquiry to order.' });
  }
});

/**
 * POST /api/enquiries/:id/convert-to-refill
 * Converts enquiry into patient_refills
 */
enquiriesRouter.post('/:id/convert-to-refill', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { nextRefillDate, daysInterval = 30 } = req.body;
    const db = await dbManager.getConnection();
    const enquiry = await db.get('SELECT * FROM medicine_enquiries WHERE id = ?', [id]);

    if (!enquiry) {
      res.status(404).json({ error: 'Enquiry not found.' });
      return;
    }

    if (!enquiry.medicine_id) {
      res.status(400).json({ error: 'Cannot register refill without a linked master medicine ID.' });
      return;
    }

    const calculatedDate = nextRefillDate || new Date(Date.now() + Number(daysInterval) * 86400000).toISOString().split('T')[0];

    const refillResult = await db.run(
      `INSERT INTO patient_refills (
        patient_name, patient_phone, medicine_id, medicine_name,
        dosage, quantity, next_refill_date, refill_interval_days, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        enquiry.patient_name,
        enquiry.patient_phone || '',
        enquiry.medicine_id,
        enquiry.medicine_name,
        enquiry.dosage_group || 'TAB',
        enquiry.qty || 1,
        calculatedDate,
        Number(daysInterval) || 30
      ]
    );

    const refillId = refillResult.lastID;

    await db.run(
      `UPDATE medicine_enquiries
       SET status = 'converted', converted_refill_ids = ?, converted_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [JSON.stringify([refillId]), id]
    );

    eventService.broadcast('refill_updated', { refillId });
    eventService.broadcast('enquiry_updated', { id, status: 'converted', refillId });

    res.json({
      success: true,
      refillId,
      message: 'Enquiry successfully registered as recurring patient refill.'
    });
  } catch (err: any) {
    console.error('[Enquiries Route] Convert to refill failed:', err);
    res.status(500).json({ error: err.message || 'Failed to convert enquiry to refill.' });
  }
});

/**
 * POST /api/enquiries/:id/close
 */
enquiriesRouter.post('/:id/close', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const db = await dbManager.getConnection();
    await db.run(`UPDATE medicine_enquiries SET status = 'closed', updated_at = datetime('now', 'localtime') WHERE id = ?`, [id]);
    eventService.broadcast('enquiry_updated', { id, status: 'closed' });
    res.json({ success: true, message: 'Enquiry closed.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/enquiries/:id/cancel
 */
enquiriesRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const db = await dbManager.getConnection();
    await db.run(`UPDATE medicine_enquiries SET status = 'cancelled', updated_at = datetime('now', 'localtime') WHERE id = ?`, [id]);
    eventService.broadcast('enquiry_updated', { id, status: 'cancelled' });
    res.json({ success: true, message: 'Enquiry cancelled.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default enquiriesRouter;
