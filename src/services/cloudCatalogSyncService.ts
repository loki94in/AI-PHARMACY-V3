import { dbManager } from '../database/connection.js';
import { getStoreMedicalName, getStorePhone, getStoreAddress, getStoreGoogleMapsUrl } from './storeSettingsService.js';

const CLOUD_SERVER_URL = process.env.CLOUD_CATALOG_URL || 'https://ai-pharmacy-os.vercel.app';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin@pharmacy2026';

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
           m.mrp, m.sell_price, m.packaging as pack,
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
      WHERE c.phone IS NOT NULL AND (si.status IS NULL OR si.status != 'cancelled')
      ORDER BY si.date DESC LIMIT 150
    `);

    for (const s of recentSales) {
      const cleanPhone = String(s.customer_phone).replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        if (!customerBills[cleanPhone]) customerBills[cleanPhone] = [];
        if (customerBills[cleanPhone].length < 5) {
          const items = await db.all(`
            SELECT sit.quantity as qty, sit.unit_price as price, sit.medicine_name as name
            FROM sale_items sit WHERE sit.invoice_id = ?
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
             m.name as medicineName, m.packaging as pack, m.sell_price as price,
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

  try {
    const res = await fetch(`${CLOUD_SERVER_URL}/api/catalog/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': ADMIN_SECRET,
      },
      body: JSON.stringify({ storeInfo, medicines, customerBills, customerRefills }),
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
  const db = await dbManager.getConnection();

  try {
    const res = await fetch(`${CLOUD_SERVER_URL}/api/catalog/orders`, {
      headers: { 'x-admin-secret': ADMIN_SECRET },
    });

    const data: any = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, message: data.error || 'Failed to fetch cloud orders' };
    }

    const orders = data.orders || [];
    if (orders.length === 0) {
      return { success: true, message: 'Zero pending orders in cloud queue.', ordersImported: 0 };
    }

    const importedIds: string[] = [];

    for (const o of orders) {
      // Check if already imported
      const exists = await db.get(`SELECT id FROM special_orders WHERE sync_id = ?`, [o.orderId]);
      if (!exists) {
        const itemsSummary = (o.items || [])
          .map((it: any) => `${it.name} (x${it.qty})`)
          .join(', ');

        const addressNotes = o.address ? `Delivery Address: ${o.address}` : 'Counter Store Pickup';
        const fullNotes = o.notes ? `${addressNotes} | Notes: ${o.notes}` : addressNotes;

        await db.run(
          `INSERT INTO special_orders (
            store_id, requester, phone, notes, product, medicine_name, qty,
            status, priority, customer_order_source, order_type, total_amount, sync_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            1,
            o.customerName || 'Online Customer',
            o.phone || '',
            fullNotes,
            itemsSummary,
            itemsSummary,
            o.items?.reduce((sum: number, it: any) => sum + (it.qty || 1), 0) || 1,
            'Pending',
            'High',
            'website_247',
            o.orderType || 'DELIVERY',
            o.totalAmount || 0,
            o.orderId,
          ]
        );
      }
      importedIds.push(o.orderId);
    }

    // Acknowledge imported orders on cloud server
    if (importedIds.length > 0) {
      await fetch(`${CLOUD_SERVER_URL}/api/catalog/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': ADMIN_SECRET,
        },
        body: JSON.stringify({ orderIds: importedIds }),
      });
    }

    return {
      success: true,
      message: `Successfully imported ${importedIds.length} new online order(s) into counter queue!`,
      ordersImported: importedIds.length,
    };
  } catch (err: any) {
    console.error('[CloudCatalogSync] pull error:', err);
    return { success: false, message: err.message };
  }
}
