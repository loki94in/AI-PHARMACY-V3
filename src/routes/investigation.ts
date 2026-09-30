import express from 'express';
import { dbManager } from '../database/connection.js';
import { inventoryCache } from '../services/inventoryCache.js';
import { rebuildPurchaseSummaryCache, triggerBackgroundSummaryRebuild } from '../services/summaryCacheService.js';
import { applyStockDelta } from '../utils/stockRebuild.js';
import { applySaleBillEdit, SaleEditError } from '../services/saleBillEditService.js';
import { applyPurchaseStockChange, PurchaseEditError } from '../services/purchaseBillEditService.js';
import { refreshInventoryActiveStatus } from '../utils/inventoryActive.js';

const router = express.Router();

// Timeline result cache (filter-signature keyed, 60s TTL). One computation
// serves every infinite-scroll page request (pages 2..N become O(1) slices)
// instead of re-running 4 unbounded SELECTs + the running-stock replay each time.
const TIMELINE_CACHE_TTL_MS = 60_000;
const TIMELINE_CACHE_MAX_ENTRIES = 40;
const timelineCache = new Map<string, { at: number; filtered: any[]; totalItems: number }>();

export function invalidateInvestigationTimelineCache() {
  timelineCache.clear();
}

const nextDayString = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Numeric timestamp parsed ONCE per row (dates arrive in mixed formats:
// ISO-T vs space-separated), so sorts/filtering never re-parse strings.
const rowTs = (value: unknown): number => {
  const t = Date.parse(String(value ?? ''));
  return Number.isNaN(t) ? 0 : t;
};

// Helper to log changes to action_logs. `metadata` is stored as structured JSON
// alongside the human-readable description so forensics/compliance reads (see
// /timeline below) don't depend on regex-parsing the description text.
async function logAction(db: any, actionType: string, description: string, metadata?: Record<string, any>) {
  await db.run(
    'INSERT INTO action_logs (action_type, description, metadata) VALUES (?, ?, ?)',
    [actionType, description, metadata ? JSON.stringify(metadata) : null]
  );
}

// Timeline endpoint aggregating POS sales, purchases, customer returns, and adjustments with running stock calculation
router.get('/timeline', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const {
      q,
      dateFrom,
      dateTo,
      medicineName,
      batchNo,
      salesBillNo,
      purchaseBillNo,
      patientName,
      distributor,
      reference,
      party,
      type
    } = req.query;

    // Decide whether to apply date filtering at the database level.
    // If we have a medicineName or batchNo filter, we want to fetch the entire history
    // so we can compute the chronologically accurate running stock (opening/closing/medicine totals),
    // and then filter by date in memory.
    // If we DO NOT have medicineName or batchNo, we apply date filters directly in SQL to prevent loading too much data.
    const hasMedicineOrBatchFilter = !!(medicineName || batchNo || q);
    const sqlDateFilter = !hasMedicineOrBatchFilter;

    let salesQuery = `
      SELECT
        'Sale' AS type,
        sinv.id AS invoice_id,
        sinv.invoice_no AS reference,
        sinv.date AS date,
        sinv.discount AS discount,
        sinv.total_amount AS total_amount,
        sinv.subtotal AS subtotal,
        COALESCE(sinv.customer_name_snapshot, c.name, 'Customer') AS customer_name,
        si.quantity AS quantity,
        si.loose_qty AS loose_quantity,
        COALESCE(m.pack_size, 1) AS pack_size,
        COALESCE(si.batch_no_snapshot, im.batch_no, si.batch_no, '') AS batch_no,
        COALESCE(si.medicine_name_snapshot, m.name, 'Medicine') AS medicine_name,
        COALESCE(m.id, im.medicine_id, si.inventory_id) AS medicine_id,
        COALESCE(im.id, si.inventory_id) AS inventory_id,
        COALESCE(si.expiry_date_snapshot, im.expiry_date, '') AS expiry_date,
        COALESCE(si.mrp_snapshot, im.mrp, m.mrp, 0) AS mrp
      FROM sale_items si
      JOIN sales_invoices sinv ON si.invoice_id = sinv.id
      LEFT JOIN inventory_master im ON si.inventory_id = im.id
      LEFT JOIN medicines m ON (im.medicine_id = m.id OR (im.id IS NULL AND si.inventory_id = m.id))
      LEFT JOIN customers c ON sinv.customer_id = c.id
      WHERE 1=1
    `;
    const salesParams: any[] = [];

    let purchasesQuery = `
      SELECT
        'Purchase' AS type,
        p.id AS purchase_id,
        p.invoice_no AS reference,
        p.date AS date,
        d.name AS distributor_name,
        pi.quantity AS quantity,
        pi.free_qty AS free_qty,
        pi.batch_no AS batch_no,
        m.name AS medicine_name,
        m.id AS medicine_id,
        (SELECT im.id FROM inventory_master im
           WHERE im.medicine_id = pi.medicine_id AND im.batch_no = pi.batch_no
           ORDER BY im.id LIMIT 1) AS inventory_id,
        pi.expiry_date AS expiry_date,
        pi.mrp AS mrp
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      JOIN medicines m ON pi.medicine_id = m.id
      LEFT JOIN distributors d ON p.distributor_id = d.id
      WHERE 1=1
    `;
    const purchasesParams: any[] = [];

    let returnsQuery = `
      SELECT
        'Return' AS type,
        r.id AS return_id,
        r.return_no AS reference,
        r.date AS date,
        c.name AS customer_name,
        d.name AS distributor_name,
        ri.quantity AS quantity,
        COALESCE(m.pack_size, 1) AS pack_size,
        ri.batch_no AS batch_no,
        m.name AS medicine_name,
        m.id AS medicine_id,
        (SELECT im.id FROM inventory_master im
           WHERE im.medicine_id = ri.medicine_id AND im.batch_no = ri.batch_no
           ORDER BY im.id LIMIT 1) AS inventory_id,
        (SELECT im.expiry_date FROM inventory_master im
           WHERE im.medicine_id = ri.medicine_id AND im.batch_no = ri.batch_no
           ORDER BY im.id LIMIT 1) AS expiry_date,
        ri.mrp AS mrp,
        r.type AS return_type,
        r.reason AS reason
      FROM return_items ri
      JOIN returns r ON ri.return_id = r.id
      JOIN medicines m ON ri.medicine_id = m.id
      LEFT JOIN distributors d ON r.distributor_id = d.id
      LEFT JOIN sales_invoices si ON r.original_invoice_id = si.id
      LEFT JOIN customers c ON si.customer_id = c.id
      WHERE 1=1
    `;
    const returnsParams: any[] = [];

    let logsQuery = `
      SELECT
        'Adjustment' AS type,
        al.id AS log_id,
        al.action_type AS reference,
        al.created_at AS date,
        al.description AS detail,
        al.metadata AS metadata
      FROM action_logs al
      WHERE al.action_type IN ('INVENTORY_CORRECTION', 'SALES_BILL_CORRECTION', 'PURCHASE_BILL_CORRECTION')
    `;
    const logsParams: any[] = [];

    // Apply filters directly in SQL queries to minimize database transfer size
    if (medicineName) {
      const medFilter = `%${medicineName}%`;
      salesQuery += ` AND (m.name LIKE ? OR si.medicine_name_snapshot LIKE ?)`;
      salesParams.push(medFilter, medFilter);
      purchasesQuery += ` AND m.name LIKE ?`;
      purchasesParams.push(medFilter);
      returnsQuery += ` AND m.name LIKE ?`;
      returnsParams.push(medFilter);
      logsQuery += ` AND al.description LIKE ?`;
      logsParams.push(medFilter);
    }

    if (batchNo) {
      const batchFilter = `%${batchNo}%`;
      salesQuery += ` AND (im.batch_no LIKE ? OR si.batch_no_snapshot LIKE ? OR si.batch_no LIKE ?)`;
      salesParams.push(batchFilter, batchFilter, batchFilter);
      purchasesQuery += ` AND pi.batch_no LIKE ?`;
      purchasesParams.push(batchFilter);
      returnsQuery += ` AND ri.batch_no LIKE ?`;
      returnsParams.push(batchFilter);
      logsQuery += ` AND al.description LIKE ?`;
      logsParams.push(batchFilter);
    }

    if (reference) {
      const refFilter = `%${reference}%`;
      salesQuery += ` AND sinv.invoice_no LIKE ?`;
      salesParams.push(refFilter);
      purchasesQuery += ` AND p.invoice_no LIKE ?`;
      purchasesParams.push(refFilter);
      returnsQuery += ` AND r.return_no LIKE ?`;
      returnsParams.push(refFilter);
    }

    if (party) {
      const partyFilter = `%${party}%`;
      salesQuery += ` AND (c.name LIKE ? OR sinv.customer_name_snapshot LIKE ?)`;
      salesParams.push(partyFilter, partyFilter);
      purchasesQuery += ` AND d.name LIKE ?`;
      purchasesParams.push(partyFilter);
      returnsQuery += ` AND (c.name LIKE ? OR d.name LIKE ?)`;
      returnsParams.push(partyFilter, partyFilter);
    }

    if (q) {
      const qFilter = `%${q}%`;
      salesQuery += ` AND (m.name LIKE ? OR si.medicine_name_snapshot LIKE ? OR im.batch_no LIKE ? OR si.batch_no_snapshot LIKE ? OR si.batch_no LIKE ? OR sinv.invoice_no LIKE ? OR c.name LIKE ? OR sinv.customer_name_snapshot LIKE ?)`;
      salesParams.push(qFilter, qFilter, qFilter, qFilter, qFilter, qFilter, qFilter, qFilter);
      purchasesQuery += ` AND (m.name LIKE ? OR pi.batch_no LIKE ? OR p.invoice_no LIKE ? OR d.name LIKE ?)`;
      purchasesParams.push(qFilter, qFilter, qFilter, qFilter);
      returnsQuery += ` AND (m.name LIKE ? OR ri.batch_no LIKE ? OR r.return_no LIKE ? OR c.name LIKE ? OR d.name LIKE ?)`;
      returnsParams.push(qFilter, qFilter, qFilter, qFilter, qFilter);
      logsQuery += ` AND al.description LIKE ?`;
      logsParams.push(qFilter);
    }

    if (sqlDateFilter) {
      // Sargable range bounds (bare column vs 'YYYY-MM-DD' strings prune via
      // idx_sales_invoices_date / idx_purchases_date_dist / idx_returns_date).
      // DATE(col) wrappers defeated those indexes and full-scanned per request.
      if (dateFrom) {
        salesQuery += ` AND sinv.date >= ?`;
        salesParams.push(dateFrom);
        purchasesQuery += ` AND p.date >= ?`;
        purchasesParams.push(dateFrom);
        returnsQuery += ` AND r.date >= ?`;
        returnsParams.push(dateFrom);
        logsQuery += ` AND al.created_at >= ?`;
        logsParams.push(dateFrom);
      }
      if (dateTo) {
        const toExclusive = nextDayString(String(dateTo));
        salesQuery += ` AND sinv.date < ?`;
        salesParams.push(toExclusive);
        purchasesQuery += ` AND p.date < ?`;
        purchasesParams.push(toExclusive);
        returnsQuery += ` AND r.date < ?`;
        returnsParams.push(toExclusive);
        logsQuery += ` AND al.created_at < ?`;
        logsParams.push(toExclusive);
      }
    }

    // Determine query routing based on requested transaction type filter
    const querySales = !type || type === 'All' || type === 'Sale';
    const queryPurchases = !type || type === 'All' || type === 'Purchase';
    const queryReturns = !type || type === 'All' || type === 'Return';
    const queryLogs = !type || type === 'All' || type === 'Adjustment';

    // Filter-signature cache: identical filters (any page) reuse one computation
    const cacheSig = JSON.stringify([
      q, dateFrom, dateTo, medicineName, batchNo, salesBillNo,
      purchaseBillNo, patientName, distributor, reference, party, type
    ]);
    const cachedEntry = timelineCache.get(cacheSig);
    if (cachedEntry && Date.now() - cachedEntry.at < TIMELINE_CACHE_TTL_MS) {
      cachedEntry.at = Date.now();
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 100;
      const totalPages = Math.ceil(cachedEntry.totalItems / limit);
      const offset = (page - 1) * limit;
      return res.json({
        data: cachedEntry.filtered.slice(offset, offset + limit),
        totalPages,
        currentPage: page,
        totalItems: cachedEntry.totalItems
      });
    }

    const salesPromise = querySales ? db.all(salesQuery, salesParams) : Promise.resolve([]);
    const purchasesPromise = queryPurchases ? db.all(purchasesQuery, purchasesParams) : Promise.resolve([]);
    const returnsPromise = queryReturns ? db.all(returnsQuery, returnsParams) : Promise.resolve([]);
    const logsPromise = queryLogs ? db.all(logsQuery, logsParams) : Promise.resolve([]);

    // Run queries in parallel
    const [sales, purchases, returns, logs] = await Promise.all([
      salesPromise,
      purchasesPromise,
      returnsPromise,
      logsPromise
    ]);

    // Master caches resolve adjustment medicine/inventory references. They are
    // LAZY: 291k medicines + 37k inventory rows are only loaded when adjustment
    // logs actually exist — never on the hot sale/purchase/return path.
    let medicinesList: Array<{ id: number; name: string }> = [];
    const medMapByName = new Map<string, number>();
    const medMapById = new Map<number, string>();
    const invMapById = new Map<number, { medicine_id: number; batch_no: string; expiry_date: string; mrp: number }>();
    if (logs.length > 0) {
      medicinesList = await db.all('SELECT id, name FROM medicines');
      for (const m of medicinesList) {
        medMapByName.set(String(m.name).toLowerCase().trim(), m.id);
        medMapById.set(m.id, m.name);
      }
      const inventoryList = await db.all('SELECT id, medicine_id, batch_no, expiry_date, mrp FROM inventory_master');
      for (const im of inventoryList) {
        invMapById.set(im.id, im);
      }
    }

    // Map logs to timeline items
    const adjustments: any[] = [];
    for (const log of logs) {
      // Prefer the structured metadata column; only fall back to regex-parsing
      // the human-readable description for rows logged before it existed.
      let meta: any = null;
      if (log.metadata) {
        try { meta = JSON.parse(log.metadata); } catch (_e) { meta = null; }
      }

      const parsedMedName = meta?.medicineName
        ? meta.medicineName.toLowerCase().trim()
        : (log.detail.match(/Inventory correction for "([^"]+)"/i)?.[1]?.toLowerCase().trim() || '');
      const parsedBatch = meta?.batchNo?.to ?? (log.detail.match(/Batch:\s*"([^"]+)"/i)?.[1] || '');
      const parsedInvId = meta?.inventoryId ?? (() => {
        const m = log.detail.match(/ID\s+(\d+)/i);
        return m ? parseInt(m[1], 10) : null;
      })();

      let medicine_id = meta?.medicineId ?? (parsedMedName ? medMapByName.get(parsedMedName) : null);
      let batch_no = parsedBatch;
      let expiry_date = null;
      let mrp = 0;
      let inventory_id = parsedInvId;

      if (parsedInvId && invMapById.has(parsedInvId)) {
        const inv = invMapById.get(parsedInvId)!;
        medicine_id = inv.medicine_id;
        batch_no = inv.batch_no;
        expiry_date = inv.expiry_date;
        mrp = inv.mrp;
      }

      // Find medicine name
      let medicine_name = '';
      if (medicine_id) {
        const medName = medMapById.get(medicine_id);
        if (medName) medicine_name = medName;
      }

      adjustments.push({
        type: 'Adjustment',
        log_id: log.log_id,
        reference: log.reference,
        date: log.date,
        customer_name: null,
        distributor_name: null,
        quantity: 0,
        loose_quantity: 0,
        batch_no,
        medicine_name,
        medicine_id,
        inventory_id,
        expiry_date,
        mrp,
        detail: log.detail,
        metadata: meta
      });
    }

    // Combine all transactions
    let allTransactions: any[] = [];

    // Format sales
    for (const s of sales) {
      allTransactions.push({
        ...s,
        purchase_qty: 0,
        sale_qty: s.quantity,
        sale_loose: s.loose_quantity,
        purchase_return_qty: 0,
        sales_return_qty: 0,
        adj_qty: 0,
        adj_loose: 0,
        party: s.customer_name || 'Walk-in'
      });
    }

    // Format purchases
    for (const p of purchases) {
      allTransactions.push({
        ...p,
        purchase_qty: p.quantity,
        sale_qty: 0,
        sale_loose: 0,
        purchase_return_qty: 0,
        sales_return_qty: 0,
        adj_qty: 0,
        adj_loose: 0,
        party: p.distributor_name || 'Unknown'
      });
    }

    // Format returns
    for (const r of returns) {
      const isSaleReturn = r.return_type === 'sale';
      allTransactions.push({
        ...r,
        purchase_qty: 0,
        sale_qty: 0,
        sale_loose: 0,
        purchase_return_qty: isSaleReturn ? 0 : r.quantity,
        sales_return_qty: isSaleReturn ? r.quantity : 0,
        adj_qty: 0,
        adj_loose: 0,
        party: isSaleReturn ? (r.customer_name || 'Walk-in') : (r.distributor_name || 'Unknown')
      });
    }

    // Format adjustments
    for (const adj of adjustments) {
      // Prefer structured metadata; fall back to parsing the detail text for
      // rows logged before the metadata column existed.
      let adj_qty = 0;
      let adj_loose = 0;
      let target_qty = null;
      let target_loose = null;

      if (adj.metadata?.quantity) {
        const oldVal = Number(adj.metadata.quantity.from);
        const newVal = Number(adj.metadata.quantity.to);
        adj_qty = newVal - oldVal;
        target_qty = newVal;
      } else {
        const qtyMatch = adj.detail.match(/Quantity:\s*(\d+)\s*->\s*(\d+)/i);
        if (qtyMatch) {
          const oldVal = parseInt(qtyMatch[1], 10);
          const newVal = parseInt(qtyMatch[2], 10);
          adj_qty = newVal - oldVal;
          target_qty = newVal;
        }
      }

      if (adj.metadata?.looseQuantity) {
        const oldVal = Number(adj.metadata.looseQuantity.from);
        const newVal = Number(adj.metadata.looseQuantity.to);
        adj_loose = newVal - oldVal;
        target_loose = newVal;
      } else {
        const looseMatch = adj.detail.match(/Loose(?:_quantity)?:\s*(\d+)\s*->\s*(\d+)/i);
        if (looseMatch) {
          const oldVal = parseInt(looseMatch[1], 10);
          const newVal = parseInt(looseMatch[2], 10);
          adj_loose = newVal - oldVal;
          target_loose = newVal;
        }
      }

      allTransactions.push({
        ...adj,
        purchase_qty: 0,
        sale_qty: 0,
        sale_loose: 0,
        purchase_return_qty: 0,
        sales_return_qty: 0,
        adj_qty,
        adj_loose,
        target_qty,
        target_loose,
        party: 'Admin'
      });
    }

    // Sort all chronologically (oldest first) to compute running totals.
    // Timestamps are precomputed once per row — never inside the comparator.
    for (const tx of allTransactions) {
      tx._ts = rowTs(tx.date);
    }
    allTransactions.sort((a, b) => a._ts - b._ts);

    // Maps for tracking running totals
    // Key: medicine_id + '_' + batch_no
    const batchRunning = new Map<string, { qty: number; loose: number }>();
    // Key: medicine_id
    const medRunning = new Map<number, { qty: number; loose: number }>();

    for (const tx of allTransactions) {
      if (!tx.medicine_id) continue;

      const batchKey = `${tx.medicine_id}_${tx.batch_no || ''}`;
      
      // Get previous batch stock
      if (!batchRunning.has(batchKey)) {
        batchRunning.set(batchKey, { qty: 0, loose: 0 });
      }
      const prevBatch = batchRunning.get(batchKey)!;
      tx.opening_qty = prevBatch.qty;
      tx.opening_loose = prevBatch.loose;

      // Get previous med stock
      if (!medRunning.has(tx.medicine_id)) {
        medRunning.set(tx.medicine_id, { qty: 0, loose: 0 });
      }
      const prevMed = medRunning.get(tx.medicine_id)!;

      // Update stocks
      let newBatchQty = prevBatch.qty;
      let newBatchLoose = prevBatch.loose;

      let newMedQty = prevMed.qty;
      let newMedLoose = prevMed.loose;

      if (tx.type === 'Purchase') {
        // Shelf stock is billed quantity plus free quantity (purchases.ts totalQty).
        const inbound = Number(tx.purchase_qty || 0) + Number(tx.free_qty || 0);
        newBatchQty += inbound;
        newMedQty += inbound;
      } else if (tx.type === 'Sale') {
        // Same strip/loose pool POS uses, so a loose sale that opens a strip
        // closes on the same quantity and loose_quantity the shelf holds.
        const next = applyStockDelta(
          { quantity: newBatchQty, loose_quantity: newBatchLoose },
          -Number(tx.sale_qty || 0),
          -Number(tx.sale_loose || 0),
          Number(tx.pack_size) || 1
        );
        newMedQty += next.quantity - newBatchQty;
        newMedLoose += next.loose_quantity - newBatchLoose;
        newBatchQty = next.quantity;
        newBatchLoose = next.loose_quantity;
      } else if (tx.type === 'Return') {
        if (tx.return_type === 'sale') {
          const next = applyStockDelta(
            { quantity: newBatchQty, loose_quantity: newBatchLoose },
            Number(tx.sales_return_qty || 0),
            0,
            Number(tx.pack_size) || 1
          );
          newMedQty += next.quantity - newBatchQty;
          newMedLoose += next.loose_quantity - newBatchLoose;
          newBatchQty = next.quantity;
          newBatchLoose = next.loose_quantity;
        } else {
          newBatchQty -= tx.purchase_return_qty;
          newMedQty -= tx.purchase_return_qty;
        }
      } else if (tx.type === 'Adjustment') {
        if (tx.target_qty !== null) {
          newMedQty += (tx.target_qty - newBatchQty);
          newBatchQty = tx.target_qty;
        } else {
          newBatchQty += tx.adj_qty;
          newMedQty += tx.adj_qty;
        }
        if (tx.target_loose !== null) {
          newMedLoose += (tx.target_loose - newBatchLoose);
          newBatchLoose = tx.target_loose;
        } else {
          newBatchLoose += tx.adj_loose;
          newMedLoose += tx.adj_loose;
        }
      }

      // Update maps
      batchRunning.set(batchKey, { qty: newBatchQty, loose: newBatchLoose });
      medRunning.set(tx.medicine_id, { qty: newMedQty, loose: newMedLoose });

      tx.closing_qty = newBatchQty;
      tx.closing_loose = newBatchLoose;

      tx.medicine_stock_qty = newMedQty;
      tx.medicine_stock_loose = newMedLoose;
    }

    // In-memory query filter checks (secondary pass, highly performant on SQL-restricted subset)
    let filtered = allTransactions;
    if (q) {
      const qLower = String(q).toLowerCase();
      filtered = filtered.filter(tx => 
        (tx.medicine_name && tx.medicine_name.toLowerCase().includes(qLower)) ||
        (tx.batch_no && tx.batch_no.toLowerCase().includes(qLower)) ||
        (tx.reference && tx.reference.toLowerCase().includes(qLower)) ||
        (tx.party && tx.party.toLowerCase().includes(qLower)) ||
        (tx.detail && tx.detail.toLowerCase().includes(qLower))
      );
    }

    // In-memory date bounds are only needed when SQL skipped them (medicine/batch
    // full-history mode); with _ts precomputed they cost one numeric compare.
    if (!sqlDateFilter) {
      if (dateFrom) {
        const fromTs = rowTs(`${dateFrom}T00:00:00`);
        filtered = filtered.filter(tx => tx._ts >= fromTs);
      }
      if (dateTo) {
        const toTs = rowTs(`${nextDayString(String(dateTo))}T00:00:00`);
        filtered = filtered.filter(tx => tx._ts < toTs);
      }
    }

    if (medicineName) {
      const medLower = String(medicineName).toLowerCase();
      filtered = filtered.filter(tx => tx.medicine_name && tx.medicine_name.toLowerCase().includes(medLower));
    }

    if (batchNo) {
      const batchLower = String(batchNo).toLowerCase();
      filtered = filtered.filter(tx => tx.batch_no && tx.batch_no.toLowerCase().includes(batchLower));
    }

    if (salesBillNo) {
      const sBillLower = String(salesBillNo).toLowerCase();
      filtered = filtered.filter(tx => tx.type === 'Sale' && tx.reference && tx.reference.toLowerCase().includes(sBillLower));
    }

    if (purchaseBillNo) {
      const pBillLower = String(purchaseBillNo).toLowerCase();
      filtered = filtered.filter(tx => tx.type === 'Purchase' && tx.reference && tx.reference.toLowerCase().includes(pBillLower));
    }

    if (patientName) {
      const patientLower = String(patientName).toLowerCase();
      filtered = filtered.filter(tx => tx.type === 'Sale' && tx.party && tx.party.toLowerCase().includes(patientLower));
    }

    if (distributor) {
      const distLower = String(distributor).toLowerCase();
      filtered = filtered.filter(tx => tx.type === 'Purchase' && tx.party && tx.party.toLowerCase().includes(distLower));
    }

    if (reference) {
      const refLower = String(reference).toLowerCase();
      filtered = filtered.filter(tx => tx.reference && tx.reference.toLowerCase().includes(refLower));
    }

    if (party) {
      const partyLower = String(party).toLowerCase();
      filtered = filtered.filter(tx => tx.party && tx.party.toLowerCase().includes(partyLower));
    }

    if (type && type !== 'All') {
      filtered = filtered.filter(tx => tx.type === type);
    }

    // Descending display order via reverse of the ascending running-stock sort —
    // a second full sort (with per-comparison date parsing) is pure waste.
    filtered.reverse();

    const totalItems = filtered.length;

    // Store for sibling page requests (any page/limit combination)
    timelineCache.set(cacheSig, { at: Date.now(), filtered, totalItems });
    if (timelineCache.size > TIMELINE_CACHE_MAX_ENTRIES) {
      const oldestKey = timelineCache.keys().next().value;
      if (oldestKey !== undefined) timelineCache.delete(oldestKey);
    }

    // Paginate results
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const totalPages = Math.ceil(totalItems / limit);
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    res.json({
      data: paginated,
      totalPages,
      currentPage: page,
      totalItems
    });
  } catch (error) {
    const err = error as Error;
    console.error('Timeline fetch failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search endpoint with multi-criteria filters
router.get('/search', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const {
      q,
      patientName,
      medicineName,
      salesBillNo,
      purchaseBillNo,
      batchNo,
      distributor,
      expiryDate,
      mrp,
      quantity,
      looseQuantity
    } = req.query;

    let query = `
      SELECT DISTINCT
        im.id AS inventory_id,
        im.medicine_id,
        m.name AS medicine_name,
        im.batch_no,
        im.expiry_date,
        im.quantity,
        im.loose_quantity,
        im.mrp,
        im.cost_price,
        im.rack_location,
        d.name AS distributor_name
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      LEFT JOIN purchase_items pi ON pi.medicine_id = im.medicine_id AND pi.batch_no = im.batch_no
      LEFT JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN sale_items si ON si.inventory_id = im.id
      LEFT JOIN sales_invoices sinv ON si.invoice_id = sinv.id
      LEFT JOIN customers c ON sinv.customer_id = c.id
      LEFT JOIN distributors d ON p.distributor_id = d.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (q) {
      query += ` AND (m.name LIKE ? OR im.batch_no LIKE ? OR sinv.invoice_no LIKE ? OR p.invoice_no LIKE ? OR c.name LIKE ?)`;
      const likeQ = `%${q}%`;
      params.push(likeQ, likeQ, likeQ, likeQ, likeQ);
    }
    if (medicineName) {
      query += ` AND m.name LIKE ?`;
      params.push(`%${medicineName}%`);
    }
    if (batchNo) {
      query += ` AND im.batch_no LIKE ?`;
      params.push(`%${batchNo}%`);
    }
    if (expiryDate) {
      query += ` AND im.expiry_date LIKE ?`;
      params.push(`%${expiryDate}%`);
    }
    if (mrp) {
      query += ` AND im.mrp = ?`;
      params.push(Number(mrp));
    }
    if (quantity) {
      query += ` AND im.quantity = ?`;
      params.push(Number(quantity));
    }
    if (looseQuantity) {
      query += ` AND im.loose_quantity = ?`;
      params.push(Number(looseQuantity));
    }
    if (distributor) {
      query += ` AND d.name LIKE ?`;
      params.push(`%${distributor}%`);
    }
    if (patientName) {
      query += ` AND c.name LIKE ?`;
      params.push(`%${patientName}%`);
    }
    if (salesBillNo) {
      query += ` AND sinv.invoice_no LIKE ?`;
      params.push(`%${salesBillNo}%`);
    }
    if (purchaseBillNo) {
      query += ` AND p.invoice_no LIKE ?`;
      params.push(`%${purchaseBillNo}%`);
    }

    query += ` ORDER BY m.name ASC LIMIT 50`;

    const results = await db.all(query, params);
    res.json(results);
  } catch (error) {
    const err = error as Error;
    console.error('Search failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Detailed history timeline trace and references
router.get('/details/:inventoryId', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { inventoryId } = req.params;

    const inventory = await db.get(
      `SELECT im.*, m.name AS medicine_name, m.generic_name, m.manufacturer, m.category, m.hsn_code, m.cgst_per, m.sgst_per, m.igst_per
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE im.id = ?`,
      [inventoryId]
    );

    if (!inventory) {
      return res.status(404).json({ error: 'Inventory record not found' });
    }

    // Purchase history (matching medicine & batch)
    const purchases = await db.all(
      `SELECT pi.*, p.invoice_no, p.date, d.name AS distributor_name
       FROM purchase_items pi
       JOIN purchases p ON pi.purchase_id = p.id
       LEFT JOIN distributors d ON p.distributor_id = d.id
       WHERE pi.medicine_id = ? AND pi.batch_no = ?`,
      [inventory.medicine_id, inventory.batch_no]
    );

    // Sales history (referencing inventory ID)
    const sales = await db.all(
      `SELECT si.*, sinv.invoice_no, sinv.date, c.name AS customer_name
       FROM sale_items si
       JOIN sales_invoices sinv ON si.invoice_id = sinv.id
       LEFT JOIN customers c ON sinv.customer_id = c.id
       WHERE si.inventory_id = ?`,
      [inventoryId]
    );

    // Build timeline trace chronologically
    const timeline: any[] = [];

    for (const p of purchases) {
      timeline.push({
        date: p.date,
        type: 'Purchase',
        reference: p.invoice_no,
        detail: `Purchased from ${p.distributor_name || 'Unknown Supplier'}`,
        qtyChange: p.quantity,
        cost: p.cost_price,
        mrp: p.mrp
      });
    }

    for (const s of sales) {
      timeline.push({
        date: s.date,
        type: 'Sale',
        reference: s.invoice_no,
        detail: `Sold to Patient ${s.customer_name || 'Walk-in Customer'}`,
        qtyChange: -Number(s.quantity || 0),
        looseChange: -Number(s.loose_qty || 0),
        price: s.unit_price
      });
    }

    // Sort descending by date
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json({
      inventory,
      purchases,
      sales,
      timeline
    });
  } catch (error) {
    const err = error as Error;
    console.error('Details fetch failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Direct Inventory Correction
router.put('/inventory/:inventoryId', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const { inventoryId } = req.params;
    const { quantity, loose_quantity, batch_no, expiry_date, mrp, cost_price, rack_location } = req.body;

    if (quantity < 0 || loose_quantity < 0) {
      return res.status(400).json({ error: 'Quantity cannot be negative' });
    }

    await db.run('BEGIN TRANSACTION');

    const oldRecord = await db.get(
      'SELECT im.*, m.name FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id = ?',
      [inventoryId]
    );

    if (!oldRecord) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Inventory record not found' });
    }

    await db.run(
      `UPDATE inventory_master
       SET quantity = ?, loose_quantity = ?, batch_no = ?, expiry_date = ?, mrp = ?, cost_price = ?, rack_location = ?
       WHERE id = ?`,
      [quantity, loose_quantity, batch_no, expiry_date, mrp, cost_price, rack_location, inventoryId]
    );

    // Cascading updates to transaction items to keep them in sync
    await db.run(
      `UPDATE purchase_items
       SET batch_no = ?, expiry_date = ?
       WHERE medicine_id = ? AND batch_no = ?`,
      [batch_no, expiry_date, oldRecord.medicine_id, oldRecord.batch_no]
    );

    try {
      await db.run(
        `UPDATE sale_items
         SET batch_no = ?
         WHERE inventory_id = ?`,
        [batch_no, inventoryId]
      );
    } catch (_e) {
      // Ignore if column not present or not populated
    }

    // Audit trace logging
    const desc = `Inventory correction for "${oldRecord.name}" (ID ${inventoryId}). Quantity: ${oldRecord.quantity} -> ${quantity}, Loose: ${oldRecord.loose_quantity} -> ${loose_quantity}, Batch: "${oldRecord.batch_no}" -> "${batch_no}", Expiry: "${oldRecord.expiry_date}" -> "${expiry_date}".`;
    await logAction(db, 'INVENTORY_CORRECTION', desc, {
      inventoryId: Number(inventoryId),
      medicineId: oldRecord.medicine_id,
      medicineName: oldRecord.name,
      quantity: { from: oldRecord.quantity, to: quantity },
      looseQuantity: { from: oldRecord.loose_quantity, to: loose_quantity },
      batchNo: { from: oldRecord.batch_no, to: batch_no },
      expiryDate: { from: oldRecord.expiry_date, to: expiry_date }
    });

    const qtyDelta = Number(quantity) - Number(oldRecord.quantity || 0);
    const looseDelta = Number(loose_quantity) - Number(oldRecord.loose_quantity || 0);
    if (qtyDelta !== 0 || looseDelta !== 0) {
      const { recordStockLedger } = await import('../utils/stockRebuild.js');
      await recordStockLedger(db, {
        medicine_id: oldRecord.medicine_id,
        batch_no: batch_no,
        quantity: qtyDelta,
        loose_quantity: looseDelta,
        transaction_type: 'investigation_adjustment',
        transaction_id: inventoryId
      });
    }

    await refreshInventoryActiveStatus(db, Number(inventoryId));

    await db.run('COMMIT');
    inventoryCache.invalidate();
    invalidateInvestigationTimelineCache();

    try {
      const { eventService } = await import('../services/eventService.js');
      eventService.broadcast('inventory_sync', { success: true });
      eventService.broadcast('inventory_changed', { reason: 'investigation_inventory_adjustment', inventory_id: Number(inventoryId) });
    } catch (_e) {}

    res.json({ success: true, message: 'Inventory record corrected successfully' });
  } catch (error) {
    if (db) await db.run('ROLLBACK');
    const err = error as Error;
    console.error('Inventory correction failed:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Sales Bill correction and inventory sync
router.put('/sales/:invoiceId', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const { invoiceId } = req.params;
    const { items, discount = 0 } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items must be an array' });
    }

    await db.run('BEGIN TRANSACTION');

    // Fetch existing bill details
    const existingBill = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [invoiceId]);
    if (!existingBill) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Sales invoice not found' });
    }

    // Steps 1-6: one shared rule set with Sells / POS edit (services/saleBillEditService.ts).
    // Stock moves only by the net change per batch; totals use the POS tax-inclusive math.
    const { subtotal, total, tax, roff, totalCgst, totalSgst, oldItems, adjustments: itemAdjustments } =
      await applySaleBillEdit(db, invoiceId, items, Number(discount || 0));

    // Step 7: Update sales invoice header
    await db.run(
      `UPDATE sales_invoices
       SET total_amount = ?, tax_amount = ?, cgst_value = ?, sgst_value = ?, discount = ?, subtotal = ?, roff = ?
       WHERE id = ?`,
      [total, tax, totalCgst, totalSgst, Number(discount || 0), subtotal, roff, invoiceId]
    );

    // Step 8: Recalculate customer credit balance if customer exists
    if (existingBill.customer_id) {
      const unpaidRow = await db.get(
        `SELECT COALESCE(SUM(total_amount), 0) as total 
         FROM sales_invoices 
         WHERE customer_id = ? AND (payment_medium = 'CREDIT' OR payment_status = 'UNPAID' OR payment_status = 'PENDING')`,
        [existingBill.customer_id]
      );
      const newBalance = Math.max(0, Number(unpaidRow?.total || 0));
      await db.run(
        'UPDATE customers SET credit_balance = ? WHERE id = ?',
        [newBalance, existingBill.customer_id]
      );
    }

    // Save snapshot of the edit in history for backup
    const originalData = JSON.stringify({
      bill: existingBill,
      items: oldItems
    });
    const updatedData = JSON.stringify({
      bill: { total_amount: total, tax_amount: tax, discount: Number(discount || 0), subtotal },
      items: items
    });
    await db.run(
      'INSERT INTO sales_bill_edit_history (invoice_id, invoice_no, original_data, updated_data) VALUES (?, ?, ?, ?)',
      [invoiceId, existingBill.invoice_no, originalData, updatedData]
    );

    // Audit logging
    const desc = `Corrected Sales Invoice #${existingBill.invoice_no}. Subtotal: ₹${existingBill.subtotal} -> ₹${subtotal}, Discount: ₹${existingBill.discount} -> ₹${discount}, Total: ₹${existingBill.total_amount} -> ₹${total}.`;
    await logAction(db, 'SALES_BILL_CORRECTION', desc, {
      invoiceId: Number(invoiceId),
      invoiceNo: existingBill.invoice_no,
      subtotal: { from: existingBill.subtotal, to: subtotal },
      discount: { from: existingBill.discount, to: Number(discount || 0) },
      total: { from: existingBill.total_amount, to: total },
      itemAdjustments
    });

    await db.run('COMMIT');
    inventoryCache.invalidate();
    invalidateInvestigationTimelineCache();

    try {
      const { eventService } = await import('../services/eventService.js');
      eventService.broadcast('sales_sync', { success: true, action: 'update', id: Number(invoiceId) });
      eventService.broadcast('inventory_sync', { success: true });
      eventService.broadcast('inventory_changed', { reason: 'investigation_sale_edit', invoice_id: Number(invoiceId) });
    } catch (_e) {}

    res.json({ success: true, message: 'Sales invoice corrected and inventory reconciled successfully', total, tax });
  } catch (error) {
    if (db) {
      try {
        await db.run('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr);
      }
    }
    const err = error as Error;
    console.error('Sales invoice correction failed:', err);
    res.status(error instanceof SaleEditError ? 400 : 500).json({ error: err.message || 'Internal server error' });
  }
});

// Purchase Bill correction and inventory sync
router.put('/purchases/:purchaseId', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const { purchaseId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items must be an array' });
    }

    await db.run('BEGIN TRANSACTION');

    const existingPurchase = await db.get('SELECT * FROM purchases WHERE id = ?', [purchaseId]);
    if (!existingPurchase) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Purchase bill not found' });
    }

    // Step 1: every line must be a real master medicine with a batch and a quantity.
    if (items.length === 0) {
      throw new PurchaseEditError('A purchase bill needs at least one line. To remove every line, delete the bill from Purchase History instead.');
    }
    for (const ni of items) {
      if (!ni.batch_no || String(ni.batch_no).trim() === '') {
        throw new PurchaseEditError('Batch number is required for all purchase items.');
      }
      const med = ni.medicine_id ? await db.get('SELECT id FROM medicines WHERE id = ?', [Number(ni.medicine_id)]) : null;
      if (!med) {
        throw new PurchaseEditError(`"${ni.medicine_name || 'A line'}" is not linked to a medicine in the master list.`);
      }
      if ((Number(ni.quantity) || 0) + (Number(ni.free_qty) || 0) <= 0) {
        throw new PurchaseEditError(`"${ni.medicine_name || 'A line'}" has no quantity. Remove the line instead.`);
      }
    }

    // Step 2: shelf stock moves by the NET change per medicine + batch, one rule set with
    // the Purchases edit and delete (services/purchaseBillEditService.ts).
    const oldItems = await db.all(
      'SELECT medicine_id, batch_no, quantity, free_qty FROM purchase_items WHERE purchase_id = ?',
      [purchaseId]
    );
    await applyPurchaseStockChange(
      db,
      purchaseId,
      oldItems,
      items.map((ni: any) => ({
        medicine_id: Number(ni.medicine_id),
        batch_no: String(ni.batch_no).trim(),
        quantity: Number(ni.quantity) || 0,
        free_qty: Number(ni.free_qty) || 0,
        expiry_date: ni.expiry_date || null,
        cost_price: ni.cost_price !== undefined && ni.cost_price !== null && ni.cost_price !== '' ? Number(ni.cost_price) : null,
        mrp: Number(ni.mrp) || 0
      })),
      'investigation_purchase_edit'
    );

    // Step 3: Remove old and insert new purchase items
    await db.run('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
    let totalAmount = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    for (const item of items) {
      if (!item.batch_no || String(item.batch_no).trim() === '') {
        throw new Error('Batch number is required for all purchase items.');
      }
      const batchNo = String(item.batch_no).trim();
      const { medicine_id, expiry_date = null, quantity, free_qty = 0, cost_price = 0, mrp = 0 } = item;
      const cgstPer = parseFloat(item.cgst_per) || 0;
      const sgstPer = parseFloat(item.sgst_per) || 0;
      const cdValue = parseFloat(item.cd_value) || 0;
      const baseAmt = Number(quantity) * Number(cost_price);
      const taxable = baseAmt - cdValue;
      const cgstValue = taxable * (cgstPer / 100);
      const sgstValue = taxable * (sgstPer / 100);
      await db.run(
        `INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp, cgst_per, cgst_value, sgst_per, sgst_value, cd_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [purchaseId, medicine_id, batchNo, expiry_date, quantity, free_qty, cost_price, mrp, cgstPer, cgstValue, sgstPer, sgstValue, cdValue]
      );
      totalAmount += taxable + cgstValue + sgstValue;
      totalCgst += cgstValue;
      totalSgst += sgstValue;
    }

    // Update purchase invoice total (preserving GST breakdown for audit trail). The bill's
    // saved credit-note deduction (cn_amount) still comes off the payable total.
    const payable = Math.max(0, totalAmount - (Number(existingPurchase.cn_amount) || 0));
    await db.run(
      'UPDATE purchases SET total_amount = ?, cgst_value = ?, sgst_value = ?, original_amount = ? WHERE id = ?',
      [payable, totalCgst, totalSgst, totalAmount, purchaseId]
    );

    // Audit logging
    const desc = `Corrected Purchase Bill #${existingPurchase.invoice_no || purchaseId}. Total Amount: ₹${existingPurchase.total_amount} -> ₹${totalAmount}.`;
    await logAction(db, 'PURCHASE_BILL_CORRECTION', desc, {
      purchaseId,
      invoiceNo: existingPurchase.invoice_no || null,
      totalAmount: { from: existingPurchase.total_amount, to: totalAmount }
    });

    await db.run('COMMIT');
    inventoryCache.invalidate();
    invalidateInvestigationTimelineCache();
    await rebuildPurchaseSummaryCache();
    triggerBackgroundSummaryRebuild();

    try {
      const { eventService } = await import('../services/eventService.js');
      eventService.broadcast('purchase_sync', { success: true, action: 'update', id: Number(purchaseId) });
      eventService.broadcast('inventory_sync', { success: true });
      eventService.broadcast('invoice_saved', { purchase_id: Number(purchaseId), action: 'update' });
      eventService.broadcast('inventory_changed', { reason: 'investigation_purchase_edit', purchase_id: Number(purchaseId) });
    } catch (_e) {}

    res.json({ success: true, message: 'Purchase bill corrected and inventory reconciled successfully', totalAmount });
  } catch (error) {
    if (db) {
      try {
        await db.run('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr);
      }
    }
    const err = error as Error;
    console.error('Purchase bill correction failed:', err);
    res.status(error instanceof PurchaseEditError ? 400 : 500).json({ error: err.message || 'Internal server error' });
  }
});

// Audit Logs fetch endpoint (matching terms in description)
router.get('/audit-logs/:inventoryId', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { inventoryId } = req.params;

    // Get inventory medicine name and batch to query matches
    const record = await db.get(
      'SELECT im.batch_no, m.name FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id = ?',
      [inventoryId]
    );

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const likeName = `%${record.name}%`;
    const likeBatch = `%${record.batch_no}%`;
    const likeId = `%ID ${inventoryId}%`;

    const logs = await db.all(
      `SELECT * FROM action_logs
       WHERE description LIKE ? OR description LIKE ? OR description LIKE ?
       ORDER BY created_at DESC LIMIT 50`,
      [likeName, likeBatch, likeId]
    );

    res.json(logs);
  } catch (error) {
    const err = error as Error;
    console.error('Fetch audit logs failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
