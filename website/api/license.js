import { kv, isKvConfigured } from './_db.js';
import crypto from 'crypto';

function randomChars(len) {
  const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += pool[bytes[i] % pool.length];
  return s;
}

function generateLicenseId() {
  return `PHARM-${randomChars(4)}`;
}

function generateLicenseKey() {
  return `${randomChars(4)}-${randomChars(4)}-${randomChars(4)}-${randomChars(4)}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.url ? req.url.split('?')[0].split('/').filter(Boolean).pop() : '');

  // 1. VALIDATE LICENSE (PC boot / periodic check)
  if (action === 'validate') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) return res.status(500).json({ valid: false, error: 'Upstash Redis not configured on server' });

    const { licenseId, machineId } = req.query;
    if (!licenseId || !machineId) return res.status(400).json({ valid: false, error: 'licenseId and machineId are required' });

    const record = await kv.get(`license:${licenseId}`);
    if (!record) return res.status(404).json({ valid: false, error: 'License not found' });
    if (record.status !== 'active') return res.status(403).json({ valid: false, error: `License is ${record.status}` });
    if (record.machineId !== machineId) return res.status(403).json({ valid: false, error: 'Machine mismatch', code: 'MACHINE_MISMATCH' });

    const nowMs = Date.now();
    let daysUntilExpiry = null;
    if (record.expiresAt) {
      const expiresMs = new Date(record.expiresAt).getTime();
      if (nowMs > expiresMs) {
        return res.status(403).json({
          valid: false,
          error: 'License has expired. Please renew your license.',
          code: 'EXPIRED',
          expiresAt: record.expiresAt,
          daysUntilExpiry: 0,
        });
      }
      daysUntilExpiry = Math.max(0, Math.floor((expiresMs - nowMs) / (24 * 60 * 60 * 1000)));
    }

    kv.set(`license:${licenseId}`, {
      ...record,
      lastValidatedAt: new Date().toISOString(),
    }).catch(() => {});

    return res.status(200).json({
      valid: true,
      pharmacyName: record.pharmacyName,
      licenseId,
      activatedAt: record.activatedAt,
      expiresAt: record.expiresAt || null,
      daysUntilExpiry,
      isPilot: Boolean(record.isPilot),
    });
  }

  // 2. ACTIVATE LICENSE (First-time binding to PC)
  if (action === 'activate') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) return res.status(500).json({ error: 'Upstash Redis not configured on server' });

    const { licenseId, licenseKey, machineId, machineName } = req.body || {};
    if (!licenseId || !licenseKey || !machineId) {
      return res.status(400).json({ error: 'licenseId, licenseKey, and machineId are required' });
    }

    const record = await kv.get(`license:${licenseId}`);
    if (!record) return res.status(404).json({ error: 'License not found. Check your License ID.' });
    if (record.status !== 'active') return res.status(403).json({ error: `License is ${record.status}. Contact support.` });

    const keyHash = crypto.createHash('sha256').update(licenseKey).digest('hex');
    if (keyHash !== record.keyHash) {
      return res.status(401).json({ error: 'Invalid License Key. Check and try again.' });
    }

    if (record.machineId && record.machineId !== machineId) {
      return res.status(403).json({
        error: 'This license is already activated on another PC. Contact support to transfer.',
        code: 'MACHINE_MISMATCH',
      });
    }

    const now = new Date().toISOString();
    const updated = {
      ...record,
      machineId,
      machineName: machineName || 'Unknown PC',
      activatedAt: record.activatedAt || now,
      lastValidatedAt: now,
    };

    await kv.set(`license:${licenseId}`, updated);
    return res.status(200).json({
      success: true,
      pharmacyName: record.pharmacyName,
      licenseId,
      activatedAt: updated.activatedAt,
    });
  }

  // --- ADMIN ACTIONS REQUIRE x-admin-secret ---
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 3. LIST LICENSES (Admin)
  if (action === 'list') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) {
      return res.status(200).json({
        licenses: [],
        total: 0,
        warning: 'Upstash Redis is not connected yet. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.',
      });
    }

    try {
      const keys = await kv.keys('license:*');
      if (!keys.length) return res.status(200).json({ licenses: [], total: 0 });

      const records = await kv.mget(...keys);
      const nowMs = Date.now();
      const licenses = records
        .filter(Boolean)
        .map(r => {
          let daysUntilExpiry = null;
          if (r.expiresAt) {
            const diffMs = new Date(r.expiresAt).getTime() - nowMs;
            daysUntilExpiry = Math.floor(diffMs / (24 * 60 * 60 * 1000));
          }
          return {
            licenseId: r.licenseId,
            pharmacyName: r.pharmacyName,
            notes: r.notes,
            status: r.status,
            machineId: r.machineId ? `${r.machineId.substring(0, 8)}...` : null,
            rawMachineId: r.machineId || null,
            machineName: r.machineName,
            activatedAt: r.activatedAt,
            expiresAt: r.expiresAt || null,
            daysUntilExpiry,
            isPilot: Boolean(r.isPilot),
            createdAt: r.createdAt,
            lastValidatedAt: r.lastValidatedAt,
          };
        })
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      return res.status(200).json({ licenses, total: licenses.length });
    } catch (err) {
      return res.status(200).json({
        licenses: [],
        total: 0,
        warning: 'KV storage not yet connected in Vercel project settings.',
        error: err.message,
      });
    }
  }

  // 4. CREATE LICENSE (Admin)
  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) {
      return res.status(500).json({ error: 'Upstash Redis is not connected yet.' });
    }

    const {
      pharmacyName,
      notes,
      validityDays = 365,
      isPilot = false,
      customLicenseId,
      customLicenseKey,
    } = req.body || {};
    if (!pharmacyName?.trim()) return res.status(400).json({ error: 'pharmacyName is required' });

    const licenseId = customLicenseId?.trim() ? customLicenseId.trim().toUpperCase() : generateLicenseId();
    const licenseKey = customLicenseKey?.trim() ? customLicenseKey.trim().toUpperCase() : generateLicenseKey();

    try {
      const existing = await kv.get(`license:${licenseId}`);
      if (existing) {
        return res.status(400).json({
          error: `License ID "${licenseId}" already exists. Please choose a different ID or leave blank to auto-generate.`
        });
      }
    } catch (err) {
      return res.status(500).json({ error: `Storage error: ${err.message}` });
    }

    const keyHash = crypto.createHash('sha256').update(licenseKey).digest('hex');
    const nowMs = Date.now();
    const expiresMs = nowMs + Number(validityDays) * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(expiresMs).toISOString();

    const record = {
      licenseId,
      keyHash,
      pharmacyName: pharmacyName.trim(),
      notes: notes?.trim() || '',
      status: 'active',
      machineId: null,
      machineName: null,
      activatedAt: null,
      expiresAt,
      isPilot: Boolean(isPilot),
      createdAt: new Date(nowMs).toISOString(),
      lastValidatedAt: null,
    };

    await kv.set(`license:${licenseId}`, record);
    return res.status(200).json({
      licenseId,
      licenseKey,
      pharmacyName: record.pharmacyName,
      expiresAt,
      validityDays: Number(validityDays),
      isPilot: record.isPilot,
      message: 'License created successfully. Save the license key now — it cannot be retrieved again.',
    });
  }

  // 5. DELETE LICENSE (Admin)
  if (action === 'delete') {
    if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) return res.status(500).json({ error: 'Upstash Redis is not connected yet.' });

    const { licenseId } = req.body || req.query || {};
    if (!licenseId?.trim()) return res.status(400).json({ error: 'licenseId is required' });
    const cleanId = licenseId.trim().toUpperCase();

    const record = await kv.get(`license:${cleanId}`);
    if (!record) return res.status(404).json({ error: `License ${cleanId} not found` });

    await kv.del(`license:${cleanId}`);
    return res.status(200).json({
      success: true,
      licenseId: cleanId,
      pharmacyName: record.pharmacyName || null,
      message: `License ${cleanId} has been permanently deleted from the database.`,
    });
  }

  // 6. RENEW LICENSE (Admin)
  if (action === 'renew') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) return res.status(500).json({ error: 'Upstash Redis is not connected yet.' });

    const { licenseId, days = 365 } = req.body || {};
    if (!licenseId) return res.status(400).json({ error: 'licenseId is required' });

    const record = await kv.get(`license:${licenseId}`);
    if (!record) return res.status(404).json({ error: 'License not found' });

    const nowMs = Date.now();
    const currentExpiresMs = record.expiresAt ? new Date(record.expiresAt).getTime() : nowMs;
    const baseMs = currentExpiresMs > nowMs ? currentExpiresMs : nowMs;
    const newExpiresMs = baseMs + Number(days) * 24 * 60 * 60 * 1000;
    const newExpiresAt = new Date(newExpiresMs).toISOString();

    const updated = {
      ...record,
      expiresAt: newExpiresAt,
      status: record.status === 'revoked' ? 'revoked' : 'active',
    };

    await kv.set(`license:${licenseId}`, updated);
    const daysUntilExpiry = Math.max(0, Math.floor((newExpiresMs - nowMs) / (24 * 60 * 60 * 1000)));

    return res.status(200).json({
      success: true,
      licenseId,
      pharmacyName: updated.pharmacyName,
      expiresAt: newExpiresAt,
      daysUntilExpiry,
      message: `License renewed for ${days} days (Expires ${newExpiresAt.split('T')[0]})`,
    });
  }

  // 7. RESET / STATUS TOGGLE (Admin)
  if (action === 'reset') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) return res.status(500).json({ error: 'Upstash Redis not configured on server' });

    const { licenseId, action: subAction } = req.body || {};
    if (!licenseId) return res.status(400).json({ error: 'licenseId is required' });

    const record = await kv.get(`license:${licenseId}`);
    if (!record) return res.status(404).json({ error: 'License not found' });

    let updated = { ...record };
    if (subAction === 'reset_machine') {
      updated.machineId = null;
      updated.machineName = null;
      updated.activatedAt = null;
    } else if (subAction === 'suspend') {
      updated.status = 'suspended';
    } else if (subAction === 'reactivate') {
      updated.status = 'active';
    } else if (subAction === 'revoke') {
      updated.status = 'revoked';
    } else {
      return res.status(400).json({ error: 'action must be: reset_machine | suspend | reactivate | revoke' });
    }

    await kv.set(`license:${licenseId}`, updated);
    return res.status(200).json({
      success: true,
      licenseId,
      action: subAction,
      status: updated.status,
      machineId: updated.machineId,
    });
  }

  // 8. TOGGLE PILOT (Admin)
  if (action === 'toggle-pilot') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) return res.status(500).json({ error: 'Upstash Redis not configured on server' });

    const { licenseId, isPilot } = req.body || {};
    if (!licenseId) return res.status(400).json({ error: 'licenseId is required' });

    const record = await kv.get(`license:${licenseId}`);
    if (!record) return res.status(404).json({ error: 'License not found' });

    const newPilotState = typeof isPilot === 'boolean' ? isPilot : !record.isPilot;
    const updated = { ...record, isPilot: newPilotState };

    await kv.set(`license:${licenseId}`, updated);
    return res.status(200).json({
      success: true,
      licenseId,
      pharmacyName: updated.pharmacyName,
      isPilot: updated.isPilot,
      message: updated.isPilot ? 'Pharmacy marked as Pilot tester' : 'Pharmacy set to Standard production',
    });
  }

  // 9. UPDATE LICENSE (Admin)
  if (action === 'update') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isKvConfigured) return res.status(500).json({ error: 'Upstash Redis not configured on server' });

    const {
      licenseId,
      pharmacyName,
      notes,
      expiresAt,
      status,
      isPilot,
      newLicenseKey,
    } = req.body || {};

    if (!licenseId?.trim()) return res.status(400).json({ error: 'licenseId is required' });
    const cleanId = licenseId.trim().toUpperCase();

    const record = await kv.get(`license:${cleanId}`);
    if (!record) return res.status(404).json({ error: `License ${cleanId} not found` });

    const updated = { ...record };
    if (pharmacyName !== undefined && pharmacyName.trim()) updated.pharmacyName = pharmacyName.trim();
    if (notes !== undefined) updated.notes = notes.trim();
    if (expiresAt) {
      const dateObj = new Date(expiresAt.includes('T') ? expiresAt : `${expiresAt}T23:59:59.999Z`);
      if (isNaN(dateObj.getTime())) return res.status(400).json({ error: 'Invalid expiresAt date format' });
      updated.expiresAt = dateObj.toISOString();
    }
    if (status !== undefined) {
      if (!['active', 'suspended', 'revoked'].includes(status)) {
        return res.status(400).json({ error: 'status must be active, suspended, or revoked' });
      }
      updated.status = status;
    }
    if (isPilot !== undefined) updated.isPilot = Boolean(isPilot);
    if (newLicenseKey !== undefined && newLicenseKey.trim()) {
      const cleanKey = newLicenseKey.trim().toUpperCase();
      updated.keyHash = crypto.createHash('sha256').update(cleanKey).digest('hex');
    }
    updated.updatedAt = new Date().toISOString();

    await kv.set(`license:${cleanId}`, updated);
    return res.status(200).json({
      success: true,
      licenseId: cleanId,
      license: updated,
      message: `License ${cleanId} updated successfully.`,
    });
  }

  return res.status(404).json({ error: `Unknown action: ${action}` });
}
