/**
 * websiteOwner.ts
 *
 * Multi-Store Pharmacy Owner Management Portal API
 *
 * Provides token-based owner authentication and store-scoped management
 * endpoints for the website owner portal.
 *
 * Auth model:
 *   - Owner accounts are seeded via owner_store_access table
 *   - Login validates a shared app PIN from app_settings (key: 'owner_portal_pin')
 *     plus email from owner_store_access — simple, spec-compliant, no new auth system
 *   - Session tokens expire after 24h; stored in website_owner_sessions
 *   - Every store-scoped endpoint validates user → store permission server-side
 *
 * Security principle from spec §14:
 *   "Frontend hiding a button is NOT security. Backend must enforce authorization."
 *
 * Registered at: /api/website/owner
 */

import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { dbManager } from '../database/connection.js';
import { storeContextService } from '../services/storeContextService.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';

const router = express.Router();

// ─── Token Auth Middleware ────────────────────────────────────────────────────

interface OwnerSession {
  email: string;
  storeIds: number[];
}

/**
 * Extracts and validates the owner session token from Authorization header.
 * Sets res.locals.ownerSession on success.
 */
async function requireOwnerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    res.status(401).json({ error: 'Missing owner authorization token' });
    return;
  }

  try {
    const db = await dbManager.getConnection();
    const session = await db.get(
      `SELECT * FROM website_owner_sessions
       WHERE token = ? AND datetime(expires_at) > datetime('now')`,
      [token]
    );

    if (!session) {
      res.status(401).json({ error: 'Invalid or expired session token. Please log in again.' });
      return;
    }

    let storeIds: number[] = [];
    try { storeIds = JSON.parse(session.store_ids_json || '[]'); } catch (_) {}

    (res.locals as any).ownerSession = { email: session.email, storeIds } as OwnerSession;
    next();
  } catch (err) {
    console.error('[OwnerPortal] Auth middleware error:', err);
    res.status(500).json({ error: 'Authentication check failed' });
  }
}

/**
 * Checks that the session owner has access to the requested store.
 * Returns storeId on success, or sends 403 and returns null.
 */
function resolveAuthorizedStore(req: Request, res: Response): number | null {
  const session = (res.locals as any).ownerSession as OwnerSession;
  const rawId = (req.query.store_id as string) || (req.params.store_id as string) || '0';
  const storeId = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10);

  if (!storeId || isNaN(storeId)) {
    res.status(400).json({ error: 'store_id is required' });
    return null;
  }

  if (!session.storeIds.includes(storeId)) {
    res.status(403).json({ error: `Access denied to store #${storeId}` });
    return null;
  }

  return storeId;
}

