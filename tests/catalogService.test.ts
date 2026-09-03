import { catalogService } from '../src/services/catalog/catalogService.js';
import { dbManager } from '../src/database/connection.js';

describe('CatalogService Centralized Engine', () => {
  beforeAll(async () => {
    const db = await dbManager.getConnection();
    await db.run(`
      CREATE TABLE IF NOT EXISTS medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        api_reference TEXT,
        mrp REAL,
        hsn_code TEXT,
        schedule_type TEXT,
        manufacturer TEXT,
        category TEXT,
        marketed_by TEXT,
        legacy_id TEXT,
        packaging TEXT,
        item_type TEXT,
        cgst_per REAL DEFAULT 0,
        sgst_per REAL DEFAULT 0,
        igst_per REAL DEFAULT 0,
        rack TEXT,
        therapeutic TEXT DEFAULT NULL,
        sell_price REAL DEFAULT NULL
      )
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS product_channel_visibility (
        medicine_id INTEGER PRIMARY KEY,
        is_pos_visible INTEGER DEFAULT 1,
        is_website_visible INTEGER DEFAULT 1,
        is_whatsapp_visible INTEGER DEFAULT 1,
        is_portal_visible INTEGER DEFAULT 1,
        featured_rank INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS catalog_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER NOT NULL,
        company_name TEXT,
        product_name TEXT NOT NULL,
        image_path TEXT NOT NULL,
        thumbnail_path TEXT,
        image_source TEXT DEFAULT 'pharmeasy',
        confidence_score REAL DEFAULT 0,
        is_active INTEGER DEFAULT 0
      )
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER NOT NULL,
        store_id INTEGER DEFAULT 1,
        batch_no TEXT,
        expiry_date TEXT,
        quantity REAL DEFAULT 0,
        loose_quantity REAL DEFAULT 0,
        mrp REAL,
        cost_price REAL
      )
    `);

    // Insert sample medicine
    await db.run(`
      INSERT INTO medicines (id, name, manufacturer, category, mrp, schedule_type, packaging, therapeutic)
      VALUES (99991, 'Dolo 650mg Tablet', 'Micro Labs', 'Analgesics', 30.50, 'OTC', '15 Tablets', 'Paracetamol')
      ON CONFLICT(id) DO UPDATE SET name = 'Dolo 650mg Tablet'
    `);
    await db.run(`
      INSERT INTO inventory_master (medicine_id, store_id, quantity, mrp)
      VALUES (99991, 1, 50, 30.50)
    `);
  });

  test('fetches product by ID with stock and computed pricing', async () => {
    const product = await catalogService.getProductById(99991, 1);

    expect(product).not.toBeNull();
    expect(product?.name).toBe('Dolo 650mg Tablet');
    expect(product?.mrp).toBe(30.50);
    expect(product?.sellingPrice).toBeGreaterThan(0);
    expect(product?.availableStock).toBe(50);
    expect(product?.isInStock).toBe(true);
    expect(product?.prescriptionRequired).toBe(false);
  });

  test('updates channel visibility dynamically', async () => {
    await catalogService.updateChannelVisibility(99991, {
      website: false,
      whatsapp: true,
      portal: true,
      pos: true
    });

    const product = await catalogService.getProductById(99991, 1);
    expect(product?.visibility.website).toBe(false);
    expect(product?.visibility.whatsapp).toBe(true);
    expect(product?.visibility.portal).toBe(true);
  });
});
