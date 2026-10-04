import type { Database } from 'sqlite';

/**
 * Bill numbers always follow the LAST saved bill: take its trailing digits, add 1, keep the
 * same prefix and zero-padding ('S-2026-0042' -> 'S-2026-0043', '1234' -> '1235', 'A/25/099' -> 'A/25/100').
 * Nothing is invented: the only time a fresh series starts is a database with no bill at all.
 */
export const incrementBillNo = (last: string | null | undefined): string | null => {
  const m = String(last ?? '').trim().match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return null;
  const [, head, digits, tail] = m;
  const next = (BigInt(digits) + 1n).toString().padStart(digits.length, '0');
  return `${head}${next}${tail}`;
};

// Looks back a few bills so one oddly-named bill (no digits) cannot break the chain.
const LOOK_BACK = 50;
const MAX_COLLISION_STEPS = 1000;

export const nextSaleInvoiceNo = async (db: Database): Promise<string> => {
  const recent = await db.all<{ invoice_no: string | null }[]>(
    `SELECT invoice_no FROM sales_invoices WHERE invoice_no IS NOT NULL AND invoice_no <> '' ORDER BY id DESC LIMIT ${LOOK_BACK}`
  );
  let candidate: string | null = null;
  for (const r of recent) {
    candidate = incrementBillNo(r.invoice_no);
    if (candidate) break;
  }
  // First bill ever in this database: the only place a series is started.
  if (!candidate) return `S-${new Date().getFullYear()}-0001`;

  // invoice_no is UNIQUE: if the next number is taken (bills saved out of order), step on to the next free one.
  for (let i = 0; i < MAX_COLLISION_STEPS; i++) {
    const taken = await db.get('SELECT 1 AS x FROM sales_invoices WHERE invoice_no = ? LIMIT 1', [candidate]);
    if (!taken) return candidate;
    candidate = incrementBillNo(candidate) as string;
  }
  throw new Error('Could not find a free invoice number');
};

export const lastSaleInvoice = async (db: Database): Promise<{ invoice_no: string; date: string | null } | null> => {
  const row = await db.get<{ invoice_no: string; date: string | null }>(
    `SELECT invoice_no, date FROM sales_invoices WHERE invoice_no IS NOT NULL AND invoice_no <> '' ORDER BY id DESC LIMIT 1`
  );
  return row ?? null;
};
