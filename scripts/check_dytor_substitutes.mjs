import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const rows = db.prepare("SELECT * FROM substitutes WHERE source_medicine_id IN (SELECT id FROM medicines WHERE name LIKE '%DYTOR%') OR substitute_medicine_id IN (SELECT id FROM medicines WHERE name LIKE '%DYTOR%')").all();
console.log('Substitutes for Dytor:');
console.log(rows);
