import { Router, Request, Response } from 'express';
import { dbManager } from '../database/connection.js';
import { prescriptionOrchestratorService, ScanSource } from '../services/prescriptionOrchestratorService.js';

export const prescriptionsRouter = Router();

/**
 * POST /api/prescriptions/scan
 * Scan a single prescription image
 */
prescriptionsRouter.post('/scan', async (req: Request, res: Response) => {
  try {
    const { imageBase64, image, source = 'pos', msgId, storeId = 1 } = req.body;
    const rawImage = imageBase64 || image;

    if (!rawImage) {
      res.status(400).json({ error: 'Missing image input (imageBase64 or image required).' });
      return;
    }

    const base64Data = rawImage.includes(',') ? rawImage.split(',')[1] : rawImage;
    const buffer = Buffer.from(base64Data, 'base64');

    const result = await prescriptionOrchestratorService.scanPrescriptionImage({
      buffer,
      source: source as ScanSource,
      msgId,
      storeId: Number(storeId) || 1
    });

    res.json({
      success: true,
      scan: { id: result.scanId, ...result },
      ...result
    });
  } catch (err: any) {
    console.error('[Prescriptions Route] Scan failed:', err);
    res.status(500).json({ error: err.message || 'Prescription scan failed.' });
  }
});

/**
 * POST /api/prescriptions/scan-bundle
 * Scan a bundle of 1-10 prescription images (multi-page)
 */
prescriptionsRouter.post('/scan-bundle', async (req: Request, res: Response) => {
  try {
    const { images, source = 'website', storeId = 1 } = req.body;

    if (!Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: 'Missing images array in request body.' });
      return;
    }

    if (images.length > 10) {
      res.status(400).json({ error: 'Maximum 10 images allowed per bundle.' });
      return;
    }

    const buffers: Buffer[] = images.map((img: string) => {
      const b64 = img.includes(',') ? img.split(',')[1] : img;
      return Buffer.from(b64, 'base64');
    });

    const result = await prescriptionOrchestratorService.scanPrescriptionBundle(buffers, {
      source: source as ScanSource,
      storeId: Number(storeId) || 1
    });

    res.json({
      success: true,
      scan: { id: result.scanId, ...result },
      ...result
    });
  } catch (err: any) {
    console.error('[Prescriptions Route] Bundle scan failed:', err);
    res.status(500).json({ error: err.message || 'Prescription bundle scan failed.' });
  }
});

/**
 * GET /api/prescriptions/:scanId
 * Retrieve stored prescription scan with line items
 */
prescriptionsRouter.get('/:scanId', async (req: Request, res: Response) => {
  try {
    const scanId = Number(req.params.scanId);
    if (!scanId) {
      res.status(400).json({ error: 'Invalid scanId parameter.' });
      return;
    }

    const db = await dbManager.getConnection();
    const scan = await db.get('SELECT * FROM prescription_scans WHERE id = ?', [scanId]);
    if (!scan) {
      res.status(404).json({ error: 'Prescription scan not found.' });
      return;
    }

    const items = await db.all(
      `SELECT psi.*, m.name as matched_medicine_name, m.mrp as matched_medicine_mrp, m.manufacturer
       FROM prescription_scan_items psi
       LEFT JOIN medicines m ON m.id = psi.matched_medicine_id
       WHERE psi.scan_id = ?
       ORDER BY psi.line_index ASC`,
      [scanId]
    );

    const itemsFormatted = items.map((it: any) => ({
      ...it,
      matched_medicine_name: it.matched_medicine_name || it.brand_hint || it.raw_text,
      line_text: it.raw_text || it.brand_hint,
      dosage_group: it.dosage_form || 'TAB',
      in_stock: it.availability === 'IN_STOCK' || (it.inventory_qty > 0),
      catalog_hits: it.catalog_hit_json ? JSON.parse(it.catalog_hit_json) : [],
      pharmarack_hits: it.pharmarack_hit_json ? JSON.parse(it.pharmarack_hit_json) : []
    }));

    res.json({
      success: true,
      scan: {
        ...scan,
        items: itemsFormatted
      },
      items: itemsFormatted
    });
  } catch (err: any) {
    console.error('[Prescriptions Route] Get scan failed:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch prescription scan.' });
  }
});

/**
 * PUT /api/prescriptions/items/:itemId
 * Human-in-the-Loop Gate 1: Pharmacist manually corrects or approves a matched medicine
 */
prescriptionsRouter.put('/items/:itemId', async (req: Request, res: Response) => {
  try {
    const itemId = Number(req.params.itemId);
    const { matchedMedicineId, prescribedQty } = req.body;

    if (!itemId) {
      res.status(400).json({ error: 'Invalid itemId.' });
      return;
    }

    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM prescription_scan_items WHERE id = ?', [itemId]);
    if (!existing) {
      res.status(404).json({ error: 'Prescription item not found.' });
      return;
    }

    let updatedMedicineId = existing.matched_medicine_id;
    let matchType = existing.match_type;
    let inventoryQty = existing.inventory_qty;
    let availability = existing.availability;

    if (matchedMedicineId) {
      const med = await db.get('SELECT id, name FROM medicines WHERE id = ?', [matchedMedicineId]);
      if (med) {
        updatedMedicineId = med.id;
        matchType = 'manual_override';

        // Recalculate stock truth for overridden medicine
        const stockRow = await db.get(
          `SELECT COALESCE(SUM(quantity + COALESCE(loose_quantity, 0)), 0) as stock
           FROM inventory_master WHERE medicine_id = ? AND is_active = 1`,
          [med.id]
        );
        inventoryQty = stockRow?.stock || 0;
        availability = inventoryQty > 0 ? 'IN_STOCK' : 'REGISTERED_NO_STOCK';
      }
    }

    const newQty = prescribedQty !== undefined ? Number(prescribedQty) : existing.prescribed_qty;

    await db.run(
      `UPDATE prescription_scan_items
       SET matched_medicine_id = ?, match_type = ?, prescribed_qty = ?,
           inventory_qty = ?, availability = ?
       WHERE id = ?`,
      [updatedMedicineId, matchType, newQty, inventoryQty, availability, itemId]
    );

    res.json({
      success: true,
      message: 'Prescription item updated by pharmacist.',
      item: {
        id: itemId,
        matchedMedicineId: updatedMedicineId,
        matchType,
        prescribedQty: newQty,
        inventoryQty,
        availability
      }
    });
  } catch (err: any) {
    console.error('[Prescriptions Route] Update item failed:', err);
    res.status(500).json({ error: err.message || 'Failed to update prescription item.' });
  }
});

export default prescriptionsRouter;
