// WhatsApp Intent Service — central orchestrator for inbound messages.
// Routes messages through: ignore check → customer lookup → text parse → OCR → smart match.
import fs from 'fs';
import path from 'path';
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { parseMessage, isRepeatRequest, isRefillConfirmationResponse, isPlausibleMedicineName, detectDosageForm, isMedicineLikely, extractMedicineCandidates, detectNonAllopathicKind, isPromotionalOrBroadcastMessage, DOSAGE_AND_PACKAGING_NOISE_TOKENS } from './intentKeywords.js';
import { ocrScanQueue } from './ocrScanQueue.js';
import { productNameFilterService } from './productNameFilterService.js';
import { searchCatalog, scoreProductName } from './pharmarackCatalogCache.js';
import { waAdminEscalationService } from './waAdminEscalationService.js';
import { isItemInStock, resolveCommonOrFrequentDistributor, addItemsToPharmarackCart } from '../routes/pharmarack.js';
import { paymentQrService } from './paymentQrService.js';
import { startupSyncCoordinator } from './startupSyncCoordinator.js';
import { visualIndexService } from './visualIndexService.js';
import { GATE_VARIANTS, type GateDecision } from '../../scanGateAlgorithms.js';

// Confidence gate: below these similarity scores a message is discarded as
// chit-chat instead of being broadcast/escalated. Tune here; every discard is
// logged with its score for calibration.
const GATE_WITH_INTENT = 0.60; // explicit intent words, or image (OCR) source
const GATE_IMPLICIT = 0.72;    // bare text with no intent words

/**
 * Does the best match score clear the escalation gate?
 * Exported for unit testing.
 */
export function passesGate(bestScore: number, hasIntentWords: boolean, source: 'text' | 'ocr' | 'both', hasConfirmedMatch = false): boolean {
  const threshold = (hasIntentWords || source !== 'text' || hasConfirmedMatch) ? GATE_WITH_INTENT : GATE_IMPLICIT;
  return bestScore >= threshold;
}

export interface DownloadRetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Retry a WhatsApp media download. whatsapp-web.js's downloadMedia() is
 * commonly not ready the instant a message event fires (decryption keys not
 * yet available, especially for @lid-addressed chats) — a single failed or
 * empty attempt must not drop the image silently. Exported for unit testing.
 */
export async function downloadMediaWithRetry(
  downloadFn: () => Promise<{ data?: string } | undefined>,
  options: DownloadRetryOptions = {}
): Promise<{ data?: string } | undefined> {
  const maxAttempts = options.maxAttempts ?? 3;
  const delayMs = options.delayMs ?? 1000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await downloadFn();
      if (result?.data) return result;
      lastErr = new Error('downloadMedia returned no data');
    } catch (err) {
      lastErr = err;
    }
    // Per-attempt visibility: silent retries made media failures undiagnosable
    // (the surfaced error was often a bare minified token like "r").
    console.warn(`[Intent Service] Media download attempt ${attempt}/${maxAttempts} failed:`, lastErr instanceof Error ? lastErr.message : lastErr);
    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

const INBOUND_MEDIA_DIR = path.resolve(process.cwd(), 'data', 'inbound_media');

/**
 * Persist a downloaded WhatsApp image to disk immediately after download,
 * before OCR runs — regardless of match outcome, so a customer's photo is
 * never processed and then lost with no trace. Exported for unit testing.
 */
