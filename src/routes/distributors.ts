import express from 'express';
import fs from 'fs';
import { dbManager } from '../database/connection.js';
import { reconcileCreditNote } from '../services/creditNoteService.js';
import { syncDistributorPhoneAcrossTables } from '../utils/distributorSyncHelper.js';
import { eventService } from '../services/eventService.js';
import { syncTodayActiveDistributors } from '../services/distributorDispatchReminderWorker.js';
import { isValidDistributorName } from '../utils/nameNormalizer.js';
import { distributorRecommendationService } from '../services/distributorRecommendationService.js';
import { resolveStoreId } from '../services/storeContextService.js';
import { validate10DigitPhone } from '../utils/phoneValidation.js';

const router = express.Router();

const getDistributorsHandler = async (_req: express.Request, res: express.Response) => {
  try {
    const db = await dbManager.getConnection();
    const distributors = await db.all('SELECT * FROM distributors ORDER BY name LIMIT 1000');
    res.json(distributors);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

router.get('/distributors', getDistributorsHandler);
router.get('/', getDistributorsHandler);

// Get Pharmarack catalog distributors list for conflict resolution and merging
router.get('/pharmarack-list', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all('SELECT * FROM pharmarack_distributors ORDER BY store_name ASC LIMIT 1000');
    res.json({ success: true, distributors: rows || [] });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch Pharmarack distributors: ' + error.message });
  }
});

