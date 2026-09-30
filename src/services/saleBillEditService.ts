import { applyStockDelta, recordStockLedger } from '../utils/stockRebuild.js';
import { isExpiredForSale, refreshInventoryActiveStatus } from '../utils/inventoryActive.js';
import { calculateSalesGstAndTotals } from '../utils/saleTotals.js';
import { applySaleDelta } from './medicineSalesMetricsService.js';

/**
 * One rule set for editing a SAVED sale bill, shared by Sells / POS edit
 * (PUT /api/sales/:id) and the Investigation correction (PUT /api/investigation/sales/:id).
 * Contract: AGENT_DATA_FLOW_TREE.md section 4 "Edit an old sale bill".
 *
 * - Stock moves by the NET change per shelf batch (new units - old units) through the
 *   strip/loose pool. A line the user did not change moves nothing, so an old bill whose
 *   batch has since expired or run out can still be corrected.
 * - Selling MORE of a batch needs real shelf stock and an unexpired batch, else the whole
 *   edit is refused. Selling less puts the units back on that same batch.
 * - Totals use the POS math (utils/saleTotals.ts) with the pack size from the database.
 * - Each line keeps the copy (name, batch, expiry, MRP, GST%) saved when it was sold; a new
 *   line copies its linked batch. A value the database does not have stays NULL.
 *
 * Runs inside the caller's transaction. Throws SaleEditError (HTTP 400) to refuse.
 */

export class SaleEditError extends Error {
  readonly status = 400;
}

interface EditLine {
  inventory_id: number;
  quantity: number;
  loose_qty: number;
  unit_price: number;
  discount_per: number;
  pack_size?: number;
}

interface ShelfRow {
  id: number;
  medicine_id: number;
  medicine_name: string | null;
  batch_no: string | null;
  quantity: number;
  loose_quantity: number;
  expiry_date: string | null;
  mrp: number | null;
  cgst_per: number | null;
  sgst_per: number | null;
  pack_size: number;
}

export interface SaleEditAdjustment {
  inventoryId: number;
  medicineName: string | null;
  batchNo: string | null;
  unitsDelta: number; // negative = more sold (left the shelf), positive = put back
}

const describeUnits = (units: number, pack: number) => {
  const strips = Math.floor(units / pack);
  const loose = units - strips * pack;
  return pack > 1 ? `${strips} strip(s) + ${loose} loose` : `${units}`;
};

const toNumber = (value: unknown) => (value === undefined || value === null || value === '' ? 0 : Number(value));

function normaliseLines(rawItems: unknown): EditLine[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new SaleEditError('A bill needs at least one medicine. To remove every line, delete the bill instead.');
  }
  return rawItems.map((raw: any, i: number) => {
    const line: EditLine = {
      inventory_id: Number(raw?.inventory_id) || 0,
      quantity: toNumber(raw?.quantity),
      loose_qty: toNumber(raw?.loose_qty),
      unit_price: raw?.unit_price === undefined || raw?.unit_price === null || raw?.unit_price === '' ? NaN : Number(raw.unit_price),
      discount_per: toNumber(raw?.discount_per)
    };
    const label = raw?.medicine_name ? `"${raw.medicine_name}"` : `Line ${i + 1}`;
    if (!line.inventory_id) {
      throw new SaleEditError(`${label} is not linked to a shelf batch. Pick the batch from stock before saving.`);
    }
    if (![line.quantity, line.loose_qty].every(n => Number.isFinite(n) && n >= 0 && Number.isInteger(n))) {
      throw new SaleEditError(`${label} has an invalid quantity.`);
    }
    if (line.quantity === 0 && line.loose_qty === 0) {
      throw new SaleEditError(`${label} has no quantity. Remove the line instead.`);
    }
    if (!Number.isFinite(line.unit_price) || line.unit_price < 0) {
      throw new SaleEditError(`${label} needs a valid price.`);
    }
    if (!Number.isFinite(line.discount_per) || line.discount_per < 0 || line.discount_per > 100) {
      throw new SaleEditError(`${label} has an invalid discount %.`);
    }
    return line;
  });
}

