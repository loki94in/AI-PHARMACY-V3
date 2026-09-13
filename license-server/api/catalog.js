import { kv, isKvConfigured } from './_db.js';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin@pharmacy2026';

const DEFAULT_STORE_INFO = {
  name: 'Pune City Pharmacy',
  tagline: 'Genuine Medicines & 24/7 Online Refill Store',
  phone: '+91 98765 43210',
  whatsapp: '919876543210',
  address: 'Shop #4, Near Railway Station, MG Road, Pune, Maharashtra 411001',
  hours: 'Open 8:00 AM – 11:00 PM (Orders accepted 24/7)',
  deliveryAvailable: true,
  minOrderForDelivery: 199,
};

const DEFAULT_MEDICINES = [
  {
    id: 1,
    name: 'Glycomet-GP 1 Tablet PR',
    category: 'Diabetic Care',
    composition: 'Metformin 500mg + Glimepiride 1mg',
    manufacturer: 'USV Ltd',
    pack: 'Strip of 15 Tablets',
    mrp: 142.0,
    sell_price: 125.0,
    in_stock: true,
  },
  {
    id: 2,
    name: 'Telma 40 Tablet',
    category: 'Blood Pressure / Cardiac',
    composition: 'Telmisartan 40mg',
    manufacturer: 'Glenmark Pharmaceuticals',
    pack: 'Strip of 30 Tablets',
    mrp: 298.0,
    sell_price: 255.0,
    in_stock: true,
  },
  {
    id: 3,
    name: 'Foracort 200 Inhaler',
    category: 'Respiratory / Asthma',
    composition: 'Budesonide 200mcg + Formoterol 6mcg',
    manufacturer: 'Cipla Ltd',
    pack: '1 Inhaler (120 Metered Doses)',
    mrp: 440.0,
    sell_price: 395.0,
    in_stock: true,
  },
  {
    id: 4,
    name: 'Thyronorm 50mcg Tablet',
    category: 'Thyroid Care',
    composition: 'Thyroxine Sodium 50mcg',
    manufacturer: 'Abbott Healthcare',
    pack: 'Bottle of 120 Tablets',
    mrp: 210.0,
    sell_price: 185.0,
    in_stock: true,
  },
  {
    id: 5,
    name: 'Atorva 10 Tablet',
    category: 'Cholesterol Care',
    composition: 'Atorvastatin 10mg',
    manufacturer: 'Zydus Cadila',
    pack: 'Strip of 15 Tablets',
    mrp: 188.0,
    sell_price: 160.0,
    in_stock: true,
  },
  {
    id: 6,
    name: 'Augmentin 625 Duo Tablet',
    category: 'Antibiotics & Anti-Infectives',
    composition: 'Amoxicillin 500mg + Clavulanic Acid 125mg',
    manufacturer: 'GlaxoSmithKline',
    pack: 'Strip of 10 Tablets',
    mrp: 223.0,
    sell_price: 200.0,
    in_stock: true,
  },
  {
    id: 7,
    name: 'Pan 40 Tablet',
    category: 'Digestion & Acidity',
    composition: 'Pantoprazole 40mg',
    manufacturer: 'Alkem Laboratories',
    pack: 'Strip of 15 Tablets',
    mrp: 175.0,
    sell_price: 150.0,
    in_stock: true,
  },
  {
    id: 8,
    name: 'Dolo 650 Tablet',
    category: 'Pain Relief & Fever',
    composition: 'Paracetamol 650mg',
    manufacturer: 'Micro Labs Ltd',
    pack: 'Strip of 15 Tablets',
    mrp: 34.0,
    sell_price: 30.0,
    in_stock: true,
  },
  {
    id: 9,
    name: 'Shelcal 500 Tablet',
    category: 'Vitamins & Minerals',
    composition: 'Calcium 500mg + Vitamin D3 250 IU',
    manufacturer: 'Torrent Pharmaceuticals',
    pack: 'Strip of 15 Tablets',
    mrp: 135.0,
    sell_price: 118.0,
    in_stock: true,
  },
  {
    id: 10,
    name: 'Allegra 120mg Tablet',
    category: 'Allergy & Cough',
    composition: 'Fexofenadine Hydrochloride 120mg',
    manufacturer: 'Sanofi India',
    pack: 'Strip of 10 Tablets',
    mrp: 232.0,
    sell_price: 205.0,
    in_stock: true,
  }
];

