/**
 * Mutation Audit Logging Service (§29 of MULTI-PHARMACY.md)
 * Provides immutable audit trail for state mutations across multi-pharmacy tenants.
 * Tracks user_id, store_id, action, timestamp, entity, before_snapshot, after_snapshot.
 */

import { dbManager } from '../database/connection.js';
import { activityLogger } from './activityLogger.js';
import { eventService } from './eventService.js';

export interface MutationAuditEntry {
  storeId?: number;
  userId?: number;
  username?: string;
  action: string;
  entity: string;
  entityId?: string | number;
  description: string;
  beforeSnapshot?: any;
  afterSnapshot?: any;
  metadata?: Record<string, any>;
}

export interface AuditQueryFilters {
  storeId?: number;
  userId?: number;
  entity?: string;
  entityId?: string | number;
  action?: string;
  limit?: number;
  offset?: number;
}

export async function logMutationAudit(entry: MutationAuditEntry): Promise<number | null> {
  try {
    const meta: Record<string, any> = {
      ...(entry.metadata || {}),
      before: entry.beforeSnapshot ?? null,
      after: entry.afterSnapshot ?? null,
      username: entry.username || 'system'
    };

    const insertedId = await activityLogger.logActivity(
      entry.action,
      entry.description,
      meta,
      {
        storeId: entry.storeId ?? 1,
        userId: entry.userId,
        entity: entry.entity,
        entityId: entry.entityId
      }
    );

    try {
      eventService.broadcast('audit_updated', { at: Date.now(), id: insertedId, action: entry.action, storeId: entry.storeId });
    } catch (_) {}

    return insertedId;
  } catch (err: any) {
    console.error('[AuditLoggerService] Failed to log mutation audit:', err);
    return null;
  }
}

export async function getMutationAuditLogs(filters: AuditQueryFilters = {}) {
  const db = await dbManager.getConnection();
  const conditions: string[] = ['1=1'];
  const params: any[] = [];

  if (filters.storeId != null) {
    conditions.push('store_id = ?');
    params.push(filters.storeId);
  }
  if (filters.userId != null) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }
  if (filters.entity) {
    conditions.push('entity = ?');
    params.push(filters.entity);
  }
  if (filters.entityId != null) {
    conditions.push('entity_id = ?');
    params.push(String(filters.entityId));
  }
  if (filters.action) {
    conditions.push('action_type = ?');
    params.push(filters.action);
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  params.push(limit, offset);

  const query = `
    SELECT id, store_id, user_id, entity, entity_id, action_type, description, metadata, created_at
    FROM action_logs
    WHERE ${conditions.join(' AND ')}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await db.all(query, params);
  return rows.map((r: any) => {
    let parsedMeta = null;
    if (r.metadata) {
      try {
        parsedMeta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
      } catch {
        parsedMeta = r.metadata;
      }
    }
    return {
      id: r.id,
      store_id: r.store_id,
      user_id: r.user_id,
      entity: r.entity,
      entity_id: r.entity_id,
      action: r.action_type,
      description: r.description,
      before_snapshot: parsedMeta?.before ?? null,
      after_snapshot: parsedMeta?.after ?? null,
      username: parsedMeta?.username ?? null,
      metadata: parsedMeta,
      created_at: r.created_at
    };
  });
}
