/**
 * LicenseService — machine fingerprint, local license caching, online validation.
 *
 * TESTING_MODE (default: true):
 *   - Skips all online validation
 *   - App runs freely for 1 year from first boot
 *   - Set testing_mode = 0 in app_license table to enforce real licensing
 */

import crypto from 'crypto';
import { execSync } from 'child_process';
import { networkInterfaces } from 'os';
import axios from 'axios';
import { dbManager } from '../database/connection.js';

// Vercel license server URL — update after deploying
const LICENSE_SERVER = process.env.LICENSE_SERVER_URL || 'https://ai-pharmacy-license.vercel.app';
const APP_VERSION = process.env.APP_VERSION || '1.0.0';

// 1-year free testing window (ms)
const TESTING_FREE_PERIOD_MS = 365 * 24 * 60 * 60 * 1000;

export interface LicenseStatus {
  valid: boolean;
  mode: 'testing' | 'licensed' | 'grace' | 'expired';
  pharmacyName: string | null;
  licenseId: string | null;
  daysUntilExpiry: number | null; // null = unlimited (testing)
  message: string;
}

// --- Machine fingerprint (pure Node stdlib, no native deps) ---
export function getMachineId(): string {
  const nets = networkInterfaces();
  let mac = '';
  for (const name of Object.keys(nets)) {
    for (const net of (nets[name] || [])) {
      if (!net.internal && net.mac !== '00:00:00:00:00:00') {
        mac = net.mac;
        break;
      }
    }
    if (mac) break;
  }

  let winGuid = '';
  try {
    const out = execSync(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', timeout: 3000 }
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+(.+)/);
    if (m) winGuid = m[1].trim();
  } catch {
    // Non-Windows or registry unavailable — MAC alone is fine
  }

  return crypto
    .createHash('sha256')
    .update(`${mac}|${winGuid}`)
    .digest('hex')
    .substring(0, 32);
}

// --- Core license check (called on every app boot) ---
export async function checkLicense(): Promise<LicenseStatus> {
  const db = await dbManager.getConnection();
  const row = await db.get<any>('SELECT * FROM app_license WHERE id = 1');

  // TESTING MODE: always valid, free for 1 year from first boot
  if (!row || row.testing_mode === 1) {
    const firstBoot = row?.activated_at ? new Date(row.activated_at).getTime() : Date.now();
    if (!row?.activated_at) {
      // Record first boot time
      await db.run(
        'UPDATE app_license SET activated_at = ?, status = ? WHERE id = 1',
        [new Date().toISOString(), 'testing']
      );
    }
    const elapsed = Date.now() - firstBoot;
    const remaining = Math.max(0, TESTING_FREE_PERIOD_MS - elapsed);
    const daysLeft = Math.floor(remaining / (24 * 60 * 60 * 1000));
    return {
      valid: daysLeft > 0,
      mode: 'testing',
      pharmacyName: null,
      licenseId: null,
      daysUntilExpiry: daysLeft,
      message: daysLeft > 30
        ? `Testing mode — ${daysLeft} days remaining`
        : daysLeft > 0
          ? `⚠️ Testing period expires in ${daysLeft} days. Please activate your license.`
          : 'Testing period expired. Please activate your license.',
    };
  }

  // LICENSED MODE: validate online (with offline grace fallback)
  const machineId = getMachineId();

  // Try online validation first
  try {
    const resp = await axios.get(`${LICENSE_SERVER}/api/license/validate`, {
      params: { licenseId: row.license_id, machineId },
      timeout: 5000,
    });

    if (resp.data.valid) {
      await db.run(
        'UPDATE app_license SET last_validated_at = ?, status = ? WHERE id = 1',
        [new Date().toISOString(), 'licensed']
      );
      return {
        valid: true,
        mode: 'licensed',
        pharmacyName: resp.data.pharmacyName,
        licenseId: row.license_id,
        daysUntilExpiry: null,
        message: `Licensed to ${resp.data.pharmacyName}`,
      };
    }
  } catch {
    // Offline — apply grace period logic
  }

  // Offline grace period check
  const lastValidated = row.last_validated_at ? new Date(row.last_validated_at).getTime() : 0;
  const graceDays = row.offline_grace_days ?? 7;
  const graceMs = graceDays * 24 * 60 * 60 * 1000;
  const elapsed = Date.now() - lastValidated;
  const remaining = Math.max(0, graceMs - elapsed);
  const daysLeft = Math.floor(remaining / (24 * 60 * 60 * 1000));

  if (remaining > 0) {
    return {
      valid: true,
      mode: 'grace',
      pharmacyName: row.pharmacy_name,
      licenseId: row.license_id,
      daysUntilExpiry: daysLeft,
      message: `Offline mode — license unverified. ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining before lockout.`,
    };
  }

  // Grace expired
  return {
    valid: false,
    mode: 'expired',
    pharmacyName: row.pharmacy_name,
    licenseId: row.license_id,
    daysUntilExpiry: 0,
    message: 'License validation failed. Please connect to the internet to verify your license.',
  };
}

// --- Activate license on this PC (called from stub installer / settings) ---
export async function activateLicense(licenseId: string, licenseKey: string): Promise<{
  success: boolean;
  pharmacyName?: string;
  error?: string;
}> {
  const machineId = getMachineId();
  const machineName = (() => {
    try { return execSync('hostname', { encoding: 'utf8', timeout: 2000 }).trim(); } catch { return 'Unknown PC'; }
  })();

  try {
    const resp = await axios.post(`${LICENSE_SERVER}/api/license/activate`, {
      licenseId,
      licenseKey,
      machineId,
      machineName,
    }, { timeout: 10000 });

    if (resp.data.success) {
      const db = await dbManager.getConnection();
      await db.run(`
        UPDATE app_license
        SET license_id = ?, machine_id = ?, pharmacy_name = ?,
            activated_at = ?, last_validated_at = ?, status = ?, testing_mode = 0
        WHERE id = 1
      `, [
        licenseId,
        machineId,
        resp.data.pharmacyName,
        resp.data.activatedAt || new Date().toISOString(),
        new Date().toISOString(),
        'licensed',
      ]);

      return { success: true, pharmacyName: resp.data.pharmacyName };
    }

    return { success: false, error: 'Activation failed' };
  } catch (err: any) {
    const msg = err.response?.data?.error || err.message || 'Network error';
    return { success: false, error: msg };
  }
}

// --- Check for app updates ---
export async function checkForUpdate(): Promise<{
  hasUpdate: boolean;
  latestVersion?: string;
  downloadUrl?: string;
  changelog?: string;
} | null> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get<any>('SELECT current_version FROM update_checks WHERE id = 1');
    const currentVersion = row?.current_version || APP_VERSION;

    const resp = await axios.get(`${LICENSE_SERVER}/api/updates/check`, {
      params: { version: currentVersion },
      timeout: 8000,
    });

    const now = new Date().toISOString();
    await db.run(
      'UPDATE update_checks SET last_checked_at = ?, last_known_version = ? WHERE id = 1',
      [now, resp.data.latestVersion]
    );

    return {
      hasUpdate: resp.data.hasUpdate,
      latestVersion: resp.data.latestVersion,
      downloadUrl: resp.data.downloadUrl,
      changelog: resp.data.changelog,
    };
  } catch {
    return null; // Offline or server error — silently ignore
  }
}