export async function saveInboundMedia(msgId: string, buffer: Buffer): Promise<string> {
  await fs.promises.mkdir(INBOUND_MEDIA_DIR, { recursive: true });
  const safeId = String(msgId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(INBOUND_MEDIA_DIR, `${safeId}.jpg`);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Decide whether an OCR'd image should be treated as a medicine scan.
 * Always runs the structural V2 gate (dose-form / strength / known-API), even
 * when the api_substances dictionary is empty. An empty dictionary narrows
 * the gate to dose-form/strength heuristics only — it must never bypass the
 * gate entirely, or every image (tickets, bills, food packets) gets scanned
 * and escalated to the admin. Exported for unit testing.
 */
export function resolveOcrGateDecision(ocrRaw: string, finalName: string, knownApis: Set<string>): GateDecision {
  const v2Gate = GATE_VARIANTS.find(v => v.id === 'V2');
  if (!v2Gate) return 'skip';
  if (knownApis.size === 0) {
    console.warn('[Intent Service] api_substances is empty; scan gate relying on dose-form/strength heuristics only.');
  }
  return v2Gate.decide(ocrRaw, finalName, { knownApis });
}

interface MatchResult {
  customer: { id: number; name: string; phone: string } | null;
  isNewCustomer: boolean;
  medicineName: string;
  quantity: number;
  unit: string;
  localMatches: string[];
  catalogResults: { mapped: any[]; nonMapped: any[] } | null;
  confidence: number;
  isRepeat: boolean;
  source: 'text' | 'ocr' | 'both';
  messageBody: string;
}

async function isIgnored(phone: string): Promise<boolean> {
  const db = await dbManager.getConnection();
  const row = await db.get('SELECT reason FROM ignored_whatsapp_numbers WHERE phone = ?', [phone]);
  if (row) {
    return row.reason !== 'unignored';
  }
  const isGroupOrBroadcast = phone.endsWith('@g.us') || phone.endsWith('@broadcast') || phone.includes('broadcast') || phone === 'status@broadcast' || phone.includes('-');
  if (isGroupOrBroadcast) {
    try {
      await db.run(
        `INSERT OR IGNORE INTO ignored_whatsapp_numbers (phone, reason) VALUES (?, ?)`,
        [phone, phone.endsWith('@g.us') ? 'group' : 'broadcast']
      );
    } catch (e) {
      console.warn('[WhatsApp Intent] Failed to auto-insert ignored phone:', e);
    }
  }
  return isGroupOrBroadcast;
}

/**
 * Ignore distributors and internal numbers (owner/admin) so customer ordering
 * bot workflows never interfere with distributor messaging or self-messages.
 * Checks all registered supplier / staff tables:
 *   1. distributors (main)
 *   2. pharmarack_distributors (Pharmarack-synced suppliers)
 *   3. delivery_boys (dispatch staff)
 *   4. distributor_dispatch_reminders (reminder-registered contacts)
 */
async function isDistributorOrInternal(phone: string, db: any): Promise<boolean> {
  const cleanDigits = (phone || '').replace(/\D/g, '').slice(-10);
  if (!cleanDigits) return false;

  try {
    // 1. Check if number belongs to a registered distributor (main table)
    const dist = await db.get(
      `SELECT id, name FROM distributors WHERE contact IS NOT NULL AND (contact LIKE ? OR contact LIKE ?) LIMIT 1`,
      [`%${cleanDigits}`, `%${cleanDigits}%`]
    );
    if (dist) {
      console.log(`[Intent Service] Skipping customer bot for distributor "${dist.name}" (${cleanDigits}).`);
      return true;
    }

    // 2. Check pharmarack_distributors (Pharmarack-synced suppliers)
    try {
      const pharmaracDist = await db.get(
        `SELECT id, name FROM pharmarack_distributors WHERE contact IS NOT NULL AND (contact LIKE ? OR contact LIKE ?) LIMIT 1`,
        [`%${cleanDigits}`, `%${cleanDigits}%`]
      );
      if (pharmaracDist) {
        console.log(`[Intent Service] Skipping customer bot for Pharmarack distributor "${pharmaracDist.name}" (${cleanDigits}).`);
        return true;
      }
    } catch { /* table may not exist on older installs */ }

    // 3. Check delivery_boys (dispatch staff)
    try {
      const deliveryBoy = await db.get(
        `SELECT id, name FROM delivery_boys WHERE phone IS NOT NULL AND (phone LIKE ? OR phone LIKE ?) LIMIT 1`,
        [`%${cleanDigits}`, `%${cleanDigits}%`]
      );
      if (deliveryBoy) {
        console.log(`[Intent Service] Skipping customer bot for delivery staff "${deliveryBoy.name}" (${cleanDigits}).`);
        return true;
      }
    } catch { /* table may not exist on older installs */ }

    // 4. Check distributor_dispatch_reminders (reminder-registered contacts)
    try {
      const reminderContact = await db.get(
        `SELECT id FROM distributor_dispatch_reminders WHERE phone IS NOT NULL AND (phone LIKE ? OR phone LIKE ?) LIMIT 1`,
        [`%${cleanDigits}`, `%${cleanDigits}%`]
      );
      if (reminderContact) {
        console.log(`[Intent Service] Skipping customer bot for dispatch reminder contact (${cleanDigits}).`);
        return true;
      }
    } catch { /* table may not exist on older installs */ }

    // 5. Check if number belongs to owner / admin
    const adminPhone = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db) || '';
    const cleanAdmin = (adminPhone || '').replace(/\D/g, '').slice(-10);
    if (cleanAdmin && cleanAdmin === cleanDigits) {
      return true;
    }
  } catch (err) {
    console.warn('[Intent Service] Non-fatal check in isDistributorOrInternal:', err);
  }

  return false;
}


/**
 * Sanitize raw medicine name down to the first 2-3 core words for Pharmarack catalog/live search.
 * Strips dosage forms (TAB, CAP, SYP, SUS, CREAM, INJ, etc.), packaging forms (STRIP, BOTTLE, BOX, PACK, TUBE),
 * and measurement suffixes (MG, ML, GM, MCG) to ensure maximum API hit rate on Pharmarack.
 */
export function sanitizePharmarackQuery(rawName: string): string {
  if (!rawName) return '';
  const cleaned = rawName
    .replace(/[+/,._\-()\[\]#*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  const coreWords: string[] = [];

  for (const w of words) {
    const lower = w.toLowerCase();
    if (DOSAGE_AND_PACKAGING_NOISE_TOKENS.has(lower)) {
      continue;
    }
    const unitMatch = w.match(/^(\d+(?:\.\d+)?)(mg|ml|gm|g|mcg|iu|%|tabs?|caps?)$/i);
    if (unitMatch) {
      coreWords.push(unitMatch[1]);
    } else {
      coreWords.push(w);
    }

    if (coreWords.length >= 3) {
      break;
    }
  }

  if (coreWords.length === 0) {
    return words.slice(0, 2).join(' ');
  }

  return coreWords.slice(0, 3).join(' ');
}

/**
 * Send medicine ordering guidance prompt to customer if they sent conversational chat or greeting with no medicine name.
 * Debounced per customer phone (maximum once per 12 hours) to prevent spam.
 */
async function maybeSendGuidancePrompt(phone: string, customerName: string, db: any): Promise<void> {
  const cleanDigits = (phone || '').replace(/\D/g, '').slice(-10);
  if (!cleanDigits || cleanDigits.length < 10) return;

  try {
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    const recent = await db.get(
      `SELECT id FROM whatsapp_sent_register
       WHERE phone_last10 = ? AND type = 'customer_guidance_prompt' AND sent_at > ?
       LIMIT 1`,
      [cleanDigits, twelveHoursAgo]
    );
    if (recent) {
      console.log(`[Intent Service] Guidance prompt debounced for ${cleanDigits} (sent recently).`);
      return;
    }

    const { getStoreMedicalName } = await import('./storeSettingsService.js');
    const storeName = await getStoreMedicalName(db);

    const guidanceMsg = 
      `Namaste! Welcome to *${storeName}* 🏥\n\n` +
      `To check medicine availability or place an order, please send:\n\n` +
      `📸 *Option 1: Prescription / Strip Photo*\n` +
      `Send a clear photo of your doctor's prescription or medicine strip.\n\n` +
      `✍️ *Option 2: Medicine Name(s)*\n` +
      `Type *only* the medicine name and quantity (e.g. *Dolo 650 - 1 strip*).\n\n` +
      `🔁 *Existing Regular Patients:*\n` +
      `To repeat your regular prescription, simply reply with *Refill* or *Same*.\n\n` +
      `⏱️ Our pharmacist will check availability and message you shortly!`;

    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
    await whatsappQueueWorker.enqueue(
      phone,
      guidanceMsg,
      'customer_guidance_prompt',
      customerName || 'Customer'
    );
    console.log(`[Intent Service] Sent medicine ordering guidance prompt to ${cleanDigits}.`);
  } catch (err) {
    console.warn('[Intent Service] Failed to send guidance prompt:', err);
  }
}

/**
 * Look up customer by phone number. Returns null if not found (new customer).
 */
async function lookupCustomer(phone: string): Promise<{ id: number; name: string; phone: string } | null> {
  const db = await dbManager.getConnection();
  // Strip country code prefixes and @c.us suffix for matching
  const cleanPhone = phone.replace(/@c\.us$/, '').replace(/^91/, '');
  const row = await db.get(
    `SELECT id, name, phone FROM customers WHERE phone LIKE ? OR phone LIKE ? LIMIT 1`,
    [`%${cleanPhone}`, `%${cleanPhone.slice(-10)}`]
  );
  return row || null;
}

/**
 * Get recent refill history for a customer.
 * patient_refills has no customer_id — it is keyed by patient_phone, so we
 * join by the customer's last-10-digit phone (same trick as lookupCustomer).
 */
async function getCustomerHistory(customer: { id: number; phone: string }): Promise<any[]> {
  const db = await dbManager.getConnection();
  const last10 = (customer.phone || '').replace(/\D/g, '').slice(-10);
  if (!last10) return [];
  const rows = await db.all(
    `SELECT m.name AS medicine_name, pr.refill_interval_days, pr.last_refill_date, pr.next_refill_date
     FROM patient_refills pr JOIN medicines m ON m.id = pr.medicine_id
     WHERE pr.patient_phone LIKE ?
     ORDER BY pr.last_refill_date DESC LIMIT 10`,
    [`%${last10}`]
  );
  return rows;
}

export interface CustomerContext {
  purchases: Array<{ date: string; name: string; quantity: number }>;
  refills: Array<{ medicine_name: string; next_refill_date: string | null; last_refill_date: string | null }>;
  lastMessages: Array<{ body: string }>;
}

/**
 * Fetch brief context for an OLD customer so the admin escalation can show
 * what they previously bought and what they were just talking about.
 */
async function getCustomerContext(
  customer: { id: number; phone: string } | null,
  chatId: string | undefined,
  currentMsgId: string | undefined
): Promise<CustomerContext> {
  const context: CustomerContext = { purchases: [], refills: [], lastMessages: [] };
  const db = await dbManager.getConnection();

  if (customer) {
    try {
      context.purchases = await db.all(
        `SELECT si.date, m.name, s.quantity
         FROM sales_invoices si
         JOIN sale_items s ON s.invoice_id = si.id
         JOIN inventory_master im ON im.id = s.inventory_id
         JOIN medicines m ON m.id = im.medicine_id
         WHERE si.customer_id = ?
         ORDER BY si.date DESC LIMIT 5`,
        [customer.id]
      );
    } catch (err) {
      console.warn('[Intent Service] Failed to fetch purchase context:', err);
    }
    try {
      context.refills = (await getCustomerHistory(customer)).slice(0, 3);
    } catch (err) {
      console.warn('[Intent Service] Failed to fetch refill context:', err);
    }
  }

  if (chatId) {
    try {
      context.lastMessages = await db.all(
        `SELECT body FROM whatsapp_messages
         WHERE chat_id = ? AND from_me = 0 AND id != ? AND body != ''
         ORDER BY timestamp DESC LIMIT 2`,
        [chatId, currentMsgId || '']
      );
    } catch (err) {
      console.warn('[Intent Service] Failed to fetch recent messages context:', err);
    }
  }

  return context;
}

let clarificationsTableEnsured = false;
async function ensureClarificationsTable(db: any): Promise<void> {
  if (clarificationsTableEnsured) return;
  await db.run(`CREATE TABLE IF NOT EXISTS wa_pending_clarifications (
    phone TEXT PRIMARY KEY,
    suggested_name TEXT NOT NULL,
    original_query TEXT,
    options_json TEXT,
    selected_option TEXT,
    quantity INTEGER DEFAULT 1,
    unit TEXT DEFAULT 'strip',
    step TEXT DEFAULT 'awaiting_confirmation',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  try {
    const cols = await db.all('PRAGMA table_info(wa_pending_clarifications)');
    const colNames = new Set(cols.map((c: any) => c.name));
    if (!colNames.has('items_json')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN items_json TEXT DEFAULT NULL');
    }
    if (!colNames.has('options_json')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN options_json TEXT DEFAULT NULL');
    }
    if (!colNames.has('selected_option')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN selected_option TEXT DEFAULT NULL');
    }
    if (!colNames.has('quantity')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN quantity INTEGER DEFAULT 1');
    }
    if (!colNames.has('unit')) {
      await db.run("ALTER TABLE wa_pending_clarifications ADD COLUMN unit TEXT DEFAULT 'strip'");
    }
    if (!colNames.has('step')) {
      await db.run("ALTER TABLE wa_pending_clarifications ADD COLUMN step TEXT DEFAULT 'awaiting_confirmation'");
    }
    if (!colNames.has('raw_qty_given')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN raw_qty_given INTEGER DEFAULT 0');
    }
    if (!colNames.has('special_order_id')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN special_order_id INTEGER DEFAULT NULL');
    }
    if (!colNames.has('so_code')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN so_code TEXT DEFAULT NULL');
    }
  } catch (_) {}
  clarificationsTableEnsured = true;
}

export function selectFormDiverseMatches(matches: string[]): string[] {
  if (!matches || matches.length <= 1) return matches || [];

  const categories: Record<string, string[]> = {
    syrup: [],
    capsule_tablet: [],
    drops: [],
    injection: [],
    other: []
  };

  for (const m of matches) {
    const upper = m.toUpperCase();
    if (/\b(SYP|SYRUP|SUSP|SUSPENSION|LIQUID|ELIXIR)\b/.test(upper)) {
      categories.syrup.push(m);
    } else if (/\b(CAP|CAPSULE|TAB|TABLET|DT|CAPLET|SOFGEL)\b/.test(upper)) {
      categories.capsule_tablet.push(m);
    } else if (/\b(DROP|DROPS)\b/.test(upper)) {
      categories.drops.push(m);
    } else if (/\b(INJ|INJECTION|VIAL|AMPOULE|INFUSION)\b/.test(upper)) {
      categories.injection.push(m);
    } else {
      categories.other.push(m);
    }
  }

  const result: string[] = [];
  const order = ['syrup', 'capsule_tablet', 'drops', 'injection', 'other'];
  for (const cat of order) {
    if (categories[cat].length > 0) {
      result.push(categories[cat][0]);
    }
  }

  if (result.length < 4) {
    for (const m of matches) {
      if (!result.includes(m)) {
        result.push(m);
        if (result.length >= 4) break;
      }
    }
  }

  return result.slice(0, 4);
}

function extractQuantityFromText(text: string): { quantity: number; unit: string } | null {
  if (!text) return null;
  const clean = text.trim().toLowerCase();
  const m = clean.match(/(?:actually\s+)?(?:make\s+it\s+|need\s+|want\s+)?(\d+)\s*(strips?|packets?|box(?:es)?|bottles?|tabs?|tablets?|patti|dabba)?/i);
  if (m) {
    const qty = parseInt(m[1], 10);
    if (!isNaN(qty) && qty > 0 && qty < 500) {
      let unit = 'strip';
      if (m[2]) {
        const u = m[2].toLowerCase();
        if (u.startsWith('bottle')) unit = 'bottle';
        else if (u.startsWith('box') || u === 'dabba') unit = 'box';
        else if (u.startsWith('tab')) unit = 'tablet';
        else if (u.startsWith('packet')) unit = 'packet';
        else unit = 'strip';
      }
      return { quantity: qty, unit };
    }
  }
  return null;
}

export interface ConfirmedProcurementParams {
  phone: string;
  chatId?: string;
  confirmedMedicine: string;
  quantity: number;
  unit: string;
  customer: any;
  isBundle?: boolean;
}

export async function executeConfirmedProcurementFlow(params: ConfirmedProcurementParams): Promise<void> {
  const { phone, chatId, confirmedMedicine, quantity, unit, customer } = params;
  const cleanDigits = (phone || '').replace(/\D/g, '').slice(-10);

  try {
    const db = await dbManager.getConnection();

    // 1. Check 15-minute idempotency to prevent duplicate Live Cart additions
    const recent = await db.get(
      `SELECT id FROM special_orders 
       WHERE phone = ? AND (LOWER(product) = LOWER(?) OR LOWER(medicine_name) = LOWER(?)) 
       AND created_at > datetime('now', '-15 minutes')
       LIMIT 1`,
      [cleanDigits, confirmedMedicine, confirmedMedicine]
    );
    if (recent) {
      console.log(`[Intent Service] Duplicate confirmed order detected for ${cleanDigits} - ${confirmedMedicine} within 15 min. Skipping duplicate procurement.`);
      return;
    }

    // 2. Search Pharmarack / distributor catalog for the confirmed item
    const localCat = await searchCatalog(confirmedMedicine).catch(() => ({ mapped: [], nonMapped: [] }));
    const allCatalog = [...(localCat.mapped || []), ...(localCat.nonMapped || [])];

    // Filter to distributors with available stock (excluding 0, OOS, nil)
    const inStockCandidates = allCatalog.filter(c => isItemInStock(c.availability ?? (c as any).stock));

    let selectedDistributor: { storeId: number; storeName: string } | null = null;
    let selectedProductInfo: any = null;

    if (inStockCandidates.length > 0) {
      const candidateStores = inStockCandidates.map(c => ({
        storeId: Number((c as any).store_id || (c as any).storeId || 0),
        storeName: String((c as any).distributor || (c as any).supplier_name || (c as any).distributor_name || '')
      })).filter(c => c.storeName.length > 0);

      selectedDistributor = await resolveCommonOrFrequentDistributor(db, candidateStores);
      selectedProductInfo = inStockCandidates.find(c => {
        const distName = String((c as any).distributor || (c as any).supplier_name || (c as any).distributor_name || '');
        return distName === selectedDistributor?.storeName || (selectedDistributor?.storeId && Number((c as any).store_id) === selectedDistributor.storeId);
      }) || inStockCandidates[0];
    } else if (allCatalog.length > 0) {
      const candidateStores = allCatalog.map(c => ({
        storeId: Number((c as any).store_id || (c as any).storeId || 0),
        storeName: String((c as any).distributor || (c as any).supplier_name || (c as any).distributor_name || '')
      })).filter(c => c.storeName.length > 0);

      selectedDistributor = await resolveCommonOrFrequentDistributor(db, candidateStores);
      selectedProductInfo = allCatalog[0];
    }

    // 3. Prepare item for Pharmarack Live Cart
    const cartItem = {
      productName: selectedProductInfo?.productName || selectedProductInfo?.name || confirmedMedicine,
      product: selectedProductInfo?.productName || selectedProductInfo?.name || confirmedMedicine,
      productId: selectedProductInfo?.productId || selectedProductInfo?.product_id || 0,
      productCode: selectedProductInfo?.productCode || selectedProductInfo?.product_code || '',
      storeId: selectedDistributor?.storeId || selectedProductInfo?.store_id || 0,
      storeName: selectedDistributor?.storeName || selectedProductInfo?.distributor || 'Standard Distributor',
      company: selectedProductInfo?.company || selectedProductInfo?.manufacturer || '',
      qty: quantity > 0 ? quantity : 1,
      rate: selectedProductInfo?.distributorPrice || selectedProductInfo?.ptr || selectedProductInfo?.rate || 0,
      mrp: selectedProductInfo?.mrp || 0,
      packaging: selectedProductInfo?.packaging || unit || '1 strip'
    };

    // 4. Evaluate Auto Add to Live Cart setting
    const { isAutoAddToLiveCartEnabled } = await import('./storeSettingsService.js');
    const autoAddToCart = await isAutoAddToLiveCartEnabled(db);

    if (autoAddToCart) {
      // Add to Pharmarack Live Cart
      const cartResult = await addItemsToPharmarackCart([cartItem]);
      console.log(`[Intent Service] Live Cart add attempt for "${cartItem.productName}": success=${cartResult.success} (${cartResult.mode || (cartResult.offline ? 'Offline' : 'Failed')})`);

      // HARD GATE: Verify cart success before proceeding with order creation or customer staging
      if (!cartResult.success) {
        console.warn(`[Intent Service] Pharmarack Live Cart addition failed for "${cartItem.productName}". Halting order confirmation.`);
        // Notify Store Owner of failure so manual action can be taken
        await waAdminEscalationService.notifyAdminOfLiveCartAdd({
          orderId: 'FAILED',
          customer,
          phone: cleanDigits,
          chatId,
          items: [{
            name: cartItem.productName,
            quantity: cartItem.qty,
            distributor: cartItem.storeName,
            rate: cartItem.rate,
            mrp: cartItem.mrp
          }],
          success: false,
          error: cartResult.error || (cartResult as any).details || 'Failed to add items to Pharmarack Live Cart'
        });
        // STOP: Do NOT record Confirmed order, do NOT create customer staged message
        return;
      }
    } else {
      console.log(`[Intent Service] Auto Add to Live Cart is OFF. Skipping automatic cart call for "${cartItem.productName}". Queuing for manual review.`);
    }

    // 5. Calculate scheduling (business hours, cutoff, holidays)
    let calculatedSchedule: any = null;
    try {
      const { orderScheduleService } = await import('./orderScheduleService.js');
      calculatedSchedule = await orderScheduleService.calculateOrderSchedule({ storeId: 1, orderCreatedAt: new Date().toISOString() });
    } catch (_) {
      calculatedSchedule = {
        scheduledProcessingAt: new Date().toISOString(),
        estimatedDeliveryStart: null,
        estimatedDeliveryEnd: null,
        cutoffAt: null,
        timezone: 'Asia/Kolkata',
        scheduleStatus: 'standard',
        scheduleReason: null,
        scheduleVersion: 1,
        calculatedAt: new Date().toISOString()
      };
    }

    // 6. Record in special_orders as Confirmed
    const todayStr = new Date().toISOString().split('T')[0];
    const orderRes = await db.run(
      `INSERT INTO special_orders (
        store_id, requester, phone, medicine_name, product, qty, priority, status,
        date, notified, customer_order_source,
        pharmarack_distributor, pharmarack_rate, pharmarack_mrp,
        scheduled_processing_at, estimated_delivery_start, estimated_delivery_end,
        cutoff_at, pharmacy_timezone, schedule_status, schedule_reason, schedule_version,
        schedule_calculated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Confirmed', ?, 0, 'whatsapp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        1,
        customer?.name || 'WhatsApp Customer',
        cleanDigits,
        cartItem.productName,
        cartItem.productName,
        cartItem.qty,
        todayStr,
        cartItem.storeName,
        cartItem.rate,
        cartItem.mrp,
        calculatedSchedule.scheduledProcessingAt,
        calculatedSchedule.estimatedDeliveryStart,
        calculatedSchedule.estimatedDeliveryEnd,
        calculatedSchedule.cutoffAt,
        calculatedSchedule.timezone,
        calculatedSchedule.scheduleStatus,
        calculatedSchedule.scheduleReason,
        calculatedSchedule.scheduleVersion,
        calculatedSchedule.calculatedAt
      ]
    );
    const specialOrderId = orderRes.lastID;

    // 7. Stage customer-facing message in automation_notifications (STRICTLY STAGED, NEVER AUTO-SENT)
    const { getStoreMedicalName, getStorePhone } = await import('./storeSettingsService.js');
    const storeLabel = await getStoreMedicalName(db);
    const storePhone = await getStorePhone(db);
    const phoneSuffix = storePhone ? `\n📞 ${storePhone}` : '';
    const stagedCustomerMsg = `Hi ${customer?.name || 'Customer'}, your order for *${cartItem.productName}* (Qty: ${cartItem.qty}) has been received at ${storeLabel}. We are arranging it with our distributor and will notify you as soon as it is ready for collection.${phoneSuffix}`;

    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id)
       VALUES (?, ?, ?, ?, 'staged', 1, ?)`,
      ['whatsapp_order', customer?.name || 'Customer', cleanDigits, stagedCustomerMsg, String(specialOrderId)]
    );

    // 8. Notify Store Owner on WhatsApp via waAdminEscalationService
    await waAdminEscalationService.notifyAdminOfLiveCartAdd({
      orderId: specialOrderId,
      customer,
      phone: cleanDigits,
      chatId,
      items: [{
        name: cartItem.productName,
        quantity: cartItem.qty,
        distributor: cartItem.storeName,
        rate: cartItem.rate,
        mrp: cartItem.mrp
      }],
      success: true,
      manualReview: !autoAddToCart
    });

    // 9. Broadcast real-time order update event to UI
    try {
      eventService.broadcast('order_updated', { at: Date.now(), id: specialOrderId });
    } catch (_) {}

    console.log(`[Intent Service] Confirmed procurement flow complete for order #${specialOrderId} (${cartItem.productName} x ${cartItem.qty}). Owner notified, customer message staged for manual send.`);
  } catch (procErr) {
    console.error('[Intent Service] Error in executeConfirmedProcurementFlow:', procErr);
  }
}

/**
 * Handle customer clarification responses: options selection (1, 2, 3), quantity adjustment,
 * or affirmative/negative final confirmation.
 */
async function checkMedicineClarificationResponse(phone: string, body: string, customer: any, chatId?: string): Promise<boolean> {
  let cleanDigits = (phone || '').replace(/\D/g, '').slice(-10);
  try {
    const db = await dbManager.getConnection();
    await ensureClarificationsTable(db);

    if ((!cleanDigits || cleanDigits.length < 10) && chatId) {
      const chatRow = await db.get('SELECT resolved_number FROM whatsapp_chats WHERE id = ?', [chatId]);
      if (chatRow?.resolved_number) {
        cleanDigits = chatRow.resolved_number.replace(/\D/g, '').slice(-10);
      }
    }
    if (!cleanDigits) return false;

    const pending = await db.get(
      `SELECT phone, suggested_name, original_query, options_json, selected_option, quantity, unit, step, items_json, special_order_id, so_code 
       FROM wa_pending_clarifications 
       WHERE (phone LIKE ? OR phone LIKE ? OR phone = ?) 
         AND (
           (step IN ('awaiting_owner_selection', 'awaiting_payment', 'awaiting_owner_payment_confirmation') AND created_at > datetime('now', '-24 hours'))
           OR created_at > datetime('now', '-45 minutes')
         )
       ORDER BY created_at DESC LIMIT 1`,
      [`%${cleanDigits}`, `%${cleanDigits}%`, cleanDigits]
    );
    if (!pending) return false;

    const lower = body.toLowerCase().trim();
    const isAffirmative = isRefillConfirmationResponse(body) || /^(yes|haan|ha|ho|yep|yup|y|sahi|correct|wahi|bhej do|ok|okay|confirm)$/i.test(lower);
    const isNegative = /^(no|nahi|nako|wrong|galat|cancel|n)$/i.test(lower);

    // Passive/waiting states: customer sends text while waiting for owner action
    if (pending.step === 'awaiting_owner_selection') {
      const waitMsg = `Your request for *${pending.suggested_name}* × ${pending.quantity || 1} has been forwarded to our pharmacy owner for distributor confirmation.\n\nWe will send you payment details shortly.`;
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_inquiry_confirmed', customer?.name || 'Customer');
      return true;
    }

    if (pending.step === 'awaiting_payment') {
      const waitMsg = `Please pay the ₹50 booking amount using the QR code sent earlier, and reply with the payment screenshot to proceed with your order (Ref: ${pending.so_code || 'SO'}).`;
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_inquiry_confirmed', customer?.name || 'Customer');
      return true;
    }

    if (pending.step === 'awaiting_owner_payment_confirmation') {
      const waitMsg = `Your payment screenshot is being verified by our pharmacy team. You will receive final confirmation shortly!`;
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_inquiry_confirmed', customer?.name || 'Customer');
      return true;
    }

    // Step: awaiting_medicine (Customer was greeted, now sends medicine name)
    if (pending.step === 'awaiting_medicine') {
      const medQuery = body.trim();
      if (medQuery.length < 2) {
        const msg = `Please enter the medicine name you need.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, msg, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }

      let localMatches: string[] = [];
      try {
        const filterResult = await productNameFilterService.filterProductNames(medQuery, { minConfidenceThreshold: 0.5 });
        localMatches = filterResult?.matches || [];
      } catch (_) {}

      let catalogMatches: string[] = [];
      try {
        const pharmaQuery = sanitizePharmarackQuery(medQuery);
        const cat = await searchCatalog(pharmaQuery || medQuery);
        catalogMatches = [
          ...(cat.mapped || []).map((m: any) => m.name || m.productName),
          ...(cat.nonMapped || []).map((m: any) => m.name || m.productName)
        ].filter(Boolean);
      } catch (_) {}

      const combined = [...localMatches, ...catalogMatches];
      const seenNorm = new Set<string>();
      const options: string[] = [];

      for (const rawName of combined) {
        const norm = rawName.toUpperCase().replace(/\s+/g, ' ').trim();
        const simpleKey = norm.replace(/[^A-Z0-9]/g, '');
        if (!seenNorm.has(simpleKey) && simpleKey.length > 2) {
          seenNorm.add(simpleKey);
          options.push(norm);
          if (options.length >= 5) break;
        }
      }

      if (options.length === 0) {
        const notFoundMsg = `I could not find a medicine matching "${medQuery}". Please check the spelling or send a clear photo of your prescription / medicine strip.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, notFoundMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }

      if (options.length === 1) {
        const singleMedicine = options[0];
        await db.run(
          `UPDATE wa_pending_clarifications
           SET suggested_name = ?, selected_option = ?, original_query = ?, options_json = NULL, step = 'awaiting_medicine_confirmation', created_at = CURRENT_TIMESTAMP
           WHERE phone = ?`,
          [singleMedicine, singleMedicine, medQuery, pending.phone]
        );
        const confirmPrompt = `💊 Medicine selected:\n*${singleMedicine}*\n\nIs this the medicine you need?\n\nReply *YES* to confirm or *NO* to search again.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, confirmPrompt, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }

      const formatNum = (n: number) => ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][n] || `${n + 1}️⃣`;
      const optionsList = options.map((opt, i) => `${formatNum(i)} ${opt}`).join('\n');
      const promptMsg = `🔎 I found these medicine options for *${medQuery}*:\n\n${optionsList}\n\nPlease reply with the number of the medicine you need.`;

      await db.run(
        `UPDATE wa_pending_clarifications
         SET suggested_name = ?, original_query = ?, options_json = ?, step = 'awaiting_selection', created_at = CURRENT_TIMESTAMP
         WHERE phone = ?`,
        [options[0], medQuery, JSON.stringify(options), pending.phone]
      );

      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, promptMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
      return true;
    }

    // Step: awaiting_selection (Customer sends number of the medicine option)
    if (pending.step === 'awaiting_selection' && pending.options_json) {
      let options: string[] = [];
      try {
        options = JSON.parse(pending.options_json);
      } catch (_) {
        options = [];
      }

      let chosenIndex = -1;
      const numMatch = lower.match(/^([1-5])\b/) || lower.match(/^(?:option\s*)?([1-5])/);
      if (numMatch) {
        const n = parseInt(numMatch[1], 10) - 1;
        if (n >= 0 && n < options.length) {
          chosenIndex = n;
        }
      } else {
        const idx = options.findIndex(opt => opt.toLowerCase().includes(lower) || lower.includes(opt.toLowerCase()));
        if (idx !== -1) {
          chosenIndex = idx;
        }
      }

      if (chosenIndex !== -1 && options[chosenIndex]) {
        const chosenMedicine = options[chosenIndex];
        await db.run(
          `UPDATE wa_pending_clarifications 
           SET suggested_name = ?, selected_option = ?, step = 'awaiting_medicine_confirmation', created_at = CURRENT_TIMESTAMP 
           WHERE phone = ?`,
          [chosenMedicine, chosenMedicine, pending.phone]
        );
        const confirmPrompt = `💊 Medicine selected:\n*${chosenMedicine}*\n\nIs this the medicine you need?\n\nReply *YES* to confirm or *NO* to search again.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, confirmPrompt, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }
    }

    // Step: awaiting_medicine_confirmation
    if (pending.step === 'awaiting_medicine_confirmation') {
      if (isNegative) {
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_medicine', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const restartMsg = `Understood! Please enter the medicine name you need.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, restartMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }

      if (isAffirmative) {
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_qty', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const qtyPrompt = `✅ Medicine confirmed: *${pending.suggested_name}*\n\n📦 Please enter the quantity you need.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, qtyPrompt, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }
    }

    // Step: awaiting_qty
    if (pending.step === 'awaiting_qty') {
      const parsedQty = extractQuantityFromText(body);
      const rawNumMatch = body.match(/\b(\d+)\b/);
      const finalQty = (parsedQty && parsedQty.quantity > 0) ? parsedQty.quantity : (rawNumMatch ? parseInt(rawNumMatch[1], 10) : 0);
      const finalUnit = (parsedQty && parsedQty.unit) ? parsedQty.unit : 'strip';

      if (finalQty > 0) {
        await db.run(
          `UPDATE wa_pending_clarifications 
           SET quantity = ?, unit = ?, step = 'awaiting_qty_confirmation', created_at = CURRENT_TIMESTAMP 
           WHERE phone = ?`,
          [finalQty, finalUnit, pending.phone]
        );
        const confirmPrompt = `Please confirm your request:\n\n💊 Medicine: *${pending.suggested_name}*\n📦 Quantity: ${finalQty} ${finalUnit}\n\nReply *YES* to confirm.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, confirmPrompt, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      } else {
        const retryMsg = `Please enter a valid quantity number (e.g. 1, 2, 5).`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, retryMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }
    }

    // Step: awaiting_qty_confirmation
    if (pending.step === 'awaiting_qty_confirmation' || pending.step === 'awaiting_confirmation') {
      if (isNegative) {
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_qty', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const retryQtyMsg = `Understood! How many strips or units do you need?`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, retryQtyMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }

      // Quantity adjustment during confirmation (e.g. "Actually make it 3")
      const adjustedQty = extractQuantityFromText(body);
      if (adjustedQty && adjustedQty.quantity > 0 && !isAffirmative) {
        await db.run(
          `UPDATE wa_pending_clarifications 
           SET quantity = ?, unit = ?, step = 'awaiting_qty_confirmation', created_at = CURRENT_TIMESTAMP 
           WHERE phone = ?`,
          [adjustedQty.quantity, adjustedQty.unit || 'strip', pending.phone]
        );
        const confirmPrompt = `Updated:\n💊 Medicine: *${pending.suggested_name}*\n📦 Quantity: ${adjustedQty.quantity} ${adjustedQty.unit || 'strip'}\n\nReply *YES* to confirm.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, confirmPrompt, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }

      if (isAffirmative) {
        // Multi-item bundle compatibility
        let bundle: Array<{ matchedName: string; quantity: number; unit: string }> = [];
        if (pending.items_json) {
          try {
            bundle = JSON.parse(pending.items_json);
          } catch (_) {}
        }
        if (bundle && bundle.length > 1) {
          await db.run(`DELETE FROM wa_pending_clarifications WHERE phone = ?`, [pending.phone]);
          for (const item of bundle) {
            await executeConfirmedProcurementFlow({
              phone,
              chatId,
              confirmedMedicine: item.matchedName,
              quantity: item.quantity || 1,
              unit: item.unit || 'strip',
              customer,
              isBundle: true
            });
          }
          return true;
        }

        // Single confirmed medicine flow (Spec §7, §8, §9)
        const medName = pending.suggested_name;
        const medQty = pending.quantity || 1;
        const medUnit = pending.unit || 'strip';

        // Search Pharmarack for the confirmed medicine
        const pharmaQuery = sanitizePharmarackQuery(medName);
        let rawPharmarackItems: any[] = [];
        try {
          const { performPharmarackSearch } = await import('../routes/pharmarack.js');
          const searchRes = await performPharmarackSearch(pharmaQuery || medName, null, true);
          if (searchRes && searchRes.status === 'ok' && Array.isArray(searchRes.items)) {
            rawPharmarackItems = searchRes.items;
          }
        } catch (_) {}

        if (rawPharmarackItems.length === 0) {
          try {
            const cat = await searchCatalog(pharmaQuery || medName);
            rawPharmarackItems = [...(cat.mapped || []), ...(cat.nonMapped || [])];
          } catch (_) {}
        }

        // Filter out all out-of-stock items
        const inStockCandidates = rawPharmarackItems.filter(p => isItemInStock(p.availability ?? (p as any).stock));

        // Create Special Order
        const todayStr = new Date().toISOString().split('T')[0];
        const orderRes = await db.run(
          `INSERT INTO special_orders (
             store_id, requester, phone, medicine_name, product, qty, priority, status,
             date, notified, customer_order_source, total_amount, advance_payment, payment_status
           ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Pending', ?, 0, 'whatsapp', 50, 50, 'UNPAID')`,
          [
            1,
            customer?.name || 'WhatsApp Customer',
            cleanDigits,
            medName,
            medName,
            medQty,
            todayStr
          ]
        );
        const specialOrderId = Number(orderRes.lastID) || 0;
        const soCode = `SO-${specialOrderId}`;

        // Link Special Order to pending clarification
        await db.run(
          `UPDATE wa_pending_clarifications
           SET step = 'awaiting_owner_selection', special_order_id = ?, so_code = ?, created_at = CURRENT_TIMESTAMP
           WHERE phone = ?`,
          [specialOrderId, soCode, pending.phone]
        );

        if (inStockCandidates.length > 0) {
          // Notify owner with in-stock results
          await waAdminEscalationService.notifyOwnerOfSpecialOrderPharmarackResults({
            specialOrderId,
            soCode,
            customerName: customer?.name || 'Customer',
            customerPhone: cleanDigits,
            medicineName: medName,
            quantity: medQty,
            unit: medUnit,
            pharmarackOptions: inStockCandidates.slice(0, 6)
          });

          // Courtesy message to customer
          const custWaitMsg = `Your request for *${medName}* × ${medQty} has been forwarded to our pharmacy owner for distributor confirmation.\n\nWe will send you payment details shortly.`;
          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(phone, custWaitMsg, 'customer_inquiry_confirmed', customer?.name || 'Customer');
        } else {
          // All checked distributors OOS
          const noStockMsg = `We checked our distributor network for *${medName}*, but it is currently out of stock with all suppliers.\n\nOur pharmacy owner has been notified (Ref: ${soCode}) to arrange it for you manually.`;
          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(phone, noStockMsg, 'customer_inquiry_confirmed', customer?.name || 'Customer');

          const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db);
          if (adminWhatsapp) {
            const ownerOosMsg = `⚠️ *Special Order ${soCode} (All Distributors OOS)*\n\nCustomer: ${customer?.name || 'Customer'} (+91 ${cleanDigits})\nMedicine: *${medName}* × ${medQty}\nAll checked Pharmarack distributors are currently out of stock.`;
            await whatsappQueueWorker.enqueue(adminWhatsapp, ownerOosMsg, 'admin_escalation', 'Owner');
          }
        }

        console.log(`[Intent Service] Customer confirmed request for ${medName} x ${medQty}. Created order #${specialOrderId} (${soCode}). Owner notified.`);
        return true;
      }
    }

    // Negative answer fallback if in another step
    if (isNegative) {
      await db.run(`DELETE FROM wa_pending_clarifications WHERE phone = ?`, [pending.phone]);
      const ackMsg = `Understood! Please reply with the exact medicine name or send a clear photo of your prescription / medicine strip, and our pharmacist will check it for you.`;
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, ackMsg, 'customer_inquiry_rejected', customer?.name || 'Customer');
      console.log(`[Intent Service] Customer ${cleanDigits} cancelled pending clarification.`);
      return true;
    }

  } catch (err) {
    console.warn('[Intent Service] Error checking medicine clarification response:', err);
  }
  return false;
}

async function checkIsOwnerPhone(phone: string, db: any): Promise<boolean> {
  const cleanDigits = (phone || '').replace(/\D/g, '').slice(-10);
  if (!cleanDigits) return false;
  const adminPhone = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db) || '';
  const cleanAdmin = (adminPhone || '').replace(/\D/g, '').slice(-10);
  return Boolean(cleanAdmin && cleanAdmin === cleanDigits);
}

