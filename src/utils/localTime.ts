/**
 * Bill dates (sales, purchases, returns) are stored in the SHOP'S local time as
 * 'YYYY-MM-DD HH:MM:SS', the same form the migrated history uses, and are read back with NO
 * time-zone conversion. A bill then shows on the day and time it was saved on every page.
 * Mixing UTC (`toISOString()`, SQLite CURRENT_TIMESTAMP) with local text is what moved
 * evening bills to the next day (bug P1-71/P1-72). SQL writers use SQL_LOCAL_NOW.
 */

export const SQL_LOCAL_NOW = "datetime('now', 'localtime')";

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalSqlDateTime(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * A date/time a client sent: local text is kept as it is, an ISO/UTC value is converted to
 * the same moment in shop time. Returns null when it is not a real date (never a guess).
 */
export function normalizeToLocalSqlDateTime(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : toLocalSqlDateTime(d);
}
