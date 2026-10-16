/**
 * Pharmarack order sync: notices orders placed directly on retailers.pharmarack.com.
 *
 * Reads today's orders from Pharmarack's own order list (the call behind the /orderhistory page),
 * records each real OrderNo once in `pharmarack_synced_orders`, makes sure the distributor shows up
 * in today's dispatch reminders (via `pharmarack_placed_orders`), and announces a NEW order to its
 * distributor:
 *   - reminder not sent yet  -> the scheduled reminder carries the order number (notificationService)
 *   - reminder already sent, or distributor marked Dispatched -> ONE follow-up naming the new order(s)
 * Delivery boys keep their existing "afternoon dispatch" list (template untouched); when that list
 * already went out today, the same list is re-sent for the distributors that got a late order.
 *
 * Read-only against Pharmarack: ONE POST per sync, same session/headers as the heartbeat, no browser.
 * Distributor/delivery-boy messages only, never patients. Same switches as the daily reminders
 * (automation_enabled + trigger_dispatch_reminder_enabled, paused dates).
 */
import { dbManager } from '../database/connection.js';
import { notificationService } from './notificationService.js';

const ORDER_LIST_URL = 'https://pharmretail-api.pharmarack.com/order/api/v2/DisplayOrders';
const MIN_GAP_MS = 5 * 60 * 1000;

export interface PharmarackOrderSyncResult {
  ok: boolean;
  skipped?: string;
  fetched: number;
  newOrders: number;
  followUps: number;
  error?: string;
}

let inFlight: Promise<PharmarackOrderSyncResult> | null = null;
let lastRunAt = 0;

