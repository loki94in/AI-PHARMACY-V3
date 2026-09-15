import { kv, isKvConfigured } from '../_db.js';
import crypto from 'crypto';

// Admin: manually modify / update an existing license
export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isKvConfigured) {
    return res.status(500).json({ error: 'Upstash Redis is not connected yet in Vercel.' });
  }

  const {
    licenseId,
    pharmacyName,
    notes,
    expiresAt,
    status,
    isPilot,
    newLicenseKey,
  } = req.body || {};

  if (!licenseId?.trim()) {
    return res.status(400).json({ error: 'licenseId is required' });
  }

  const cleanId = licenseId.trim().toUpperCase();

  try {
    const record = await kv.get(`license:${cleanId}`);
    if (!record) {
      return res.status(404).json({ error: `License ${cleanId} not found` });
    }

    const updated = { ...record };

    if (pharmacyName !== undefined && pharmacyName.trim()) {
      updated.pharmacyName = pharmacyName.trim();
    }

    if (notes !== undefined) {
      updated.notes = notes.trim();
    }

    if (expiresAt) {
      // Validate date or convert YYYY-MM-DD
      const dateObj = new Date(expiresAt.includes('T') ? expiresAt : `${expiresAt}T23:59:59.999Z`);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ error: 'Invalid expiresAt date format' });
      }
      updated.expiresAt = dateObj.toISOString();
    }

    if (status !== undefined) {
      if (!['active', 'suspended', 'revoked'].includes(status)) {
        return res.status(400).json({ error: 'status must be active, suspended, or revoked' });
      }
      updated.status = status;
    }

    if (isPilot !== undefined) {
      updated.isPilot = Boolean(isPilot);
    }

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
  } catch (err) {
    return res.status(500).json({
      error: `Storage error: ${err.message}. Check KV database in Vercel.`,
    });
  }
}
