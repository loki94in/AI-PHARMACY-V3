import Database from 'better-sqlite3';
const db = new Database('data/app.dev.db');

console.log('=== INSPECTING ALL DELETE TRIGGERS & CASCADES IN SQLITE ===\n');

// 1. All triggers
const triggers = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger'").all();
for (const t of triggers) {
  if (/delete|old\./i.test(t.sql)) {
    console.log(`[TRIGGER ON DELETE] ${t.name} on table '${t.tbl_name}':`);
    console.log(`  ${t.sql.replace(/\n\s*/g, ' ')}\n`);
  }
}

// 2. All foreign keys with ON DELETE actions
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log('=== FOREIGN KEY ON DELETE RULES ===\n');
for (const t of tables) {
  const fks = db.prepare(`PRAGMA foreign_key_list(${t.name})`).all();
  for (const fk of fks) {
    if (fk.on_delete && fk.on_delete !== 'NO ACTION' && fk.on_delete !== 'NONE') {
      console.log(`Table '${t.name}' -> references '${fk.table}'(${fk.to}) ON DELETE ${fk.on_delete}`);
    }
  }
}

