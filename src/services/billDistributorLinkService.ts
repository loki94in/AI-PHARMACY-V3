/**
 * Post-bill distributor linking (user-saved purchase bill → Pharmarack product links).
 *
 * After a purchase bill is saved, the "special price" popup calls linkBillMedicines() ONCE.
 * For every medicine on the bill that has no link at the bill's distributor yet, it runs ONE
 * Pharmarack search and:
 *   - auto-links ONLY a single title-exact product of the bill's own distributor
 *     (orderNameMatcher score >= ARRIVAL_MATCH_THRESHOLD: exact / core-equal names; strength
 *     variants like "Plus"/"DS" never reach it), appending to the medicine's links;
 *   - otherwise returns candidates for a one-click pick ('review') — never guesses.
 * Links only: no cart write, no stock, no message. Links are the same rows the CRM
 * "Link distributor" window edits (medicine_distributor_links).
 */
import { dbManager } from '../database/connection.js';
import { scoreOrderNameMatch, ARRIVAL_MATCH_THRESHOLD } from '../utils/orderNameMatcher.js';
import { toLocalSqlDate } from '../utils/localTime.js';
import { getMedicineLinks, type RefillCartPick, type RefillCartCandidate } from './refillCartService.js';

export type BillLinkStatus = 'linked' | 'auto_linked' | 'review' | 'not_found' | 'failed';

export interface BillLinkRow {
  medicineId: number;
  medicineName: string;
  status: BillLinkStatus;
  message: string;
  links: RefillCartPick[];
  candidates: RefillCartCandidate[];
}

export interface PoOrderItemCandidate {
  storeId: number;
  storeName: string;
  productCode: string;
  productId: string | null;
  productName: string;
  packaging: string;
  company: string;
  mrp: number | null;
  rate: number | null;
  qty: number;
  orderDate: string;
  orderNo: string | null;
}

export interface BillPoComparisonRow {
  medicineId: number;
  medicineName: string;
  billMrp: number;
  links: RefillCartPick[];
  suggestedPoItem: PoOrderItemCandidate | null;
  matchScore: number;
}

export interface BillPoComparisonResult {
  purchaseId: number | null;
  distributorName: string;
  rows: BillPoComparisonRow[];
  poItems: PoOrderItemCandidate[];
}

const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MAX_SEARCHES_PER_BILL = 15; // ponytail: one live search per unlinked medicine, capped

const sameStore = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