// ─── POST /api/website/owner/login ───────────────────────────────────────────
// Authenticates owner by email + PIN, returns a 24h session token.
// PIN is stored in app_settings key 'owner_portal_pin' (set via Settings page).
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, pin } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({ error: 'pin is required' });
    }

    const db = await dbManager.getConnection();

    // Validate PIN against app_settings
    const pinRow = await db.get("SELECT value FROM app_settings WHERE key = 'owner_portal_pin'");
    const configuredPin = pinRow?.value?.trim() || '';
    if (!configuredPin) {
      return res.status(503).json({
        error: 'Owner portal PIN not configured. Please set it in Settings → Owner Portal.',
        code: 'PIN_NOT_CONFIGURED'
      });
    }

    if (pin.trim() !== configuredPin) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    // Find stores this email is authorized for
    const accessRows = await db.all(
      `SELECT store_id, role FROM owner_store_access WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND is_active = 1`,
      [email.trim()]
    );

    if (!accessRows || accessRows.length === 0) {
      return res.status(403).json({
        error: 'No stores authorized for this account. Ask your administrator to grant access.',
        code: 'NO_STORE_ACCESS'
      });
    }

    const authorizedStoreIds = accessRows.map((r: any) => r.store_id);
    const storeRoles: Record<number, string> = {};
    for (const r of accessRows) storeRoles[r.store_id] = r.role;

    // Create session token (cryptographically secure random)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

    await db.run(
      `INSERT INTO website_owner_sessions (token, email, store_ids_json, expires_at, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [token, email.trim().toLowerCase(), JSON.stringify(authorizedStoreIds), expiresAt]
    );

    // Clean up expired sessions (housekeeping)
    await db.run("DELETE FROM website_owner_sessions WHERE datetime(expires_at) <= datetime('now')").catch(() => {});

    // Fetch store details for the response
    const stores = [];
    for (const storeId of authorizedStoreIds) {
      const store = await storeContextService.getStoreById(storeId, db);
      if (store) stores.push({ ...store, role: storeRoles[storeId] || 'STAFF' });
    }

    res.json({
      success: true,
      token,
      expires_at: expiresAt,
      email: email.trim().toLowerCase(),
      authorized_stores: stores,
      message: `Logged in. ${stores.length} store(s) authorized.`
    });
  } catch (err: any) {
    console.error('[OwnerPortal] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── All routes below require auth ───────────────────────────────────────────
router.use(requireOwnerAuth);

// ─── GET /api/website/owner/stores ───────────────────────────────────────────
// Returns all stores authorized for the logged-in owner.
router.get('/stores', async (req: Request, res: Response) => {
  try {
    const session = (res.locals as any).ownerSession as OwnerSession;
    const db = await dbManager.getConnection();

    const stores = [];
    for (const storeId of session.storeIds) {
      const store = await storeContextService.getStoreById(storeId, db);
      if (store) {
        const accessRow = await db.get(
          'SELECT role FROM owner_store_access WHERE LOWER(email) = ? AND store_id = ?',
          [session.email.toLowerCase(), storeId]
        );
        stores.push({ ...store, role: accessRow?.role || 'STAFF' });
      }
    }

    res.json({ stores, total: stores.length });
  } catch (err: any) {
    console.error('[OwnerPortal] List stores error:', err);
    res.status(500).json({ error: 'Failed to fetch authorized stores' });
  }
});

// ─── GET /api/website/owner/orders ───────────────────────────────────────────
// Returns store-scoped pending/active website orders.
// ?store_id=X is required and validated against session.
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const storeId = resolveAuthorizedStore(req, res);
    if (!storeId) return;

    const db = await dbManager.getConnection();
    const status = (req.query.status as string) || 'all';
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 200);

    const statusFilter = status !== 'all' ? `AND so.status = '${status.replace(/'/g, '')}'` : '';

    const orders = await db.all(
      `SELECT so.id, so.requester as customer_name, so.phone as customer_phone,
              so.status, so.payment_status, so.pharmacy_verification_status,
              so.product, so.qty, so.notes, so.order_type, so.delivery_mode,
              so.created_at, so.updated_at, so.store_id,
              COUNT(oi.id) as item_count
       FROM special_orders so
       LEFT JOIN online_order_items oi ON oi.order_id = so.id
       WHERE so.store_id = ? AND so.source IN ('website', 'website_refill', 'customer_portal', 'online')
         ${statusFilter}
       GROUP BY so.id
       ORDER BY so.created_at DESC
       LIMIT ?`,
      [storeId, limit]
    );

    res.json({ store_id: storeId, orders, total: orders.length });
  } catch (err: any) {
    console.error('[OwnerPortal] Orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ─── GET /api/website/owner/orders/:orderId ───────────────────────────────────
// Returns full detail of a single order, store-permission validated.
router.get('/orders/:orderId', async (req: Request, res: Response) => {
  try {
    const session = (res.locals as any).ownerSession as OwnerSession;
    const orderId = parseInt(String(req.params.orderId), 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (!session.storeIds.includes(order.store_id)) {
      return res.status(403).json({ error: 'Access denied to this order' });
    }

    const items = await db.all(
      `SELECT oi.*, COALESCE(am.name, m.name) as medicine_name
       FROM online_order_items oi
       LEFT JOIN medicines m ON m.id = oi.medicine_id
       LEFT JOIN medicines am ON am.id = oi.actual_medicine_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const events = await db.all(
      'SELECT * FROM order_tracking_events WHERE order_id = ? ORDER BY performed_at ASC',
      [orderId]
    );

    res.json({ order, items, events });
  } catch (err: any) {
    console.error('[OwnerPortal] Order detail error:', err);
    res.status(500).json({ error: 'Failed to fetch order detail' });
  }
});

// ─── PATCH /api/website/owner/orders/:orderId/status ─────────────────────────
// Update order status from the owner portal. Store-permission validated.
router.patch('/orders/:orderId/status', async (req: Request, res: Response) => {
  try {
    const session = (res.locals as any).ownerSession as OwnerSession;
    const orderId = parseInt(String(req.params.orderId), 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const { status, note } = req.body;
    const allowedStatuses = ['Pending', 'Ready', 'Cancelled', 'Completed'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowedStatuses.join(', ')}` });
    }

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT store_id FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (!session.storeIds.includes(order.store_id)) {
      return res.status(403).json({ error: 'Access denied to this order' });
    }

    await db.run(
      'UPDATE special_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, orderId]
    );

    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
       VALUES (?, 'status_updated', ?, ?, CURRENT_TIMESTAMP)`,
      [orderId, `Status changed to ${status}${note ? ': ' + note : ''} (via owner portal)`, session.email]
    );

    res.json({ success: true, order_id: orderId, new_status: status });
  } catch (err: any) {
    console.error('[OwnerPortal] Order status update error:', err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// ─── POST /api/website/owner/orders/:orderId/notify ──────────────────────────
// Send a WhatsApp message to the customer for a specific order.
// Plan §10–§11: Manual Message from Owner Portal.
// Uses existing whatsappQueueWorker.enqueue() — same path as all pharmacy-side notifications.
// Store permission validated server-side.
router.post('/orders/:orderId/notify', async (req: Request, res: Response) => {
  try {
    const session = (res.locals as any).ownerSession as OwnerSession;
    const orderId = parseInt(String(req.params.orderId), 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    // message_type: one of the preset templates, or 'manual' for custom body
    const { message_type, custom_message } = req.body;
    const ALLOWED_TYPES = ['order_received', 'order_ready', 'pickup_reminder', 'manual'] as const;
    type NotifyType = typeof ALLOWED_TYPES[number];

    if (!message_type || !(ALLOWED_TYPES as readonly string[]).includes(message_type)) {
      return res.status(400).json({
        error: `message_type must be one of: ${ALLOWED_TYPES.join(', ')}`,
      });
    }

    if (message_type === 'manual' && (!custom_message || typeof custom_message !== 'string' || !custom_message.trim())) {
      return res.status(400).json({ error: 'custom_message is required when message_type is "manual"' });
    }

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Enforce store permission (§14: backend must enforce)
    if (!session.storeIds.includes(order.store_id)) {
      return res.status(403).json({ error: 'Access denied to this order' });
    }

    const phone: string = String(order.phone || '').replace(/\D/g, '');
    if (phone.length < 10) {
      return res.status(400).json({ error: 'Order has no valid customer phone number' });
    }

    // Normalise to 12-digit international format (91XXXXXXXXXX for India)
    const waPhone = phone.length === 10 ? `91${phone}` : phone;

    // Resolve store name for message context
    let storeName = 'AI Pharmacy';
    try {
      const storeRow = await db.get('SELECT medical_name, name FROM stores WHERE id = ?', [order.store_id]);
      storeName = storeRow?.medical_name || storeRow?.name || 'AI Pharmacy';
    } catch (_) {}

    const customerName: string = order.requester || 'Customer';

    // Build message body from preset template or use custom message
    let messageBody: string;
    let waType: string;

    if (message_type === 'manual') {
      messageBody = custom_message.trim();
      waType = 'owner_portal_manual';
    } else if (message_type === 'order_received') {
      messageBody = `Hello ${customerName}, your order #${orderId} at ${storeName} has been received and is being processed. We will notify you when it is ready.`;
      waType = 'order_received_notification';
    } else if (message_type === 'order_ready') {
      messageBody = `Hello ${customerName}, your order #${orderId} at ${storeName} is ready for pickup/delivery! Please collect it at your earliest convenience.`;
      waType = 'order_ready_notification';
    } else {
      // pickup_reminder
      messageBody = `Hello ${customerName}, just a reminder that your order #${orderId} at ${storeName} is waiting for pickup. Please collect it at your earliest convenience.`;
      waType = 'pickup_reminder';
    }

    // Enqueue via existing WhatsApp queue worker (§10: integrate with existing notification system)
    await whatsappQueueWorker.enqueue(waPhone, messageBody, waType, customerName);

    // Audit trail: record in order_tracking_events
    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
       VALUES (?, 'message_sent', ?, ?, CURRENT_TIMESTAMP)`,
      [
        orderId,
        `Owner portal sent "${message_type}" message to ${waPhone} (store_id=${order.store_id})`,
        session.email,
      ]
    );

    res.json({
      success: true,
      order_id: orderId,
      message_type,
      phone: waPhone,
      queued: true,
    });
  } catch (err: any) {
    console.error('[OwnerPortal] Notify error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});


// ─── GET /api/website/owner/catalogue ────────────────────────────────────────
// Returns store-specific product catalogue availability.
// ?store_id=X required. ?search=query optional.
router.get('/catalogue', async (req: Request, res: Response) => {
  try {
    const storeId = resolveAuthorizedStore(req, res);
    if (!storeId) return;

    const db = await dbManager.getConnection();
    const search = ((req.query.search as string) || '').trim();
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 200);

    const searchFilter = search
      ? `AND (m.name LIKE ? OR m.generic_name LIKE ?)`
      : '';
    const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

    const medicines = await db.all(
      `SELECT m.id as medicine_id, m.name, m.generic_name, m.strength, m.packaging, m.manufacturer, m.status,
              MAX(im.mrp) as mrp, MAX(im.sell_price) as sell_price,
              SUM(CASE WHEN im.quantity > 0 AND (im.expiry_date IS NULL OR date(im.expiry_date) > date('now')) THEN im.quantity ELSE 0 END) as available_stock,
              ci.image_path as image_url
       FROM medicines m
       LEFT JOIN inventory_master im ON im.medicine_id = m.id AND im.store_id = ? AND im.is_active = 1
       LEFT JOIN catalog_images ci ON ci.medicine_id = m.id AND ci.is_active = 1 AND ci.is_primary = 1
       WHERE (m.status IS NULL OR m.status = 'ACTIVE') ${searchFilter}
       GROUP BY m.id
       ORDER BY m.name ASC
       LIMIT ?`,
      [storeId, ...searchParams, limit]
    );

    res.json({
      store_id: storeId,
      medicines: medicines.map((m: any) => ({
        ...m,
        is_available: (m.available_stock || 0) > 0
      })),
      total: medicines.length
    });
  } catch (err: any) {
    console.error('[OwnerPortal] Catalogue error:', err);
    res.status(500).json({ error: 'Failed to fetch catalogue' });
  }
});

// ─── GET /api/website/owner/access ───────────────────────────────────────────
// Lists all owner_store_access entries for a specific store (OWNER role only).
router.get('/access', async (req: Request, res: Response) => {
  try {
    const storeId = resolveAuthorizedStore(req, res);
    if (!storeId) return;

    const session = (res.locals as any).ownerSession as OwnerSession;
    const db = await dbManager.getConnection();

    // Only OWNER can list access
    const myAccess = await db.get(
      'SELECT role FROM owner_store_access WHERE LOWER(email) = ? AND store_id = ?',
      [session.email.toLowerCase(), storeId]
    );
    if (!myAccess || myAccess.role !== 'OWNER') {
      return res.status(403).json({ error: 'Only OWNER role can view store access list' });
    }

    const accessList = await db.all(
      'SELECT email, role, is_active, created_at FROM owner_store_access WHERE store_id = ?',
      [storeId]
    );

    res.json({ store_id: storeId, access_list: accessList });
  } catch (err: any) {
    console.error('[OwnerPortal] Access list error:', err);
    res.status(500).json({ error: 'Failed to fetch access list' });
  }
});

// ─── POST /api/website/owner/access ──────────────────────────────────────────
// Grants or updates store access for an email (OWNER role only).
router.post('/access', async (req: Request, res: Response) => {
  try {
    const session = (res.locals as any).ownerSession as OwnerSession;
    const { store_id, email, role } = req.body;
    const storeId = parseInt(String(store_id || '0'), 10);

    if (!storeId || !session.storeIds.includes(storeId)) {
      return res.status(403).json({ error: 'Access denied to this store' });
    }

    const allowedRoles = ['OWNER', 'MANAGER', 'STAFF'];
    if (!email || !role || !allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'email and role (OWNER|MANAGER|STAFF) are required' });
    }

    const db = await dbManager.getConnection();
    const myAccess = await db.get(
      'SELECT role FROM owner_store_access WHERE LOWER(email) = ? AND store_id = ?',
      [session.email.toLowerCase(), storeId]
    );
    if (!myAccess || myAccess.role !== 'OWNER') {
      return res.status(403).json({ error: 'Only OWNER role can grant store access' });
    }

    await db.run(
      `INSERT INTO owner_store_access (email, store_id, role, is_active)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(email, store_id) DO UPDATE SET role = excluded.role, is_active = 1`,
      [email.trim().toLowerCase(), storeId, role]
    );

    res.json({ success: true, message: `Access granted: ${email} → Store #${storeId} as ${role}` });
  } catch (err: any) {
    console.error('[OwnerPortal] Grant access error:', err);
    res.status(500).json({ error: 'Failed to grant access' });
  }
});

// ─── POST /api/website/owner/logout ──────────────────────────────────────────
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token) {
      const db = await dbManager.getConnection();
      await db.run('DELETE FROM website_owner_sessions WHERE token = ?', [token]).catch(() => {});
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.json({ success: true }); // Always succeed on logout
  }
});

export default router;
