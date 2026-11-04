import Database from 'better-sqlite3';
const db = new Database('data/app.dev.db');

console.log('=== CHECKING ALL SQLITE TRIGGERS FOR DROPPED COLUMNS ===');
const triggers = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger'").all();
console.log(`Total database triggers: ${triggers.length}\n`);

let warningCount = 0;
for (const trg of triggers) {
  console.log(`- Trigger '${trg.name}' on table '${trg.tbl_name}'`);
  const refsContact = /\bcontact\b/i.test(trg.sql);
  const refsPrefLang = /\bpreferred_language\b/i.test(trg.sql);
  const refsProduct = /\bproduct\b/i.test(trg.sql) && trg.tbl_name === 'special_orders';

  if (refsContact || refsPrefLang || refsProduct) {
    console.error(`  ⚠️ WARNING: Trigger '${trg.name}' references dropped column!`);
    console.error(`  SQL: ${trg.sql}`);
    warningCount++;
  }
}

if (warningCount === 0) {
  console.log('\n✓ ZERO triggers reference any deleted columns (contact, preferred_language, special_orders.product).');
} else {
  console.log(`\nFound ${warningCount} triggers referencing deleted columns.`);
}

