import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const dataDir = path.join(projectRoot, 'data');

const prodDb = path.join(dataDir, 'app.db');
const devDb = path.join(dataDir, 'app.dev.db');
const tempDb = path.join(dataDir, 'app.dev.db.tmp');

if (!fs.existsSync(prodDb)) {
  console.error(`[Clone] Production database not found at ${prodDb}`);
  process.exit(1);
}

if (fs.existsSync(tempDb)) {
  try { fs.rmSync(tempDb, { force: true }); } catch (_) {}
}

console.log(`[Clone] Safely snapshotting ${prodDb} -> ${devDb}...`);

const db = new sqlite3.Database(prodDb, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('[Clone] Failed to open production database in read-only mode:', err);
    process.exit(1);
  }

  const targetEscaped = tempDb.replace(/\\/g, '/');
  db.run(`VACUUM INTO '${targetEscaped}'`, (vacuumErr) => {
    db.close();
    if (vacuumErr) {
      console.error('[Clone] VACUUM INTO failed:', vacuumErr);
      process.exit(1);
    }

    try {
      if (fs.existsSync(devDb)) {
        try { fs.rmSync(devDb, { force: true }); } catch (_) {}
      }
      fs.copyFileSync(tempDb, devDb);
      fs.rmSync(tempDb, { force: true });
      console.log('✅ [Clone] Success! Dev sandbox refreshed at data/app.dev.db');
      console.log('   Your development server will now use this isolated copy.');
      console.log('   Production data/app.db remains 100% safe and untouched.');
    } catch (swapErr) {
      console.log('✅ [Clone] Snapshot created at data/app.dev.db.tmp. Note: If dev server is currently running, restart it to load.');
    }
  });
});
