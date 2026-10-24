import { dbManager } from '../database/connection.js';
import { getStoreMedicalName, getStorePhone, getStoreAddress, getStoreGoogleMapsUrl } from './storeSettingsService.js';

const CLOUD_SERVER_URL = process.env.CLOUD_CATALOG_URL || 'https://ai-pharmacy-os.vercel.app';

export async function getAdminSecret(): Promise<string> {
  if (process.env.ADMIN_SECRET && process.env.ADMIN_SECRET.trim() !== '') {
    return process.env.ADMIN_SECRET.trim();
  }
  try {
    const db = await dbManager.getConnection();
    const row = await db.get(
      "SELECT value FROM app_settings WHERE key = 'cloud_admin_secret' OR key = 'admin_secret'"
    );
    if (row?.value && row.value.trim() !== '') {
      return row.value.trim();
    }
  } catch (_) {}
  return '';
}

export interface CloudSyncResult {
  success: boolean;
  message: string;
  count?: number;
  ordersImported?: number;
}

/**
 * Pushes in-stock and portal-visible medicines from local SQLite to the 24/7 Upstash Cloud Catalog.
 */
export async function pushLocalCatalogToCloud(): Promise<CloudSyncResult> {
  const db = await dbManager.getConnection();

  // Query medicines that are in stock or portal-visible
  const rows = await db.all(`
    SELECT m.id, m.name, m.generic_name as composition, m.manufacturer, m.category,
           COALESCE(
             (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id AND im.quantity > 0),
             (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id),
             m.mrp,
             0
           ) as mrp,
           COALESCE(
             (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id AND im.quantity > 0),
             (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id),
             m.sell_price,
             m.mrp,
             0
           ) as sell_price,
           m.packaging as pack,
           COALESCE((SELECT SUM(im.quantity) FROM inventory_master im WHERE im.medicine_id = m.id), 0) as stock_qty
    FROM medicines m
    LEFT JOIN product_channel_visibility pcv ON pcv.medicine_id = m.id
    WHERE (pcv.is_portal_visible = 1 OR pcv.is_website_visible = 1 OR (SELECT SUM(im.quantity) FROM inventory_master im WHERE im.medicine_id = m.id) > 0)
    ORDER BY m.name ASC
    LIMIT 1000
  `);

  if (!rows || rows.length === 0) {
    return { success: false, message: 'No medicines found to publish to cloud.' };
  }

  // Get Store Information from app_settings
  const storeRows = await db.all(`SELECT key, value FROM app_settings WHERE key LIKE 'pharmacy_%'`);
  const storeMap: Record<string, string> = {};
  storeRows.forEach((r: any) => { storeMap[r.key] = r.value; });

  const storeName = await getStoreMedicalName(db);
  const storePhone = await getStorePhone(db);
  const storeAddress = await getStoreAddress(db);
  const storeMapUrl = await getStoreGoogleMapsUrl(db);

  const storeInfo = {
    name: storeName,
    tagline: storeMap['pharmacy_tagline'] || '',
    phone: storePhone,
    whatsapp: storePhone.replace(/\D/g, ''),
    address: storeAddress,
    googleMapsUrl: storeMapUrl,
    hours: storeMap['pharmacy_hours'] || '',
    deliveryAvailable: true,
  };

  const medicines = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    composition: r.composition || '',
    category: r.category || 'General',
    manufacturer: r.manufacturer || 'Pharmacy Stock',
    pack: r.pack || 'Standard Pack',
    mrp: Number(r.mrp || 0),
    sell_price: Number(r.sell_price || r.mrp || 0),
    in_stock: Number(r.stock_qty || 0) > 0,
    stock_qty: Number(r.stock_qty || 0),
  }));

  // Gather recent customer bills grouped by phone number
  const customerBills: Record<string, any[]> = {};
  try {
    const recentSales = await db.all(`
      SELECT si.id, si.invoice_no, si.total_amount, si.date, c.phone as customer_phone
      FROM sales_invoices si
      JOIN customers c ON c.id = si.customer_id
      WHERE c.phone IS NOT NULL AND (si.payment_status IS NULL OR si.payment_status != 'cancelled')
      ORDER BY si.date DESC LIMIT 150
    `);

    for (const s of recentSales) {
      const cleanPhone = String(s.customer_phone).replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        if (!customerBills[cleanPhone]) customerBills[cleanPhone] = [];
        if (customerBills[cleanPhone].length < 5) {
          const items = await db.all(`
            SELECT sit.quantity as qty, sit.unit_price as price, COALESCE(sit.medicine_name_snapshot, m.name, 'Medicine') as name
            FROM sale_items sit
            LEFT JOIN inventory_master im ON im.id = sit.inventory_id
            LEFT JOIN medicines m ON m.id = im.medicine_id
            WHERE sit.invoice_id = ?
          `, [s.id]).catch(() => []);
          customerBills[cleanPhone].push({
            invoiceNo: s.invoice_no,
            date: s.date,
            storeName: storeInfo.name,
            totalAmount: s.total_amount,
            items
          });
        }
      }
    }
  } catch (_) {}

  // Gather active patient refills grouped by phone number
  const customerRefills: Record<string, any[]> = {};
  try {
    const refills = await db.all(`
      SELECT pr.id, pr.refill_interval_days, pr.quantity_needed, pr.next_refill_date,
             m.name as medicineName, m.packaging as pack,
             COALESCE(
               (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id AND im.quantity > 0),
               (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id),
               m.sell_price,
               m.mrp,
               0
             ) as price,
             COALESCE(
               (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id AND im.quantity > 0),
               (SELECT MAX(im.mrp) FROM inventory_master im WHERE im.medicine_id = m.id),
               m.mrp,
               0
             ) as mrp,
             c.phone as customer_phone
      FROM patient_refills pr
      JOIN medicines m ON m.id = pr.medicine_id
      JOIN customers c ON c.id = pr.customer_id
      WHERE pr.is_active = 1 AND c.phone IS NOT NULL
    `);

    for (const r of refills) {
      const cleanPhone = String(r.customer_phone).replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        if (!customerRefills[cleanPhone]) customerRefills[cleanPhone] = [];
        customerRefills[cleanPhone].push({
          id: `RFL-${r.id}`,
          medicineName: r.medicineName,
          pack: r.pack || 'Standard',
          dosage: 'Prescribed Daily Dosage',
          daysInterval: r.refill_interval_days || 30,
          nextDueDate: r.next_refill_date || 'Monthly',
          price: r.price,
        });
      }
    }
  } catch (_) {}

  // Gather owner authentication hashes for cloud remote login (no plaintext passwords ever leave the PC)
  let ownerAuth: any[] = [];
  try {
    const ownerUsers = await db.all(
      "SELECT id, username, password_hash, salt FROM pharmacy_users WHERE role = 'owner' AND is_active = 1"
    );
    ownerAuth = (ownerUsers || []).map((u: any) => ({
      id: u.id,
      username: u.username,
      password_hash: u.password_hash,
      salt: u.salt
    }));
  } catch (_) {}

  const secret = await getAdminSecret();
  if (!secret) {
    return {
      success: false,
      message: 'Cloud sync not configured: ADMIN_SECRET is missing. Please configure ADMIN_SECRET in Settings or environment variables.'
    };
  }

  try {
    const res = await fetch(`${CLOUD_SERVER_URL}/api/catalog/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': secret,
      },
      body: JSON.stringify({ storeInfo, medicines, customerBills, customerRefills, ownerAuth }),
    });

    const data: any = await res.json();
    if (res.ok && data.success) {
      return {
        success: true,
        message: `Successfully synchronized ${medicines.length} medicines to 24/7 Cloud Shop!`,
        count: medicines.length,
      };
    }
    return { success: false, message: data.error || 'Failed to sync to cloud' };
  } catch (err: any) {
    console.error('[CloudCatalogSync] push error:', err);
    return { success: false, message: err.message };
  }
}

/**
 * Fetches pending orders placed by customers on the 24/7 Cloud Shop and imports them into local SQLite `special_orders`.
 */
export async function pullCloudOrdersToLocal(): Promise<CloudSyncResult> {
  const secret = await getAdminSecret();
  if (!secret) {
    return { success: false, message: 'Cloud sync not configured: ADMIN_SECRET is missing.' };
  }

  const db = await dbManager.getConnection();

  try {
    const res = await fetch(`${CLOUD_SERVER_URL}/api/catalog/orders`, {
      headers: { 'x-admin-secret': secret },
    });

    const data: any = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, message: data.error || 'Failed to fetch cloud orders' };
    }

    const orders = data.orders || [];
    if (orders.length === 0) {
      return { success: true, message: 'Zero pending orders in cloud queue.', ordersImported: 0 };
    }

    const { normalizeLanguage } = await import('./whatsappLocalizer.js');
    const importedIds: string[] = [];
    let newImportCount = 0;

    for (const o of orders) {
      const cleanPhone = String(o.phone || '').replace(/\D/g, '').slice(-10);

      // Sync customer preferred language if provided
      const rawLang = o.preferredLanguage || o.language;
      if (rawLang && cleanPhone.length === 10) {
        const normLang = normalizeLanguage(rawLang);
        await db.run(
          `UPDATE customers SET preferred_language = ? WHERE phone LIKE ?`,
          [normLang, `%${cleanPhone}%`]
        ).catch(() => {});
        await db.run(
          `UPDATE whatsapp_chats SET language = ? WHERE resolved_number LIKE ?`,
          [normLang, `%${cleanPhone}%`]
        ).catch(() => {});
      }

      // Check if already imported
      const exists = await db.get(`SELECT id FROM special_orders WHERE sync_id = ?`, [o.orderId]);
      if (!exists) {
        newImportCount++;
        const itemsSummary = (o.items || [])
          .map((it: any) => `${it.name} (x${it.qty || 1})`)
          .join(', ');

        const addressNotes = o.address ? `Delivery Address: ${o.address}` : 'Counter Store Pickup';
        const fullNotes = o.notes ? `${addressNotes} | Notes: ${o.notes}` : addressNotes;

        const isRefill = Boolean(o.isRefill || o.orderType === 'REFILL' || o.action === 'refill_request');
        const isSpecialOrder = Boolean(o.isSpecialOrder || o.orderType === 'SPECIAL_ORDER');

        let matchedCustomerId: number | null = null;
        let customerName = o.customerName || 'Online Customer';

        if (cleanPhone.length === 10) {
          const cust = await db.get(`SELECT id, name FROM customers WHERE phone LIKE ?`, [`%${cleanPhone}%`]);
          if (cust) {
            matchedCustomerId = cust.id;
            if (!o.customerName) customerName = cust.name;
          }
        }

        const paymentMethod = o.paymentMethod || (o.payment_declared ? 'UPI' : (o.isCredit ? 'CREDIT' : 'COUNTER_PICKUP'));
        const paymentStatus = o.payment_declared
          ? 'PENDING_VERIFICATION'
          : (paymentMethod === 'CREDIT' ? 'UNPAID' : (o.payment_status || 'PENDING'));
        const paymentNotes = o.payment_declared
          ? ` [Payment Declared: ${o.payment_declared.method || 'UPI'}]`
          : (paymentMethod === 'CREDIT' ? ' [Payment Method: CREDIT / PAY LATER]' : '');
        const orderNotesWithPayment = `${fullNotes}${paymentNotes}`;

        if (isRefill) {
          // Check if patient has an active refill for any of these items
          if (matchedCustomerId) {
            for (const it of (o.items || [])) {
              const refill = await db.get(
                `SELECT pr.id FROM patient_refills pr 
                 JOIN medicines m ON m.id = pr.medicine_id
                 WHERE pr.customer_id = ? AND (LOWER(m.name) = LOWER(?) OR LOWER(m.name) LIKE LOWER(?)) LIMIT 1`,
                [matchedCustomerId, it.name, `%${it.name}%`]
              );
              if (refill) {
                await db.run(
                  `UPDATE patient_refills 
                   SET next_refill_date = date('now'), source = 'website', cart_status = 'pending', updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?`,
                  [refill.id]
                ).catch(() => {});
              } else {
                const med = await db.get(
                  `SELECT id FROM medicines WHERE LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?) LIMIT 1`,
                  [it.name, `%${it.name}%`]
                );
                if (med) {
                  await db.run(
                    `INSERT INTO patient_refills (
                      customer_id, patient_name, patient_phone, medicine_id, refill_interval_days, quantity_needed, next_refill_date, is_active, source, cart_status
                    ) VALUES (?, ?, ?, ?, ?, ?, date('now'), 1, 'website', 'pending')`,
                    [matchedCustomerId, customerName, cleanPhone, med.id, 30, it.qty || 1]
                  ).catch(() => {});
                }
              }
            }
          }

          await db.run(
            `INSERT INTO special_orders (
              store_id, requester, phone, notes, product, medicine_name, qty,
              status, priority, customer_order_source, order_type, total_amount, sync_id,
              payment_method, payment_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              1,
              customerName,
              o.phone || '',
              `[Website Refill Request #${o.orderId}] ${orderNotesWithPayment}`,
              itemsSummary,
              itemsSummary,
              o.items?.reduce((sum: number, it: any) => sum + (it.qty || 1), 0) || 1,
              'Pending',
              'High',
              'website_refill',
              'REFILL',
              o.totalAmount || 0,
              o.orderId,
              paymentMethod,
              paymentStatus
            ]
          );
        } else if (isSpecialOrder) {
          await db.run(
            `INSERT INTO special_orders (
              store_id, requester, phone, notes, product, medicine_name, qty,
              status, priority, customer_order_source, order_type, total_amount, sync_id,
              payment_method, payment_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              1,
              customerName,
              o.phone || '',
              `[Special Shortage Request #${o.orderId}] ${orderNotesWithPayment}`,
              itemsSummary,
              itemsSummary,
              o.items?.reduce((sum: number, it: any) => sum + (it.qty || 1), 0) || 1,
              'Pending',
              'High',
              'website_special_order',
              'SPECIAL_ORDER',
              o.totalAmount || 0,
              o.orderId,
              paymentMethod,
              paymentStatus
            ]
          );
        } else {
          await db.run(
            `INSERT INTO special_orders (
              store_id, requester, phone, notes, product, medicine_name, qty,
              status, priority, customer_order_source, order_type, total_amount, sync_id,
              payment_method, payment_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              1,
              customerName,
              o.phone || '',
              orderNotesWithPayment,
              itemsSummary,
              itemsSummary,
              o.items?.reduce((sum: number, it: any) => sum + (it.qty || 1), 0) || 1,
              'Pending',
              'High',
              'website_247',
              o.orderType || 'DELIVERY',
              o.totalAmount || 0,
              o.orderId,
              paymentMethod,
              paymentStatus
            ]
          );
        }
      }
      importedIds.push(o.orderId);
    }

    // Acknowledge imported orders on cloud server
    if (importedIds.length > 0) {
      await fetch(`${CLOUD_SERVER_URL}/api/catalog/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': secret,
        },
        body: JSON.stringify({ orderIds: importedIds }),
      }).catch(err => console.warn('[CloudCatalogSync] order ack failed:', err?.message || err));
    }

    if (newImportCount > 0) {
      try {
        const { eventService } = await import('./eventService.js');
        eventService.broadcast('order_created', { count: newImportCount, source: 'cloud_sync' });
        eventService.broadcast('refill_updated', { source: 'cloud_sync' });
        eventService.broadcast('toast_alert', {
          type: 'success',
          message: `📥 ${newImportCount} new order(s)/refill(s) received from 24/7 Web Portal!`,
          link: '/crm?tab=special_orders'
        });
      } catch (_) {}

      // Trigger catch-up cart add if online refills were received
      try {
        const { startupSyncCoordinator } = await import('./startupSyncCoordinator.js');
        void startupSyncCoordinator.runRefillAutoCartCatchUp('cloud_pull');
      } catch (err) {
        console.warn('[CloudCatalogSync] runRefillAutoCartCatchUp error:', err);
      }
    }

    // Drain queued online live-cart requests into Pharmarack
    try {
      const { cartQueueSyncService } = await import('./cartQueueSyncService.js');
      await cartQueueSyncService.drainCartAddQueue();
    } catch (qErr: any) {
      console.warn('[CloudCatalogSync] cart queue drain error:', qErr.message);
    }

    return {
      success: true,
      message: `Successfully imported ${newImportCount} new online order(s) into counter queue!`,
      ordersImported: newImportCount,
    };
  } catch (err: any) {
    console.error('[CloudCatalogSync] pull error:', err);
    return { success: false, message: err.message };
  }
}