function localToday(): { iso: string; ddmmyy: string } {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    iso: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    ddmmyy: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`
  };
}

/**
 * Local calendar day (YYYY-MM-DD) of Pharmarack's OrderDate string, or null when the format is not
 * recognised. Accepts ISO ("2026-10-06T10:50:00"), "dd/mm/yyyy[ hh:mm]" and "6 Oct 2026 10:50".
 */
export function orderDayIso(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (dmy) {
    const yr = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return `${yr}-${p(Number(dmy[2]))}-${p(Number(dmy[1]))}`;
  }
  const t = new Date(s);
  if (isNaN(t.getTime())) return null;
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

async function fetchTodaysOrders(token: string, ddmmyy: string): Promise<any[] | 'expired'> {
  const res = await fetch(ORDER_LIST_URL, {
    method: 'POST',
    headers: {
      'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'Content-Type': 'application/json',
      'devicetype': 'web',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://retailers.pharmarack.com/',
      'Origin': 'https://retailers.pharmarack.com'
    },
    // Same body the Orders page sends (status 1,2,3 = every placed/uploaded/processed order).
    body: JSON.stringify({
      searchtext: '',
      fromdate: ddmmyy,
      todate: ddmmyy,
      Operation: 'view',
      status: '1,2,3',
      pageNo: 1,
      pageSize: 50,
      isMapped: true
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (res.status === 401 || res.status === 403) return 'expired';
  if (!res.ok) throw new Error(`Pharmarack order list HTTP ${res.status}`);
  const json: any = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

const ORDER_DETAIL_URL = 'https://pharmretail-api.pharmarack.com/order/api/v1/GetOrderDetailsForRetailerManager';

function pickFirst(o: any, keys: string[]): unknown {
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null && String(o[k]).trim() !== '') return o[k];
  return undefined;
}

/** Walks a response and returns the first array of objects that carry a product-name field. */
function findLineArray(node: any, depth = 0): any[] | null {
  if (depth > 4 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    if (node.length && node.every(r => r && typeof r === 'object' && pickFirst(r, NAME_KEYS) !== undefined)) return node;
    for (const c of node) { const f = findLineArray(c, depth + 1); if (f) return f; }
    return null;
  }
  for (const v of Object.values(node)) { const f = findLineArray(v, depth + 1); if (f) return f; }
  return null;
}
const NAME_KEYS = ['ProductFullName', 'ProductName', 'productName', 'ItemName', 'itemName', 'MedicineName', 'medicineName', 'Product', 'product_name'];
const QTY_KEYS = ['Quantity', 'quantity', 'OrderQty', 'orderQty', 'Qty', 'qty'];

/**
 * Real product lines of one order from Pharmarack's own order-detail call (the one the order page makes).
 * Returns null when nothing readable came back: lines are never invented, and the response SHAPE (keys only)
 * is written to action_logs so the parser can be corrected.
 */
async function fetchOrderLines(db: any, token: string, orderId: number | null, orderNo: string): Promise<Array<{ productName: string; qty: number | null; productCode?: string; mrp?: number; rate?: number; packaging?: string }> | null> {
  if (orderId === null) return null;
  try {
    const res = await fetch(`${ORDER_DETAIL_URL}?OrderId=${orderId}`, {
      headers: {
        'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        'devicetype': 'web',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://retailers.pharmarack.com/',
        'Origin': 'https://retailers.pharmarack.com'
      },
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) { await audit(db, orderNo, 'detail_http_error', { status: res.status }); return null; }
    const json: any = await res.json();
    const rows = Array.isArray(json?.data?.invoicedItems) && json.data.invoicedItems.length ? json.data.invoicedItems : findLineArray(json);
    if (!rows) {
      await audit(db, orderNo, 'detail_unreadable', { topKeys: Object.keys(json || {}), dataKeys: Object.keys((Array.isArray(json?.data) ? json.data[0] : json?.data) || {}) });
      return null;
    }
    return rows.map((r: any) => {
      const q = Number(pickFirst(r, QTY_KEYS));
      const code = pickFirst(r, ['ProductCode']);
      const mrp = Number(pickFirst(r, ['MRP', 'mrp']));
      const rate = Number(pickFirst(r, ['PTR', 'ptr']));
      const pack = pickFirst(r, ['Packing', 'packing', 'Packaging']);
      return {
        productName: String(pickFirst(r, NAME_KEYS)).trim(),
        qty: Number.isFinite(q) && q > 0 ? q : null,
        ...(code !== undefined ? { productCode: String(code) } : {}),
        ...(Number.isFinite(mrp) && mrp > 0 ? { mrp } : {}),
        ...(Number.isFinite(rate) && rate > 0 ? { rate } : {}),
        ...(pack !== undefined ? { packaging: String(pack).trim() } : {})
      };
    });
  } catch (err: any) {
    await audit(db, orderNo, 'detail_failed', { error: err?.message || String(err) });
    return null;
  }
}

/** Fills the product lines of today's distributor rows that were created empty by this sync. */
async function fillOrderLines(db: any, token: string, orders: any[], todayIso: string): Promise<void> {
  for (const o of orders) {
    const orderNo = String(o?.OrderNo ?? '').trim();
    if (!orderNo) continue;
    const day = orderDayIso(o?.OrderDate);
    if (day && day !== todayIso) continue;

    // Find the row for THIS specific order
    let row = await db.get(
      `SELECT id, items_json FROM pharmarack_placed_orders WHERE order_no = ? LIMIT 1`,
      [orderNo]
    );
    if (!row) {
      // Fallback: check if an unassigned in-app placed order exists for this store today
      row = await db.get(
        `SELECT id, items_json FROM pharmarack_placed_orders 
         WHERE order_date = ? AND LOWER(TRIM(store_name)) = LOWER(TRIM(?)) AND (order_no IS NULL OR order_no = '') 
         ORDER BY id ASC LIMIT 1`,
        [todayIso, String(o?.StoreName ?? '').trim()]
      );
      if (row) {
        await db.run('UPDATE pharmarack_placed_orders SET order_no = ? WHERE id = ?', [orderNo, row.id]);
      }
    }
    if (!row) continue;

    let existing: any[] = [];
    try { existing = JSON.parse(row.items_json || '[]'); } catch (_) { existing = []; }
    if (existing.length > 0) continue; // the app's own Send All lines are never overwritten

    const orderId = Number.isFinite(Number(o.OrderId)) ? Number(o.OrderId) : null;
    const lines = await fetchOrderLines(db, token, orderId, orderNo);
    if (!lines || lines.length === 0) continue;

    await db.run('UPDATE pharmarack_placed_orders SET items_json = ? WHERE id = ?', [JSON.stringify(lines), row.id]);

    // Auto-ingest lines into store-scoped distributor products
    try {
      const storeId = Number(o?.storeId || o?.StoreId || 0);
      const storeName = String(o?.StoreName || '').trim();
      const { upsertDistributorProducts, autoSaveMedicineDistributorLinks } = await import('../routes/pharmarack.js');
      if (storeId > 0) {
        await upsertDistributorProducts(lines, storeId, storeName, 'synced_order', todayIso);
        void autoSaveMedicineDistributorLinks(lines.map(l => ({ ...l, storeId, storeName })));
      }
    } catch (_) { /* non-fatal product ingest */ }
  }
}

async function remindersEnabledToday(db: any, todayIso: string): Promise<boolean> {
  const [globalAuto, trigger, paused] = await Promise.all([
    db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'"),
    db.get("SELECT value FROM app_settings WHERE key = 'trigger_dispatch_reminder_enabled'"),
    db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_paused_dispatch_dates'")
  ]);
  if (globalAuto && globalAuto.value !== 'true') return false;
  if (trigger?.value !== 'true') return false;
  if (paused?.value) {
    try {
      const dates = JSON.parse(paused.value);
      if (Array.isArray(dates) && dates.includes(todayIso)) return false;
    } catch (_) { /* unreadable list = not paused */ }
  }
  return true;
}

/** One audit line per decision, in action_logs (entity 'pharmarack_order_sync', entity_id = OrderNo). */
async function audit(db: any, orderNo: string, action: string, meta: Record<string, unknown>): Promise<void> {
  try {
    await db.run(
      `INSERT INTO action_logs (entity, entity_id, action_type, description, metadata) VALUES ('pharmarack_order_sync', ?, ?, ?, ?)`,
      [orderNo, action, `Pharmarack order ${orderNo}: ${action}`, JSON.stringify(meta)]
    );
  } catch (_) { /* the audit trail must never break the sync */ }
}

/** Record what was decided for these orders: the order row (what the UI shows) plus an audit line each. */
async function settle(db: any, orderNos: string[], decision: string, messaged: boolean, meta: Record<string, unknown>): Promise<void> {
  if (orderNos.length === 0) return;
  await db.run(
    `UPDATE pharmarack_synced_orders SET announce_result = ?, announced_at = ? WHERE order_no IN (${orderNos.map(() => '?').join(',')})`,
    [decision, messaged ? Date.now() : null, ...orderNos]
  );
  for (const n of orderNos) await audit(db, n, decision, meta);
}

async function runSync(): Promise<PharmarackOrderSyncResult> {
  const result: PharmarackOrderSyncResult = { ok: false, fetched: 0, newOrders: 0, followUps: 0 };
  const db = await dbManager.getConnection();

  const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'");
  const token: string = tokenRow?.value || '';
  if (!token) return { ...result, skipped: 'no_session' };

  const today = localToday();
  let orders: any[] | 'expired';
  try {
    orders = await fetchTodaysOrders(token, today.ddmmyy);
  } catch (err: any) {
    return { ...result, error: err?.message || 'order list fetch failed' };
  }
  if (orders === 'expired') {
    try { await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_status', 'expired')"); } catch (_) { /* best effort */ }
    return { ...result, skipped: 'session_expired' };
  }
  result.ok = true;
  result.fetched = orders.length;

  // 1. Record every order not seen before (keyed by the real OrderNo).
  const fresh: Array<{ orderNo: string; storeName: string; amount: number | null; appAlreadySent: boolean }> = [];
  for (const o of orders) {
    const orderNo = String(o?.OrderNo ?? '').trim();
    const storeName = String(o?.StoreName ?? '').trim();
    if (!orderNo || !storeName) continue; // never guess a missing number/distributor
    // TODAY ONLY: an order stamped with any other day is ignored (no record, no message), even if
    // Pharmarack returned it. An unreadable date trusts the today-only range the request asked for.
    const day = orderDayIso(o?.OrderDate);
    if (day && day !== today.iso) continue;
    const known = await db.get('SELECT order_no FROM pharmarack_synced_orders WHERE order_no = ?', [orderNo]);
    if (known) continue;

    const amountNum = parseFloat(String(o?.OrderAmount ?? ''));
    const amount = Number.isFinite(amountNum) ? amountNum : null;
    const storeId = Number.isFinite(Number(o?.storeId)) ? Number(o.storeId) : null;
    const orderId = Number.isFinite(Number(o?.OrderId)) ? Number(o.OrderId) : null;
    await db.run(
      `INSERT OR IGNORE INTO pharmarack_synced_orders
         (order_no, pharmarack_order_id, store_id, store_name, order_amount, order_date, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orderNo, orderId, storeId, storeName, amount, today.iso, Date.now()]
    );

    // Check if an existing row in pharmarack_placed_orders matches this specific order_no
    let logged = await db.get(
      `SELECT id FROM pharmarack_placed_orders WHERE order_no = ? LIMIT 1`,
      [orderNo]
    );
    // If not matched by order_no, check if an in-app order was logged today for this store without an order_no
    if (!logged) {
      const inAppPending = await db.get(
        `SELECT id FROM pharmarack_placed_orders 
         WHERE order_date = ? AND LOWER(TRIM(store_name)) = LOWER(TRIM(?)) AND (order_no IS NULL OR order_no = '') 
         ORDER BY id ASC LIMIT 1`,
        [today.iso, storeName]
      );
      if (inAppPending) {
        await db.run(`UPDATE pharmarack_placed_orders SET order_no = ? WHERE id = ?`, [orderNo, inAppPending.id]);
        logged = inAppPending;
      } else {
        await db.run(
          `INSERT INTO pharmarack_placed_orders (order_date, store_id, store_name, order_no, items_json, delivery_persons_json, placed_at, batch_sent, batch_sent_at)
           VALUES (?, ?, ?, ?, '[]', NULL, ?, 0, NULL)`,
          [today.iso, storeId, storeName, orderNo, Date.now()] // placed_at = when the app noticed it
        );
      }
    }
    fresh.push({ orderNo, storeName, amount, appAlreadySent: Boolean(logged) });
    await audit(db, orderNo, 'order_noticed', { storeName, amount, appAlreadySentOrderMessage: Boolean(logged) });
  }
  result.newOrders = fresh.length;
  // Product names for Sent History (also back-fills today's rows that earlier syncs left empty).
  try { await fillOrderLines(db, token, orders, today.iso); } catch (_) { /* lines are optional; never break the sync */ }
  if (fresh.length === 0) return result;

  // 2. Announce, under the same switches as the daily reminders.
  if (!(await remindersEnabledToday(db, today.iso))) {
    for (const f of fresh) await settle(db, [f.orderNo], 'skipped_reminders_off', false, { storeName: f.storeName });
    return result;
  }

  const { syncTodayActiveDistributors } = await import('./distributorDispatchReminderWorker.js');
  const reminders = await syncTodayActiveDistributors();

  const byStore = new Map<string, { storeName: string; orderNos: string[]; appAlreadySent: boolean }>();
  for (const f of fresh) {
    const k = f.storeName.toLowerCase().trim();
    const cur = byStore.get(k) || { storeName: f.storeName, orderNos: [], appAlreadySent: false };
    cur.orderNos.push(f.orderNo);
    cur.appAlreadySent = cur.appAlreadySent || f.appAlreadySent;
    byStore.set(k, cur);
  }

  const startOfDayMs = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const lateReminders: any[] = [];
  const directOrderRemindersToNotifyBoy: any[] = [];
  for (const [storeKey, { storeName, orderNos, appAlreadySent }] of byStore) {
    const row = reminders.find((r: any) => String(r.distributor_name || '').toLowerCase().trim() === storeKey);
    if (!row || !row.id || row.id >= 800000) { // synthetic "No Order Today" rows are not real reminders
      await settle(db, orderNos, 'no_reminder_row', false, { storeName });
      continue;
    }

    // A reminder that is queued but NOT yet sent (reminders are queued ahead of their time slot):
    // put the new order number into that waiting message. A second message would be a double send.
    const waiting = await db.get(
      `SELECT id, message FROM whatsapp_send_queue
       WHERE type = 'distributor_dispatch_reminder' AND status IN ('pending', 'failed_offline')
         AND LOWER(TRIM(target_name)) = LOWER(TRIM(?)) AND created_at >= ?
       ORDER BY id DESC LIMIT 1`,
      [row.distributor_name, startOfDayMs]
    );
    if (waiting) {
      const missing = orderNos.filter(n => !String(waiting.message).includes(`#${n}`));
      if (missing.length > 0) {
        const merged = `📦 Pharmarack order ${missing.map(n => `#${n}`).join(', ')}\n${waiting.message}`;
        await db.run('UPDATE whatsapp_send_queue SET message = ? WHERE id = ?', [merged, waiting.id]);
      }
      await settle(db, orderNos, 'merged_into_waiting_reminder', true, { storeName, queueId: waiting.id, appAlreadySent });
      directOrderRemindersToNotifyBoy.push(row);
      continue;
    }

    // Query previously announced Order IDs for this distributor today to guarantee strict deduplication
    const announcedRows = await db.all(
      `SELECT order_no FROM pharmarack_synced_orders 
       WHERE order_date = ? AND LOWER(TRIM(store_name)) = LOWER(TRIM(?)) AND announced_at IS NOT NULL`,
      [today.iso, storeName]
    );
    const announcedIds = new Set(announcedRows.map((r: any) => String(r.order_no).trim()));
    // Strictly filter out any Order ID that was already communicated in an earlier message today
    const freshOnlyOrderNos = orderNos.filter(n => !announcedIds.has(String(n).trim()));
    if (freshOnlyOrderNos.length === 0) {
      await settle(db, orderNos, 'already_announced_earlier', true, { storeName, appAlreadySent });
      continue;
    }

    // Status becomes 'Dispatched' when the queue worker really sends the reminder, so anything
    // other than Pending means today's reminder already went out (or the invoice mail arrived).
    const alreadyReminded = Boolean(
      (row.status && row.status !== 'Pending') ||
      (row.last_reminded_at && String(row.last_reminded_at).startsWith(today.iso))
    );

    // 5-Minute review grace period for human-in-the-loop review before automated release
    const gracePeriodMs = Date.now() + 5 * 60 * 1000;

    if (!alreadyReminded) {
      // Direct order detected for today and reminder NOT yet sent today:
      // Auto-send the dispatch announcement to the distributor for today's orders
      const sent = await notificationService.sendDistributorDispatchReminder(row.id, undefined, gracePeriodMs, { isOrderAnnouncement: true, orderNos: freshOnlyOrderNos });
      await settle(db, freshOnlyOrderNos, sent ? 'dispatch_reminder_queued' : 'reminder_not_sent', sent, { storeName, status: row.status, appAlreadySent, gracePeriodUntil: gracePeriodMs });
      if (sent) {
        result.followUps++;
        directOrderRemindersToNotifyBoy.push(row);
      }
    } else {
      // Reminder already sent today: send single follow-up naming only the new order(s)
      const sent = await notificationService.sendDistributorDispatchReminder(row.id, undefined, gracePeriodMs, { followUp: true, orderNos: freshOnlyOrderNos });
      await settle(db, freshOnlyOrderNos, sent ? 'follow_up_queued' : 'follow_up_not_sent', sent, { storeName, status: row.status, appAlreadySent, gracePeriodUntil: gracePeriodMs });
      if (sent) {
        result.followUps++;
        lateReminders.push(row);
        directOrderRemindersToNotifyBoy.push(row);
      }
    }
  }

  // 3. Delivery boys: record assignment for fresh orders (pickup alerts disabled per pharmacy policy)
  for (const f of fresh) {
    try {
      const alreadyNotifiedBoy = await db.get(
        `SELECT delivery_boy_notified_at FROM pharmarack_synced_orders WHERE order_no = ? AND delivery_boy_notified_at IS NOT NULL`,
        [f.orderNo]
      );
      if (alreadyNotifiedBoy) continue;

      // Resolve distributor contact and assigned delivery boy
      const { resolveDistributorContact } = await import('../utils/distributorSyncHelper.js');
      const contact = await resolveDistributorContact(db, f.storeName);
      let targetBoy: any = null;
      if (contact.delivery_boy_id) {
        const b = await db.get('SELECT id, name, whatsapp_number FROM delivery_boys WHERE id = ? AND is_active = 1', [contact.delivery_boy_id]);
        if (b) targetBoy = { id: b.id, name: b.name, phone: b.whatsapp_number };
      }

      await db.run(
        `UPDATE pharmarack_synced_orders SET delivery_boy_notified_at = ?, delivery_boy_id = ? WHERE order_no = ?`,
        [Date.now(), targetBoy?.id || null, f.orderNo]
      );
      await db.run(
        `UPDATE pharmarack_placed_orders SET delivery_boy_notified = 1, delivery_boy_notified_at = ? WHERE order_date = ? AND LOWER(TRIM(store_name)) = LOWER(TRIM(?))`,
        [Date.now(), today.iso, f.storeName]
      );
    } catch (boyErr: any) {
      console.warn(`[PharmarackOrderSync] Failed to update delivery boy record for order ${f.orderNo}:`, boyErr?.message || boyErr);
    }
  }

  // 4. Also keep consolidated delivery boy dispatch updated if reminders changed
  if (directOrderRemindersToNotifyBoy.length > 0) {
    try {
      await notificationService.sendConsolidatedDeliveryBoyDispatch(directOrderRemindersToNotifyBoy);
    } catch (err: any) {
      console.warn('[PharmarackOrderSync] Delivery boy direct-order dispatch failed:', err?.message || err);
    }
  }

  // Broadcast SSE update so kept-alive /dispatch and /pharmarack-cart update instantly
  try {
    const { eventService } = await import('./eventService.js');
    eventService.broadcast('dispatch_updated', { at: Date.now(), source: 'pharmarack_order_sync', count: fresh.length });
  } catch (_) {}

  return result;
}

