import Database from 'better-sqlite3';
const db = new Database('data/app.db');

console.log('MSG COLS:', db.prepare('PRAGMA table_info(whatsapp_messages)').all().map(c => c.name));
const msgs = db.prepare(
  "SELECT * FROM whatsapp_messages WHERE chat_id LIKE '%9307409630%' ORDER BY timestamp DESC LIMIT 40"
).all();

console.log('--- ALL WHATSAPP MESSAGES (INCOMING & OUTGOING) ---');
msgs.reverse().forEach(r => {
  const time = new Date(r.timestamp * 1000).toLocaleTimeString('en-IN');
  const dir = r.from_me ? '>>> OUTGOING TO CUSTOMER' : '<<< INCOMING FROM CUSTOMER';
  console.log(`[${time}] ${dir}:\n${r.body}\n`);
});

console.log('--- RECENT SPECIAL ORDERS ---');
const orders = db.prepare('SELECT id, store_id, requester, phone, product, medicine_name, qty, status, payment_status, created_at, updated_at FROM special_orders ORDER BY id DESC LIMIT 5').all();
console.log(JSON.stringify(orders, null, 2));

console.log('--- PENDING CLARIFICATIONS ---');
const clar = db.prepare('SELECT * FROM wa_pending_clarifications ORDER BY id DESC LIMIT 5').all();
console.log(JSON.stringify(clar, null, 2));

console.log('--- OWNER PENDING REQUESTS ---');
const ownerReq = db.prepare('SELECT * FROM wa_owner_pending_requests ORDER BY id DESC LIMIT 5').all();
console.log(JSON.stringify(ownerReq, null, 2));
