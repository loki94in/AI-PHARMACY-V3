/**
 * Refill → Pharmarack Live Cart, one medicine per call (user-clicked only).
 *
 * The CRM refill popup calls processRefillCartItem() for each medicine in turn:
 *   already in the cart?  → 'in_cart' (never re-add: AddUserProductCartDetail
 *                           SETS a line's qty, so a second add would overwrite it)
 *   no saved distributor  → 'needs_link' (pharmacist ticks products; saved)
 *   saved ones all OOS    → 'linked_oos' (highlighted; pharmacist ticks another)
 *   otherwise             → add to ONE saved in-stock product: the distributor
 *                           already in the cart, else the most-purchased-from,
 *                           else the first ticked; then re-read the cart and
 *                           only report 'added' when the line is really there.
 *
 * removeRefillCartLines() undoes a refill's recorded line when the refill is
 * cancelled/deleted, in the background, and pushes the real result as a toast.
 */
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';

export type RefillCartStatus = 'added' | 'in_cart' | 'needs_link' | 'linked_oos' | 'not_found' | 'failed';

export interface RefillCartPick {
  storeId: number;
  storeName: string;
  productCode: string;
  productId?: string | number | null;
  productName?: string;
  packaging?: string;
  company?: string;
  mapped?: boolean;
}

export interface RefillCartCandidate extends RefillCartPick {
  rate: number | null;
  mrp: number | null;
  scheme: string;
  stock: string;
  inStock: boolean;
  inCart: boolean;
  linked: boolean;
}

export interface RefillCartResult {
  status: RefillCartStatus;
  message: string;
  refillId: number;
  medicineName: string;
  qty: number;
  line?: { storeName: string; productName: string; qty: number };
  linked: Array<{ storeName: string; productName: string; stock: string; inStock: boolean }>;
  candidates: RefillCartCandidate[];
}

interface CartLine { storeId: number; storeName: string; productCode: string; productName: string; qty: number }

const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function flattenCart(cart: { distributors: any[] }): CartLine[] {
  const lines: CartLine[] = [];
  for (const d of cart.distributors || []) {
    for (const it of d.items || []) {
      lines.push({
        storeId: Number(it.storeId || d.storeId || 0),
        storeName: String(d.storeName || ''),
        productCode: String(it.productCode || ''),
        productName: String(it.productName || ''),
        qty: Number(it.qty) || 0
      });
    }
  }
  return lines;
}

const findLine = (lines: CartLine[], storeId: unknown, code: unknown) =>
  lines.find(l => l.storeId === Number(storeId) && !!l.productCode && l.productCode === String(code || ''));

function cartErrorMessage(err: any): string {
  if (err?.code === 'NEED_LOGIN') return 'Pharmarack is not logged in. Log in from the Live Cart page, then retry.';
  if (err?.code === 'SESSION_EXPIRED') return 'Pharmarack session expired. Re-login, then retry.';
  return `Could not read the Pharmarack live cart (${err?.message || 'network error'}). Retry.`;
}