/**
 * Outage & Startup Recovery:
 * Scans today's orders (both in `pharmarack_synced_orders` and `pharmarack_placed_orders`).
 * Directly checks if any order was not notified to the distributor or delivery boy.
 * Strictly sends ONLY the newly placed, un-notified orders. Never sends duplicate messages.
 */
export async function recoverTodayUnnotifiedOrders(): Promise<{ unnotifiedOrders: number; notifiedBoys: number; notifiedDistributors: number }> {
  const result = { unnotifiedOrders: 0, notifiedBoys: 0, notifiedDistributors: 0 };
  try {
    const db = await dbManager.getConnection();
    const today = localToday();

    // 1. Fetch all orders for today where either distributor or delivery boy has not been notified
    const unnotifiedSynced = await db.all(
      `SELECT order_no, store_name, store_id, order_amount, announced_at, delivery_boy_notified_at
       FROM pharmarack_synced_orders
       WHERE order_date = ? AND (announced_at IS NULL OR delivery_boy_notified_at IS NULL)`,
      [today.iso]
    );

    const unnotifiedPlaced = await db.all(
      `SELECT id, order_no, store_name, store_id, items_json, delivery_boy_notified
       FROM pharmarack_placed_orders
       WHERE order_date = ? AND (delivery_boy_notified = 0 OR delivery_boy_notified IS NULL)`,
      [today.iso]
    );

    result.unnotifiedOrders = unnotifiedSynced.length + unnotifiedPlaced.length;
    if (result.unnotifiedOrders === 0) {
      console.log('[OrderRecovery] Zero unnotified orders for today. No recovery messages needed.');
      return result;
    }

    console.log(`[OrderRecovery] Found ${result.unnotifiedOrders} unnotified order record(s) on recovery check. Processing...`);

    const { resolveDistributorContact } = await import('../utils/distributorSyncHelper.js');

    // 2. Recover delivery boy status for placed orders (per-order alerts disabled per pharmacy policy)
    for (const po of unnotifiedPlaced) {
      try {
        await db.run(
          `UPDATE pharmarack_placed_orders SET delivery_boy_notified = 1, delivery_boy_notified_at = ? WHERE id = ?`,
          [Date.now(), po.id]
        );
        result.notifiedBoys++;
      } catch (err: any) {
        console.warn(`[OrderRecovery] Failed to recover delivery boy for placed order #${po.id}:`, err?.message || err);
      }
    }

    // 3. Recover unnotified synced orders from Pharmarack portal
    for (const so of unnotifiedSynced) {
      try {
        const contact = await resolveDistributorContact(db, so.store_name);

        // A. If distributor was not announced, send single follow-up with order #
        if (!so.announced_at) {
          const { syncTodayActiveDistributors } = await import('./distributorDispatchReminderWorker.js');
          const reminders = await syncTodayActiveDistributors();
          const row = reminders.find((r: any) => String(r.distributor_name || '').toLowerCase().trim() === String(so.store_name).toLowerCase().trim());
          if (row && row.id && row.id < 800000) {
            const sent = await notificationService.sendDistributorDispatchReminder(row.id, undefined, undefined, { followUp: true, orderNos: [so.order_no] });
            if (sent) {
              await db.run('UPDATE pharmarack_synced_orders SET announced_at = ?, announce_result = ? WHERE order_no = ?', [Date.now(), 'recovered_on_boot', so.order_no]);
              result.notifiedDistributors++;
            }
          }
        }

        // B. Mark synced order delivery boy status without sending itemized pickup alerts
        if (!so.delivery_boy_notified_at) {
          let targetBoy: any = null;
          if (contact.delivery_boy_id) {
            const b = await db.get('SELECT id, name, whatsapp_number FROM delivery_boys WHERE id = ? AND is_active = 1', [contact.delivery_boy_id]);
            if (b) targetBoy = { id: b.id, name: b.name, phone: b.whatsapp_number };
          }

          await db.run(
            `UPDATE pharmarack_synced_orders SET delivery_boy_notified_at = ?, delivery_boy_id = ? WHERE order_no = ?`,
            [Date.now(), targetBoy?.id || null, so.order_no]
          );
          result.notifiedBoys++;
        }
      } catch (err: any) {
        console.warn(`[OrderRecovery] Failed to recover synced order #${so.order_no}:`, err?.message || err);
      }
    }
  } catch (err: any) {
    console.error('[OrderRecovery] Error recovering unnotified orders:', err);
  }
  return result;
}

