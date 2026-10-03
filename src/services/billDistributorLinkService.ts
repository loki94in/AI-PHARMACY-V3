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
