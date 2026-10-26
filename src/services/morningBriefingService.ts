/**
 * morningBriefingService.ts
 *
 * Core service for the Morning Briefing & Reorder Hub Flow:
 * 1. Collects data across Refills, Special Orders, Online Orders, and Call Tasks.
 * 2. Deduplicates and prepares consolidated morning briefing.
 * 3. 3-Way Channel Routing: WhatsApp Available vs WhatsApp Unavailable vs No Usable Phone.
 * 4. Call Outcome Pipeline State Machine: Pending Call -> Called -> Customer Responded (Resolved)
 *    vs No Answer / Further Action Needed (Follow-up Required -> loop to Pending Call).
 */

import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { checkPhoneWhatsAppRegistered } from '../whatsappClient.js';
import { formatCustomerName } from '../utils/nameFormatter.js';
import { toLocalSqlDateTime } from '../utils/localTime.js';

export interface BriefingItem {
  id: string | number;
  source_type: 'refill' | 'special_order' | 'online_order' | 'call_task';
  reference_id: string;
  customer_name: string;
  customer_phone: string;
  phone_status: 'usable' | 'missing' | 'invalid';
  channel_status: 'whatsapp_available' | 'whatsapp_unavailable' | 'no_usable_phone';
  title: string;
  subtitle: string;
  status: string;
  category_badge: string;
  priority: 'urgent' | 'high' | 'normal';
  details: Record<string, any>;
  created_at: string;
}

export interface MorningBriefingSummary {
  refills: {
    total: number;
    pending: number;
    partially_fulfilled: number;
    action_required: number;
    items: BriefingItem[];
  };
  special_orders: {
    total: number;
    customer_requests: number;
    procurement_needed: number;
    supplier_follow_up: number;
    items: BriefingItem[];
  };
  online_orders: {
    total: number;
    pending: number;
    awaiting_stock: number;
    not_delivered: number;
    items: BriefingItem[];
  };
  call_tasks: {
    total: number;
    pending_call: number;
    called: number;
    follow_up_required: number;
    items: BriefingItem[];
  };
  contact_review: {
    total: number;
    items: BriefingItem[];
  };
  generated_at: string;
}

/**
 * Validates whether a raw phone string contains a viable 10-digit Indian mobile number.
 */
export function validatePhoneNumber(rawPhone?: string | null): {
  isValid: boolean;
  cleanDigits10: string;
  status: 'usable' | 'missing' | 'invalid';
} {
  if (!rawPhone || !String(rawPhone).trim()) {
    return { isValid: false, cleanDigits10: '', status: 'missing' };
  }
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length < 10) {
    return { isValid: false, cleanDigits10: '', status: 'invalid' };
  }
  const clean10 = digits.slice(-10);
  // Guard against dummy sequences like '0000000000' or '1111111111'
  if (/^(\d)\1{9}$/.test(clean10) || clean10.startsWith('0')) {
    return { isValid: false, cleanDigits10: '', status: 'invalid' };
  }
  return { isValid: true, cleanDigits10: clean10, status: 'usable' };
}

/**
 * Classifies a phone number into one of the 3 routing pathways:
 * 1. WhatsApp Available
 * 2. WhatsApp Unavailable
 * 3. No Usable Phone Number
 */
export async function classifyContactChannel(
  rawPhone?: string | null,
  dbInstance?: any
): Promise<'whatsapp_available' | 'whatsapp_unavailable' | 'no_usable_phone'> {
  const validation = validatePhoneNumber(rawPhone);
  if (!validation.isValid) {
    return 'no_usable_phone';
  }

  // Fast check: check if the customer has an active chat history in whatsapp_chats
  try {
    const db = dbInstance || (await dbManager.getConnection());
    const existingChat = await db.get(
      'SELECT id FROM whatsapp_chats WHERE id LIKE ? OR id LIKE ? LIMIT 1',
      [`%${validation.cleanDigits10}%`, `91${validation.cleanDigits10}@c.us`]
    );
    if (existingChat) {
      return 'whatsapp_available';
    }
  } catch (_) {}

  // Check live or cached WhatsApp registration
  try {
    const status = await checkPhoneWhatsAppRegistered(validation.cleanDigits10);
    if (status === 'AVAILABLE') {
      return 'whatsapp_available';
    }
  } catch (_) {}

  return 'whatsapp_unavailable';
}

