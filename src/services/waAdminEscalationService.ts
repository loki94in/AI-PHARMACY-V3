import { dbManager } from '../database/connection.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';

interface RelatedMedicineInfo { name: string; registered: boolean; inventoryStock: number }

interface EscalationPayload {
  customer: { id: number; name: string; phone: string } | null;
  isNewCustomer: boolean;
  medicineName: string;
  quantity: number;
  unit: string;
  dosageForm?: string;
  localMatches: string[];
  inventoryStock?: Record<string, number>;
  availability?: 'IN_STOCK' | 'REGISTERED_NO_STOCK' | 'EXTERNAL_ONLY';
  catalogResults: { mapped: any[]; nonMapped: any[] } | null;
  confidence: number;
  isRepeat: boolean;
  source: 'text' | 'ocr' | 'both';
  messageBody: string;
  history?: any[];
  msgId?: string;
  phone?: string;
  chatId?: string;
  // One-photo-one-result (owner rule): extra medicines seen on the shared
  // strip / caption, resolved LOCAL-ONLY by whatsappIntentService — no
  // network was spent on them and they ride along on the primary card.
  relatedMedicines?: RelatedMedicineInfo[];
  // Saved inbound photo (data/inbound_media/<msgId>.jpg) — attached to the
  // owner's WhatsApp message when present so the human sees the real strip.
  imagePath?: string;
  context?: {
    purchases: Array<{ date: string; name: string; quantity: number }>;
    refills: Array<{ medicine_name: string; next_refill_date: string | null; last_refill_date: string | null }>;
    lastMessages: Array<{ body: string }>;
  };
}

/**
 * Resolve a human-readable phone from raw WA IDs (@c.us or @lid).
 * Falls back to whatsapp_chats.resolved_number (populated at message receipt)
 * and then the stored customer phone. waDigits is a normalized 91XXXXXXXXXX
 * string usable in a wa.me link, or null when the number could not be resolved
 * (never show a wrong tap-to-chat link).
 */
async function resolvePhone(
  db: any,
  raw: string,
  chatId: string | undefined,
  customerPhone: string | undefined
): Promise<{ display: string; waDigits: string | null }> {
  const strip = (p: string) => {
    let s = String(p || '').trim();
    while (s.includes('@')) {
      s = s.split('@')[0];
    }
    return s;
  };
  const stripped = strip(raw);
  const isLid = /@lid$/i.test(raw) || (/^\d+$/.test(stripped) && stripped.length > 12);

  let candidate = stripped;
  if (isLid) {
    candidate = '';
    try {
      const row = chatId ? await db.get('SELECT resolved_number FROM whatsapp_chats WHERE id = ?', [chatId]) : null;
      const resolved = row?.resolved_number ? strip(String(row.resolved_number)).replace(/\D/g, '') : '';
      if (resolved.length >= 10 && resolved.length <= 12) candidate = resolved;
    } catch { /* table may not exist in some test DBs */ }
    if (!candidate && customerPhone) {
      const custDigits = strip(customerPhone).replace(/\D/g, '');
      if (custDigits.length >= 10 && custDigits.length <= 12) candidate = custDigits;
    }
  }

  const digits = candidate.replace(/\D/g, '');
  let waDigits: string | null = null;
  if (digits.length === 10) waDigits = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith('0')) waDigits = `91${digits.slice(1)}`;
  else if (digits.length === 12 && digits.startsWith('91')) waDigits = digits;
  else if (digits.length >= 10) waDigits = digits;

  const display = waDigits 
    ? (waDigits.length === 12 && waDigits.startsWith('91') ? `+91 ${waDigits.slice(2, 7)} ${waDigits.slice(7)}` : `+${waDigits}`)
    : (candidate || stripped || raw);
  return { display, waDigits };
}

// Priority order of app_settings keys that may hold the pharmacy's admin
// WhatsApp number. The visible Settings page saves 'owner_whatsapp_number';
// bouncedAlertService/shortageReminderService read 'admin_whatsapp_number';
// only 'admin_whatsapp' was ever checked here, so a number saved through the
// normal Settings UI was silently ignored and escalations never sent.
const ADMIN_PHONE_SETTING_KEYS = ['owner_whatsapp_number', 'admin_whatsapp_number', 'admin_whatsapp', 'shop_phone', 'store_phone'];

/**
 * Resolve the pharmacy's admin WhatsApp number from whichever settings key
 * actually holds it. Returns '' if none are set. Exported for unit testing.
 */
export async function resolveAdminWhatsappNumber(db: any): Promise<string> {
  for (const key of ADMIN_PHONE_SETTING_KEYS) {
    const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (row?.value && row.value.trim() !== '') {
      return row.value.trim();
    }
  }
  return '';
}

/**
 * Shared escalation guards: wa_auto_share_admin toggle + admin number
 * resolution + self-send guard (a request from the owner's own number must
 * never loop back to itself). Returns null when the note must not be sent.
 */
async function escalateGuard(
  db: any,
  senderPhone: string | undefined,
  customerPhoneFallback?: string
): Promise<{ adminWhatsapp: string } | null> {
  try {
    const toggle = await db.get('SELECT value FROM app_settings WHERE key = ?', ['wa_auto_share_admin']);
    if (toggle && toggle.value === 'false') return null;
  } catch { /* settings table always exists; defensive only */ }

  const adminWhatsapp = await resolveAdminWhatsappNumber(db);
  if (!adminWhatsapp) return null;

  const sender = String(senderPhone || customerPhoneFallback || '');
  const cleanPhone = (p: string) => p.replace(/\D/g, '').slice(-10);
  if (sender && cleanPhone(sender) === cleanPhone(adminWhatsapp)) return null;

  return { adminWhatsapp };
}

/** Truthful "also seen on this strip" lines for extra photo candidates. */
function buildRelatedBlock(related: RelatedMedicineInfo[] | undefined): string {
  if (!related || related.length === 0) return '';
  const fmt = (r: RelatedMedicineInfo) => r.registered
    ? `${r.name} — ${r.inventoryStock > 0 ? `✅ ${r.inventoryStock} in stock` : '🗄️ DB · 0 on shelf'}`
    : `${r.name} — ❔ not registered`;
  return `\n🧩 *Also on this strip*:\n${related.map(fmt).join('\n')}`;
}