async function handleOwnerInteractiveReply(phone: string, body: string, db: any): Promise<boolean> {
  const cleanBody = body.trim().toUpperCase();

  // 1. Check for owner payment verification. Accepts "CONFIRM SO-10452" and common variants:
  // "CONFIRM PAYMENT SO-10452", "PAYMENT CONFIRMED SO-10452", "CONFIRMED SO-10452".
  const confirmPaymentMatch =
    cleanBody.match(/^CONFIRM(?:ED)?(?:\s+PAYMENT)?\s+(SO-\d+)$/i) ||
    cleanBody.match(/^PAYMENT\s+CONFIRM(?:ED)?\s+(SO-\d+)$/i);
  if (confirmPaymentMatch) {
    const soCode = confirmPaymentMatch[1].toUpperCase();
    const orderId = parseInt(soCode.replace(/\D/g, ''), 10);
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);

    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');

    if (!order) {
      await whatsappQueueWorker.enqueue(phone, `⚠️ Special Order #${soCode} not found.`, 'admin_escalation', 'Owner');
      return true;
    }

    if (order.payment_status !== 'SCREENSHOT_RECEIVED') {
      await whatsappQueueWorker.enqueue(
        phone,
        `⚠️ Special Order #${soCode} is not awaiting payment verification (Current status: ${order.payment_status || 'UNPAID'}).`,
        'admin_escalation',
        'Owner'
      );
      return true;
    }

    // Update Special Order to CONFIRMED & VERIFIED
    await db.run(
      `UPDATE special_orders SET
         payment_status = 'VERIFIED',
         status = 'Confirmed',
         pharmacy_verification_status = 'PENDING',
         updated_at = datetime('now')
       WHERE id = ?`,
      [orderId]
    );

    // Insert into online_order_items so it displays in Live Cart queue (/api/website/live-cart)
    try {
      await db.run(
        `INSERT INTO online_order_items (
           order_id, product_name, product_name_snapshot, requested_qty, confirmed_qty, mrp, final_price, subtotal, item_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED')`,
        [
          orderId,
          order.medicine_name || order.product,
          order.medicine_name || order.product,
          order.qty || 1,
          order.qty || 1,
          order.pharmarack_mrp || 0,
          order.pharmarack_rate || 0,
          (order.qty || 1) * (order.pharmarack_rate || 0)
        ]
      );
    } catch (ooiErr) {
      console.warn('[Intent Service] Non-fatal online_order_items insert note:', ooiErr);
    }

    // Add item to Pharmarack Live Cart
    const cartItem = {
      productName: order.medicine_name || order.product,
      product: order.medicine_name || order.product,
      productId: 0,
      productCode: '',
      storeId: 0,
      storeName: order.pharmarack_distributor || 'Standard Distributor',
      company: '',
      qty: order.qty > 0 ? order.qty : 1,
      rate: order.pharmarack_rate || 0,
      mrp: order.pharmarack_mrp || 0,
      packaging: '1 strip'
    };

    try {
      const { addItemsToPharmarackCart } = await import('../routes/pharmarack.js');
      await addItemsToPharmarackCart([cartItem]);
    } catch (cartErr) {
      console.warn('[Intent Service] Live Cart add attempt warning:', cartErr);
    }

    // Mark owner pending request fulfilled
    await db.run(
      `UPDATE wa_owner_pending_requests SET status = 'fulfilled' WHERE req_code = ?`,
      [soCode]
    );

    // Mark customer clarification completed
    await db.run(
      `UPDATE wa_pending_clarifications SET step = 'completed' WHERE special_order_id = ? OR so_code = ?`,
      [orderId, soCode]
    );

    // Broadcast SSE events for real-time UI refresh
    try {
      eventService.broadcast('order_updated', { at: Date.now(), id: orderId });
      eventService.broadcast('pharmarack_cart_changed', { at: Date.now() });
    } catch (_) {}

    // Stage final customer message (STRICTLY STAGED, NEVER AUTO-SENT - matches executeConfirmedProcurementFlow pattern)
    const custFinalMsg =
      `🎉 Your medicine request is confirmed!\n\n` +
      `🆔 Special Order ID: ${soCode}\n\n` +
      `💊 ${order.medicine_name || order.product}\n` +
      `📦 Quantity: ${order.qty}\n\n` +
      `💰 Booking Amount Paid: ₹50\n\n` +
      `🛒 Your medicine has been added to your Live Cart.`;

    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id)
       VALUES (?, ?, ?, ?, 'staged', 1, ?)`,
      ['whatsapp_order', order.requester || 'Customer', String(order.phone || '').replace(/\D/g, '').slice(-10), custFinalMsg, String(orderId)]
    );

    // Notify Store Owner on WhatsApp via waAdminEscalationService (automatic; customer message stays staged)
    await waAdminEscalationService.notifyAdminOfLiveCartAdd({
      orderId: soCode,
      customer: { name: order.requester, phone: order.phone },
      phone: order.phone,
      items: [{
        name: order.medicine_name || order.product,
        quantity: order.qty,
        distributor: order.pharmarack_distributor || 'Standard Distributor',
        rate: order.pharmarack_rate,
        mrp: order.pharmarack_mrp
      }],
      success: true
    });

    // Ack to owner (owner-facing, allowed to stay automatic)
    const ownerFinalAck = `✅ Payment verified for Special Order #${soCode}!\n\nAdded *${order.medicine_name || order.product}* × ${order.qty} to Live Cart.\nCustomer *${order.requester || 'Customer'}* message has been staged and is awaiting manual send in Quick Assist.`;
    await whatsappQueueWorker.enqueue(phone, ownerFinalAck, 'admin_escalation', 'Owner');

    console.log(`[Intent Service] Owner verified payment for order #${orderId} (${soCode}). Added to Live Cart.`);
    return true;
  }

  // 2. Check for owner selecting distributor for special order: "SO-10452 2", "SO-10452-2", or single digit "1".."6"
  const soSupplierMatch = cleanBody.match(/^(SO-\d+)(?:\s+|-)([1-6])$/i);
  const singleDigitMatch = cleanBody.match(/^([1-6])$/);

  let soCode: string | null = null;
  let chosenOptionIdx = -1;
  let targetRow: any = null;

  if (soSupplierMatch) {
    soCode = soSupplierMatch[1].toUpperCase();
    chosenOptionIdx = parseInt(soSupplierMatch[2], 10) - 1;
    await waAdminEscalationService.ensureOwnerPendingRequestsTable?.(db);
    targetRow = await db.get(
      `SELECT * FROM wa_owner_pending_requests WHERE req_code = ? AND status = 'pending'`,
      [soCode]
    );
  } else if (singleDigitMatch) {
    await waAdminEscalationService.ensureOwnerPendingRequestsTable?.(db);
    const latest = await db.get(
      `SELECT * FROM wa_owner_pending_requests WHERE status = 'pending' ORDER BY id DESC LIMIT 1`
    );
    if (latest && String(latest.req_code).startsWith('SO-')) {
      soCode = latest.req_code;
      chosenOptionIdx = parseInt(singleDigitMatch[1], 10) - 1;
      targetRow = latest;
    }
  }

  if (targetRow && soCode && chosenOptionIdx >= 0) {
    const orderId = parseInt(soCode.replace(/\D/g, ''), 10);
    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');

    let options: any[] = [];
    try {
      options = JSON.parse(targetRow.options_json || '[]');
    } catch (_) {}

    const selectedDist = options[chosenOptionIdx];
    if (!selectedDist) {
      await whatsappQueueWorker.enqueue(
        phone,
        `⚠️ Option ${chosenOptionIdx + 1} not found for Special Order #${soCode}. Available options: 1 to ${options.length}.`,
        'admin_escalation',
        'Owner'
      );
      return true;
    }

    const distName = selectedDist.distributor || selectedDist.supplier_name || selectedDist.storeName || selectedDist.distributor_name || 'Standard Distributor';
    const distRate = Number(selectedDist.distributorPrice ?? selectedDist.ptr ?? selectedDist.PTR ?? selectedDist.rate ?? 0);
    const distMrp = Number(selectedDist.mrp ?? selectedDist.MRP ?? 0);

    // Update special order with selected distributor details and status
    await db.run(
      `UPDATE special_orders SET
         pharmarack_distributor = ?,
         pharmarack_rate = ?,
         pharmarack_mrp = ?,
         payment_status = 'AWAITING_PAYMENT',
         advance_payment = 50,
         total_amount = 50,
         updated_at = datetime('now')
       WHERE id = ?`,
      [distName, distRate, distMrp, orderId]
    );

    // Allocate alternating UPI QR config
    const activeQr = await paymentQrService.allocateNextQr();
    const upiUri = paymentQrService.buildUpiUri(activeQr.upi_id, activeQr.payee_name, 50, soCode);
    const qrBuffer = await paymentQrService.generateQrBuffer(upiUri);

    await db.run(
      `UPDATE special_orders SET payment_qr_id = ? WHERE id = ?`,
      [activeQr.id, orderId]
    );

    // Update customer conversation state to awaiting_payment
    await db.run(
      `UPDATE wa_pending_clarifications
       SET step = 'awaiting_payment', special_order_id = ?, so_code = ?, created_at = CURRENT_TIMESTAMP
       WHERE phone = ? OR phone LIKE ?`,
      [orderId, soCode, targetRow.customer_phone, `%${targetRow.customer_phone.slice(-10)}`]
    );

    // Send customer message with ₹50 UPI QR (Spec §11)
    const custQrMsg =
      `✅ Medicine & supplier confirmed\n\n` +
      `🆔 *Special Order*: ${soCode}\n\n` +
      `💊 *Medicine*: ${targetRow.medicine_name}\n` +
      `📦 *Quantity*: ${targetRow.quantity}\n\n` +
      `🔐 *Booking Amount*: ₹50\n\n` +
      `Please pay the ₹50 booking amount using the QR code below.\n\n` +
      `After payment, please send the payment screenshot in this chat.`;

    await whatsappQueueWorker.enqueue(
      targetRow.customer_phone,
      custQrMsg,
      'customer_payment_qr',
      targetRow.customer_name || 'Customer',
      undefined,
      undefined,
      {
        mimetype: 'image/png',
        data: qrBuffer.toString('base64'),
        filename: 'booking_qr.png'
      }
    );

    // Send ack to owner
    const ownerAck =
      `✅ *Supplier Confirmed for ${soCode}*\n\n` +
      `Selected: *${distName}* (PTR ₹${distRate.toFixed(2)})\n` +
      `₹50 booking payment QR code sent to customer *${targetRow.customer_name}* (+91 ${targetRow.customer_phone.slice(-10)}).\n` +
      `Awaiting customer payment screenshot.`;
    await whatsappQueueWorker.enqueue(phone, ownerAck, 'admin_escalation', 'Owner');

    console.log(`[Intent Service] Owner selected supplier #${chosenOptionIdx + 1} (${distName}) for ${soCode}. Sent ₹50 QR to customer.`);
    return true;
  }

  // 3. Backward compatibility for legacy REQ-XXX-X format
  const reqCodeMatch = cleanBody.match(/^(REQ-\d+)-([1-6])$/i);

  if (reqCodeMatch) {
    await waAdminEscalationService.ensureOwnerPendingRequestsTable?.(db);
    let targetRow: any = null;
    let chosenOptionIdx = -1;

    const reqCode = reqCodeMatch[1].toUpperCase();
    chosenOptionIdx = parseInt(reqCodeMatch[2], 10) - 1;
    targetRow = await db.get(
      `SELECT * FROM wa_owner_pending_requests WHERE req_code = ? AND status = 'pending'`,
      [reqCode]
    );

    if (targetRow && chosenOptionIdx >= 0) {
      let options: any[] = [];
      try {
        options = JSON.parse(targetRow.options_json || '[]');
      } catch (_) {}

      const selectedDist = options[chosenOptionIdx];
      if (selectedDist) {
        const cartItem = {
          productName: targetRow.medicine_name,
          product: targetRow.medicine_name,
          productId: selectedDist.productId || selectedDist.product_id || 0,
          productCode: selectedDist.productCode || selectedDist.product_code || '',
          storeId: Number(selectedDist.store_id || selectedDist.storeId || 0),
          storeName: selectedDist.distributor || selectedDist.supplier_name || selectedDist.storeName || 'Standard Distributor',
          company: selectedDist.manufacturer || selectedDist.company || '',
          qty: targetRow.quantity > 0 ? targetRow.quantity : 1,
          rate: selectedDist.distributorPrice ?? selectedDist.ptr ?? selectedDist.PTR ?? selectedDist.rate ?? 0,
          mrp: selectedDist.mrp ?? selectedDist.MRP ?? 0,
          packaging: selectedDist.packaging || targetRow.unit || '1 strip'
        };

        const { addItemsToPharmarackCart } = await import('../routes/pharmarack.js');
        await addItemsToPharmarackCart([cartItem]);

        const todayStr = new Date().toISOString().split('T')[0];
        const orderRes = await db.run(
          `INSERT INTO special_orders (
            store_id, requester, phone, medicine_name, product, qty, priority, status,
            date, notified, customer_order_source,
            pharmarack_distributor, pharmarack_rate, pharmarack_mrp
          ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Confirmed', ?, 0, 'whatsapp', ?, ?, ?)`,
          [
            1,
            targetRow.customer_name || 'WhatsApp Customer',
            targetRow.customer_phone,
            cartItem.productName,
            cartItem.productName,
            cartItem.qty,
            todayStr,
            cartItem.storeName,
            cartItem.rate,
            cartItem.mrp
          ]
        );
        const specialOrderId = orderRes.lastID;

        await db.run(
          `UPDATE wa_owner_pending_requests SET status = 'fulfilled' WHERE id = ?`,
          [targetRow.id]
        );

        const ownerAck = `✅ *Special Order #${targetRow.req_code} Processed!*\n\nAdded *${cartItem.productName}* × ${cartItem.qty} ${targetRow.unit}\nDistributor: *${cartItem.storeName}* (PTR ₹${cartItem.rate.toFixed(2)})\ndirectly into your *Pharmarack Live Cart*.\n\nCreated Special Order #${specialOrderId} for customer *${targetRow.customer_name}*.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, ownerAck, 'admin_escalation', 'Owner');
        return true;
      }
    }
  }

  return false;
}

/**
 * Main entry point: process an inbound WhatsApp message.
 * Called from whatsappClient.ts message_create handler.
 */
export async function handleInbound(msg: any): Promise<void> {
  try {
    let phone = msg.from || '';
    const chatId = msg.from || msg.to || '';
    const body = msg.body || '';
    const msgId = msg.id?._serialized || msg.id || '';
    const hasMedia = !!msg.hasMedia;
    const msgTimestamp = msg.timestamp ? Number(msg.timestamp) : null;
    const isStale = msgTimestamp ? (Math.floor(Date.now() / 1000) - msgTimestamp > 300) : false;

    // Resolve standard phone number if sender is an LID
    if (phone.endsWith('@lid')) {
      try {
        if (msg.client && typeof msg.client.getContactLidAndPhone === 'function') {
          const mapping = await msg.client.getContactLidAndPhone([phone]);
          if (mapping && mapping[0] && mapping[0].pn) {
            phone = `${mapping[0].pn}@c.us`;
          }
        }
        if (phone.endsWith('@lid') && typeof msg.getContact === 'function') {
          const contact = await msg.getContact();
          if (contact && contact.number) {
            phone = `${contact.number}@c.us`;
          }
        }
      } catch (e) {
        console.warn('[Intent Service] Non-fatal LID resolution skipped:', e);
      }
    }

    // 1. IGNORE CHECK
    if (await isIgnored(chatId)) return;

    const db = await dbManager.getConnection();

    // 1a. OWNER INTERACTIVE COMMAND CHECK
    const isOwner = await checkIsOwnerPhone(phone || chatId, db);
    if (isOwner) {
      const handled = await handleOwnerInteractiveReply(phone || chatId, body, db);
      if (handled) return;
    }

    // 1b. DISTRIBUTOR & INTERNAL CHECK
    if (await isDistributorOrInternal(phone || chatId, db)) {
      return;
    }

    // 1b. PROMOTIONAL & BROADCAST FILTER
    // Reject marketing schemes, B2B broadcasts, festive deals, groups, and spam before doing any work
    if (chatId.includes('g.us') || isPromotionalOrBroadcastMessage(body)) {
      console.log(`[Intent Service] Discarded promotional/group broadcast message from ${phone || chatId}: "${body.slice(0, 80).replace(/\r?\n/g, ' ')}..."`);
      return;
    }

    // 1c. NATURAL CONVERSATION SIGN-OFF DETECTION
    const cleanBodyForSignOff = body.trim().toLowerCase().replace(/[^\w\s]/g, '').trim();
    const isSignOff = /^(thanks|thank you|thank you so much|shukriya|dhanyawad|dhanyavad|ok|okay|ok done|okay done|done|bye|bye bye|good night|gn|ok bye|thx|tq|done ji|theek hai|accha theek hai)$/i.test(cleanBodyForSignOff);
    if (isSignOff) {
      await db.run(
        `UPDATE whatsapp_chats SET session_status = 'ended', manual_active_until = 0, session_mode = 'auto' WHERE id = ?`,
        [chatId]
      );
      eventService.broadcast('wa_session_updated', { chat_id: chatId, session_mode: 'auto', session_status: 'ended' });
      console.log(`[Intent Service] Natural sign-off ("${body.trim()}") from ${chatId}. Session marked as ended.`);
      return;
    }

    // 1d. HUMAN TAKEOVER / ACTIVE SESSION CHECK
    const chatSessionRow = await db.get(
      'SELECT session_mode, manual_active_until FROM whatsapp_chats WHERE id = ?',
      [chatId]
    );
    const nowMs = Date.now();
    const isManualSession = Boolean(
      chatSessionRow?.session_mode === 'manual' &&
      Number(chatSessionRow?.manual_active_until || 0) > nowMs
    );

    // Await startup cart synchronization window so existing cart items are loaded
    await startupSyncCoordinator.waitForCartSync();

    // 2. CUSTOMER LOOKUP
    const customer = await lookupCustomer(phone);
    const isNewCustomer = !customer;

    // 2b. REFILL CONFIRMATION CHECK — "refill", "yes", "confirm", "haan", "ho", "bhej do", etc.
    if (isRefillConfirmationResponse(body)) {
      const cleanDigits = (phone || '').replace(/\D/g, '').slice(-10);
      if (cleanDigits) {
        const db = await dbManager.getConnection();
        const pendingRefills = await db.all(
          `SELECT pr.id, pr.patient_name, pr.patient_phone, pr.medicine_id, m.name as medicine_name, pr.quantity_needed
           FROM patient_refills pr
           JOIN medicines m ON m.id = pr.medicine_id
           WHERE (pr.patient_phone LIKE ? OR pr.patient_phone LIKE ?)
             AND pr.is_active = 1
             AND pr.status NOT IN ('completed', 'canceled')
           ORDER BY pr.id DESC`,
          [`%${cleanDigits}`, `%${cleanDigits}%`]
        );

        if (pendingRefills && pendingRefills.length > 0) {
          const primaryRefill = pendingRefills[0];
          const refillIds = pendingRefills.map((r: any) => r.id);
          const placeholders = refillIds.map(() => '?').join(',');

          await db.run(
            `UPDATE patient_refills 
             SET patient_confirmed = 1, confirmed_at = datetime('now')
             WHERE id IN (${placeholders})`,
            refillIds
          );

          // P1 push event: updates Quick Assist and CRM without page reload
          eventService.broadcast('refill_updated', {
            at: Date.now(),
            confirmed_id: primaryRefill.id,
            confirmed_phone: cleanDigits,
            patient_phone: primaryRefill.patient_phone,
            patient_name: primaryRefill.patient_name,
            refill_count: pendingRefills.length
          });

          // Optional acknowledgement to patient via queue worker (suppressed in active manual takeover)
          if (!isManualSession) {
            try {
              const { getPharmacyOperatingSchedule, getStoreMedicalName, getStorePhone } = await import('./storeSettingsService.js');
              const sched = await getPharmacyOperatingSchedule(db);
              const storeName = await getStoreMedicalName(db);
              const storePhone = await getStorePhone(db);
              const phoneSuffix = storePhone ? `\n📞 ${storePhone}` : '';
              const medListText = pendingRefills.length === 1 
                ? `*${primaryRefill.medicine_name}*` 
                : pendingRefills.map((r: any) => `• ${r.medicine_name}`).join('\n');

              const ackMsg = `✅ *Refill Confirmed — ${storeName}*\n\n` +
                `Thank you ${primaryRefill.patient_name}! Your regular prescription for:\n${medListText}\nhas been confirmed.\n\n` +
                `🕒 *Store Hours:* ${sched.openTime} to ${sched.closeTime}\n` +
                `Our team will keep your medicines ready for collection.${phoneSuffix}`;

              const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
              await whatsappQueueWorker.enqueue(
                phone,
                ackMsg,
                'refill_reminder',
                primaryRefill.patient_name
              );
            } catch (ackErr) {
              console.warn('[Intent Service] Refill confirmation acknowledgment note:', ackErr);
            }
          }

          console.log(`[Intent Service] Patient ${primaryRefill.patient_name} confirmed ${pendingRefills.length} refill(s) via WhatsApp.`);
          return;
        }
      }
    }

    // 2c. INITIAL CUSTOMER GREETING & 6-STEP WORKFLOW EXPLANATION (Spec §3)
    // Treats ANY greeting as a fresh new session: resets old states and starts clean
    const cleanGreeting = body.trim().toLowerCase().replace(/[^\w\s]/g, '').trim();
    const isGreeting = /^(hi|hello|hey|hola|namaste|namaskar|pranam|ram ram|radhe radhe|good morning|gm|good afternoon|good evening|start|help|order)$/i.test(cleanGreeting);
    if (isGreeting && !hasMedia) {
      await ensureClarificationsTable(db);
      let cleanDigits = (phone || '').replace(/\D/g, '').slice(-10);
      if ((!cleanDigits || cleanDigits.length < 10) && chatId) {
        const chatRow = await db.get('SELECT resolved_number FROM whatsapp_chats WHERE id = ?', [chatId]);
        if (chatRow?.resolved_number) {
          cleanDigits = chatRow.resolved_number.replace(/\D/g, '').slice(-10);
        }
      }

      // Reset any manual session or idle session state on greeting
      await db.run(
        `UPDATE whatsapp_chats SET session_mode = 'auto', session_status = 'idle', manual_active_until = 0 WHERE id = ? OR (resolved_number IS NOT NULL AND resolved_number LIKE ?)`,
        [chatId, `%${cleanDigits}%`]
      );

      // Clear old pending clarifications so the session is 100% fresh
      await db.run(
        `DELETE FROM wa_pending_clarifications WHERE phone LIKE ? OR phone LIKE ?`,
        [`%${cleanDigits}`, `%${cleanDigits}%`]
      );

      const { getStoreMedicalName } = await import('./storeSettingsService.js');
      const storeName = (await getStoreMedicalName(db)) || 'AI Pharmacy';

      const greetingText =
        `👋 Hello! Welcome to ${storeName}.\n\n` +
        `I can help you place a medicine request through WhatsApp.\n\n` +
        `How it works:\n` +
        `1️⃣ Send the medicine name\n` +
        `2️⃣ Confirm the medicine\n` +
        `3️⃣ Enter the quantity\n` +
        `4️⃣ Confirm your request\n` +
        `5️⃣ Pay the ₹50 booking amount\n` +
        `6️⃣ Send the payment screenshot\n\n` +
        `After payment verification, your medicine will be added to your Live Cart.\n\n` +
        `Please enter the medicine name you need.`;

      await db.run(
        `INSERT INTO wa_pending_clarifications (phone, suggested_name, original_query, step, created_at)
         VALUES (?, '', ?, 'awaiting_medicine', CURRENT_TIMESTAMP)`,
        [cleanDigits, body]
      );

      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, greetingText, 'customer_greeting', customer?.name || 'Customer');
      console.log(`[Intent Service] Fresh greeting & 6-step workflow sent to ${cleanDigits}.`);
      return;
    }

    // 2d. MEDICINE CLARIFICATION CHECK ("yes", "haan", option numbers, quantities, etc.)
    if (await checkMedicineClarificationResponse(phone, body, customer, chatId)) {
      return;
    }

    // 3. TEXT PARSE
    const parsed = parseMessage(body);

    // 3b. SCISPACY NLP — run in parallel on the raw message body (fire-and-forget, 1.5s timeout)
    // This catches medicine names that regex/keyword parsing misses (e.g. "do you have azithromycin?")
    // EVERY chemical entity is collected — mixed messages may name several drugs.
    let scispacyNames: string[] = [];
    if (body.trim().length > 3) {
      try {
        const { queryScispacy } = await import('./scispacyClient.js');
        const nlp = await queryScispacy(body);
        if (nlp && nlp.entities) {
          for (const ent of nlp.entities) {
            if (ent.label === 'CHEMICAL' && isPlausibleMedicineName(ent.text)) {
              scispacyNames.push(ent.text);
            }
          }
          // Also check features.drug array
          if (scispacyNames.length === 0 && nlp.features?.drug?.length) {
            scispacyNames = nlp.features.drug.filter((c: string) => isPlausibleMedicineName(c));
          }
        }
      } catch {
        // fail silently — never block message handling
      }
    }

    // 4. REPEAT CHECK — "same", "wahi", etc.
    if (isRepeatRequest(body) && customer) {
      let history: any[] = [];
      try {
        history = await getCustomerHistory(customer);
      } catch (histErr) {
        console.warn('[Intent Service] Refill history lookup failed:', histErr);
      }
      if (history.length > 0) {
        eventService.broadcast('wa_medicine_match', {
          customer,
          isNewCustomer: false,
          medicineName: history[0].medicine_name,
          quantity: 1,
          unit: '',
          localMatches: history.map((h: any) => h.medicine_name),
          catalogResults: null,
          confidence: 95,
          isRepeat: true,
          source: 'text',
          messageBody: body,
          history
        });
        return;
      }
    }

    // 5. MEDIA CHECK — if has image, queue for OCR
    if (hasMedia) {
      // PRE-OCR PROMOTIONAL & GROUP FILTER: skip download and OCR if caption is promotional or group media
      if (chatId.includes('g.us') || isPromotionalOrBroadcastMessage(body)) {
        console.log(`[Intent Service] Pre-OCR filter: skipped promotional or group image from ${phone || chatId}`);
        return;
      }
      try {
        // Media decryption requires a READY client. Images arriving during the
        // boot session-restore window (T+45s+) or right after an idle-sleep
        // wake fail every early attempt — join the single-flight restore with
        // a bounded wait instead of burning the retry budget uselessly.
        const waClient = await import('../whatsappClient.js');
        const waStatus = await waClient.getWhatsAppStatus();
        if (!waStatus.isReady) {
          console.log(`[Intent Service] Image arrived before WhatsApp was ready (initializing=${waStatus.initializing}, sleeping=${waStatus.sleeping}) — waiting for session restore before download...`);
          await waClient.waitForWhatsAppReady(60_000);
        }
        // Late decryption keys are common for @lid chats / big photos — give
        // the download itself a wider bounded budget (3 × 1.5s) before the
        // deeper fallbacks below.
        const serializedId = typeof msg?.id?._serialized === 'string' ? msg.id._serialized : '';
        const downloadErrors: string[] = [];
        let media: { data?: string } | undefined;
        try {
          media = await downloadMediaWithRetry(() => msg.downloadMedia(), { maxAttempts: 3, delayMs: 1500 });
        } catch (primaryErr) {
          const pMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
          downloadErrors.push(`direct: ${pMsg}`);
          console.warn(`[Intent Service] Direct downloadMedia failed (${pMsg}) — hydrating chat store and retrying...`);
          // Step A: event objects on @lid chats often lack the chat's decrypt
          // roster until the chat itself is hydrated in the store.
          try { await msg.getChat?.(); } catch { /* hydration is best-effort */ }
          try {
            media = await downloadMediaWithRetry(() => msg.downloadMedia(), { maxAttempts: 2, delayMs: 1500 });
          } catch (hydrateErr) {
            const hMsg = hydrateErr instanceof Error ? hydrateErr.message : String(hydrateErr);
            downloadErrors.push(`hydrated: ${hMsg}`);
            // Step B (last resort): a FRESH instance re-hydrated from the
            // client store by id downloads even when the event object cannot.
            if (serializedId) {
              console.warn('[Intent Service] Hydrated retry failed — trying store-fresh getMessageById copy...');
              try {
                media = await waClient.downloadMessageMediaById(serializedId);
                if (!media?.data) downloadErrors.push('store-fresh: no data');
              } catch (freshErr) {
                downloadErrors.push(`store-fresh: ${freshErr instanceof Error ? freshErr.message : String(freshErr)}`);
              }
            }
          }
        }
        if (!media?.data) {
          throw new Error(downloadErrors.join(' | ') || 'downloadMedia returned no data');
        }
        if (media?.data) {
          const buffer = Buffer.from(media.data, 'base64');
          let imagePath: string | undefined;
          try {
            imagePath = await saveInboundMedia(msgId, buffer);
          } catch (saveErr) {
            console.error('[Intent Service] Failed to persist inbound media to disk:', saveErr);
          }

          // Check if this image is a payment screenshot for a pending Special Order (Spec §12)
          const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
          await ensureClarificationsTable(db);
          const pendingPayment = await db.get(
            `SELECT * FROM wa_pending_clarifications
             WHERE (phone LIKE ? OR phone LIKE ?) AND step = 'awaiting_payment'
             ORDER BY created_at DESC LIMIT 1`,
            [`%${cleanPhone}`, `%${cleanPhone}%`]
          );

          if (pendingPayment && pendingPayment.special_order_id && imagePath) {
            const soId = pendingPayment.special_order_id;
            const soCode = pendingPayment.so_code || `SO-${soId}`;

            await db.run(
              `UPDATE special_orders
               SET payment_screenshot_path = ?, screenshot_amount = 50, payment_status = 'SCREENSHOT_RECEIVED', updated_at = datetime('now')
               WHERE id = ?`,
              [imagePath, soId]
            );

            await db.run(
              `UPDATE wa_pending_clarifications
               SET step = 'awaiting_owner_payment_confirmation', created_at = CURRENT_TIMESTAMP
               WHERE phone = ?`,
              [pendingPayment.phone]
            );

            // Forward screenshot to Owner for verification (Spec §12)
            const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db);
            if (adminWhatsapp) {
              const forwardCaption =
                `💰 *Payment Verification Required*\n\n` +
                `🆔 *Special Order*: ${soCode}\n\n` +
                `👤 *Customer*: ${customer?.name || 'Customer'}\n` +
                `📱 +91 ${cleanPhone}\n\n` +
                `💊 *${pendingPayment.suggested_name}*\n` +
                `📦 *Quantity*: ${pendingPayment.quantity || 1}\n\n` +
                `💵 *Booking Amount*: ₹50\n\n` +
                `📸 *Customer Payment Screenshot Attached*\n\n` +
                `Please reply:\n` +
                `CONFIRM ${soCode}`;

              const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
              await whatsappQueueWorker.enqueue(
                adminWhatsapp,
                forwardCaption,
                'admin_escalation_image',
                'Admin / Store Owner',
                undefined,
                imagePath
              );
            }

            // Customer acknowledgment
            const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
            await whatsappQueueWorker.enqueue(
              phone,
              `📸 Payment screenshot received! Our pharmacy team is verifying the payment.\nYou will receive final confirmation shortly.`,
              'customer_payment_ack',
              customer?.name || 'Customer'
            );

            console.log(`[Intent Service] Customer ${cleanPhone} uploaded payment screenshot for Special Order ${soCode}. Forwarded to owner.`);
            return;
          }

          ocrScanQueue.enqueue(msgId, buffer, { phone, chatId, messageBody: body, imagePath });
          // OCR result will be handled by ocrScanComplete listener (registered below)
        }
      } catch (mediaErr) {
        console.error('[Intent Service] Failed to download media after retries:', mediaErr);
        const downloadDetail = mediaErr instanceof Error ? mediaErr.message : String(mediaErr);
        try {
          const db = await dbManager.getConnection();
          await waAdminEscalationService.notifyAdminOfUnprocessedMedia(db, {
            phone,
            chatId,
            reason: `Received an image from this customer but could not download it after repeated attempts (${downloadDetail.slice(0, 140)}).`
          });
        } catch (notifyErr) {
          console.error('[Intent Service] Failed to notify admin of media download failure:', notifyErr);
        }
      }
    }

    // 6. TEXT-BASED SEARCH — MULTI-CANDIDATE. Mixed conversational messages
    // ("bhai kal aa raha hu, dolo 650 aur telma 40 chahiye") must yield EVERY
    // medicine, not one joined garbage query. Candidates come from segment
    // parsing, then scispaCy entities the regex pass missed. Each candidate is
    // independently gated inside searchAndBroadcast (confidence + plausibility),
    // so chit-chat can still never become a false match.
    const seenCandidateNames = new Set<string>();
    const candidates: Array<{ name: string; quantity: number; unit: string; fromScispacy: boolean }> = [];
    const pushCandidate = (name: string | null | undefined, quantity?: number, unit?: string, fromScispacy = false) => {
      const clean = (name || '').trim();
      if (!clean || !isPlausibleMedicineName(clean)) return;
      const key = clean.toLowerCase().replace(/\s+/g, ' ');
      if (seenCandidateNames.has(key)) return;
      seenCandidateNames.add(key);
      candidates.push({ name: clean, quantity: quantity || 1, unit: unit || '', fromScispacy });
    };

    for (const c of extractMedicineCandidates(body)) {
      pushCandidate(c.medicineName, c.quantity, c.unit);
    }
    // Legacy single-parse fallback covers names segmenting would split apart
    // (e.g. a brand containing a conjunction word).
    if (candidates.length === 0 && parsed.isMedicineRequest && parsed.medicineName) {
      pushCandidate(parsed.medicineName, parsed.quantity, parsed.unit);
    }

    // scispaCy rescue — every chemical entity not already covered above.
    for (const chem of scispacyNames) {
      pushCandidate(chem, undefined, undefined, true);
    }

    if (candidates.length > 0) {
      const textForm = detectDosageForm(body);
      if (candidates.some(c => c.fromScispacy)) {
        console.log(`[Intent Service] scispaCy rescued medicine name(s): ${candidates.filter(c => c.fromScispacy).map(c => `"${c.name}"`).join(', ')} (regex missed them)`);
      }

      // If in active manual session, AI broadcasts events for UI suggestions but suppresses autonomous customer-facing replies
      const suppressAutoReply = isManualSession || candidates.length > 1;

      for (const cand of candidates) {
        await searchAndBroadcast({
          medicineName: cand.name,
          quantity: cand.quantity,
          unit: cand.unit,
          customer,
          isNewCustomer,
          messageBody: body,
          source: 'text',
          dosageForm: textForm || undefined,
          msgId,
          phone,
          chatId,
          hasIntentWords: parsed.rawIntentWords.length > 0 || cand.fromScispacy,
          isStale,
          suppressClarification: suppressAutoReply
        });
      }

      // If multiple candidates exist and not in manual session, send ONE consolidated confirmation bundle
      if (candidates.length > 1 && !isManualSession && !isStale && phone) {
        try {
          const toggle = await db.get('SELECT value FROM app_settings WHERE key = ?', ['wa_customer_clarification_enabled']);
          if (!toggle || toggle.value !== 'false') {
            const bundledItems: Array<{
              requestedName: string;
              matchedName: string;
              quantity: number;
              unit: string;
            }> = [];

            for (const cand of candidates) {
              let matched = cand.name;
              try {
                const res = await productNameFilterService.filterProductNames(cand.name, { minConfidenceThreshold: 0.6 });
                if (res?.matches?.[0]) matched = res.matches[0];
              } catch (_) {}
              bundledItems.push({
                requestedName: cand.name,
                matchedName: matched,
                quantity: cand.quantity || 1,
                unit: cand.unit || 'strip'
              });
            }

            const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
            await ensureClarificationsTable(db);
            await db.run(
              `INSERT INTO wa_pending_clarifications (
                 phone, suggested_name, original_query, options_json, quantity, unit, step, items_json, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, 'awaiting_confirmation', ?, CURRENT_TIMESTAMP)
               ON CONFLICT(phone) DO UPDATE SET
                 suggested_name = excluded.suggested_name,
                 original_query = excluded.original_query,
                 options_json = NULL,
                 quantity = excluded.quantity,
                 unit = excluded.unit,
                 step = 'awaiting_confirmation',
                 items_json = excluded.items_json,
                 created_at = CURRENT_TIMESTAMP`,
              [
                cleanPhone,
                bundledItems[0].matchedName,
                body,
                null,
                bundledItems[0].quantity,
                bundledItems[0].unit,
                JSON.stringify(bundledItems)
              ]
            );

            const itemListText = bundledItems.map((item, idx) => `${idx + 1}. *${item.matchedName}* × ${item.quantity} ${item.unit}`).join('\n');
            const promptMsg = `Please confirm your order for:\n${itemListText}\n\nReply *YES* to confirm or *NO* to cancel.`;
            const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
            await whatsappQueueWorker.enqueue(phone, promptMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
            console.log(`[Intent Service] Sent consolidated multi-item confirmation for ${bundledItems.length} medicines to ${cleanPhone}.`);
          }
        } catch (bundleErr) {
          console.warn('[Intent Service] Consolidated multi-item confirmation failed:', bundleErr);
        }
      }
    } else if (!hasMedia && !isStale && phone && !isManualSession) {
      const cleanBody = body.trim();
      if (cleanBody.length >= 2) {
        await maybeSendGuidancePrompt(phone, customer?.name || 'Customer', db);
      }
    }

  } catch (err) {
    console.error('[Intent Service] Error handling inbound message:', err);
  }
}

/**
 * Resolve REAL active inventory stock for matched master names — a name in the
 * medicines master table (291k imported reference rows) does NOT mean the strip
 * is on the shelf. ONE batched indexed query per message; missing rows simply
 * stay absent from the map. Exported for unit testing.
 */
export async function resolveInventoryStock(
  matchNames: string[],
  db: any
): Promise<Record<string, number>> {
  const stock: Record<string, number> = {};
  const names = [...new Set(matchNames.map(n => String(n).trim()).filter(Boolean))].slice(0, 10);
  if (names.length === 0) return stock;
  try {
    const placeholders = names.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT m.name,
              COALESCE(SUM(CASE WHEN im.is_active = 1
                           THEN (im.quantity + COALESCE(im.loose_quantity, 0))
                           ELSE 0 END), 0) AS total_stock
       FROM medicines m
       LEFT JOIN inventory_master im ON im.medicine_id = m.id
       WHERE LOWER(m.name) IN (${placeholders})
       GROUP BY m.id`,
      names.map(n => n.toLowerCase())
    );
    for (const row of rows || []) {
      if (row?.name) stock[String(row.name).toLowerCase()] = Number(row.total_stock) || 0;
    }
  } catch (err) {
    console.warn('[Intent Service] Inventory stock lookup failed:', err);
  }
  return stock;
}

