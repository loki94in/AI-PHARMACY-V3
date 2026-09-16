import { kv, isKvConfigured } from './_db.js';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin@pharmacy2026';

const DEFAULT_STORES = [
  {
    storeId: 'PHARM-PUNE-MAIN',
    name: 'Pune City Pharmacy (Main Branch)',
    tagline: '24/7 Super-Speciality Dispensary & Refill Hub',
    phone: '+91 98765 43210',
    whatsapp: '919876543210',
    address: 'Shop #4, Near Railway Station, MG Road, Pune, Maharashtra 411001',
    hours: 'Open 24 Hours · All Days',
    deliveryAvailable: true,
    minOrderForDelivery: 199,
  },
  {
    storeId: 'PHARM-HOSPITAL-RD',
    name: 'AI Pharmacy (Hospital Road Branch)',
    tagline: 'Emergency & Acute Care Medicine Center',
    phone: '+91 98765 43211',
    whatsapp: '919876543211',
    address: 'Plot 12, Opposite Sassoon Hospital, Station Rd, Pune 411001',
    hours: 'Open 8:00 AM – 11:00 PM',
    deliveryAvailable: true,
    minOrderForDelivery: 149,
  },
  {
    storeId: 'PHARM-WESTSIDE',
    name: 'AI Pharmacy (Westside Clinic Branch)',
    tagline: 'Chronic & Diabetic Care Specialty Store',
    phone: '+91 98765 43212',
    whatsapp: '919876543212',
    address: 'Shop 101, Paud Road, Near City Pride, Kothrud, Pune 411038',
    hours: 'Open 8:30 AM – 10:30 PM',
    deliveryAvailable: true,
    minOrderForDelivery: 199,
  }
];

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

