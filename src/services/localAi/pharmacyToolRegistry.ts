/**
 * Scoped Pharmacy Tool Registry
 *
 * Exposes strictly bounded, typed tool functions over existing canonical application services:
 * - Refill lookup and execution (patient_refills, refillCartService)
 * - Catalog stock & public price verification (medicines, pharmacyKnowledgeRetriever)
 * - Customer enquiries (medicine_enquiries)
 * - Call tasks & follow-ups (patient_call_tasks)
 * - Pharmacist escalation and takeover
 *
 * Safety & Privacy Controls:
 * - Unrestricted generated SQL is STRICTLY FORBIDDEN.
 * - Customer-facing outputs NEVER leak wholesale rates (PTR), supplier costs, or internal margins.
 * - Consequential mutations require explicit confirmation (Rule 6 Human-in-the-Loop).
 * - Full audit trail recorded for all executed mutations via logMutationAudit.
 */

import { dbManager } from '../../database/connection.js';
import { logMutationAudit } from '../auditLoggerService.js';
import { pharmacyKnowledgeRetriever } from './pharmacyKnowledgeRetriever.js';
import { eventService } from '../eventService.js';

export interface RefillRecordItem {
  id: number;
  medicineName: string;
  quantityNeeded: number;
  nextRefillDate: string | null;
  status: string;
  isReady: boolean;
  inStock: boolean;
  totalStock: number;
  pricePerUnit: number;
}

export interface MedicineAvailabilityItem {
  id: number;
  name: string;
  genericName?: string;
  dosageForm?: string;
  strength?: string;
  packSize?: string;
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
  stockQuantity: number;
  rackLocation?: string;
}

export class PharmacyToolRegistry {
  /**
   * Retrieves active chronic refills for a verified customer phone/ID
   */
  public async lookupPatientRefills(
    phone: string,
    customerId?: number | null,
    dbInstance?: any
  ): Promise<RefillRecordItem[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const raw = String(phone || '').replace(/\D/g, '');
    const cleanPhone = raw.length >= 10 ? raw.slice(-10) : raw;

    let query = `
      SELECT pr.id, pr.patient_name, pr.patient_phone, pr.quantity_needed,
             pr.next_refill_date, pr.status, pr.is_ready, pr.medicine_name,
             m.name as catalog_med, m.sell_price, m.mrp, m.total_stock
      FROM patient_refills pr
      LEFT JOIN medicines m ON pr.medicine_id = m.id
      WHERE (pr.is_active = 1 OR pr.is_active IS NULL)
        AND pr.status NOT IN ('completed', 'canceled', 'cancelled')
        AND (
          pr.patient_phone LIKE ? OR pr.patient_phone = ?
          ${customerId ? 'OR pr.customer_id = ?' : ''}
        )
      ORDER BY pr.next_refill_date ASC LIMIT 10
    `;

    const params: any[] = [`%${cleanPhone}`, cleanPhone];
    if (customerId) params.push(customerId);

    const rows = await db.all(query, params).catch(() => []);

    return rows.map((r: any) => ({
      id: r.id,
      medicineName: r.medicine_name || r.catalog_med || 'Medicine',
      quantityNeeded: r.quantity_needed || 1,
      nextRefillDate: r.next_refill_date ? String(r.next_refill_date).slice(0, 10) : null,
      status: r.status || 'pending',
      isReady: Boolean(r.is_ready),
      inStock: Number(r.total_stock || 0) >= Number(r.quantity_needed || 1),
      totalStock: Number(r.total_stock || 0),
      pricePerUnit: Number(r.sell_price || r.mrp || 0)
    }));
  }

  /**
   * Authoritative medicine search with customer-safe pricing (PTR/costs strictly masked)
   */
  public async searchMedicineAvailability(
    queryText: string,
    dbInstance?: any
  ): Promise<MedicineAvailabilityItem[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const evidence = await pharmacyKnowledgeRetriever.retrieveMedicineEvidence(queryText, db);

    return evidence.map(m => ({
      id: m.id,
      name: m.name,
      genericName: m.genericName,
      dosageForm: m.dosageForm,
      strength: m.strength,
      packSize: m.packSize,
      mrp: m.mrp,
      sellingPrice: m.sellingPrice,
      inStock: m.inStock,
      stockQuantity: m.stockQuantity,
      rackLocation: m.rackLocation
    }));
  }

