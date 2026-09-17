import { dbManager } from '../../database/connection.js';
import { pricingService } from '../pricing/pricingService.js';
import { logger } from '../../utils/logger.js';

export interface CatalogProduct {
  id: number;
  name: string;
  genericName?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  category?: string | null;
  strength?: string | null;
  packaging?: string | null;
  dosageForm?: string | null;
  scheduleType?: string | null;
  prescriptionRequired: boolean;
  mrp: number;
  sellingPrice: number;
  discountPercent: number;
  availableStock: number;
  isInStock: boolean;
  imagePath?: string | null;
  thumbnailPath?: string | null;
  description?: string | null;
  sideEffects?: string | null;
  visibility: {
    website: boolean;
    whatsapp: boolean;
    portal: boolean;
    pos: boolean;
  };
}

export interface CatalogQueryParams {
  search?: string;
  category?: string;
  channel?: 'website' | 'whatsapp' | 'portal' | 'pos' | 'all';
  inStockOnly?: boolean;
  limit?: number;
  offset?: number;
  storeId?: number;
}

class CatalogService {
  /**
   * Query centralized catalog for a specific channel
   */
  async getCatalog(params: CatalogQueryParams = {}): Promise<{ products: CatalogProduct[]; total: number }> {
    const start = Date.now();
    const limit = Math.min(params.limit || 50, 100);
    const offset = Math.max(params.offset || 0, 0);
    const channel = params.channel || 'all';
    const storeId = params.storeId || 1;
    const search = (params.search || '').trim();
    const category = (params.category || '').trim();

    try {
      const db = await dbManager.getConnection();

      let whereClauses: string[] = ['1=1'];
      const queryParams: any[] = [];

      // Channel visibility filtering
      if (channel === 'website') {
        whereClauses.push('(pcv.is_website_visible IS NULL OR pcv.is_website_visible = 1)');
      } else if (channel === 'whatsapp') {
        whereClauses.push('(pcv.is_whatsapp_visible IS NULL OR pcv.is_whatsapp_visible = 1)');
      } else if (channel === 'portal') {
        whereClauses.push('(pcv.is_portal_visible IS NULL OR pcv.is_portal_visible = 1)');
      } else if (channel === 'pos') {
        whereClauses.push('(pcv.is_pos_visible IS NULL OR pcv.is_pos_visible = 1)');
      }

      // Category filter
      if (category) {
        whereClauses.push('m.category = ?');
        queryParams.push(category);
      }

      // Fast prefix search if search query exists
      if (search) {
        whereClauses.push('(m.name LIKE ? OR m.manufacturer LIKE ? OR m.therapeutic LIKE ?)');
        queryParams.push(`${search}%`, `%${search}%`, `%${search}%`);
      }

      const whereSql = whereClauses.join(' AND ');

      // Count query
      const countRow = await db.get<{ count: number }>(
        `SELECT COUNT(*) as count 
         FROM medicines m 
         LEFT JOIN product_channel_visibility pcv ON pcv.medicine_id = m.id 
         WHERE ${whereSql}`,
        queryParams
      );
      const total = countRow?.count || 0;

      // Core query joining medicines, stock, channel visibility, and active approved images
      const sql = `
        SELECT 
          m.id,
          m.name,
          m.manufacturer,
          m.category,
          m.packaging,
          m.strength,
          m.schedule_type,
          m.mrp,
          m.sell_price as legacy_sell_price,
          COALESCE(m.generic_name, m.therapeutic) as generic_name,
          mci.medicine_desc as description,
          mci.side_effects,
          COALESCE(SUM(inv.quantity), 0) as total_quantity,
          COALESCE(SUM(inv.loose_quantity), 0) as total_loose,
          ci.image_path,
          ci.thumbnail_path,
          pcv.is_website_visible,
          pcv.is_whatsapp_visible,
          pcv.is_portal_visible,
          pcv.is_pos_visible
        FROM medicines m
        LEFT JOIN inventory_master inv ON inv.medicine_id = m.id AND (inv.store_id = ? OR inv.store_id IS NULL)
        LEFT JOIN product_channel_visibility pcv ON pcv.medicine_id = m.id
        LEFT JOIN medicine_clinical_info mci ON mci.medicine_id = m.id
        LEFT JOIN catalog_images ci ON ci.medicine_id = m.id AND ci.is_active = 1
        WHERE ${whereSql}
        GROUP BY m.id
        ORDER BY ${search ? 'm.name ASC' : 'pcv.featured_rank DESC, m.name ASC'}
        LIMIT ? OFFSET ?
      `;

      const rows = await db.all(sql, [storeId, ...queryParams, limit, offset]);

      // Enrich rows with central pricing engine
      const products: CatalogProduct[] = await Promise.all(
        rows.map(async (r: any) => {
          const mrp = Number(r.mrp) || 0;
          const calculatedPrice = await pricingService.calculatePrice({
            mrp,
            costPrice: null,
            category: r.category,
            medicineId: r.id,
            storeId
          });

          // Final selling price: if centralized pricing engine produced a price, use it; fallback to legacy sell_price or MRP
          const sellingPrice = calculatedPrice.sellingPrice || (r.legacy_sell_price ? Number(r.legacy_sell_price) : mrp);
          const totalStock = Number(r.total_quantity) || 0;
          const sched = (r.schedule_type || '').toUpperCase();
          const isRx = sched === 'H' || sched === 'H1' || sched === 'X';

          return {
            id: r.id,
            name: r.name,
            genericName: r.generic_name || null,
            brand: r.manufacturer || null,
            manufacturer: r.manufacturer || null,
            category: r.category || null,
            strength: r.strength || null,
            packaging: r.packaging || null,
            dosageForm: null,
            scheduleType: r.schedule_type || null,
            prescriptionRequired: isRx,
            mrp,
            sellingPrice,
            discountPercent: calculatedPrice.discountPercent,
            availableStock: totalStock,
            isInStock: totalStock > 0,
            imagePath: r.image_path || null,
            thumbnailPath: r.thumbnail_path || null,
            description: r.description || null,
            sideEffects: r.side_effects || null,
            visibility: {
              website: r.is_website_visible === null || r.is_website_visible === 1,
              whatsapp: r.is_whatsapp_visible === null || r.is_whatsapp_visible === 1,
              portal: r.is_portal_visible === null || r.is_portal_visible === 1,
              pos: r.is_pos_visible === null || r.is_pos_visible === 1
            }
          };
        })
      );

      logger.debug(`Catalog query completed in ${Date.now() - start}ms`, {
        module: 'CatalogService',
        operation: 'getCatalog',
        channel,
        total
      });

      return { products, total };
    } catch (err) {
      logger.error('Failed to query catalog', err, { module: 'CatalogService' });
      return { products: [], total: 0 };
    }
  }