/**
 * Read-only audit for one day: every Pharmarack order the app noticed, what was decided for it, and
 * every dispatch-reminder WhatsApp queued for that distributor that day (so double sends are visible).
 */
export async function getOrderSyncAudit(dateIso?: string) {
  const db = await dbManager.getConnection();
  const day = dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : localToday().iso;
  const orders = await db.all(
    `SELECT order_no, store_name, order_amount, first_seen_at, announced_at, announce_result
     FROM pharmarack_synced_orders WHERE order_date = ? ORDER BY first_seen_at ASC`,
    [day]
  );
  const [y, m, d] = day.split('-').map(Number);
  const startMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;
  const messages = await db.all(
    `SELECT id, target_name, status, type, message, created_at, sent_at
     FROM whatsapp_send_queue
     WHERE type = 'distributor_dispatch_reminder' AND created_at >= ? AND created_at < ?
     ORDER BY id ASC`,
    [startMs, endMs]
  );
  const log = await db.all(
    `SELECT entity_id AS order_no, action_type, metadata, created_at FROM action_logs
     WHERE entity = 'pharmarack_order_sync' AND DATE(created_at, 'localtime') = ? ORDER BY id ASC`,
    [day]
  );
  const countByStore = new Map<string, number>();
  for (const msg of messages) {
    const k = String(msg.target_name || '').toLowerCase().trim();
    if (['cancelled', 'failed_perm', 'skipped_invalid_phone', 'skipped_not_on_whatsapp'].includes(msg.status)) continue;
    countByStore.set(k, (countByStore.get(k) || 0) + 1);
  }
  const multiple = [...countByStore.entries()].filter(([, n]) => n > 1).map(([store, n]) => ({ store, reminder_messages: n }));
  return { date: day, orders, reminder_messages: messages, decisions: log, distributors_with_multiple_reminders: multiple };
}

