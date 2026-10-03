import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'app.db');

const db = new Database(dbPath, { readonly: true });

// Cart Snapshots
const snaps = db.prepare('SELECT store_id, store_name, items_json, delivery_persons_json FROM pharmarack_cart_snapshots').all();
console.log('=== CART SNAPSHOTS ===', snaps.length, 'stores');
for (const s of snaps) {
  const items = JSON.parse(s.items_json || '[]');
  const persons = JSON.parse(s.delivery_persons_json || '[]');
  console.log('\nStore:', s.store_name, '(id:', s.store_id, ')');
  console.log('  Delivery Person:', persons[0]?.name || 'N/A');
  console.log('  Items:', items.length);
  for (const it of items.slice(0, 8)) {
    console.log('   -', it.productName || it.product || it.name, '| qty:', it.qty, '| ptr:', it.ptr, '| mrp:', it.mrp, '| pack:', it.packaging);
  }
  if (items.length > 8) console.log('  ...and', items.length - 8, 'more items');
}

// Recent Placed Orders
const placed = db.prepare('SELECT store_name, order_date, items_json FROM pharmarack_placed_orders ORDER BY id DESC LIMIT 10').all();
console.log('\n=== RECENT PLACED ORDERS (last 10) ===', placed.length, 'orders');
for (const p of placed) {
  const items = JSON.parse(p.items_json || '[]');
  console.log('\nStore:', p.store_name, '| Date:', p.order_date, '| Items:', items.length);
  for (const it of items.slice(0, 5)) {
    console.log('  -', it.productName || it.product || it.name, '| qty:', it.qty);
  }
  if (items.length > 5) console.log('  ...and', items.length - 5, 'more');
}

// Check distributors table for min_order columns
const cols = db.prepare("PRAGMA table_info(distributors)").all();
console.log('\n=== DISTRIBUTORS TABLE COLUMNS ===');
cols.forEach(c => console.log(' ', c.name, '|', c.type, '| default:', c.dflt_value));

// Sample a few distributors
const dists = db.prepare("SELECT id, name, phone, email FROM distributors LIMIT 5").all();
console.log('\n=== SAMPLE DISTRIBUTORS (first 5) ===');
dists.forEach(d => console.log(' ', d.id, d.name, d.phone, d.email));

db.close();
