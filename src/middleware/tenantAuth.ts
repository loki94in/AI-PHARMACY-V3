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
 * Inspects incoming request to determine if it originates strictly from the local desktop loopback
 */
export function isLocalRequest(req: Request): boolean {
  // If behind Cloudflare Tunnel (cloudflared), cf proxy headers are present
  if (req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['cf-visitor']) {
    return false;
  }

  // Check forwarded host or host
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host || '';
  const hostname = host.split(':')[0].toLowerCase();

  // If host indicates a tunnel domain or external domain, it is remote
  if (hostname.endsWith('.trycloudflare.com') || hostname.endsWith('.cloudflare.com')) {
    return false;
  }

  // Check remote socket address
  const remoteIp = (req.socket?.remoteAddress || req.ip || '').toLowerCase();
  const isLoopbackIp = (
    remoteIp === '127.0.0.1' ||
    remoteIp === '::1' ||
    remoteIp === '::ffff:127.0.0.1'
  );

  const isLoopbackHost = (hostname === 'localhost' || hostname === '127.0.0.1');

  // Both host and socket must be loopback and no proxy headers to be desktop local
  return isLoopbackHost && isLoopbackIp;
}

let cachedRemoteAuthMode: string | null = null;
let lastRemoteAuthModeCheck = 0;

async function getRemoteAuthMode(): Promise<string> {
  const now = Date.now();
  if (cachedRemoteAuthMode !== null && now - lastRemoteAuthModeCheck < 10000) {
    return cachedRemoteAuthMode;
  }
  try {
    const db = await dbManager.getConnection();
    const row = await db.get(`SELECT value FROM app_settings WHERE key = 'remote_auth_mode'`);
    cachedRemoteAuthMode = (row?.value || 'owner_required').trim();
    lastRemoteAuthModeCheck = now;
  } catch (_) {
    cachedRemoteAuthMode = 'owner_required';
  }
  return cachedRemoteAuthMode || 'owner_required';
}

/**
 * Global remote access gate:
 * - Local desktop requests proceed unimpeded (zero disruption to single-store desktop workflow)
 * - Remote requests (Cloudflare Tunnel, LAN) require a valid owner token on all /api routes
 *   except explicit whitelisted authentication & self-authenticating customer portal endpoints.
 */
export async function ownerRemoteGate(req: Request, res: Response, next: NextFunction) {
  // Pre-flight requests always pass through
  if (req.method === 'OPTIONS') {
    return next();
  }

  // Whitelisted endpoints accessible without owner token
  const path = req.path || req.url || '';
  if (
    path === '/login' ||
    path === '/auth/login' ||
    path === '/api/auth/login' ||
    path === '/session' ||
    path === '/auth/session' ||
    path === '/api/auth/session' ||
    path === '/me' ||
    path === '/auth/me' ||
    path === '/api/auth/me' ||
    path === '/health' ||
    path === '/api/health' ||
    path.startsWith('/customer-portal') ||
    path.startsWith('/api/customer-portal')
  ) {
    return next();
  }

  // Local desktop loopback bypasses the remote gate
  if (isLocalRequest(req)) {
    return next();
  }

  // Emergency kill-switch in app_settings (remote_auth_mode = 'local_only_fallback')
  const mode = await getRemoteAuthMode();
  if (mode === 'local_only_fallback') {
    return next();
  }

  // Remote request must provide Bearer token or query token (for SSE EventSource)
  const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
  let token = '';

  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  } else if (typeof req.query?.token === 'string') {
    token = (req.query.token as string).trim();
  }

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required: Remote access requires a valid pharmacy owner login.',
      authRequired: true
    });
  }

  const verified = verifyStaffToken(token);
  if (!verified) {
    return res.status(401).json({
      error: 'Session expired or invalid: Please log in again.',
      authRequired: true
    });
  }

  if (verified.role !== 'owner') {
    return res.status(403).json({
      error: 'Access denied: Remote web portal access is strictly restricted to the pharmacy owner account.'
    });
  }

  req.tenant = verified;
  next();
}

/**
 * Resolves tenant and authenticated user context on incoming requests.
 * Fallback mode: For offline/desktop standalone deployments without explicit logins,
 * defaults to Store #1 and Admin role to ensure ZERO disruption to single-store operations (MULTI-PHARMACY.md Section 34).
 */
export async function tenantAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.tenant) {
      return next();
    }

    const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
    let token = '';

    if (authHeader) {
      token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    } else if (typeof req.query?.token === 'string') {
      token = (req.query.token as string).trim();
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
