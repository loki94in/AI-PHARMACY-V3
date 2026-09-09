import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const rows = db.prepare(`
  SELECT im.id, im.medicine_id, m.name as med_name, im.batch_no, im.quantity
  FROM inventory_master im
  JOIN medicines m ON im.medicine_id = m.id
  WHERE m.name LIKE '%DYTOR%'
`).all();

console.log('In-stock Dytor medicines:');
console.log(rows);