// Check if a 10-digit phone number is already registered to another distributor or delivery boy
router.get('/check-duplicate-phone', async (req, res) => {
  try {
    const rawPhone = String(req.query.phone || '').trim();
    const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
    const excludeName = String(req.query.excludeName || '').toLowerCase().trim();

    const clean = rawPhone.replace(/\D/g, '');
    let phone10 = clean;
    if (clean.length === 12 && clean.startsWith('91')) {
      phone10 = clean.slice(2);
    } else if (clean.length === 11 && clean.startsWith('0')) {
      phone10 = clean.slice(1);
    }

    if (!phone10 || phone10.length !== 10) {
      return res.json({ isDuplicate: false, matchedDistributor: null, matchedDeliveryBoy: null });
    }

    const db = await dbManager.getConnection();

    // 1. Check existing distributors
    let distSql = 'SELECT id, name, phone, contact FROM distributors WHERE (phone LIKE ? OR contact LIKE ? OR phone LIKE ? OR contact LIKE ?)';
    const distParams: any[] = [`%${phone10}%`, `%${phone10}%`, `%${phone10}`, `%${phone10}`];
    if (excludeId && !isNaN(excludeId)) {
      distSql += ' AND id != ?';
      distParams.push(excludeId);
    }
    if (excludeName) {
      distSql += ' AND LOWER(TRIM(name)) != ?';
      distParams.push(excludeName);
    }
    distSql += ' LIMIT 1';
    const distMatch = await db.get(distSql, distParams);

    // 2. Check pharmarack_distributor_mappings
    let mapMatch: any = null;
    if (!distMatch) {
      let mapSql = 'SELECT store_name, phone, distributor_id FROM pharmarack_distributor_mappings WHERE (phone LIKE ? OR phone LIKE ?)';
      const mapParams: any[] = [`%${phone10}%`, `%${phone10}`];
      if (excludeName) {
        mapSql += ' AND LOWER(TRIM(store_name)) != ?';
        mapParams.push(excludeName);
      }
      mapSql += ' LIMIT 1';
      mapMatch = await db.get(mapSql, mapParams);
    }

    // 3. Check delivery_boys table
    const boyMatch = await db.get(
      'SELECT id, name, whatsapp_number FROM delivery_boys WHERE is_active = 1 AND (whatsapp_number LIKE ? OR whatsapp_number LIKE ?) LIMIT 1',
      [`%${phone10}%`, `%${phone10}`]
    );

    const isDuplicate = Boolean(distMatch || mapMatch || boyMatch);
    res.json({
      isDuplicate,
      phone: phone10,
      matchedDistributor: distMatch
        ? { id: distMatch.id, name: distMatch.name, phone: distMatch.phone || distMatch.contact }
        : (mapMatch ? { id: mapMatch.distributor_id, name: mapMatch.store_name, phone: mapMatch.phone } : null),
      matchedDeliveryBoy: boyMatch ? { id: boyMatch.id, name: boyMatch.name, phone: boyMatch.whatsapp_number } : null
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to check phone number: ' + err.message });
  }
});

// Create or update distributor details
const postDistributorsHandler = async (req: express.Request, res: express.Response) => {
  const { name, store_name, phone, contact, email, address, gstin, state_code, preferred_file_format, min_order_value, min_order_items } = req.body;
  const distName = (name || store_name || '').trim();
  if (!distName) {
    return res.status(400).json({ error: 'Distributor name is required' });
  }

  const phoneVal = validate10DigitPhone(phone || contact, { allowEmpty: true, requireMobile: false });
  if (!phoneVal.isValid) {
    return res.status(400).json({ error: phoneVal.error });
  }

  try {
    const db = await dbManager.getConnection();
    const savedDistributor = await syncDistributorPhoneAcrossTables(db, {
      name: distName,
      phone: phoneVal.cleanPhone || phone,
      contact: phoneVal.cleanPhone || contact,
      email,
      address,
      gstin,
      state_code,
      preferred_file_format,
      min_order_value,
      min_order_items
    });

    res.json({
      success: true,
      message: 'Distributor saved successfully',
      id: savedDistributor.id,
      data: savedDistributor
    });
    eventService.broadcast('distributors_updated', { action: 'create', id: savedDistributor.id });
  } catch (error: any) {
    console.error('Failed to create/update distributor:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
};

router.post('/distributors', postDistributorsHandler);
router.post('/', postDistributorsHandler);

// Update distributor details including preferred email invoice format
const putDistributorHandler = async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { name, store_name, phone, contact, email, preferred_file_format, gstin, address, state_code, min_order_value, min_order_items } = req.body;
  const phoneVal = validate10DigitPhone(phone || contact, { allowEmpty: true, requireMobile: false });
  if (!phoneVal.isValid) {
    return res.status(400).json({ error: phoneVal.error });
  }

  try {
    const db = await dbManager.getConnection();
    const savedDistributor = await syncDistributorPhoneAcrossTables(db, {
      id: Number(id),
      name: name || store_name,
      phone: phoneVal.cleanPhone || phone,
      contact: phoneVal.cleanPhone || contact,
      email,
      address,
      gstin,
      state_code,
      preferred_file_format,
      min_order_value,
      min_order_items
    });

    syncTodayActiveDistributors().catch(() => {});

    res.json({
      success: true,
      message: 'Distributor details updated successfully',
      id: Number(id),
      data: savedDistributor
    });
    eventService.broadcast('distributors_updated', { action: 'update', id: Number(id) });
  } catch (error: any) {
    console.error('Failed to update distributor:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
};

router.put('/distributors/:id', putDistributorHandler);
router.put('/:id', putDistributorHandler);

// Delete a distributor
const deleteDistributorHandler = async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();

    // Remove learned OCR files from disk before dropping their DB rows so nothing orphaned is left behind
    try {
      const files = await db.all('SELECT file_path FROM distributor_historical_files WHERE distributor_id = ?', [id]);
      for (const f of files) {
        if (f.file_path && fs.existsSync(f.file_path)) {
          try { fs.unlinkSync(f.file_path); } catch (e) { console.warn('Failed to delete distributor file:', f.file_path, e); }
        }
      }
      await db.run('DELETE FROM distributor_historical_files WHERE distributor_id = ?', [id]);
    } catch (_) {}

    // Deleted distributors must stop appearing on the Dispatch page immediately
    try {
      await db.run('DELETE FROM distributor_dispatch_reminders WHERE distributor_id = ?', [id]);
    } catch (_) {}

    try {
      await db.run('DELETE FROM distributor_learning_profiles WHERE distributor_id = ?', [id]);
    } catch (_) {}

    await db.run('DELETE FROM distributors WHERE id = ?', [id]);

    eventService.broadcast('distributors_updated', { action: 'delete', id: Number(id) });
    res.json({ success: true, message: 'Distributor deleted successfully' });
  } catch (error) {
    console.error('Failed to delete distributor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

router.delete('/distributors/:id', deleteDistributorHandler);
router.delete('/:id', deleteDistributorHandler);

router.post('/purchases', async (req, res) => {
  const { distributor, invoice_no, total_amount } = req.body;
  try {
    const cleanDist = (distributor || '').trim();
    if (!cleanDist || !isValidDistributorName(cleanDist)) {
      return res.status(400).json({ error: 'Distributor is required. Please select or enter a legitimate distributor.' });
    }

    const db = await dbManager.getConnection();
    // Upsert distributor
    await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', cleanDist);
    const distRow = await db.get('SELECT id FROM distributors WHERE name = ?', cleanDist);
    if (!distRow) {
      return res.status(400).json({ error: 'Failed to resolve distributor.' });
    }

    // Insert purchase
    await db.run('INSERT INTO purchases (distributor_id, invoice_no, total_amount) VALUES (?, ?, ?)',
      [distRow.id, invoice_no, total_amount]);

    res.json({ success: true, message: 'Purchase saved' });
  } catch (error) {
    console.error('Failed to save purchase:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/returns/reconcile-credit', async (req, res) => {
  const { distributor_id, actual_credit_amount, purchase_id } = req.body;
  if (!distributor_id || actual_credit_amount === undefined) {
    return res.status(400).json({ error: 'distributor_id and actual_credit_amount are required' });
  }
  try {
    const db = await dbManager.getConnection();
    const result = await reconcileCreditNote(db, distributor_id, actual_credit_amount, purchase_id);
    res.json(result);
  } catch (error) {
    console.error('Failed to reconcile credit note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get(['/distributors/:id/pending-returns', '/:id/pending-returns'], async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const pendingReturns = await db.all(
      `SELECT ert.*, r.return_no 
       FROM expiry_returns_tracking ert
       LEFT JOIN returns r ON ert.return_id = r.id
       WHERE ert.distributor_id = ? AND ert.status IN ('pending', 'overdue')
       ORDER BY ert.return_date ASC LIMIT 1000`,
      [id]
    );
    res.json(pendingReturns);
  } catch (error) {
    console.error('Failed to fetch pending returns:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/distributors/recommendations — Intelligent Multi-Distributor Scoring Engine (MULTI-PHARMACY.md §14, §15)
router.get(['/recommendations', '/distributors/recommendations'], async (req, res) => {
  try {
    const medicineId = req.query.medicine_id ? parseInt(req.query.medicine_id as string, 10) : undefined;
    const medicineName = (req.query.medicine_name as string) || '';
    const requestedQty = req.query.qty ? parseInt(req.query.qty as string, 10) : 1;
    const targetStoreId = (req as any).tenant?.storeId || (req.query.store_id ? parseInt(req.query.store_id as string, 10) : resolveStoreId(req));

    const result = await distributorRecommendationService.recommendDistributor({
      medicineId,
      medicineName,
      requestedQty,
      storeId: targetStoreId
    });

    res.json(result);
  } catch (err: any) {
    console.error('Failed to get distributor recommendations:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

export default router;
