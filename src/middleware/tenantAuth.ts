import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { dbManager } from '../database/connection.js';
import { resolveStoreId } from '../services/storeContextService.js';

export interface TenantContext {
  storeId: number;
  storeName?: string;
  userId: number;
  username: string;
  role: string;
  permissions: string[];
  isDesktopFallback?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

const AUTH_SECRET = process.env.STAFF_AUTH_SECRET || 'ai_pharmacy_staff_auth_secret_2026';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Creates a signed staff authentication token
 */
export function createStaffToken(data: {
  userId: number;
  username: string;
  storeId: number;
  role: string;
  permissions?: string[];
}): string {
  const timestamp = Date.now();
  const perms = (data.permissions || ['*']).join(',');
  const payload = `${data.userId}:${data.storeId}:${data.role}:${data.username}:${perms}:${timestamp}`;
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

/**
 * Verifies a signed staff token
 */
export function verifyStaffToken(tokenStr: string): TenantContext | null {
  try {
    if (!tokenStr) return null;
    const decoded = Buffer.from(tokenStr, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 7) return null;

    const [userIdStr, storeIdStr, role, username, permsStr, timestampStr, signature] = parts;
    const userId = parseInt(userIdStr, 10);
    const storeId = parseInt(storeIdStr, 10);
    const timestamp = parseInt(timestampStr, 10);

    if (isNaN(userId) || isNaN(storeId) || isNaN(timestamp)) return null;
    if (Date.now() - timestamp > TOKEN_TTL_MS) return null; // Expired

    const payload = `${userIdStr}:${storeIdStr}:${role}:${username}:${permsStr}:${timestampStr}`;
    const expectedSignature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');

    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return {
        userId,
        storeId,
        username,
        role,
        permissions: permsStr ? permsStr.split(',') : ['*']
      };
    }
  } catch (_) {}
  return null;
}

/**
 * Resolves tenant and authenticated user context on incoming requests.
 * Fallback mode: For offline/desktop standalone deployments without explicit logins,
 * defaults to Store #1 and Admin role to ensure ZERO disruption to single-store operations (MULTI-PHARMACY.md Section 34).
 */
export async function tenantAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
    let token = '';

    if (authHeader) {
      token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    }

    if (token) {
      const verified = verifyStaffToken(token);
      if (verified) {
        // Check if caller requests a different active store via header
        const requestedStoreId = resolveStoreId(req);
        if (requestedStoreId && requestedStoreId !== verified.storeId) {
          // Verify user has access to requested store
          const db = await dbManager.getConnection();
          const access = await db.get(
            `SELECT role, permissions_json FROM pharmacy_user_tenants 
             WHERE user_id = ? AND store_id = ? AND is_active = 1`,
            [verified.userId, requestedStoreId]
          );

          if (access || verified.role === 'owner') {
            let perms = verified.permissions;
            if (access?.permissions_json) {
              try { perms = JSON.parse(access.permissions_json); } catch (_) {}
            }
            verified.storeId = requestedStoreId;
            verified.role = access?.role || verified.role;
            verified.permissions = perms;
          }
        }

        req.tenant = verified;
        return next();
      }
    }

    // Desktop / Standalone Single-Store Fallback
    const targetStoreId = resolveStoreId(req) || 1;
    req.tenant = {
      storeId: targetStoreId,
      userId: 1,
      username: 'admin',
      role: 'owner',
      permissions: ['*'],
      isDesktopFallback: true
    };

    next();
  } catch (err: any) {
    console.error('[TenantAuthMiddleware] Error:', err);
    res.status(500).json({ error: 'Internal tenant authorization error' });
  }
}

/**
 * Enforce specific permission check
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const tenant = req.tenant;
    if (!tenant) {
      return res.status(401).json({ error: 'Unauthorized: No active tenant context' });
    }

    if (tenant.permissions.includes('*') || tenant.permissions.includes(permission) || tenant.role === 'owner') {
      return next();
    }

    return res.status(403).json({
      error: `Forbidden: Missing required permission "${permission}" for store #${tenant.storeId}`
    });
  };
}
