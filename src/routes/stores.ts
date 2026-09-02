import express from 'express';
import { dbManager } from '../database/connection.js';
import { storeContextService } from '../services/storeContextService.js';
import { eventService } from '../services/eventService.js';

const router = express.Router();

const broadcastStoresChanged = () => {
  try {
    eventService.broadcast('stores_updated', { at: Date.now() });
  } catch (_) {}
};

// GET /api/stores — List all stores
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const stores = await storeContextService.listStores(undefined, includeInactive);
    res.json(stores);
  } catch (err: any) {
    console.error('[StoresRoute] Fetch stores error:', err);
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
});

// GET /api/stores/:id — Get store by ID
router.get('/:id', async (req, res) => {
  try {
    const storeId = parseInt(req.params.id, 10);
    if (isNaN(storeId)) {
      return res.status(400).json({ error: 'Invalid store ID' });
    }
    const store = await storeContextService.getStoreById(storeId);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    res.json(store);
  } catch (err: any) {
    console.error('[StoresRoute] Get store error:', err);
    res.status(500).json({ error: 'Failed to get store details' });
  }
});

// POST /api/stores — Create new store
router.post('/', async (req, res) => {
  try {
    const { name, code, address, phone, email, is_central } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Store name is required' });
    }

    const newStore = await storeContextService.createStore({
      name: name.trim(),
      code: code ? String(code).trim() : undefined,
      address: address ? String(address).trim() : undefined,
      phone: phone ? String(phone).trim() : undefined,
      email: email ? String(email).trim() : undefined,
      is_central: Boolean(is_central)
    });

    broadcastStoresChanged();
    res.status(201).json(newStore);
  } catch (err: any) {
    console.error('[StoresRoute] Create store error:', err);
    res.status(500).json({ error: err.message || 'Failed to create store' });
  }
});

// PUT /api/stores/:id — Update existing store
router.put('/:id', async (req, res) => {
  try {
    const storeId = parseInt(req.params.id, 10);
    if (isNaN(storeId)) {
      return res.status(400).json({ error: 'Invalid store ID' });
    }

    const updated = await storeContextService.updateStore(storeId, req.body);
    broadcastStoresChanged();
    res.json(updated);
  } catch (err: any) {
    console.error('[StoresRoute] Update store error:', err);
    res.status(500).json({ error: err.message || 'Failed to update store' });
  }
});

// GET /api/stores/:id/settings — Get settings for specific store
router.get('/:id/settings', async (req, res) => {
  try {
    const storeId = parseInt(req.params.id, 10);
    if (isNaN(storeId)) {
      return res.status(400).json({ error: 'Invalid store ID' });
    }
    const settings = await storeContextService.getAllStoreSettings(storeId);
    res.json(settings);
  } catch (err: any) {
    console.error('[StoresRoute] Get store settings error:', err);
    res.status(500).json({ error: 'Failed to fetch store settings' });
  }
});

// PUT /api/stores/:id/settings — Update settings for specific store
router.put('/:id/settings', async (req, res) => {
  try {
    const storeId = parseInt(req.params.id, 10);
    if (isNaN(storeId)) {
      return res.status(400).json({ error: 'Invalid store ID' });
    }

    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object is required' });
    }

    for (const [key, val] of Object.entries(settings)) {
      if (typeof key === 'string' && val !== undefined) {
        await storeContextService.setStoreSetting(storeId, key, String(val));
      }
    }

    const updatedSettings = await storeContextService.getAllStoreSettings(storeId);
    res.json({ success: true, settings: updatedSettings });
  } catch (err: any) {
    console.error('[StoresRoute] Update store settings error:', err);
    res.status(500).json({ error: 'Failed to update store settings' });
  }
});

export default router;
