/**
 * 3-UPI QR Code Rotation & Payment Service
 * Implements strict alternating QR code selection, UPI link generation,
 * and state management for Customer Orders.
 * Reference: CENTRALIZED CATALOG + BOOKING/PICKUP WORKFLOW.md (§12, §13, §14)
 */

import path from 'path';
import fs from 'fs';
import { dbManager } from '../database/connection.js';
import { getStoreMedicalName } from './storeSettingsService.js';
import { getAppDataDir } from '../config/index.js';
import QRCode from 'qrcode';
import { createCanvas, loadImage } from 'canvas';

export interface PaymentCardOptions {
  upiUri: string;
  orderNumber: string;
  medicineName?: string;
  amount: number;
  payeeName?: string;
  upiId: string;
  storeName?: string;
  filename?: string;
}

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
   * Resolve configured store name from app_settings
   */
  async getStoreName(): Promise<string> {
    try {
      const db = await dbManager.getConnection();
      return await getStoreMedicalName(db);
    } catch {
      return 'AI PHARMACY';
    }
  }

  /**
   * Generate Branded Visual Payment Card (Sample 3) on disk.
   * Includes store header, Special Order number, medicine name, amount badge,
   * high-resolution Level-H QR code, UPI ID banner, and supported apps footer.
   */
  async generatePaymentCard(options: PaymentCardOptions): Promise<string> {
    const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const cleanFilename = options.filename
      ? (options.filename.endsWith('.png') ? options.filename : `${options.filename}.png`)
      : `payment_card_${options.orderNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const fullPath = path.join(uploadsDir, cleanFilename);

    const storeName = (options.storeName || (await this.getStoreName())).toUpperCase();
    const qrBuffer = await QRCode.toBuffer(options.upiUri, {
      width: 380,
      margin: 1,
      errorCorrectionLevel: 'H'
    });
    const qrImg = await loadImage(qrBuffer);

    const width = 540;
    const height = 720;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Helper for safe rounded rect drawing
    const drawRoundRect = (x: number, y: number, w: number, h: number, r: number | number[]) => {
      const anyCtx = ctx as any;
      if (typeof anyCtx.roundRect === 'function') {
        ctx.beginPath();
        anyCtx.roundRect(x, y, w, h, r);
      } else {
        const radius = Array.isArray(r) ? r[0] : r;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
      }
    };

    // 1. Card Container Background
    ctx.fillStyle = '#ffffff';
    drawRoundRect(0, 0, width, height, 24);
    ctx.fill();

    // Subtle outer card border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    drawRoundRect(1, 1, width - 2, height - 2, 24);
    ctx.stroke();

    // 2. Header Banner
    ctx.fillStyle = '#0f766e'; // Deep Medical Teal
    drawRoundRect(0, 0, width, 120, [24, 24, 0, 0]);
    ctx.fill();

    // Pharmacy Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(storeName, width / 2, 45);

    // Special Order Subtitle
    ctx.fillStyle = '#ccfbf1';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`Special Order: ${options.orderNumber}`, width / 2, 78);

    // Medicine line if available
    if (options.medicineName) {
      ctx.fillStyle = '#99f6e4';
      ctx.font = '14px sans-serif';
      const medText = options.medicineName.length > 38
        ? `${options.medicineName.substring(0, 36)}...`
        : options.medicineName;
      ctx.fillText(`💊 ${medText}`, width / 2, 103);
    }

    // 3. Amount Badge
    const badgeW = 280;
    const badgeH = 48;
    const badgeX = (width - badgeW) / 2;
    const badgeY = 135;
    ctx.fillStyle = '#f0fdf4';
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    drawRoundRect(badgeX, badgeY, badgeW, badgeH, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#15803d';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`BOOKING ADVANCE: ₹${Number(options.amount || 0).toFixed(2)}`, width / 2, badgeY + 31);

    // 4. Center QR Code (High-contrast, Level-H)
    const qrSize = 360;
    const qrX = (width - qrSize) / 2;
    const qrY = 195;
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

    // 5. UPI ID Container Pill
    const pillW = 460;
    const pillH = 44;
    const pillX = (width - pillW) / 2;
    const pillY = 575;
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    drawRoundRect(pillX, pillY, pillW, pillH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`UPI ID: ${options.upiId.trim()}`, width / 2, pillY + 28);

    // 6. Footer - Accepted UPI Apps
    ctx.fillStyle = '#64748b';
    ctx.font = '13px sans-serif';
    ctx.fillText('Accepted on GPay • PhonePe • Paytm • Any UPI App', width / 2, 650);

    // 7. Write to disk
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(fullPath, buffer);
    return fullPath;
  }

  /**
   * Generate PNG Buffer for a given UPI URI to send over WhatsApp
   */
  async generateQrBuffer(upiUri: string): Promise<Buffer> {
    return QRCode.toBuffer(upiUri, { width: 300, margin: 2 });
  }

  /**
   * Generate payment file on disk for a given UPI URI.
   * If card options are provided, generates the full visual card (Sample 3).
   * Otherwise falls back to clean QR code.
   */
  async generateQrFile(upiUri: string, filename: string, options?: Partial<PaymentCardOptions>): Promise<string> {
    if (options && options.orderNumber && options.amount !== undefined && options.upiId) {
      return this.generatePaymentCard({
        upiUri,
        orderNumber: options.orderNumber,
        medicineName: options.medicineName,
        amount: options.amount,
        payeeName: options.payeeName,
        upiId: options.upiId,
        storeName: options.storeName,
        filename
      });
    }

    const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const cleanFilename = filename.endsWith('.png') ? filename : `${filename}.png`;
    const fullPath = path.join(uploadsDir, cleanFilename);
    const buffer = await this.generateQrBuffer(upiUri);
    fs.writeFileSync(fullPath, buffer);
    return fullPath;
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
