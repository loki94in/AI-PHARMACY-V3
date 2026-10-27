/**
 * Shared Refill Validation & Batch Pipeline Service
 * 
 * Flowchart contract:
 * 1. Refill medicine selected -> Check booking origin (Website vs Manual CRM)
 * 2. Create Website Refill Batch (WB-...) or CRM Refill Batch (CRM-...) with source ID & batch ID.
 *    CRITICAL: Never route refill batches to the Online Orders app (special_orders).
 * 3. Shared refill validation pipeline:
 *    - Check duplicate booking and refill eligibility.
 *    - Check if quantity exceeds 2-month limit:
 *      - If YES: Hold for pharmacist reconfirmation -> QA Refill Panel: Approval Required.
 *                If approved -> release approved items to cart.
 *                If not approved -> remain on hold or reject.
 *      - If NO: Mark items eligible -> add eligible medicines to live cart.
 * 4. Add eligible selected medicines to live cart:
 *    - If cart add fails: Keep failed items visible in QA (needs_link, linked_oos, failed).
 *    - If cart add succeeds: Record successful items (added, in_cart).
 * 5. Update the relevant refill batch.
 * 6. Trigger existing notification pipeline (staged in automation_notifications).
 * 7. QA Refill Panel displays source and batch ID.
 */

import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { formatCustomerName } from '../utils/nameFormatter.js';
import { validate10DigitPhone } from '../utils/phoneValidation.js';
import { toLocalSqlDateTime } from '../utils/localTime.js';
import { processRefillCartItem, RefillCartResult } from './refillCartService.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';
import { resolveAdminWhatsappNumber } from './waAdminEscalationService.js';

export interface RefillBatchItemInput {
  medicine_id?: number;
  medicine_name: string;
  quantity: number;
  refill_id?: number;
  mrp?: number;
  sell_price?: number;
  unit_price?: number;
  packaging?: string;
  pack_size?: number;
  instructions?: string;
}

export interface CreateRefillBatchInput {
  source: 'website' | 'crm';
  source_id?: string | number | null;
  customer_id?: number | null;
  patient_name: string;
  patient_phone: string;
  store_id?: number;
  items: RefillBatchItemInput[];
  notes?: string;
  auto_dispatch?: boolean; // Defaults to true; triggers cart addition if eligible
}

export interface RefillBatchItemRecord {
  refill_id: number;
  medicine_id: number;
  medicine_name: string;
  requested_quantity: number;
  prescribed_quantity: number;
  interval_days: number;
  two_month_limit: number;
  exceeds_two_month_limit: boolean;
  approval_status: 'none' | 'required' | 'approved' | 'rejected';
  approval_reason?: string | null;
  is_duplicate: boolean;
  cart_status: 'pending' | 'added' | 'in_cart' | 'needs_link' | 'linked_oos' | 'not_found' | 'ready' | 'failed';
  cart_store_name?: string | null;
  cart_product_code?: string | null;
  cart_qty?: number | null;
  is_zero_stock?: boolean;
  error?: string | null;
}

export interface RefillBatchRecord {
  id: number;
  batch_id: string;
  source: 'website' | 'crm';
  source_id?: string | null;
  customer_id?: number | null;
  patient_name: string;
  patient_phone: string;
  store_id: number;
  status: 'pending' | 'approval_required' | 'approved' | 'rejected' | 'processing' | 'completed' | 'partially_completed' | 'failed';
  approval_status: 'none' | 'required' | 'approved' | 'rejected';
  approval_reason?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  total_items: number;
  eligible_items: number;
  added_items: number;
  failed_items: number;
  items: RefillBatchItemRecord[];
  notes?: string | null;
  created_at: string;
  updated_at: string;
  success?: boolean;
}

/**
 * Generates a unique, human-readable Refill Batch ID based on source and timestamp.
 * Example: WB-2610-8472 or CRM-2610-1923
 */
