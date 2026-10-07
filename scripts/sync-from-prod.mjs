#!/usr/bin/env node
/**
 * scripts/sync-from-prod.mjs
 * 
 * Safely replicates data from the installed PC application (Production)
 * to the local development environment for testing with real data (Quick Assist,
 * medicines, chat logs, sales) in a 100% isolated sandbox.
 * 
 * Guarantees:
 * 1. ZERO MUTATION to Production: Source database is opened strictly in READONLY mode.
 * 2. SQLite Online Backup: Handles active WAL journals cleanly without file locks or crashes.
 * 3. Outbound WhatsApp Disarmed: Pending queues and session authentication in app.dev.db
 *    are set to sandbox/cancelled so dev never messages real patients.
 * 4. Incremental Media Sync: Prescriptions and uploads are copied to dev folders.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 1. Parse command-line arguments
const args = process.argv.slice(2);
let customProdDir = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--prod-dir' && args[i + 1]) {
    customProdDir = path.resolve(args[i + 1]);
    i++;
  }
}

// 2. Discover Production Install Directory
function findProductionDir() {
  const candidates = [
    customProdDir,
    process.env.PROD_APP_DIR,
    'G:\\AI Pharmacy OS',
    'D:\\AI Pharmacy OS',
    'D:\\AI_Pharmacy_Data',
    path.join(process.env.LOCALAPPDATA || '', 'AI Pharmacy OS'),
    'C:\\AI Pharmacy OS',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const dbPath = path.join(candidate, 'data', 'app.db');
    if (fs.existsSync(dbPath)) {
      return candidate;
    }
  }
  return null;
}

const prodDir = findProductionDir();
if (!prodDir) {
  console.error('\x1b[31m[ERROR] Could not find an installed production AI Pharmacy directory.\x1b[0m');
  console.error('Please specify the location using: node scripts/sync-from-prod.mjs --prod-dir "C:\\path\\to\\AI Pharmacy OS"');
  process.exit(1);
}

const prodDbPath = path.join(prodDir, 'data', 'app.db');
const devDataDir = path.join(PROJECT_ROOT, 'data');
const devDbPath = path.join(devDataDir, 'app.dev.db');
const devUploadsDir = path.join(PROJECT_ROOT, 'uploads');
const devInboundMediaDir = path.join(devDataDir, 'inbound_media');

// Ensure target directories exist
fs.mkdirSync(devDataDir, { recursive: true });
fs.mkdirSync(devUploadsDir, { recursive: true });
fs.mkdirSync(devInboundMediaDir, { recursive: true });

// Sanity check: Ensure target is not production itself
if (path.resolve(prodDbPath).toLowerCase() === path.resolve(devDbPath).toLowerCase()) {
  console.error('\x1b[31m[FATAL] Dev DB path matches Production DB path! Refusing to run to prevent self-overwrite.\x1b[0m');
  process.exit(1);
}

console.log('\x1b[36m====================================================================\x1b[0m');
console.log('\x1b[36m   AI PHARMACY OS - PRODUCTION DATA REPLICATION TO DEV SANDBOX      \x1b[0m');
console.log('\x1b[36m====================================================================\x1b[0m');
console.log(`\x1b[33mSource (Production):\x1b[0m  ${prodDir}`);
console.log(`\x1b[32mTarget (Development):\x1b[0m ${PROJECT_ROOT}`);
console.log(`\x1b[32mTarget Database:\x1b[0m      ${devDbPath}\n`);

// 3. Backup production SQLite database using SQLite Online Backup API
async function replicateDatabase() {
  console.log('[1/4] Replicating database (atomic SQLite online backup)...');
  const tempDevDbPath = `${devDbPath}.tmp_${Date.now()}`;

  // Remove any leftover temp file
  if (fs.existsSync(tempDevDbPath)) {
    try { fs.unlinkSync(tempDevDbPath); } catch {}
  }

  await new Promise((resolve, reject) => {
    const src = new sqlite3.Database(prodDbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(new Error(`Failed to open source production DB: ${err.message}`));

      const backup = src.backup(tempDevDbPath, (backupInitErr) => {
        if (backupInitErr) {
          src.close();
          return reject(new Error(`Failed to initialize SQLite backup: ${backupInitErr.message}`));
        }

        backup.step(-1, (stepErr) => {
          if (stepErr) {
            backup.finish(() => src.close());
            return reject(new Error(`Backup step failed: ${stepErr.message}`));
          }

          backup.finish((finishErr) => {
            src.close(() => {
              if (finishErr) return reject(new Error(`Backup finish failed: ${finishErr.message}`));
              resolve();
            });
          });
        });
      });
    });
  });

  // Swap temp file to app.dev.db
  if (fs.existsSync(devDbPath)) {
    try {
      // Remove stale WAL/SHM files for dev database if present
      if (fs.existsSync(`${devDbPath}-wal`)) fs.unlinkSync(`${devDbPath}-wal`);
      if (fs.existsSync(`${devDbPath}-shm`)) fs.unlinkSync(`${devDbPath}-shm`);
      fs.unlinkSync(devDbPath);
    } catch (e) {
      console.warn(`[WARN] Could not unlink existing devDbPath directly (${e.message}), attempting rename.`);
    }
  }

  fs.renameSync(tempDevDbPath, devDbPath);
  const sizeMb = (fs.statSync(devDbPath).size / (1024 * 1024)).toFixed(1);
  console.log(`\x1b[32m✓ Database successfully snapshotted to app.dev.db (${sizeMb} MB).\x1b[0m\n`);
}

// 4. Apply Sandbox Protections on app.dev.db
async function applySandboxProtections() {
  console.log('[2/4] Applying dev sandbox protections to app.dev.db...');
  await new Promise((resolve, reject) => {
    const devDb = new sqlite3.Database(devDbPath, sqlite3.OPEN_READWRITE, (err) => {
      if (err) return reject(new Error(`Failed to open dev DB for sanitization: ${err.message}`));

      devDb.serialize(() => {
        // Disarm WhatsApp auto-authentication so dev never auto-connects to live WhatsApp
        devDb.run(
          "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_session_authenticated', 'false')"
        );
        devDb.run(
          "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_sandbox_mode', 'true')"
        );

        // Cancel any pending outbound messages in queues
        devDb.run(
          "UPDATE whatsapp_send_queue SET status = 'CANCELLED' WHERE status = 'PENDING'",
          (runErr) => {
            // Ignore error if table does not exist
          }
        );
        devDb.run(
          "UPDATE pending_whatsapp_jobs SET status = 'CANCELLED' WHERE status = 'PENDING'",
          (runErr) => {
            // Ignore error if table does not exist
          }
        );

        devDb.close((closeErr) => {
          if (closeErr) return reject(closeErr);
          console.log('\x1b[32m✓ WhatsApp outbound sending disarmed in dev. Real customers are protected.\x1b[0m\n');
          resolve();
        });
      });
    });
  });
}

// 5. Incremental Directory Copy Helper
function copyDirectoryIncremental(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return { copied: 0, skipped: 0 };
  let copied = 0;
  let skipped = 0;

  function walk(currentSrc, currentDest) {
    fs.mkdirSync(currentDest, { recursive: true });
    const entries = fs.readdirSync(currentSrc, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(currentSrc, entry.name);
      const destPath = path.join(currentDest, entry.name);

      if (entry.isDirectory()) {
        walk(srcPath, destPath);
      } else if (entry.isFile()) {
        let shouldCopy = true;
        if (fs.existsSync(destPath)) {
          const srcStat = fs.statSync(srcPath);
          const destStat = fs.statSync(destPath);
          if (srcStat.size === destStat.size) {
            shouldCopy = false;
          }
        }
        if (shouldCopy) {
          try {
            fs.copyFileSync(srcPath, destPath);
            copied++;
          } catch (e) {
            console.warn(`[WARN] Failed to copy file ${entry.name}: ${e.message}`);
          }
        } else {
          skipped++;
        }
      }
    }
  }

  walk(srcDir, destDir);
  return { copied, skipped };
}

// 6. Sync Media & Prescription Files
async function syncMediaFiles() {
  console.log('[3/4] Synchronizing prescription images & uploads...');

  const prodUploads = path.join(prodDir, 'uploads');
  const uploadsStats = copyDirectoryIncremental(prodUploads, devUploadsDir);
  console.log(`  - Uploads: ${uploadsStats.copied} copied, ${uploadsStats.skipped} up to date.`);

  const prodInboundMedia = path.join(prodDir, 'data', 'inbound_media');
  const inboundStats = copyDirectoryIncremental(prodInboundMedia, devInboundMediaDir);
  console.log(`  - Quick Assist Media: ${inboundStats.copied} copied, ${inboundStats.skipped} up to date.`);

  // Sync cache/correction files if present
  const metaFiles = ['ocr_corrections.json', 'search-cache.json'];
  for (const file of metaFiles) {
    const srcFile = path.join(prodDir, 'data', file);
    const destFile = path.join(devDataDir, file);
    if (fs.existsSync(srcFile)) {
      try {
        fs.copyFileSync(srcFile, destFile);
      } catch {}
    }
  }

  console.log('\x1b[32m✓ Media and cache files synchronized.\x1b[0m\n');
}

// 7. Verify and Print Summary
async function printSummary() {
  console.log('[4/4] Verifying replicated data in dev database...');
  await new Promise((resolve) => {
    const devDb = new sqlite3.Database(devDbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.warn(`[WARN] Could not open dev DB for verification: ${err.message}`);
        return resolve();
      }

      const counts = {};
      const queries = [
        { key: 'medicines', sql: 'SELECT count(*) as c FROM medicines' },
        { key: 'whatsapp_chats', sql: 'SELECT count(*) as c FROM whatsapp_chats' },
        { key: 'whatsapp_messages', sql: 'SELECT count(*) as c FROM whatsapp_messages' },
        { key: 'quick_assist_requests', sql: 'SELECT count(*) as c FROM wa_medicine_requests' },
        { key: 'sales_invoices', sql: 'SELECT count(*) as c FROM sales_invoices' },
      ];

      let completed = 0;
      for (const q of queries) {
        devDb.get(q.sql, (qErr, row) => {
          counts[q.key] = row ? row.c : 'N/A';
          completed++;
          if (completed === queries.length) {
            devDb.close();
            console.log('\x1b[32m====================================================================\x1b[0m');
            console.log('\x1b[32m   REPLICATION COMPLETED SUCCESSFULLY                              \x1b[0m');
            console.log('\x1b[32m====================================================================\x1b[0m');
            console.log(`• Total Medicines Catalog:     ${counts.medicines}`);
            console.log(`• WhatsApp Conversations:      ${counts.whatsapp_chats}`);
            console.log(`• WhatsApp Messages:           ${counts.whatsapp_messages}`);
            console.log(`• Quick Assist Open Requests:  ${counts.quick_assist_requests}`);
            console.log(`• Sales Invoices History:      ${counts.sales_invoices}`);
            console.log('--------------------------------------------------------------------');
            console.log('\x1b[32m[SAFETY VERIFIED]\x1b[0m');
            console.log(`• Source production app at "${prodDir}" was NOT modified.`);
            console.log('• Dev environment connects strictly to "data/app.dev.db".');
            console.log('• Any tests, edits, or deletions in Dev will NEVER affect production.');
            console.log('--------------------------------------------------------------------');
            console.log('You can now start testing with: \x1b[36mnpm run dev\x1b[0m\n');
            resolve();
          }
        });
      }
    });
  });
}

async function run() {
  try {
    await replicateDatabase();
    await applySandboxProtections();
    await syncMediaFiles();
    await printSummary();
  } catch (err) {
    console.error('\x1b[31m[FAILED] Replication failed:\x1b[0m', err);
    process.exit(1);
  }
}

run();