export async function applySaleBillEdit(db: any, invoiceId: number | string, rawItems: unknown, discount: number) {
  const items = normaliseLines(rawItems);
  const billDiscount = Number(discount || 0);
  if (!Number.isFinite(billDiscount) || billDiscount < 0) {
    throw new SaleEditError('Bill discount must be 0 or more.');
  }

  const oldItems: any[] = await db.all('SELECT * FROM sale_items WHERE invoice_id = ? ORDER BY id', [invoiceId]);

  // Old lines without a batch link moved no known shelf stock, so there is nothing to put
  // back for them. They are not re-linked by guessing a batch number.
  const ids = new Set<number>();
  for (const oi of oldItems) if (oi.inventory_id) ids.add(Number(oi.inventory_id));
  for (const it of items) ids.add(it.inventory_id);

  const shelf = new Map<number, ShelfRow>();
  if (ids.size > 0) {
    const idList = [...ids];
    const rows: ShelfRow[] = await db.all(
      `SELECT im.id, im.medicine_id, m.name AS medicine_name, im.batch_no, im.quantity, im.loose_quantity,
              im.expiry_date, im.mrp, m.cgst_per, m.sgst_per, COALESCE(m.pack_size, 1) AS pack_size
       FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id
       WHERE im.id IN (${idList.map(() => '?').join(',')})`,
      idList
    );
    for (const r of rows) shelf.set(Number(r.id), { ...r, pack_size: Math.max(1, Number(r.pack_size) || 1) });
  }

  for (const it of items) {
    if (!shelf.has(it.inventory_id)) {
      throw new SaleEditError(`The shelf batch for one of the lines (inventory #${it.inventory_id}) no longer exists. Remove that line or pick another batch.`);
    }
  }

  // Units per batch before and after the edit, using the database pack size.
  const oldUnits = new Map<number, number>();
  for (const oi of oldItems) {
    const row = oi.inventory_id ? shelf.get(Number(oi.inventory_id)) : undefined;
    if (!row) continue; // batch row gone: nothing on the shelf to put back into
    const units = Number(oi.quantity || 0) * row.pack_size + Number(oi.loose_qty || 0);
    oldUnits.set(row.id, (oldUnits.get(row.id) || 0) + units);
  }
  const newUnits = new Map<number, number>();
  for (const it of items) {
    const row = shelf.get(it.inventory_id)!;
    newUnits.set(row.id, (newUnits.get(row.id) || 0) + it.quantity * row.pack_size + it.loose_qty);
  }

  const adjustments: SaleEditAdjustment[] = [];
  for (const id of new Set([...oldUnits.keys(), ...newUnits.keys()])) {
    const row = shelf.get(id)!;
    const net = (newUnits.get(id) || 0) - (oldUnits.get(id) || 0); // > 0: sells more
    if (net === 0) continue;

    if (net > 0) {
      if (isExpiredForSale(row.expiry_date)) {
        throw new SaleEditError(
          `${row.medicine_name} (batch ${row.batch_no}) expired on ${row.expiry_date}. This edit would sell ${describeUnits(net, row.pack_size)} more of it. Lower the quantity or pick another batch.`
        );
      }
      const onShelf = row.quantity * row.pack_size + row.loose_quantity;
      if (onShelf < net) {
        throw new SaleEditError(
          `Not enough ${row.medicine_name} (batch ${row.batch_no}): the shelf has ${describeUnits(onShelf, row.pack_size)}, this edit needs ${describeUnits(net, row.pack_size)} more.`
        );
      }
    }

    const after = applyStockDelta({ quantity: row.quantity, loose_quantity: row.loose_quantity }, 0, -net, row.pack_size);
    await db.run('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?', [after.quantity, after.loose_quantity, id]);
    const delta = -net; // signed shelf movement in units
    await recordStockLedger(db, {
      medicine_id: row.medicine_id,
      batch_no: row.batch_no,
      quantity: Math.trunc(delta / row.pack_size),
      loose_quantity: delta % row.pack_size,
      transaction_type: net > 0 ? 'sale_edit' : 'sale_edit_restore',
      transaction_id: invoiceId
    });
    const extraStrips = Math.floor(net / row.pack_size);
    if (extraStrips > 0) await applySaleDelta(db, row.medicine_id, extraStrips);
    await refreshInventoryActiveStatus(db, id);
    shelf.set(id, { ...row, quantity: after.quantity, loose_quantity: after.loose_quantity });
    adjustments.push({ inventoryId: id, medicineName: row.medicine_name, batchNo: row.batch_no, unitsDelta: delta });
  }

  // Money: same tax-inclusive math as POS, with the pack size from the database.
  for (const it of items) it.pack_size = shelf.get(it.inventory_id)!.pack_size;
  const totals = await calculateSalesGstAndTotals(db, items, billDiscount);

  // Rewrite the lines. A batch that was already on the bill keeps the copy saved at sale
  // time (and its migration legacy_id on the first line); a new batch copies its row.
  const savedCopy = new Map<number, any>();
  for (const oi of oldItems) {
    if (oi.inventory_id && !savedCopy.has(Number(oi.inventory_id))) savedCopy.set(Number(oi.inventory_id), oi);
  }
  const legacyUsed = new Set<number>();
  await db.run('DELETE FROM sale_items WHERE invoice_id = ?', [invoiceId]);
  for (const it of items) {
    const row = shelf.get(it.inventory_id)!;
    const old = savedCopy.get(it.inventory_id);
    const breakdown = totals.itemTaxBreakdowns.find(b => b.item === it);
    const rowTax = row.cgst_per != null && row.sgst_per != null ? Number(row.cgst_per) + Number(row.sgst_per) : null;
    const legacyId = old?.legacy_id && !legacyUsed.has(it.inventory_id) ? old.legacy_id : null;
    if (legacyId) legacyUsed.add(it.inventory_id);
    // Migrated lines (pgSalesImporter) carry their saved MRP/batch in the legacy `mrp` /
    // `batch_no` columns instead of the snapshot columns; both are kept.
    await db.run(
      `INSERT INTO sale_items (
        invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per, cgst_value, sgst_value,
        medicine_name_snapshot, batch_no_snapshot, expiry_date_snapshot, mrp_snapshot, tax_percent_snapshot,
        mrp, batch_no, legacy_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId, it.inventory_id, it.quantity, it.unit_price, it.loose_qty, it.discount_per,
        breakdown ? breakdown.cgst_value : 0, breakdown ? breakdown.sgst_value : 0,
        old?.medicine_name_snapshot ?? row.medicine_name ?? null,
        old?.batch_no_snapshot ?? old?.batch_no ?? row.batch_no ?? null,
        old?.expiry_date_snapshot ?? row.expiry_date ?? null,
        old?.mrp_snapshot ?? (Number(old?.mrp) > 0 ? Number(old.mrp) : null) ?? (Number(row.mrp) > 0 ? Number(row.mrp) : null),
        old?.tax_percent_snapshot ?? rowTax,
        old?.mrp ?? null,
        old?.batch_no ?? null,
        legacyId
      ]
    );
  }

  return { ...totals, oldItems, adjustments };
}
