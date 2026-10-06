/**
 * Cross-check of a distributor's invoice mail against the Pharmarack order placed today.
 *
 * Today's order lines live in `pharmarack_placed_orders.items_json` (real names, quantities, MRP, rate).
 * When a distributor mail arrives, its attachment items (parse only, nothing imported) are compared to
 * those lines: which medicines came, which are missing, which are short. The OWNER gets one WhatsApp
 * summary plus an in-app toast. Never sent to a distributor or patient; nothing is invented: no readable
 * mail items or no order today means no message.
 */
import fs from 'fs';
import { dbManager } from '../database/connection.js';
import { scoreOrderNameMatch, ARRIVAL_MATCH_THRESHOLD } from '../utils/orderNameMatcher.js';

export interface OrderLine { name: string; qty: number | null; mrp: number | null; rate: number | null; packaging?: string }
export interface BillLine { name: string; qty?: number | null; mrp?: number | null }
export interface OrderComparison {
  present: Array<{ ordered: string; billName: string; qty: number | null; billQty: number | null; orderedMrp: number | null; billMrp: number | null; mrpMatches: boolean | null; short: boolean }>;
  missing: Array<{ name: string; qty: number | null; mrp: number | null }>;
  notOrdered: string[];
}

const alnum = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Every line of today's order rows whose distributor name matches (letters+digits only, either contains the other). */
export async function loadTodaysOrderLines(db: any, distributor: string, linkedStores: string[] = []): Promise<OrderLine[]> {
  const dKey = alnum(distributor);
  const linkedKeys = linkedStores.map(alnum).filter(Boolean);
  if (!dKey && linkedKeys.length === 0) return [];
  const rows = await db.all('SELECT store_name, items_json FROM pharmarack_placed_orders WHERE order_date = ?', [localToday()]);
  const out: OrderLine[] = [];
  for (const r of rows) {
    const sk = alnum(r.store_name);
    if (!sk) continue;
    // A user-made link to a Pharmarack distributor is exact; only unlinked distributors use name matching.
    const hit = linkedKeys.length > 0 ? linkedKeys.includes(sk) : (!!dKey && (sk === dKey || sk.includes(dKey) || dKey.includes(sk)));
    if (!hit) continue;
    let items: any[] = [];
    try { items = JSON.parse(r.items_json || '[]'); } catch (_) { /* unreadable row: skipped */ }
    for (const it of items) {
      const name = String(it.productName || it.product || it.name || '').trim();
      if (!name) continue;
      const qty = Number(it.qty ?? it.quantity);
      out.push({ name, qty: qty > 0 ? qty : null, mrp: Number(it.mrp) > 0 ? Number(it.mrp) : null, rate: Number(it.rate) > 0 ? Number(it.rate) : null, packaging: String(it.packaging || '').trim() || undefined });
    }
  }
  return out;
}

/** "100ML"/"60 ml"/"1X100ML" style volume or weight tokens found in a text, e.g. ['100ml']. */
function sizeTokens(text: string | undefined): string[] {
  return Array.from(String(text || '').toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(ml|gm|g|l|kg|mg)\b/g)).map(m => `${m[1]}${m[2]}`);
}

