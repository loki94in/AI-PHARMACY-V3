/**
 * One-shot data correction for migrated retailer bills (added 2026-10-03).
 *
 * The legacy system stored `orders.amount` BEFORE the bill discount; the customer paid
 * amount - discount (verified: sales_payment_register paid == amount - discount on 11,597 of 11,662
 * discounted bills, and the app's own line math reproduces that figure). The importer stored the
 * gross amount as `sales_invoices.total_amount`, overstating every discounted migrated bill.
 *
 * Fix per bill (legacy_id NOT NULL, discount > 0.5):
 *   subtotal     = old total_amount            (the pre-discount amount)
 *   total_amount = round(old total - discount) (what was actually paid)
 *   roff         = total_amount - (subtotal - discount)
 * tax_amount / cgst / sgst are left untouched (legacy GST was already on the discounted value).
 *
 * Usage: node scripts/fixMigratedDiscountTotals.mjs [--db path] [--apply]
 * Default is a dry run. --apply copies the DB to <db>.bak_discount_fix first. Idempotent via
 * app_settings key `migrated_discount_totals_fixed`.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dbArg = args.indexOf('--db');
const dbPath = path.resolve(dbArg >= 0 ? args[dbArg + 1] : 'data/app.db');
const FLAG = 'migrated_discount_totals_fixed';

const db = new Database(dbPath, { readonly: !apply });
const done = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(FLAG);
if (done) {
  console.log(`Already applied (${done.value}). Nothing to do.`);
  process.exit(0);
}

const rows = db
  .prepare(
    `SELECT id, invoice_no, total_amount, discount FROM sales_invoices
     WHERE legacy_id IS NOT NULL AND discount > 0.5 AND total_amount > discount`
  )
  .all();

let before = 0;
let after = 0;
const plan = rows.map((r) => {
  const total = Math.round(r.total_amount - r.discount);
  before += r.total_amount;
  after += total;
  return {
    id: r.id,
    subtotal: r.total_amount,
    total,
    roff: Number((total - (r.total_amount - r.discount)).toFixed(2)),
  };
});

console.log(`Bills to correct: ${plan.length}`);
console.log(`Sum of totals before: ${before.toFixed(2)}  after: ${after.toFixed(2)}  reduction: ${(before - after).toFixed(2)}`);
console.log('Sample:', rows.slice(0, 3).map((r, i) => ({ inv: r.invoice_no, old: r.total_amount, discount: r.discount, new: plan[i].total })));

if (!apply) {
  console.log('Dry run only. Re-run with --apply to write (a backup copy is made first).');
  process.exit(0);
}

db.pragma('wal_checkpoint(TRUNCATE)');
const backup = `${dbPath}.bak_discount_fix`;
fs.copyFileSync(dbPath, backup);
console.log('Backup written:', backup);

const upd = db.prepare('UPDATE sales_invoices SET subtotal = ?, total_amount = ?, roff = ? WHERE id = ?');
db.transaction(() => {
  for (const p of plan) upd.run(p.subtotal, p.total, p.roff, p.id);
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(FLAG, new Date().toISOString());
})();
console.log(`Applied to ${plan.length} bills.`);
