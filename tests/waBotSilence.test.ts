import { describe, it, expect, beforeEach } from '@jest/globals';
import Database from 'better-sqlite3';
import {
  registerBotPrompt, isBotSilenced, resetBotStrikes, clearBotSilence, MAX_BOT_PROMPTS,
} from '../src/services/waBotSilence.js';

const PHONE = '9876543210';

function makeDb() {
  const raw = new Database(':memory:');
  raw.exec(`CREATE TABLE whatsapp_messages (id TEXT PRIMARY KEY, chat_id TEXT, body TEXT, from_me INTEGER, timestamp INTEGER)`);
  return {
    raw,
    run: async (sql: string, p: any[] = []) => raw.prepare(sql).run(...p),
    get: async (sql: string, p: any[] = []) => raw.prepare(sql).get(...p),
    all: async (sql: string, p: any[] = []) => raw.prepare(sql).all(...p),
  };
}

function addInbound(db: ReturnType<typeof makeDb>, body: string, n: number) {
  db.raw.prepare(`INSERT INTO whatsapp_messages VALUES (?, ?, ?, 0, ?)`).run(`m${n}`, `91${PHONE}@c.us`, body, n);
}

describe('waBotSilence', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it('allows MAX prompts then silences with no_response for 24h', async () => {
    addInbound(db, 'hello', 1);
    for (let i = 0; i < MAX_BOT_PROMPTS; i++) expect(await registerBotPrompt(db, PHONE)).toBe('send');
    expect(await registerBotPrompt(db, PHONE)).toBe('silenced_no_response');
    expect(await isBotSilenced(db, PHONE)).toBe(true);
  });

  it('silences permanently as promo when recent messages are deals/offers', async () => {
    addInbound(db, 'Mega sale! Flat 20% off on all medicines, coupon code SAVE', 1);
    for (let i = 0; i < MAX_BOT_PROMPTS; i++) await registerBotPrompt(db, PHONE);
    expect(await registerBotPrompt(db, PHONE)).toBe('silenced_promo');
    const row: any = await db.get(`SELECT reason, silenced_until FROM wa_bot_silenced WHERE phone = ?`, [PHONE]);
    expect(row.reason).toBe('promo');
    expect(row.silenced_until).toBeNull();
  });

  it('a valid reply resets the strike count', async () => {
    for (let i = 0; i < MAX_BOT_PROMPTS - 1; i++) await registerBotPrompt(db, PHONE);
    await resetBotStrikes(db, PHONE);
    for (let i = 0; i < MAX_BOT_PROMPTS; i++) expect(await registerBotPrompt(db, PHONE)).toBe('send');
  });

  it('a manual reply clears the silence', async () => {
    for (let i = 0; i <= MAX_BOT_PROMPTS; i++) await registerBotPrompt(db, PHONE);
    expect(await isBotSilenced(db, PHONE)).toBe(true);
    await clearBotSilence(db, PHONE);
    expect(await isBotSilenced(db, PHONE)).toBe(false);
  });

  it('an expired timed silence is lifted', async () => {
    for (let i = 0; i <= MAX_BOT_PROMPTS; i++) await registerBotPrompt(db, PHONE);
    db.raw.prepare(`UPDATE wa_bot_silenced SET silenced_until = datetime('now','-1 minute')`).run();
    expect(await isBotSilenced(db, PHONE)).toBe(false);
  });
});