/**
 * Notify the pharmacy about an inbound WhatsApp image that couldn't be
 * turned into a confident medicine match — either the download failed after
 * retries (no imagePath, text-only alert) or OCR ran but the result was too
 * uncertain to auto-escalate (imagePath set, forwards the actual photo so a
 * human can look at it instead of the message silently vanishing).
 * Returns false (and sends nothing) if no admin number is configured.
 */
export async function notifyAdminOfUnprocessedMedia(
  db: any,
  opts: { phone: string; chatId?: string; imagePath?: string; reason: string }
): Promise<boolean> {
  const adminWhatsapp = await resolveAdminWhatsappNumber(db);
  if (!adminWhatsapp) return false;

  const { display: displayPhone, waDigits } = await resolvePhone(db, opts.phone, opts.chatId, undefined);

  let caption = `⚠️ *Unprocessed WhatsApp Image*\n`;
  caption += `📞 *Customer:* ${displayPhone}\n`;
  if (waDigits) {
    caption += `🔗 *Quick Chat:* https://wa.me/${waDigits}\n`;
  }
  caption += `\n📝 ${opts.reason}\n`;
  caption += `Please check this chat manually.`;

  await whatsappQueueWorker.enqueue(adminWhatsapp, caption, 'admin_escalation_image', 'Admin / Store Owner', undefined, opts.imagePath);
  return true;
}

