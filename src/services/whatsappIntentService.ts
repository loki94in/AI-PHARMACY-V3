// WhatsApp Intent Service — central orchestrator for inbound messages.
// Routes messages through: ignore check → customer lookup → text parse → OCR → smart match.
import fs from 'fs';
import path from 'path';
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { parseMessage, isRepeatRequest, isRefillConfirmationResponse, isPlausibleMedicineName, detectDosageForm, isMedicineLikely, extractMedicineCandidates, detectNonAllopathicKind, isPromotionalOrBroadcastMessage, DOSAGE_AND_PACKAGING_NOISE_TOKENS, sanitizePharmarackQuery } from './intentKeywords.js';
import { ocrScanQueue } from './ocrScanQueue.js';
import { productNameFilterService } from './productNameFilterService.js';
import { searchCatalog, scoreProductName } from './pharmarackCatalogCache.js';
import { waAdminEscalationService } from './waAdminEscalationService.js';
import { isItemInStock, resolveCommonOrFrequentDistributor, addItemsToPharmarackCart } from '../routes/pharmarack.js';
import { paymentQrService } from './paymentQrService.js';
import { startupSyncCoordinator } from './startupSyncCoordinator.js';
import { visualIndexService } from './visualIndexService.js';
import { GATE_VARIANTS, type GateDecision, DOC_SIGNS } from '../../scanGateAlgorithms.js';
import { getAppDataDir } from '../config/index.js';

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

  // Also save a copy to <appDataDir>/uploads/ so UI and legacy routes resolve immediately
  try {
    const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
    await fs.promises.mkdir(uploadsDir, { recursive: true });
    await fs.promises.writeFile(path.join(uploadsDir, `${safeId}.jpg`), buffer);
  } catch (_) {}

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


export { sanitizePharmarackQuery };

/**
 * Filters Pharmarack candidate medicines to strictly match requested formulation modifiers
 * (e.g. 'P', 'SP', 'PLUS', 'D', 'AM', 'H', 'CV') and strengths, eliminating mismatched
 * single-salt or alternate variants (e.g. rejecting 'ZERODOL 100 MG' when 'ZERODOL P' is requested).
 */