type Availability = 'IN_STOCK' | 'REGISTERED_NO_STOCK' | 'EXTERNAL_ONLY';

/**
 * Classify where a requested medicine actually lives:
 * IN_STOCK = master match AND active shelf stock; REGISTERED_NO_STOCK =
 * master name only (must order); EXTERNAL_ONLY = found via image/catalog.
 * Exported for unit testing.
 */
export function classifyAvailability(localMatches: string[], inventoryStock: Record<string, number>): Availability {
  if (localMatches.length === 0) return 'EXTERNAL_ONLY';
  const bestStock = Math.max(0, ...localMatches.map(m => inventoryStock[String(m).toLowerCase()] ?? 0));
  return bestStock > 0 ? 'IN_STOCK' : 'REGISTERED_NO_STOCK';
}

/**
 * Search local DB + catalog + Pharmarack for a medicine name and broadcast result to admin.
 */
async function searchAndBroadcast(opts: {
  medicineName: string;
  quantity: number;
  unit: string;
  customer: { id: number; name: string; phone: string } | null;
  isNewCustomer: boolean;
  messageBody: string;
  source: 'text' | 'ocr' | 'both';
  dosageForm?: string;
  mrp?: number;
  msgId?: string;
  phone?: string;
  chatId?: string;
  hasIntentWords?: boolean;
  imagePath?: string;
  // One-photo-one-result (owner rule): extra medicines seen on the shared
  // strip / caption, already resolved LOCAL-ONLY by resolveRelatedMedicinesLocal.
  // They ride along on the primary card + owner message — zero extra network.
  relatedMedicines?: Array<{ name: string; registered: boolean; inventoryStock: number }>;
  isStale?: boolean;
  suppressClarification?: boolean;
}): Promise<void> {
  const { medicineName, quantity, unit, customer, isNewCustomer, messageBody, source, dosageForm, mrp, msgId, phone, chatId, imagePath } = opts;
  const hasIntentWords = !!opts.hasIntentWords;

  // Search local medicines DB (FTS5 + fuzzy match)
  let filterResult;
  try {
    filterResult = await productNameFilterService.filterProductNames(medicineName, {
      minConfidenceThreshold: 0.6,
      dosageForm,
      mrp
    });
  } catch (err) {
    console.error('[Intent Service] Filter service failed:', err);
    filterResult = { matches: [], sources: { local: false, internet: false, catalog: false }, confidence: 0, fallbackUsed: false, processingTimeMs: 0, scoredMatches: [], topScore: 0 };
  }

  // REAL STOCK CHECK — a medicines-master match is not shelf presence.
  // Distinguish IN_STOCK (sellable now) from REGISTERED_NO_STOCK (must order)
  // so neither admin nor customer is ever told "available" wrongly.
  let inventoryStock: Record<string, number> = {};
  try {
    const db = await dbManager.getConnection();
    inventoryStock = await resolveInventoryStock(filterResult.matches, db);
  } catch (dbErr) {
    console.warn('[Intent Service] Inventory stock resolution failed:', dbErr);
  }
  const availability: Availability = classifyAvailability(filterResult.matches, inventoryStock);
  const isExactLocal = (filterResult.topScore ?? 0) >= 0.95;

  // NON-ALLOPATHIC SKIP (owner rule): cosmetic / ayurvedic / homeopathy
  // products must not burn the Pharmarack catalog or live search budget. The
  // request is still broadcast to the admin feed truthfully labeled
  // NON_ALLOPATHIC with its kind; no escalation / shortage tracking fires.
  // Only an EXACT registered local name that is physically IN STOCK takes the
  // normal flow, so a sellable shelf item is never hidden by the label.
  const nonAllopathicKind = detectNonAllopathicKind(medicineName);
  if (nonAllopathicKind && !(isExactLocal && availability === 'IN_STOCK')) {
    console.log(`[Intent Service] Non-allopathic (${nonAllopathicKind}) product "${medicineName}" — external searches skipped`);
    eventService.broadcast('wa_medicine_match', {
      customer,
      isNewCustomer,
      medicineName,
      quantity,
      unit,
      dosageForm,
      localMatches: filterResult.matches,
      inventoryStock,
      availability: 'NON_ALLOPATHIC',
      productKind: nonAllopathicKind,
      catalogResults: null,
      confidence: Math.round((filterResult.topScore ?? 0) * 100),
      source,
      messageBody,
      mediaId: msgId || null,
      relatedMedicines: opts.relatedMedicines || [],
    });
    // Owner still gets a short one-line note (owner decision) so every
    // request is visible on WhatsApp — without any Pharmarack spend.
    waAdminEscalationService.notifyAdminOfNonAllopathic({
      customer,
      medicineName,
      productKind: nonAllopathicKind,
      quantity,
      unit,
      messageBody,
      source,
      msgId,
      phone,
      chatId,
      imagePath,
    }).catch(err => console.error('[Intent Service] Non-allopathic admin note failed:', err));
    return;
  }

  // 2-3 word sanitized search query for Pharmarack (never full sentences/packaging/forms)
  const pharmaQuery = sanitizePharmarackQuery(medicineName);

  // ALWAYS search Pharmarack catalog cache (NEVER skip, even if in physical shelf stock)
  let catalogResults = filterResult.catalogResults || null;
  if (!catalogResults && pharmaQuery) {
    try {
      catalogResults = await searchCatalog(pharmaQuery, dosageForm, mrp);
    } catch (catErr) {
      console.warn('[Intent Service] Catalog search failed:', catErr);
    }
  }

  const catalogTopScore = () => Math.max(
    catalogResults?.mapped?.[0]?.score ?? 0,
    catalogResults?.nonMapped?.[0]?.score ?? 0
  );

  // Live Pharmarack search — ALWAYS query distributor network using sanitized 2-3 word term
  let livePharmarackResults: any[] | null = null;
  const isPlausible = isPlausibleMedicineName(pharmaQuery || medicineName);
  if (pharmaQuery && (hasIntentWords || source !== 'text' || isPlausible)) {
    try {
      const { performPharmarackSearch } = await import('../routes/pharmarack.js');
      const searchTerms = [pharmaQuery];
      if (filterResult.matches[0]) {
        const cleanMatched = sanitizePharmarackQuery(filterResult.matches[0]);
        if (cleanMatched && cleanMatched.toLowerCase() !== pharmaQuery.toLowerCase() && !searchTerms.includes(cleanMatched)) {
          searchTerms.unshift(cleanMatched);
        }
      }

      for (const term of searchTerms) {
        const searchRes = await performPharmarackSearch(term, null, true);
        if (searchRes && searchRes.status === 'ok' && Array.isArray(searchRes.items) && searchRes.items.length > 0) {
          const scored = searchRes.items
            .map((p: any) => ({
              ...p,
              productName: p.name,
              supplier_name: p.distributor,
              distributor_name: p.distributor,
              distributorPrice: p.rate,
              availability: p.stock,
              score: scoreProductName(pharmaQuery, p.name || '')
            }))
            .filter((p: any) => p.score >= 0.50)
            .sort((a: any, b: any) => b.score - a.score);

          if (scored.length > 0) {
            livePharmarackResults = scored;
            catalogResults = {
              mapped: scored.filter((p: any) => p.mapped),
              nonMapped: scored.filter((p: any) => !p.mapped)
            };
            break;
          }
        }
      }
    } catch (liveErr) {
      console.warn('[Intent Service] Live performPharmarackSearch failed:', liveErr);
    }
  }

  // CONFIDENCE GATE — best similarity across local + catalog must clear the
  // threshold, otherwise the message is chit-chat and is silently discarded.
  const hasConfirmedCatalog = (catalogResults?.mapped?.length || 0) > 0 || (catalogResults?.nonMapped?.length || 0) > 0;
  const hasConfirmedMatch = filterResult.matches.length > 0 || hasConfirmedCatalog;
  const bestScore = Math.max(filterResult.topScore ?? 0, catalogTopScore());
  if (!passesGate(bestScore, hasIntentWords, source, hasConfirmedMatch)) {
    console.log(`[Intent Service] Gate: discarding "${medicineName}" (bestScore=${bestScore.toFixed(2)}, intent=${hasIntentWords}, source=${source}). Not a medicine.`);
    // Forward the actual photo to the pharmacy when the app is unsure — an
    // image with real OCR text that still can't clear the confidence gate
    // is exactly the "not sure" case, so a human should see it, not a log line.
    if (source !== 'text' && imagePath) {
      try {
        const db = await dbManager.getConnection();
        await waAdminEscalationService.notifyAdminOfUnprocessedMedia(db, {
          phone: phone || customer?.phone || '',
          chatId,
          imagePath,
          reason: `Found "${medicineName}" in this photo but the match confidence was too low to auto-identify (score ${Math.round(bestScore * 100)}%).`
        });
      } catch (notifyErr) {
        console.error('[Intent Service] Failed to notify admin of uncertain scan:', notifyErr);
      }
    } else if (source === 'text' && isPlausible) {
      // Unmatched inquiry alert: neither local DB nor Pharmarack returned any match for a plausible medicine name
      try {
        const db = await dbManager.getConnection();
        await waAdminEscalationService.notifyAdminOfUnmatchedQuery({
          customer,
          medicineName,
          quantity,
          unit,
          messageBody,
          source,
          msgId,
          phone,
          chatId,
          imagePath
        });

        const toggle = await db.get('SELECT value FROM app_settings WHERE key = ?', ['wa_customer_clarification_enabled']);
        if (!toggle || toggle.value !== 'false') {
          const { getStoreMedicalName } = await import('./storeSettingsService.js');
          const storeName = await getStoreMedicalName(db);
          const ackMsg = `Namaste! We received your inquiry for "${medicineName}" at ${storeName}. Our pharmacist is checking availability with our distributors and will message you shortly.`;
          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(phone || chatId || '', ackMsg, 'customer_inquiry_ack', customer?.name || 'Customer');
        }
      } catch (unmatchedErr) {
        console.warn('[Intent Service] Failed to notify admin/customer of unmatched inquiry:', unmatchedErr);
      }
    }
    return;
  }
  const confidence = Math.round(bestScore * 100);

  // Get customer history + context (old customers only) — must never break the flow
  let history: any[] = [];
  if (customer) {
    try {
      history = await getCustomerHistory(customer);
    } catch (histErr) {
      console.warn('[Intent Service] Refill history lookup failed:', histErr);
    }
  }
  let context: CustomerContext | undefined;
  try {
    context = await getCustomerContext(customer, chatId, msgId);
  } catch (ctxErr) {
    console.warn('[Intent Service] Customer context lookup failed:', ctxErr);
  }

  // Broadcast to admin UI
  eventService.broadcast('wa_medicine_match', {
    customer,
    isNewCustomer,
    medicineName,
    quantity,
    unit,
    dosageForm,
    localMatches: filterResult.matches,
    inventoryStock,
    availability,
    catalogResults,
    confidence,
    isRepeat: false,
    source,
    messageBody,
    history,
    livePharmarackResults,
    mediaId: msgId || null,
    relatedMedicines: opts.relatedMedicines || [],
    isStale: !!opts.isStale
  });

  // Persist permanently to SQLite wa_medicine_requests table
  try {
    const db = await dbManager.getConnection();
    const cleanPhoneDigits = (phone || '').replace(/\D/g, '').slice(-10);
    await db.run(
      `INSERT INTO wa_medicine_requests (
        customer_phone, customer_name, is_new_customer, medicine_name, quantity, dosage_form,
        local_matches, inventory_stock, availability, product_kind, confidence, source,
        message_body, pharma_hits, media_id, related_medicines, reply_sent, stale_skipped, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanPhoneDigits || phone || 'unknown',
        customer?.name || null,
        isNewCustomer ? 1 : 0,
        medicineName,
        quantity ? String(quantity) : null,
        dosageForm || null,
        JSON.stringify(filterResult.matches || []),
        JSON.stringify(inventoryStock || {}),
        availability || null,
        (opts as any).productKind || null,
        confidence || 0,
        source || 'text',
        messageBody || null,
        JSON.stringify(livePharmarackResults || catalogResults?.mapped || []),
        msgId || null,
        JSON.stringify(opts.relatedMedicines || []),
        opts.isStale ? 0 : 1,
        opts.isStale ? 1 : 0,
        'pending'
      ]
    );
  } catch (saveErr) {
    console.warn('[Intent Service] Failed to persist wa_medicine_request:', saveErr);
  }

  // Fire-and-forget escalation logic
  // Only escalate to admin via legacy shortage alert for non-text inquiries (e.g. OCR/prescriptions)
  if (source !== 'text') {
    waAdminEscalationService.maybeEscalate({
      customer,
      isNewCustomer,
      medicineName,
      quantity,
      unit,
      dosageForm,
      localMatches: filterResult.matches,
      inventoryStock,
      availability,
      catalogResults,
      confidence,
      isRepeat: false,
      source,
      messageBody,
      history,
      msgId,
      phone,
      chatId,
      context,
      relatedMedicines: opts.relatedMedicines,
      imagePath
    }).catch(err => console.error('[Intent Service] Admin escalation failed:', err));
  }

  // Customer clarification / confirmation prompt:
  // When medicine inquiry comes from text and we matched a product, clarify options or ask customer to confirm
  if (source === 'text' && phone && !opts.isStale && !opts.suppressClarification) {
    try {
      const db = await dbManager.getConnection();
      const toggle = await db.get('SELECT value FROM app_settings WHERE key = ?', ['wa_customer_clarification_enabled']);
      if (!toggle || toggle.value !== 'false') {
        const rawMatches = (filterResult.matches && filterResult.matches.length > 0)
          ? filterResult.matches
          : (catalogResults?.mapped || []).map((m: any) => m.productName || m.name).filter(Boolean);

        const seenNorm = new Set<string>();
        const deduplicated: string[] = [];
        for (const m of rawMatches) {
          const norm = String(m).toUpperCase().replace(/\s+/g, ' ').trim();
          const key = norm.replace(/[^A-Z0-9]/g, '');
          if (!seenNorm.has(key) && key.length > 2) {
            seenNorm.add(key);
            deduplicated.push(norm);
            if (deduplicated.length >= 5) break;
          }
        }

        const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
        await ensureClarificationsTable(db);

        if (deduplicated.length > 1) {
          // Present top options up to 5 with emoji numbers
          const formatNum = (n: number) => ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][n] || `${n + 1}️⃣`;
          const optionsList = deduplicated.map((opt, i) => `${formatNum(i)} *${opt}*`).join('\n');
          const promptMsg = `🔎 I found these medicine options for *${medicineName}*:\n\n${optionsList}\n\nPlease reply with the number of the medicine you need.`;

          await db.run(
            `INSERT INTO wa_pending_clarifications (phone, suggested_name, original_query, options_json, quantity, unit, step, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'awaiting_selection', CURRENT_TIMESTAMP)
             ON CONFLICT(phone) DO UPDATE SET
               suggested_name = excluded.suggested_name,
               original_query = excluded.original_query,
               options_json = excluded.options_json,
               selected_option = NULL,
               quantity = excluded.quantity,
               unit = excluded.unit,
               step = 'awaiting_selection',
               created_at = CURRENT_TIMESTAMP`,
            [cleanPhone, deduplicated[0], medicineName, JSON.stringify(deduplicated), quantity || 1, unit || 'strip']
          );

          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(phone, promptMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
          console.log(`[Intent Service] Sent medicine options prompt (1..${deduplicated.length}) for "${medicineName}" to ${cleanPhone}.`);
        } else if (deduplicated.length === 1 || filterResult.matches[0]) {
          const topMatched = deduplicated[0] || filterResult.matches[0];
          const promptMsg = `💊 I found *${topMatched}*.\nIs this the medicine you want?\n\nReply *YES* to confirm or *NO* to cancel.`;
          await db.run(
            `INSERT INTO wa_pending_clarifications (phone, suggested_name, original_query, options_json, quantity, unit, step, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'awaiting_medicine_confirmation', CURRENT_TIMESTAMP)
             ON CONFLICT(phone) DO UPDATE SET
               suggested_name = excluded.suggested_name,
               original_query = excluded.original_query,
               options_json = NULL,
               selected_option = excluded.suggested_name,
               quantity = excluded.quantity,
               unit = excluded.unit,
               step = 'awaiting_medicine_confirmation',
               created_at = CURRENT_TIMESTAMP`,
            [cleanPhone, topMatched, medicineName, null, quantity || 1, unit || 'strip']
          );
          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(phone, promptMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
          console.log(`[Intent Service] Sent medicine confirmation prompt for "${topMatched}" to ${cleanPhone}.`);
        }
      }
    } catch (clarifyErr) {
      console.warn('[Intent Service] Customer clarification prompt failed:', clarifyErr);
    }
  }

  // Track pending shortage request for >23 hour admin reminder if local stock
  // is missing — includes master-registered names with zero shelf stock.
  // CRITICAL GUARD: Only create a shortage request when there is genuine order intent
  // (or OCR scan), the item is a confirmed medicine with high confidence (>= 80%),
  // and the shelf stock is genuinely missing (REGISTERED_NO_STOCK or EXTERNAL_ONLY).
  // Low confidence, chit-chat, promotional text, or unconfirmed strings must NEVER create special_orders!
  const hasOrderIntent = hasIntentWords || source === 'ocr';
  const isConfirmedMedicine = filterResult.matches.length > 0 || (catalogResults?.mapped && catalogResults.mapped.length > 0);
  const isOutOfStock = availability === 'REGISTERED_NO_STOCK' || availability === 'EXTERNAL_ONLY';

  if (hasOrderIntent && isConfirmedMedicine && confidence >= 80 && isOutOfStock) {
    try {
      const { trackMedicineRequest } = await import('./shortageReminderService.js');
      const distName = catalogResults?.mapped?.[0]?.supplier_name || catalogResults?.nonMapped?.[0]?.distributor_name || 'Standard Distributor';
      // Use canonical confirmed medicine name, never raw informal/promotional input
      const canonicalName = filterResult.matches[0] || catalogResults?.mapped?.[0]?.productName || catalogResults?.mapped?.[0]?.name || medicineName;
      trackMedicineRequest({
        medicine_name: canonicalName,
        distributor_name: distName,
        quantity: quantity || 1,
        // Digits-only: chat-id style phones (@c.us/@lid suffixes) must never leak into
        // shortage requests — they get copied raw into special_orders.phone downstream.
        customer_phone: String(customer?.phone || phone || '').replace(/\D/g, ''),
        customer_name: customer?.name || '',
        source: 'whatsapp'
      }).catch(err => console.warn('[Intent Service] Shortage tracking failed:', err));
    } catch (trackErr) {
      console.warn('[Intent Service] Failed to import shortageReminderService:', trackErr);
    }
  }

  console.log(`[Intent Service] Match result for "${medicineName}": ${filterResult.matches.length} local, ${catalogResults?.mapped?.length || 0} mapped, ${catalogResults?.nonMapped?.length || 0} non-mapped (bestScore=${bestScore.toFixed(2)}, availability=${availability})`);
}

/**
 * Handle OCR scan completion — called when ocrScanQueue finishes processing an image.
 * Registered as an event listener in server.ts startup.
 */
export async function handleOcrComplete(data: any): Promise<void> {
  const { phone, chatId, messageBody, ocrResult, msgId, imagePath } = data;
  if (!ocrResult) return;

  // Drop marketing flyers or promotional broadcasts before running OCR matching
  if (isPromotionalOrBroadcastMessage(messageBody || '') || isPromotionalOrBroadcastMessage(ocrResult.text || '')) {
    console.log(`[Intent Service] OCR scan discarded promotional flyer from ${phone || chatId}`);
    return;
  }

  // ─── 0. Payment Confirmation Screenshot Detection (Human-in-the-Loop) ────────
  // If the sender has an active order waiting for payment verification, attach this
  // image as a payment screenshot, extract amount, and queue for staff manual review.
  try {
    const cleanDigits = String(phone || chatId || '').replace(/\D/g, '');
    const last10 = cleanDigits.slice(-10);
    if (last10.length >= 7) {
      const db = await dbManager.getConnection();
      const pendingOrder = await db.get(
        `SELECT id, total_amount, requester, phone, customer_id, payment_status, status
         FROM special_orders
         WHERE payment_status = 'PENDING_VERIFICATION'
           AND (phone IS NOT NULL AND REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?)
         ORDER BY id DESC
         LIMIT 1`,
        [`%${last10}`]
      );

      if (pendingOrder) {
        const ocrText = String(ocrResult.text || '');
        let detectedAmount: number | null = null;

        // Extract currency amount from OCR text
        const amountPatterns = [
          /(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i,
          /(?:Paid|Paying|Total|Amount|Transferred|Sent)\s*(?:to|₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i,
          /([\d,]+(?:\.\d{1,2})?)\s*(?:Paid|Successful|Success|Completed)/i
        ];

        for (const pat of amountPatterns) {
          const m = ocrText.match(pat);
          if (m && m[1]) {
            const parsed = parseFloat(m[1].replace(/,/g, ''));
            if (!isNaN(parsed) && parsed > 0 && parsed < 1000000) {
              detectedAmount = parsed;
              break;
            }
          }
        }

        const safeWebPath = imagePath ? `/data/inbound_media/${path.basename(imagePath)}` : null;

        await db.run(
          `UPDATE special_orders
           SET payment_screenshot_path = ?,
               screenshot_amount = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [safeWebPath, detectedAmount, pendingOrder.id]
        );

        await db.run(
          `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
           VALUES (?, 'payment_screenshot_received', ?, 'system', CURRENT_TIMESTAMP)`,
          [
            pendingOrder.id,
            `Payment screenshot received via WhatsApp. Detected amount: ${detectedAmount ? '₹' + detectedAmount.toFixed(2) : 'Uncertain/Unread'}. Awaiting pharmacy manual verification.`
          ]
        );

        eventService.broadcast('order_updated', {
          at: Date.now(),
          order_id: pendingOrder.id,
          reason: 'screenshot_received',
          screenshot_amount: detectedAmount
        });

        console.log(`[Intent Service] Payment receipt attached to Order #${pendingOrder.id} (detected=₹${detectedAmount}, expected=₹${pendingOrder.total_amount}). Pending manual human review.`);

        // CRITICAL HUMAN-IN-THE-LOOP RULE:
        // NEVER autonomously confirm payment or auto-message customer that payment is confirmed.
        // Return here so payment screenshots are NOT processed as prescription medicine searches.
        return;
      }
    }
  } catch (paymentCheckErr) {
    console.warn('[Intent Service] Payment screenshot check error:', paymentCheckErr);
  }

  let medicineName = ocrResult.medicineInfo?.potentialName;
  const dosageForm = ocrResult.medicineInfo?.dosageForm;
  const mrp = ocrResult.medicineInfo?.mrp;

  // Parse any text from the message body too
  const textParsed = parseMessage(messageBody || '');

  // Fallback: If OCR potentialName is empty, attempt to extract candidate medicine lines from raw OCR text
  if (!medicineName && ocrResult.text) {
    const lines = String(ocrResult.text)
      .split(/[\r\n]+/)
      .map(l => l.trim())
      .filter(l => l.length >= 3);
    const candidate = lines.find(l => isPlausibleMedicineName(l)) || lines[0] || '';
    if (candidate) {
      medicineName = candidate;
    }
  }

  // Use OCR medicine name, but prefer text-parsed name if OCR is weak.
  // The OCR fallback can be a raw first line (batch number, price) — apply the
  // same plausibility rules as the text path before any search runs.
  let finalName = medicineName || textParsed.medicineName;
  if (finalName && !isPlausibleMedicineName(finalName)) {
    if (textParsed.medicineName && isPlausibleMedicineName(textParsed.medicineName)) {
      finalName = textParsed.medicineName;
    } else {
      console.log(`[Intent Service] OCR name "${finalName}" failed plausibility check. Discarding.`);
      return;
    }
  }
  if (!finalName) {
    // App genuinely could not read anything usable from this image — this is
    // the clearest "not sure" case, so a human should see the actual photo.
    if (imagePath) {
      (async () => {
        try {
          const db = await dbManager.getConnection();
          await waAdminEscalationService.notifyAdminOfUnprocessedMedia(db, {
            phone: phone || '',
            chatId,
            imagePath,
            reason: 'Could not extract any readable medicine name from this photo.'
          });
        } catch (notifyErr) {
          console.error('[Intent Service] Failed to notify admin of unreadable scan:', notifyErr);
        }
      })();
    }
    return;
  }

  // EXTRA IMAGE CANDIDATES — a photo (or photo+caption) can carry more than
  // one medicine. Collect every distinct plausible name beyond the primary:
  // DB fuzzy matches[], generic/API names, other plausible OCR lines, and
  // caption-text segments. Every candidate still passes the V2 scan gate +
  // confidence gate below, so extras can never become wrong entries.
  const extraCandidates: string[] = [];
  const seenExtra = new Set<string>(
    [finalName].map(n => n.toLowerCase().replace(/\s+/g, ' '))
  );
  const pushExtra = (v: any) => {
    const s = String(v || '').trim();
    if (!s || !isPlausibleMedicineName(s)) return;
    const key = s.toLowerCase().replace(/\s+/g, ' ');
    if (seenExtra.has(key)) return;
    seenExtra.add(key);
    extraCandidates.push(s);
  };
  pushExtra(ocrResult.medicineInfo?.genericName);
  pushExtra(ocrResult.medicineInfo?.apiName);
  for (const m of Array.isArray(ocrResult.matches) ? ocrResult.matches : []) {
    pushExtra(m);
  }
  for (const c of extractMedicineCandidates(messageBody || '')) {
    pushExtra(c.medicineName);
  }
  // Line-level fallback: plausible standalone OCR lines (capped).
  if (ocrResult.text) {
    const lines = String(ocrResult.text)
      .split(/[\r\n]+/)
      .map(l => l.trim())
      .filter(l => l.length >= 3);
    for (const line of lines) {
      if (extraCandidates.length >= 4) break;
      pushExtra(line);
    }
  }
  const cappedExtras = extraCandidates.slice(0, 4);

  // Stage 0 Scan Gate: skip images that are clearly NOT medicines
  // (booking/ticket/bill/finance docs, food packets, random photos).
  // Without this, every image triggers a search + admin escalation even
  // when it is a train ticket or a biscuit packet.
  const ocrRaw = [
    ocrResult?.text,
    ocrResult?.rawText,
    ocrResult?.medicineInfo?.rawOcrText,
    typeof ocrResult?.cloudDetails === 'string' ? ocrResult.cloudDetails : ocrResult?.cloudDetails?.text,
  ].filter(Boolean).join(' ');

  // Fetch known API substances & medicine reference dynamically and run V2 Signal-Required Gate
  Promise.all([
    lookupCustomer(phone),
    dbManager.getConnection().then(async db => {
      const apiRows = await db.all('SELECT api FROM api_substances').catch(() => []);
      const refRows = await db.all('SELECT name, composition1 FROM medicine_reference').catch(() => []);
      const combined = [
        ...apiRows.map((r: any) => r.api),
        ...refRows.map((r: any) => r.name),
        ...refRows.map((r: any) => r.composition1)
      ];
      return combined.filter(Boolean);
    })
  ]).then(async ([customer, apiNames]) => {
    const knownApis = new Set(apiNames.map((s: string) => String(s).toLowerCase().trim()));
    // Also include core tokens from loaded medicine dictionary if available
    const medNames = productNameFilterService.getMedicineNames();
    if (medNames && medNames.length > 0) {
      for (const m of medNames.slice(0, 5000)) {
        const first = m.split(/\s+/)[0]?.toLowerCase();
        if (first && first.length >= 4) knownApis.add(first);
      }
    }
    // Primary name first, then extra image/caption candidates — every one
    // independently through the V2 gate so a second product on a strip or a
    // caption medicine is found, while tickets/bills still get skipped whole.
    const allNames = [finalName, ...cappedExtras];
    const captionCandidates = extractMedicineCandidates(messageBody || '');
    const passingNames: string[] = [];
    for (const candName of allNames) {
      const decision = resolveOcrGateDecision(ocrRaw, candName, knownApis);
      if (decision === 'skip') continue;
      if (candName !== finalName) {
        console.log(`[Intent Service] OCR extra candidate identified: "${candName}" (chat=${chatId})`);
      }
      passingNames.push(candName);
    }
    if (passingNames.length === 0) {
      console.log(`[Intent Service] Scan gate (V2): skipped non-medicine image (name="${finalName}", chat=${chatId}).`);
      return;
    }

    // ─── Visual Index Fusion (confirmed brand images) ──────────────────────
    // If user shared a photo, the 10,781 confirmed catalog images (front/back/combined
    // per product) are now indexed by perceptual hash (phash). A shared photo's
    // phash finds the same product's front/back visually (Hamming <=12), then
    // fused with brand/strength/form signals. This lets a strip photo match even
    // when OCR misreads the name, using multiple confirmed info.
    let visualBoostName: string | null = null;
    try {
      if (imagePath && fs.existsSync(imagePath)) {
        const buf = fs.readFileSync(imagePath);
        const ocrRawForVisual = [ocrResult?.text, messageBody].filter(Boolean).join(' ');
        const visualHits = await visualIndexService.fusedSearch(buf, ocrRawForVisual, { limit: 3, maxVisualDistance: 12 });
        if (visualHits.length > 0 && visualHits[0].fusedScore >= 75) {
          const top = visualHits[0];
          // Use visual hit as primary if its fused score beats textual
          // and it is not already in passingNames (brand already confirmed)
          const already = passingNames.some(n => n.toLowerCase() === top.product_name.toLowerCase());
          if (!already) {
            visualBoostName = top.product_name;
            console.log(`[Intent Service] Visual hit: "${top.product_name}" distance=${top.visualDistance} fused=${top.fusedScore} (brand ${top.signals.brandMatch?'match':'mismatch'})`);
          } else {
            console.log(`[Intent Service] Visual confirms textual: "${top.product_name}" fused=${top.fusedScore}`);
          }
        }
      }
    } catch (visErr) {
      console.warn('[Intent Service] Visual fusion failed:', visErr);
    }
    if (visualBoostName) {
      // Visual overrides primary when OCR is weak but image matches confirmed gallery
      finalName = visualBoostName;
      if (!passingNames.includes(visualBoostName)) passingNames.unshift(visualBoostName);
    }

    // ONE-PHOTO-ONE-RESULT (owner rule): only the PRIMARY candidate runs the
    // full pipeline — the single possible live Pharmarack search per photo.
    // Extra medicines on the strip / caption are resolved LOCAL-ONLY and ride
    // along as relatedMedicines on the primary card + owner WhatsApp message.
    const relatedMedicines = await resolveRelatedMedicinesLocal(passingNames.slice(1));
    const captionHit = captionCandidates
      .find(c => c.medicineName.toLowerCase() === finalName.toLowerCase());
    let isManualChatSession = false;
    if (chatId) {
      try {
        const db = await dbManager.getConnection();
        const chatRow = await db.get('SELECT session_mode, manual_active_until FROM whatsapp_chats WHERE id = ?', [chatId]);
        if (chatRow?.session_mode === 'manual' && Number(chatRow?.manual_active_until || 0) > Date.now()) {
          isManualChatSession = true;
        }
      } catch (_) {}
    }

    searchAndBroadcast({
      medicineName: finalName,
      quantity: textParsed.quantity || captionHit?.quantity || 1,
      unit: textParsed.unit || captionHit?.unit || '',
      customer,
      isNewCustomer: !customer,
      messageBody: messageBody || '',
      source: textParsed.medicineName ? 'both' : 'ocr',
      dosageForm,
      mrp,
      msgId,
      phone,
      chatId,
      imagePath,
      hasIntentWords: textParsed.rawIntentWords.length > 0,
      suppressClarification: isManualChatSession,
      relatedMedicines
    }).catch(err => console.error('[Intent Service] OCR post-search failed:', err));
  }).catch(err => {
    console.error('[Intent Service] Error in handleOcrComplete lookup:', err);
  });
}

