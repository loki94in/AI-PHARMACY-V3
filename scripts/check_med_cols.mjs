import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const cols = db.prepare('PRAGMA table_info(medicines)').all();
console.log('Columns in medicines:');
console.log(cols.map(c => c.name));

const dytorMeds = db.prepare("SELECT * FROM medicines WHERE name LIKE '%DYTOR 20%'").all();
console.log('Dytor 20 meds in medicines:');
console.log(dytorMeds);
