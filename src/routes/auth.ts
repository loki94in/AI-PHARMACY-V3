import express from 'express';
import crypto from 'crypto';
import { dbManager } from '../database/connection.js';
import { createStaffToken, tenantAuthMiddleware, requirePermission } from '../middleware/tenantAuth.js';
import { storeContextService } from '../services/storeContextService.js';

const router = express.Router();

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('hex');
}

function verifyPassword(password: string, expectedHash: string, salt: string): boolean {
  const computed = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(expectedHash, 'utf8'));
  } catch (_) {
    return false;
  }
}

// POST /api/auth/login — Authenticate staff member
router.post('/login', async (req, res) => {
  try {
    const { username, password, store_id } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = await dbManager.getConnection();
    const user = await db.get(
      'SELECT * FROM pharmacy_users WHERE LOWER(username) = LOWER(?) AND is_active = 1',
      [username.trim()]
    );

    if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Fetch accessible stores for this user
    let accessibleStores: any[] = [];
    if (user.role === 'owner') {
      accessibleStores = await storeContextService.listStores(db);
    } else {
      accessibleStores = await db.all(
        `SELECT s.*, put.role as store_role, put.permissions_json 
         FROM stores s
         JOIN pharmacy_user_tenants put ON s.id = put.store_id
         WHERE put.user_id = ? AND put.is_active = 1 AND s.is_active = 1`,
        [user.id]
      );
    }

    if (accessibleStores.length === 0) {
      // Fallback to default store if user has no explicit mappings
      accessibleStores = [{ id: 1, name: 'AI Pharmacy', is_central: 1, is_active: 1 }];
    }

    // Determine active store
    let targetStore = accessibleStores[0];
    if (store_id) {
      const requested = accessibleStores.find(s => s.id === parseInt(String(store_id), 10));
      if (requested) targetStore = requested;
    }

    let permissions = ['*'];
    if (user.role !== 'owner') {
      const tenantRow = await db.get(
        'SELECT permissions_json, role FROM pharmacy_user_tenants WHERE user_id = ? AND store_id = ?',
        [user.id, targetStore.id]
      );
      if (tenantRow?.permissions_json) {
        try { permissions = JSON.parse(tenantRow.permissions_json); } catch (_) {}
      }
    }

    const token = createStaffToken({
      userId: user.id,
      username: user.username,
      storeId: targetStore.id,
      role: user.role,
      permissions
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        email: user.email,
        phone: user.phone
      },
      activeStore: targetStore,
      accessibleStores
    });
  } catch (err: any) {
    console.error('[AuthRoute] Login error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /api/auth/me — Return current session & tenant context
router.get('/me', tenantAuthMiddleware, async (req, res) => {
  try {
    const tenant = req.tenant!;
    const db = await dbManager.getConnection();
    const activeStore = await storeContextService.getStoreById(tenant.storeId, db);

    let accessibleStores: any[] = [];
    if (tenant.role === 'owner') {
      accessibleStores = await storeContextService.listStores(db);
    } else {
      accessibleStores = await db.all(
        `SELECT s.*, put.role as store_role 
         FROM stores s
         JOIN pharmacy_user_tenants put ON s.id = put.store_id
         WHERE put.user_id = ? AND put.is_active = 1 AND s.is_active = 1`,
        [tenant.userId]
      );
    }

    res.json({
      user: {
        id: tenant.userId,
        username: tenant.username,
        role: tenant.role,
        permissions: tenant.permissions
      },
      activeStore: activeStore || { id: tenant.storeId, name: 'AI Pharmacy' },
      accessibleStores: accessibleStores.length > 0 ? accessibleStores : [activeStore]
    });
  } catch (err: any) {
    console.error('[AuthRoute] Me error:', err);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// POST /api/auth/switch-store — Switch active store tenant
router.post('/switch-store', tenantAuthMiddleware, async (req, res) => {
  try {
    const tenant = req.tenant!;
    const targetStoreId = parseInt(String(req.body.store_id), 10);
    if (isNaN(targetStoreId)) {
      return res.status(400).json({ error: 'Valid store_id required' });
    }

    const db = await dbManager.getConnection();
    const store = await storeContextService.getStoreById(targetStoreId, db);
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    // Verify access
    if (tenant.role !== 'owner') {
      const access = await db.get(
        'SELECT role, permissions_json FROM pharmacy_user_tenants WHERE user_id = ? AND store_id = ? AND is_active = 1',
        [tenant.userId, targetStoreId]
      );
      if (!access) {
        return res.status(403).json({ error: 'Access denied to target store' });
      }
    }

    const newToken = createStaffToken({
      userId: tenant.userId,
      username: tenant.username,
      storeId: targetStoreId,
      role: tenant.role,
      permissions: tenant.permissions
    });

    res.json({
      success: true,
      token: newToken,
      activeStore: store
    });
  } catch (err: any) {
    console.error('[AuthRoute] Switch store error:', err);
    res.status(500).json({ error: 'Failed to switch store' });
  }
});

export default router;