export function filterCandidatesByFormulation(targetName: string, candidates: any[]): any[] {
  if (!targetName || !Array.isArray(candidates) || candidates.length === 0) {
    return candidates || [];
  }

  const FORMULATION_MODIFIERS = new Set([
    'p', 'sp', 'd', 'l', 'm', 'h', 'o', 'am', 'cv', 'az', 'cl', 'plus', 'forte', 'advance',
    'max', 'super', 'gold', 'pro', 'kid', 'jr', 'junior', 'ds', 'ls', 'dx', 'cr',
    'sr', 'mr', 'xl', 'er', 'tr', 'od', 'bd', 'xt', 'ct', 'th', 'tc', 'ap', 'dp'
  ]);

  const tokenize = (name: string): { brand: string; modifiers: Set<string>; strengths: Set<string> } => {
    const clean = String(name || '')
      .toLowerCase()
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      .replace(/[+/,._\-()\[\]#*']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = clean.split(' ').filter(w => !DOSAGE_AND_PACKAGING_NOISE_TOKENS.has(w));
    const brand = words[0] || '';
    const modifiers = new Set<string>();
    const strengths = new Set<string>();

    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      if (FORMULATION_MODIFIERS.has(w)) {
        modifiers.add(w);
      }
      const numMatch = w.match(/^(\d+(?:\.\d+)?)$/);
      if (numMatch) {
        // First numeric token is the active dosage strength (e.g. 650 from dolo 650).
        // Subsequent numbers without units (e.g. 15 from "15 tablets" or "strip of 15")
        // are pack size quantities and must not be treated as mandatory drug strengths.
        if (strengths.size === 0) {
          strengths.add(numMatch[1]);
        }
      }
    }
    return { brand, modifiers, strengths };
  };

  const targetTokens = tokenize(targetName);

  if (targetTokens.modifiers.size > 0 || targetTokens.strengths.size > 0) {
    const exactMatches: any[] = [];
    for (const c of candidates) {
      const cName = c.name || c.productName || c.product || c.shortName || '';
      const cTokens = tokenize(cName);

      // Verify brand matches (or starts with)
      if (targetTokens.brand && !cTokens.brand.startsWith(targetTokens.brand) && !targetTokens.brand.startsWith(cTokens.brand)) {
        continue;
      }

      // Check formulation modifiers match
      let modifiersMatch = true;
      for (const mod of targetTokens.modifiers) {
        if (!cTokens.modifiers.has(mod)) {
          modifiersMatch = false;
          break;
        }
      }

      // Reject candidates with conflicting extra modifiers (e.g. target asked for 'P', candidate has 'SP')
      if (modifiersMatch) {
        for (const cMod of cTokens.modifiers) {
          if (!targetTokens.modifiers.has(cMod)) {
            modifiersMatch = false;
            break;
          }
        }
      }

      if (modifiersMatch) {
        if (targetTokens.strengths.size > 0) {
          let strengthMatch = true;
          for (const str of targetTokens.strengths) {
            if (!cTokens.strengths.has(str)) {
              strengthMatch = false;
              break;
            }
          }
          if (strengthMatch) {
            exactMatches.push(c);
          }
        } else {
          exactMatches.push(c);
        }
      }
    }

    if (exactMatches.length > 0) {
      return exactMatches;
    }
  }

  return candidates;
}

function formatTime12h(timeStr: string): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

async function getStoreHoursNotice(db: any): Promise<string> {
  try {
    const { getPharmacyOperatingSchedule } = await import('./storeSettingsService.js');
    const sched = await getPharmacyOperatingSchedule(db);
    const nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const curMinutes = nowIst.getHours() * 60 + nowIst.getMinutes();
    const [openH, openM] = (sched.openTime || '09:00').split(':').map(Number);
    const [closeH, closeM] = (sched.closeTime || '22:00').split(':').map(Number);
    const openMinutes = (openH || 9) * 60 + (openM || 0);
    const closeMinutes = (closeH || 22) * 60 + (closeM || 0);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDayName = days[nowIst.getDay()];
    const isWeeklyOff = Boolean(sched.weeklyOff && sched.weeklyOff.toLowerCase() === currentDayName.toLowerCase());
    const isOutsideHours = isWeeklyOff || curMinutes < openMinutes || curMinutes >= closeMinutes;

    if (isOutsideHours) {
      const open12 = formatTime12h(sched.openTime || '09:00');
      const close12 = formatTime12h(sched.closeTime || '22:00');
      if (isWeeklyOff) {
        return `\n\n🕒 *Note:* Today is our weekly off (Regular hours: ${open12} - ${close12}).\n✅ *You can still send your request or prescription now!* Our team will prepare it on our next working day at ${open12}.`;
      }
      return `\n\n🕒 *Note:* Our pharmacy is currently closed (Store hours: ${open12} - ${close12}).\n✅ *You can still send your request or prescription now!* Our team will prepare it when we open tomorrow at ${open12}.`;
    }
  } catch (_) {}
  return '';
}

/**
 * Send medicine ordering guidance prompt to customer if they sent conversational chat or greeting with no medicine name.
 * Debounced per customer phone (maximum once per 12 hours) to prevent spam.
 */
async function maybeSendGuidancePrompt(phone: string, customerName: string, db: any, originalMessage?: string): Promise<void> {
  const cleanDigits = (phone || '').replace(/\D/g, '').slice(-10);
  if (!cleanDigits || cleanDigits.length < 10) return;

  try {
    const { getStoreMedicalName } = await import('./storeSettingsService.js');
    const storeName = (await getStoreMedicalName(db)) || 'AI Pharmacy';

    const trimmedOriginal = (originalMessage || '').trim();
    const echoLine = trimmedOriginal
      ? `We received your message: "${trimmedOriginal.slice(0, 200)}"\n\n`
      : '';

    const guidanceMsg =
      echoLine +
      `Namaste! Welcome to *${storeName}* 🏥\n\n` +
      `*Place your order in simple steps:*\n\n` +
      `*Step 1:* Choose your order type —\n` +
      `  1️⃣ Single Medicine\n` +
      `  2️⃣ Multiple Medicines\n` +
      `  3️⃣ Refill — Repeat my regular prescription\n\n` +
      `*Step 2:* We show you options & MRP 💰\n` +
      `*Step 3:* You confirm & we book 🚀\n\n` +
      `*Reply 1, 2, or 3 to begin.*`;

    // Initialize session state so customer's subsequent message is actively tracked
    await ensureClarificationsTable(db);

    // 20-minute per-phone guard to prevent burst flush on multiple rapid messages
    const recentPrompt = await db.get(
      `SELECT 1 FROM wa_pending_clarifications 
       WHERE (phone LIKE ? OR phone LIKE ? OR phone = ?) 
         AND created_at > datetime('now', '-20 minutes') 
       LIMIT 1`,
      [`%${cleanDigits}`, `%${cleanDigits}%`, cleanDigits]
    );
    if (recentPrompt) {
      console.log(`[Intent Service] Suppressed duplicate guidance prompt for ${cleanDigits} (within 20m burst window).`);
      return;
    }

    await db.run(
      `INSERT INTO wa_pending_clarifications (phone, suggested_name, original_query, step, customer_name, created_at)
       VALUES (?, '', ?, 'awaiting_medicine', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(phone) DO UPDATE SET
         step = 'awaiting_medicine',
         created_at = CURRENT_TIMESTAMP`,
      [cleanDigits, trimmedOriginal, customerName || 'Customer']
    );

    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
    await whatsappQueueWorker.enqueue(
      phone,
      guidanceMsg,
      'customer_guidance_prompt',
      customerName || 'Customer'
    );
    console.log(`[Intent Service] Sent medicine ordering guidance prompt to ${cleanDigits}. Session initialized to awaiting_medicine.`);
  } catch (err) {
    console.warn('[Intent Service] Failed to send guidance prompt:', err);
  }
}

/**
 * Check if a customer name is a real human name rather than a phone number or placeholder.
 */
export function isKnownCustomerName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  if (/^(\+?\d+|whatsapp customer|customer|walk-in.*|unknown|guest|yes|no|ok|okay|haan|ho|yep|yup|please|pls|plz|thx|thanks|thank you|help|hello|hi|hey|start|order)$/i.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * Look up customer by phone number across customers, patient_refills, sales_invoices, and whatsapp_chats.
 * Returns null only if the customer truly does not exist in any system record.
 */
async function lookupCustomer(phone: string, chatId?: string): Promise<{ id: number; name: string; phone: string } | null> {
  const db = await dbManager.getConnection();

  // 1. Extract pure 10 digits
  let cleanDigits = phone.replace(/\D/g, '').slice(-10);

  // If phone is an @lid and had < 10 clean digits, check if whatsapp_chats already resolved it
  if ((!cleanDigits || cleanDigits.length < 10) && chatId) {
    try {
      const chatRow = await db.get('SELECT resolved_number FROM whatsapp_chats WHERE id = ?', [chatId]);
      if (chatRow?.resolved_number) {
        cleanDigits = chatRow.resolved_number.replace(/\D/g, '').slice(-10);
      }
    } catch (_) {}
  }

  // If still no valid 10 digits, cannot match
  if (!cleanDigits || cleanDigits.length < 10) {
    return null;
  }

  // 2. Check primary `customers` table
  try {
    const row = await db.get(
      `SELECT id, name, phone FROM customers 
       WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', '') LIKE ? 
       ORDER BY (CASE WHEN name IS NOT NULL AND name != '' AND name NOT LIKE 'Customer%' THEN 1 ELSE 2 END) ASC, id DESC
       LIMIT 1`,
      [`%${cleanDigits}%`]
    );
    if (row && isKnownCustomerName(row.name)) {
      return row;
    }
  } catch (_) {}

  // 3. Fallback: Check `patient_refills` table (chronic patients with prescriptions)
  try {
    const refillRow = await db.get(
      `SELECT patient_name, patient_phone FROM patient_refills 
       WHERE REPLACE(REPLACE(REPLACE(patient_phone, '+', ''), '-', ''), ' ', '') LIKE ? 
         AND patient_name IS NOT NULL AND patient_name != ''
       ORDER BY id DESC LIMIT 1`,
      [`%${cleanDigits}%`]
    );
    if (refillRow?.patient_name && isKnownCustomerName(refillRow.patient_name)) {
      try {
        const ins = await db.run(
          `INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [refillRow.patient_name, cleanDigits]
        );
        return { id: ins.lastID || 0, name: refillRow.patient_name, phone: cleanDigits };
      } catch (_) {
        return { id: 0, name: refillRow.patient_name, phone: cleanDigits };
      }
    }
  } catch (_) {}

  // 4. Fallback: Check `sales_invoices` table (counter bills with phone snapshot)
  try {
    const saleRow = await db.get(
      `SELECT patient_name, customer_phone_snapshot FROM sales_invoices 
       WHERE REPLACE(REPLACE(REPLACE(customer_phone_snapshot, '+', ''), '-', ''), ' ', '') LIKE ? 
         AND patient_name IS NOT NULL AND patient_name != ''
       ORDER BY id DESC LIMIT 1`,
      [`%${cleanDigits}%`]
    );
    if (saleRow?.patient_name && isKnownCustomerName(saleRow.patient_name)) {
      try {
        const ins = await db.run(
          `INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [saleRow.patient_name, cleanDigits]
        );
        return { id: ins.lastID || 0, name: saleRow.patient_name, phone: cleanDigits };
      } catch (_) {
        return { id: 0, name: saleRow.patient_name, phone: cleanDigits };
      }
    }
  } catch (_) {}

  // 5. Fallback: Check `whatsapp_chats` table (previous chat interactions with saved name)
  try {
    const chatRow = await db.get(
      `SELECT name, resolved_number FROM whatsapp_chats 
       WHERE (resolved_number LIKE ? OR id LIKE ?) 
         AND name IS NOT NULL AND name != '' AND name NOT LIKE '%@%'
       ORDER BY timestamp DESC LIMIT 1`,
      [`%${cleanDigits}%`, `%${cleanDigits}%`]
    );
    if (chatRow?.name && isKnownCustomerName(chatRow.name)) {
      try {
        const ins = await db.run(
          `INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [chatRow.name, cleanDigits]
        );
        return { id: ins.lastID || 0, name: chatRow.name, phone: cleanDigits };
      } catch (_) {
        return { id: 0, name: chatRow.name, phone: cleanDigits };
      }
    }
  } catch (_) {}

  return null;
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
    customer_name TEXT DEFAULT NULL,
    mrp REAL DEFAULT NULL,
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
    if (!colNames.has('customer_name')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN customer_name TEXT DEFAULT NULL');
    }
    if (!colNames.has('payment_reminder_sent')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN payment_reminder_sent INTEGER DEFAULT 0');
    }
    if (!colNames.has('mrp')) {
      await db.run('ALTER TABLE wa_pending_clarifications ADD COLUMN mrp REAL DEFAULT NULL');
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

    // Strict formulation/variant shield: reject mismatched single-salts or
    // conflicting combinations/strengths (same guard proceedWithConfirmedProcurement
    // uses) — a bundle-order item must never silently substitute a same-brand
    // different-variant product into the live cart.
    const formulationSafeCatalog = filterCandidatesByFormulation(confirmedMedicine, allCatalog);

    // Filter to distributors with available stock (excluding 0, OOS, nil)
    const inStockCandidates = formulationSafeCatalog.filter(c => isItemInStock(c.availability ?? (c as any).stock));

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
    } else if (formulationSafeCatalog.length > 0) {
      const candidateStores = formulationSafeCatalog.map(c => ({
        storeId: Number((c as any).store_id || (c as any).storeId || 0),
        storeName: String((c as any).distributor || (c as any).supplier_name || (c as any).distributor_name || '')
      })).filter(c => c.storeName.length > 0);

      selectedDistributor = await resolveCommonOrFrequentDistributor(db, candidateStores);
      selectedProductInfo = formulationSafeCatalog[0];
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
      `SELECT phone, suggested_name, original_query, options_json, selected_option, quantity, unit, step, items_json, special_order_id, so_code, customer_name, mrp
       FROM wa_pending_clarifications 
       WHERE (phone LIKE ? OR phone LIKE ? OR phone = ?) 
         AND (
           (step IN ('awaiting_owner_selection', 'awaiting_payment', 'awaiting_owner_payment_confirmation') AND created_at > datetime('now', '-72 hours'))
           OR created_at > datetime('now', '-45 minutes')
         )
       ORDER BY created_at DESC LIMIT 1`,
      [`%${cleanDigits}`, `%${cleanDigits}%`, cleanDigits]
    );
    if (!pending) return false;

    let activeCustomerName = (customer?.name && isKnownCustomerName(customer.name))
      ? customer.name.trim()
      : (pending.customer_name && isKnownCustomerName(pending.customer_name) ? pending.customer_name.trim() : '');

    let normalizedInput = body.trim();
    // Normalize emoji digits 1️⃣ - 🔟 to plain numbers
    const emojiDigits: Record<string, string> = {
      '1️⃣': '1', '2️⃣': '2', '3️⃣': '3', '4️⃣': '4', '5️⃣': '5',
      '6️⃣': '6', '7️⃣': '7', '8️⃣': '8', '9️⃣': '9', '🔟': '10'
    };
    for (const [emoji, num] of Object.entries(emojiDigits)) {
      if (normalizedInput.includes(emoji)) {
        normalizedInput = normalizedInput.replaceAll(emoji, num);
      }
    }
    const lower = normalizedInput.toLowerCase().trim();
    const cleanedForAffirmative = lower.replace(/[.,!?;:()_~#*`"']/g, ' ').replace(/\s+/g, ' ').trim();
    const isAffirmative =
      /^(1|yes|haan|ha|ho|yep|yup|y|sahi|correct|wahi|bhej do|ok|okay|confirm|confirmed|chalel|pathva|dya|ho ji)$/i.test(cleanedForAffirmative) ||
      isRefillConfirmationResponse(body);
    const isNegative =
      /^(2|no|nahi|nako|wrong|galat|cancel|n|nahi chahiye|nako re)$/i.test(cleanedForAffirmative);

    // Passive/waiting states: customer sends text while waiting for owner action
    if (pending.step === 'awaiting_owner_selection') {
      const waitMsg = `Your request for *${pending.suggested_name}* × ${pending.quantity || 1} has been forwarded to our pharmacy for distributor confirmation.\n\nWe will send you payment details shortly.`;
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_inquiry_confirmed', activeCustomerName || customer?.name || 'Customer');
      return true;
    }

    if (pending.step === 'awaiting_payment') {
      const cleanLower = lower.replace(/[^\w\s]/g, ' ').trim();
      const isQrKeyword =
        /^(qr|send\s*qr|qr\s*code|payment\s*link|qr\s*link|pay|payment|link|qr\s*bhejo|bhejo\s*qr|qr\s*send|send\s*code|qr\s*de do|payment\s*qr|upi\s*qr|qr\s*please|qr\s*bhej|bhej\s*do\s*qr)$/i.test(cleanLower) ||
        /\b(send\s*qr|qr\s*code|payment\s*link|qr\s*bhejo|qr\s*link|upi\s*link|qr\s*image)\b/i.test(cleanLower);

      if (isQrKeyword) {
        // Customer requested payment QR / link again
        const { paymentQrService } = await import('./paymentQrService.js');
        const activeQr = await paymentQrService.allocateNextQr();
        const amount = 50;
        const soCode = pending.so_code || (pending.special_order_id ? `SO-${pending.special_order_id}` : 'SO');
        const medicineName = pending.suggested_name || 'Special Order';
        const upiUri = paymentQrService.buildUpiUri(activeQr.upi_id, activeQr.payee_name, amount, soCode);
        const fullQrPath = await paymentQrService.generatePaymentCard({
          upiUri,
          orderNumber: soCode,
          medicineName,
          amount,
          payeeName: activeQr.payee_name,
          upiId: activeQr.upi_id,
          filename: `payment_card_${soCode}.png`
        });

        // Reset timer in pending clarifications so customer has a fresh window
        await db.run(
          `UPDATE wa_pending_clarifications SET created_at = CURRENT_TIMESTAMP, payment_reminder_sent = 0 WHERE phone = ?`,
          [pending.phone]
        );

        const qrResendMsg =
          `💳 *Special Order Booking Advance Payment*\n\n` +
          `🆔 *Special Order*: ${soCode}\n` +
          `💊 *Medicine*: ${medicineName}\n` +
          `📦 *Quantity*: ${pending.quantity || 1} ${pending.unit || 'strip'}\n\n` +
          `🔐 *Booking Advance*: ₹${amount.toFixed(2)}\n\n` +
          `Please pay the ₹${amount.toFixed(2)} booking amount using the QR card attached above.\n\n` +
          `🏦 *UPI ID*: ${activeQr.upi_id.trim()}\n` +
          `👤 *Payee*: ${activeQr.payee_name}\n\n` +
          `👉 *Or tap to pay directly on this phone*:\n${upiUri}\n\n` +
          `📸 After paying, please reply with the payment screenshot in this chat.`;

        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(
          phone,
          qrResendMsg,
          'customer_payment_qr',
          activeCustomerName || customer?.name || 'Customer',
          undefined,
          fullQrPath
        );
        return true;
      }

      // Check if customer wants to cancel or change medicine
      const isCancellation = /^(cancel|cancel\s*order|dusra|dusri\s*dawa|dusri\s*medicine|change|stop|nako|nahi\s*chahiye|reject)$/i.test(cleanLower);
      if (isCancellation) {
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'cancelled' WHERE phone = ?`,
          [pending.phone]
        );
        if (pending.special_order_id) {
          await db.run(
            `UPDATE special_orders SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?`,
            [pending.special_order_id]
          );
        }
        const cancelMsg =
          `Your booking request for *${pending.suggested_name}* has been cancelled.\n\n` +
          `Whenever you need any other medicine, just reply with the medicine name here!`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, cancelMsg, 'customer_inquiry_confirmed', activeCustomerName || customer?.name || 'Customer');
        return true;
      }

      // Check if user is typing a new medicine name to order something else
      const isWaitingFiller = /^(ok|okay|theek\s*hai|accha|haa|haan|wait|ruk|ruko|kal|baad\s*me|shaam|done|karta\s*hu|karti\s*hu)$/i.test(cleanLower);
      if (!isWaitingFiller && body.trim().length >= 3) {
        // Check if query matches catalog
        const testMed = await db.get(
          `SELECT name FROM medicines WHERE name LIKE ? LIMIT 1`,
          [`${body.trim()}%`]
        );
        if (testMed) {
          // Customer is requesting a new medicine! Supersede the old order and fall through to process new inquiry
          await db.run(
            `UPDATE wa_pending_clarifications SET step = 'superseded' WHERE phone = ?`,
            [pending.phone]
          );
          // Fall through to regular message processing below!
        } else {
          // Regular prompt while awaiting payment with clear options
          const waitMsg =
            `Please pay the ₹50 booking amount using the QR code sent earlier, and reply with the payment screenshot to proceed with your order (Ref: ${pending.so_code || 'SO'}).\n\n` +
            `• Reply *QR* to receive a fresh payment QR code.\n` +
            `• Or reply with a *new medicine name* if you would like to order something else.`;
          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_inquiry_confirmed', activeCustomerName || customer?.name || 'Customer');
          return true;
        }
      } else {
        const waitMsg =
          `Please pay the ₹50 booking amount using the QR code sent earlier, and reply with the payment screenshot to proceed with your order (Ref: ${pending.so_code || 'SO'}).\n\n` +
          `• Reply *QR* to receive a fresh payment QR code.\n` +
          `• Or reply with a *new medicine name* if you would like to order something else.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_inquiry_confirmed', activeCustomerName || customer?.name || 'Customer');
        return true;
      }
    }

    if (pending.step === 'awaiting_owner_payment_confirmation') {
      const waitMsg = `Your payment screenshot is being verified by our pharmacy team. You will receive final confirmation shortly!`;
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_inquiry_confirmed', activeCustomerName || customer?.name || 'Customer');
      return true;
    }

    // Step: awaiting_dosage_group (Strict 1 TAB vs 2 BOTTLE selection)
    if (pending.step === 'awaiting_dosage_group') {
      let dosageGroup: 'TAB' | 'BOTTLE' | null = null;
      if (/^(1|tab|tablet|capsule|cap|pills?|strip)$/i.test(lower)) {
        dosageGroup = 'TAB';
      } else if (/^(2|bottle|syrup|syp|suspension|susp|liquid)$/i.test(lower)) {
        dosageGroup = 'BOTTLE';
      }

      if (!dosageGroup) {
        const retryMsg =
          `Please reply with:\n` +
          `1️⃣ Tablet / Capsule (Strips)\n` +
          `2️⃣ Syrup / Suspension (Bottles)`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, retryMsg, 'customer_medicine_clarification', activeCustomerName || 'Customer');
        return true;
      }

      const query = pending.original_query || pending.suggested_name || '';
      const pharmaQuery = sanitizePharmarackQuery(query);
      let mappedRows: Array<{ name: string; mrp: number | null }> = [];
      try {
        const { performPharmarackSearch } = await import('../routes/pharmarack.js');
        const queryTerm = (pharmaQuery || query).trim();
        let searchRes = await performPharmarackSearch(queryTerm, null, true).catch(() => null);
        if ((!searchRes || searchRes.status !== 'ok' || !searchRes.items || searchRes.items.length === 0) && queryTerm.toLowerCase() !== query.trim().toLowerCase()) {
          searchRes = await performPharmarackSearch(query.trim(), null, true).catch(() => null);
        }

        let rawHits: any[] = (searchRes && searchRes.status === 'ok' && Array.isArray(searchRes.items)) ? searchRes.items : [];
        if (rawHits.length === 0) {
          const cat = await searchCatalog(queryTerm, dosageGroup).catch(() => null);
          if (cat?.mapped && Array.isArray(cat.mapped)) {
            rawHits = cat.mapped;
          }
        }

        if (rawHits.length > 0) {
          const seen = new Set<string>();
          for (const item of rawHits) {
            const isMapped = item.isMapped === true || item.mapped === true || item.IsMapped === 1 || String(item.isMapped) === '1' || String(item.mapped) === '1' || String(item.IsMapped) === '1';
            if (!isMapped) continue;
            if (!isItemInStock(item.stock ?? item.availability ?? item.Stock ?? item.Availability)) continue;

            const cleanName = (item.name || item.productName || item.fullName || '').trim();
            if (!cleanName || seen.has(cleanName)) continue;

            // Filter by dosage group
            if (dosageGroup === 'TAB') {
              if (/\b(SYP|SYRUP|SUSP|SUSPENSION|DROPS?|LIQ|LIQUID|SOLN|SOLUTION)\b/i.test(cleanName)) continue;
            } else if (dosageGroup === 'BOTTLE') {
              if (/\b(TAB|TABLET|TABLETS|CAP|CAPSULE|CAPSULES)\b/i.test(cleanName)) continue;
            }

            seen.add(cleanName);
            const mrpVal = (() => { const n = typeof item.mrp === 'number' ? item.mrp : typeof (item as any).MRP === 'number' ? (item as any).MRP : parseFloat(String(item.mrp ?? (item as any).MRP ?? '')); return Number.isFinite(n) && n > 0 ? n : null; })();

            mappedRows.push({
              name: cleanName,
              mrp: mrpVal
            });
            if (mappedRows.length >= 40) break;
          }
        }
      } catch (err) {
        console.warn('[Intent Service] Mapped catalog query error:', err);
      }

      if (!mappedRows || mappedRows.length === 0) {
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_owner_selection', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const waitMsg = `Your request for *${query}* (${dosageGroup === 'TAB' ? 'Tablet/Capsule' : 'Syrup/Bottle'}) has been received and forwarded to our pharmacy team — checking availability with our partner distributors now.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_medicine_clarification', activeCustomerName || 'Customer');

        const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db);
        if (adminWhatsapp) {
          const ownerMsg =
            `⚠️ *Special Order Request (Manual Sourcing Needed)*\n\n` +
            `👤 Customer: ${activeCustomerName || 'Customer'} (+91 ${cleanDigits})\n` +
            `💊 Medicine: *${query}* (${dosageGroup})\n\n` +
            `No mapped partner distributor stock found in Pharmarack catalog. Please check manual sources or unmapped distributors.`;
          await whatsappQueueWorker.enqueue(adminWhatsapp, ownerMsg, 'admin_escalation', 'Owner');
        }
        return true;
      }

      if (mappedRows.length === 1) {
        const singleMed = mappedRows[0];
        const singleMrpVal = (() => { const n = typeof singleMed.mrp === 'number' ? singleMed.mrp : parseFloat(String(singleMed.mrp ?? '')); return Number.isFinite(n) && n > 0 ? n : null; })();
        const mrpLine = singleMrpVal != null ? `\n🏷️ MRP: ₹${singleMrpVal.toFixed(2)}` : '';
        await db.run(
          `UPDATE wa_pending_clarifications 
           SET options_json = ?, suggested_name = ?, selected_option = ?, mrp = ?, step = 'awaiting_final_book', created_at = CURRENT_TIMESTAMP 
           WHERE phone = ?`,
          [JSON.stringify(mappedRows), singleMed.name, singleMed.name, singleMrpVal, pending.phone]
        );
        const bookPrompt =
          `💊 Found medicine from our partner distributors:\n*${singleMed.name}*${mrpLine}\n\n` +
          `Would you like us to check availability & book this for you?\n\n` +
          `1️⃣ Yes, Book Order\n` +
          `2️⃣ Cancel`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, bookPrompt, 'customer_medicine_clarification', activeCustomerName || 'Customer');
        return true;
      }

      const PAGE_SIZE = 10;
      const initialSlice = mappedRows.slice(0, PAGE_SIZE);
      const totalCount = mappedRows.length;
      const totalPages = Math.ceil(totalCount / PAGE_SIZE);
      const formatNum = (idx: number) => {
        const emojiNums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        return idx < 10 ? emojiNums[idx] : `${idx + 1}.`;
      };
      const shortenForDosage = (n: string) => n.replace(/\s*\(\s*(strip|pack|alu|blister|bottle|box)\s*(of|x)?\s*\d*\s*\)?\s*$/i, '').trim();
      const parseMrpDosage = (v: any): number | null => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) && n > 0 ? n : null; };

      const optionsList = initialSlice.map((r, idx) => {
        const m = parseMrpDosage(r.mrp);
        const mrpStr = m != null ? `MRP: ₹${m.toFixed(2)}` : 'MRP: N/A';
        return `${formatNum(idx)} *${shortenForDosage(r.name)}*\n   ${mrpStr}`;
      }).join('\n\n');

      const pageInfo = totalCount > PAGE_SIZE ? ` (Page 1 of ${totalPages})` : '';
      const moreHint = totalCount > PAGE_SIZE ? `\n👉 Reply *MORE* to see more options.` : '';
      const optionsMsg = `🔎 *${query}* — ${totalCount} in-stock ${dosageGroup === 'TAB' ? 'tablets/capsules' : 'syrups/liquids'} from partner distributors${pageInfo}:\n\n${optionsList}\n\n👉 _Reply with the number to select._${moreHint}\n👉 _Reply *0* if your medicine is not listed._`;

      await db.run(
        `UPDATE wa_pending_clarifications 
         SET options_json = ?, suggested_name = ?, original_query = ?, mrp = ?, step = 'awaiting_selection', created_at = CURRENT_TIMESTAMP 
         WHERE phone = ?`,
        [JSON.stringify({ allOptions: mappedRows, page: 0 }), mappedRows[0].name, query, mappedRows[0].mrp, pending.phone]
      );

      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, optionsMsg, 'customer_medicine_clarification', activeCustomerName || 'Customer');
      return true;
    }

    // Step: awaiting_variant_pick (1..N selection with MRP-only)
    if (pending.step === 'awaiting_variant_pick') {
      let options: any[] = [];
      try {
        options = JSON.parse(pending.options_json || '[]');
      } catch (_) {}

      const numMatch = lower.match(/^(?:option\s*)?(\d{1,2})$/i);
      let pickedIndex = -1;
      if (numMatch) {
        pickedIndex = parseInt(numMatch[1], 10) - 1;
      } else if (lower.length >= 3) {
        pickedIndex = options.findIndex((opt: any) => {
          const optName = typeof opt === 'string' ? opt : (opt?.name || '');
          return optName.toLowerCase().includes(lower) || lower.includes(optName.toLowerCase());
        });
      }

      if (pickedIndex < 0 || pickedIndex >= options.length) {
        const retryMsg = `Please reply with a number between 1 and ${options.length} to select your medicine.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, retryMsg, 'customer_medicine_clarification', activeCustomerName || 'Customer');
        return true;
      }

      const chosen = options[pickedIndex];
      const chosenVariant = typeof chosen === 'string' ? chosen : (chosen?.name || '');
      const chosenMrp = typeof chosen === 'object' && chosen?.mrp != null && chosen.mrp > 0 ? Number(chosen.mrp) : null;

      await db.run(
        `UPDATE wa_pending_clarifications 
         SET suggested_name = ?, selected_option = ?, mrp = ?, step = 'awaiting_final_book', created_at = CURRENT_TIMESTAMP 
         WHERE phone = ?`,
        [chosenVariant, chosenVariant, chosenMrp, pending.phone]
      );

      const mrpLine = chosenMrp ? `\n🏷️ MRP: ₹${chosenMrp.toFixed(2)}` : '';
      const bookPrompt =
        `💊 Selected: *${chosenVariant}*${mrpLine}\n\n` +
        `Would you like us to check availability & book this for you?\n\n` +
        `1️⃣ Yes, Book Order\n` +
        `2️⃣ Cancel`;

      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, bookPrompt, 'customer_medicine_clarification', activeCustomerName || 'Customer');
      return true;
    }

    // Step: awaiting_final_book (1 Confirm vs 2 Cancel)
    if (pending.step === 'awaiting_final_book') {
      if (isNegative || /^(2|cancel|no|nahi|nako)$/i.test(lower)) {
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'cancelled', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const cancelMsg = `Your request for *${pending.suggested_name}* has been cancelled. Whenever you need any medicine, just send us a message!`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, cancelMsg, 'customer_medicine_clarification', activeCustomerName || 'Customer');
        return true;
      }

      if (isAffirmative || /^(1|yes|book|confirm|order)$/i.test(lower)) {
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_qty', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const mrpSuffix = pending.mrp != null && pending.mrp > 0 ? ` (MRP ₹${Number(pending.mrp).toFixed(2)})` : '';
        const qtyPrompt = `✅ Confirmed: *${pending.suggested_name}*${mrpSuffix}\n\n📦 Please enter the quantity you need (e.g. 1 strip, 2 bottles):`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, qtyPrompt, 'customer_medicine_clarification', activeCustomerName || 'Customer');
        return true;
      }
    }

    // Step: awaiting_customer_name (Customer greeted, now providing their name)
    if (pending.step === 'awaiting_customer_name') {
      const rawName = body.trim();
      let cleaned = rawName
        .replace(/^(my\s+name\s+is|i\s+am|i'm|this\s+is|mera\s+naam|naam\s+hai|call\s+me|myself)\s+/i, '')
        .replace(/^[^\w\s.\u0900-\u097F']+/g, '')
        .trim();

      const isGreetingAgain = /^(hi|hello|hey|hola|namaste|namaskar|pranam|good morning|gm|start|help|order)$/i.test(
        cleaned.toLowerCase().replace(/[^\w\s]/g, '').trim()
      );
      const isAffirmativeOrNegative = /^(yes|haan|ha|ho|yep|yup|y|sahi|correct|wahi|bhej do|ok|okay|confirm|no|nahi|nako|wrong|galat|cancel|n|thanks|thank you|shukriya|please|pls|plz)$/i.test(
        cleaned.toLowerCase().replace(/[^\w\s]/g, '').trim()
      );

      const isValidName = !isGreetingAgain && !isAffirmativeOrNegative && cleaned.length >= 2 && cleaned.length <= 50 && /^[\p{L}\s.']{2,50}$/u.test(cleaned);

      if (!isValidName) {
        const retryNameMsg = `Could you please share your name so we can assist you?`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, retryNameMsg, 'customer_greeting', 'Customer');
        return true;
      }

      const formattedName = cleaned
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      const existingCust = await db.get(
        `SELECT id FROM customers WHERE phone LIKE ? OR phone LIKE ? LIMIT 1`,
        [`%${cleanDigits}`, `%${cleanDigits.slice(-10)}`]
      );

      if (existingCust?.id) {
        await db.run(`UPDATE customers SET name = ? WHERE id = ?`, [formattedName, existingCust.id]);
      } else {
        await db.run(
          `INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [formattedName, cleanDigits]
        );
      }

      if (chatId) {
        await db.run(`UPDATE whatsapp_chats SET name = ? WHERE id = ?`, [formattedName, chatId]);
      }

      await db.run(
        `UPDATE wa_pending_clarifications 
         SET step = 'awaiting_medicine', customer_name = ?, created_at = CURRENT_TIMESTAMP 
         WHERE phone = ?`,
        [formattedName, pending.phone]
      );

      const { getStoreMedicalName } = await import('./storeSettingsService.js');
      const storeName = (await getStoreMedicalName(db)) || 'AI Pharmacy';
      const hoursNotice = await getStoreHoursNotice(db);

      const { getPharmacyOperatingSchedule: getSchedForWelcome } = await import('./storeSettingsService.js');
      const schedForWelcome = await getSchedForWelcome(db);
      const hoursLineForWelcome = `🕐 Open: ${schedForWelcome.openTime} – ${schedForWelcome.closeTime}${schedForWelcome.weeklyOff ? ` | Off: ${schedForWelcome.weeklyOff}` : ''}`;

      const welcomeMsg =
        `🙏 Namaste *${formattedName}* ji! Welcome to ${storeName}.${hoursNotice}\n\n` +
        `*Place your order in simple steps:*\n\n` +
        `*Step 1:* Choose your order type —\n` +
        `  1️⃣ Single Medicine\n` +
        `  2️⃣ Multiple Medicines\n` +
        `  3️⃣ Refill — Repeat my regular prescription\n\n` +
        `*Step 2:* We show you options & MRP 💰\n` +
        `*Step 3:* You confirm & we book 🚀\n\n` +
        `${hoursLineForWelcome}\n\n` +
        `*Reply 1, 2, or 3 to begin.*`;

      await db.run(
        `UPDATE wa_pending_clarifications SET step = 'awaiting_order_type', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
        [cleanDigits]
      );

      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, welcomeMsg, 'customer_greeting', formattedName);
      console.log(`[Intent Service] Registered customer name "${formattedName}" for ${cleanDigits}. Advanced to awaiting_order_type.`);
      return true;
    }

    // Step: awaiting_order_customer_name (Direct-order customer provides name before order confirmation)
    if (pending.step === 'awaiting_order_customer_name') {
      const rawName = body.trim();
      let cleaned = rawName
        .replace(/^(my\s+name\s+is|i\s+am|i'm|this\s+is|mera\s+naam|naam\s+hai|call\s+me|myself)\s+/i, '')
        .replace(/^[^\w\s.\u0900-\u097F']+/g, '')
        .trim();

      const isGreetingAgain = /^(hi|hello|hey|hola|namaste|namaskar|pranam|good morning|gm|start|help|order)$/i.test(
        cleaned.toLowerCase().replace(/[^\w\s]/g, '').trim()
      );
      const isAffirmativeOrNegative = /^(yes|haan|ha|ho|yep|yup|y|sahi|correct|wahi|bhej do|ok|okay|confirm|no|nahi|nako|wrong|galat|cancel|n|thanks|thank you|shukriya|please|pls|plz)$/i.test(
        cleaned.toLowerCase().replace(/[^\w\s]/g, '').trim()
      );
      const isValidName = !isGreetingAgain && !isAffirmativeOrNegative && cleaned.length >= 2 && cleaned.length <= 50 && /^[\p{L}\s.']{2,50}$/u.test(cleaned);

      if (!isValidName) {
        const retryMsg = `Please enter your name to complete the order confirmation:`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, retryMsg, 'customer_medicine_clarification', 'Customer');
        return true;
      }

      const formattedName = cleaned
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      const existingCust = await db.get(
        `SELECT id FROM customers WHERE phone LIKE ? OR phone LIKE ? LIMIT 1`,
        [`%${cleanDigits}`, `%${cleanDigits.slice(-10)}`]
      );
      if (existingCust?.id) {
        await db.run(`UPDATE customers SET name = ? WHERE id = ?`, [formattedName, existingCust.id]);
      } else {
        await db.run(
          `INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [formattedName, cleanDigits]
        );
      }
      if (chatId) {
        await db.run(`UPDATE whatsapp_chats SET name = ? WHERE id = ?`, [formattedName, chatId]);
      }

      await proceedWithConfirmedProcurement(
        phone,
        cleanDigits,
        pending,
        formattedName,
        db,
        chatId
      );
      return true;
    }

    // Step: awaiting_order_type (Customer was greeted, now picks 1 / 2 / 3)
    if (pending.step === 'awaiting_order_type') {
      const picked = body.trim();
      const isOne   = /^1$/.test(picked);
      const isTwo   = /^2$/.test(picked);
      const isThree = /^(3|refill|same|wahi|repeat)$/i.test(picked);

      if (isOne) {
        // Single medicine — advance to awaiting_medicine
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_medicine', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const askMsg = `✍️ Please type the *medicine name* (and quantity if known).\n\nExample: *Dolo 650 - 2 strips*`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, askMsg, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
        return true;
      }

      if (isTwo) {
        // Multiple medicines — advance to awaiting_multi_medicine_list
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_multi_medicine_list', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const askMsg =
          `📋 Please send your *complete medicine list* with quantities.\n\n` +
          `Example:\n` +
          `• Dolo 650 - 2 strips\n` +
          `• Pan D - 1 strip\n` +
          `• Nicotex 4 - 1 pack\n\n` +
          `_You can also send a prescription photo instead._`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, askMsg, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
        return true;
      }

      if (isThree) {
        // Refill — look up past prescriptions for this phone
        const last10 = cleanDigits;
        let refillRows: any[] = [];
        try {
          refillRows = await db.all(
            `SELECT m.name AS medicine_name, pr.quantity_needed, pr.refill_interval_days, pr.last_refill_date
             FROM patient_refills pr JOIN medicines m ON m.id = pr.medicine_id
             WHERE pr.patient_phone LIKE ? AND pr.is_active = 1 AND pr.status NOT IN ('completed','canceled')
             ORDER BY pr.last_refill_date DESC LIMIT 10`,
            [`%${last10}`]
          );
        } catch (_) {}

        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');

        if (refillRows && refillRows.length > 0) {
          const itemListText = refillRows.map((r: any) =>
            `• *${r.medicine_name}* × ${r.quantity_needed || 1} strip`
          ).join('\n');

          await db.run(
            `UPDATE wa_pending_clarifications SET step = 'awaiting_refill_choice', items_json = ?, created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
            [JSON.stringify(refillRows), pending.phone]
          );

          const refillMsg =
            `🔁 *Your last prescription was:*\n${itemListText}\n\n` +
            `*Same as before or any changes?*\n` +
            `1️⃣ Same — book exactly this\n` +
            `2️⃣ Change quantities\n` +
            `3️⃣ Different medicines this time\n` +
            `4️⃣ Talk to pharmacist directly 📞`;
          await whatsappQueueWorker.enqueue(phone, refillMsg, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
        } else {
          // No past prescription found — offer fresh order or pharmacist
          const { getStorePhone: getPhoneForRefill, getStoreMedicalName: getNameForRefill } = await import('./storeSettingsService.js');
          const storePhoneForRefill = await getPhoneForRefill(db);
          const storeNameForRefill = await getNameForRefill(db);

          await db.run(
            `UPDATE wa_pending_clarifications SET step = 'awaiting_order_type', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
            [pending.phone]
          );

          const noRefillMsg =
            `🔍 We couldn\'t find a previous prescription for your number.\n\n` +
            `Would you like to:\n` +
            `1️⃣ Order a new medicine\n` +
            `2️⃣ Multiple medicines\n` +
            (storePhoneForRefill
              ? `3️⃣ Talk to pharmacist: ${storePhoneForRefill} 📞`
              : `3️⃣ Talk to pharmacist directly 📞`);
          await whatsappQueueWorker.enqueue(phone, noRefillMsg, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
        }
        return true;
      }

      // Customer typed something else instead of 1/2/3 — re-prompt
      const reprompt =
        `Please reply with:\n` +
        `1️⃣ Single Medicine\n` +
        `2️⃣ Multiple Medicines\n` +
        `3️⃣ Refill`;
      const { whatsappQueueWorker: qwReprompt } = await import('./whatsappQueueWorker.js');
      await qwReprompt.enqueue(phone, reprompt, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
      return true;
    }

    // Step: awaiting_refill_choice (Selected 1/2/3/4 from refill menu)
    if (pending.step === 'awaiting_refill_choice') {
      const picked = body.trim();
      const isOne   = /^1$/.test(picked);
      const isTwo   = /^2$/.test(picked);
      const isThree = /^3$/.test(picked);
      const isFour  = /^(4|pharmacist|doctor|call|phone|contact)$/i.test(picked);
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');

      if (isOne) {
        // Book same as before
        let bundle: any[] = [];
        try { bundle = JSON.parse(pending.items_json || '[]'); } catch (_) {}
        if (bundle.length > 0) {
          const itemListText = bundle.map((item: any, idx: number) =>
            `${idx + 1}. *${item.medicine_name}* × ${item.quantity_needed || 1} strip`
          ).join('\n');
          await db.run(
            `UPDATE wa_pending_clarifications SET step = 'awaiting_confirmation', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
            [pending.phone]
          );
          const confirmMsg =
            `✅ Please confirm your refill order:\n\n${itemListText}\n\n` +
            `Reply *YES* to confirm or *NO* to cancel.`;
          await whatsappQueueWorker.enqueue(phone, confirmMsg, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
        } else {
          await db.run(
            `UPDATE wa_pending_clarifications SET step = 'awaiting_order_type', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
            [pending.phone]
          );
          await whatsappQueueWorker.enqueue(phone, `Please type the medicine name to order.`, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
        }
        return true;
      }

      if (isTwo) {
        // Change quantities — go to multi-medicine list with existing items pre-noted
        let bundle: any[] = [];
        try { bundle = JSON.parse(pending.items_json || '[]'); } catch (_) {}
        const existingList = bundle.length > 0
          ? bundle.map((r: any) => `• ${r.medicine_name}`).join('\n')
          : '';
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_multi_medicine_list', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const changeQtyMsg =
          `📝 Please re-send your medicines with *updated quantities*:\n` +
          (existingList ? `\nYour previous list was:\n${existingList}\n\n` : '\n') +
          `Example:\n• Dolo 650 - 3 strips\n• Pan D - 2 strips`;
        await whatsappQueueWorker.enqueue(phone, changeQtyMsg, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
        return true;
      }

      if (isThree) {
        // Different medicines — treat like new multi-medicine order
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_multi_medicine_list', items_json = NULL, created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const newListMsg =
          `📋 Please send your *new medicine list* with quantities.\n\n` +
          `Example:\n• Dolo 650 - 2 strips\n• Pan D - 1 strip`;
        await whatsappQueueWorker.enqueue(phone, newListMsg, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
        return true;
      }

      if (isFour) {
        // Talk to pharmacist — send store phone
        const { getStorePhone: getPhoneForChat, getStoreMedicalName: getNameForChat, getPharmacyOperatingSchedule: getSchedForChat } = await import('./storeSettingsService.js');
        const storePhoneForChat = await getPhoneForChat(db);
        const storeNameForChat  = await getNameForChat(db);
        const schedForChat      = await getSchedForChat(db);
        await db.run(`DELETE FROM wa_pending_clarifications WHERE phone = ?`, [pending.phone]);
        const pharmacistMsg =
          `📞 *${storeNameForChat}*\n\n` +
          `For complex orders or prescription changes,\nplease contact our pharmacist directly:\n\n` +
          (storePhoneForChat ? `📱 *${storePhoneForChat}*\n` : '') +
          `🕐 Available: ${schedForChat.openTime} – ${schedForChat.closeTime}${schedForChat.weeklyOff ? ` (Closed: ${schedForChat.weeklyOff})` : ''}\n\n` +
          `Our team will be happy to assist you! 🙏`;
        await whatsappQueueWorker.enqueue(phone, pharmacistMsg, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
        return true;
      }

      // Invalid reply — reprompt
      const repromptRefill =
        `Please reply with:\n` +
        `1️⃣ Same — book exactly this\n` +
        `2️⃣ Change quantities\n` +
        `3️⃣ Different medicines\n` +
        `4️⃣ Talk to pharmacist`;
      await whatsappQueueWorker.enqueue(phone, repromptRefill, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
      return true;
    }

    // Step: awaiting_multi_medicine_list (Customer sends their full medicine list)
    if (pending.step === 'awaiting_multi_medicine_list') {
      const listText = body.trim();
      if (listText.length < 3) {
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(
          phone,
          `Please type your medicine list (e.g. "Dolo 650 - 2 strips, Pan D - 1 strip").`,
          'customer_medicine_clarification',
          activeCustomerName || customer?.name || 'Customer'
        );
        return true;
      }
      // Parse the list as multi-candidate, build bundle, store in items_json and advance to awaiting_confirmation
      let bundledItems: Array<{ requestedName: string; matchedName: string; quantity: number; unit: string }> = [];
      try {
        const cands = extractMedicineCandidates(listText);
        for (const cand of cands) {
          let matched = cand.medicineName;
          try {
            const res = await productNameFilterService.filterProductNames(cand.medicineName, { minConfidenceThreshold: 0.5 });
            if (res?.matches?.[0]) matched = res.matches[0];
          } catch (_) {}
          bundledItems.push({ requestedName: cand.medicineName, matchedName: matched, quantity: cand.quantity || 1, unit: cand.unit || 'strip' });
        }
      } catch (_) {}

      if (bundledItems.length === 0) {
        // Could not parse — fall through to normal single-medicine flow by clearing step
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_medicine', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        // Fall through: let normal medicine search pick it up
        return false;
      }

      const itemListText = bundledItems.map((item, idx) => `${idx + 1}. *${item.matchedName}* × ${item.quantity} ${item.unit}`).join('\n');
      await db.run(
        `UPDATE wa_pending_clarifications SET step = 'awaiting_confirmation', items_json = ?, created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
        [JSON.stringify(bundledItems), pending.phone]
      );
      const confirmMsg =
        `✅ Please confirm your order:\n\n${itemListText}\n\n` +
        `Reply *YES* to confirm or *NO* to cancel.`;
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, confirmMsg, 'customer_medicine_clarification', activeCustomerName || customer?.name || 'Customer');
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
        // Fast index scan on Master DB for exact brand prefix match
        const brandClean = medQuery.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
        const parts = brandClean.split(/\s+/).filter(Boolean);
        const brandWord = parts[0] || '';
        const strengthWord = parts.find((p, i) => i > 0 && /\d/.test(p)) || '';

        if (brandWord.length >= 3) {
          const prefixRows = await db.all(
            `SELECT name FROM medicines 
             WHERE name LIKE ? 
             ORDER BY 
               CASE WHEN ? != '' AND name LIKE ? THEN 1 ELSE 2 END,
               name ASC 
             LIMIT 45`,
            [`${brandWord}%`, strengthWord, `%${strengthWord}%`]
          );
          if (prefixRows && prefixRows.length > 0) {
            localMatches = prefixRows.map((r: any) => r.name);
          }
        }

        // Supplement with fuzzy/FTS filter results
        const filterResult = await productNameFilterService.filterProductNames(medQuery, { minConfidenceThreshold: 0.5 });
        const ftsMatches = filterResult?.matches || [];
        for (const m of ftsMatches) {
          if (!localMatches.includes(m)) {
            localMatches.push(m);
          }
        }
      } catch (_) {}

      const pharmaQuery = sanitizePharmarackQuery(medQuery);
      let mappedCatalogHits: Array<{ name: string; mrp: number | null }> = [];
      let liveHitsForBroadcast: any[] = [];
      try {
        const { performPharmarackSearch } = await import('../routes/pharmarack.js');
        const queryTerm = (pharmaQuery || medQuery).trim();
        let searchRes = await performPharmarackSearch(queryTerm, null, true).catch(() => null);
        if ((!searchRes || searchRes.status !== 'ok' || !searchRes.items || searchRes.items.length === 0) && queryTerm.toLowerCase() !== medQuery.trim().toLowerCase()) {
          searchRes = await performPharmarackSearch(medQuery.trim(), null, true).catch(() => null);
        }

        let rawHits: any[] = (searchRes && searchRes.status === 'ok' && Array.isArray(searchRes.items)) ? searchRes.items : [];
        liveHitsForBroadcast = rawHits;

        if (rawHits.length === 0) {
          const cat = await searchCatalog(queryTerm).catch(() => null);
          if (cat?.mapped && Array.isArray(cat.mapped)) {
            rawHits = cat.mapped;
          }
        }

        if (rawHits.length > 0) {
          const seen = new Set<string>();
          for (const item of rawHits) {
            const isMapped = item.isMapped === true || item.mapped === true || item.IsMapped === 1 || String(item.isMapped) === '1' || String(item.mapped) === '1' || String(item.IsMapped) === '1';
            if (!isMapped) continue;
            if (!isItemInStock(item.stock ?? item.availability ?? item.Stock ?? item.Availability)) continue;

            const cleanName = (item.name || item.productName || item.fullName || '').trim();
            if (!cleanName || seen.has(cleanName)) continue;
            seen.add(cleanName);

            const mrpVal = (() => {
              const raw = item.mrp ?? (item as any).MRP ?? (item as any).Mrp ?? '';
              const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
              return Number.isFinite(n) && n > 0 ? n : null;
            })();

            mappedCatalogHits.push({
              name: cleanName,
              mrp: mrpVal
            });
            if (mappedCatalogHits.length >= 40) break;
          }
        }
      } catch (err) {
        console.warn('[Intent Service] Mapped catalog query note:', err);
      }

      // Broadcast live match results to admin WaRequestsPanel UI
      if (liveHitsForBroadcast.length > 0) {
        try {
          eventService.broadcast('wa_medicine_match', {
            customer,
            isNewCustomer: false,
            medicineName: medQuery,
            quantity: pending.quantity ? `${pending.quantity} ${pending.unit || 'strip'}` : '1',
            unit: pending.unit || 'strip',
            dosageForm: pending.unit || '',
            localMatches: localMatches.slice(0, 5),
            inventoryStock: {},
            availability: 'SHORTAGE',
            catalogResults: {
              mapped: liveHitsForBroadcast.filter((p: any) => p.mapped || p.isMapped),
              nonMapped: liveHitsForBroadcast.filter((p: any) => !p.mapped && !p.isMapped)
            },
            confidence: 95,
            isRepeat: false,
            source: 'text',
            messageBody: body,
            history: [],
            livePharmarackResults: liveHitsForBroadcast,
            mediaId: null,
            relatedMedicines: [],
            isStale: false
          });
        } catch (_) {}
      }

      if (mappedCatalogHits.length === 0) {
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_owner_selection', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const waitMsg = `Your request for *${medQuery}* has been received and forwarded to our pharmacy team — checking availability with our partner distributors now.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_medicine_clarification', customer?.name || 'Customer');

        const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db);
        if (adminWhatsapp) {
          const ownerMsg =
            `⚠️ *Special Order Request (Manual Sourcing Needed)*\n\n` +
            `👤 Customer: ${customer?.name || 'Customer'} (+91 ${cleanDigits})\n` +
            `💊 Medicine: *${medQuery}*\n\n` +
            `No mapped partner distributor stock found in Pharmarack catalog. Please check manual sources or unmapped distributors.`;
          await whatsappQueueWorker.enqueue(adminWhatsapp, ownerMsg, 'admin_escalation', 'Owner');
        }
        return true;
      }

      if (mappedCatalogHits.length === 1) {
        const singleMed = mappedCatalogHits[0];
        const singleMrpVal2 = (() => { const n = typeof singleMed.mrp === 'number' ? singleMed.mrp : parseFloat(String(singleMed.mrp ?? '')); return Number.isFinite(n) && n > 0 ? n : null; })();
        const mrpStr = singleMrpVal2 != null ? `\n🏷️ MRP: ₹${singleMrpVal2.toFixed(2)}` : '';
        await db.run(
          `UPDATE wa_pending_clarifications
           SET suggested_name = ?, selected_option = ?, mrp = ?, original_query = ?, options_json = NULL, step = 'awaiting_medicine_confirmation', created_at = CURRENT_TIMESTAMP
           WHERE phone = ?`,
          [singleMed.name, singleMed.name, singleMrpVal2, medQuery, pending.phone]
        );
        const confirmPrompt = `💊 Medicine selected:\n*${singleMed.name}*${mrpStr}\n\nIs this the medicine you need?\n\nReply *1* (or *YES*) to confirm or *2* (or *NO*) to search again.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, confirmPrompt, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }

      const PAGE_SIZE = 10;
      const initialSlice = mappedCatalogHits.slice(0, PAGE_SIZE);
      const formatNum = (idx: number) => {
        const emojiNums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        return idx < 10 ? emojiNums[idx] : `${idx + 1}.`;
      };
      // Helper: shorten a long catalog name to brand + strength for WhatsApp readability
      const shortenName = (fullName: string): string => {
        // Remove trailing noise like (PACK OF 10), (ALU-ALU), (STRIP OF 10) etc.
        const clean = fullName
          .replace(/\s*\(\s*(strip|pack|alu|blister|bottle|vial|box|ml|gm|mg|kg|unit|tab|cap|sachet|tube|infusion|injection)\s*(of|x)?\s*\d*\s*\)?\s*$/i, '')
          .replace(/\s*-\s*(strip|pack|alu|box|bottle)\s*(of|x)?\s*\d*\s*$/i, '')
          .trim();
        // Cap at 40 chars so it fits one line on a mobile screen
        return clean.length > 40 ? clean.slice(0, 38) + '…' : clean;
      };
      const parseMrp = (raw: any): number | null => {
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const optionsList = initialSlice.map((opt, i) => {
        const mrpVal = parseMrp(opt.mrp);
        const mrpStr = mrpVal != null ? `MRP: ₹${mrpVal.toFixed(2)}` : 'MRP: N/A';
        return `${formatNum(i)} *${shortenName(opt.name)}*\n   ${mrpStr}`;
      }).join('\n\n');

      const totalCount = mappedCatalogHits.length;
      const totalPages = Math.ceil(totalCount / PAGE_SIZE);
      const pageInfo = totalCount > PAGE_SIZE ? ` (Page 1 of ${totalPages})` : '';
      const moreHint = totalCount > PAGE_SIZE ? `\n👉 Reply *MORE* to see more options.` : '';
      const promptMsg = `🔎 *${medQuery}* — ${totalCount} in-stock options from partner distributors${pageInfo}:\n\n${optionsList}\n\n👉 _Reply with the number to select._${moreHint}\n👉 _Reply *0* if your medicine is not listed._`;

      await db.run(
        `UPDATE wa_pending_clarifications
         SET suggested_name = ?, original_query = ?, mrp = ?, options_json = ?, step = 'awaiting_selection', created_at = CURRENT_TIMESTAMP
         WHERE phone = ?`,
        [mappedCatalogHits[0].name, medQuery, mappedCatalogHits[0].mrp, JSON.stringify({ allOptions: mappedCatalogHits, page: 0 }), pending.phone]
      );

      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, promptMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
      return true;
    }

    // Step: awaiting_selection (Customer sends number of the medicine option or MORE)
    if (pending.step === 'awaiting_selection' && pending.options_json) {
      let options: any[] = [];
      let currentPage = 0;
      const PAGE_SIZE = 10;
      try {
        const parsed = JSON.parse(pending.options_json);
        if (Array.isArray(parsed)) {
          options = parsed;
          currentPage = 0;
        } else if (parsed && Array.isArray(parsed.allOptions)) {
          options = parsed.allOptions;
          currentPage = Number(parsed.page || 0);
        }
      } catch (_) {
        options = [];
      }

      const formatNum = (idx: number) => {
        const emojiNums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        return idx < 10 ? emojiNums[idx] : `${idx + 1}.`;
      };
      const shortenName = (fullName: string): string => {
        const clean = fullName
          .replace(/\s*\(\s*(strip|pack|alu|blister|bottle|vial|box|ml|gm|mg|kg|unit|tab|cap|sachet|tube|infusion|injection)\s*(of|x)?\s*\d*\s*\)?\s*$/i, '')
          .replace(/\s*-\s*(strip|pack|alu|box|bottle)\s*(of|x)?\s*\d*\s*$/i, '')
          .trim();
        return clean.length > 40 ? clean.slice(0, 38) + '…' : clean;
      };
      const parseMrp = (raw: any): number | null => {
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      // Check if customer asked for "MORE" or "BACK" pagination
      const isMore = /^(more|next|aage|aur|show more)$/i.test(lower);
      const isBack = /^(back|prev|previous|piche)$/i.test(lower);
      if ((isMore || isBack) && options.length > PAGE_SIZE) {
        const totalPages = Math.ceil(options.length / PAGE_SIZE);
        const nextPage = isBack
          ? (currentPage - 1 + totalPages) % totalPages
          : (currentPage + 1) % totalPages;
        const startIdx = nextPage * PAGE_SIZE;
        const currentSlice = options.slice(startIdx, startIdx + PAGE_SIZE);

        const optionsList = currentSlice.map((opt: any, i: number) => {
          const optName = typeof opt === 'string' ? opt : (opt?.name || '');
          const mrpVal = parseMrp(opt?.mrp);
          const mrpStr = mrpVal != null ? `MRP: ₹${mrpVal.toFixed(2)}` : 'MRP: N/A';
          return `${formatNum(startIdx + i)} *${shortenName(optName)}*\n   ${mrpStr}`;
        }).join('\n\n');

        const navHints: string[] = [];
        if (nextPage < totalPages - 1) navHints.push(`Reply *MORE* for next`);
        if (nextPage > 0) navHints.push(`Reply *BACK* for previous`);
        const navHintStr = navHints.length > 0 ? `\n👉 ${navHints.join(' | ')}.` : '';

        const promptMsg = `🔎 Options (${startIdx + 1}–${startIdx + currentSlice.length} of ${options.length}) for *${pending.original_query || 'medicine'}* (Page ${nextPage + 1} of ${totalPages}):\n\n${optionsList}\n\n👉 _Reply with the number (${startIdx + 1}–${startIdx + currentSlice.length}) to select._${navHintStr}\n👉 _Reply *0* if your medicine is not listed._`;

        await db.run(
          `UPDATE wa_pending_clarifications
           SET options_json = ?, created_at = CURRENT_TIMESTAMP
           WHERE phone = ?`,
          [JSON.stringify({ allOptions: options, page: nextPage }), pending.phone]
        );

        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, promptMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }

      // Check for '0' or 'not in list' escalation (Human-in-the-Loop)
      const isEscalateToPharmacist = /^(?:option\s*)?0$|^(?:none|not\s*in\s*list|not\s*listed|nahi\s*mila|pharmacist|human|help|other)$/i.test(lower);
      if (isEscalateToPharmacist) {
        await db.run(
          `UPDATE wa_pending_clarifications SET step = 'awaiting_owner_selection', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
          [pending.phone]
        );
        const waitMsg = `👨‍⚕️ Got it! We've forwarded your request for *${pending.original_query || pending.suggested_name || 'your medicine'}* directly to our pharmacist. We will check offline distributor catalogs and get back to you shortly.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, waitMsg, 'customer_medicine_clarification', customer?.name || 'Customer');

        const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db);
        if (adminWhatsapp) {
          const ownerMsg =
            `⚠️ *Special Order Request (Customer Requested Manual Sourcing)*\n\n` +
            `👤 Customer: ${customer?.name || 'Customer'} (+91 ${cleanDigits})\n` +
            `💊 Medicine: *${pending.original_query || pending.suggested_name || 'Medicine'}*\n\n` +
            `Customer indicated their desired variant was not in the partner distributor options. Please check manual sources or unmapped distributors.`;
          await whatsappQueueWorker.enqueue(adminWhatsapp, ownerMsg, 'admin_escalation', 'Owner');
        }
        return true;
      }

      let chosenIndex = -1;
      const numMatch = lower.match(/^(?:option\s*)?(\d{1,3})$/i);
      if (numMatch) {
        const enteredNum = parseInt(numMatch[1], 10);
        const n = enteredNum - 1;
        if (n >= 0 && n < options.length) {
          chosenIndex = n;
        } else {
          // Check if entered number matches the strength in any of the options (e.g. user typed 100 for 100mg)
          const strengthRegex = new RegExp(`\\b${enteredNum}\\s*(?:mg|ml|gm|mcg|iu)?\\b`, 'i');
          const strengthMatchIdx = options.findIndex((opt: any) => {
            const optName = typeof opt === 'string' ? opt : (opt?.name || '');
            return strengthRegex.test(optName);
          });
          if (strengthMatchIdx !== -1) {
            chosenIndex = strengthMatchIdx;
          } else {
            const outOfRangeMsg = `⚠️ Option ${enteredNum} is not on the list. Please reply with a number between 1 and ${options.length}${options.length > PAGE_SIZE ? ', reply *MORE* to see more options' : ''}, or reply *0* if not listed.`;
            const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
            await whatsappQueueWorker.enqueue(phone, outOfRangeMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
            return true;
          }
        }
      } else {
        // Match by text only if input is at least 3 letters and NOT pure numbers
        if (lower.length >= 3 && !/^\d+$/.test(lower)) {
          const idx = options.findIndex((opt: any) => {
            const optName = typeof opt === 'string' ? opt : (opt?.name || '');
            return optName.toLowerCase().includes(lower) || lower.includes(optName.toLowerCase());
          });
          if (idx !== -1) {
            chosenIndex = idx;
          } else {
            // Smart Refine: Re-query partner distributor catalog with the new search term
            const newQuery = body.trim();
            const pharmaQuery = sanitizePharmarackQuery(newQuery);
            const { performPharmarackSearch } = await import('../routes/pharmarack.js');
            const queryTerm = (pharmaQuery || newQuery).trim();
            let searchRes = await performPharmarackSearch(queryTerm, null, true).catch(() => null);
            if ((!searchRes || searchRes.status !== 'ok' || !searchRes.items || searchRes.items.length === 0) && queryTerm.toLowerCase() !== newQuery.toLowerCase()) {
              searchRes = await performPharmarackSearch(newQuery, null, true).catch(() => null);
            }
            let rawHits: any[] = (searchRes && searchRes.status === 'ok' && Array.isArray(searchRes.items)) ? searchRes.items : [];
            if (rawHits.length === 0) {
              const cat = await searchCatalog(queryTerm).catch(() => null);
              if (cat?.mapped && Array.isArray(cat.mapped)) {
                rawHits = cat.mapped;
              }
            }

            const newMappedHits: Array<{ name: string; mrp: number | null }> = [];
            const seen = new Set<string>();
            for (const item of rawHits) {
              const isMapped = item.isMapped === true || item.mapped === true || item.IsMapped === 1 || String(item.isMapped) === '1' || String(item.mapped) === '1' || String(item.IsMapped) === '1';
              if (!isMapped) continue;
              if (!isItemInStock(item.stock ?? item.availability ?? item.Stock ?? item.Availability)) continue;
              const cleanName = (item.name || item.productName || item.fullName || '').trim();
              if (!cleanName || seen.has(cleanName)) continue;
              seen.add(cleanName);
              newMappedHits.push({ name: cleanName, mrp: parseMrp(item.mrp ?? (item as any).MRP ?? (item as any).Mrp) });
              if (newMappedHits.length >= 40) break;
            }

            if (newMappedHits.length > 0) {
              const totalNew = newMappedHits.length;
              const totalNewPages = Math.ceil(totalNew / PAGE_SIZE);
              const initialSlice = newMappedHits.slice(0, PAGE_SIZE);
              const optionsList = initialSlice.map((opt, i) => {
                const mrpVal = parseMrp(opt.mrp);
                const mrpStr = mrpVal != null ? `MRP: ₹${mrpVal.toFixed(2)}` : 'MRP: N/A';
                return `${formatNum(i)} *${shortenName(opt.name)}*\n   ${mrpStr}`;
              }).join('\n\n');
              const pageIndicator = totalNew > PAGE_SIZE ? ` (Page 1 of ${totalNewPages})` : '';
              const moreHint = totalNew > PAGE_SIZE ? `\n👉 Reply *MORE* to see more options.` : '';
              const promptMsg = `🔎 *${newQuery}* — ${totalNew} in-stock options from partner distributors${pageIndicator}:\n\n${optionsList}\n\n👉 _Reply with the number to select._${moreHint}\n👉 _Reply *0* if your medicine is not listed._`;

              await db.run(
                `UPDATE wa_pending_clarifications
                 SET suggested_name = ?, original_query = ?, mrp = ?, options_json = ?, step = 'awaiting_selection', created_at = CURRENT_TIMESTAMP
                 WHERE phone = ?`,
                [newMappedHits[0].name, newQuery, newMappedHits[0].mrp, JSON.stringify({ allOptions: newMappedHits, page: 0 }), pending.phone]
              );

              const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
              await whatsappQueueWorker.enqueue(phone, promptMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
              return true;
            }
          }
        }
      }

      if (chosenIndex !== -1 && options[chosenIndex]) {
        const chosen = options[chosenIndex];
        const chosenMedicine = typeof chosen === 'string' ? chosen : (chosen?.name || '');
        const chosenMrp = typeof chosen === 'object' && chosen?.mrp != null && chosen.mrp > 0 ? Number(chosen.mrp) : null;
        await db.run(
          `UPDATE wa_pending_clarifications 
           SET suggested_name = ?, selected_option = ?, mrp = ?, step = 'awaiting_medicine_confirmation', created_at = CURRENT_TIMESTAMP 
           WHERE phone = ?`,
          [chosenMedicine, chosenMedicine, chosenMrp, pending.phone]
        );
        const mrpStr = chosenMrp ? `\n🏷️ MRP: ₹${chosenMrp.toFixed(2)}` : '';
        const confirmPrompt = `💊 Medicine selected:\n*${chosenMedicine}*${mrpStr}\n\nIs this the medicine you need?\n\nReply *1* (or *YES*) to confirm or *2* (or *NO*) to search again.`;
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
        const mrpSuffix = pending.mrp != null && pending.mrp > 0 ? ` (MRP ₹${Number(pending.mrp).toFixed(2)})` : '';
        const qtyPrompt = `✅ Medicine confirmed: *${pending.suggested_name}*${mrpSuffix}\n\n📦 Please enter the quantity you need.`;
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
        const unitMrp = pending.mrp != null && pending.mrp > 0 ? Number(pending.mrp) : null;
        const mrpDetails = unitMrp ? `\n🏷️ MRP: ₹${unitMrp.toFixed(2)} per ${finalUnit}\n💰 Total MRP: ₹${(unitMrp * finalQty).toFixed(2)}` : '';
        const confirmPrompt = `Please confirm your request:\n\n💊 Medicine: *${pending.suggested_name}*\n📦 Quantity: ${finalQty} ${finalUnit}${mrpDetails}\n\nReply *1* (or *YES*) to confirm.`;
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

        // Single confirmed medicine flow (Direct procurement + Staged Quick Assist message)
        let custName = activeCustomerName;
        if (!custName) {
          const freshCust = await lookupCustomer(cleanDigits);
          if (freshCust?.name && isKnownCustomerName(freshCust.name)) {
            custName = freshCust.name.trim();
          }
        }

        if (!custName) {
          await db.run(
            `UPDATE wa_pending_clarifications SET step = 'awaiting_order_customer_name', created_at = CURRENT_TIMESTAMP WHERE phone = ?`,
            [pending.phone]
          );
          const askNameMsg = `Before we confirm your request for *${pending.suggested_name}* × ${pending.quantity || 1}, *may I please know your name?*`;
          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(phone, askNameMsg, 'customer_medicine_clarification', 'Customer');
          return true;
        }

        await proceedWithConfirmedProcurement(
          phone,
          cleanDigits,
          pending,
          custName,
          db,
          chatId
        );
        return true;
      }

      // Quantity adjustment during confirmation (e.g. "Actually make it 3" or customer typing a different quantity)
      const adjustedQty = extractQuantityFromText(body);
      if (adjustedQty && adjustedQty.quantity > 0 && !isAffirmative) {
        await db.run(
          `UPDATE wa_pending_clarifications 
           SET quantity = ?, unit = ?, step = 'awaiting_qty_confirmation', created_at = CURRENT_TIMESTAMP 
           WHERE phone = ?`,
          [adjustedQty.quantity, adjustedQty.unit || 'strip', pending.phone]
        );
        const unitMrp = pending.mrp != null && pending.mrp > 0 ? Number(pending.mrp) : null;
        const mrpDetails = unitMrp ? `\n🏷️ MRP: ₹${unitMrp.toFixed(2)} per ${adjustedQty.unit || 'strip'}\n💰 Total MRP: ₹${(unitMrp * adjustedQty.quantity).toFixed(2)}` : '';
        const confirmPrompt = `Updated:\n💊 Medicine: *${pending.suggested_name}*\n📦 Quantity: ${adjustedQty.quantity} ${adjustedQty.unit || 'strip'}${mrpDetails}\n\nReply *1* (or *YES*) to confirm.`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, confirmPrompt, 'customer_medicine_clarification', customer?.name || 'Customer');
        return true;
      }
    }

    // Negative answer fallback if in another step
    if (isNegative) {
      await db.run(`DELETE FROM wa_pending_clarifications WHERE phone = ?`, [pending.phone]);
      const ackMsg = `Understood! Please reply with the exact medicine name or send a clear photo of your prescription / medicine strip, and our pharmacist will check it for you.`;
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, ackMsg, 'customer_inquiry_rejected', activeCustomerName || customer?.name || 'Customer');
      console.log(`[Intent Service] Customer ${cleanDigits} cancelled pending clarification.`);
      return true;
    }

  } catch (err) {
    console.warn('[Intent Service] Error checking medicine clarification response:', err);
  }
  return false;
}

/**
 * Generates dynamic Special Order Code based on Store Name initials + Address first 2 letters + Order ID.
 * Format: SO-[STORE_INITIALS][ADDR_2]-[ORDER_ID] e.g., SO-TMSA-10452
 * Example:
 * Store "TANAMAY MEDICAL", Address "Sadashiv Peth" -> "TM" + "SA" = "TMSA" -> "SO-TMSA-10452"
 */
export async function generateStoreSpecialOrderCode(db: any, storeId: number = 1, orderId: number): Promise<string> {
  try {
    const store = await db.get('SELECT name, address FROM stores WHERE id = ?', [storeId]);
    if (store) {
      // 1. Store Name initials (e.g. "TANAMAY MEDICAL" -> "TM")
      const words = String(store.name || '').trim().split(/\s+/).filter(Boolean);
      let nameInitials = words.map((w: string) => w[0]?.toUpperCase() || '').join('').slice(0, 4);
      if (!nameInitials) nameInitials = 'TM';

      // 2. Address first 2 letters (e.g. "Sadashiv Peth" -> "SA")
      let cleanAddr = String(store.address || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
      if (cleanAddr.startsWith('MAINPHARMACYCOUNTER') && (nameInitials === 'TM' || storeId === 1)) {
        cleanAddr = 'SA';
      }
      let addrLetters = cleanAddr.slice(0, 2);
      if (addrLetters.length < 2) addrLetters = 'SA';

      return `SO-${nameInitials}${addrLetters}-${orderId}`;
    }
  } catch (err) {
    console.warn('[Special Order] Error generating store special order code:', err);
  }
  return `SO-TMSA-${orderId}`;
}

async function proceedWithConfirmedProcurement(
  phone: string,
  cleanDigits: string,
  pending: any,
  customerName: string,
  db: any,
  chatId?: string
): Promise<boolean> {
  const medName = pending.suggested_name;
  const medQty = pending.quantity || 1;
  const medUnit = pending.unit || 'strip';

  // 2-Stage Timed Search Workflow:
  // Step 1: Search 1st word (e.g. "dolo")
  // Step 2: 1-second pause
  // Step 3: Search 2nd word / 2-word core (e.g. "dolo 650")
  // Step 4: 5-second wait to let OpenSearch index / distributor pool settle
  // Step 5: Check & verify results before dispatching to owner
  const pharmaQuery = sanitizePharmarackQuery(medName);
  const coreWords = (pharmaQuery || medName).split(/\s+/).filter(Boolean);
  const word1 = coreWords[0] || medName;
  const word2 = coreWords.length >= 2 ? coreWords.slice(0, 2).join(' ') : (pharmaQuery || medName);

  let rawPharmarackItems: any[] = [];
  let searchFailed = false;
  try {
    const { performPharmarackSearch } = await import('../routes/pharmarack.js');

    // Stage 1: Search first word (if different from word2)
    if (word1 && word1.toLowerCase() !== word2.toLowerCase()) {
      await performPharmarackSearch(word1, null, true).catch(() => null);
      // 1-second pause
      await new Promise(r => setTimeout(r, 1000));
    }

    // Stage 2: Search 2nd word / 2-word core
    let searchRes = await performPharmarackSearch(word2, null, true);
    if (searchRes.status === 'connection_error') {
      searchRes = await performPharmarackSearch(word2, null, true);
    }
    if (searchRes && searchRes.status === 'ok' && Array.isArray(searchRes.items)) {
      rawPharmarackItems = searchRes.items;
    }

    // 5-second wait to let OpenSearch distributor pool settle
    await new Promise(r => setTimeout(r, 5000));

    // Settle check: If initial call returned 0 items, re-query to capture settled results
    if (rawPharmarackItems.length === 0) {
      searchRes = await performPharmarackSearch(word2, null, true);
      if (searchRes && searchRes.status === 'ok' && Array.isArray(searchRes.items)) {
        rawPharmarackItems = searchRes.items;
      } else {
        searchFailed = true;
      }
    }
  } catch (_) {
    searchFailed = true;
  }

  if (rawPharmarackItems.length === 0) {
    try {
      const cat = await searchCatalog(pharmaQuery || medName);
      rawPharmarackItems = [...(cat.mapped || []), ...(cat.nonMapped || [])];
      if (rawPharmarackItems.length > 0) searchFailed = false;
    } catch (_) {}
  }

  // Filter out all out-of-stock items
  const inStockCandidates = rawPharmarackItems.filter(p => isItemInStock(p.availability ?? (p as any).stock));

  // Create Special Order
  const todayStr = new Date().toISOString().split('T')[0];
  const orderRes = await db.run(
    `INSERT INTO special_orders (
       store_id, requester, phone, medicine_name, product, qty, priority, status,
       date, notified, customer_order_source, total_amount, advance_payment, payment_status,
       pharmarack_mrp
     ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Pending', ?, 0, 'whatsapp', 50, 50, 'UNPAID', ?)`,
    [
      1,
      customerName,
      cleanDigits,
      medName,
      medName,
      medQty,
      todayStr,
      pending.mrp != null && pending.mrp > 0 ? Number(pending.mrp) : null
    ]
  );
  const specialOrderId = Number(orderRes.lastID) || 0;
  const soCode = await generateStoreSpecialOrderCode(db, 1, specialOrderId);

  // Link Special Order to pending clarification
  await db.run(
    `UPDATE wa_pending_clarifications
     SET step = 'awaiting_owner_selection', special_order_id = ?, so_code = ?, customer_name = ?, created_at = CURRENT_TIMESTAMP
     WHERE phone = ?`,
    [specialOrderId, soCode, customerName, pending.phone]
  );

  // Strict formulation/variant shield: reject mismatched single-salts or conflicting combinations
  const validCandidates = filterCandidatesByFormulation(medName, inStockCandidates);

  if (validCandidates.length > 0) {
    const { rankSpecialOrderDistributorCandidates } = await import('../routes/pharmarack.js');
    const rankedOptions = await rankSpecialOrderDistributorCandidates(db, validCandidates, 10, 2, medName);
    const finalOptions = rankedOptions.length > 0 ? rankedOptions : validCandidates.slice(0, 10);

    // Notify owner with in-stock results
    await waAdminEscalationService.notifyOwnerOfSpecialOrderPharmarackResults({
      specialOrderId,
      soCode,
      customerName,
      customerPhone: cleanDigits,
      medicineName: medName,
      quantity: medQty,
      unit: medUnit,
      pharmarackOptions: finalOptions
    });

    // Courtesy message to customer
    const mrpSuffix = pending.mrp != null && pending.mrp > 0 ? ` (MRP ₹${Number(pending.mrp).toFixed(2)})` : '';
    const custWaitMsg = `Your request for *${medName}* × ${medQty}${mrpSuffix} has been forwarded to our pharmacy for distributor confirmation.\n\nWe will send you payment details shortly.`;
    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
    await whatsappQueueWorker.enqueue(phone, custWaitMsg, 'customer_inquiry_confirmed', customerName);
  } else {
    // No valid candidates — but distinguish a genuine zero-stock result from
    // a search that actually failed (timeout/network). Telling the customer
    // "out of stock with all suppliers" when the search never really
    // completed is a false claim; the owner needs the truthful state.
    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
    const custMsg = searchFailed
      ? `Your request for *${medName}* × ${medQty} has been forwarded to our pharmacy — our distributor search is temporarily unavailable, so we'll confirm availability shortly.`
      : `We checked our distributor network for *${medName}*, but it is currently out of stock with all suppliers.\n\nOur pharmacy has been notified (Ref: ${soCode}) to arrange it for you manually.`;
    await whatsappQueueWorker.enqueue(phone, custMsg, 'customer_inquiry_confirmed', customerName);

    const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db);
    if (adminWhatsapp) {
      const ownerOosMsg = searchFailed
        ? `⚠️ *Special Order ${soCode} (Search Failed — Needs Manual Check)*\n\nCustomer: ${customerName} (+91 ${cleanDigits})\nMedicine: *${medName}* × ${medQty}\nPharmarack search did not complete (timeout/connection issue) — this is NOT a confirmed out-of-stock. Please check availability manually.`
        : `⚠️ *Special Order ${soCode} (All Distributors OOS)*\n\nCustomer: ${customerName} (+91 ${cleanDigits})\nMedicine: *${medName}* × ${medQty}\nAll checked Pharmarack distributors are currently out of stock.`;
      await whatsappQueueWorker.enqueue(adminWhatsapp, ownerOosMsg, 'admin_escalation', 'Owner');
    }
  }

  console.log(`[Intent Service] Customer confirmed request for ${medName} x ${medQty}. Created order #${specialOrderId} (${soCode}). Owner notified.`);
  return true;
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

  // Normalize emoji digits 1️⃣ - 🔟 to plain numbers
  let normalizedBody = cleanBody;
  const emojiDigits: Record<string, string> = {
    '1️⃣': '1', '2️⃣': '2', '3️⃣': '3', '4️⃣': '4', '5️⃣': '5',
    '6️⃣': '6', '7️⃣': '7', '8️⃣': '8', '9️⃣': '9', '🔟': '10'
  };
  for (const [emoji, num] of Object.entries(emojiDigits)) {
    if (normalizedBody.includes(emoji)) {
      normalizedBody = normalizedBody.replaceAll(emoji, num);
    }
  }

  // 0. Check for owner prescription review approval / rejection (Human-in-the-Loop)
  const rxActionMatch =
    cleanBody.match(/^(CONFIRM|APPROVE|APPROVED|ACCEPT|ACCEPTED|REJECT|DECLINE)[\s\-:]*(?:RX-)?(\d+)$/i) ||
    cleanBody.match(/^(?:RX-)?(\d+)\s+(CONFIRM|APPROVE|APPROVED|ACCEPT|ACCEPTED|REJECT|DECLINE)$/i) ||
    cleanBody.match(/^(CONFIRM|APPROVE|REJECT)[\s\-:]*(RX-[A-Z0-9]+)$/i);

  if (rxActionMatch) {
    const isActionFirst = isNaN(Number(rxActionMatch[1])) && !rxActionMatch[1].startsWith('RX-');
    const rawAction = isActionFirst ? rxActionMatch[1] : rxActionMatch[2];
    const rawCode = isActionFirst ? rxActionMatch[2] : rxActionMatch[1];
    const isReject = /REJECT|DECLINE/i.test(rawAction);
    const rxDigits = rawCode.replace(/\D/g, '');
    const rxCodeFormatted = rawCode.toUpperCase().startsWith('RX-') ? rawCode.toUpperCase() : `RX-${rxDigits}`;

    await waAdminEscalationService.ensureOwnerPendingRequestsTable?.(db);
    const targetRow = await db.get(
      `SELECT * FROM wa_owner_pending_requests WHERE (req_code = ? OR req_code = ?) AND status = 'pending'`,
      [rxCodeFormatted, `RX-${rxDigits}`]
    );

    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');

    if (!targetRow) {
      await whatsappQueueWorker.enqueue(
        phone,
        `⚠️ Prescription *${rxCodeFormatted}* not found or already processed.`,
        'admin_escalation',
        'Owner'
      );
      return true;
    }

    let payloadData: any = {};
    try {
      payloadData = JSON.parse(targetRow.options_json || '{}');
    } catch (_) {}

    const patientName = targetRow.customer_name || 'Patient';
    const customerPhone = targetRow.customer_phone;

    if (isReject) {
      await db.run(
        `UPDATE wa_owner_pending_requests SET status = 'rejected' WHERE id = ?`,
        [targetRow.id]
      );

      const custRejectMsg =
        `📋 *Prescription Update (#${targetRow.req_code})*\n\n` +
        `Hello *${patientName}*, our registered pharmacist reviewed the prescription photo you shared.\n\n` +
        `⚠️ Unfortunately, some medicine names or dosages were unclear from the photo.\n\n` +
        `👉 *Please reply with a clearer, well-lit photo* of the doctor's prescription slip, or type the medicine names so we can prepare your order!`;

      if (customerPhone) {
        await whatsappQueueWorker.enqueue(
          customerPhone,
          custRejectMsg,
          'customer_prescription_rejected',
          patientName
        );
      }

      await whatsappQueueWorker.enqueue(
        phone,
        `ℹ️ Prescription *#${targetRow.req_code}* rejected. Patient *${patientName}* has been asked for a clearer photo.`,
        'admin_escalation',
        'Owner'
      );
      return true;
    } else {
      // Confirmed / Approved by Pharmacist
      await db.run(
        `UPDATE wa_owner_pending_requests SET status = 'fulfilled' WHERE id = ?`,
        [targetRow.id]
      );

      const items: any[] = Array.isArray(payloadData.items) ? payloadData.items : [];
      const symbols = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      const itemsList = items.map((it, idx) => {
        const numIcon = symbols[idx] || `${idx + 1}️⃣`;
        let line = `${numIcon} *${it.medicineName}*`;
        if (it.strength && !it.medicineName.toLowerCase().includes(it.strength.toLowerCase())) {
          line += ` ${it.strength}`;
        }
        const dosageDetails = [it.dosage, it.frequency].filter(Boolean).join(' ');
        if (dosageDetails) line += ` (${dosageDetails})`;
        return line;
      }).join('\n');

      const custConfirmMsg =
        `✅ *Prescription Verified & Approved!* 🩺\n\n` +
        `Hello *${patientName}*, our registered pharmacist has reviewed and verified your doctor's prescription (#${targetRow.req_code}).\n\n` +
        (itemsList ? `💊 *Verified Medicines:*\n${itemsList}\n\n` : '') +
        `📦 We are preparing your order. Our pharmacy team will message you shortly with the final bill and delivery time! 🛵\n\n` +
        `Thank you for trusting our pharmacy!`;

      if (customerPhone) {
        await whatsappQueueWorker.enqueue(
          customerPhone,
          custConfirmMsg,
          'customer_prescription_approved',
          patientName
        );
      }

      await whatsappQueueWorker.enqueue(
        phone,
        `✅ *Prescription #${targetRow.req_code} Confirmed!*\n\nPatient *${patientName}* has been notified on WhatsApp that their prescription is approved and being packed.`,
        'admin_escalation',
        'Owner'
      );
      return true;
    }
  }

  // 1. Check for owner payment verification. Accepts "CONFIRM SO-10452", "CONFIRM 10452", "CONFIRM PAYMENT SO-10452", etc.
  // Also accepts bare "CONFIRM", "YES", "PAID" if there is an active order waiting for payment verification.
  const confirmPaymentMatch =
    cleanBody.match(/^CONFIRM(?:ED)?(?:\s+PAYMENT)?[\s\-:]*(?:SO-)?([A-Z0-9\-]*\d+)$/i) ||
    cleanBody.match(/^PAYMENT\s+CONFIRM(?:ED)?[\s\-:]*(?:SO-)?([A-Z0-9\-]*\d+)$/i) ||
    cleanBody.match(/^(?:SO-)?([A-Z0-9\-]*\d+)\s+CONFIRM(?:ED)?$/i);

  let paymentOrderIdToConfirm: number | null = null;
  if (confirmPaymentMatch) {
    const rawDigits = confirmPaymentMatch[1].replace(/\D/g, '');
    paymentOrderIdToConfirm = parseInt(rawDigits, 10);
  } else if (/^(CONFIRM|APPROVE|YES|OK|ACCEPT|PAID|CONFIRMED)$/i.test(cleanBody)) {
    // Check if an order is awaiting payment verification
    const pendingPaymentOrder = await db.get(
      `SELECT id FROM special_orders WHERE payment_status = 'SCREENSHOT_RECEIVED' ORDER BY id DESC LIMIT 1`
    );
    if (pendingPaymentOrder?.id) {
      paymentOrderIdToConfirm = pendingPaymentOrder.id;
    }
  }

  if (paymentOrderIdToConfirm) {
    const orderId = paymentOrderIdToConfirm;
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    const soCode = order ? await generateStoreSpecialOrderCode(db, order.store_id || 1, orderId) : `SO-TMSA-${orderId}`;

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

    // Resolve distributor storeId from locked special order or distributor_catalog
    let resolvedStoreId = order.pharmarack_store_id ? Number(order.pharmarack_store_id) : 0;
    if (!resolvedStoreId && order.pharmarack_distributor) {
      try {
        const dRow = await db.get(
          `SELECT store_id FROM distributor_catalog WHERE LOWER(store_name) = LOWER(?) OR LOWER(store_name) LIKE LOWER(?) LIMIT 1`,
          [order.pharmarack_distributor.trim(), `%${order.pharmarack_distributor.trim()}%`]
        );
        if (dRow && dRow.store_id) {
          resolvedStoreId = Number(dRow.store_id);
        }
      } catch (_) {}
    }

    const resolvedProdName = order.pharmarack_product_name || order.medicine_name || order.product;
    const resolvedProdId = order.pharmarack_product_id ? Number(order.pharmarack_product_id) : 0;
    const resolvedProdCode = order.pharmarack_product_code ? String(order.pharmarack_product_code) : '';

    // Add item to Pharmarack Live Cart
    const cartItem = {
      productName: resolvedProdName,
      product: resolvedProdName,
      productId: resolvedProdId,
      productCode: resolvedProdCode,
      storeId: resolvedStoreId,
      storeName: order.pharmarack_distributor || 'Standard Distributor',
      company: '',
      qty: order.qty > 0 ? order.qty : 1,
      rate: order.pharmarack_rate || 0,
      mrp: order.pharmarack_mrp || 0,
      packaging: '1 strip'
    };

    try {
      const { addItemsToPharmarackCart } = await import('../routes/pharmarack.js');
      const cartResult = await addItemsToPharmarackCart([cartItem]);
      if (cartResult?.success) {
        console.log(`[Intent Service] Live cart successfully added "${cartItem.productName}" to ${cartItem.storeName} (mode: ${cartResult.mode || 'live'})`);
      } else {
        console.warn(`[Intent Service] Live cart add note for "${cartItem.productName}":`, cartResult?.error || cartResult?.details);
      }
    } catch (cartErr) {
      console.warn('[Intent Service] Live Cart add attempt warning:', cartErr);
    }

    // Mark owner pending request fulfilled
    await db.run(
      `UPDATE wa_owner_pending_requests SET status = 'fulfilled' WHERE req_code = ? OR req_code LIKE ?`,
      [soCode, `%${orderId}`]
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
      `🎉 Hello *${order.requester || 'Customer'}*, your medicine request is confirmed!\n\n` +
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

    // Send final confirmation receipt directly to customer on WhatsApp
    const cleanCustPhone = String(order.phone || '').replace(/\D/g, '').slice(-10);
    if (cleanCustPhone) {
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(
        cleanCustPhone,
        custFinalMsg,
        'customer_order_confirmed',
        order.requester || 'Customer'
      );
    }

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
    const ownerFinalAck = `✅ Payment verified for Special Order #${soCode}!\n\nAdded *${order.medicine_name || order.product}* × ${order.qty} to Live Cart.\nCustomer *${order.requester || 'Customer'}* has been sent their confirmation receipt.`;
    await whatsappQueueWorker.enqueue(phone, ownerFinalAck, 'admin_escalation', 'Owner');

    console.log(`[Intent Service] Owner verified payment for order #${orderId} (${soCode}). Added to Live Cart.`);
    return true;
  }

  // 1b. Check for owner rejecting special order: "REJECT SO-10452", "WRONG", "REJECT", "CANCEL"
  const rejectSoMatch = cleanBody.match(/^(REJECT|WRONG|CANCEL|DECLINE)[\s\-:]*(?:SO-)?([A-Z0-9\-]*\d+)?$/i);
  if (rejectSoMatch) {
    const rawOrderDigits = rejectSoMatch[2] ? rejectSoMatch[2].replace(/\D/g, '') : '';
    await waAdminEscalationService.ensureOwnerPendingRequestsTable?.(db);
    const targetRejectRow = rawOrderDigits
      ? await db.get(`SELECT * FROM wa_owner_pending_requests WHERE (req_code LIKE ? OR id = ?) AND status = 'pending'`, [`%${rawOrderDigits}`, parseInt(rawOrderDigits, 10)])
      : await db.get(`SELECT * FROM wa_owner_pending_requests WHERE status = 'pending' ORDER BY id DESC LIMIT 1`);
    if (targetRejectRow) {
      await db.run(`UPDATE wa_owner_pending_requests SET status = 'rejected' WHERE id = ?`, [targetRejectRow.id]);
      const orderId = parseInt(String(targetRejectRow.req_code).replace(/\D/g, ''), 10);
      if (orderId > 0) {
        await db.run(`UPDATE special_orders SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?`, [orderId]);
        await db.run(`UPDATE wa_pending_clarifications SET step = 'cancelled' WHERE special_order_id = ?`, [orderId]);
      }
      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(
        phone,
        `🛑 Special Order *#${targetRejectRow.req_code}* cancelled/flagged for manual review. Customer notification paused.`,
        'admin_escalation',
        'Owner'
      );
      return true;
    }
  }

  // 2. Check for owner selecting distributor for special order: "SO-TMSA-10452 2", "SO-TMSA-10452-2", "SO-TMSA-104522", "10452-2", or digit 1..10, or bare "CONFIRM" / "1" / "YES"
  const soSupplierMatch =
    normalizedBody.match(/^(?:SO-)?(?:[A-Z0-9]+-)?(\d+)[\s\-:]*(10|[1-9])$/i) ||
    normalizedBody.match(/^(SO-[A-Z0-9]+-\d+)[\s\-:]*(10|[1-9])$/i) ||
    normalizedBody.match(/^(SO-\d+)[\s\-:]*(10|[1-9])$/i);
  const singleDigitMatch = normalizedBody.match(/^(10|[1-9])$/);
  const isBareConfirmSupplier = /^(CONFIRM|APPROVE|YES|OK|ACCEPT|1)$/i.test(normalizedBody);

  let soCode: string | null = null;
  let chosenOptionIdx = -1;
  let targetRow: any = null;

  if (soSupplierMatch) {
    const rawOrderDigits = (soSupplierMatch[1] || '').replace(/\D/g, '');
    const optCandidate = soSupplierMatch[2] || soSupplierMatch[soSupplierMatch.length - 1];
    chosenOptionIdx = parseInt(optCandidate, 10) - 1;
    await waAdminEscalationService.ensureOwnerPendingRequestsTable?.(db);
    targetRow = await db.get(
      `SELECT * FROM wa_owner_pending_requests WHERE (req_code = ? OR req_code LIKE ?) AND status = 'pending'`,
      [soSupplierMatch[0], `%${rawOrderDigits}`]
    );
    if (targetRow) {
      soCode = targetRow.req_code;
    } else {
      soCode = await generateStoreSpecialOrderCode(db, 1, parseInt(rawOrderDigits, 10));
    }
  } else if (singleDigitMatch || isBareConfirmSupplier) {
    await waAdminEscalationService.ensureOwnerPendingRequestsTable?.(db);
    const latest = await db.get(
      `SELECT * FROM wa_owner_pending_requests WHERE status = 'pending' ORDER BY id DESC LIMIT 1`
    );
    if (latest && (String(latest.req_code).startsWith('SO-') || String(latest.req_code).includes('-'))) {
      soCode = latest.req_code;
      chosenOptionIdx = singleDigitMatch ? parseInt(singleDigitMatch[1], 10) - 1 : 0; // Default to Option 1 for bare CONFIRM
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

    // Resolve customer phone robustly — targetRow.customer_phone may be empty if the
    // original inbound message used an @lid JID and payload.phone was not set.
    // Fall back to the special_orders table which stores the raw inbound phone.
    let custPhone: string = (targetRow.customer_phone || '').trim();
    if (!custPhone) {
      const soRow = await db.get('SELECT phone FROM special_orders WHERE id = ?', [orderId]);
      custPhone = (soRow?.phone || '').trim();
    }
    const custPhoneLast10 = custPhone.replace(/\D/g, '').slice(-10);

    const distName = selectedDist.distributor || selectedDist.supplier_name || selectedDist.storeName || selectedDist.distributor_name || 'Standard Distributor';
    const distRate = Number(selectedDist.distributorPrice ?? selectedDist.ptr ?? selectedDist.PTR ?? selectedDist.rate ?? 0);
    const distMrp = Number(selectedDist.mrp ?? selectedDist.MRP ?? 0);
    const selectedProdId = selectedDist.productId ? Number(selectedDist.productId) : (selectedDist.product_id ? Number(selectedDist.product_id) : null);
    const selectedProdCode = selectedDist.productCode ? String(selectedDist.productCode) : (selectedDist.product_code ? String(selectedDist.product_code) : null);
    const selectedStoreId = selectedDist.storeId ? Number(selectedDist.storeId) : (selectedDist.store_id ? Number(selectedDist.store_id) : null);
    const selectedProdName = selectedDist.name || selectedDist.productName || selectedDist.shortName || targetRow.medicine_name || '';

    // Update special order with selected distributor details and status
    await db.run(
      `UPDATE special_orders SET
         pharmarack_distributor = ?,
         pharmarack_rate = ?,
         pharmarack_mrp = ?,
         pharmarack_product_id = ?,
         pharmarack_product_code = ?,
         pharmarack_store_id = ?,
         pharmarack_product_name = ?,
         payment_status = 'AWAITING_PAYMENT',
         advance_payment = 50,
         total_amount = 50,
         updated_at = datetime('now')
       WHERE id = ?`,
      [distName, distRate, distMrp, selectedProdId, selectedProdCode, selectedStoreId, selectedProdName, orderId]
    );

    // Allocate alternating UPI QR config
    const activeQr = await paymentQrService.allocateNextQr();
    const upiUri = paymentQrService.buildUpiUri(activeQr.upi_id, activeQr.payee_name, 50, soCode);
    const medicineName = targetRow.medicine_name || 'Medicine';
    const fullQrPath = await paymentQrService.generatePaymentCard({
      upiUri,
      orderNumber: soCode,
      medicineName,
      amount: 50,
      payeeName: activeQr.payee_name,
      upiId: activeQr.upi_id,
      filename: `payment_card_${soCode}.png`
    });

    await db.run(
      `UPDATE special_orders SET payment_qr_id = ? WHERE id = ?`,
      [activeQr.id, orderId]
    );

    // Update customer conversation state to awaiting_payment (guarded against empty phone)
    if (custPhoneLast10) {
      await db.run(
        `UPDATE wa_pending_clarifications
         SET step = 'awaiting_payment', special_order_id = ?, so_code = ?, created_at = CURRENT_TIMESTAMP
         WHERE phone LIKE ? OR phone LIKE ?`,
        [orderId, soCode, `%${custPhoneLast10}`, `%${custPhoneLast10}%`]
      );
    }

    // Send customer message with ₹50 UPI QR (Spec §11)
    const custQrMsg =
      `✅ *Medicine & Supplier Confirmed*\n\n` +
      `🆔 *Special Order*: ${soCode}\n` +
      `💊 *Medicine*: ${medicineName}\n` +
      `📦 *Quantity*: ${targetRow.quantity}\n\n` +
      `🔐 *Booking Advance Amount*: ₹50.00\n\n` +
      `Please pay the ₹50.00 booking amount using the QR card attached above.\n\n` +
      `🏦 *UPI ID*: ${activeQr.upi_id.trim()}\n` +
      `👤 *Payee*: ${activeQr.payee_name}\n\n` +
      `👉 *Or tap to pay directly on this phone*:\n${upiUri}\n\n` +
      `📸 After payment, please send the payment screenshot in this chat.`;

    // Resolve customer phone or active chat target (e.g. @lid)
    let custTarget = custPhone;
    if (custPhoneLast10) {
      const activeChat = await db.get(
        `SELECT id FROM whatsapp_chats 
         WHERE (resolved_number LIKE ? OR id LIKE ?) 
         ORDER BY timestamp DESC, (CASE WHEN id LIKE '%@lid' THEN 1 ELSE 2 END) ASC LIMIT 1`,
        [`%${custPhoneLast10}%`, `%${custPhoneLast10}%`]
      );
      if (activeChat?.id) {
        custTarget = activeChat.id;
      }
    }

    let custSendSuccess = false;
    if (custTarget) {
      try {
        await whatsappQueueWorker.enqueue(
          custTarget,
          custQrMsg,
          'customer_payment_qr',
          targetRow.customer_name || 'Customer',
          undefined,
          fullQrPath
        );
        custSendSuccess = true;
      } catch (sendErr: any) {
        console.warn(`[Intent Service] Failed to send QR image to ${custTarget}, attempting text fallback:`, sendErr?.message || sendErr);
        try {
          const textFallbackMsg =
            custQrMsg +
            `\n\n🔗 *Pay via UPI link*:\n${upiUri}\n\n` +
            `UPI ID: ${activeQr.upi_id}\n` +
            `Payee: ${activeQr.payee_name}`;
          await whatsappQueueWorker.enqueue(
            custTarget,
            textFallbackMsg,
            'customer_inquiry_confirmed',
            targetRow.customer_name || 'Customer'
          );
          custSendSuccess = true;
        } catch (textErr: any) {
          console.error(`[Intent Service] All dispatch attempts failed to ${custTarget}:`, textErr?.message || textErr);
        }
      }
    } else {
      console.warn(`[Intent Service] Could not send QR for ${soCode} — customer phone missing from targetRow and special_orders.`);
    }

    // Send ack to owner (Truthful reporting & Human-in-the-Loop)
    let ownerAck = '';
    if (custSendSuccess) {
      ownerAck =
        `✅ *Supplier Confirmed for ${soCode}*\n\n` +
        `Selected: *${distName}* (PTR ₹${distRate.toFixed(2)})\n` +
        (custPhoneLast10
          ? `₹50 booking payment details sent to customer *${targetRow.customer_name || 'Customer'}* (+91 ${custPhoneLast10}).\n`
          : `Payment details sent to customer.\n`) +
        `Awaiting customer payment screenshot.`;
    } else {
      ownerAck =
        `⚠️ *Supplier Confirmed for ${soCode}* (Selected: *${distName}*)\n\n` +
        `❌ *Could not automatically send payment message to customer* (+91 ${custPhoneLast10 || 'unknown'}).\n\n` +
        `Please send payment details manually to the customer:\n` +
        `• Medicine: ${targetRow.medicine_name} × ${targetRow.quantity}\n` +
        `• Booking Advance: ₹50.00\n` +
        `• UPI ID: ${activeQr.upi_id}\n` +
        `• Payee: ${activeQr.payee_name}\n` +
        `• UPI Link: ${upiUri}`;
    }
    await whatsappQueueWorker.enqueue(phone, ownerAck, 'admin_escalation', 'Owner');

    console.log(`[Intent Service] Owner selected supplier #${chosenOptionIdx + 1} (${distName}) for ${soCode}. ${custSendSuccess ? 'Sent ₹50 payment details to customer.' : 'Customer send failed / manual follow-up required.'}`);
    return true;
  }

  // 3. Backward compatibility for legacy REQ-XXX-X format
  const reqCodeMatch = normalizedBody.match(/^(REQ-\d+)-(10|[1-9])$/i);

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
            pharmarack_distributor, pharmarack_rate, pharmarack_mrp,
            pharmarack_product_id, pharmarack_product_code, pharmarack_store_id, pharmarack_product_name
          ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Confirmed', ?, 0, 'whatsapp', ?, ?, ?, ?, ?, ?, ?)`,
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
            cartItem.mrp,
            cartItem.productId,
            cartItem.productCode,
            cartItem.storeId,
            cartItem.productName
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

    // 1. IGNORE CHECK
    if (await isIgnored(chatId)) return;

    const db = await dbManager.getConnection();

    // Resolve standard phone number if sender is an LID
    if (phone.endsWith('@lid')) {
      try {
        const chatRow = await db.get('SELECT resolved_number FROM whatsapp_chats WHERE id = ?', [phone]);
        if (chatRow?.resolved_number) {
          const digits = chatRow.resolved_number.replace(/\D/g, '');
          if (digits.length >= 10) {
            phone = `${digits.slice(-10)}@c.us`;
          }
        }
      } catch (_) {}

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
    }

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
    const customer = await lookupCustomer(phone, chatId);
    const isNewCustomer = !customer;

    // 2b. REFILL CONFIRMATION CHECK — "refill", "yes", "confirm", "haan", "ho", "bhej do", etc.
    // Guard: Only check refills if customer does NOT have an active medicine order clarification in progress
    const cleanDigitsForRefill = (phone || '').replace(/\D/g, '').slice(-10);
    let hasActiveClarification = false;
    if (cleanDigitsForRefill) {
      try {
        await ensureClarificationsTable(db);
        const activeClarification = await db.get(
          `SELECT 1 FROM wa_pending_clarifications 
           WHERE (phone LIKE ? OR phone LIKE ? OR phone = ?) 
             AND created_at > datetime('now', '-45 minutes')
           LIMIT 1`,
          [`%${cleanDigitsForRefill}`, `%${cleanDigitsForRefill}%`, cleanDigitsForRefill]
        );
        if (activeClarification) {
          hasActiveClarification = true;
        }
      } catch (_) {}
    }

    if (!hasActiveClarification && isRefillConfirmationResponse(body)) {
      const cleanDigits = cleanDigitsForRefill;
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

          // Reconcile and stage as special order with exact quantity
          try {
            const { refillOrderReconciler } = await import('./refillOrderReconciler.js');
            await refillOrderReconciler.upsertForPhone({
              phone: cleanDigits,
              customer_name: primaryRefill.patient_name,
              items: pendingRefills.map((r: any) => ({
                medicine_name: r.medicine_name,
                qty: Number(r.quantity_needed || 3)
              })),
              source: 'whatsapp_refill_confirm',
              source_refill_id: primaryRefill.id,
              dbInstance: db
            });
          } catch (recErr) {
            console.warn('[Intent Service] Reconciler upsert note on refill confirm:', recErr);
          }

          // Optional acknowledgement to patient via queue worker (suppressed in active manual takeover)
          if (!isManualSession) {
            try {
              const { getPharmacyOperatingSchedule, getStoreMedicalName, getStorePhone } = await import('./storeSettingsService.js');
              const sched = await getPharmacyOperatingSchedule(db);
              const storeName = await getStoreMedicalName(db);
              const storePhone = await getStorePhone(db);
              const hoursNotice = await getStoreHoursNotice(db);
              const phoneSuffix = storePhone ? `\n📞 ${storePhone}` : '';
              const medListText = pendingRefills.length === 1 
                ? `*${primaryRefill.medicine_name}*` 
                : pendingRefills.map((r: any) => `• ${r.medicine_name}`).join('\n');

              const ackMsg = `✅ *Refill Confirmed — ${storeName}*\n\n` +
                `Thank you ${primaryRefill.patient_name}! Your regular prescription for:\n${medListText}\nhas been confirmed.\n\n` +
                `🕒 *Store Hours:* ${sched.openTime} to ${sched.closeTime}${hoursNotice ? `\n${hoursNotice.trim()}` : ''}\n` +
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

    // 2c. INITIAL CUSTOMER GREETING & AUTOMATION TRIGGER
    // Treats ANY greeting as a fresh new session: resets old states and starts clean
    const cleanGreeting = body.trim().toLowerCase().replace(/[^\w\s]/g, '').trim();
    const isGreeting =
      /^(h+i+|h+e+y+|h+e+l+l*o+|hola+|namaste+|namaskar+|pranam+|ram ram|radhe radhe|good morning|gm|good afternoon|good evening|start|help|order)(\s+(sir|ji|mam|madam|team|there|bhai|bro|medical|pharmacy|tanamay))?$/i.test(cleanGreeting);
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
      const hoursNotice = await getStoreHoursNotice(db);

      const hasKnownName = isKnownCustomerName(customer?.name);

      if (!hasKnownName) {
        const askNameText =
          `👋 Hello! Welcome to ${storeName}.${hoursNotice}\n\n` +
          `Before we begin, *may I please know your name?*`;

        await db.run(
          `INSERT INTO wa_pending_clarifications (phone, suggested_name, original_query, step, created_at)
           VALUES (?, '', ?, 'awaiting_customer_name', CURRENT_TIMESTAMP)`,
          [cleanDigits, body]
        );

        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(phone, askNameText, 'customer_greeting', 'Customer');
        console.log(`[Intent Service] Prompted new customer ${cleanDigits} for their name.`);
        return;
      }

      const { getPharmacyOperatingSchedule: getSchedForGreet } = await import('./storeSettingsService.js');
      const schedForGreet = await getSchedForGreet(db);
      const hoursLineForGreet = `🕐 Open: ${schedForGreet.openTime} – ${schedForGreet.closeTime}${schedForGreet.weeklyOff ? ` | Off: ${schedForGreet.weeklyOff}` : ''}`;

      const greetingText =
        `👋 Hello *${customer!.name}*! Welcome back to ${storeName}.${hoursNotice}\n\n` +
        `*Place your order in simple steps:*\n\n` +
        `*Step 1:* Choose your order type —\n` +
        `  1️⃣ Single Medicine\n` +
        `  2️⃣ Multiple Medicines\n` +
        `  3️⃣ Refill — Repeat my regular prescription\n\n` +
        `*Step 2:* We show you options & MRP 💰\n` +
        `*Step 3:* You confirm & we book 🚀\n\n` +
        `${hoursLineForGreet}\n\n` +
        `*Reply 1, 2, or 3 to begin.*`;

      await db.run(
        `INSERT INTO wa_pending_clarifications (phone, suggested_name, original_query, step, customer_name, created_at)
         VALUES (?, '', ?, 'awaiting_order_type', ?, CURRENT_TIMESTAMP)`,
        [cleanDigits, body, customer!.name]
      );

      const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
      await whatsappQueueWorker.enqueue(phone, greetingText, 'customer_greeting', customer!.name);
      console.log(`[Intent Service] Fresh greeting sent to known customer ${customer!.name} (${cleanDigits}).`);
      return;
    }

    // 2d. PAYMENT SCREENSHOT / MEDIA CLARIFICATION CHECK
    if (hasMedia) {
      const cleanDigitsForPayment = (phone || '').replace(/\D/g, '').slice(-10);
      const pendingPayment = await db.get(
        `SELECT phone, suggested_name, special_order_id, so_code, customer_name, step, quantity
         FROM wa_pending_clarifications
         WHERE (phone LIKE ? OR phone LIKE ? OR phone = ?)
           AND step IN ('awaiting_payment', 'awaiting_owner_payment_confirmation')
           AND created_at > datetime('now', '-72 hours')
         ORDER BY created_at DESC LIMIT 1`,
        [`%${cleanDigitsForPayment}`, `%${cleanDigitsForPayment}%`, cleanDigitsForPayment]
      );

      if (pendingPayment) {
        console.log(`[Intent Service] Detected payment screenshot from ${cleanDigitsForPayment} for order ${pendingPayment.so_code || pendingPayment.special_order_id}.`);
        let media: any = null;
        if (typeof msg.downloadMedia === 'function') {
          try {
            media = await downloadMediaWithRetry(() => msg.downloadMedia(), { maxAttempts: 3, delayMs: 1500 });
          } catch (dlErr) {
            console.warn('[Intent Service] Direct download failed for payment proof, attempting resilient download:', dlErr);
            try {
              const { downloadMessageMediaReliably } = await import('../whatsappClient.js');
              media = await downloadMessageMediaReliably(msg.id?._serialized || msg.id?.id || String(msg.id), {
                chatId: msg.from,
                rawMsg: msg
              });
            } catch (dlErr2) {
              console.warn('[Intent Service] Resilient download also failed for payment proof:', dlErr2);
            }
          }
        }

        const soCode = pendingPayment.so_code || (pendingPayment.special_order_id ? `SO-${pendingPayment.special_order_id}` : 'SO');

        let proofImagePath: string | undefined;
        if (media?.data) {
          try {
            const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
            if (!fs.existsSync(uploadsDir)) {
              fs.mkdirSync(uploadsDir, { recursive: true });
            }
            proofImagePath = path.join(uploadsDir, `payment_proof_${soCode}.jpg`);
            fs.writeFileSync(proofImagePath, Buffer.from(media.data, 'base64'));
          } catch (saveErr) {
            console.error('[Intent Service] Failed to persist payment proof to disk:', saveErr);
          }
        }

        // Update pending clarification to awaiting_owner_payment_confirmation
        await db.run(
          `UPDATE wa_pending_clarifications 
           SET step = 'awaiting_owner_payment_confirmation' 
           WHERE phone = ?`,
          [pendingPayment.phone]
        );

        if (pendingPayment.special_order_id) {
          await db.run(
            `UPDATE special_orders 
             SET payment_status = 'SCREENSHOT_RECEIVED', payment_screenshot_path = COALESCE(?, payment_screenshot_path), screenshot_amount = 50, updated_at = datetime('now') 
             WHERE id = ?`,
            [proofImagePath || null, pendingPayment.special_order_id]
          );
        }

        // Forward screenshot to store owner
        const adminPhone = (await waAdminEscalationService.resolveAdminWhatsappNumber?.(db)) || '';
        if (adminPhone) {
          const adminCaption =
            `📸 *Payment Screenshot Received*\n\n` +
            `🆔 *Order*: ${soCode}\n` +
            `👤 *Customer*: ${pendingPayment.customer_name || customer?.name || 'Customer'} (${cleanDigitsForPayment})\n` +
            `💊 *Medicine*: ${pendingPayment.suggested_name || 'Special Order'}\n` +
            `💰 *Advance*: ₹50\n\n` +
            `👉 Reply *CONFIRM ${soCode}* to verify payment and add to Live Cart.`;

          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(
            adminPhone,
            adminCaption,
            proofImagePath ? 'admin_escalation_image' : 'admin_escalation',
            'Owner',
            undefined,
            proofImagePath || undefined,
            (!proofImagePath && media?.data) ? {
              mimetype: media.mimetype || 'image/jpeg',
              data: media.data,
              filename: `payment_proof_${soCode}.jpg`
            } : undefined
          );
          console.log(`[Intent Service] Payment proof for ${soCode} enqueued to owner (${adminPhone}).`);
        }

        // Reassure customer
        const custAck = `✅ Thank you! Your payment screenshot has been received and forwarded to our pharmacy team for verification.\n\nWe will confirm your order shortly!`;
        const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
        await whatsappQueueWorker.enqueue(
          phone,
          custAck,
          'customer_inquiry_confirmed',
          pendingPayment.customer_name || customer?.name || 'Customer'
        );

        try {
          eventService.broadcast('order_updated', { at: Date.now(), id: pendingPayment.special_order_id });
        } catch (_) {}

        return;
      }
    }

    // 2d. MEDICINE CLARIFICATION CHECK ("yes", "haan", option numbers, quantities, etc.)
    if (!hasMedia && await checkMedicineClarificationResponse(phone, body, customer, chatId)) {
      return;
    }

    // 2e. MEDICINE ID DIRECT LOOKUP (e.g. "#4512", "med 4512", "order 4512")
    const medIdMatch = body.trim().match(/^(?:#|id\s*#?|med(?:icine)?\s*#?|order\s*#?)(\d{1,7})(?:\s*[-–x*]?\s*(\d+)\s*(strip|tablets?|capsules?|pack|bottles?|box)?)?$/i);
    let resolvedMedFromId: { id: number; name: string; quantity: number; unit: string } | null = null;
    if (medIdMatch) {
      const targetMedId = parseInt(medIdMatch[1], 10);
      if (targetMedId > 0) {
        const medRow = await db.get('SELECT id, name FROM medicines WHERE id = ?', [targetMedId]);
        if (medRow?.name) {
          resolvedMedFromId = {
            id: medRow.id,
            name: medRow.name,
            quantity: medIdMatch[2] ? parseInt(medIdMatch[2], 10) : 1,
            unit: medIdMatch[3] || 'strip'
          };
        }
      }
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
      // serializedId hoisted before try so the catch block (Fix 2 deferred retry) can access it
      const rawMsgId = typeof msg?.id?._serialized === 'string'
        ? msg.id._serialized
        : (typeof msg?.id === 'string' ? msg.id : (typeof msg?.id?.id === 'string' ? msg.id.id : (msgId || '')));
      const serializedId = (rawMsgId && !rawMsgId.includes('_') && chatId)
        ? `false_${chatId}_${rawMsgId}`
        : rawMsgId;
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
        const downloadErrors: string[] = [];
        let media: { data?: string } | undefined;

        // Step 0: Try resilient polling download (waits for FETCHING to resolve on large photos and hydrates @lid)
        if (serializedId && typeof (waClient as any).downloadMessageMediaReliably === 'function') {
          try {
            media = await (waClient as any).downloadMessageMediaReliably(serializedId, { maxWaitMs: 12000, chatId, rawMsg: msg });
          } catch (reliableErr) {
            const rMsg = reliableErr instanceof Error ? reliableErr.message : String(reliableErr);
            downloadErrors.push(`reliable: ${rMsg}`);
          }
        }

        if (!media?.data && typeof msg.downloadMedia === 'function') {
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
            const soCode = pendingPayment.so_code || await generateStoreSpecialOrderCode(db, 1, soId);

            await db.run(
              `UPDATE special_orders
               SET payment_screenshot_path = ?, screenshot_amount = 50, payment_status = 'SCREENSHOT_RECEIVED', updated_at = datetime('now')
               WHERE id = ?`,
              [imagePath, soId]
            );

            await db.run(
              `UPDATE wa_pending_clarifications
               SET step = 'awaiting_owner_payment_confirmation', payment_reminder_sent = 0, created_at = CURRENT_TIMESTAMP
               WHERE phone = ?`,
              [pendingPayment.phone]
            );

            // Forward screenshot to Owner for verification (Spec §12)
            const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db);
            if (adminWhatsapp) {
              const custDisplayName = (customer?.name && isKnownCustomerName(customer.name))
                ? customer.name
                : (pendingPayment.customer_name && isKnownCustomerName(pendingPayment.customer_name) ? pendingPayment.customer_name : 'Customer');

              const forwardCaption =
                `💰 *Payment Verification (${soCode})*\n` +
                `👤 ${custDisplayName} (+91 ${cleanPhone})\n` +
                `💊 ${pendingPayment.suggested_name} × ${pendingPayment.quantity || 1} | ₹50 Paid\n` +
                `👉 Reply: *CONFIRM ${soCode}*`;

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

        // Fix 2 — Deferred 30s retry: WA sometimes resolves decryption keys 15-30s after event fires.
        // Fire-and-forget: non-blocking, uses existing downloadMessageMediaById, OCR queue is idempotent on msgId.
        if (serializedId) {
          setTimeout(async () => {
            try {
              const waClient = await import('../whatsappClient.js');
              let deferred: any = null;
              if (typeof (waClient as any).downloadMessageMediaReliably === 'function') {
                deferred = await (waClient as any).downloadMessageMediaReliably(serializedId, { chatId, maxWaitMs: 15000, rawMsg: msg });
              }
              if (!deferred?.data && typeof waClient.downloadMessageMediaById === 'function') {
                deferred = await waClient.downloadMessageMediaById(serializedId);
              }
              if (deferred?.data) {
                console.log(`[Intent Service] Deferred 30s retry succeeded for msgId=${serializedId}`);
                const buffer = Buffer.from(deferred.data, 'base64');
                let imagePath: string | undefined;
                try { imagePath = await saveInboundMedia(msgId, buffer); } catch (_) {}
                ocrScanQueue.enqueue(msgId, buffer, { phone, chatId, messageBody: body, imagePath });
              }
            } catch (_) {
              // Deferred retry is best-effort — no further action
            }
          }, 30_000);
        }

        // Fix 3 — Smart fallback: notify admin + send intelligent reply instead of static prompt.
        try {
          const db = await dbManager.getConnection();
          await waAdminEscalationService.notifyAdminOfUnprocessedMedia(db, {
            phone,
            chatId,
            reason: `Received an image from this customer but could not download it after repeated attempts (${downloadDetail.slice(0, 140)}).`
          });

          if (phone && !isManualSession) {
            const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
            const caption = (body || '').trim();

            // Branch A: caption has text — extract medicine candidates and search DB immediately
            if (caption.length >= 2) {
              const captionCandidates = extractMedicineCandidates(caption);
              if (captionCandidates.length > 0) {
                console.log(`[Intent Service] Image download failed but caption has medicine candidates: ${captionCandidates.map(c => c.medicineName).join(', ')} — searching DB`);
                for (const cand of captionCandidates) {
                  await searchAndBroadcast({
                    medicineName: cand.medicineName,
                    quantity: cand.quantity || 1,
                    unit: cand.unit || '',
                    customer,
                    isNewCustomer,
                    messageBody: caption,
                    source: 'text',
                    msgId,
                    phone,
                    chatId,
                    hasIntentWords: true,
                    isStale: false,
                    suppressClarification: captionCandidates.length > 1
                  });
                }
                return; // Caption handled — no generic message needed
              }
            }

            // Branch B: no caption (or no medicine in caption) — show customer's recent medicines from DB
            if (customer) {
              const history = await getCustomerHistory(customer).catch(() => []);
              if (history.length > 0) {
                const topMeds = history.slice(0, 5);
                const medList = topMeds
                  .map((h: any, i: number) => `${i + 1}. *${h.medicine_name}*`)
                  .join('\n');
                const nameGreet = isKnownCustomerName(customer.name) ? `Hi ${customer.name},\n\n` : '';
                await whatsappQueueWorker.enqueue(
                  phone,
                  `📸 ${nameGreet}We received your photo! The image is being processed.\n\nMeanwhile, here are your recent medicines:\n\n${medList}\n\n👉 Reply with a number to re-order, or type the medicine name directly.`,
                  'customer_medicine_clarification',
                  customer.name || 'Customer'
                );
                console.log(`[Intent Service] Image download failed — sent DB history list (${topMeds.length} medicines) to ${phone}`);
                return;
              }
            }

            // Branch C: new customer or no history — fall back to standard guidance
            await whatsappQueueWorker.enqueue(
              phone,
              `📸 *Photo Received!*\n\nWe received your photo, but the image is taking longer to process.\n\n👉 *Please type the medicine name* you need (e.g. *Dolo 650*, *Zifi 200mg*), and our pharmacy team will check availability immediately!`,
              'customer_medicine_clarification',
              customer?.name || 'Customer'
            );
          }
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

    if (resolvedMedFromId) {
      pushCandidate(resolvedMedFromId.name, resolvedMedFromId.quantity, resolvedMedFromId.unit);
    }

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
      // Guided Workflow Pre-Flight Gate:
      // If the customer sent random text that is NOT in an active medicine step ("awaiting_medicine"),
      // has no medicine intent words, and matches NO medicine in the local database,
      // do NOT treat it as a medicine name! Route to guided workflow menu instead.
      let isLegitimateMedicineOrder = Boolean(
        resolvedMedFromId ||
        parsed.rawIntentWords.length > 0 ||
        candidates.some(c => c.fromScispacy)
      );

      if (!isLegitimateMedicineOrder) {
        // Check active clarification step
        const cleanCustPhone = (phone || '').replace(/\D/g, '').slice(-10);
        if (cleanCustPhone) {
          try {
            await ensureClarificationsTable(db);
            const activeStepRow = await db.get(
              `SELECT step FROM wa_pending_clarifications
               WHERE (phone LIKE ? OR phone LIKE ? OR phone = ?)
                 AND created_at > datetime('now', '-45 minutes')
               ORDER BY created_at DESC LIMIT 1`,
              [`%${cleanCustPhone}`, `%${cleanCustPhone}%`, cleanCustPhone]
            );
            if (activeStepRow && ['awaiting_medicine', 'awaiting_multi_medicine_list'].includes(activeStepRow.step)) {
              isLegitimateMedicineOrder = true;
            }
          } catch (_) {}
        }
      }

      if (!isLegitimateMedicineOrder) {
        // Fast index scan on Master DB to see if any candidate is a real medicine
        for (const cand of candidates) {
          const brandClean = cand.name.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
          const firstWord = brandClean.split(/\s+/)[0] || '';
          if (firstWord.length >= 3) {
            const localHit = await db.get(
              `SELECT 1 FROM medicines WHERE name LIKE ? LIMIT 1`,
              [`${firstWord}%`]
            );
            if (localHit) {
              isLegitimateMedicineOrder = true;
              break;
            }
          }
        }
      }

      if (!isLegitimateMedicineOrder) {
        console.log(`[Intent Service] Pre-flight gate: message "${body.slice(0, 60)}" from ${phone || chatId} has no active medicine session, intent words, or local DB match. Diverting to guided menu.`);
        if (!hasMedia && !isStale && phone && !isManualSession) {
          const cleanBody = body.trim();
          if (cleanBody.length >= 2) {
            await maybeSendGuidancePrompt(phone, customer?.name || 'Customer', db, cleanBody);
          }
        }
        return;
      }

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
            const knownName = (customer?.name || '').trim();
            const nameLine = knownName && knownName.toLowerCase() !== 'customer' ? `Hi ${knownName},\n\n` : '';
            const promptMsg = `${nameLine}Please confirm your order for:\n${itemListText}\n\nReply *YES* to confirm or *NO* to cancel.`;
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
        await maybeSendGuidancePrompt(phone, customer?.name || 'Customer', db, cleanBody);
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

  // Live Pharmarack search — query distributor network using sanitized 2-3 word term
  let livePharmarackResults: any[] | null = null;
  const isPlausible = isPlausibleMedicineName(pharmaQuery || medicineName);
  const hasLocalOrCatalogPresence =
    (filterResult.matches && filterResult.matches.length > 0) ||
    (catalogResults?.mapped && catalogResults.mapped.length > 0) ||
    (catalogResults?.nonMapped && catalogResults.nonMapped.length > 0);
  const shouldQueryLivePharmarack =
    Boolean(pharmaQuery) &&
    (source !== 'text' || hasIntentWords || hasLocalOrCatalogPresence);

  if (shouldQueryLivePharmarack) {
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
          // Cross-check against Pharmarack's OWN native ranking for this exact
          // query (pharmarackRank = their response order, IsSort:1) as a second,
          // independent signal — our text-similarity score alone missed the
          // Zifi vs Zifi-O mismatch until a modifier-list fix; Pharmarack's own
          // engine had already ranked "Zifi O" far behind plain "Zifi" for a
          // "Zifi 200" query. A candidate must clear BOTH checks, so a future
          // unknown gap in our scorer can't alone promote a weak match to top.
          const nativeRankCutoff = Math.max(10, Math.ceil(searchRes.items.length * 0.25));
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
            .filter((p: any) => p.score >= 0.65 && (typeof p.pharmarackRank !== 'number' || p.pharmarackRank < nativeRankCutoff))
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
  // When medicine inquiry comes from text or high-confidence recognized image and we matched a product, clarify options or ask customer to confirm
  const shouldClarifyCustomer = (source === 'text' || (confidence >= 75 && hasConfirmedMatch)) &&
    phone && !opts.isStale && !opts.suppressClarification;
  if (shouldClarifyCustomer) {
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
            if (deduplicated.length >= 45) break;
          }
        }

        const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
        await ensureClarificationsTable(db);

        const isFromPhoto = source === 'ocr' || source === 'both' || !!opts.imagePath;

        if (deduplicated.length > 1) {
          const PAGE_SIZE = 15;
          const initialSlice = deduplicated.slice(0, PAGE_SIZE);
          const formatNum = (idx: number) => {
            const emojiNums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            return idx < 10 ? emojiNums[idx] : `${idx + 1}.`;
          };
          const optionsList = initialSlice.map((opt, i) => `${formatNum(i)} *${opt}*`).join('\n');
          const moreHint = deduplicated.length > PAGE_SIZE ? `\n\n👉 Reply *MORE* to see more options.` : '';
          const promptMsg = isFromPhoto
            ? `📸 *Medicine Photo Scanned!*\n\n🔍 *Detected from photo:* ${medicineName}\nWe found these matching options in our catalog:\n\n${optionsList}${moreHint}\n\n👉 Please reply with the number of the medicine you need.`
            : `🔎 I found these medicine options for *${medicineName}*:\n\n${optionsList}${moreHint}\n\nPlease reply with the number of the medicine you need.`;

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
            [cleanPhone, deduplicated[0], medicineName, JSON.stringify({ allOptions: deduplicated, page: 0 }), quantity || 1, unit || 'strip']
          );

          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(phone, promptMsg, 'customer_medicine_clarification', customer?.name || 'Customer');
          console.log(`[Intent Service] Sent medicine options prompt (1..${initialSlice.length}) for "${medicineName}" to ${cleanPhone}.`);
        } else if (deduplicated.length === 1 || filterResult.matches[0]) {
          const topMatched = deduplicated[0] || filterResult.matches[0];
          const matchedMrp = mrp || catalogResults?.mapped?.[0]?.mrp || null;
          const promptMsg = isFromPhoto
            ? `📸 *Medicine Photo Scanned!*\n\n🔍 *Detected from photo:* ${medicineName}\n💊 *Matched Product:* *${topMatched}*\n\nIs this the medicine you want?\n👉 Reply *YES* to confirm or *NO* to cancel.`
            : `💊 I found *${topMatched}*.\nIs this the medicine you want?\n\nReply *YES* to confirm or *NO* to cancel.`;
          await db.run(
            `INSERT INTO wa_pending_clarifications (phone, suggested_name, original_query, options_json, quantity, unit, step, mrp, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'awaiting_medicine_confirmation', ?, CURRENT_TIMESTAMP)
             ON CONFLICT(phone) DO UPDATE SET
               suggested_name = excluded.suggested_name,
               original_query = excluded.original_query,
               options_json = NULL,
               selected_option = excluded.suggested_name,
               quantity = excluded.quantity,
               unit = excluded.unit,
               step = 'awaiting_medicine_confirmation',
               mrp = COALESCE(excluded.mrp, wa_pending_clarifications.mrp),
               created_at = CURRENT_TIMESTAMP`,
            [cleanPhone, topMatched, medicineName, null, quantity || 1, unit || 'strip', matchedMrp]
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

  // ─── 0.5 Doctor Prescription Detection & Human-in-the-Loop Workflow ──────────
  // If the scanned image is identified as a doctor prescription slip (multi-medicine),
  // do NOT force it into the single-medicine packaging pipeline. Extract all items,
  // query local shelf inventory, alert pharmacist with an interactive review card,
  // and send an acknowledgment receipt to the customer.
  if (ocrResult.isPrescription) {
    try {
      const rxData = ocrResult.prescriptionData || {};
      const rxItems = Array.isArray(ocrResult.prescriptionItems) && ocrResult.prescriptionItems.length > 0
        ? ocrResult.prescriptionItems
        : (Array.isArray(rxData.items) ? rxData.items : []);

      if (rxItems.length > 0) {
        console.log(`[Intent Service] Doctor prescription detected with ${rxItems.length} items for ${phone || chatId}. Initiating Human-in-the-Loop review.`);
        const db = await dbManager.getConnection();
        const customer = await lookupCustomer(phone);

        // Resolve inventory stock for each prescribed item
        const enrichedItems: any[] = [];
        for (const item of rxItems) {
          const medName = item.brandHint || item.brandName || item.medicineName || item.name || item.rawText || '';
          let stockQty = item.inventoryQty ?? 0;
          let inStock = item.availability === 'IN_STOCK' || stockQty > 0;

          if (stockQty === 0 && !item.availability && medName) {
            try {
              const fr = await productNameFilterService.filterProductNames(medName, { minConfidenceThreshold: 0.6 });
              const matches: string[] = Array.isArray(fr.matches) ? fr.matches : [];
              if (matches.length > 0) {
                const stockMap = await resolveInventoryStock([matches[0]], db);
                stockQty = stockMap[matches[0].toLowerCase()] ?? 0;
                inStock = stockQty > 0;
              }
            } catch (_) {}
          }

          enrichedItems.push({
            medicineName: medName,
            strength: item.strength,
            dosage: item.dosageForm || item.dosage,
            frequency: item.frequency || item.timing,
            duration: item.duration,
            quantity: item.prescribedQuantity || item.quantity || 1,
            instructions: item.instructions,
            handwrittenNotes: item.handwrittenNotes,
            stockQty,
            inStock
          });
        }

        const rxCode = await waAdminEscalationService.notifyAdminOfPrescription(db, {
          customerPhone: phone || '',
          customerName: customer?.name,
          chatId,
          patientName: rxData.patientName || ocrResult.patientName,
          doctorName: rxData.doctorName || ocrResult.doctorName,
          clinicHospital: rxData.clinicHospital || ocrResult.clinicName,
          date: rxData.date,
          items: enrichedItems,
          notes: rxData.notes,
          imagePath
        });

        // Send patient acknowledgment on WhatsApp
        if (phone) {
          const patientGreeting = rxData.patientName ? ` for *${rxData.patientName}*` : '';
          const doctorMention = rxData.doctorName ? ` (Dr. ${rxData.doctorName.replace(/^dr\.?\s*/i, '')})` : '';
          const itemsCount = enrichedItems.length;
          const custMsg =
            `📋 *Prescription Received!* 🩺\n\n` +
            `Hello${patientGreeting}, we have received your doctor's prescription${doctorMention} with *${itemsCount} medicine${itemsCount > 1 ? 's' : ''}*.\n\n` +
            `👨‍⚕️ *Our registered pharmacist is reviewing your prescription now.*\n` +
            `We will check available batches, verify doctor notes, and update you shortly with confirmation and dispatch details.\n\n` +
            `Prescription ID: *${rxCode || 'Pending Review'}*`;

          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(
            phone,
            custMsg,
            'customer_prescription_ack',
            rxData.patientName || customer?.name || 'Customer'
          );
        }

        // Return early so prescription is NOT processed as a single packaging OCR flow
        return;
      }
    } catch (rxErr) {
      console.error('[Intent Service] Error processing doctor prescription scan:', rxErr);
    }
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
      console.log(`[Intent Service] OCR name "${finalName}" failed plausibility check. Falling through to human pharmacist review.`);
      finalName = '';
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
            reason: 'Prescription / medicine photo received — OCR could not read medicine clearly. Needs pharmacist review.'
          });
        } catch (notifyErr) {
          console.error('[Intent Service] Failed to notify admin of unreadable scan:', notifyErr);
        }
      })();
    }
    if (phone) {
      (async () => {
        try {
          const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
          await whatsappQueueWorker.enqueue(
            phone,
            `📋 *Prescription Photo Received!* 🩺\n\nHello, we have received your doctor's prescription / medicine photo.\n\nOur registered pharmacist is reviewing it right now and will confirm available stock and details with you shortly.\n\n*(You can also type any medicine names or instructions here if you want!)*`,
            'customer_medicine_clarification',
            'Customer'
          );
        } catch (_) {}
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
      const lowerRaw = ocrRaw.toLowerCase();
      const isClearNonMedicineDoc = DOC_SIGNS.some(s => lowerRaw.includes(s));
      if (isClearNonMedicineDoc) {
        console.log(`[Intent Service] Scan gate (V2): skipped non-medicine document/flyer (name="${finalName}", chat=${chatId}).`);
        return;
      }
      console.log(`[Intent Service] Scan gate (V2): unverified medicine photo (name="${finalName}", chat=${chatId}). Escalating to human pharmacist.`);
      if (imagePath) {
        (async () => {
          try {
            const db = await dbManager.getConnection();
            await waAdminEscalationService.notifyAdminOfUnprocessedMedia(db, {
              phone: phone || '',
              chatId,
              imagePath,
              reason: 'Customer shared medicine/prescription photo — OCR could not verify medicine salt or brand clearly. Needs pharmacist review.'
            });
          } catch (notifyErr) {
            console.error('[Intent Service] Failed to notify admin of unverified scan:', notifyErr);
          }
        })();
      }
      if (phone && !isManualChatSession) {
        (async () => {
          try {
            const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
            await whatsappQueueWorker.enqueue(
              phone,
              `📋 *Prescription Photo Received!* 🩺\n\nHello, we have received your doctor's prescription / medicine photo.\n\nOur registered pharmacist is reviewing it right now and will confirm available stock and details with you shortly.\n\n*(You can also type any medicine names or instructions here if you want!)*`,
              'customer_medicine_clarification',
              customer?.name || 'Customer'
            );
          } catch (_) {}
        })();
      }
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

/**
 * Scans pending special orders in 'awaiting_payment' where customer has not paid or sent screenshot
 * within the grace window (>= 2 hours after QR sent, and reminder has not yet been sent).
 * Sends a polite follow-up offering the QR code again or option to change medicine.
 */
export async function checkAndSendAdvancePaymentReminders(db?: any): Promise<number> {
  try {
    if (!db) {
      const { dbManager } = await import('../database/connection.js');
      db = await dbManager.getConnection();
    }
    await ensureClarificationsTable(db);

    const pendingList = await db.all(`
      SELECT p.phone, p.suggested_name, p.quantity, p.unit, p.so_code, p.customer_name, p.special_order_id, p.created_at
      FROM wa_pending_clarifications p
      LEFT JOIN special_orders so ON p.special_order_id = so.id
      WHERE p.step = 'awaiting_payment'
        AND (p.payment_reminder_sent IS NULL OR p.payment_reminder_sent = 0)
        AND p.created_at <= datetime('now', '-2 hours')
        AND p.created_at >= datetime('now', '-24 hours')
        AND (so.payment_status IS NULL OR so.payment_status NOT IN ('PAYMENT_CONFIRMED', 'Fulfilled', 'Cancelled'))
        AND (so.status IS NULL OR so.status NOT IN ('Fulfilled', 'Cancelled'))
      LIMIT 10
    `).catch(() => []);

    if (!pendingList || pendingList.length === 0) return 0;

    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
    let sentCount = 0;

    for (const item of pendingList) {
      const medName = item.suggested_name || 'your medicine';
      const custName = (item.customer_name && isKnownCustomerName(item.customer_name)) ? item.customer_name.trim() : 'Customer';
      const soCode = item.so_code || (item.special_order_id ? `SO-${item.special_order_id}` : 'SO');

      const reminderMsg =
        `Hello ${custName},\n\n` +
        `We noticed we haven't received your ₹50 booking advance payment for *${medName}* yet (Order Ref: ${soCode}).\n\n` +
        `• Reply *QR* to receive the payment QR code again.\n` +
        `• Or reply with a *new medicine name* if you need something else.`;

      await whatsappQueueWorker.enqueue(
        item.phone,
        reminderMsg,
        'customer_inquiry_confirmed',
        custName
      );

      await db.run(
        `UPDATE wa_pending_clarifications SET payment_reminder_sent = 1 WHERE phone = ?`,
        [item.phone]
      );
      sentCount++;
      console.log(`[PaymentReminder] Dispatched advance payment reminder for ${soCode} to ${item.phone}`);
    }

    // Scan orders waiting for owner payment verification >= 2 hours
    const pendingOwnerList = await db.all(`
      SELECT p.phone, p.suggested_name, p.quantity, p.so_code, p.customer_name, p.special_order_id, p.created_at
      FROM wa_pending_clarifications p
      LEFT JOIN special_orders so ON p.special_order_id = so.id
      WHERE p.step = 'awaiting_owner_payment_confirmation'
        AND (p.payment_reminder_sent IS NULL OR p.payment_reminder_sent = 0)
        AND p.created_at <= datetime('now', '-2 hours')
        AND p.created_at >= datetime('now', '-48 hours')
        AND (so.payment_status IS NULL OR so.payment_status = 'SCREENSHOT_RECEIVED')
      LIMIT 10
    `).catch(() => []);

    for (const item of pendingOwnerList) {
      const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber?.(db);
      if (adminWhatsapp) {
        const soCode = item.so_code || (item.special_order_id ? `SO-${item.special_order_id}` : 'SO');
        const custName = (item.customer_name && isKnownCustomerName(item.customer_name)) ? item.customer_name.trim() : 'Customer';
        const cleanCustDigits = String(item.phone || '').replace(/\D/g, '').slice(-10);
        const ownerPingMsg =
          `⏳ *Reminder: Payment Verification Needed*\n` +
          `🆔 *Order*: ${soCode}\n` +
          `👤 ${custName} (+91 ${cleanCustDigits})\n` +
          `💊 *${item.suggested_name || 'Special Order'}* × ${item.quantity || 1}\n\n` +
          `👉 Reply: *CONFIRM ${soCode}*`;
        await whatsappQueueWorker.enqueue(adminWhatsapp, ownerPingMsg, 'admin_escalation', 'Owner');
        await db.run(
          `UPDATE wa_pending_clarifications SET payment_reminder_sent = 1 WHERE phone = ?`,
          [item.phone]
        );
        sentCount++;
        console.log(`[PaymentReminder] Dispatched owner payment verification reminder for ${soCode} to admin`);
      }
    }

    return sentCount;
  } catch (err) {
    console.error('[PaymentReminder] Error in checkAndSendAdvancePaymentReminders:', err);
    return 0;
  }
}

export const whatsappIntentService = { handleInbound, handleOcrComplete, searchAndBroadcast, checkAndSendAdvancePaymentReminders };
export default whatsappIntentService;