/**
 * DRY RUN: same fetch and same decisions as a real sync, but strictly read-only. Writes nothing
 * (no order rows, no reminder rows, no audit rows), queues and sends nothing, edits no queued message.
 * Shows each order with Pharmarack's raw OrderDate text and what a real sync would do with it.
 */
export async function dryRunOrderSync() {
  const db = await dbManager.getConnection();
  const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'");
  if (!tokenRow?.value) return { ok: false, error: 'No Pharmarack session saved in the app (log in first).' };
  const today = localToday();
  const fetched = await fetchTodaysOrders(tokenRow.value, today.ddmmyy);
  if (fetched === 'expired') return { ok: false, error: 'Pharmarack session expired (HTTP 401/403). Log in again.' };

  const enabled = await remindersEnabledToday(db, today.iso);
  const startOfDayMs = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const rows: Array<Record<string, unknown>> = [];
  for (const o of fetched) {
    const orderNo = String(o?.OrderNo ?? '').trim();
    const storeName = String(o?.StoreName ?? '').trim();
    const rawDate = o?.OrderDate ?? null;
    const base = { orderNo, storeName, rawOrderDate: rawDate, parsedDay: orderDayIso(rawDate), orderAmount: o?.OrderAmount ?? null };
    if (!orderNo || !storeName) { rows.push({ ...base, wouldDo: 'skip: missing order number or distributor' }); continue; }
    const day = orderDayIso(rawDate);
    if (day && day !== today.iso) { rows.push({ ...base, wouldDo: `skip: not today (${day})` }); continue; }
    const known = await db.get('SELECT announce_result FROM pharmarack_synced_orders WHERE order_no = ?', [orderNo]);
    if (known) { rows.push({ ...base, wouldDo: `skip: already recorded (${known.announce_result || 'no decision yet'})` }); continue; }
    if (!enabled) { rows.push({ ...base, wouldDo: 'record only: dispatch reminders are off or today is paused' }); continue; }

    const reminder = await db.get(
      `SELECT id, status, distributor_phone FROM distributor_dispatch_reminders
       WHERE date = ? AND LOWER(TRIM(distributor_name)) = LOWER(TRIM(?)) LIMIT 1`,
      [today.iso, storeName]
    );
    const waiting = await db.get(
      `SELECT id FROM whatsapp_send_queue
       WHERE type = 'distributor_dispatch_reminder' AND status IN ('pending', 'failed_offline')
         AND LOWER(TRIM(target_name)) = LOWER(TRIM(?)) AND created_at >= ? LIMIT 1`,
      [storeName, startOfDayMs]
    );
    let wouldDo: string;
    if (waiting) wouldDo = `merge the order number into the reminder already waiting in the queue (#${waiting.id}); no extra message`;
    else if (!reminder || reminder.status === 'Pending') wouldDo = 'auto-queue today\'s reminder to distributor and send updated pickup list to delivery boy';
    else wouldDo = `send ONE follow-up to the distributor (reminder row status is "${reminder.status}") and update delivery boy`;
    rows.push({ ...base, wouldDo });
  }
  return { ok: true, today: today.iso, remindersEnabled: enabled, fetched: fetched.length, orders: rows, note: 'Dry run: nothing was saved or sent.' };
}