export async function processRefillCartItem(
  refillId: number,
  opts: { qty?: number; pick?: RefillCartPick[] } = {}
): Promise<RefillCartResult> {
  const db = await dbManager.getConnection();
  const refill = await db.get(
    `SELECT pr.id, pr.medicine_id, pr.quantity_needed, pr.is_active, pr.status,
            pr.cart_store_id, pr.cart_product_code, m.name AS medicine_name
     FROM patient_refills pr JOIN medicines m ON m.id = pr.medicine_id
     WHERE pr.id = ?`,
    [refillId]
  );
  if (!refill) throw Object.assign(new Error('Refill not found'), { httpStatus: 404 });

  const medicineName = String(refill.medicine_name || '');
  const qty = Math.max(1, Math.floor(Number(opts.qty) || Number(refill.quantity_needed) || 1));
  const base = { refillId, medicineName, qty, linked: [] as RefillCartResult['linked'], candidates: [] as RefillCartCandidate[] };
  const fail = (message: string, extra: Partial<RefillCartResult> = {}): RefillCartResult =>
    ({ ...base, ...extra, status: 'failed', message });

  if (refill.is_active === 0 || ['canceled', 'cancelled', 'paused'].includes(String(refill.status || '').toLowerCase())) {
    return fail('This refill is paused or cancelled.');
  }

  // 1. Save the pharmacist's ticked distributors as this medicine's links.
  if (Array.isArray(opts.pick) && opts.pick.length > 0) {
    const picks = opts.pick.filter(p => Number(p.storeId) > 0 && String(p.productCode || '').trim() && String(p.storeName || '').trim());
    if (picks.length === 0) return fail('Tick a distributor product from the list.');
    await db.run('BEGIN');
    try {
      await db.run('DELETE FROM medicine_distributor_links WHERE medicine_id = ?', [refill.medicine_id]);
      for (let i = 0; i < picks.length; i++) {
        const p = picks[i];
        await db.run(
          `INSERT OR REPLACE INTO medicine_distributor_links
             (medicine_id, store_id, store_name, product_code, product_id, product_name, packaging, company, mapped, pick_order, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [refill.medicine_id, Number(p.storeId), String(p.storeName).trim(), String(p.productCode).trim(),
           p.productId != null ? String(p.productId) : null, p.productName || null, p.packaging || null,
           p.company || null, p.mapped === false ? 0 : 1, i]
        );
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  const pr = await import('../routes/pharmarack.js');

  // 2. What is in the live cart right now (always a fresh read).
  let lines: CartLine[];
  try {
    lines = flattenCart(await pr.loadLiveCartCore());
  } catch (err) {
    return fail(cartErrorMessage(err));
  }

  const links: any[] = await db.all(
    'SELECT * FROM medicine_distributor_links WHERE medicine_id = ? ORDER BY pick_order, id',
    [refill.medicine_id]
  );

  // 3. Already in the cart → never add a second time.
  let hit: CartLine | undefined = refill.cart_product_code ? findLine(lines, refill.cart_store_id, refill.cart_product_code) : undefined;
  for (const l of links) hit = hit || findLine(lines, l.store_id, l.product_code);
  if (!hit) {
    const want = norm(medicineName);
    hit = lines.find(l => want && norm(l.productName) === want);
  }
  if (hit) {
    return {
      ...base,
      status: 'in_cart',
      message: `Already in the cart at ${hit.storeName} (qty ${hit.qty}).`,
      line: { storeName: hit.storeName, productName: hit.productName, qty: hit.qty }
    };
  }

  // 4. Live stock for this medicine. Offline/local-history rows are never cart
  //    candidates: they carry no real Pharmarack product code or stock.
  const isLive = (i: any) => !i.isOffline && !i.isLocalPharmacy && Number(i.storeId) > 0 && String(i.productCode || '').trim() !== '';
  const outcome = await pr.performPharmarackSearch(medicineName, null, false);
  if (outcome.status === 'need_login') return fail(cartErrorMessage({ code: 'NEED_LOGIN' }));
  if (outcome.status === 'connection_error') return fail('Pharmarack search did not answer (network). Retry.');
  const items: any[] = outcome.items.filter(isLive);
  const findItem = (l: any) => items.find(i => Number(i.storeId) === Number(l.store_id) && String(i.productCode) === String(l.product_code));

  // A saved product can fall outside the name search (picked under another
  // spelling) — look it up at its own distributor. ponytail: max 3 lookups.
  for (const l of links.filter(l => !findItem(l)).slice(0, 3)) {
    const o = await pr.performPharmarackSearch(l.product_name || medicineName, Number(l.store_id), l.mapped !== 0);
    if (o.status === 'ok') items.push(...o.items.filter(isLive));
  }

  const linkedKeys = new Set(links.map(l => `${l.store_id}|${l.product_code}`));
  const seen = new Set<string>();
  const candidates: RefillCartCandidate[] = [];
  for (const i of items) {
    const key = `${Number(i.storeId)}|${String(i.productCode)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      storeId: Number(i.storeId),
      storeName: String(i.distributor || ''),
      productCode: String(i.productCode),
      productId: i.productId ?? null,
      productName: String(i.name || ''),
      packaging: String(i.packaging || ''),
      company: String(i.company || ''),
      mapped: i.mapped !== false,
      rate: i.rate != null ? Number(i.rate) : null,
      mrp: i.mrp != null ? Number(i.mrp) : null,
      scheme: String(i.scheme || ''),
      stock: String(i.stock ?? ''),
      inStock: pr.isItemInStock(i.stock),
      inCart: !!findLine(lines, i.storeId, i.productCode),
      linked: linkedKeys.has(key)
    });
    if (candidates.length >= 30) break;
  }

  if (links.length === 0) {
    return candidates.length > 0
      ? { ...base, candidates, status: 'needs_link', message: 'No distributor saved for this medicine yet. Tick one or more.' }
      : { ...base, status: 'not_found', message: 'Pharmarack returned no distributor for this name. Search another spelling.' };
  }

  const linkedState = links.map(l => {
    const item = findItem(l);
    return { link: l, item, inStock: !!item && pr.isItemInStock(item.stock) };
  });
  const linked = linkedState.map(s => ({
    storeName: String(s.link.store_name),
    productName: String(s.link.product_name || ''),
    stock: s.item ? String(s.item.stock ?? '') : 'not listed now',
    inStock: s.inStock
  }));
  const available = linkedState.filter(s => s.inStock);
  if (available.length === 0) {
    return {
      ...base, linked, candidates,
      status: 'linked_oos',
      message: `Out of stock at ${linked.map(l => l.storeName).join(', ')}. Tick another distributor.`
    };
  }

  // 5. One distributor: already in the cart → most purchased from → first ticked.
  const cartStores = new Set(lines.map(l => l.storeId));
  let chosen = available.find(s => cartStores.has(Number(s.link.store_id)));
  if (!chosen && available.length > 1) {
    const freq: any[] = await db.all(
      `SELECT d.name, COUNT(p.id) AS n FROM distributors d JOIN purchases p ON p.distributor_id = d.id
       GROUP BY d.id ORDER BY n DESC LIMIT 50`
    ).catch(() => []);
    for (const f of freq) {
      const fn = norm(f.name);
      if (fn.length < 4) continue;
      chosen = available.find(s => {
        const sn = norm(s.link.store_name);
        return sn === fn || sn.includes(fn) || fn.includes(sn);
      });
      if (chosen) break;
    }
  }
  chosen = chosen || available[0];

  const it = chosen.item;
  const addRes = await pr.addItemsToPharmarackCart([{
    productId: it.productId,
    storeId: Number(it.storeId),
    productCode: String(it.productCode),
    productName: String(it.name || chosen.link.product_name || medicineName),
    storeName: String(it.distributor || chosen.link.store_name),
    company: it.company || undefined,
    rate: it.rate != null ? Number(it.rate) : undefined,
    mrp: it.mrp != null ? Number(it.mrp) : undefined,
    scheme: it.scheme || undefined,
    packaging: it.packaging || undefined,
    mapped: it.mapped !== false,
    qty
  }]);
  // addItemsToPharmarackCart reports "success + offline" when nothing reached
  // Pharmarack — that is a failure here, never a success.
  if (!addRes.success || addRes.offline) {
    return fail(`Pharmarack did not accept the item: ${addRes.details || addRes.error || addRes.message || 'offline'}`, { linked, candidates });
  }

  // 6. Re-read the cart and only claim success when the line is really there.
  pr.invalidatePharmarackCartCache();
  let added: CartLine | undefined;
  for (let attempt = 0; attempt < 2 && !added; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
    try {
      added = findLine(flattenCart(await pr.loadLiveCartCore()), it.storeId, it.productCode);
    } catch (_) { /* retried once, then reported below */ }
  }
  if (!added) {
    return fail('Pharmarack accepted the add, but the item is not showing in the cart yet. Check the Live Cart, or retry.', { linked, candidates });
  }

  await db.run(
    `UPDATE patient_refills SET cart_store_id = ?, cart_store_name = ?, cart_product_code = ?, cart_product_name = ?, cart_qty = ? WHERE id = ?`,
    [added.storeId, added.storeName, added.productCode, added.productName, qty, refillId]
  );
  await db.run('UPDATE medicine_distributor_links SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [chosen.link.id]);

  const firstLink = linkedState[0];
  const note = firstLink !== chosen && !firstLink.inStock ? ` (${firstLink.link.store_name} was out of stock)` : '';
  return {
    ...base, linked, candidates,
    status: 'added',
    message: `Added ${qty} to ${added.storeName}${note}.`,
    line: { storeName: added.storeName, productName: added.productName, qty: added.qty }
  };
}

/** Columns a cancel/delete path must read BEFORE it changes the refill row. */
export const REFILL_CART_COLUMNS = 'id, cart_store_id, cart_store_name, cart_product_code, cart_product_name, cart_qty';

/**
 * Remove the cart lines these refills added. Runs in the background so the
 * cancel/delete request answers instantly; each real outcome reaches the app
 * as a toast (SSE toast_alert). Pass clearRows=false when the rows are deleted.
 */
export function removeRefillCartLines(rows: any[], clearRows: boolean): void {
  const tracked = (rows || []).filter(r => r && r.cart_product_code && Number(r.cart_store_id) > 0);
  if (tracked.length === 0) return;
  setImmediate(async () => {
    const pr = await import('../routes/pharmarack.js');
    const db = await dbManager.getConnection();
    for (const r of tracked) {
      const name = String(r.cart_product_name || 'medicine');
      const store = String(r.cart_store_name || 'distributor');
      let type: 'success' | 'info' | 'error' = 'error';
      let message: string;
      try {
        const adj = await pr.adjustSpecialOrderInLiveCart({
          product: name,
          qty: Number(r.cart_qty) || 1,
          productCode: String(r.cart_product_code),
          storeId: Number(r.cart_store_id),
          distributor: store,
          exactOnly: true
        });
        if (adj.action === 'removed') {
          type = 'success';
          message = `Refill cancelled: removed "${name}" from the ${store} cart.`;
        } else if (adj.action === 'adjusted') {
          type = 'info';
          message = `Refill cancelled: "${name}" in the ${store} cart reduced from ${adj.previousQty} to ${adj.remainingQty}.`;
        } else if (adj.message === 'Item not found in current live cart' || adj.message === 'Live cart is empty') {
          type = 'info';
          message = `Refill cancelled: "${name}" is no longer in the live cart (already ordered or removed).`;
        } else {
          message = `Refill cancelled, but "${name}" could not be removed from the ${store} cart (${adj.message || 'unknown error'}). Remove it in Live Cart.`;
        }
      } catch (err: any) {
        message = `Refill cancelled, but "${name}" could not be removed from the ${store} cart (${err?.message || 'error'}). Remove it in Live Cart.`;
      }
      if (clearRows && type !== 'error') {
        await db.run('UPDATE patient_refills SET cart_product_code = NULL WHERE id = ?', [r.id]).catch(() => {});
      }
      eventService.broadcast('toast_alert', { type, message, link: '/crm?tab=refills' });
    }
  });
}