/**
 * Aggregates all 4 operational sources into a unified Morning Briefing.
 */
export async function getMorningBriefing(): Promise<MorningBriefingSummary> {
  const db = await dbManager.getConnection();

  // 1. Refills: pending refills, partially fulfilled, and approval required
  const refillRows = await db.all(`
    SELECT pr.id, pr.patient_name, pr.patient_phone, pr.medicine_name, pr.quantity_needed,
           pr.refill_interval_days, pr.next_refill_date, pr.status, pr.approval_status,
           pr.approval_reason, pr.batch_id, m.name as m_name
    FROM patient_refills pr
    LEFT JOIN medicines m ON pr.medicine_id = m.id
    WHERE pr.is_active = 1
      AND (
        pr.status IN ('pending', 'partially_fulfilled', 'staged')
        OR pr.approval_status = 'required'
      )
    ORDER BY pr.id DESC
    LIMIT 200
  `);

  // 2. Special Orders (manual CRM orders)
  const specialOrderRows = await db.all(`
    SELECT id, requester, phone, medicine_name, product, qty, priority, status,
           delivery_status, created_at, notes, customer_order_source, source
    FROM special_orders
    WHERE status NOT IN ('Fulfilled', 'Completed', 'Cancelled', 'Rejected')
      AND (
        customer_order_source NOT IN ('website', 'whatsapp', 'manual_phone_order', 'pharmacy_assisted')
        OR customer_order_source IS NULL
      )
      AND (prescription_url IS NULL OR prescription_url = '')
      AND (notes IS NULL OR notes NOT LIKE '[Website Order]%')
    ORDER BY created_at DESC
    LIMIT 200
  `);

  // 3. Online Orders (placed remotely via website or WhatsApp)
  const onlineOrderRows = await db.all(`
    SELECT id, requester, phone, medicine_name, product, qty, priority, status,
           delivery_status, created_at, notes, customer_order_source, source,
           prescription_url, total_amount, payment_status, pharmacy_verification_status
    FROM special_orders
    WHERE status NOT IN ('Fulfilled', 'Completed', 'Cancelled', 'Rejected')
      AND delivery_status != 'delivered'
      AND (
        customer_order_source IN ('website', 'whatsapp', 'manual_phone_order', 'pharmacy_assisted')
        OR prescription_url IS NOT NULL
        OR notes LIKE '[Website Order]%'
      )
    ORDER BY created_at DESC
    LIMIT 200
  `);

  // 4. Manual Call Tasks
  const callTaskRows = await db.all(`
    SELECT id, task_type, patient_name, patient_phone, reference_id, details_json,
           status, call_outcome, reschedule_date, notes, priority, call_attempts,
           last_called_at, created_at, updated_at
    FROM patient_call_tasks
    WHERE status IN ('pending', 'rescheduled', 'called')
    ORDER BY
      CASE WHEN status = 'pending' THEN 0 WHEN status = 'rescheduled' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 200
  `);

  // Process & Deduplicate items
  const refillItems: BriefingItem[] = [];
  const specialOrderItems: BriefingItem[] = [];
  const onlineOrderItems: BriefingItem[] = [];
  const callTaskItems: BriefingItem[] = [];
  const contactReviewItems: BriefingItem[] = [];

  // Seen trackers to avoid duplicate entries for the same patient and reference
  const seenRefills = new Set<string>();
  for (const r of refillRows) {
    const key = `${r.patient_phone || r.patient_name}_${r.medicine_name || r.m_name}`;
    if (seenRefills.has(key)) continue;
    seenRefills.add(key);

    const val = validatePhoneNumber(r.patient_phone);
    const channel = await classifyContactChannel(r.patient_phone, db);

    const isActionRequired = r.approval_status === 'required' || (r.status || '').toLowerCase().includes('action');
    const isPartial = r.status === 'partially_fulfilled';
    const subCategory = isActionRequired ? 'Action Required' : (isPartial ? 'Partially Fulfilled' : 'Pending Refill');

    const item: BriefingItem = {
      id: r.id,
      source_type: 'refill',
      reference_id: r.batch_id || `REF-${r.id}`,
      customer_name: formatCustomerName(r.patient_name),
      customer_phone: val.cleanDigits10 || r.patient_phone || '',
      phone_status: val.status,
      channel_status: channel,
      title: r.medicine_name || r.m_name || 'Refill Medicine',
      subtitle: `Qty: ${r.quantity_needed || 1} • Due: ${r.next_refill_date || 'Today'}`,
      status: r.status || 'pending',
      category_badge: subCategory,
      priority: isActionRequired ? 'urgent' : 'normal',
      details: {
        approval_status: r.approval_status,
        approval_reason: r.approval_reason,
        batch_id: r.batch_id,
        interval_days: r.refill_interval_days
      },
      created_at: r.next_refill_date || new Date().toISOString()
    };

    refillItems.push(item);
    if (channel === 'no_usable_phone') {
      contactReviewItems.push(item);
    }
  }

  const seenSpecialOrders = new Set<string>();
  for (const so of specialOrderRows) {
    const key = `${so.phone || so.requester}_${so.medicine_name || so.product}`;
    if (seenSpecialOrders.has(key)) continue;
    seenSpecialOrders.add(key);

    const val = validatePhoneNumber(so.phone);
    const channel = await classifyContactChannel(so.phone, db);

    let subCategory = 'Customer Request';
    const st = (so.status || '').toLowerCase();
    if (st.includes('procurement') || st.includes('order')) subCategory = 'Procurement Needed';
    else if (st.includes('supplier') || st.includes('distributor')) subCategory = 'Supplier Follow-up';

    const item: BriefingItem = {
      id: so.id,
      source_type: 'special_order',
      reference_id: `SO-${so.id}`,
      customer_name: formatCustomerName(so.requester),
      customer_phone: val.cleanDigits10 || so.phone || '',
      phone_status: val.status,
      channel_status: channel,
      title: so.medicine_name || so.product || 'Special Request',
      subtitle: `Qty: ${so.qty || 1} • Status: ${so.status || 'Pending'}`,
      status: so.status || 'Pending',
      category_badge: subCategory,
      priority: so.priority === 'High' ? 'high' : 'normal',
      details: {
        notes: so.notes,
        source: so.source || 'crm'
      },
      created_at: so.created_at || toLocalSqlDateTime()
    };

    specialOrderItems.push(item);
    if (channel === 'no_usable_phone') {
      contactReviewItems.push(item);
    }
  }

  const seenOnlineOrders = new Set<string>();
  for (const oo of onlineOrderRows) {
    const key = `online_${oo.id}`;
    if (seenOnlineOrders.has(key)) continue;
    seenOnlineOrders.add(key);

    const val = validatePhoneNumber(oo.phone);
    const channel = await classifyContactChannel(oo.phone, db);

    let subCategory = 'Pending';
    const delSt = (oo.delivery_status || '').toLowerCase();
    const verSt = (oo.pharmacy_verification_status || '').toLowerCase();
    if (delSt === 'out_for_delivery' || delSt === 'assigned') subCategory = 'Not Delivered';
    else if (verSt.includes('stock') || verSt.includes('sourcing')) subCategory = 'Awaiting Stock';
    else subCategory = 'Pending / Processing';

    const item: BriefingItem = {
      id: oo.id,
      source_type: 'online_order',
      reference_id: `ORD-${oo.id}`,
      customer_name: formatCustomerName(oo.requester),
      customer_phone: val.cleanDigits10 || oo.phone || '',
      phone_status: val.status,
      channel_status: channel,
      title: oo.medicine_name || oo.product || `Order #${oo.id}`,
      subtitle: `Amount: ₹${oo.total_amount || 0} • Status: ${oo.status}`,
      status: oo.status || 'Pending',
      category_badge: subCategory,
      priority: oo.priority === 'High' ? 'high' : 'normal',
      details: {
        delivery_status: oo.delivery_status,
        payment_status: oo.payment_status,
        prescription_url: oo.prescription_url
      },
      created_at: oo.created_at || toLocalSqlDateTime()
    };

    onlineOrderItems.push(item);
    if (channel === 'no_usable_phone') {
      contactReviewItems.push(item);
    }
  }

  for (const ct of callTaskRows) {
    const val = validatePhoneNumber(ct.patient_phone);

    let parsedDetails: any = {};
    try {
      parsedDetails = JSON.parse(ct.details_json || '{}');
    } catch (_) {}

    let subCategory = 'Pending Call';
    if (ct.status === 'called') subCategory = 'Called';
    else if (ct.status === 'rescheduled') subCategory = 'Follow-up Required';

    const item: BriefingItem = {
      id: ct.id,
      source_type: 'call_task',
      reference_id: `CALL-${ct.id}`,
      customer_name: formatCustomerName(ct.patient_name),
      customer_phone: val.cleanDigits10 || ct.patient_phone || '',
      phone_status: val.status,
      channel_status: 'whatsapp_unavailable', // By definition, in manual call queue
      title: parsedDetails.details || `Call: ${ct.patient_name}`,
      subtitle: `Type: ${ct.task_type} • Attempts: ${ct.call_attempts || 0} ${ct.reschedule_date ? `• Remind: ${ct.reschedule_date}` : ''}`,
      status: ct.status,
      category_badge: subCategory,
      priority: ct.priority === 'urgent' ? 'urgent' : (ct.priority === 'high' ? 'high' : 'normal'),
      details: {
        task_type: ct.task_type,
        call_outcome: ct.call_outcome,
        reschedule_date: ct.reschedule_date,
        notes: ct.notes,
        call_attempts: ct.call_attempts,
        last_called_at: ct.last_called_at
      },
      created_at: ct.created_at || toLocalSqlDateTime()
    };

    callTaskItems.push(item);
    if (val.status !== 'usable') {
      contactReviewItems.push(item);
    }
  }

  const summary: MorningBriefingSummary = {
    refills: {
      total: refillItems.length,
      pending: refillItems.filter(i => i.category_badge === 'Pending Refill').length,
      partially_fulfilled: refillItems.filter(i => i.category_badge === 'Partially Fulfilled').length,
      action_required: refillItems.filter(i => i.category_badge === 'Action Required').length,
      items: refillItems
    },
    special_orders: {
      total: specialOrderItems.length,
      customer_requests: specialOrderItems.filter(i => i.category_badge === 'Customer Request').length,
      procurement_needed: specialOrderItems.filter(i => i.category_badge === 'Procurement Needed').length,
      supplier_follow_up: specialOrderItems.filter(i => i.category_badge === 'Supplier Follow-up').length,
      items: specialOrderItems
    },
    online_orders: {
      total: onlineOrderItems.length,
      pending: onlineOrderItems.filter(i => i.category_badge.includes('Pending')).length,
      awaiting_stock: onlineOrderItems.filter(i => i.category_badge === 'Awaiting Stock').length,
      not_delivered: onlineOrderItems.filter(i => i.category_badge === 'Not Delivered').length,
      items: onlineOrderItems
    },
    call_tasks: {
      total: callTaskItems.length,
      pending_call: callTaskItems.filter(i => i.category_badge === 'Pending Call').length,
      called: callTaskItems.filter(i => i.category_badge === 'Called').length,
      follow_up_required: callTaskItems.filter(i => i.category_badge === 'Follow-up Required').length,
      items: callTaskItems
    },
    contact_review: {
      total: contactReviewItems.length,
      items: contactReviewItems
    },
    generated_at: toLocalSqlDateTime()
  };

  return summary;
}

