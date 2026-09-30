import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

// Bug P0-69: a route that answered after BEGIN without COMMIT/ROLLBACK left the shared
// connection inside that transaction. Later requests' writes joined it and the 60 s watchdog
// rolled them all back (a deleted purchase bill came back). The guard must end such an
// orphan as soon as its request has answered, so other requests' writes are really saved.
describe('Request transaction guard', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-guard-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    const { requestTransactionGuard } = await import('../src/middleware/requestTransactionGuard.js');
    app = express();
    app.use(express.json());
    app.use(requestTransactionGuard);
    // A buggy route: opens a transaction, writes, answers without closing it.
    app.post('/orphan', async (_req, res) => {
      const db = await dbManager.getConnection();
      await db.run('BEGIN TRANSACTION');
      await db.run("INSERT INTO app_settings (key, value) VALUES ('orphan_row', 'x')");
      return res.status(400).json({ error: 'refused' });
    });
    // A correct route: a plain write.
    app.post('/write', async (_req, res) => {
      const db = await dbManager.getConnection();
      await db.run("INSERT INTO app_settings (key, value) VALUES ('good_row', 'y')");
      res.json({ ok: true });
    });
    // A correct transactional route.
    app.post('/tx', async (_req, res) => {
      const db = await dbManager.getConnection();
      await db.run('BEGIN TRANSACTION');
      await db.run("INSERT INTO app_settings (key, value) VALUES ('tx_row', 'z')");
      await db.run('COMMIT');
      res.json({ ok: true });
    });
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('an orphaned transaction is rolled back when its request answers; later writes are kept', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    expect((await request(app).post('/orphan')).status).toBe(400);
    await new Promise(r => setTimeout(r, 50));
    expect(dbManager.getLockStats().isTxLocked).toBe(false);

    expect((await request(app).post('/write')).status).toBe(200);
    expect((await request(app).post('/tx')).status).toBe(200);

    // Read through a separate connection: only committed rows are visible there.
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const other = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const rows = await other.all("SELECT key FROM app_settings WHERE key IN ('orphan_row', 'good_row', 'tx_row') ORDER BY key");
    await other.close();
    expect(rows.map((r: { key: string }) => r.key)).toEqual(['good_row', 'tx_row']);
  });
});