  /**
   * Get single product details by ID
   */
  async getProductById(id: number, storeId = 1): Promise<CatalogProduct | null> {
    try {
      const db = await dbManager.getConnection();
      const row = await db.get(
        `SELECT 
           m.id, m.name, m.manufacturer, m.category, m.packaging, m.strength, 
           m.schedule_type, m.mrp, m.sell_price as legacy_sell_price, m.therapeutic as generic_name,
           COALESCE(SUM(inv.quantity), 0) as total_quantity,
           ci.image_path, ci.thumbnail_path,
           pcv.is_website_visible, pcv.is_whatsapp_visible, pcv.is_portal_visible, pcv.is_pos_visible
         FROM medicines m
         LEFT JOIN inventory_master inv ON inv.medicine_id = m.id AND (inv.store_id = ? OR inv.store_id IS NULL)
         LEFT JOIN product_channel_visibility pcv ON pcv.medicine_id = m.id
         LEFT JOIN catalog_images ci ON ci.medicine_id = m.id AND ci.is_active = 1
         WHERE m.id = ?
         GROUP BY m.id`,
        [storeId, id]
      );

      if (!row) return null;

      const mrp = Number(row.mrp) || 0;
      const calculatedPrice = await pricingService.calculatePrice({
        mrp,
        category: row.category,
        medicineId: row.id,
        storeId
      });

      const sched = (row.schedule_type || '').toUpperCase();
      return {
        id: row.id,
        name: row.name,
        genericName: row.generic_name || null,
        brand: row.manufacturer || null,
        manufacturer: row.manufacturer || null,
        category: row.category || null,
        strength: row.strength || null,
        packaging: row.packaging || null,
        dosageForm: null,
        scheduleType: row.schedule_type || null,
        prescriptionRequired: sched === 'H' || sched === 'H1' || sched === 'X',
        mrp,
        sellingPrice: calculatedPrice.sellingPrice || (row.legacy_sell_price ? Number(row.legacy_sell_price) : mrp),
        discountPercent: calculatedPrice.discountPercent,
        availableStock: Number(row.total_quantity) || 0,
        isInStock: (Number(row.total_quantity) || 0) > 0,
        imagePath: row.image_path || null,
        thumbnailPath: row.thumbnail_path || null,
        visibility: {
          website: row.is_website_visible === null || row.is_website_visible === 1,
          whatsapp: row.is_whatsapp_visible === null || row.is_whatsapp_visible === 1,
          portal: row.is_portal_visible === null || row.is_portal_visible === 1,
          pos: row.is_pos_visible === null || row.is_pos_visible === 1
        }
      };
    } catch (err) {
      logger.error(`Failed to get product by ID ${id}`, err, { module: 'CatalogService' });
      return null;
    }
  }

  /**
   * Update channel visibility and featured ranking
   */
  async updateChannelVisibility(medicineId: number, visibility: Partial<CatalogProduct['visibility']> & { featuredRank?: number }): Promise<void> {
    const db = await dbManager.getConnection();
    await db.run(
      `INSERT INTO product_channel_visibility (medicine_id, is_website_visible, is_whatsapp_visible, is_portal_visible, is_pos_visible, featured_rank, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(medicine_id) DO UPDATE SET
         is_website_visible = COALESCE(?, is_website_visible),
         is_whatsapp_visible = COALESCE(?, is_whatsapp_visible),
         is_portal_visible = COALESCE(?, is_portal_visible),
         is_pos_visible = COALESCE(?, is_pos_visible),
         featured_rank = COALESCE(?, featured_rank),
         updated_at = CURRENT_TIMESTAMP`,
      [
        medicineId,
        visibility.website !== undefined ? (visibility.website ? 1 : 0) : 1,
        visibility.whatsapp !== undefined ? (visibility.whatsapp ? 1 : 0) : 1,
        visibility.portal !== undefined ? (visibility.portal ? 1 : 0) : 1,
        visibility.pos !== undefined ? (visibility.pos ? 1 : 0) : 1,
        visibility.featuredRank ?? 0,
        // Update bindings:
        visibility.website !== undefined ? (visibility.website ? 1 : 0) : null,
        visibility.whatsapp !== undefined ? (visibility.whatsapp ? 1 : 0) : null,
        visibility.portal !== undefined ? (visibility.portal ? 1 : 0) : null,
        visibility.pos !== undefined ? (visibility.pos ? 1 : 0) : null,
        visibility.featuredRank !== undefined ? visibility.featuredRank : null
      ]
    );
  }
}

export const catalogService = new CatalogService();
