import Database from 'better-sqlite3';
const db = new Database('data/app.db', { readonly: true });
const cols = db.prepare("PRAGMA table_info(inventory_master)").all();
console.log('inventory_master columns:', cols.map(c => c.name).join(', '));
const sample = db.prepare("SELECT * FROM inventory_master LIMIT 3").all();
console.log('Sample inventory_master:', sample);
const count = db.prepare("SELECT count(1) as c FROM inventory_master").get().c;
console.log('inventory_master row count:', count);
