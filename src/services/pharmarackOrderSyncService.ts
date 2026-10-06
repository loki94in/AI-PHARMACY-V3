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
  const byStore = new Map<string, any[]>();
  for (const o of orders) {
    const k = String(o?.StoreName ?? '').toLowerCase().trim();
    if (!k || !o?.OrderNo) continue;
    const day = orderDayIso(o?.OrderDate);
    if (day && day !== todayIso) continue;
    byStore.set(k, [...(byStore.get(k) || []), o]);
  }
  for (const [, list] of byStore) {
    const row = await db.get(
      `SELECT id, items_json FROM pharmarack_placed_orders WHERE order_date = ? AND LOWER(TRIM(store_name)) = LOWER(TRIM(?)) ORDER BY id DESC LIMIT 1`,
      [todayIso, String(list[0].StoreName).trim()]
    );
    if (!row) continue;
    let existing: any[] = [];
    try { existing = JSON.parse(row.items_json || '[]'); } catch (_) { /* treat as empty */ }
    if (existing.length > 0) continue; // the app's own Send All lines are never overwritten
    const lines: Array<{ productName: string; qty: number | null; productCode?: string; mrp?: number; rate?: number }> = [];
    for (const o of list) {
      const got = await fetchOrderLines(db, token, Number.isFinite(Number(o.OrderId)) ? Number(o.OrderId) : null, String(o.OrderNo));
      if (got) lines.push(...got);
    }
    if (lines.length === 0) continue;
    await db.run('UPDATE pharmarack_placed_orders SET items_json = ? WHERE id = ?', [JSON.stringify(lines), row.id]);
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

    // Make the distributor appear in today's dispatch reminders. If the app already logged an
    // order for this store today (Send All via WhatsApp) nothing new is added: no double counting.
    // Item lines are not invented: Pharmarack gives names only, so items_json stays empty.
    const logged = await db.get(
      `SELECT id FROM pharmarack_placed_orders WHERE order_date = ? AND LOWER(TRIM(store_name)) = LOWER(TRIM(?)) LIMIT 1`,
      [today.iso, storeName]
    );
    if (!logged) {
      await db.run(
        `INSERT INTO pharmarack_placed_orders (order_date, store_id, store_name, items_json, delivery_persons_json, placed_at, batch_sent, batch_sent_at)
         VALUES (?, ?, ?, '[]', NULL, ?, 0, NULL)`,
        [today.iso, storeId, storeName, Date.now()] // placed_at = when the app noticed it
      );
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
      continue;
    }

    // Status becomes 'Dispatched' when the queue worker really sends the reminder, so anything
    // other than Pending means today's reminder already went out (or the invoice mail arrived).
    const alreadyReminded = Boolean(row.status && row.status !== 'Pending');
    if (!alreadyReminded) {
      // Nothing queued yet: the reminder built later will list these order number(s) itself.
      await settle(db, orderNos, 'scheduled_reminder_will_include', false, { storeName, appAlreadySent });
      continue;
    }

    const sent = await notificationService.sendDistributorDispatchReminder(row.id, undefined, undefined, { followUp: true, orderNos });
    await settle(db, orderNos, sent ? 'follow_up_queued' : 'follow_up_not_sent', sent, { storeName, status: row.status, appAlreadySent });
    if (sent) {
      result.followUps++;
      lateReminders.push(row);
    }
  }

  // 3. Delivery boys: their afternoon list is unchanged. If it already went out today, send the same
  //    list again for just the distributors that received a late order.
  if (lateReminders.length > 0) {
    try {
      const afternoon = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_afternoon_dispatch_reminder_enabled'");
      const alreadySent = await db.get(
        `SELECT id FROM automation_notifications
         WHERE type = 'afternoon_delivery_boy_dispatch' AND DATE(created_at, 'localtime') = ? AND status = 'sent' LIMIT 1`,
        [today.iso]
      );
      if (afternoon?.value === 'true' && alreadySent) {
        await notificationService.sendConsolidatedDeliveryBoyDispatch(lateReminders);
      }
    } catch (err: any) {
      console.warn('[PharmarackOrderSync] Delivery boy late-order list failed:', err?.message || err);
    }
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
    else if (!reminder) wouldDo = 'create today\'s reminder row; the scheduled reminder will carry the order number';
    else if (reminder.status === 'Pending') wouldDo = 'the scheduled reminder will carry the order number; no extra message';
    else wouldDo = `send ONE follow-up to the distributor (reminder row status is "${reminder.status}")`;
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