let pollerActive = false;
let isPulling = false;
let lastAutoPushAt = 0;
let autoPushPending = false;
let autoPushTimer: NodeJS.Timeout | null = null;
const AUTO_PUSH_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes minimum spacing

/**
 * Event-driven auto-push debouncer:
 * Triggers cloud catalog / CRM snapshot push after refills, sales, or orders update,
 * debounced by at least 5 minutes and idle-gated to protect foreground speed.
 */
export function scheduleCloudAutoPush(trigger = 'event'): void {
  const now = Date.now();
  if (autoPushPending) return;

  const delay = Math.max(0, AUTO_PUSH_DEBOUNCE_MS - (now - lastAutoPushAt));
  autoPushPending = true;

  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(async () => {
    autoPushPending = false;
    lastAutoPushAt = Date.now();
    try {
      const db = await dbManager.getConnection();
      const autoSetting = await db.get("SELECT value FROM app_settings WHERE key = 'cloud_sync_auto'");
      if (autoSetting && (autoSetting.value === '0' || autoSetting.value === 'false')) {
        return; // Auto-sync turned off by user
      }
      const secret = await getAdminSecret();
      if (!secret) return; // Unconfigured secret skips silently

      const { activityTracker } = await import('../utils/activityTracker.js');
      if (activityTracker.isIdle()) {
        // Postpone push until user is active
        lastAutoPushAt = Date.now() - (AUTO_PUSH_DEBOUNCE_MS - 60000);
        return;
      }

      await pushLocalCatalogToCloud();
    } catch (err: any) {
      console.warn(`[CloudCatalogSync] Auto-push error (${trigger}):`, err?.message || err);
    }
  }, delay);
}

/**
 * Initializes automatic background synchronization for 24/7 cloud orders and cart additions.
 * Staggered on startup with a quiet single-flight 60-second periodic poll.
 */
export function startCloudOrderSyncPoller(): void {
  if (pollerActive) return;
  pollerActive = true;

  // Stagger initial check 8 seconds after boot
  setTimeout(async () => {
    try {
      await pullCloudOrdersToLocal();
    } catch (_) {}
  }, 8000);

  // Subscribe to local database events for debounced auto-push
  import('./eventService.js').then(({ eventService }) => {
    eventService.on('server_event', (event: { type: string; payload?: any }) => {
      if (['refill_updated', 'order_created', 'sale_saved'].includes(event?.type)) {
        scheduleCloudAutoPush(event.type);
      }
    });
  }).catch(() => {});

  // Quiet 60-second background poll - gated by activityTracker
  setInterval(async () => {
    if (isPulling) return;
    try {
      const { activityTracker } = await import('../utils/activityTracker.js');
      if (activityTracker.isIdle()) return;
      isPulling = true;
      await pullCloudOrdersToLocal();
    } catch (_) {
      // Offline or network error is silent and normal
    } finally {
      isPulling = false;
    }
  }, 60_000);
}