function generateOrderId() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `ORD-${rand}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.method === 'GET' ? 'list' : 'order');

  // ================= 1. PUBLIC LIST CATALOG =================
  if (action === 'list') {
    let medicines = DEFAULT_MEDICINES;
    let storeInfo = DEFAULT_STORE_INFO;

    if (isKvConfigured) {
      try {
        const storedMeds = await kv.get('catalog:medicines');
        if (Array.isArray(storedMeds) && storedMeds.length > 0) {
          medicines = storedMeds;
        }
        const storedStore = await kv.get('catalog:store_info');
        if (storedStore && typeof storedStore === 'object') {
          storeInfo = { ...DEFAULT_STORE_INFO, ...storedStore };
        }
      } catch (err) {
        console.warn('KV catalog load fallback:', err.message);
      }
    }

    const category = (req.query.category || '').toLowerCase().trim();
    const search = (req.query.search || '').toLowerCase().trim();

    let filtered = medicines;
    if (category && category !== 'all') {
      filtered = filtered.filter(m => (m.category || '').toLowerCase().includes(category));
    }
    if (search) {
      filtered = filtered.filter(m =>
        (m.name || '').toLowerCase().includes(search) ||
        (m.composition || '').toLowerCase().includes(search) ||
        (m.manufacturer || '').toLowerCase().includes(search)
      );
    }

    return res.status(200).json({
      success: true,
      total: filtered.length,
      storeInfo,
      medicines: filtered,
    });
  }

  // ================= 2. PUBLIC PLACE ORDER =================
  if (action === 'order') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { customerName, phone, address, orderType, items, notes } = req.body || {};

    if (!customerName || !phone) {
      return res.status(400).json({ error: 'Customer name and phone number are required.' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty. Please select at least one medicine.' });
    }

    const type = (orderType || 'DELIVERY').toUpperCase();
    if (type === 'DELIVERY' && !address) {
      return res.status(400).json({ error: 'Delivery address is required for home delivery orders.' });
    }

    let subtotal = 0;
    const processedItems = items.map(it => {
      const qty = Math.max(1, parseInt(it.qty || 1, 10));
      const price = Number(it.price || it.sell_price || 0);
      const itemTotal = price * qty;
      subtotal += itemTotal;
      return {
        id: it.id,
        name: String(it.name),
        pack: String(it.pack || 'Standard'),
        qty,
        price,
        itemTotal,
      };
    });

    const orderId = generateOrderId();
    const createdAt = new Date().toISOString();

    const order = {
      orderId,
      customerName: customerName.trim(),
      phone: cleanPhone,
      address: (address || '').trim(),
      orderType: type,
      notes: (notes || '').trim(),
      items: processedItems,
      itemCount: processedItems.length,
      subtotal,
      deliveryFee: type === 'DELIVERY' && subtotal < 199 ? 30 : 0,
      totalAmount: subtotal + (type === 'DELIVERY' && subtotal < 199 ? 30 : 0),
      status: 'Pending',
      source: 'Website 24/7 Cloud Shop',
      createdAt,
    };

    let storePhone = '919876543210';
    let storeName = 'Pune City Pharmacy';

    if (isKvConfigured) {
      try {
        const storeInfo = await kv.get('catalog:store_info');
        if (storeInfo?.whatsapp) storePhone = String(storeInfo.whatsapp).replace(/\D/g, '');
        if (storeInfo?.name) storeName = storeInfo.name;

        await kv.set(`order:${orderId}`, order);
        await kv.lpush('orders:pending', orderId);
      } catch (err) {
        console.warn('[OrderPlacement] KV save warning:', err.message);
      }
    }

    const itemsListText = processedItems
      .map((it, i) => `${i + 1}. *${it.name}* (Qty: ${it.qty}) — ₹${it.itemTotal}`)
      .join('\n');

    const waMsg = `🏥 *Order Confirmation — ${storeName}*\n\n` +
      `*Order ID:* #${orderId}\n` +
      `*Patient:* ${order.customerName}\n` +
      `*Phone:* ${order.phone}\n` +
      `*Type:* ${order.orderType === 'DELIVERY' ? '🛵 Home Delivery' : '🏪 Counter Pickup'}\n` +
      (order.address ? `*Address:* ${order.address}\n` : '') +
      (order.notes ? `*Doctor/Notes:* ${order.notes}\n` : '') +
      `\n*Prescribed Items:*\n${itemsListText}\n\n` +
      `*Total Bill:* ₹${order.totalAmount}\n\n` +
      `_Please confirm dispatch availability!_`;

    const whatsappUrl = `https://wa.me/${storePhone}?text=${encodeURIComponent(waMsg)}`;

    return res.status(200).json({
      success: true,
      orderId,
      message: 'Order placed successfully!',
      order,
      whatsappUrl,
    });
  }

  // ================= 3. PROTECTED STORE INVENTORY SYNC =================
  if (action === 'sync') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const clientSecret = req.headers['x-admin-secret'] || req.body?.adminSecret;
    if (!clientSecret || clientSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Invalid admin secret.' });
    }

    const { storeInfo, medicines } = req.body || {};
    if (!Array.isArray(medicines)) {
      return res.status(400).json({ error: 'Medicines must be an array.' });
    }

    if (!isKvConfigured) {
      return res.status(503).json({ error: 'Database not configured.' });
    }

    try {
      const cleanedMeds = medicines.map((m, idx) => ({
        id: m.id || idx + 1,
        name: String(m.name || 'Medicine').trim(),
        category: String(m.category || 'General').trim(),
        composition: String(m.composition || m.generic_name || '').trim(),
        manufacturer: String(m.manufacturer || 'Pharmacy Stock').trim(),
        pack: String(m.pack || m.packaging || m.pack_size || 'Standard').trim(),
        mrp: Number(m.mrp || 0),
        sell_price: Number(m.sell_price || m.mrp || 0),
        in_stock: Boolean(m.in_stock !== false && (m.stock_qty === undefined || m.stock_qty > 0)),
        image_url: m.image_url || null,
        updated_at: new Date().toISOString(),
      }));

      await kv.set('catalog:medicines', cleanedMeds);

      if (storeInfo && typeof storeInfo === 'object') {
        await kv.set('catalog:store_info', storeInfo);
      }

      await kv.set('catalog:last_synced_at', new Date().toISOString());

      return res.status(200).json({
        success: true,
        message: `Successfully synchronized ${cleanedMeds.length} medicines to cloud catalog!`,
        count: cleanedMeds.length,
        syncedAt: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: `Failed to sync catalog: ${err.message}` });
    }
  }

  // ================= 4. PROTECTED ORDERS DISPATCH & SYNC =================
  if (action === 'orders') {
    const clientSecret = req.headers['x-admin-secret'] || req.query?.secret;
    if (!clientSecret || clientSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Invalid admin secret.' });
    }

    if (!isKvConfigured) {
      return res.status(503).json({ error: 'Database not configured.' });
    }

    // GET: List pending cloud orders
    if (req.method === 'GET') {
      try {
        const pendingIds = await kv.lrange('orders:pending', 0, 100);
        if (!Array.isArray(pendingIds) || pendingIds.length === 0) {
          return res.status(200).json({ success: true, count: 0, orders: [] });
        }

        const orders = [];
        for (const id of pendingIds) {
          const o = await kv.get(`order:${id}`);
          if (o) orders.push(o);
        }

        return res.status(200).json({
          success: true,
          count: orders.length,
          orders,
        });
      } catch (err) {
        return res.status(500).json({ error: `Failed to load orders: ${err.message}` });
      }
    }

    // POST: Acknowledge orders synced to local SQLite
    if (req.method === 'POST') {
      const { orderIds } = req.body || {};
      const idsToAcknowledge = Array.isArray(orderIds) ? orderIds : (req.body?.orderId ? [req.body.orderId] : []);

      if (idsToAcknowledge.length === 0) {
        return res.status(400).json({ error: 'No orderIds provided to acknowledge.' });
      }

      try {
        for (const id of idsToAcknowledge) {
          await kv.lrem('orders:pending', 0, id);
          const existing = await kv.get(`order:${id}`);
          if (existing) {
            existing.status = 'Imported to Store Counter';
            existing.syncedToLocalAt = new Date().toISOString();
            await kv.set(`order:${id}`, existing);
          }
        }

        return res.status(200).json({
          success: true,
          message: `Successfully marked ${idsToAcknowledge.length} orders as synced to local store!`,
        });
      } catch (err) {
        return res.status(500).json({ error: `Failed to acknowledge orders: ${err.message}` });
      }
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