async function appendMedicineLink(medicineId: number, p: RefillCartPick): Promise<void> {
  const db = await dbManager.getConnection();
  const next = await db.get('SELECT COALESCE(MAX(pick_order), -1) + 1 AS n FROM medicine_distributor_links WHERE medicine_id = ?', [medicineId]);
  await db.run(
    `INSERT OR IGNORE INTO medicine_distributor_links
       (medicine_id, store_id, store_name, product_code, product_id, product_name, packaging, company, mapped, pick_order, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [medicineId, Number(p.storeId), String(p.storeName).trim(), String(p.productCode).trim(),
     p.productId != null ? String(p.productId) : null, p.productName || null, p.packaging || null,
     p.company || null, p.mapped === false ? 0 : 1, next?.n ?? 0]
  );
}

export async function linkBillMedicines(purchaseId: number): Promise<BillLinkRow[]> {
  const db = await dbManager.getConnection();
  const bill = await db.get(
    `SELECT p.id, p.distributor_id, d.name AS distributor_name
     FROM purchases p LEFT JOIN distributors d ON d.id = p.distributor_id WHERE p.id = ?`,
    [purchaseId]
  );
  if (!bill) throw Object.assign(new Error('Purchase bill not found'), { httpStatus: 404 });

  const meds: any[] = await db.all(
    `SELECT DISTINCT m.id, m.name FROM purchase_items pi
     JOIN medicines m ON m.id = pi.medicine_id WHERE pi.purchase_id = ? ORDER BY m.name`,
    [purchaseId]
  );

  const storeNames: string[] = [String(bill.distributor_name || '')];
  if (bill.distributor_id) {
    const maps: any[] = await db.all('SELECT store_name FROM pharmarack_distributor_mappings WHERE distributor_id = ?', [bill.distributor_id]);
    for (const m of maps) storeNames.push(String(m.store_name || ''));
  }
  const isBillStore = (name: string) => storeNames.some(s => sameStore(s, name));

  const pr = await import('../routes/pharmarack.js');
  const isLive = (i: any) => !i.isOffline && !i.isLocalPharmacy && Number(i.storeId) > 0 && String(i.productCode || '').trim() !== '' && i.mapped !== false;

  const rows: BillLinkRow[] = [];
  let searches = 0;
  let searchBlocked: string | null = null;

  for (const med of meds) {
    const medicineId = Number(med.id);
    const medicineName = String(med.name || '');
    let links = await getMedicineLinks(medicineId);
    const row = (status: BillLinkStatus, message: string, candidates: RefillCartCandidate[] = []): BillLinkRow =>
      ({ medicineId, medicineName, status, message, links, candidates });

    if (links.some(l => isBillStore(l.storeName))) {
      rows.push(row('linked', 'Already linked to this distributor.'));
      continue;
    }
    if (searchBlocked) { rows.push(row('failed', searchBlocked)); continue; }
    if (searches >= MAX_SEARCHES_PER_BILL) { rows.push(row('failed', 'Too many medicines on this bill to search at once. Use Link distributor.')); continue; }

    searches++;
    const outcome = await pr.performPharmarackSearch(medicineName, null, false);
    if (outcome.status === 'need_login') { searchBlocked = 'Pharmarack is not logged in. Log in, then use Link distributor.'; rows.push(row('failed', searchBlocked)); continue; }
    if (outcome.status !== 'ok') { searchBlocked = 'Pharmarack search did not answer. Use Link distributor to retry.'; rows.push(row('failed', searchBlocked)); continue; }

    const seen = new Set<string>();
    const scored = (outcome.items as any[]).filter(isLive).map(i => {
      const c: RefillCartCandidate = {
        storeId: Number(i.storeId),
        storeName: String(i.distributor || ''),
        productCode: String(i.productCode),
        productId: i.productId ?? null,
        productName: String(i.name || ''),
        packaging: String(i.packaging || ''),
        company: String(i.company || ''),
        mapped: true,
        rate: i.rate != null ? Number(i.rate) : null,
        mrp: i.mrp != null ? Number(i.mrp) : null,
        scheme: String(i.scheme || ''),
        stock: String(i.stock ?? ''),
        inStock: pr.isItemInStock(i.stock),
        inCart: false,
        linked: false
      };
      return { c, score: scoreOrderNameMatch(medicineName, c.productName).score };
    }).filter(x => {
      const key = `${x.c.storeId}|${x.c.productCode}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const own = scored.filter(x => isBillStore(x.c.storeName));
    const exactOwn = own.filter(x => x.score >= ARRIVAL_MATCH_THRESHOLD);
    if (exactOwn.length === 1) {
      await appendMedicineLink(medicineId, exactOwn[0].c);
      links = await getMedicineLinks(medicineId);
      rows.push(row('auto_linked', `Linked to ${exactOwn[0].c.storeName}: ${exactOwn[0].c.productName}`));
      continue;
    }

    const pool = (own.length > 0 ? own : scored).sort((a, b) => b.score - a.score).slice(0, 6).map(x => x.c);
    rows.push(pool.length > 0
      ? row('review', own.length > 0 ? 'Pick the right product from this distributor.' : 'This distributor has no match — pick another or search.', pool)
      : row('not_found', 'No mapped Pharmarack product found. Use Link distributor to search another spelling.'));
  }
  return rows;
}