/**
 * 3-Way Channel Routing Action: Add to WhatsApp Queue
 * Stages a message into automation_notifications for human-in-the-loop confirmation.
 */
export async function routeToWhatsAppQueue(item: {
  customer_name: string;
  customer_phone: string;
  source_type: string;
  reference_id: string;
  message?: string;
}): Promise<{ success: boolean; notification_id: number; message: string }> {
  const validation = validatePhoneNumber(item.customer_phone);
  if (!validation.isValid) {
    throw new Error('Cannot route to WhatsApp queue: recipient does not have a valid 10-digit mobile number');
  }

  const db = await dbManager.getConnection();
  const defaultMsg = item.message ||
    `Hello ${formatCustomerName(item.customer_name)}, this is regarding your ${item.source_type.replace('_', ' ')} (${item.reference_id}) at the pharmacy. Please let us know if you would like us to prepare it for collection.`;

  const result = await db.run(
    `INSERT INTO automation_notifications 
     (type, recipient_name, recipient_phone, message, status, needs_confirmation, lifecycle_status, reference_id, created_at)
     VALUES (?, ?, ?, ?, 'pending', 1, 'staged', ?, CURRENT_TIMESTAMP)`,
    [
      `${item.source_type}_briefing_reminder`,
      formatCustomerName(item.customer_name),
      validation.cleanDigits10,
      defaultMsg,
      item.reference_id
    ]
  );

  eventService.broadcast('morning_briefing_updated', {
    action: 'routed_to_whatsapp',
    reference_id: item.reference_id,
    notification_id: result.lastID
  });

  return {
    success: true,
    notification_id: Number(result.lastID),
    message: 'Staged in WhatsApp queue for pharmacist review'
  };
}