function generateId(prefix = 'ORD') {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${rand}`;
}

// ================= DDoS DEFENSE & RATE LIMITING ENGINE =================
const rateLimitMap = new Map();
const RATE_LIMIT_CLEANUP_INTERVAL = 60 * 1000;
let lastCleanup = Date.now();

function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  if (now - lastCleanup > RATE_LIMIT_CLEANUP_INTERVAL) {
    for (const [k, record] of rateLimitMap.entries()) {
      if (now - record.startTime > windowMs) {
        rateLimitMap.delete(k);
      }
    }
    lastCleanup = now;
  }

  const record = rateLimitMap.get(key) || { count: 0, startTime: now };

  if (now - record.startTime > windowMs) {
    record.count = 1;
    record.startTime = now;
    rateLimitMap.set(key, record);
    return { allowed: true, remaining: maxRequests - 1 };
  }

  record.count += 1;
  rateLimitMap.set(key, record);

  if (record.count > maxRequests) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: maxRequests - record.count };
}

function getClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    return String(xForwardedFor).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.method === 'GET' ? 'list' : 'order');

  // ================= 1. LIST PHARMACY STORES NETWORK =================
  if (action === 'stores') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    let stores = DEFAULT_STORES;
    if (isKvConfigured) {
      try {
        const storedStores = await kv.get('catalog:stores');
        if (Array.isArray(storedStores) && storedStores.length > 0) {
          stores = storedStores;
        } else {
          // Check licenses to expose registered pharmacy names
          const licenseKeys = await kv.lrange('licenses:index', 0, 50);
          if (Array.isArray(licenseKeys) && licenseKeys.length > 0) {
            const dynamicStores = [];
            for (const key of licenseKeys) {
              const lic = await kv.get(`license:${key}`);
              if (lic?.pharmacyName) {
                dynamicStores.push({
                  storeId: lic.licenseId,
                  name: lic.pharmacyName,
                  tagline: lic.notes || 'Verified Medical Dispensary',
                  phone: '+91 98765 43210',
                  whatsapp: '919876543210',
                  address: lic.notes || 'Pune City',
                  hours: 'Open 8:00 AM – 11:00 PM',
                  deliveryAvailable: true,
                });
              }
            }
            if (dynamicStores.length > 0) stores = dynamicStores;
          }
        }
      } catch (err) {
        console.warn('KV stores load fallback:', err.message);
      }
    }
    return res.status(200).json({ success: true, count: stores.length, stores });
  }

  // ================= 2. PUBLIC STORE CATALOG & OFFERS =================
  if (action === 'list') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    const storeId = req.query.storeId || req.query.store || 'PHARM-DEFAULT';
    let medicines = DEFAULT_MEDICINES;
    let storeInfo = DEFAULT_STORES[0];

    if (isKvConfigured) {
      try {
        // Try store-specific catalog, fallback to global
        const storeMeds = await kv.get(`store:${storeId}:medicines`);
        const globalMeds = await kv.get('catalog:medicines');
        medicines = storeMeds || globalMeds || DEFAULT_MEDICINES;

        const storeProfile = await kv.get(`store:${storeId}:info`);
        const globalStore = await kv.get('catalog:store_info');
        storeInfo = storeProfile || globalStore || DEFAULT_STORES[0];
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

  // ================= 3. UNIVERSAL CUSTOMER LOGIN / PROFILE =================
  if (action === 'customer_login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const clientIp = getClientIp(req);
    const rateCheck = checkRateLimit(`login:${clientIp}`, 6, 60000);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: 'Too many login attempts. Please wait 1 minute before trying again.' });
    }

    // Silent honeypot bot trap
    if (req.body?.website_url_check || req.body?.hp_check) {
      return res.status(200).json({ success: true, customer: { name: 'Patient', phone: '0000000000' } });
    }

    const { phone, name, pin, storeId } = req.body || {};
    const cleanPhone = String(phone || '').replace(/\D/g, '');

    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    let customer = {
      phone: cleanPhone,
      name: (name || 'Valued Patient').trim(),
      pin: pin ? String(pin).trim() : '1234',
      preferredStoreId: storeId || 'PHARM-DEFAULT',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    let bills = [];
    let refills = [];
    let orders = [];

    if (isKvConfigured) {
      try {
        const existingCust = await kv.get(`customer:${cleanPhone}:profile`);
        if (existingCust) {
          customer = { ...existingCust, lastLoginAt: new Date().toISOString() };
          if (name && name !== 'Valued Patient') customer.name = name.trim();
          if (storeId) customer.preferredStoreId = storeId;
        }
        await kv.set(`customer:${cleanPhone}:profile`, customer);

        // Fetch customer bills, refills, and past orders
        const savedBills = await kv.get(`customer:${cleanPhone}:bills`);
        if (Array.isArray(savedBills)) bills = savedBills;

        const savedRefills = await kv.get(`customer:${cleanPhone}:refills`);
        if (Array.isArray(savedRefills)) refills = savedRefills;

        const savedOrderIds = await kv.lrange(`customer:${cleanPhone}:orders`, 0, 50);
        if (Array.isArray(savedOrderIds)) {
          for (const oid of savedOrderIds) {
            const o = await kv.get(`order:${oid}`);
            if (o) orders.push(o);
          }
        }
      } catch (err) {
        console.warn('Customer login KV sync warning:', err.message);
      }
    }

    // If no refills yet, provide verified sample chronic refill setup for demo patient
    if (refills.length === 0) {
      refills = [
        {
          id: 'RFL-101',
          medicineName: 'Telma 40 Tablet',
          pack: 'Strip of 30 Tablets',
          dosage: '1 Tablet Daily (Morning)',
          daysInterval: 30,
          remainingDays: 5,
          nextDueDate: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
          price: 255.0,
          status: 'Refill Due Soon',
        },
        {
          id: 'RFL-102',
          medicineName: 'Glycomet-GP 1 Tablet PR',
          pack: 'Strip of 15 Tablets',
          dosage: '1 Tablet After Dinner',
          daysInterval: 30,
          remainingDays: 7,
          nextDueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
          price: 125.0,
          status: 'Active Chronic Care',
        },
        {
          id: 'RFL-103',
          medicineName: 'Thyronorm 50mcg Tablet',
          pack: 'Bottle of 120 Tablets',
          dosage: '1 Tablet Empty Stomach (Morning)',
          daysInterval: 90,
          remainingDays: 24,
          nextDueDate: new Date(Date.now() + 24 * 86400000).toISOString().split('T')[0],
          price: 185.0,
          status: 'Active',
        }
      ];
    }

    // If no past bills yet, provide verified sample invoices
    if (bills.length === 0) {
      bills = [
        {
          invoiceNo: 'INV-2026-904',
          date: new Date(Date.now() - 25 * 86400000).toISOString().split('T')[0],
          storeName: 'Pune City Pharmacy',
          totalAmount: 565.0,
          items: [
            { name: 'Telma 40 Tablet', qty: 1, price: 255.0 },
            { name: 'Glycomet-GP 1 Tablet PR', qty: 2, price: 125.0 },
            { name: 'Dolo 650 Tablet', qty: 1, price: 30.0 },
          ]
        },
        {
          invoiceNo: 'INV-2026-812',
          date: new Date(Date.now() - 55 * 86400000).toISOString().split('T')[0],
          storeName: 'Pune City Pharmacy',
          totalAmount: 440.0,
          items: [
            { name: 'Foracort 200 Inhaler', qty: 1, price: 395.0 },
            { name: 'Pan 40 Tablet', qty: 1, price: 150.0 },
          ]
        }
      ];
    }

    return res.status(200).json({
      success: true,
      customer,
      bills,
      refills,
      orders,
    });
  }

  // ================= 4. CUSTOMER REFILL REORDER =================
  if (action === 'refill_request') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const clientIp = getClientIp(req);
    const rateCheck = checkRateLimit(`refill:${clientIp}`, 6, 60000);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: 'Too many refill requests submitted rapidly. Please wait 1 minute.' });
    }

    // Silent honeypot bot trap
    if (req.body?.website_url_check || req.body?.hp_check) {
      return res.status(200).json({ success: true, orderId: generateId('RFL'), message: 'Refill request submitted successfully!' });
    }

    const { customerName, phone, storeId, items, deliveryAddress, notes } = req.body || {};
    const cleanPhone = String(phone || '').replace(/\D/g, '');

    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Valid phone number required for refill.' });
    }

    const orderId = generateId('RFL');
    let subtotal = 0;
    const processedItems = (items || []).map(it => {
      const price = Number(it.price || it.sell_price || 0);
      const qty = Math.max(1, parseInt(it.qty || 1, 10));
      subtotal += price * qty;
      return {
        name: it.name || it.medicineName,
        pack: it.pack || 'Standard',
        qty,
        price,
        itemTotal: price * qty,
      };
    });

    const refillOrder = {
      orderId,
      customerName: (customerName || 'Patient').trim(),
      phone: cleanPhone,
      address: deliveryAddress || 'Counter Store Pickup',
      orderType: deliveryAddress ? 'DELIVERY' : 'PICKUP',
      notes: notes ? `Refill Prescription: ${notes}` : 'Automatic Monthly Refill Reorder',
      items: processedItems,
      totalAmount: subtotal,
      status: 'Refill Requested',
      isRefill: true,
      source: 'Universal Patient Portal',
      createdAt: new Date().toISOString(),
    };

    let storePhone = '919876543210';
    let storeName = 'Pune City Pharmacy';

    if (isKvConfigured) {
      try {
        const targetStore = await kv.get(`store:${storeId}:info`) || await kv.get('catalog:store_info');
        if (targetStore?.whatsapp) storePhone = String(targetStore.whatsapp).replace(/\D/g, '');
        if (targetStore?.name) storeName = targetStore.name;

        await kv.set(`order:${orderId}`, refillOrder);
        await kv.lpush('orders:pending', orderId);
        await kv.lpush(`customer:${cleanPhone}:orders`, orderId);
      } catch (err) {
        console.warn('Refill KV save error:', err.message);
      }
    }

    const itemsText = processedItems.map((it, i) => `${i + 1}. *${it.name}* (Qty: ${it.qty}) — ₹${it.itemTotal}`).join('\n');
    const waMsg = `🔄 *Monthly Refill Request — ${storeName}*\n\n` +
      `*Refill ID:* #${orderId}\n` +
      `*Patient:* ${refillOrder.customerName}\n` +
      `*Phone:* ${refillOrder.phone}\n` +
      `*Fulfillment:* ${refillOrder.orderType === 'DELIVERY' ? '🛵 Home Delivery' : '🏪 Counter Pickup'}\n` +
      (deliveryAddress ? `*Delivery Address:* ${deliveryAddress}\n` : '') +
      `\n*Chronic Medicines to Refill:*\n${itemsText}\n\n` +
      `*Total Refill Amount:* ₹${subtotal}\n\n` +
      `_Please prepare and dispatch my monthly medication!_`;

    const whatsappUrl = `https://wa.me/${storePhone}?text=${encodeURIComponent(waMsg)}`;

    return res.status(200).json({
      success: true,
      orderId,
      message: 'Refill request submitted successfully to your pharmacy!',
      order: refillOrder,
      whatsappUrl,
    });
  }

  // ================= 5. GENERAL CART ORDER PLACEMENT =================
  if (action === 'order') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const clientIp = getClientIp(req);
    const rateCheck = checkRateLimit(`order:${clientIp}`, 6, 60000);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: 'Too many orders placed rapidly from this address. Please wait 1 minute.' });
    }

    // Silent honeypot bot trap
    if (req.body?.website_url_check || req.body?.hp_check) {
      return res.status(200).json({ success: true, orderId: generateId('ORD'), message: 'Order placed successfully!' });
    }

    const { customerName, phone, address, orderType, items, notes, storeId } = req.body || {};

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

    const orderId = generateId('ORD');
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
      storeId: storeId || 'PHARM-DEFAULT',
      source: 'Website 24/7 Cloud Shop',
      createdAt,
    };

    let storePhone = '919876543210';
    let storeName = 'Pune City Pharmacy';

    if (isKvConfigured) {
      try {
        const storeInfo = await kv.get(`store:${storeId}:info`) || await kv.get('catalog:store_info');
        if (storeInfo?.whatsapp) storePhone = String(storeInfo.whatsapp).replace(/\D/g, '');
        if (storeInfo?.name) storeName = storeInfo.name;

        await kv.set(`order:${orderId}`, order);
        await kv.lpush('orders:pending', orderId);
        await kv.lpush(`customer:${cleanPhone}:orders`, orderId);
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

  // ================= 6. PROTECTED INVENTORY & CUSTOMER SYNC =================
  if (action === 'sync') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const clientSecret = req.headers['x-admin-secret'] || req.body?.adminSecret;
    if (!clientSecret || clientSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Invalid admin secret.' });
    }

    const { storeInfo, medicines, customerBills, customerRefills } = req.body || {};
    if (!Array.isArray(medicines)) {
      return res.status(400).json({ error: 'Medicines must be an array.' });
    }

    if (!isKvConfigured) {
      return res.status(503).json({ error: 'Database not configured.' });
    }

    try {
      const storeId = storeInfo?.storeId || 'PHARM-DEFAULT';

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
      await kv.set(`store:${storeId}:medicines`, cleanedMeds);

      if (storeInfo && typeof storeInfo === 'object') {
        await kv.set('catalog:store_info', storeInfo);
        await kv.set(`store:${storeId}:info`, storeInfo);

        // Update stores index
        let stores = await kv.get('catalog:stores') || [];
        const existingIdx = stores.findIndex(s => s.storeId === storeId);
        if (existingIdx >= 0) {
          stores[existingIdx] = storeInfo;
        } else {
          stores.push(storeInfo);
        }
        await kv.set('catalog:stores', stores);
      }

      // Sync customer bills if provided
      if (customerBills && typeof customerBills === 'object') {
        for (const [phone, bills] of Object.entries(customerBills)) {
          const cleanPhone = String(phone).replace(/\D/g, '');
          if (cleanPhone.length >= 10) {
            await kv.set(`customer:${cleanPhone}:bills`, bills);
          }
        }
      }

      // Sync customer refills if provided
      if (customerRefills && typeof customerRefills === 'object') {
        for (const [phone, refills] of Object.entries(customerRefills)) {
          const cleanPhone = String(phone).replace(/\D/g, '');
          if (cleanPhone.length >= 10) {
            await kv.set(`customer:${cleanPhone}:refills`, refills);
          }
        }
      }

      await kv.set('catalog:last_synced_at', new Date().toISOString());

      return res.status(200).json({
        success: true,
        message: `Successfully synchronized ${cleanedMeds.length} medicines and customer records to cloud!`,
        count: cleanedMeds.length,
        syncedAt: new Date().toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: `Failed to sync catalog: ${err.message}` });
    }
  }

  // ================= 7. PROTECTED ORDERS DISPATCH & SYNC =================
  if (action === 'orders') {
    const clientSecret = req.headers['x-admin-secret'] || req.query?.secret;
    if (!clientSecret || clientSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Invalid admin secret.' });
    }

    if (!isKvConfigured) {
      return res.status(503).json({ error: 'Database not configured.' });
    }

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

  // ================= 8. MULTI-STORE OWNER AUTHENTICATION =================
  if (action === 'owner_login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const clientSecret = req.headers['x-admin-secret'] || req.body?.adminSecret || req.body?.secret;
    if (!clientSecret || clientSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Invalid owner secret key.' });
    }

    let stores = DEFAULT_STORES;
    if (isKvConfigured) {
      try {
        const storedStores = await kv.get('catalog:stores');
        if (Array.isArray(storedStores) && storedStores.length > 0) {
          stores = storedStores;
        }
      } catch (err) {
        console.warn('Owner login stores fetch warning:', err.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Owner authenticated successfully.',
      owner: {
        role: 'OWNER',
        name: 'Pharmacy Group Owner',
        storesCount: stores.length,
      },
      stores,
      activeStoreId: stores[0]?.storeId || 'PHARM-PUNE-MAIN',
    });
  }

  // ================= 9. MULTI-STORE REMOTE ORDERS MANAGEMENT =================
  if (action === 'owner_orders') {
    const clientSecret = req.headers['x-admin-secret'] || req.query?.secret;
    if (!clientSecret || clientSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Invalid owner secret key.' });
    }

    const targetStoreId = req.query.storeId || req.query.store || null;
    const statusFilter = (req.query.status || 'all').toLowerCase();

    let orders = [];
    if (isKvConfigured) {
      try {
        const pendingIds = await kv.lrange('orders:pending', 0, 150) || [];
        const orderIdSet = new Set(pendingIds);

        for (const id of orderIdSet) {
          const o = await kv.get(`order:${id}`);
          if (o) {
            if (!targetStoreId || o.storeId === targetStoreId || o.storeId === 'PHARM-DEFAULT') {
              if (statusFilter === 'all' || (o.status || '').toLowerCase().includes(statusFilter)) {
                orders.push(o);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Owner orders fetch error:', err.message);
      }
    }

    orders.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    return res.status(200).json({
      success: true,
      storeId: targetStoreId,
      count: orders.length,
      orders,
    });
  }

  // ================= 10. MULTI-STORE ORDER STATUS UPDATE & WHATSAPP DISPATCH =================
  if (action === 'update_order_status') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const clientSecret = req.headers['x-admin-secret'] || req.body?.adminSecret;
    if (!clientSecret || clientSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Invalid owner secret key.' });
    }

    const { orderId, newStatus, storeId, notes } = req.body || {};
    if (!orderId || !newStatus) {
      return res.status(400).json({ error: 'orderId and newStatus are required.' });
    }

    let updatedOrder = null;
    let storePhone = '919876543210';
    let storeName = 'Pune City Pharmacy';

    if (isKvConfigured) {
      try {
        const existing = await kv.get(`order:${orderId}`);
        if (!existing) {
          return res.status(404).json({ error: 'Order not found.' });
        }

        existing.status = newStatus;
        existing.statusUpdatedAt = new Date().toISOString();
        if (notes) existing.ownerNotes = notes;

        await kv.set(`order:${orderId}`, existing);
        updatedOrder = existing;

        const sId = storeId || existing.storeId;
        const storeInfo = await kv.get(`store:${sId}:info`) || await kv.get('catalog:store_info');
        if (storeInfo?.whatsapp) storePhone = String(storeInfo.whatsapp).replace(/\D/g, '');
        if (storeInfo?.name) storeName = storeInfo.name;
      } catch (err) {
        return res.status(500).json({ error: `Failed to update order: ${err.message}` });
      }
    }

    let statusEmoji = '📦';
    if (newStatus === 'Accepted') statusEmoji = '✅';
    if (newStatus === 'Ready for Pickup') statusEmoji = '🛍️';
    if (newStatus === 'Dispatched') statusEmoji = '🛵';
    if (newStatus === 'Completed') statusEmoji = '🎉';
    if (newStatus === 'Cancelled') statusEmoji = '❌';

    const customerPhone = updatedOrder?.phone ? String(updatedOrder.phone).replace(/\D/g, '') : '';
    const waText = `${statusEmoji} *Order Update — ${storeName}*\n\n` +
      `*Order ID:* #${orderId}\n` +
      `*Status:* ${newStatus}\n` +
      (notes ? `*Note:* ${notes}\n` : '') +
      `\nThank you for choosing ${storeName}! If you have questions, please reply to this message.`;

    const customerWhatsappUrl = customerPhone ? `https://wa.me/${customerPhone}?text=${encodeURIComponent(waText)}` : null;

    return res.status(200).json({
      success: true,
      message: `Order #${orderId} marked as ${newStatus}!`,
      order: updatedOrder,
      customerWhatsappUrl,
    });
  }

  // ================= 11. MULTI-STORE MEDICINE AVAILABILITY TOGGLE =================
  if (action === 'toggle_availability') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const clientSecret = req.headers['x-admin-secret'] || req.body?.adminSecret;
    if (!clientSecret || clientSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Invalid owner secret key.' });
    }

    const { storeId, medicineId, inStock } = req.body || {};
    if (!storeId || medicineId === undefined) {
      return res.status(400).json({ error: 'storeId and medicineId are required.' });
    }

    if (!isKvConfigured) {
      return res.status(503).json({ error: 'Database not configured.' });
    }

    try {
      let meds = await kv.get(`store:${storeId}:medicines`);
      if (!Array.isArray(meds)) {
        meds = await kv.get('catalog:medicines') || DEFAULT_MEDICINES;
      }

      const target = meds.find(m => String(m.id) === String(medicineId) || m.name === medicineId);
      if (!target) {
        return res.status(404).json({ error: 'Medicine not found in catalog.' });
      }

      target.in_stock = Boolean(inStock);
      target.updated_at = new Date().toISOString();

      await kv.set(`store:${storeId}:medicines`, meds);

      return res.status(200).json({
        success: true,
        message: `${target.name} is now ${target.in_stock ? 'IN STOCK' : 'OUT OF STOCK'} for store ${storeId}.`,
        medicine: target,
      });
    } catch (err) {
      return res.status(500).json({ error: `Failed to toggle availability: ${err.message}` });
    }
  }

  // ================= 12. MULTI-STORE KPI STATS =================
  if (action === 'store_stats') {
    const clientSecret = req.headers['x-admin-secret'] || req.query?.secret;
    if (!clientSecret || clientSecret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Invalid owner secret key.' });
    }

    const storeId = req.query.storeId || 'PHARM-PUNE-MAIN';
    let pendingCount = 0;
    let readyCount = 0;
    let totalRevenue = 0;
    let totalMeds = DEFAULT_MEDICINES.length;
    let outOfStockCount = 0;

    if (isKvConfigured) {
      try {
        const pendingIds = await kv.lrange('orders:pending', 0, 100) || [];
        for (const id of pendingIds) {
          const o = await kv.get(`order:${id}`);
          if (o && (o.storeId === storeId || o.storeId === 'PHARM-DEFAULT')) {
            if (o.status === 'Pending' || o.status === 'Refill Requested') pendingCount++;
            if (o.status === 'Ready for Pickup' || o.status === 'Accepted') readyCount++;
            totalRevenue += Number(o.totalAmount || 0);
          }
        }

        const meds = await kv.get(`store:${storeId}:medicines`) || await kv.get('catalog:medicines') || DEFAULT_MEDICINES;
        if (Array.isArray(meds)) {
          totalMeds = meds.length;
          outOfStockCount = meds.filter(m => m.in_stock === false).length;
        }
      } catch (err) {
        console.warn('Store stats compute warning:', err.message);
      }
    }

    return res.status(200).json({
      success: true,
      storeId,
      stats: {
        pendingOrders: pendingCount,
        readyOrders: readyCount,
        estimatedRevenue: totalRevenue,
        totalMedicines: totalMeds,
        outOfStockMedicines: outOfStockCount,
      }
    });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
