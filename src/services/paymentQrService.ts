/**
 * 3-UPI QR Code Rotation & Payment Service
 * Implements strict alternating QR code selection, UPI link generation,
 * and state management for Customer Orders.
 * Reference: CENTRALIZED CATALOG + BOOKING/PICKUP WORKFLOW.md (§12, §13, §14)
 */

import { dbManager } from '../database/connection.js';

export interface PaymentQrConfig {
  id: 'QR_1' | 'QR_2' | 'QR_3';
  label: string;
  payee_name: string;
  upi_id: string;
  qr_image_url?: string;
  is_active: boolean;
}

export const DEFAULT_QR_CONFIGS: PaymentQrConfig[] = [
  {
    id: 'QR_1',
    label: 'Pharmacy Counter UPI (QR 1)',
    payee_name: 'AI Pharmacy Counter 1',
    upi_id: 'aipharmacy1@upi',
    qr_image_url: '',
    is_active: true
  },
  {
    id: 'QR_2',
    label: 'Pharmacy Merchant UPI (QR 2)',
    payee_name: 'AI Pharmacy Merchant',
    upi_id: 'aipharmacy2@upi',
    qr_image_url: '',
    is_active: true
  },
  {
    id: 'QR_3',
    label: 'Pharmacy Direct UPI (QR 3)',
    payee_name: 'AI Pharmacy Store 3',
    upi_id: 'aipharmacy3@upi',
    qr_image_url: '',
    is_active: true
  }
];

class PaymentQrService {
  /**
   * Load the 3 QR configurations from app_settings with fallback defaults
   */
  async getQrConfigs(): Promise<PaymentQrConfig[]> {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      "SELECT key, value FROM app_settings WHERE key LIKE 'payment_qr_%'"
    ).catch(() => []);

    const settingsMap = new Map<string, string>();
    for (const r of rows) {
      settingsMap.set(r.key, r.value);
    }

    const configs: PaymentQrConfig[] = [];
    const qrIds: Array<'QR_1' | 'QR_2' | 'QR_3'> = ['QR_1', 'QR_2', 'QR_3'];

    for (const id of qrIds) {
      const lower = id.toLowerCase();
      const defaultConf = DEFAULT_QR_CONFIGS.find(d => d.id === id)!;
      configs.push({
        id,
        label: settingsMap.get(`payment_${lower}_label`) || defaultConf.label,
        payee_name: settingsMap.get(`payment_${lower}_payee_name`) || defaultConf.payee_name,
        upi_id: settingsMap.get(`payment_${lower}_upi_id`) || defaultConf.upi_id,
        qr_image_url: settingsMap.get(`payment_${lower}_image_url`) || defaultConf.qr_image_url || '',
        is_active: settingsMap.get(`payment_${lower}_active`) !== 'false'
      });
    }

    return configs;
  }

  /**
   * Save QR configurations
   */
  async saveQrConfigs(configs: PaymentQrConfig[]): Promise<void> {
    const db = await dbManager.getConnection();
    for (const conf of configs) {
      const lower = conf.id.toLowerCase();
      await db.run(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [`payment_${lower}_label`, conf.label]
      );
      await db.run(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [`payment_${lower}_payee_name`, conf.payee_name]
      );
      await db.run(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [`payment_${lower}_upi_id`, conf.upi_id]
      );
      await db.run(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [`payment_${lower}_image_url`, conf.qr_image_url || '']
      );
      await db.run(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [`payment_${lower}_active`, conf.is_active ? 'true' : 'false']
      );
    }
  }

  /**
   * Allocate the next alternating QR code for a new order.
   * Rule (§13): selected_qr != previous_order_qr
   */
  async allocateNextQr(): Promise<PaymentQrConfig> {
    const db = await dbManager.getConnection();
    const configs = await this.getQrConfigs();
    const activeConfigs = configs.filter(c => c.is_active && c.upi_id);

    if (activeConfigs.length === 0) {
      return DEFAULT_QR_CONFIGS[0];
    }
    if (activeConfigs.length === 1) {
      return activeConfigs[0];
    }

    // Get previous order QR from app_settings
    const lastRow = await db.get(
      "SELECT value FROM app_settings WHERE key = 'last_selected_payment_qr'"
    ).catch(() => null);
    const lastQrId = lastRow?.value || '';

    // Filter out previous order's QR code
    const eligibleConfigs = activeConfigs.filter(c => c.id !== lastQrId);
    const pool = eligibleConfigs.length > 0 ? eligibleConfigs : activeConfigs;

    // Pick next deterministically or sequentially
    const selected = pool[Math.floor(Math.random() * pool.length)];

    // Persist as last selected
    await db.run(
      "INSERT INTO app_settings (key, value) VALUES ('last_selected_payment_qr', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [selected.id]
    ).catch(() => {});

    return selected;
  }

  /**
   * Generate standard UPI payment URI
   */
  buildUpiUri(upiId: string, payeeName: string, amount: number, orderId: number | string): string {
    const cleanAmount = Number(amount || 0).toFixed(2);
    const encodedName = encodeURIComponent(payeeName || 'AI Pharmacy');
    const note = encodeURIComponent(`Order #${orderId}`);
    return `upi://pay?pa=${upiId}&pn=${encodedName}&am=${cleanAmount}&cu=INR&tr=${orderId}&tn=${note}`;
  }

  /**
   * Fetch QR details locked to a specific order
   */
  async getOrderQrDetails(orderId: number): Promise<{
    qr_id: string;
    label: string;
    payee_name: string;
    upi_id: string;
    upi_uri: string;
    qr_image_url: string;
    amount: number;
    payment_status: string;
  } | null> {
    const db = await dbManager.getConnection();
    const order = await db.get(
      'SELECT id, payment_qr_id, total_amount, advance_payment, payment_status FROM special_orders WHERE id = ?',
      [orderId]
    );
    if (!order) return null;

    const configs = await this.getQrConfigs();
    const assignedId = order.payment_qr_id || 'QR_1';
    const config = configs.find(c => c.id === assignedId) || configs[0] || DEFAULT_QR_CONFIGS[0];
    const amount = Number(order.total_amount || order.advance_payment || 0);

    return {
      qr_id: config.id,
      label: config.label,
      payee_name: config.payee_name,
      upi_id: config.upi_id,
      upi_uri: this.buildUpiUri(config.upi_id, config.payee_name, amount, order.id),
      qr_image_url: config.qr_image_url || '',
      amount,
      payment_status: order.payment_status || 'UNPAID'
    };
  }
}

export const paymentQrService = new PaymentQrService();