/**
 * 3-Way Channel Routing Action: Add to Call Task Queue
 * Enqueues into patient_call_tasks with order/medicine details and priority.
 */
export async function routeToCallTaskQueue(item: {
  customer_name: string;
  customer_phone: string;
  task_type: 'refill' | 'special_order' | 'online_order' | 'credit' | 'general';
  reference_id?: string;
  reason?: string;
  priority?: 'urgent' | 'high' | 'normal';
  details?: Record<string, any>;
}): Promise<{ success: boolean; task_id: number; message: string }> {
  const db = await dbManager.getConnection();

  // Avoid duplicate call tasks: check if an unresolved call task already exists
  const existing = await db.get(
    `SELECT id FROM patient_call_tasks 
     WHERE reference_id = ? AND status IN ('pending', 'rescheduled', 'called') LIMIT 1`,
    [item.reference_id || '']
  );

  if (existing) {
    return {
      success: true,
      task_id: existing.id,
      message: 'Call task already exists and is active on the call board'
    };
  }

  const cleanPhone = validatePhoneNumber(item.customer_phone).cleanDigits10 || item.customer_phone || 'N/A';
  const detailsJson = JSON.stringify({
    details: item.reason || `${item.task_type} follow-up`,
    ...(item.details || {})
  });

  const res = await db.run(
    `INSERT INTO patient_call_tasks 
     (task_type, patient_name, patient_phone, reference_id, details_json, status, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      item.task_type,
      formatCustomerName(item.customer_name),
      cleanPhone,
      item.reference_id || null,
      detailsJson,
      item.priority || 'normal'
    ]
  );

  eventService.broadcast('call_tasks_updated', {
    taskId: res.lastID,
    taskType: item.task_type
  });
  eventService.broadcast('morning_briefing_updated', {
    action: 'routed_to_call_task',
    taskId: res.lastID
  });

  return {
    success: true,
    task_id: Number(res.lastID),
    message: 'Added to Manual Call Task Queue'
  };
}

/**
 * Updates missing or invalid contact details for a customer across relevant tables,
 * enabling immediate re-routing into WhatsApp or Call Queue.
 */
export async function updateContactDetails(input: {
  customer_name?: string;
  old_phone?: string;
  new_phone: string;
  reference_id?: string;
  source_type?: string;
}): Promise<{ success: boolean; message: string; channel_status: string }> {
  const validation = validatePhoneNumber(input.new_phone);
  if (!validation.isValid) {
    throw new Error('Invalid phone number: Please provide a valid 10-digit Indian mobile number');
  }

  const db = await dbManager.getConnection();
  const cleanPhone = validation.cleanDigits10;

  // 1. Update customers table if customer exists
  if (input.customer_name) {
    await db.run(
      `UPDATE customers SET phone = ? 
       WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) OR phone = ?`,
      [cleanPhone, input.customer_name, input.old_phone || '']
    );
  }

  // 2. Update patient_refills if reference matches
  if (input.source_type === 'refill' || input.reference_id?.startsWith('REF-') || input.reference_id?.startsWith('WB-') || input.reference_id?.startsWith('CRM-')) {
    await db.run(
      `UPDATE patient_refills SET patient_phone = ? 
       WHERE batch_id = ? OR id = ? OR (LOWER(TRIM(patient_name)) = LOWER(TRIM(?)) AND is_active = 1)`,
      [cleanPhone, input.reference_id, input.reference_id?.replace('REF-', ''), input.customer_name || '']
    );
  }

  // 3. Update special_orders if reference matches
  if (input.source_type === 'special_order' || input.source_type === 'online_order' || input.reference_id?.startsWith('SO-') || input.reference_id?.startsWith('ORD-')) {
    const numericId = input.reference_id?.replace(/\D/g, '');
    if (numericId) {
      await db.run(
        `UPDATE special_orders SET phone = ? WHERE id = ?`,
        [cleanPhone, numericId]
      );
    }
  }

  // 4. Update patient_call_tasks if reference matches
  if (input.reference_id?.startsWith('CALL-')) {
    const callId = input.reference_id.replace('CALL-', '');
    await db.run(
      `UPDATE patient_call_tasks SET patient_phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [cleanPhone, callId]
    );
  }

  const channel = await classifyContactChannel(cleanPhone, db);

  eventService.broadcast('morning_briefing_updated', {
    action: 'contact_updated',
    reference_id: input.reference_id,
    new_phone: cleanPhone,
    channel_status: channel
  });

  return {
    success: true,
    message: `Contact details updated successfully for ${input.customer_name || 'Customer'}.`,
    channel_status: channel
  };
}