interface RelatedMedicineInfo { name: string; registered: boolean; inventoryStock: number }

/**
 * Local-only resolution for extra photo candidates (one-photo-one-result).
 * Uses the local FTS/fuzzy matcher + the batched shelf-stock query ONLY —
 * never the catalog/live Pharmarack paths, so one photo can never fan out
 * into multiple external searches. Failures degrade to "not registered".
 */
async function resolveRelatedMedicinesLocal(names: string[]): Promise<RelatedMedicineInfo[]> {
  if (names.length === 0) return [];
  const results: RelatedMedicineInfo[] = [];
  try {
    const db = await dbManager.getConnection();
    for (const name of names) {
      try {
        const fr = await productNameFilterService.filterProductNames(name, { minConfidenceThreshold: 0.6 });
        const matches: string[] = Array.isArray(fr.matches) ? fr.matches : [];
        if (matches.length === 0) {
          results.push({ name, registered: false, inventoryStock: 0 });
          continue;
        }
        let stock: Record<string, number> = {};
        try {
          stock = await resolveInventoryStock(matches.slice(0, 3), db);
        } catch { /* stock stays empty → reported as 0 on shelf */ }
        const best = matches[0];
        results.push({
          name: best,
          registered: true,
          inventoryStock: stock[String(best).toLowerCase()] ?? 0,
        });
      } catch {
        results.push({ name, registered: false, inventoryStock: 0 });
      }
    }
  } catch (err) {
    console.warn('[Intent Service] Related-medicine local resolution failed:', err);
  }
  return results;
}

export const whatsappIntentService = { handleInbound, handleOcrComplete, searchAndBroadcast };
export default whatsappIntentService;
