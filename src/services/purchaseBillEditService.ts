import { applyStockDelta, recordStockLedger } from '../utils/stockRebuild.js';
import { refreshInventoryActiveStatus } from '../utils/inventoryActive.js';
import { applyPurchaseDelta } from './medicineSalesMetricsService.js';

/**
 * One rule set for changing the shelf stock of a SAVED purchase bill, shared by the
 * Purchases edit (PUT /api/purchases/:id/full), the Investigation correction
 * (PUT /api/investigation/purchases/:id) and delete (DELETE /api/purchases/:id).
 * Contract: AGENT_DATA_FLOW_TREE.md section 4 "Edit an old purchase bill".
 *
 * - A purchase line puts (quantity + free_qty) strips on its batch. An edit moves the shelf
 *   by the NET change per medicine + batch through the strip/loose pool; an unchanged line
 *   moves nothing.
 * - Taking stock back (lower quantity, removed line, deleted bill) needs those units to
 *   still be on the shelf. Units already sold or returned can't be un-bought, so the whole
 *   change is refused with what is left, instead of flooring at 0 or inventing stock.
 * - Adding stock tops up the batch, or creates it: a confirmed purchase bill is the one
 *   legitimate source of shelf stock.
 * - A batch that stays on the bill takes the bill line's rate, MRP and expiry.
 *
 * Runs inside the caller's transaction. Throws PurchaseEditError (HTTP 400) to refuse.
 */

export class PurchaseEditError extends Error {
  readonly status = 400;
}

export interface PurchaseStockLine {
  medicine_id: number;
  batch_no: string | null;
  quantity: number;
  free_qty: number;
  expiry_date?: string | null;
  cost_price?: number | null;
  mrp?: number | null;
}

interface BatchChange {
  medicine_id: number;
  batch_no: string;
  oldStrips: number;
  newStrips: number;
  line?: PurchaseStockLine; // latest line for this batch on the edited bill
}

const describeUnits = (units: number, pack: number) => {
  const strips = Math.floor(units / pack);
  const loose = units - strips * pack;
  return pack > 1 ? `${strips} strip(s) + ${loose} loose` : `${units}`;
};

const stripsOf = (l: { quantity?: unknown; free_qty?: unknown }) => (Number(l.quantity) || 0) + (Number(l.free_qty) || 0);

export async function applyPurchaseStockChange(
  db: any,
  purchaseId: number | string,
  oldLines: PurchaseStockLine[],
  newLines: PurchaseStockLine[],
  ledgerType: string
): Promise<void> {
  const changes = new Map<string, BatchChange>();
  const keyOf = (l: PurchaseStockLine) => `${l.medicine_id}|${String(l.batch_no ?? '').trim()}`;
  const entry = (l: PurchaseStockLine) => {
    const k = keyOf(l);
    let c = changes.get(k);
    if (!c) {
      c = { medicine_id: Number(l.medicine_id), batch_no: String(l.batch_no ?? '').trim(), oldStrips: 0, newStrips: 0 };
      changes.set(k, c);
    }
    return c;
  };
  for (const l of oldLines) entry(l).oldStrips += stripsOf(l);
  for (const l of newLines) {
    const c = entry(l);
    c.newStrips += stripsOf(l);
    c.line = l;
  }

  // Check every take-back first so a refusal names every short batch at once.
  const shortages: string[] = [];
  const rows = new Map<string, any>();
  for (const [k, c] of changes) {
    const row = await db.get(
      `SELECT im.id, im.quantity, im.loose_quantity, COALESCE(m.pack_size, 1) AS pack_size, m.name AS medicine_name
       FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id
       WHERE im.medicine_id = ? AND TRIM(COALESCE(im.batch_no, '')) = ?
       ORDER BY im.id LIMIT 1`,
      [c.medicine_id, c.batch_no]
    );
    rows.set(k, row);
    const net = c.newStrips - c.oldStrips;
    if (net >= 0) continue;
    const pack = Math.max(1, Number(row?.pack_size) || 1);
    const need = -net * pack;
    const onShelf = row ? Number(row.quantity) * pack + Number(row.loose_quantity) : 0;
    if (onShelf < need) {
      const name = row?.medicine_name ?? `medicine #${c.medicine_id}`;
      shortages.push(`${name} (batch ${c.batch_no || '—'}): taking back ${-net} strip(s), but only ${describeUnits(Math.max(0, onShelf), pack)} is on the shelf`);
    }
  }
  if (shortages.length > 0) {
    throw new PurchaseEditError(
      `Stock from this bill was already sold or returned, so it can't be taken back: ${shortages.join('; ')}. ` +
      'Edit or delete those sales/returns first, or correct the shelf count on Investigation.'
    );
  }

  for (const [k, c] of changes) {
    const net = c.newStrips - c.oldStrips;
    let row = rows.get(k);
    const line = c.line;

    if (!row && net > 0) {
      const ins = await db.run(
        `INSERT INTO inventory_master (medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp, is_active)
         VALUES (?, ?, 0, ?, ?, ?, ?, 1)`,
        [c.medicine_id, net, c.batch_no, line?.expiry_date || null, Number(line?.cost_price) || 0, Number(line?.mrp) || 0]
      );
      row = { id: ins.lastID };
    } else if (row && net !== 0) {
      const pack = Math.max(1, Number(row.pack_size) || 1);
      const after = applyStockDelta(
        { quantity: Number(row.quantity), loose_quantity: Number(row.loose_quantity) },
        net, 0, pack
      );
      await db.run('UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?', [after.quantity, after.loose_quantity, row.id]);
    }

    // A batch still on the bill takes the bill line's rate / MRP / expiry (real bill data;
    // an empty value keeps what the batch already has).
    if (row && line) {
      await db.run(
        `UPDATE inventory_master
         SET cost_price = COALESCE(?, cost_price), mrp = COALESCE(NULLIF(?, 0), mrp), expiry_date = COALESCE(NULLIF(?, ''), expiry_date)
         WHERE id = ?`,
        [line.cost_price ?? null, Number(line.mrp) || 0, line.expiry_date ?? '', row.id]
      );
    }

    if (net !== 0) {
      await recordStockLedger(db, {
        medicine_id: c.medicine_id,
        batch_no: c.batch_no,
        quantity: net,
        loose_quantity: 0,
        transaction_type: ledgerType,
        transaction_id: purchaseId
      });
      if (net > 0) await applyPurchaseDelta(db, c.medicine_id, net, Number(line?.cost_price) || null, null, null);
    }
    if (row?.id) await refreshInventoryActiveStatus(db, row.id);
  }
}
