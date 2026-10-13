/**
removeWrongDistributorLinks.mjs — delete medicine_distributor_links rows that point a medicine at a
DIFFERENT Pharmarack product (other strength/unit, extra variant word such as Plus/DS/H/AM, other brand
spelling). Deleted links are simply re-created correctly the next time the pharmacist adds/links that
medicine (the app now saves a link only after a verified live add and only on an exact same-product match).

Only medicine_distributor_links is written. Nothing else (no medicines, inventory, cart, orders).
DRY RUN by default; --apply writes a CSV of every removed row beside the DB so it can be restored.
Close the app before --apply (the DB must not be in use). Never point this at a database you did not mean to edit.

Usage: node scripts/removeWrongDistributorLinks.mjs [--db path] [--apply] [--all]
  --all   remove EVERY link (start fresh), not only the mismatched ones
*/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const DB_PATH = arg('--db') || process.env.DB_PATH || path.join(ROOT, 'data', 'app.db');

const STOP = new Set('strip strips of tab tabs tablet tablets cap caps capsule capsules syp syrup susp suspension inj injection oint ointment crm cream gel drop drops sol solution lot lotion respule respules sachet sachets soap wash shampoo spray powder drg oil emulsion pc pcs pack pck box btl bottle vial amp ampoule gm mg ml mcg iu kg ltr s md'.split(' '));

function lev(a, b) {
  const p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = p[0]; p[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = p[j];
      p[j] = Math.min(p[j] + 1, p[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return p[b.length];
}

function parts(name) {
  const s = String(name || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\*+/g, ' ');
  const alpha = new Set(s.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter((w) => /^[a-z]+$/.test(w) && !STOP.has(w)));
  const strength = new Set((s.match(/\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|iu|ml)\b/g) || []).map((x) => x.replace(/\s+/g, '')));
  return { alpha, strength };
}

/** Why this link is wrong, or null when it looks like the same product. */
function conflict(medName, prodName) {
  const a = parts(medName), b = parts(prodName);
  if (a.strength.size && b.strength.size && [...a.strength].sort().join() !== [...b.strength].sort().join()) {
    return `strength ${[...a.strength].join('/')} vs ${[...b.strength].join('/')}`;
  }
  const unmatched = (x, y) => [...x].filter((t) => ![...y].some((u) => u === t || lev(t, u) <= 1));
  const extra = unmatched(a.alpha, b.alpha).concat(unmatched(b.alpha, a.alpha));
  return extra.length ? `different words: ${extra.join(',')}` : null;
}

const db = new Database(DB_PATH, { readonly: !APPLY });
const rows = db.prepare(`
  SELECT l.*, m.name AS medicine_name
  FROM medicine_distributor_links l LEFT JOIN medicines m ON m.id = l.medicine_id`).all();

const bad = [];
for (const r of rows) {
  const why = ALL ? 'all links (--all)' : (!r.medicine_name ? 'medicine no longer exists' : conflict(r.medicine_name, r.product_name));
  if (why) bad.push({ r, why });
}

console.log(`DB: ${DB_PATH}\nLinks: ${rows.length}   to remove: ${bad.length}   keep: ${rows.length - bad.length}   mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
for (const { r, why } of bad.slice(0, 60)) console.log(`#${r.id} | ${r.medicine_name} | ${r.product_name} | ${r.store_name} | ${why}`);
if (bad.length > 60) console.log(`... and ${bad.length - 60} more`);

if (APPLY && bad.length) {
  const out = path.join(path.dirname(DB_PATH), `distributor_links_removed_${Date.now()}.csv`);
  const cols = Object.keys(bad[0].r);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(out, [cols.join(','), ...bad.map(({ r }) => cols.map((c) => q(r[c])).join(','))].join('\n'));
  const del = db.prepare('DELETE FROM medicine_distributor_links WHERE id = ?');
  db.transaction(() => { for (const { r } of bad) del.run(r.id); })();
  console.log(`Removed ${bad.length} link(s). Backup of removed rows: ${out}`);
} else if (!APPLY) {
  console.log('Dry run only — nothing changed. Re-run with --apply (app closed) to remove.');
}
db.close();
