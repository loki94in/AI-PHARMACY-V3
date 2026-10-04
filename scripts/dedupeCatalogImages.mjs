// Catalog image library cleanup. Dry-run by default; pass --apply to modify files + DB.
//   node scripts/dedupeCatalogImages.mjs [--apply] [--db data/app.db] [--max-dim 900]
// 1) deletes orphan files (no catalog_images row)  2) merges byte-identical duplicates (repoints rows)
// 3) recompresses oversized JPEGs in place        4) consolidates everything into uploads/products
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { Jimp } from 'jimp';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dbPath = path.resolve(arg('--db', 'data/app.db'));
const maxDim = parseInt(arg('--max-dim', '900'), 10);
const FE = path.resolve('frontend/public/products');
const UP = path.resolve('uploads/products');
fs.mkdirSync(UP, { recursive: true });

const db = new Database(dbPath);
const rows = db.prepare('SELECT id, image_path, thumbnail_path FROM catalog_images').all();
const base = (p) => (p ? path.basename(p) : null);
const referenced = new Set(rows.flatMap((r) => [base(r.image_path), base(r.thumbnail_path)]).filter(Boolean));

const locate = (name) => [UP, FE].map((d) => path.join(d, name)).find((f) => fs.existsSync(f));
const names = new Set();
for (const d of [FE, UP]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (fs.statSync(path.join(d, f)).isFile()) names.add(f);

const stats = { files: names.size, orphans: 0, orphanBytes: 0, dupes: 0, dupBytes: 0, recompressed: 0, savedBytes: 0, moved: 0 };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const remove = (name) => { for (const d of [FE, UP]) { const f = path.join(d, name); if (fs.existsSync(f)) APPLY && fs.unlinkSync(f); } };
const size = (name) => (locate(name) ? fs.statSync(locate(name)).size : 0);

// 1) orphans (safety: a DB with few/no rows is the wrong DB, not proof the files are junk)
const dbLooksComplete = referenced.size >= names.size * 0.5;
if (!dbLooksComplete) console.log(`SKIPPING orphan delete: DB references only ${referenced.size} of ${names.size} files (wrong --db?)`);
for (const n of [...names]) {
  if (dbLooksComplete && !referenced.has(n) && /\.(jpe?g|png|webp)$/i.test(n)) {
    stats.orphans++; stats.orphanBytes += size(n); remove(n); names.delete(n);
  }
}

// 2) exact duplicates
const byHash = new Map();
const repoint = db.prepare('UPDATE catalog_images SET image_path = ? WHERE image_path = ?');
const repointT = db.prepare('UPDATE catalog_images SET thumbnail_path = ? WHERE thumbnail_path = ?');
for (const n of [...names].sort()) {
  const f = locate(n); if (!f) continue;
  const h = sha(f);
  const keep = byHash.get(h);
  if (!keep) { byHash.set(h, n); continue; }
  stats.dupes++; stats.dupBytes += fs.statSync(f).size;
  if (APPLY) { repoint.run(`/products/${keep}`, `/products/${n}`); repointT.run(`/products/${keep}`, `/products/${n}`); }
  remove(n); names.delete(n);
}

// 3+4) recompress + consolidate into uploads/products
for (const n of names) {
  const f = locate(n); if (!f) continue;
  const before = fs.statSync(f).size;
  let out = null;
  if (before > 120 * 1024 && /\.jpe?g$/i.test(n)) {
    try {
      const img = await Jimp.read(f);
      const { width: w, height: h } = img.bitmap;
      if (w > maxDim || h > maxDim) img.resize(w > h ? { w: maxDim } : { h: maxDim });
      const buf = await img.getBuffer('image/jpeg', { quality: 80 });
      if (buf.length < before) out = buf;
    } catch { /* keep original */ }
  }
  if (out) { stats.recompressed++; stats.savedBytes += before - out.length; }
  if (APPLY) {
    const dest = path.join(UP, n);
    if (out) fs.writeFileSync(dest, out);
    else if (f !== dest) fs.copyFileSync(f, dest);
    if (f !== dest) { fs.unlinkSync(f); stats.moved++; }
    const fe = path.join(FE, n); if (fs.existsSync(fe)) fs.unlinkSync(fe);
  }
}
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} on ${dbPath}`);
console.log(`files=${stats.files} orphans=${stats.orphans} (${mb(stats.orphanBytes)}) duplicates=${stats.dupes} (${mb(stats.dupBytes)}) recompressed=${stats.recompressed} (saves ${mb(stats.savedBytes)}) moved=${stats.moved}`);
db.close();
