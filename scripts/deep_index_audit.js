import Database from 'better-sqlite3';
const db = new Database('data/app.dev.db');

console.log('=== DEEP INDEX AUDIT FOR ALL TABLES ===\n');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();

for (const t of tables) {
  const indices = db.prepare(`PRAGMA index_list(${t.name})`).all();
  const userIndices = indices.filter(idx => !idx.name.startsWith('sqlite_autoindex_'));
  if (userIndices.length === 0) continue;

  const parsed = [];
  for (const idx of userIndices) {
    const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all().map(c => c.name);
    // get sql definition
    const sqlRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name = ?`).get(idx.name);
    parsed.push({ name: idx.name, unique: idx.unique, cols, sql: sqlRow ? sqlRow.sql : '' });
  }

  // Check exact duplicates
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i];
      const b = parsed[j];
      if (a.cols.join(',') === b.cols.join(',')) {
        console.log(`[EXACT DUPLICATE] Table '${t.name}':`);
        console.log(`   1) ${a.name} (${a.cols.join(', ')}) -> ${a.sql}`);
        console.log(`   2) ${b.name} (${b.cols.join(', ')}) -> ${b.sql}`);
      }
    }
  }
}