export function generateBatchId(source: 'website' | 'crm'): string {
  const prefix = source === 'website' ? 'WB' : 'CRM';
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${d}${m}-${rand}`;
}

/**
 * Calculates the strict 2-month (60-day) dosage supply limit for a refill schedule.
 * If patient takes 3 strips every 30 days -> 2-month limit = 6 strips.
 * If interval is 7 days with 1 strip -> daily rate 1/7 -> 60-day limit = 9 strips.
 */
export function calculateTwoMonthLimit(quantityNeeded: number, intervalDays: number): number {
  const safeQty = Math.max(1, Number(quantityNeeded) || 1);
  const safeInterval = Math.max(7, Number(intervalDays) || 30);
  const dailyRate = safeQty / safeInterval;
  return Math.ceil(dailyRate * 60);
}

/**
 * Shared entry point for creating and validating a Refill Batch.
 * Follows the flowchart:
 * Refill medicine selected -> Create Batch -> Shared Validation Pipeline -> Live Cart Addition.
 */
export async function createRefillBatch(input: CreateRefillBatchInput): Promise<RefillBatchRecord> {
  const db = await dbManager.getConnection();
  const source = input.source === 'website' ? 'website' : 'crm';
  const sourceId = input.source_id !== undefined && input.source_id !== null ? String(input.source_id) : null;
  const storeId = Number(input.store_id) || 1;
  const cleanName = formatCustomerName(input.patient_name || 'Customer');

  const phoneVal = validate10DigitPhone(input.patient_phone, { allowEmpty: false, requireMobile: true });
  if (!phoneVal.isValid) {
    throw new Error(`Invalid patient phone number: ${phoneVal.error || phoneVal.reason}`);
  }
  const cleanPhone = phoneVal.cleanPhone;

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Refill batch requires at least one medicine item');
  }

  // 1. Resolve or auto-create customer profile in customers table
  let customerId = input.customer_id ? Number(input.customer_id) : null;
  if (!customerId) {
    const cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
    if (cust) {
      customerId = cust.id;
    } else {
      const insRes = await db.run(
        'INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [cleanName, cleanPhone]
      );
      customerId = insRes.lastID ? Number(insRes.lastID) : null;
    }
  }

  const batchId = generateBatchId(source);

  // 2. Run Shared Refill Validation Pipeline on each item
  const validatedItems: RefillBatchItemRecord[] = [];
  let requiresApproval = false;
  const approvalReasons: string[] = [];

  for (const item of input.items) {
    const medName = String(item.medicine_name || '').trim();
    if (!medName) continue;
    const reqQty = Math.max(1, Number(item.quantity) || 1);

    // Look up or link existing refill schedule in patient_refills
    let refillRow = item.refill_id
      ? await db.get('SELECT * FROM patient_refills WHERE id = ?', [item.refill_id])
      : null;

    if (!refillRow && item.medicine_id) {
      refillRow = await db.get(
        `SELECT * FROM patient_refills 
         WHERE medicine_id = ? AND (patient_phone = ? OR (customer_id IS NOT NULL AND customer_id = ?))
         ORDER BY id DESC LIMIT 1`,
        [item.medicine_id, cleanPhone, customerId]
      );
    }

    if (!refillRow && medName) {
      refillRow = await db.get(
        `SELECT * FROM patient_refills 
         WHERE LOWER(TRIM(COALESCE(medicine_name, ''))) = LOWER(TRIM(?)) 
           AND (patient_phone = ? OR (customer_id IS NOT NULL AND customer_id = ?))
         ORDER BY id DESC LIMIT 1`,
        [medName, cleanPhone, customerId]
      );
    }

    // Resolve master medicine_id if not linked
    let medicineId = item.medicine_id || (refillRow ? refillRow.medicine_id : null);
    if (!medicineId) {
      const medMatch = await db.get('SELECT id, name FROM medicines WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [medName]);
      if (medMatch) {
        medicineId = medMatch.id;
      } else {
        // Fallback: search by prefix
        const fuzzy = await db.get('SELECT id, name FROM medicines WHERE name LIKE ? LIMIT 1', [`${medName.slice(0, 10)}%`]);
        medicineId = fuzzy ? fuzzy.id : null;
      }
    }

    // If no existing patient_refills schedule exists, register one directly
    if (!refillRow) {
      const defaultInterval = 30;
      const nextRefillDate = new Date();
      nextRefillDate.setDate(nextRefillDate.getDate() + defaultInterval);
      const nextDateStr = toLocalSqlDateTime(nextRefillDate);

      const insRefill = await db.run(
        `INSERT INTO patient_refills (
          store_id, customer_id, patient_name, patient_phone, medicine_id, medicine_name,
          refill_interval_days, next_refill_date, status, quantity_needed, is_active,
          source, source_id, batch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?, ?)`,
        [
          storeId, customerId, cleanName, cleanPhone, medicineId || 0, medName,
          defaultInterval, nextDateStr, reqQty, source, sourceId, batchId
        ]
      );
      refillRow = await db.get('SELECT * FROM patient_refills WHERE id = ?', [insRefill.lastID]);
    } else {
      // Stamp batch_id and source onto existing patient_refills row
      await db.run(
        `UPDATE patient_refills 
         SET batch_id = ?, source = ?, source_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [batchId, source, sourceId, refillRow.id]
      ).catch(() => {
        // If updated_at doesn't exist on patient_refills, run without it
        return db.run(
          `UPDATE patient_refills SET batch_id = ?, source = ?, source_id = ? WHERE id = ?`,
          [batchId, source, sourceId, refillRow.id]
        );
      });
    }

    const refillId = refillRow.id;
    const intervalDays = Number(refillRow.refill_interval_days) || 30;
    const prescribedQty = Number(refillRow.quantity_needed) || 1;

    // Check Duplicate Booking:
    // Check if another pending batch or unfulfilled refill exists for this patient & medicine created recently
    const recentDuplicate = await db.get(
      `SELECT b.batch_id, b.created_at 
       FROM refill_batches b 
       WHERE b.patient_phone = ? 
         AND b.batch_id != ? 
         AND b.status IN ('pending', 'approval_required', 'approved')
         AND b.created_at >= datetime('now', '-24 hours')
         AND b.items_json LIKE ?
       LIMIT 1`,
      [cleanPhone, batchId, `%"refill_id":${refillId}%`]
    );

    const isDuplicate = !!recentDuplicate;

    // Check 2-month quantity limit:
    const twoMonthLimit = calculateTwoMonthLimit(prescribedQty, intervalDays);
    const exceedsLimit = reqQty > twoMonthLimit;

    let itemApprovalStatus: 'none' | 'required' | 'approved' | 'rejected' = 'none';
    let itemApprovalReason: string | null = null;

    if (exceedsLimit) {
      itemApprovalStatus = 'required';
      itemApprovalReason = `Quantity ${reqQty} exceeds 2-month limit of ${twoMonthLimit} (prescribed ${prescribedQty} per ${intervalDays}d)`;
      requiresApproval = true;
      approvalReasons.push(`${medName}: ${itemApprovalReason}`);
    } else {
      itemApprovalStatus = 'approved';
    }

    // Persist approval status to patient_refills row
    await db.run(
      `UPDATE patient_refills 
       SET approval_status = ?, approval_reason = ? 
       WHERE id = ?`,
      [itemApprovalStatus, itemApprovalReason, refillId]
    );

    validatedItems.push({
      refill_id: refillId,
      medicine_id: Number(medicineId) || Number(refillRow.medicine_id) || 0,
      medicine_name: medName,
      requested_quantity: reqQty,
      prescribed_quantity: prescribedQty,
      interval_days: intervalDays,
      two_month_limit: twoMonthLimit,
      exceeds_two_month_limit: exceedsLimit,
      approval_status: itemApprovalStatus,
      approval_reason: itemApprovalReason,
      is_duplicate: isDuplicate,
      cart_status: 'pending'
    });
  }

  // 3. Batch Aggregation
  const overallApprovalStatus: 'required' | 'approved' = requiresApproval ? 'required' : 'approved';
  const overallStatus = requiresApproval ? 'approval_required' : 'pending';
  const batchApprovalReason = requiresApproval ? approvalReasons.join('; ') : null;

  const eligibleCount = validatedItems.filter(i => i.approval_status === 'approved' && !i.is_duplicate).length;

  // Insert Refill Batch record
  const batchRes = await db.run(
    `INSERT INTO refill_batches (
      batch_id, source, source_id, customer_id, patient_name, patient_phone, store_id,
      status, approval_status, approval_reason, total_items, eligible_items, added_items,
      failed_items, items_json, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      batchId,
      source,
      sourceId,
      customerId,
      cleanName,
      cleanPhone,
      storeId,
      overallStatus,
      overallApprovalStatus,
      batchApprovalReason,
      validatedItems.length,
      eligibleCount,
      JSON.stringify(validatedItems),
      input.notes || null
    ]
  );

  const batchRecord: RefillBatchRecord = {
    id: Number(batchRes.lastID),
    batch_id: batchId,
    source,
    source_id: sourceId,
    customer_id: customerId,
    patient_name: cleanName,
    patient_phone: cleanPhone,
    store_id: storeId,
    status: overallStatus,
    approval_status: overallApprovalStatus,
    approval_reason: batchApprovalReason,
    total_items: validatedItems.length,
    eligible_items: eligibleCount,
    added_items: 0,
    failed_items: 0,
    items: validatedItems,
    notes: input.notes || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Broadcast refill update event immediately so QA Refill Panel refreshes
  eventService.broadcast('refill_updated', {
    at: Date.now(),
    batch_id: batchId,
    source,
    approval_status: overallApprovalStatus
  });

  // 4. If all items are eligible (none on hold for approval) and auto_dispatch is true,
  // add eligible medicines to live cart immediately.
  const shouldAutoDispatch = input.auto_dispatch !== false && !requiresApproval;
  if (shouldAutoDispatch && eligibleCount > 0) {
    await dispatchBatchEligibleItemsToCart(batchId);
  }

  const updated = await getRefillBatch(batchId);
  return updated || batchRecord;
}

/**
 * Adds eligible selected medicines in a refill batch to the live Pharmarack cart.
 * If cart add fails: Keep failed items visible in QA with truthful status (needs_link, linked_oos, failed).
 * If cart add succeeds: Record successful items (added, in_cart) and stamp patient_refills.
 */
export async function dispatchBatchEligibleItemsToCart(batchId: string): Promise<{
  batch_id: string;
  added_count: number;
  failed_count: number;
  results: Array<{ refill_id: number; medicine_name: string; status: string; message: string }>;
}> {
  const db = await dbManager.getConnection();
  const batch = await db.get('SELECT * FROM refill_batches WHERE batch_id = ?', [batchId]);
  if (!batch) {
    throw new Error(`Refill batch not found: ${batchId}`);
  }

  let items: RefillBatchItemRecord[] = [];
  try {
    items = JSON.parse(batch.items_json || '[]');
  } catch (_) {
    items = [];
  }

  let addedCount = 0;
  let failedCount = 0;
  const results: Array<{ refill_id: number; medicine_name: string; status: string; message: string }> = [];

  for (const item of items) {
    // Only dispatch approved/eligible items that aren't duplicates
    if (item.approval_status !== 'approved' || item.is_duplicate) {
      continue;
    }

    try {
      // Call standard live cart item processor
      const cartRes: RefillCartResult = await processRefillCartItem(item.refill_id, { dryRun: false });
      const status = cartRes.status;

      if (status === 'added' || status === 'in_cart') {
        addedCount++;
        item.cart_status = status;
        if (cartRes.line) {
          item.cart_store_name = cartRes.line.storeName;
          item.cart_qty = cartRes.line.qty;
        } else if (cartRes.linked && cartRes.linked.length > 0) {
          item.cart_store_name = cartRes.linked[0].storeName;
        }
      } else {
        // Keep failed items visible in QA! Do not drop or silently ignore.
        failedCount++;
        item.cart_status = status;
        item.error = cartRes.message;
        const isZeroStock = status === 'linked_oos' || /zero stock|out of stock|oos|0 stock/i.test(cartRes.message || '');
        if (isZeroStock) {
          item.is_zero_stock = true;
        }
      }

      results.push({
        refill_id: item.refill_id,
        medicine_name: item.medicine_name,
        status: item.cart_status,
        message: cartRes.message
      });
    } catch (err: any) {
      failedCount++;
      item.cart_status = 'failed';
      item.error = err.message || 'Cart addition failed';
      if (/zero stock|out of stock|oos|0 stock/i.test(err.message || '')) {
        item.is_zero_stock = true;
      }
      results.push({
        refill_id: item.refill_id,
        medicine_name: item.medicine_name,
        status: 'failed',
        message: err.message || 'Cart addition failed'
      });
    }
  }

  // Determine updated batch status
  let finalStatus: RefillBatchRecord['status'] = 'completed';
  if (failedCount > 0 && addedCount > 0) finalStatus = 'partially_completed';
  else if (failedCount > 0 && addedCount === 0) finalStatus = 'failed';
  else if (batch.approval_status === 'required') finalStatus = 'approval_required';

  await db.run(
    `UPDATE refill_batches 
     SET added_items = ?, failed_items = ?, items_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE batch_id = ?`,
    [addedCount, failedCount, JSON.stringify(items), finalStatus, batchId]
  );

  eventService.broadcast('refill_updated', {
    at: Date.now(),
    batch_id: batchId,
    status: finalStatus,
    added_count: addedCount,
    failed_count: failedCount
  });

  // Node I & N: Create / update QA Refill Task for successfully processed / batch items
  try {
    const existingQaTask = await db.get(
      `SELECT id FROM patient_call_tasks WHERE reference_id = ? AND task_type = 'refill_qa'`,
      [batchId]
    );
    const qaTaskDetails = {
      batch_id: batchId,
      source: batch.source,
      patient_name: batch.patient_name,
      patient_phone: batch.patient_phone,
      added_count: addedCount,
      failed_count: failedCount,
      total_items: items.length,
      medicines: items.map(it => ({
        name: it.medicine_name,
        qty: it.cart_qty || it.requested_quantity,
        status: it.cart_status,
        distributor: it.cart_store_name || null,
        is_zero_stock: it.is_zero_stock || it.cart_status === 'linked_oos',
        error: it.error || null
      }))
    };
    if (!existingQaTask) {
      await db.run(
        `INSERT INTO patient_call_tasks 
         (task_type, patient_name, patient_phone, reference_id, details_json, status, priority, created_at, updated_at)
         VALUES ('refill_qa', ?, ?, ?, ?, 'pending', 'normal', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [batch.patient_name, batch.patient_phone, batchId, JSON.stringify(qaTaskDetails)]
      );
      eventService.broadcast('call_tasks_updated', { at: Date.now(), batch_id: batchId, task_type: 'refill_qa' });
    } else {
      await db.run(
        `UPDATE patient_call_tasks SET details_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(qaTaskDetails), existingQaTask.id]
      );
    }
  } catch (qaTaskErr: any) {
    console.warn('[RefillBatchService] Note creating QA refill task:', qaTaskErr.message);
  }

  // Node J, K, L, M: Notify Owner of batch outcome with medicine breakdown, zero stock & non-WA detection
  const updatedBatchRecord = await getRefillBatch(batchId);
  if (updatedBatchRecord) {
    try {
      await notifyOwnerOfRefillBatchOutcome(updatedBatchRecord, items);
    } catch (ownerNotifErr: any) {
      console.warn('[RefillBatchService] Error notifying owner of batch outcome:', ownerNotifErr.message);
    }

    // Node O: All Medicines Successfully Processed?
    if (failedCount === 0 && addedCount > 0) {
      // Node P: Send Existing Patient Live Cart Notification
      await stageBatchRefillNotification(updatedBatchRecord);
    } else {
      // Node Q: Do Not Send Patient Live Cart Notification
      console.log(`[RefillBatch] Partial/failed cart items detected (${failedCount} failed of ${items.length}) for batch ${batchId}. Suppressed patient notification per flowchart Node Q.`);
    }
  }

  return { batch_id: batchId, added_count: addedCount, failed_count: failedCount, results };
}

/**
 * Pharmacist approval action for a held Refill Batch.
 * Releases approved items and triggers live cart addition.
 */
export async function approveRefillBatch(
  batchId: string,
  optsOrApprover?: string | { approvedBy?: string; rejectedItemIds?: number[] }
): Promise<RefillBatchRecord> {
  const opts = typeof optsOrApprover === 'string'
    ? { approvedBy: optsOrApprover }
    : (optsOrApprover || {});
  const db = await dbManager.getConnection();
  const batch = await db.get('SELECT * FROM refill_batches WHERE batch_id = ?', [batchId]);
  if (!batch) {
    throw new Error(`Refill batch not found: ${batchId}`);
  }

  let items: RefillBatchItemRecord[] = [];
  try {
    items = JSON.parse(batch.items_json || '[]');
  } catch (_) {
    items = [];
  }

  const rejectedSet = new Set(opts.rejectedItemIds || []);
  const approver = opts.approvedBy || 'Pharmacist';

  for (const it of items) {
    if (rejectedSet.has(it.refill_id)) {
      it.approval_status = 'rejected';
      it.approval_reason = 'Rejected by pharmacist';
    } else {
      it.approval_status = 'approved';
    }
    // Update patient_refills row
    await db.run(
      `UPDATE patient_refills SET approval_status = ?, approval_reason = NULL WHERE id = ?`,
      [it.approval_status, it.refill_id]
    );
  }

  const hasAnyApproved = items.some(i => i.approval_status === 'approved');
  const overallApproval: 'approved' | 'rejected' = hasAnyApproved ? 'approved' : 'rejected';
  const overallStatus = hasAnyApproved ? 'approved' : 'rejected';

  await db.run(
    `UPDATE refill_batches 
     SET approval_status = ?, status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP,
         items_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE batch_id = ?`,
    [overallApproval, overallStatus, approver, JSON.stringify(items), batchId]
  );

  // If approved, release approved items to live cart
  if (hasAnyApproved) {
    await dispatchBatchEligibleItemsToCart(batchId);
  }

  eventService.broadcast('refill_updated', {
    at: Date.now(),
    batch_id: batchId,
    action: 'approved',
    approved_by: approver
  });

  const updated = await getRefillBatch(batchId);
  if (!updated) throw new Error('Failed to retrieve updated batch');
  return { ...updated, success: true };
}

/**
 * Pharmacist rejection action for a held Refill Batch.
 * Remains on hold or marks items as rejected.
 */
export async function rejectRefillBatch(
  batchId: string,
  optsOrRejector?: string | { reason?: string; rejectedBy?: string },
  maybeReason?: string
): Promise<RefillBatchRecord> {
  let opts: { reason?: string; rejectedBy?: string } = {};
  if (typeof optsOrRejector === 'string') {
    opts = { rejectedBy: optsOrRejector, reason: maybeReason || 'Rejected by pharmacist' };
  } else if (optsOrRejector) {
    opts = optsOrRejector;
  }
  const db = await dbManager.getConnection();
  const batch = await db.get('SELECT * FROM refill_batches WHERE batch_id = ?', [batchId]);
  if (!batch) {
    throw new Error(`Refill batch not found: ${batchId}`);
  }

  let items: RefillBatchItemRecord[] = [];
  try {
    items = JSON.parse(batch.items_json || '[]');
  } catch (_) {
    items = [];
  }

  const reason = opts.reason || 'Rejected by pharmacist';
  const rejector = opts.rejectedBy || 'Pharmacist';

  for (const it of items) {
    it.approval_status = 'rejected';
    it.approval_reason = reason;
    await db.run(
      `UPDATE patient_refills SET approval_status = 'rejected', approval_reason = ? WHERE id = ?`,
      [reason, it.refill_id]
    );
  }

  await db.run(
    `UPDATE refill_batches 
     SET approval_status = 'rejected', status = 'rejected', approval_reason = ?,
         approved_by = ?, updated_at = CURRENT_TIMESTAMP, items_json = ?
     WHERE batch_id = ?`,
    [reason, rejector, JSON.stringify(items), batchId]
  );

  eventService.broadcast('refill_updated', {
    at: Date.now(),
    batch_id: batchId,
    action: 'rejected',
    reason
  });

  const updated = await getRefillBatch(batchId);
  if (!updated) throw new Error('Failed to retrieve updated batch');
  return { ...updated, success: true };
}

/**
 * Retrieves a single Refill Batch record by Batch ID.
 */
export async function getRefillBatch(batchId: string): Promise<RefillBatchRecord | null> {
  const db = await dbManager.getConnection();
  const row = await db.get('SELECT * FROM refill_batches WHERE batch_id = ? LIMIT 1', [batchId]);
  if (!row) return null;

  let items: RefillBatchItemRecord[] = [];
  try {
    items = JSON.parse(row.items_json || '[]');
  } catch (_) {
    items = [];
  }

  return {
    ...row,
    items
  };
}

/**
 * Lists active refill batches (e.g. for QA Refill Panel or CRM management).
 */
export async function listRefillBatches(opts: { status?: string; limit?: number } = {}): Promise<RefillBatchRecord[]> {
  const db = await dbManager.getConnection();
  const limit = Math.min(100, Number(opts.limit) || 50);

  let query = 'SELECT * FROM refill_batches';
  const params: any[] = [];

  if (opts.status) {
    query += ' WHERE status = ?';
    params.push(opts.status);
  }
  query += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  const rows = await db.all(query, params);
  return rows.map((r: any) => {
    let items: RefillBatchItemRecord[] = [];
    try {
      items = JSON.parse(r.items_json || '[]');
    } catch (_) {
      items = [];
    }
    return {
      ...r,
      items
    };
  });
}

/**
 * Notifies the pharmacy owner of successful and failed medicines in a refill batch.
 * Contract (Flowchart Nodes J, K, L, M):
 * - Includes medicine names and distributor details (Node K)
 * - Identifies distributor confirmed zero stock (Node L)
 * - Saves non-WhatsApp contacts for manual follow-up (Node M)
 */
export async function notifyOwnerOfRefillBatchOutcome(
  batch: RefillBatchRecord,
  items: RefillBatchItemRecord[]
): Promise<void> {
  const db = await dbManager.getConnection();
  const adminPhone = await resolveAdminWhatsappNumber(db);
  if (!adminPhone) {
    console.warn(`[RefillBatchService] Owner WhatsApp notification skipped for batch #${batch.batch_id}: No admin WhatsApp number configured in Settings.`);
    return;
  }

  const addedItems = items.filter(it => it.cart_status === 'added' || it.cart_status === 'in_cart');
  const failedItems = items.filter(it => it.cart_status !== 'added' && it.cart_status !== 'in_cart');

  // Node M: Validate if patient phone is a WhatsApp-capable mobile number
  const phoneValidation = validate10DigitPhone(batch.patient_phone, { allowEmpty: false, requireMobilePrefix: true });
  const isNonWa = !phoneValidation.isValid;

  if (isNonWa) {
    try {
      // 1. Create a high-priority call task for manual telephone follow-up
      const existingCallTask = await db.get(
        `SELECT id FROM patient_call_tasks WHERE reference_id = ? AND task_type = 'refill_non_wa_followup'`,
        [batch.batch_id]
      );
      if (!existingCallTask) {
        await db.run(
          `INSERT INTO patient_call_tasks 
           (task_type, patient_name, patient_phone, reference_id, details_json, status, priority, created_at, updated_at)
           VALUES ('refill_non_wa_followup', ?, ?, ?, ?, 'pending', 'high', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            batch.patient_name,
            phoneValidation.cleanPhone || batch.patient_phone,
            batch.batch_id,
            JSON.stringify({
              reason: 'Non-WhatsApp contact for refill batch. Manual telephone follow-up required.',
              batch_id: batch.batch_id,
              patient_name: batch.patient_name,
              patient_phone: batch.patient_phone,
              total_items: items.length
            })
          ]
        );
        eventService.broadcast('call_tasks_updated', { at: Date.now(), batch_id: batch.batch_id, type: 'refill_non_wa_followup' });
      }

      // 2. Update contacts table notes if patient contact exists
      const cleanDigits = (batch.patient_phone || '').replace(/\D/g, '').slice(-10);
      if (cleanDigits.length >= 7) {
        await db.run(
          `UPDATE contacts 
           SET notes = CASE 
             WHEN notes IS NULL OR notes = '' THEN 'Non-WhatsApp Contact: Manual telephone follow-up required.'
             WHEN notes LIKE '%Non-WhatsApp%' THEN notes
             ELSE notes || ' | Non-WhatsApp Contact: Manual telephone follow-up required.'
           END
           WHERE phone LIKE ?`,
          [`%${cleanDigits}%`]
        ).catch(() => {});
      }
    } catch (nonWaErr: any) {
      console.warn('[RefillBatchService] Note saving non-WhatsApp follow-up:', nonWaErr.message);
    }
  }

  // Compose Owner WhatsApp Message (Nodes J, K, L, M)
  const sourceLabel = batch.source === 'website' ? 'Website Refill' : 'Manual CRM Refill';
  const lines: string[] = [
    `📋 *Refill Batch Outcome (${sourceLabel} #${batch.batch_id})*`,
    `👤 *Patient:* ${batch.patient_name} (${batch.patient_phone})`,
    `📦 *Total Items:* ${items.length} (${addedItems.length} added to live cart, ${failedItems.length} failed/unresolved)`
  ];

  // Node K: Successfully processed medicines with distributor details
  if (addedItems.length > 0) {
    lines.push(`\n✅ *Added to Live Cart (${addedItems.length}):*`);
    for (const it of addedItems) {
      const dist = it.cart_store_name ? ` [Distributor: ${it.cart_store_name}]` : '';
      const qty = it.cart_qty ?? it.requested_quantity;
      lines.push(`• *${it.medicine_name}* × ${qty}${dist}`);
    }
  }

  // Node K & L: Failed medicines with failure cause and confirmed distributor zero stock
  if (failedItems.length > 0) {
    lines.push(`\n❌ *Failed / Needs Attention (${failedItems.length}):*`);
    for (const it of failedItems) {
      const isZeroStock = it.is_zero_stock || it.cart_status === 'linked_oos' || /zero stock|out of stock|oos|0 stock/i.test(it.error || '');
      const dist = it.cart_store_name ? ` (${it.cart_store_name})` : '';
      if (isZeroStock) {
        lines.push(`• *${it.medicine_name}* (Qty: ${it.requested_quantity})${dist}\n   🔴 *Distributor Confirmed ZERO STOCK (OOS)*`);
      } else {
        const reason = it.error || (it.cart_status === 'needs_link' ? 'Distributor link required' : it.cart_status);
        lines.push(`• *${it.medicine_name}* (Qty: ${it.requested_quantity})${dist}\n   ⚠️ ${reason}`);
      }
    }
  }

  // Node M: Non-WhatsApp notice
  if (isNonWa) {
    lines.push(`\n📞 *Non-WhatsApp Contact Alert:*`);
    lines.push(`Patient phone is not a WhatsApp mobile number. Saved on Call Tasks board for manual telephone follow-up.`);
  }

  const msg = lines.join('\n');
  try {
    await whatsappQueueWorker.enqueue(adminPhone, msg, 'admin_alert', 'Pharmacy Owner');
    console.log(`[RefillBatchService] Enqueued owner outcome notification for batch #${batch.batch_id} to ${adminPhone}`);
  } catch (err: any) {
    console.warn(`[RefillBatchService] Could not enqueue owner notification for batch #${batch.batch_id}:`, err.message);
  }
}

/**
 * Stages a refill batch confirmation notification in automation_notifications.
 * Adheres strictly to the Manual-Only Patient Messaging Contract (D4 / AGENTS.md rule).
 * Node P: Only invoked when all medicines are successfully processed.
 */
async function stageBatchRefillNotification(batch: RefillBatchRecord): Promise<void> {
  const db = await dbManager.getConnection();
  try {
    const medList = batch.items.map(m => `• ${m.medicine_name} (Qty: ${m.requested_quantity})`).join('\n');
    const msg = `🔔 *Refill Request Received (${batch.source === 'website' ? 'Website' : 'CRM'} Batch #${batch.batch_id})*\n\nHello ${batch.patient_name},\nWe have received your refill request for:\n\n${medList}\n\nOur pharmacy is preparing your order. Your medicines have been added to our live cart.`;

    await db.run(
      `INSERT INTO automation_notifications (
        type, recipient_name, recipient_phone, message, status,
        needs_confirmation, lifecycle_status, reference_id, created_at
      ) VALUES ('refill_batch_booked', ?, ?, ?, 'pending', 1, 'staged', ?, CURRENT_TIMESTAMP)`,
      [
        batch.patient_name,
        batch.patient_phone,
        msg,
        batch.batch_id
      ]
    );
  } catch (err: any) {
    console.warn('[RefillBatchService] Notification staging note:', err.message);
  }
}