function extractPoItemsFromOrders(orders: any[]): PoOrderItemCandidate[] {
  const poItems: PoOrderItemCandidate[] = [];
  const seen = new Set<string>();
  for (const ord of orders) {
    let parsed: any[] = [];
    try { parsed = JSON.parse(ord.items_json || '[]'); } catch (_) { parsed = []; }
    if (!Array.isArray(parsed)) continue;
    for (const raw of parsed) {
      const storeId = Number(raw.storeId ?? raw.store_id ?? ord.store_id ?? 0);
      const storeName = String(raw.storeName ?? raw.store_name ?? ord.store_name ?? '').trim();
      const productCode = String(raw.productCode ?? raw.product_code ?? '').trim();
      const productName = String(raw.productName ?? raw.product ?? raw.name ?? '').trim();
      if (!productName) continue;
      const dedupeKey = `${storeId}|${productCode || norm(productName)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      poItems.push({
        storeId,
        storeName,
        productCode,
        productId: raw.productId ?? raw.product_id ?? null,
        productName,
        packaging: String(raw.packaging || ''),
        company: String(raw.company || ''),
        mrp: raw.mrp != null ? Number(raw.mrp) : null,
        rate: raw.rate != null ? Number(raw.rate) : null,
        qty: Number(raw.qty ?? raw.quantity ?? 1) || 1,
        orderDate: String(ord.order_date || ''),
        orderNo: ord.order_no ? String(ord.order_no) : null
      });
    }
  }
  return poItems;
}

/**
 * Side-by-side comparison of today's saved bill medicines vs recent Sent PO History
 * for the same distributor. Zero live Pharmarack API calls, completely non-blocking.
 */
export async function getBillPoComparison(purchaseId: number, days = 3): Promise<BillPoComparisonResult> {
  const db = await dbManager.getConnection();
  const bill = await db.get(
    `SELECT p.id, p.distributor_id, d.name AS distributor_name
     FROM purchases p LEFT JOIN distributors d ON d.id = p.distributor_id WHERE p.id = ?`,
    [purchaseId]
  );
  if (!bill) throw Object.assign(new Error('Purchase bill not found'), { httpStatus: 404 });

  const meds: any[] = await db.all(
    `SELECT m.id, m.name, MAX(COALESCE(pi.mrp, m.mrp, 0)) AS bill_mrp
     FROM purchase_items pi
     JOIN medicines m ON m.id = pi.medicine_id
     WHERE pi.purchase_id = ?
     GROUP BY m.id, m.name
     ORDER BY m.name`,
    [purchaseId]
  );

  const storeNames: string[] = [String(bill.distributor_name || '')].filter(Boolean);
  if (bill.distributor_id) {
    const maps: any[] = await db.all('SELECT store_name FROM pharmarack_distributor_mappings WHERE distributor_id = ?', [bill.distributor_id]);
    for (const m of maps) {
      if (m.store_name) storeNames.push(String(m.store_name));
    }
  }
  const isBillStore = (name: string) => storeNames.some(s => sameStore(s, name));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.max(1, days));
  const cutoffStr = toLocalSqlDate(cutoff);

  const recentOrders: any[] = await db.all(
    `SELECT id, order_date, store_id, store_name, items_json, order_no
     FROM pharmarack_placed_orders
     WHERE order_date >= ?
     ORDER BY placed_at DESC`,
    [cutoffStr]
  );

  const matchingOrders = recentOrders.filter(o => isBillStore(String(o.store_name || '')));
  const poItems = extractPoItemsFromOrders(matchingOrders);

  const rows: BillPoComparisonRow[] = [];
  for (const med of meds) {
    const medicineId = Number(med.id);
    const medicineName = String(med.name || '');
    const links = await getMedicineLinks(medicineId);

    let bestItem: PoOrderItemCandidate | null = null;
    let bestScore = 0;
    for (const po of poItems) {
      const s = scoreOrderNameMatch(medicineName, po.productName).score;
      if (s > bestScore) {
        bestScore = s;
        bestItem = po;
      }
    }

    rows.push({
      medicineId,
      medicineName,
      billMrp: Number(med.bill_mrp || 0),
      links,
      suggestedPoItem: bestScore >= 0.4 ? bestItem : null,
      matchScore: Math.round(bestScore * 100) / 100
    });
  }

  return {
    purchaseId,
    distributorName: String(bill.distributor_name || ''),
    rows,
    poItems
  };
}

/**
 * Side-by-side comparison opened directly from a Sent PO History row.
 * Pairs PO items with recent saved purchase items (or master medicines) so the user can link 1-by-1.
 */
export async function getPoOrderComparison(orderId: number): Promise<BillPoComparisonResult> {
  const db = await dbManager.getConnection();
  const ord = await db.get(
    `SELECT id, order_date, store_id, store_name, items_json, order_no
     FROM pharmarack_placed_orders WHERE id = ?`,
    [orderId]
  );
  if (!ord) throw Object.assign(new Error('Sent PO order not found'), { httpStatus: 404 });

  const poItems = extractPoItemsFromOrders([ord]);
  const storeName = String(ord.store_name || '');

  // Check if there's a recent purchase bill from the same distributor within last 3 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  const cutoffStr = toLocalSqlDate(cutoff);

  const recentBills: any[] = await db.all(
    `SELECT p.id, d.name AS distributor_name
     FROM purchases p
     LEFT JOIN distributors d ON d.id = p.distributor_id
     WHERE date(p.date) >= ?
     ORDER BY p.id DESC LIMIT 25`,
    [cutoffStr]
  );
  const matchedBill = recentBills.find(b => sameStore(String(b.distributor_name || ''), storeName));
  if (matchedBill) {
    return getBillPoComparison(Number(matchedBill.id), 3);
  }

  // Fallback: match each PO item against master medicines by exact/prefix name
  const rows: BillPoComparisonRow[] = [];
  const seenMedIds = new Set<number>();
  for (const po of poItems) {
    const firstWord = po.productName.split(/\s+/)[0] || po.productName;
    const candidates: any[] = firstWord.length >= 2
      ? await db.all(
          `SELECT id, name, COALESCE(mrp, 0) AS mrp FROM medicines WHERE name LIKE ? AND (status IS NULL OR status = 'ACTIVE') LIMIT 25`,
          [`${firstWord}%`]
        )
      : [];
    let bestMed: any = null;
    let bestScore = 0;
    for (const c of candidates) {
      const s = scoreOrderNameMatch(String(c.name || ''), po.productName).score;
      if (s > bestScore) {
        bestScore = s;
        bestMed = c;
      }
    }
    if (bestMed && !seenMedIds.has(Number(bestMed.id))) {
      seenMedIds.add(Number(bestMed.id));
      rows.push({
        medicineId: Number(bestMed.id),
        medicineName: String(bestMed.name || ''),
        billMrp: Number(bestMed.mrp || 0),
        links: await getMedicineLinks(Number(bestMed.id)),
        suggestedPoItem: po,
        matchScore: Math.round(bestScore * 100) / 100
      });
    }
  }

  return {
    purchaseId: null,
    distributorName: storeName,
    rows,
    poItems
  };
}

/**
 * Append (or update) ONE distributor product link for a medicine without overwriting
 * existing links to other distributors (multi-distributor support, same as CRM).
 */
export async function appendSingleMedicineLink(medicineId: number, pick: RefillCartPick): Promise<RefillCartPick[]> {
  const db = await dbManager.getConnection();
  const med = await db.get('SELECT id, name FROM medicines WHERE id = ?', [medicineId]);
  if (!med) throw Object.assign(new Error('Medicine not found'), { httpStatus: 404 });

  const storeId = Number(pick.storeId || 0);
  const storeName = String(pick.storeName || '').trim();
  const productCode = String(pick.productCode || '').trim();
  if (!storeId || !storeName || !productCode) {
    throw Object.assign(new Error('Valid storeId, storeName and productCode are required'), { httpStatus: 400 });
  }

  const existing = await db.get(
    `SELECT id FROM medicine_distributor_links WHERE medicine_id = ? AND store_id = ? AND product_code = ?`,
    [medicineId, storeId, productCode]
  );

  if (existing) {
    await db.run(
      `UPDATE medicine_distributor_links
       SET store_name = ?, product_id = ?, product_name = ?, packaging = ?, company = ?, mapped = ?, medicine_name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [storeName, pick.productId != null ? String(pick.productId) : null, pick.productName || null, pick.packaging || null, pick.company || null, pick.mapped === false ? 0 : 1, med.name, existing.id]
    );
  } else {
    const next = await db.get('SELECT COALESCE(MAX(pick_order), -1) + 1 AS n FROM medicine_distributor_links WHERE medicine_id = ?', [medicineId]);
    await db.run(
      `INSERT INTO medicine_distributor_links
         (medicine_id, store_id, store_name, product_code, product_id, product_name, packaging, company, mapped, pick_order, medicine_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [medicineId, storeId, storeName, productCode, pick.productId != null ? String(pick.productId) : null, pick.productName || null, pick.packaging || null, pick.company || null, pick.mapped === false ? 0 : 1, next?.n ?? 0, med.name]
    );
  }
  return getMedicineLinks(medicineId);
}

/**
 * Remove a single distributor product link (e.g. if linked mistakenly).
 */
export async function removeSingleMedicineLink(medicineId: number, storeId: number, productCode: string): Promise<RefillCartPick[]> {
  const db = await dbManager.getConnection();
  await db.run(
    `DELETE FROM medicine_distributor_links WHERE medicine_id = ? AND store_id = ? AND product_code = ?`,
    [medicineId, storeId, productCode]
  );
  return getMedicineLinks(medicineId);
}
