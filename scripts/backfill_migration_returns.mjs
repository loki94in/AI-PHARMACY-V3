/**
 * Backfill script: Restore legacy return voucher numbers (PR-...)
 * and distributor purchase invoice numbers, loose quantities, and deductions
 * from the archived PostgreSQL dump into SQLite data/app.db.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const BACKUP_PATH = path.resolve('data/archived_migrations/retailerdb_backup_Sat 09_05_2026_17_01_00.54.sql.zip');
const DB_PATH = path.resolve('data/app.db');

async function runBackfill() {
  if (!fs.existsSync(BACKUP_PATH)) {
    console.error('Backup file not found at:', BACKUP_PATH);
    process.exit(1);
  }

  console.log('Connecting to database:', DB_PATH);
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // Ensure columns exist in return_items
  const tableCols = await db.all('PRAGMA table_info(return_items)');
  const colNames = new Set(tableCols.map(c => c.name));
  if (!colNames.has('invoice_no')) {
    console.log('Adding invoice_no column to return_items...');
    await db.run('ALTER TABLE return_items ADD COLUMN invoice_no TEXT');
  }
  if (!colNames.has('loose')) {
    console.log('Adding loose column to return_items...');
    await db.run('ALTER TABLE return_items ADD COLUMN loose INTEGER DEFAULT 0');
  }
  if (!colNames.has('ded_per')) {
    console.log('Adding ded_per column to return_items...');
    await db.run('ALTER TABLE return_items ADD COLUMN ded_per REAL DEFAULT 0');
  }
  if (!colNames.has('cd_value')) {
    console.log('Adding cd_value column to return_items...');
    await db.run('ALTER TABLE return_items ADD COLUMN cd_value REAL DEFAULT 0');
  }

  console.log('Reading migration file...');
  const gunzip = zlib.createGunzip();
  const stream = fs.createReadStream(BACKUP_PATH).pipe(gunzip);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let inRo = false, inRoi = false;
  let roHeaders = [], roiHeaders = [];

  const roMap = new Map(); // roId -> { oldReturnNo, purchaseInvoices: Set }
  const roiList = [];      // { roiId, roId, invoice, loose, ded_per, cd_value }

  for await (const line of rl) {
    if (line.startsWith('COPY public.return_orders (')) {
      inRo = true;
      roHeaders = line.replace('COPY public.return_orders (', '').replace(') FROM stdin;', '').split(', ').map(s => s.trim());
      continue;
    }
    if (line.startsWith('COPY public.return_order_item (')) {
      inRoi = true;
      roiHeaders = line.replace('COPY public.return_order_item (', '').replace(') FROM stdin;', '').split(', ').map(s => s.trim());
      continue;
    }
    if (line === '\\.') {
      inRo = false;
      inRoi = false;
      continue;
    }

    if (inRo) {
      const parts = line.split('\t');
      const roId = parts[roHeaders.indexOf('return_order_id')];
      const invId = parts[roHeaders.indexOf('invoice_id')];
      if (roId) {
        roMap.set(roId, {
          oldReturnNo: (invId && invId !== '\\N') ? invId.trim() : null,
          purchaseInvoices: new Set()
        });
      }
    }

    if (inRoi) {
      const parts = line.split('\t');
      const roiId = parts[roiHeaders.indexOf('return_order_item_id')];
      const roId = parts[roiHeaders.indexOf('return_order_id')];
      const inv = parts[roiHeaders.indexOf('invoice')];
      const cleanInv = (inv && inv !== '\\N') ? inv.trim() : null;
      const loose = parseInt(parts[roiHeaders.indexOf('loose')] || '0', 10) || 0;
      const dedPer = parseFloat(parts[roiHeaders.indexOf('ded_per')] || '0') || 0;
      const cdValue = parseFloat(parts[roiHeaders.indexOf('cd_value')] || '0') || 0;

      roiList.push({
        roiId,
        roId,
        invoice: cleanInv,
        loose,
        ded_per: dedPer,
        cd_value: cdValue
      });

      if (cleanInv && roId && roMap.has(roId)) {
        roMap.get(roId).purchaseInvoices.add(cleanInv);
      }
    }
  }

  // Second pass on roiList in case roi appeared before ro
  for (const item of roiList) {
    if (item.invoice && item.roId && roMap.has(item.roId)) {
      roMap.get(item.roId).purchaseInvoices.add(item.invoice);
    }
  }

  console.log(`Parsed ${roMap.size} return orders and ${roiList.length} return order items.`);

  // Apply updates to returns table
  console.log('Updating returns table in app.db...');
  await db.run('BEGIN TRANSACTION');

  let updatedReturns = 0;
  for (const [roId, data] of roMap.entries()) {
    const primaryInvoice = data.purchaseInvoices.size > 0 ? Array.from(data.purchaseInvoices)[0] : null;
    if (data.oldReturnNo || primaryInvoice) {
      const res = await db.run(
        `UPDATE returns 
         SET return_no = COALESCE(?, return_no),
             return_invoice_id = COALESCE(?, return_invoice_id)
         WHERE legacy_id = ?`,
        [data.oldReturnNo, primaryInvoice, roId]
      );
      if (res.changes && res.changes > 0) {
        updatedReturns += res.changes;
      }
    }
  }

  console.log(`Updated ${updatedReturns} returns with original return vouchers and purchase bill numbers.`);

  // Apply updates to return_items table
  console.log('Updating return_items table in app.db...');
  let updatedItems = 0;
  for (const item of roiList) {
    if (item.invoice || item.loose > 0 || item.ded_per > 0 || item.cd_value > 0) {
      const res = await db.run(
        `UPDATE return_items
         SET invoice_no = COALESCE(?, invoice_no),
             loose = ?,
             ded_per = ?,
             cd_value = ?
         WHERE legacy_id = ?`,
        [item.invoice, item.loose, item.ded_per, item.cd_value, item.roiId]
      );
      if (res.changes && res.changes > 0) {
        updatedItems += res.changes;
      }
    }
  }

  await db.run('COMMIT');
  console.log(`Updated ${updatedItems} return items with invoice references, loose quantities, and deductions.`);

  // Final verification check
  const sample = await db.all(
    `SELECT r.id, r.return_no, r.return_invoice_id, r.total_amount, ri.batch_no, ri.quantity, ri.loose, ri.ded_per, ri.invoice_no
     FROM returns r
     JOIN return_items ri ON r.id = ri.return_id
     WHERE r.legacy_id IS NOT NULL AND (ri.loose > 0 OR ri.ded_per > 0 OR ri.invoice_no IS NOT NULL)
     LIMIT 5`
  );
  console.log('\nSample verified restored records:');
  console.log(JSON.stringify(sample, null, 2));

  await db.close();
  console.log('\nBackfill completed successfully!');
}

runBackfill().catch(err => {
  console.error('Backfill error:', err);
  process.exit(1);
});