export async function maybeEscalate(payload: EscalationPayload): Promise<void> {
  try {
    const db = await dbManager.getConnection();

    // 1. Get Settings
    const getSetting = async (key: string, defaultValue: string): Promise<string> => {
      try {
        const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
        return row ? row.value : defaultValue;
      } catch {
        return defaultValue;
      }
    };

    const autoShare = await getSetting('wa_auto_share_admin', 'true');
    if (autoShare === 'false') {
      return;
    }

    const adminWhatsapp = await resolveAdminWhatsappNumber(db);
    if (!adminWhatsapp) {
      console.warn(`[Admin Escalation] wa_auto_share_admin is enabled, but no admin WhatsApp number is configured (checked ${ADMIN_PHONE_SETTING_KEYS.join(', ')}). Skipping.`);
      return;
    }

    const customerPhoneRaw = payload.phone || payload.customer?.phone || '';
    if (!customerPhoneRaw) {
      console.warn('[Admin Escalation] Customer phone is empty. Skipping.');
      return;
    }

    const { display: displayPhone, waDigits } = await resolvePhone(db, customerPhoneRaw, payload.chatId, payload.customer?.phone);

    // Self-send guard: normalize numbers and check if they are the same
    const cleanPhone = (p: string) => p.replace(/\D/g, '').slice(-10);
    if (cleanPhone(customerPhoneRaw) === cleanPhone(adminWhatsapp)) {
      console.log('[Admin Escalation] Self-send detected (customer is admin). Skipping escalation.');
      return;
    }

    // 2. Classify outcome
    let outcome: 'found_local' | 'pharmarack' | null = null;
    let bestMatch: any = null;
    let allMatches: any[] = [];

    if (payload.localMatches && payload.localMatches.length > 0) {
      outcome = 'found_local';
    } else {
      const mapped = payload.catalogResults?.mapped || [];
      const nonMapped = payload.catalogResults?.nonMapped || [];
      allMatches = [...mapped, ...nonMapped];

      if (allMatches.length > 0) {
        outcome = 'pharmarack';
        // Pick best match: mapped first
        bestMatch = mapped.length > 0 ? mapped[0] : nonMapped[0];
      }
    }

    if (!outcome) {
      // Nothing found local, and no catalog matches found
      return;
    }

    // 3. Deduplication Check
    const msgId = payload.msgId || '';
    const medicineKey = payload.medicineName.toLowerCase().trim();

    const dup = await db.get(
      `SELECT 1 FROM wa_admin_escalations
       WHERE status != 'failed' AND medicine_key = ?
         AND ( (msg_id = ? AND msg_id != '')
            OR (customer_phone = ? AND created_at > datetime('now','-24 hours')) )
       LIMIT 1`,
      [medicineKey, msgId, customerPhoneRaw]
    );

    if (dup) {
      console.log(`[Admin Escalation] Duplicate query for "${medicineKey}" from ${customerPhoneRaw} (msgId: ${msgId}). Skipping.`);
      return;
    }

    // 4. Insert initial pending record
    const insertResult = await db.run(
      `INSERT INTO wa_admin_escalations (msg_id, customer_phone, medicine_key, outcome, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [msgId, customerPhoneRaw, medicineKey, outcome]
    );
    const escalationId = insertResult.lastID;

    let reviewId: number | null = null;

    if (outcome === 'pharmarack' && bestMatch) {
      // Find existing pending WhatsApp review or create a new one
        const existingReview = await db.get(
          `SELECT id FROM staged_medicine_reviews
           WHERE lower(medicine_name) = ? AND status = 'pending' AND source = 'whatsapp'`,
          [payload.medicineName?.toLowerCase().trim() || bestMatch.name?.toLowerCase().trim() || bestMatch.productName?.toLowerCase().trim() || '']
        );

      if (existingReview) {
        reviewId = existingReview.id;
      } else {
        const original_row_data = {
          source: 'whatsapp',
          msgId,
          customerPhone: customerPhoneRaw,
          customerName: payload.customer?.name || 'New Customer',
          messageBody: payload.messageBody,
          mrp: bestMatch.mrp ?? bestMatch.MRP ?? null,
          topMatches: allMatches.slice(0, 5).map(p => ({
            name: p.name || p.productName || '',
            mrp: p.mrp ?? p.MRP ?? null,
            packaging: p.packaging || p.package || '',
            distributor: p.distributor || p.storeName || '',
            manufacturer: p.manufacturer || p.company || '',
            score: typeof p.score === 'number' ? p.score : null,
            isMapped: p.isMapped ?? p.mapped ?? false
          }))
        };

        const stagedResult = await db.run(
          `INSERT INTO staged_medicine_reviews (job_id, medicine_name, status, source, search_query, original_row_data)
           VALUES (NULL, ?, 'pending', 'whatsapp', ?, ?)`,
          [
            bestMatch.name || bestMatch.productName || payload.medicineName,
            payload.medicineName,
            JSON.stringify(original_row_data)
          ]
        );
        reviewId = stagedResult.lastID ?? null;
      }

      // Update escalation with review_id
      await db.run(
        `UPDATE wa_admin_escalations SET review_id = ? WHERE id = ?`,
        [reviewId, escalationId]
      );
    }

    // 5. Construct message template
    let messageText = '';
    const isOld = !!payload.customer && !payload.isNewCustomer;
    const custLabel = isOld ? 'Old Customer' : 'New Customer';
    const custName = payload.customer?.name || '';
    const sourceLabel = payload.source === 'ocr' ? ' (from image OCR)' : payload.source === 'both' ? ' (from text & OCR)' : '';

    // Shared customer header: label + name, real phone with tap-to-chat link
    const phoneLine = waDigits
      ? `📞 ${displayPhone} — https://wa.me/${waDigits}`
      : `📞 ${displayPhone}`;
    const customerBlock = `👤 *${custLabel}*${custName ? `: ${custName}` : ''}
${phoneLine}
📝 *Original*: "${payload.messageBody || 'N/A'}"${sourceLabel}`;

    // Old-customer context: recent purchases, refills, last messages (skip empty sections)
    const contextLines: string[] = [];
    if (isOld && payload.context) {
      const fmtDate = (d: any) => {
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      };
      const { purchases, refills, lastMessages } = payload.context;
      if (purchases?.length) {
        contextLines.push(`🧾 *Recent purchases*: ${purchases.map(p => `${p.name}${p.quantity > 1 ? ` x${p.quantity}` : ''}${fmtDate(p.date) ? ` (${fmtDate(p.date)})` : ''}`).join(', ')}`);
      }
      if (refills?.length) {
        contextLines.push(`🔁 *Refills*: ${refills.map(r => `${r.medicine_name}${r.next_refill_date && fmtDate(r.next_refill_date) ? ` (due ${fmtDate(r.next_refill_date)})` : ''}`).join(', ')}`);
      }
      if (lastMessages?.length) {
        contextLines.push(`💬 *Recent msgs*: ${lastMessages.map(m => `"${String(m.body).slice(0, 60)}"`).join(' / ')}`);
      }
    }
    const contextBlock = contextLines.length > 0 ? `\n\n${contextLines.join('\n')}` : '';
    const formLine = payload.dosageForm ? `\n🩹 *Form*: ${payload.dosageForm}` : '';
    const relatedBlock = buildRelatedBlock(payload.relatedMedicines);
    if (outcome === 'found_local') {
      const inStock = payload.availability !== 'REGISTERED_NO_STOCK';
      const fmtStock = (name: string) => {
        const units = payload.inventoryStock?.[String(name).toLowerCase()];
        return units === undefined ? name : `${name} — ${units} unit${units === 1 ? '' : 's'}`;
      };
      const formatStockBadge = (stock: any): string => {
        if (stock === undefined || stock === null || stock === '') return '';
        const s = String(stock).toLowerCase().trim();
        if (s === '0' || s.includes('out') || s.includes('no') || s.includes('unavail')) {
          return ' | 🔴 Out of Stock';
        }
        const num = parseInt(s, 10);
        if (!isNaN(num)) {
          if (num <= 0) return ' | 🔴 Out of Stock';
          if (num <= 5) return ` | 🟡 Low Stock (${num})`;
          return ` | 🟢 In Stock (${num})`;
        }
        if (s.includes('low') || s.includes('limited')) {
          return ` | 🟡 Low Stock (${stock})`;
        }
        return ` | 🟢 In Stock (${stock})`;
      };

      const isStockAvailable = (p: any): boolean => {
        const stock = p.availability ?? p.stock;
        if (stock === undefined || stock === null || stock === '') return false;
        const s = String(stock).toLowerCase().trim();
        if (s === '0' || s.includes('out') || s.includes('no') || s.includes('unavail')) return false;
        const num = parseInt(s, 10);
        if (!isNaN(num) && num <= 0) return false;
        return true;
      };

      const mappedInStock = (payload.catalogResults?.mapped || []).filter(isStockAvailable);
      const nonMappedInStock = (payload.catalogResults?.nonMapped || []).filter(isStockAvailable);
      const allInStock = [...mappedInStock, ...nonMappedInStock].slice(0, 4);

      const distLines = allInStock.length > 0
        ? allInStock
            .map((p: any, i: number) => {
              const ptr = p.distributorPrice ?? p.ptr ?? p.PTR ?? p.rate;
              const ptrStr = ptr ? ` | PTR ₹${ptr}` : '';
              const avail = formatStockBadge(p.availability ?? p.stock);
              const scheme = p.scheme ? ` | Scheme: ${p.scheme}` : '';
              return `${i + 1}. ${p.name || p.productName || 'Unknown'} | MRP ₹${p.mrp ?? p.MRP ?? '-'}${ptrStr}${avail}${scheme} | ${p.distributor || p.supplier_name || p.storeName || 'Unknown'}`;
            })
            .join('\n')
        : '🔴 All checked distributors currently Out of Stock';

      if (inStock) {
        messageText = `🔔 *Prescription Medicine Extracted*

${customerBlock}

 💊 *Extracted Medicine*: ${payload.medicineName}
 📦 *Quantity*: ${payload.quantity} ${payload.unit}${formLine}
 ⭐ *Match Confidence*: ${Math.round(payload.confidence)}%
✅ *In Stock*: ${payload.localMatches.slice(0, 3).map(fmtStock).join(', ')}
${distLines ? `\n🚚 *Distributor Availability (Pharmarack)*:\n${distLines}\n` : ''}${relatedBlock}${contextBlock}`;
      } else {
        // Generate short request code for owner 1-click WhatsApp reply
        const reqNum = Math.floor(100 + Math.random() * 900);
        const reqCode = `REQ-${reqNum}`;

        try {
          await ensureOwnerPendingRequestsTable(db);
          await db.run(
            `INSERT INTO wa_owner_pending_requests (req_code, customer_phone, customer_name, medicine_name, quantity, unit, options_json, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
             ON CONFLICT(req_code) DO UPDATE SET
               customer_phone = excluded.customer_phone,
               customer_name = excluded.customer_name,
               medicine_name = excluded.medicine_name,
               quantity = excluded.quantity,
               unit = excluded.unit,
               options_json = excluded.options_json,
               status = 'pending',
               created_at = CURRENT_TIMESTAMP`,
            [
              reqCode,
              payload.phone || payload.customer?.phone || '',
              payload.customer?.name || 'Customer',
              payload.medicineName,
              payload.quantity || 1,
              payload.unit || 'strip',
              JSON.stringify(allInStock)
            ]
          );
        } catch (saveErr) {
          console.warn('[Escalation] Failed to save owner pending request:', saveErr);
        }

        const replyGuide = allInStock.length > 0
          ? `\n\n💬 *Reply with \`${reqCode}-1\` or \`1\` to add ${payload.quantity || 1} ${payload.unit || 'strip'} to Live Cart & create Special Order.*`
          : '';

        messageText = `⚠️ *Special Order Request #${reqCode} (0 on Physical Shelf)*

${customerBlock}

 💊 *Confirmed Medicine*: ${payload.medicineName}
 📦 *Quantity*: ${payload.quantity} ${payload.unit}${formLine}
 ⭐ *Match Confidence*: ${Math.round(payload.confidence)}%
 🗄️ *DB match (0 on shelf)*: ${payload.localMatches.slice(0, 3).join(', ')}
${distLines ? `\n🚚 *In-Stock Distributor Options*:\n${distLines}\n` : ''}${relatedBlock}
👉 Needs a purchase order before confirming to the customer.${replyGuide}${contextBlock}`;
      }
    } else {
      // PharmaRack outcome — mapped distributors first, then non-mapped,
      // each line: name | company | pack | MRP | distributor | match%
      const formatStockBadge = (stock: any): string => {
        if (stock === undefined || stock === null || stock === '') return '';
        const s = String(stock).toLowerCase().trim();
        if (s === '0' || s.includes('out') || s.includes('no') || s.includes('unavail')) {
          return ' | 🔴 Out of Stock';
        }
        const num = parseInt(s, 10);
        if (!isNaN(num)) {
          if (num <= 0) return ' | 🔴 Out of Stock';
          if (num <= 5) return ` | 🟡 Low Stock (${num})`;
          return ` | 🟢 In Stock (${num})`;
        }
        if (s.includes('low') || s.includes('limited')) {
          return ` | 🟡 Low Stock (${stock})`;
        }
        return ` | 🟢 In Stock (${stock})`;
      };

      const fmtMatch = (p: any, idx: number) => {
        const name = p.name || p.productName || 'Unknown';
        const company = p.manufacturer || p.company || '';
        const pkg = p.packaging || p.package || '-';
        const mrp = p.mrp ?? p.MRP ?? '-';
        const dist = p.distributor || p.supplier_name || p.storeName || 'Unknown';
        const ptr = p.distributorPrice ?? p.ptr ?? p.PTR ?? p.rate;
        const ptrStr = ptr ? ` | PTR ₹${ptr}` : '';
        const avail = formatStockBadge(p.availability ?? p.stock);
        const scheme = p.scheme ? ` | Scheme: ${p.scheme}` : '';
        const scoreStr = typeof p.score === 'number' ? ` | ${Math.round(p.score * 100)}%` : '';
        return `${idx}. ${name}${company ? ` | ${company}` : ''} | ${pkg} | MRP ₹${mrp}${ptrStr}${avail}${scheme} | ${dist}${scoreStr}`;
      };

      const mappedTop = (payload.catalogResults?.mapped || []).slice(0, 4);
      const nonMappedTop = (payload.catalogResults?.nonMapped || []).slice(0, mappedTop.length > 0 ? 2 : 4);
      const sections: string[] = [];
      let idx = 1;
      if (mappedTop.length > 0) {
        sections.push(`✅ *Mapped distributors*\n${mappedTop.map(p => fmtMatch(p, idx++)).join('\n')}`);
      }
      if (nonMappedTop.length > 0) {
        sections.push(`📦 *Other distributors*\n${nonMappedTop.map(p => fmtMatch(p, idx++)).join('\n')}`);
      }
      const matchBlock = sections.join('\n');

      messageText = `⚠️ *Medicine NOT in Local Stock — PharmaRack Matches*

${customerBlock}
 🔍 *Searched*: ${payload.medicineName}${payload.dosageForm ? ` (${payload.dosageForm})` : ''}${payload.confidence ? ` — best match ${Math.round(payload.confidence)}%` : ''}

${matchBlock}${relatedBlock}${contextBlock}

📋 Added to approval queue (Review #${reviewId}). Approve in the app to add to inventory.`;
    }

    // 6. Enqueue WhatsApp message in centralized queue — attach the actual
    // shared photo when we have it, so the owner sees the real strip.
    try {
      await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_escalation', 'Admin / Store Owner', undefined, payload.imagePath);
      await db.run(`UPDATE wa_admin_escalations SET status = 'sent' WHERE id = ?`, [escalationId]);
      console.log(`[Admin Escalation] Enqueued escalation for "${payload.medicineName}" to admin ${adminWhatsapp}.`);
    } catch (sendErr: any) {
      console.error(`[Admin Escalation] Failed to enqueue message:`, sendErr);
      await db.run(`UPDATE wa_admin_escalations SET status = 'failed' WHERE id = ?`, [escalationId]);
    }

  } catch (err) {
    console.error('[Admin Escalation] Error in maybeEscalate:', err);
  }
}

interface NonAllopathicNotePayload {
  customer: { id: number; name: string; phone: string } | null;
  medicineName: string;
  productKind: string;
  quantity?: number;
  unit?: string;
  messageBody?: string;
  source: 'text' | 'ocr' | 'both';
  msgId?: string;
  phone?: string;
  chatId?: string;
  imagePath?: string;
}

/**
 * Short one-line owner note for cosmetic / ayurvedic / homeopathy requests
 * (owner decision 2026-08): the pipeline deliberately skipped Pharmarack
 * searches for these — the note keeps every request visible on WhatsApp
 * without burning search budget or shortage tracking. Same guards as
 * maybeEscalate: wa_auto_share_admin toggle, admin-number resolution,
 * self-send guard and the 24h per-customer+medicine dedupe.
 */
export async function notifyAdminOfNonAllopathic(payload: NonAllopathicNotePayload): Promise<void> {
  try {
    const db = await dbManager.getConnection();
    const guard = await escalateGuard(db, payload.phone || payload.customer?.phone, payload.customer?.phone);
    if (!guard) return;
    const adminWhatsapp = guard.adminWhatsapp;

    const customerPhoneRaw = payload.phone || payload.customer?.phone || '';
    if (!customerPhoneRaw) return;

    // Same dedupe key space as real escalations so a repeat ask within 24h
    // never re-pings the owner.
    const medicineKey = payload.medicineName.toLowerCase().trim();
    const msgId = payload.msgId || '';
    const dup = await db.get(
      `SELECT 1 FROM wa_admin_escalations
       WHERE status != 'failed' AND medicine_key = ?
         AND ( (msg_id = ? AND msg_id != '')
            OR (customer_phone = ? AND created_at > datetime('now','-24 hours')) )
       LIMIT 1`,
      [medicineKey, msgId, customerPhoneRaw]
    );
    if (dup) return;

    await db.run(
      `INSERT INTO wa_admin_escalations (msg_id, customer_phone, medicine_key, outcome, status)
       VALUES (?, ?, ?, 'non_allopathic', 'pending')`,
      [msgId, customerPhoneRaw, medicineKey]
    );

    const { display: displayPhone, waDigits } = await resolvePhone(db, customerPhoneRaw, payload.chatId, payload.customer?.phone);
    const phoneLine = waDigits ? `${displayPhone} — https://wa.me/${waDigits}` : displayPhone;
    const kindLabel = String(payload.productKind || 'non-allopathic').toUpperCase();
    const kindEmoji = kindLabel === 'AYURVEDIC' ? '🌿' : kindLabel === 'HOMEOPATHY' ? '💧' : '🧴';

    const messageText = `${kindEmoji} *Non-Allopathic Request* (${kindLabel})

👤 ${payload.customer?.name || 'Customer'}
📞 ${phoneLine}
📝 *Original*: "${payload.messageBody || 'N/A'}"

💊 *Asked for*: ${payload.medicineName}${payload.quantity ? ` × ${payload.quantity}${payload.unit ? ` ${payload.unit}` : ''}` : ''}
ℹ️ Pharmarack search skipped — not an allopathic medicine.`;

    try {
      await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_escalation_non_allopathic', 'Admin / Store Owner', undefined, payload.imagePath);
      console.log(`[Admin Escalation] Non-allopathic note sent for "${payload.medicineName}" (${kindLabel}).`);
    } catch (sendErr: any) {
      console.error('[Admin Escalation] Failed to enqueue non-allopathic note:', sendErr);
    }
  } catch (err) {
    console.error('[Admin Escalation] Error in notifyAdminOfNonAllopathic:', err);
  }
}

export interface UnmatchedQueryPayload {
  customer: { id: number; name: string; phone: string } | null;
  medicineName: string;
  quantity?: number;
  unit?: string;
  messageBody?: string;
  source: 'text' | 'ocr' | 'both';
  msgId?: string;
  phone?: string;
  chatId?: string;
  imagePath?: string;
}

/**
 * Notifies the store owner when a customer asks for a medicine that was not found
 * in either the local database or Pharmarack distributors.
 */
export async function notifyAdminOfUnmatchedQuery(payload: UnmatchedQueryPayload): Promise<void> {
  try {
    const db = await dbManager.getConnection();
    const guard = await escalateGuard(db, payload.phone || payload.customer?.phone, payload.customer?.phone);
    if (!guard) return;
    const adminWhatsapp = guard.adminWhatsapp;

    const customerPhoneRaw = payload.phone || payload.customer?.phone || '';
    if (!customerPhoneRaw) return;

    const medicineKey = payload.medicineName.toLowerCase().trim();
    const msgId = payload.msgId || '';
    const dup = await db.get(
      `SELECT 1 FROM wa_admin_escalations
       WHERE status != 'failed' AND medicine_key = ?
         AND ( (msg_id = ? AND msg_id != '')
            OR (customer_phone = ? AND created_at > datetime('now','-24 hours')) )
       LIMIT 1`,
      [medicineKey, msgId, customerPhoneRaw]
    );
    if (dup) return;

    await db.run(
      `INSERT INTO wa_admin_escalations (msg_id, customer_phone, medicine_key, outcome, status)
       VALUES (?, ?, ?, 'unmatched', 'pending')`,
      [msgId, customerPhoneRaw, medicineKey]
    );

    const { display: displayPhone, waDigits } = await resolvePhone(db, customerPhoneRaw, payload.chatId, payload.customer?.phone);
    const phoneLine = waDigits ? `${displayPhone} — https://wa.me/${waDigits}` : displayPhone;

    const messageText = `❓ *Unmatched Customer Medicine Inquiry*

👤 ${payload.customer?.name || 'Customer'}
📞 ${phoneLine}
📝 *Original*: "${payload.messageBody || payload.medicineName}"

💊 *Asked for*: ${payload.medicineName}${payload.quantity && payload.quantity > 1 ? ` × ${payload.quantity}${payload.unit ? ` ${payload.unit}` : ''}` : ''}
❌ *Outcome*: Not found in local inventory and no distributor match in Pharmarack.
👉 Customer may have typed a rare brand or heavy typo. Please verify manually.`;

    try {
      await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_escalation_unmatched', 'Admin / Store Owner', undefined, payload.imagePath);
      console.log(`[Admin Escalation] Unmatched medicine alert sent for "${payload.medicineName}" to admin ${adminWhatsapp}.`);
    } catch (sendErr: any) {
      console.error('[Admin Escalation] Failed to enqueue unmatched query alert:', sendErr);
    }
  } catch (err) {
    console.error('[Admin Escalation] Error in notifyAdminOfUnmatchedQuery:', err);
  }
}

export interface CustomerConfirmationPayload {
  customer: { id: number; name: string; phone: string } | null;
  suggestedName: string;
  originalQuery: string;
  phone: string;
  chatId?: string;
}

/**
 * Notifies the store owner when a customer replies confirming the medicine name.
 */
export async function notifyAdminOfCustomerConfirmation(payload: CustomerConfirmationPayload): Promise<void> {
  try {
    const db = await dbManager.getConnection();
    const guard = await escalateGuard(db, payload.phone, payload.customer?.phone);
    if (!guard) return;
    const adminWhatsapp = guard.adminWhatsapp;

    const { display: displayPhone, waDigits } = await resolvePhone(db, payload.phone, payload.chatId, payload.customer?.phone);
    const phoneLine = waDigits ? `${displayPhone} — https://wa.me/${waDigits}` : displayPhone;

    const messageText = `✅ *Customer Confirmed Medicine*

👤 ${payload.customer?.name || 'Customer'}
📞 ${phoneLine}

💊 *Confirmed Item*: *${payload.suggestedName}*
📝 *Original Inquiry*: "${payload.originalQuery}"
👉 Customer confirmed with "Yes". Ready to fulfill or create purchase order.`;

    await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_escalation_confirmed', 'Admin / Store Owner');
    console.log(`[Admin Escalation] Customer confirmation forwarded for "${payload.suggestedName}".`);
  } catch (err) {
    console.error('[Admin Escalation] Error in notifyAdminOfCustomerConfirmation:', err);
  }
}

export interface LiveCartAddNotificationPayload {
  customer: { id?: number; name?: string; phone?: string } | null;
  phone: string;
  orderId?: string | number;
  items: Array<{
    name: string;
    quantity: number;
    distributor: string;
    rate?: number | null;
    mrp?: number | null;
  }>;
  success: boolean;
  manualReview?: boolean;
  error?: string;
  chatId?: string;
}

/**
 * Notifies the store owner on WhatsApp when a confirmed order is processed.
 * When auto_add_to_live_cart is ON: notifies of live addition or failure.
 * When auto_add_to_live_cart is OFF: notifies that request was received and requires manual Live Cart review.
 * Per master plan: Owner notification is automatic; customer communication remains STAGED.
 */
export async function notifyAdminOfLiveCartAdd(payload: LiveCartAddNotificationPayload): Promise<void> {
  try {
    const db = await dbManager.getConnection();
    const guard = await escalateGuard(db, payload.phone, payload.customer?.phone);
    if (!guard) return;
    const adminWhatsapp = guard.adminWhatsapp;

    const { display: displayPhone, waDigits } = await resolvePhone(db, payload.phone, payload.chatId, payload.customer?.phone);
    const phoneLine = waDigits ? `${displayPhone} (https://wa.me/${waDigits})` : displayPhone;
    const custName = payload.customer?.name || 'Customer';

    const itemsList = payload.items.map(it => {
      const rateStr = it.rate ? ` | PTR: ₹${Number(it.rate).toFixed(2)}` : '';
      const mrpStr = it.mrp ? ` | MRP: ₹${Number(it.mrp).toFixed(2)}` : '';
      return `• *${it.name}* × ${it.quantity} → *${it.distributor}*${rateStr}${mrpStr}`;
    }).join('\n');

    let messageText = '';
    if (payload.manualReview) {
      messageText = `📝 *WhatsApp Order Received (Manual Cart Review)*

👤 Customer: ${custName}
📞 Phone: ${phoneLine}
📋 Order Ref: #${payload.orderId || 'WA-ORDER'}

Medicines:
${itemsList}

Cart: ⏸️ Auto Add OFF (Requires Manual Review)
📋 Customer message: STAGED
🔒 Customer auto-send: OFF

The order has been recorded and is ready for your manual review in Live Cart / Quick Assist.
Customer communication is waiting in Staged Messages for manual review and sending.`;
    } else if (payload.success) {
      messageText = `🛒 *WhatsApp Order Added to Live Cart*

👤 Customer: ${custName}
📞 Phone: ${phoneLine}
📋 Order Ref: #${payload.orderId || 'WA-ORDER'}

Medicines:
${itemsList}

Cart: ✅ Successfully Added to Pharmarack Live Cart
📋 Customer message: STAGED
🔒 Customer auto-send: OFF

The order has been added to the Live Cart.
Customer communication is waiting in Staged Messages for manual review and sending.`;
    } else {
      messageText = `⚠️ *WhatsApp Order Requires Attention*

👤 Customer: ${custName}
📞 Phone: ${phoneLine}
📋 Order Ref: #${payload.orderId || 'WA-ORDER'}

Medicines:
${itemsList}

Pharmarack Cart: ❌ Add failed (${payload.error || 'Cart error'})
Action required in application.`;
    }

    await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_escalation_cart_add', 'Admin / Store Owner');
    console.log(`[Admin Escalation] Live Cart add alert sent to admin for order #${payload.orderId}.`);
  } catch (err) {
    console.error('[Admin Escalation] Error in notifyAdminOfLiveCartAdd:', err);
  }
}

export interface OwnerSpecialOrderResultsPayload {
  specialOrderId: number;
  soCode: string;
  customerName: string;
  customerPhone: string;
  medicineName: string;
  productName?: string;
  quantity: number;
  unit: string;
  mrp?: number | null;
  totalAmount?: number | null;
  pharmarackOptions: any[];
}

/**
 * Notifies the pharmacy owner of available in-stock Pharmarack results for a confirmed Special Order.
 * Follows the exact format in WhatsApp Medicine Request spec §9.
 */
export async function notifyOwnerOfSpecialOrderPharmarackResults(payload: OwnerSpecialOrderResultsPayload): Promise<void> {
  try {
    const db = await dbManager.getConnection();
    const guard = await escalateGuard(db, payload.customerPhone);
    if (!guard) return;
    const adminWhatsapp = guard.adminWhatsapp;

    await ensureOwnerPendingRequestsTable(db);
    await db.run(
      `INSERT INTO wa_owner_pending_requests (
         req_code, customer_phone, customer_name, medicine_name, quantity, unit, options_json, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
       ON CONFLICT(req_code) DO UPDATE SET
         customer_phone = excluded.customer_phone,
         customer_name = excluded.customer_name,
         medicine_name = excluded.medicine_name,
         quantity = excluded.quantity,
         unit = excluded.unit,
         options_json = excluded.options_json,
         status = 'pending',
         created_at = CURRENT_TIMESTAMP`,
      [
        payload.soCode,
        payload.customerPhone,
        payload.customerName,
        payload.medicineName,
        payload.quantity,
        payload.unit,
        JSON.stringify(payload.pharmarackOptions)
      ]
    );

    const formatNum = (n: number) => {
      const symbols = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      return symbols[n] || `${n + 1}️⃣`;
    };

    const customerMrp = payload.mrp != null && payload.mrp > 0 ? Number(payload.mrp) : null;
    const totalOrderVal = payload.totalAmount != null && payload.totalAmount > 0
      ? Number(payload.totalAmount)
      : (customerMrp ? customerMrp * payload.quantity : null);

    const resultsList = payload.pharmarackOptions.map((opt, i) => {
      const dist = opt.distributor || opt.supplier_name || opt.storeName || opt.distributor_name || 'Distributor';
      const rate = Number(opt.distributorPrice ?? opt.ptr ?? opt.PTR ?? opt.rate ?? 0);
      const optMrp = Number(opt.mrp ?? 0);
      const isUnmapped = opt.mapped === false || opt.isMapped === false || opt.is_mapped === 0 || String(opt.IsMapped) === '0' || String(opt.Ismapped) === '0';
      const tag = isUnmapped ? ' [Unmapped]' : '';
      const refBadge = i === 0 ? ' [Best Rate]' : (i === 1 ? ' [High Stock]' : '');

      // Stock indicator: 🟢 (QTY) / 🟢 High, 🟡 (QTY) / 🟡 Low, 🔴 (0)
      let stockIndicator = '🟢 High';
      const s = String(opt.stock ?? '').trim().toLowerCase();
      const num = parseInt(s, 10);
      if (!isNaN(num)) {
        if (num >= 15) stockIndicator = `🟢 (${num})`;
        else if (num > 0) stockIndicator = `🟡 (${num})`;
        else stockIndicator = `🔴 (0)`;
      } else if (s === 'low') {
        stockIndicator = '🟡 Low';
      } else if (s === '0' || s === 'oos' || s === 'out of stock' || s === 'nil') {
        stockIndicator = '🔴 (0)';
      } else if (s === 'high' || s === 'available') {
        stockIndicator = '🟢 High';
      } else if (opt.stock) {
        stockIndicator = `🟢 (${opt.stock})`;
      }

      // Calculate margin against distributor catalog MRP (falling back to customer confirmed MRP)
      const itemMrp = (optMrp > 0 ? optMrp : 0) || (customerMrp || 0);
      let marginLine = '';
      if (rate > 0 && itemMrp > rate) {
        const marginVal = itemMrp - rate;
        const marginPct = ((marginVal / itemMrp) * 100).toFixed(1);
        marginLine = `Margin: ₹${marginVal.toFixed(2)} (${marginPct}%)`;
      }

      // Clean two-line format: Rate & MRP on first line, Margin on second line (no Wholesale PTR row)
      let priceDetails = '';
      if (rate > 0) {
        const mrpPart = itemMrp > 0 ? ` | MRP: ₹${itemMrp.toFixed(2)}` : '';
        priceDetails = `   Rate: ₹${rate.toFixed(2)}${mrpPart}`;
        if (marginLine) {
          priceDetails += `\n   ${marginLine}`;
        }
      } else if (itemMrp > 0) {
        priceDetails = `   Rate: Available | MRP: ₹${itemMrp.toFixed(2)}`;
      } else {
        priceDetails = `   Rate: Available`;
      }

      const medLine = (opt.name || opt.shortName || '').trim();
      return `${formatNum(i)}${refBadge} *${dist}*${tag} | ${stockIndicator}\n${medLine ? '   ' + medLine + '\n' : ''}${priceDetails}`;
    }).join('\n\n');

    const confirmedProductTitle = payload.productName || payload.medicineName;
    const mrpLine = customerMrp != null ? `\n🏷️ *Customer MRP*: ₹${customerMrp.toFixed(2)} / ${payload.unit || 'strip'}` : '';
    const totalLine = totalOrderVal != null ? `\n💰 *Total Order Value*: ₹${totalOrderVal.toFixed(2)}` : '';

    const messageText =
      `🔍 *Special Order Verification & Sourcing*\n\n` +
      `🆔 *Order*: ${payload.soCode}\n` +
      `👤 *Customer*: ${payload.customerName} (+91 ${payload.customerPhone})\n\n` +
      `💊 *Confirmed Product*: *${confirmedProductTitle}*\n` +
      `📦 *Quantity*: ${payload.quantity} ${payload.unit || 'strip'}` +
      `${mrpLine}` +
      `${totalLine}\n\n` +
      `🤖 *Top ${payload.pharmarackOptions.length} Sourcing References:*\n\n` +
      `${resultsList}\n\n` +
      `⚖️ *Verification Check:*\n` +
      `👉 Reply *CONFIRM* (or *1*) to approve Option 1 & send payment QR to customer\n` +
      (payload.pharmarackOptions.length > 1 ? `👉 Reply *2* to choose Option 2\n` : '') +
      `👉 Reply *REJECT* to cancel`;

    await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_escalation', 'Admin / Store Owner');
    console.log(`[Admin Escalation] Special Order ${payload.soCode} results dispatched to owner.`);
  } catch (err) {
    console.error('[Admin Escalation] Error in notifyOwnerOfSpecialOrderPharmarackResults:', err);
  }
}

export interface PrescriptionEscalationPayload {
  rxCode?: string;
  customerPhone: string;
  customerName?: string;
  chatId?: string;
  patientName?: string;
  doctorName?: string;
  clinicHospital?: string;
  date?: string;
  items: Array<{
    medicineName: string;
    strength?: string;
    dosage?: string;
    frequency?: string;
    duration?: string;
    quantity?: number;
    instructions?: string;
    handwrittenNotes?: string;
    inStock?: boolean;
    stockQty?: number;
  }>;
  notes?: string;
  imagePath?: string;
}

/**
 * Notifies the pharmacy owner/pharmacist of a multi-medicine doctor prescription
 * detected by AI Camera. Registers request as #RX-xxx in wa_owner_pending_requests
 * so the pharmacist can confirm or reject via WhatsApp.
 */
export async function notifyAdminOfPrescription(
  db: any,
  payload: PrescriptionEscalationPayload
): Promise<string | null> {
  try {
    const guard = await escalateGuard(db, payload.customerPhone);
    if (!guard) return null;
    const adminWhatsapp = guard.adminWhatsapp;

    await ensureOwnerPendingRequestsTable(db);

    let rxCode = payload.rxCode;
    if (!rxCode) {
      const countRow = await db.get("SELECT count(*) as c FROM wa_owner_pending_requests WHERE req_code LIKE 'RX-%'");
      const rxNum = 1000 + (countRow?.c || 0) + 1;
      rxCode = `RX-${rxNum}`;
    }

    const summaryMedNames = payload.items.map(it => it.medicineName).filter(Boolean).join(', ');
    await db.run(
      `INSERT INTO wa_owner_pending_requests (
         req_code, customer_phone, customer_name, medicine_name, quantity, unit, options_json, status, created_at
       ) VALUES (?, ?, ?, ?, ?, 'items', ?, 'pending', CURRENT_TIMESTAMP)
       ON CONFLICT(req_code) DO UPDATE SET
         customer_phone = excluded.customer_phone,
         customer_name = excluded.customer_name,
         medicine_name = excluded.medicine_name,
         quantity = excluded.quantity,
         unit = excluded.unit,
         options_json = excluded.options_json,
         status = 'pending',
         created_at = CURRENT_TIMESTAMP`,
      [
        rxCode,
        payload.customerPhone,
        payload.patientName || payload.customerName || 'WhatsApp Patient',
        summaryMedNames || 'Doctor Prescription',
        payload.items.length,
        JSON.stringify(payload)
      ]
    );

    const { display: displayPhone, waDigits } = await resolvePhone(db, payload.customerPhone, payload.chatId, payload.customerPhone);

    const symbols = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const itemsList = payload.items.map((it, idx) => {
      const numIcon = symbols[idx] || `${idx + 1}️⃣`;
      let line = `${numIcon} *${it.medicineName}*`;
      if (it.strength && !it.medicineName.toLowerCase().includes(it.strength.toLowerCase())) {
        line += ` ${it.strength}`;
      }
      const dosageDetails = [it.dosage, it.frequency, it.duration ? `(${it.duration})` : ''].filter(Boolean).join(' ');
      if (dosageDetails) line += ` — ${dosageDetails}`;

      let stockTag = '';
      if (typeof it.stockQty === 'number') {
        stockTag = it.stockQty > 0 ? `\n   📦 Shelf Stock: *${it.stockQty} in stock* ✅` : `\n   📦 Shelf Stock: *0 on shelf (Out of stock ⚠️)*`;
      } else if (it.inStock !== undefined) {
        stockTag = it.inStock ? `\n   📦 Shelf Stock: *Available in stock* ✅` : `\n   📦 Shelf Stock: *Out of stock ⚠️*`;
      }

      let noteTag = '';
      if (it.handwrittenNotes) {
        noteTag = `\n   📝 *Doctor Note / Sub:* _${it.handwrittenNotes}_`;
      }
      return `${line}${stockTag}${noteTag}`;
    }).join('\n');

    let msg = `📋 *New Doctor Prescription Received*\n\n`;
    msg += `🆔 *Prescription ID*: *${rxCode}*\n`;
    if (payload.patientName) msg += `👤 *Patient*: ${payload.patientName}\n`;
    if (payload.doctorName) msg += `🩺 *Doctor*: ${payload.doctorName}${payload.clinicHospital ? ` (${payload.clinicHospital})` : ''}\n`;
    msg += `📱 *Customer*: ${displayPhone}\n`;
    if (waDigits) msg += `🔗 *Quick Chat*: https://wa.me/${waDigits}\n`;
    msg += `\n💊 *Prescribed Medicines (${payload.items.length} items)*:\n`;
    msg += `${itemsList}\n\n`;
    msg += `---------------------------------\n`;
    msg += `*Pharmacist Action (Human-in-the-Loop)*:\n`;
    msg += `Reply *CONFIRM ${rxCode}* to approve & message patient with invoice/bill.\n`;
    msg += `Reply *REJECT ${rxCode}* to reject or request a clear photo.`;

    await whatsappQueueWorker.enqueue(
      adminWhatsapp,
      msg,
      'admin_escalation',
      'Admin / Store Owner',
      undefined,
      payload.imagePath
    );
    console.log(`[Admin Escalation] Prescription ${rxCode} alert sent to pharmacist/admin with ${payload.items.length} items.`);
    return rxCode;
  } catch (err) {
    console.error('[Admin Escalation] Error in notifyAdminOfPrescription:', err);
    return null;
  }
}

let ownerPendingTableEnsured = false;
export async function ensureOwnerPendingRequestsTable(db: any): Promise<void> {
  if (ownerPendingTableEnsured) return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS wa_owner_pending_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      req_code TEXT UNIQUE,
      customer_phone TEXT,
      customer_name TEXT,
      medicine_name TEXT,
      quantity INTEGER DEFAULT 1,
      unit TEXT DEFAULT 'strip',
      options_json TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_owner_req_code ON wa_owner_pending_requests(req_code);
  `);
  ownerPendingTableEnsured = true;
}

export const waAdminEscalationService = {
  maybeEscalate,
  notifyAdminOfUnprocessedMedia,
  resolveAdminWhatsappNumber,
  notifyAdminOfNonAllopathic,
  notifyAdminOfUnmatchedQuery,
  notifyAdminOfCustomerConfirmation,
  notifyAdminOfLiveCartAdd,
  notifyOwnerOfSpecialOrderPharmarackResults,
  notifyAdminOfPrescription,
  ensureOwnerPendingRequestsTable
};
