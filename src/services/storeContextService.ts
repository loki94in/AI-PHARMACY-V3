import { Request } from 'express';
import { dbManager } from '../database/connection.js';

export interface Store {
  id: number;
  name: string;
  code?: string;
  address?: string;
  phone?: string;
  email?: string;
  is_central: number;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateStoreInput {
  name: string;
  code?: string;
  address?: string;
  phone?: string;
  email?: string;
  is_central?: boolean | number;
}

export interface UpdateStoreInput {
  name?: string;
  code?: string;
  address?: string;
  phone?: string;
  email?: string;
  is_central?: boolean | number;
  is_active?: boolean | number;
}

/**
 * Resolves the active store ID from the incoming request.
 * Priority:
 * 1. HTTP header `x-store-id`
 * 2. Query param `store_id`
 * 3. Default store `1`
 */
export function resolveStoreId(req: Request): number {
  const headerVal = req.headers['x-store-id'];
  if (headerVal && typeof headerVal === 'string') {
    const parsed = parseInt(headerVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const queryVal = req.query?.store_id;
  if (queryVal && typeof queryVal === 'string') {
    const parsed = parseInt(queryVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

export class StoreContextService {
  /**
   * Retrieves list of all stores
   */
  async listStores(dbInstance?: any, includeInactive = false): Promise<Store[]> {
    const db = dbInstance || (await dbManager.getConnection());
    const sql = includeInactive
      ? 'SELECT * FROM stores ORDER BY id ASC'
      : 'SELECT * FROM stores WHERE is_active = 1 ORDER BY id ASC';
    const rows = await db.all(sql).catch(() => []);
    if (rows.length === 0) {
      // Fallback default store if table is empty
      return [{ id: 1, name: 'Main Store', code: 'STORE-A', is_central: 1, is_active: 1 }];
    }
    return rows;
  }

  /**
   * Get store by ID
   */
  async getStoreById(storeId: number, dbInstance?: any): Promise<Store | null> {
    const db = dbInstance || (await dbManager.getConnection());
    const row = await db.get('SELECT * FROM stores WHERE id = ?', [storeId]);
    return row || null;
  }

  /**
   * Create a new store
   */
  async createStore(input: CreateStoreInput, dbInstance?: any): Promise<Store> {
    const db = dbInstance || (await dbManager.getConnection());
    const name = (input.name || '').trim();
    if (!name) {
      throw new Error('Store name is required');
    }

    const code = (input.code || `STORE-${Date.now().toString(36).toUpperCase()}`).trim();
    const address = (input.address || '').trim();
    const phone = (input.phone || '').trim();
    const email = (input.email || '').trim();
    const isCentral = input.is_central ? 1 : 0;

    const result = await db.run(
      `INSERT INTO stores (name, code, address, phone, email, is_central, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [name, code, address, phone, email, isCentral]
    );

    const newId = result.lastID;
    const store = await this.getStoreById(newId, db);
    if (!store) throw new Error('Failed to retrieve created store');
    return store;
  }

  /**
   * Update an existing store
   */
  async updateStore(storeId: number, input: UpdateStoreInput, dbInstance?: any): Promise<Store> {
    const db = dbInstance || (await dbManager.getConnection());
    const existing = await this.getStoreById(storeId, db);
    if (!existing) {
      throw new Error(`Store #${storeId} not found`);
    }

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    const code = input.code !== undefined ? input.code.trim() : existing.code;
    const address = input.address !== undefined ? input.address.trim() : existing.address;
    const phone = input.phone !== undefined ? input.phone.trim() : existing.phone;
    const email = input.email !== undefined ? input.email.trim() : existing.email;
    const isCentral = input.is_central !== undefined ? (input.is_central ? 1 : 0) : existing.is_central;
    const isActive = input.is_active !== undefined ? (input.is_active ? 1 : 0) : existing.is_active;

    await db.run(
      `UPDATE stores 
       SET name = ?, code = ?, address = ?, phone = ?, email = ?, is_central = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, code, address, phone, email, isCentral, isActive, storeId]
    );

    const updated = await this.getStoreById(storeId, db);
    if (!updated) throw new Error(`Failed to reload store #${storeId}`);
    return updated;
  }

  /**
   * Get store setting by key
   */
  async getStoreSetting(storeId: number, key: string, defaultValue: string = '', dbInstance?: any): Promise<string> {
    const db = dbInstance || (await dbManager.getConnection());
    try {
      const row = await db.get(
        'SELECT value FROM store_settings WHERE store_id = ? AND key = ?',
        [storeId, key]
      );
      if (row && row.value !== null && row.value !== undefined) {
        return String(row.value);
      }
    } catch (_) {}
    return defaultValue;
  }

  /**
   * Set store setting by key
   */
  async setStoreSetting(storeId: number, key: string, value: string, dbInstance?: any): Promise<void> {
    const db = dbInstance || (await dbManager.getConnection());
    await db.run(
      `INSERT INTO store_settings (store_id, key, value, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(store_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [storeId, key, value]
    );
  }

  /**
   * Get all settings for a store
   */
  async getAllStoreSettings(storeId: number, dbInstance?: any): Promise<Record<string, string>> {
    const db = dbInstance || (await dbManager.getConnection());
    const rows = await db.all(
      'SELECT key, value FROM store_settings WHERE store_id = ?',
      [storeId]
    ).catch(() => []);
    const settings: Record<string, string> = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    return settings;
  }
}

export const storeContextService = new StoreContextService();