/**
 * Call Outcome Pipeline State Machine:
 * Transitions:
 * - 'called': Pending Call -> Called
 * - 'customer_responded': Called -> Resolved (completed)
 * - 'no_answer': Called -> Follow-up Required -> loops to Pending Call
 * - 'further_action_needed': Called -> Follow-up Required -> loops to Pending Call
 */
export async function advanceCallOutcome(
  taskId: number,
  outcome: 'called' | 'customer_responded' | 'no_answer' | 'further_action_needed',
  payload: {
    outcome_notes?: string;
    reschedule_date?: string;
    priority?: 'urgent' | 'high' | 'normal';
  } = {}
): Promise<{ success: boolean; new_status: string; message: string }> {
  const db = await dbManager.getConnection();
  const task = await db.get('SELECT * FROM patient_call_tasks WHERE id = ?', [taskId]);
  if (!task) {
    throw new Error(`Call task not found with ID ${taskId}`);
  }

  const currentAttempts = Number(task.call_attempts || 0);

  if (outcome === 'called') {
    await db.run(
      `UPDATE patient_call_tasks 
       SET status = 'called', call_attempts = ?, last_called_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [currentAttempts + 1, taskId]
    );
    eventService.broadcast('call_tasks_updated', { taskId, status: 'called' });
    return { success: true, new_status: 'called', message: 'Marked as Called' };
  }

  if (outcome === 'customer_responded') {
    const note = payload.outcome_notes || 'Customer Responded - Resolved';
    await db.run(
      `UPDATE patient_call_tasks 
       SET status = 'completed', call_outcome = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [note, payload.outcome_notes || task.notes, taskId]
    );
    eventService.broadcast('call_tasks_updated', { taskId, status: 'completed' });
    return { success: true, new_status: 'completed', message: 'Call task Resolved' };
  }

  if (outcome === 'no_answer' || outcome === 'further_action_needed') {
    const outcomeLabel = outcome === 'no_answer'
      ? 'No Answer - Follow-up Required'
      : (payload.outcome_notes ? `Further Action Needed: ${payload.outcome_notes}` : 'Further Action Needed - Follow-up Required');

    // Default reschedule date is tomorrow in shop local time if not provided
    const nextDate = payload.reschedule_date || toLocalSqlDateTime(new Date(Date.now() + 86400000)).slice(0, 10);

    // Loops back to 'rescheduled' / Pending Call for the scheduled date
    await db.run(
      `UPDATE patient_call_tasks 
       SET status = 'rescheduled', call_outcome = ?, reschedule_date = ?, notes = ?, 
           priority = COALESCE(?, priority), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [outcomeLabel, nextDate, payload.outcome_notes || task.notes, payload.priority || null, taskId]
    );
    eventService.broadcast('call_tasks_updated', { taskId, status: 'rescheduled', nextDate });
    return {
      success: true,
      new_status: 'rescheduled',
      message: `Follow-up Required scheduled for ${nextDate} (loops back to Pending Call)`
    };
  }

  throw new Error(`Unknown call outcome action: ${outcome}`);
}