/** Single-flight, throttled (5 min) unless `force` (user-clicked sync). */
export function syncPharmarackOrders(force = false): Promise<PharmarackOrderSyncResult> {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastRunAt < MIN_GAP_MS) {
    return Promise.resolve({ ok: true, skipped: 'throttled', fetched: 0, newOrders: 0, followUps: 0 });
  }
  lastRunAt = Date.now();
  inFlight = runSync()
    .then(async (r) => {
      if (r.newOrders > 0) {
        // Dispatch + Cart pages mark their data stale and refresh on their own (SSE, no polling).
        try {
          const { eventService } = await import('./eventService.js');
          eventService.broadcast('dispatch_updated', { at: Date.now(), source: 'pharmarack_order_sync', count: r.newOrders });
        } catch (_) { /* UI refresh is best effort */ }
      }
      return r;
    })
    .catch((err: any) => ({ ok: false, fetched: 0, newOrders: 0, followUps: 0, error: err?.message || 'sync failed' }) as PharmarackOrderSyncResult)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Historical order sync: fetches the past `days` (up to 30) of orders from Pharmarack DisplayOrders.
 * Ingests external orders into `pharmarack_synced_orders`, `pharmarack_placed_orders`, and `pharmarack_distributor_products`.
 */
export async function syncHistoricalPharmarackOrders(days = 30): Promise<{ ok: boolean; fetched: number; imported: number; error?: string }> {
  try {
    const db = await dbManager.getConnection();
    const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'");
    const token = tokenRow?.value || '';
    if (!token) return { ok: false, fetched: 0, imported: 0, error: 'No Pharmarack session token' };

    const safeDays = Math.min(60, Math.max(1, days));
    const now = new Date();
    const past = new Date(Date.now() - safeDays * 86400000);
    const p = (n: number) => String(n).padStart(2, '0');
    const toDdmmyy = `${p(now.getDate())}/${p(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
    const fromDdmmyy = `${p(past.getDate())}/${p(past.getMonth() + 1)}/${String(past.getFullYear()).slice(-2)}`;

    const res = await fetch(ORDER_LIST_URL, {
      method: 'POST',
      headers: {
        'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        'Content-Type': 'application/json',
        'devicetype': 'web',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://retailers.pharmarack.com/',
        'Origin': 'https://retailers.pharmarack.com'
      },
      body: JSON.stringify({
        searchtext: '',
        fromdate: fromDdmmyy,
        todate: toDdmmyy,
        Operation: 'view',
        status: '1,2,3',
        pageNo: 1,
        pageSize: 200,
        isMapped: true
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) return { ok: false, fetched: 0, imported: 0, error: `DisplayOrders HTTP ${res.status}` };
    const json: any = await res.json();
    const orders: any[] = Array.isArray(json?.data) ? json.data : [];

    let importedCount = 0;
    const { upsertDistributorProducts, autoSaveMedicineDistributorLinks } = await import('../routes/pharmarack.js');

    for (const o of orders) {
      const orderNo = String(o?.OrderNo ?? '').trim();
      const storeName = String(o?.StoreName ?? '').trim();
      if (!orderNo || !storeName) continue;
      const orderDate = orderDayIso(o?.OrderDate);
      if (!orderDate) continue;

      const amountNum = parseFloat(String(o?.OrderAmount ?? ''));
      const amount = Number.isFinite(amountNum) ? amountNum : null;
      const storeId = Number.isFinite(Number(o?.storeId)) ? Number(o.storeId) : (Number.isFinite(Number(o?.StoreId)) ? Number(o.StoreId) : null);
      const orderId = Number.isFinite(Number(o?.OrderId)) ? Number(o.OrderId) : null;

      await db.run(
        `INSERT OR IGNORE INTO pharmarack_synced_orders
           (order_no, pharmarack_order_id, store_id, store_name, order_amount, order_date, first_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderNo, orderId, storeId, storeName, amount, orderDate, Date.now()]
      );

      // Check if row in pharmarack_placed_orders exists for this specific order
      let placedRow = await db.get(
        `SELECT id, items_json, order_no FROM pharmarack_placed_orders WHERE order_no = ? LIMIT 1`,
        [orderNo]
      );
      if (!placedRow) {
        // Only attach to an in-app order on that day for that store IF it lacks an order_no
        placedRow = await db.get(
          `SELECT id, items_json, order_no FROM pharmarack_placed_orders 
           WHERE order_date = ? AND LOWER(TRIM(store_name)) = LOWER(TRIM(?)) AND (order_no IS NULL OR order_no = '') 
           ORDER BY id ASC LIMIT 1`,
          [orderDate, storeName]
        );
      }

      let lines: any[] = [];
      if (!placedRow || !placedRow.items_json || placedRow.items_json === '[]') {
        const fetchedLines = await fetchOrderLines(db, token, orderId, orderNo);
        if (fetchedLines && fetchedLines.length > 0) {
          lines = fetchedLines;
        }
      } else {
        try { lines = JSON.parse(placedRow.items_json); } catch (_) {}
      }

      if (!placedRow) {
        await db.run(
          `INSERT INTO pharmarack_placed_orders
             (order_date, store_id, store_name, order_no, items_json, delivery_persons_json, placed_at, batch_sent, batch_sent_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, 0, NULL)`,
          [orderDate, storeId, storeName, orderNo, JSON.stringify(lines), Date.now()]
        );
        importedCount++;
      } else {
        if (!placedRow.order_no) {
          await db.run(`UPDATE pharmarack_placed_orders SET order_no = ? WHERE id = ?`, [orderNo, placedRow.id]);
        }
        if (lines.length > 0 && (!placedRow.items_json || placedRow.items_json === '[]')) {
          await db.run(
            `UPDATE pharmarack_placed_orders SET items_json = ? WHERE id = ?`,
            [JSON.stringify(lines), placedRow.id]
          );
        }
      }

      if (lines.length > 0 && storeId) {
        await upsertDistributorProducts(lines, storeId, storeName, 'synced_order', orderDate);
        void autoSaveMedicineDistributorLinks(lines.map(l => ({ ...l, storeId, storeName })));
      }
    }

    return { ok: true, fetched: orders.length, imported: importedCount };
  } catch (err: any) {
    console.error('Historical order sync failed:', err);
    return { ok: false, fetched: 0, imported: 0, error: err?.message || String(err) };
  }
}