  /**
   * Confirms a refill request and stages it for dispensing (Rule 6 verified execution)
   */
  public async confirmRefillExecution(
    refillId: number,
    phone: string,
    options: {
      qty?: number;
      actorName?: string;
      channel?: string;
      dbInstance?: any;
    } = {}
  ): Promise<{ success: boolean; message: string; refill?: RefillRecordItem }> {
    const db = options.dbInstance || (await dbManager.getConnection());
    const raw = String(phone || '').replace(/\D/g, '');
    const cleanPhone = raw.length >= 10 ? raw.slice(-10) : raw;

    // Verify refill exists and belongs to this phone number
    const refill = await db.get(
      `SELECT pr.*, m.name as catalog_med, m.sell_price, m.total_stock
       FROM patient_refills pr
       LEFT JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.id = ? AND (pr.patient_phone LIKE ? OR pr.patient_phone = ?) LIMIT 1`,
      [refillId, `%${cleanPhone}`, cleanPhone]
    ).catch(() => null);

    if (!refill) {
      return {
        success: false,
        message: `Refill #${refillId} could not be verified for phone number ${cleanPhone}.`
      };
    }

    const medName = refill.medicine_name || refill.catalog_med || 'Medicine';
    const quantity = options.qty || refill.quantity_needed || 1;

    // Try canonical live cart insertion if supported, else mark ready for pharmacy dispensing
    let cartMsg = '';
    try {
      const { processRefillCartItem } = await import('../refillCartService.js');
      const cartResult = await processRefillCartItem(refillId, { qty: quantity, dryRun: false });
      if (cartResult.status === 'added' || cartResult.status === 'in_cart') {
        cartMsg = ` (Live Cart updated: ${cartResult.message})`;
      }
    } catch (_) {}

    await db.run(
      `UPDATE patient_refills
       SET is_ready = 1, status = 'ready', patient_confirmed = 1
       WHERE id = ?`,
      [refillId]
    );

    await logMutationAudit({
      storeId: 1,
      userId: undefined,
      username: options.actorName || 'customer_assistant',
      action: 'CONFIRM_REFILL',
      entity: 'patient_refills',
      entityId: refillId,
      description: `Customer confirmed Refill #${refillId} (${medName}, Qty: ${quantity}) via ${options.channel || 'chat'}${cartMsg}`
    });

    eventService.broadcast('refill_updated', { refillId, is_ready: 1, patient_confirmed: 1 });

    return {
      success: true,
      message: `Your refill for ${medName} (Qty: ${quantity}) has been confirmed and is now staged for dispensing!${cartMsg}`,
      refill: {
        id: refill.id,
        medicineName: medName,
        quantityNeeded: quantity,
        nextRefillDate: refill.next_refill_date ? String(refill.next_refill_date).slice(0, 10) : null,
        status: 'ready',
        isReady: true,
        inStock: Number(refill.total_stock || 0) >= quantity,
        totalStock: Number(refill.total_stock || 0),
        pricePerUnit: Number(refill.sell_price || 0)
      }
    };
  }

  /**
   * Records a customer enquiry for an unstocked or requested medicine
   */
  public async createCustomerEnquiry(
    patientName: string,
    patientPhone: string,
    medicineName: string,
    notes?: string,
    dbInstance?: any
  ): Promise<{ success: boolean; enquiryId: number; message: string }> {
    const db = dbInstance || (await dbManager.getConnection());

    const result = await db.run(
      `INSERT INTO medicine_enquiries
         (patient_name, patient_phone, medicine_name, source, notes, status)
       VALUES (?, ?, ?, 'whatsapp', ?, 'open')`,
      [patientName || 'Customer', patientPhone || null, medicineName.trim(), notes || null]
    );

    const enquiryId = Number(result.lastID);

    await logMutationAudit({
      storeId: 1,
      userId: undefined,
      username: 'conversational_agent',
      action: 'CREATE_ENQUIRY',
      entity: 'medicine_enquiries',
      entityId: enquiryId,
      description: `AI recorded medicine enquiry #${enquiryId} for ${patientName} (${medicineName})`
    });

    return {
      success: true,
      enquiryId,
      message: `Enquiry #${enquiryId} for "${medicineName}" has been recorded. Our pharmacy team will check distributor availability.`
    };
  }

  /**
   * Schedules a follow-up callback or reminder task for pharmacy staff
   */
  public async scheduleCallTask(
    patientName: string,
    patientPhone: string,
    details: string,
    priority: 'normal' | 'high' = 'normal',
    dbInstance?: any
  ): Promise<{ success: boolean; taskId: number; message: string }> {
    const db = dbInstance || (await dbManager.getConnection());

    const result = await db.run(
      `INSERT INTO patient_call_tasks
         (task_type, patient_name, patient_phone, details_json, priority, status)
       VALUES ('callback', ?, ?, ?, ?, 'pending')`,
      [patientName || 'Customer', patientPhone, JSON.stringify({ details }), priority]
    );

    const taskId = Number(result.lastID);

    await logMutationAudit({
      storeId: 1,
      userId: undefined,
      username: 'conversational_agent',
      action: 'SCHEDULE_TASK',
      entity: 'patient_call_tasks',
      entityId: taskId,
      description: `AI scheduled callback task #${taskId} for ${patientName} (${patientPhone}): ${details}`
    });

    eventService.broadcast('call_tasks_updated', { taskId, taskType: 'callback' });

    return {
      success: true,
      taskId,
      message: `A staff callback task has been scheduled for ${patientName}.`
    };
  }

  /**
   * Switches chat session to manual mode for licensed pharmacist takeover
   */
  public async escalateToPharmacist(
    phone: string,
    reason: string,
    dbInstance?: any
  ): Promise<{ success: boolean; message: string }> {
    const db = dbInstance || (await dbManager.getConnection());
    const raw = String(phone || '').replace(/\D/g, '');
    const cleanPhone = raw.length >= 10 ? raw.slice(-10) : raw;
    const chatId = `${cleanPhone}@c.us`;

    const twoHoursFromNow = Date.now() + (2 * 60 * 60 * 1000);
    await db.run(
      `UPDATE whatsapp_chats
       SET session_mode = 'manual', manual_active_until = ?, session_status = 'active'
       WHERE id = ? OR (resolved_number IS NOT NULL AND resolved_number LIKE ?)`,
      [twoHoursFromNow, chatId, `%${cleanPhone}%`]
    ).catch(() => {});

    // Create high-priority call task so staff sees the alert in CRM
    await this.scheduleCallTask(
      'Pharmacist Handover Requested',
      cleanPhone,
      `Handover reason: ${reason}`,
      'high',
      db
    ).catch(() => {});

    eventService.broadcast('wa_session_updated', {
      chat_id: chatId,
      session_mode: 'manual',
      reason
    });

    return {
      success: true,
      message: 'I have alerted our registered on-duty pharmacist to assist you directly. A team member will respond shortly.'
    };
  }
}

export const pharmacyToolRegistry = new PharmacyToolRegistry();