/** Pack volume/weight (ml, gm, g, l, kg) is not part of the medicine name; strength like 500mg stays. */
function stripPackSize(text: string): string {
  return text.replace(/(^|[^a-z0-9])[0-9]+(?:[.][0-9]+)?\s*(?:ml|gm|g|l|kg)(?![a-z])/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function compareOrderWithBill(ordered: OrderLine[], billIn: BillLine[]): OrderComparison {
  const bill = billIn.map(b => ({
    name: String(b?.name || '').trim(),
    qty: Number(b?.qty) > 0 ? Number(b.qty) : null,
    mrp: Number(b?.mrp) > 0 ? Number(b.mrp) : null
  }));
  const used = new Set<number>();
  const present: OrderComparison['present'] = [];
  const missing: OrderComparison['missing'] = [];
  for (const o of ordered) {
    let best = -1; let bestScore = 0; let bestRank = -Infinity;
    bill.forEach((b, i) => {
      if (!b.name || used.has(i)) return;
      const sc = scoreOrderNameMatch(stripPackSize(b.name), stripPackSize(o.name), { incomingMrp: b.mrp, orderMrp: o.mrp }).score;
      // Two pack variants of one name (100ML vs 60ML): the bill line naming the SAME size wins the tie.
      const want = sizeTokens(`${o.name} ${o.packaging || ''}`);
      const have = sizeTokens(b.name);
      const rank = sc + (want.length > 0 && have.length > 0 ? (want.some(w => have.includes(w)) ? 15 : -30) : 0);
      if (sc >= ARRIVAL_MATCH_THRESHOLD && rank > bestRank) { bestRank = rank; bestScore = sc; best = i; }
    });
    if (best >= 0 && bestScore >= ARRIVAL_MATCH_THRESHOLD) {
      used.add(best);
      const b = bill[best];
      present.push({
        ordered: o.name, billName: b.name, qty: o.qty, billQty: b.qty, orderedMrp: o.mrp, billMrp: b.mrp,
        mrpMatches: o.mrp !== null && b.mrp !== null ? Math.abs(o.mrp - b.mrp) < 0.5 : null,
        short: o.qty !== null && b.qty !== null && b.qty < o.qty
      });
    } else {
      missing.push({ name: o.name, qty: o.qty, mrp: o.mrp });
    }
  }
  const notOrdered = bill.filter((b, i) => b.name && !used.has(i)).map(b => b.name);
  return { present, missing, notOrdered };
}

/** Share of today's order that the mail covers: by quantity when every ordered line has one, else by medicines. */
export function completionPercent(cmp: OrderComparison): number {
  const total = cmp.present.length + cmp.missing.length;
  if (total === 0) return 0;
  const allQty = [...cmp.present.map(p => p.qty), ...cmp.missing.map(m => m.qty)].every(q => q !== null);
  if (!allQty) return Math.round((cmp.present.length / total) * 100);
  const ordered = cmp.present.reduce((s, p) => s + (p.qty as number), 0) + cmp.missing.reduce((s, m) => s + (m.qty as number), 0);
  const got = cmp.present.reduce((s, p) => s + Math.min(p.qty as number, p.billQty ?? (p.qty as number)), 0);
  return ordered > 0 ? Math.round((got / ordered) * 100) : 0;
}

function buildMessage(distributor: string, invoice: string | null, cmp: OrderComparison, pct: number): string {
  const total = cmp.present.length + cmp.missing.length;
  const q = (n: number | null) => (n ? ` ×${n}` : '');
  const lines = [
    `📦 *Order check — ${distributor}*`,
    ...(invoice && invoice !== 'N/A' ? [`Invoice: ${invoice}`] : []),
    pct >= 100 && cmp.missing.length === 0
      ? `✅ Today's order is complete in the mail (${total}/${total} medicines).`
      : `${pct}% of today's order is in the mail (${cmp.present.length}/${total} medicines).`
  ];
  if (cmp.missing.length) lines.push('', '❌ *Missing:*', ...cmp.missing.slice(0, 25).map(m => `• ${m.name}${q(m.qty)}`));
  const short = cmp.present.filter(p => p.short);
  if (short.length) lines.push('', '⚠️ *Short quantity:*', ...short.slice(0, 25).map(p => `• ${p.ordered} — ordered ${p.qty}, mail ${p.billQty}`));
  const mrpDiff = cmp.present.filter(p => p.mrpMatches === false);
  if (mrpDiff.length) lines.push('', '💲 *MRP differs:*', ...mrpDiff.slice(0, 10).map(p => `• ${p.ordered}: order ₹${p.orderedMrp}, mail ₹${p.billMrp}`));
  if (cmp.notOrdered.length) lines.push('', `Also in the mail (not in today's order): ${cmp.notOrdered.slice(0, 8).join(', ')}${cmp.notOrdered.length > 8 ? '…' : ''}`);
  return lines.join('\n');
}

/**
 * Called once per arrived distributor mail. Parses ONLY the mail's attachments (no import), compares with
 * today's order, and tells the owner. Safe to call twice: each (mail, recipient) is notified once.
 */
export async function checkMailAgainstTodaysOrder(uid: number): Promise<void> {
  const db = await dbManager.getConnection();
  const mail = await db.get('SELECT uid, distributor_name, extracted_distributor, extracted_invoice_no FROM emails WHERE uid = ?', [uid]);
  const distributor = String(mail?.extracted_distributor || mail?.distributor_name || '').trim();
  if (!distributor) return;

  // Same-day only: a mail that did not arrive today is never compared with an order.
  const mailDay = await db.get("SELECT date(date, 'localtime') AS d, date('now', 'localtime') AS today FROM emails WHERE uid = ?", [uid]);
  if (!mailDay?.d || mailDay.d !== mailDay.today) return;

  const distRow = await db.get('SELECT id FROM distributors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [distributor]);
  const links = distRow
    ? await db.all('SELECT store_name FROM pharmarack_distributor_mappings WHERE distributor_id = ?', [distRow.id])
    : [];
  const ordered = await loadTodaysOrderLines(db, distributor, links.map((l: any) => String(l.store_name)));
  if (ordered.length === 0) return; // no order from this distributor today (or no lines yet)

  const { emailService } = await import('./emailService.js');
  const atts = await db.all('SELECT local_path FROM email_attachments WHERE uid = ?', [uid]);
  const billLines: BillLine[] = [];
  for (const a of atts) {
    if (!a.local_path || !fs.existsSync(a.local_path)) continue;
    try {
      const res = await emailService.parseAndImportAttachment(a.local_path, false);
      if (res?.success && Array.isArray(res.items)) billLines.push(...res.items.map(i => ({ name: i.name, qty: i.quantity, mrp: i.mrp })));
    } catch (err) {
      console.warn('[OrderMailCheck] attachment parse failed:', (err as Error)?.message);
    }
  }
  if (billLines.length === 0) return; // nothing readable in the mail: no comparison, no guess

  const cmp = compareOrderWithBill(ordered, billLines);
  const pct = completionPercent(cmp);
  const message = buildMessage(distributor, mail?.extracted_invoice_no || null, cmp, pct);

  const { getInvoiceWhatsAppRecipients } = await import('./storeSettingsService.js');
  const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
  const phones = (await getInvoiceWhatsAppRecipients(db)) || [];
  for (const phone of phones) {
    const refId = `order_check_${uid}_${phone}`;
    const done = await db.get('SELECT id FROM automation_notifications WHERE reference_id = ? LIMIT 1', [refId]);
    if (done) continue;
    try {
      await whatsappQueueWorker.enqueue(phone, message, 'order_mail_check', distributor);
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id) VALUES (?, ?, ?, ?, 'sent', ?)`,
        ['order_mail_check', distributor, phone, message, refId]
      );
    } catch (err: any) {
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id) VALUES (?, ?, ?, ?, 'failed', ?, ?)`,
        ['order_mail_check', distributor, phone, message, err?.message || 'enqueue failed', refId]
      ).catch(() => { });
    }
  }

  try {
    const { eventService } = await import('./eventService.js');
    eventService.broadcast('toast_alert', {
      type: cmp.missing.length || cmp.present.some(p => p.short) ? 'warning' : 'success',
      message: `${distributor}: ${pct}% of today's order is in the mail${cmp.missing.length ? `, ${cmp.missing.length} missing` : ''}.`,
      link: '/purchases'
    });
  } catch (_) { /* toast is optional */ }
}
