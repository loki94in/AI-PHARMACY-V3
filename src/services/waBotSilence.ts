/**
 * Per-number bot silence (circuit breaker for the WhatsApp guided menu).
 *
 * The bot counts every menu / "reply 1-3" prompt it sends to a number. A valid reply
 * (1/2/3 or a real medicine request) resets the count. When a number has been prompted
 * MAX_BOT_PROMPTS times without a valid reply, the bot stops answering it:
 *   - promo / deals / offers in its recent messages -> silenced permanently
 *   - otherwise                                      -> silenced for 24 h (owner is escalated by the caller)
 * Silence only REMOVES automatic replies; it never sends anything. A manual reply from the
 * CRM chat clears it (routes/messaging.ts POST /send).
 */
import { isPromotionalOrBroadcastMessage, MARKETING_NOISE_WORDS } from './intentKeywords.js';

export const MAX_BOT_PROMPTS = 4;
const NO_RESPONSE_SILENCE_HOURS = 24;
const PROMO_WORDS = new Set(['offer', 'offers', 'deal', 'deals', 'discount', 'discounts', 'cashback', 'scheme', 'schemes', 'coupon', 'coupons', 'voucher', 'vouchers', 'bumper', 'dhamaka']);

const last10 = (phone: string): string => (phone || '').replace(/\D/g, '').slice(-10);

export async function ensureBotSilenceTable(db: any): Promise<void> {
  await db.run(`CREATE TABLE IF NOT EXISTS wa_bot_silenced (
    phone TEXT PRIMARY KEY,
    strikes INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    silenced_until TEXT,
    silenced INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
}

/** True while the bot must stay quiet for this number. Expired timed silences are cleared. */
export async function isBotSilenced(db: any, phone: string): Promise<boolean> {
  const p = last10(phone);
  if (p.length < 10) return false;
  await ensureBotSilenceTable(db);
  const row = await db.get(
    `SELECT silenced, silenced_until, (silenced_until IS NOT NULL AND silenced_until <= datetime('now')) AS expired
       FROM wa_bot_silenced WHERE phone = ?`, [p]);
  if (!row || !row.silenced) return false;
  if (row.expired) {
    await db.run(`DELETE FROM wa_bot_silenced WHERE phone = ?`, [p]);
    return false;
  }
  return true;
}

/** Customer made a valid choice / request: forget earlier unanswered prompts. */
export async function resetBotStrikes(db: any, phone: string): Promise<void> {
  const p = last10(phone);
  if (p.length < 10) return;
  await ensureBotSilenceTable(db);
  await db.run(`DELETE FROM wa_bot_silenced WHERE phone = ? AND silenced = 0`, [p]);
}

/** Owner / pharmacist spoke to this number manually: lift any silence. */
export async function clearBotSilence(db: any, phone: string): Promise<void> {
  const p = last10(phone);
  if (p.length < 10) return;
  await ensureBotSilenceTable(db);
  await db.run(`DELETE FROM wa_bot_silenced WHERE phone = ?`, [p]);
}

async function recentInboundLooksPromotional(db: any, p: string): Promise<boolean> {
  let rows: any[] = [];
  try {
    rows = await db.all(
      `SELECT body FROM whatsapp_messages
        WHERE from_me = 0 AND chat_id LIKE ?
        ORDER BY timestamp DESC LIMIT 10`,
      [`%${p}%`]);
  } catch {
    return false; // unknown schema/columns: never guess promo
  }
  return rows.some((r) => {
    const text = String(r?.body || '');
    if (isPromotionalOrBroadcastMessage(text)) return true;
    return text.toLowerCase().split(/[^a-z0-9]+/).some((t) => PROMO_WORDS.has(t) && MARKETING_NOISE_WORDS.has(t));
  });
}

export type PromptDecision = 'send' | 'silenced_promo' | 'silenced_no_response';

/**
 * Call BEFORE sending a menu / "reply 1-3" prompt. 'send' = go ahead (strike recorded);
 * otherwise the number was just silenced and the caller must not send the prompt.
 */
export async function registerBotPrompt(db: any, phone: string): Promise<PromptDecision> {
  const p = last10(phone);
  if (p.length < 10) return 'send';
  await ensureBotSilenceTable(db);
  const row = await db.get(`SELECT strikes FROM wa_bot_silenced WHERE phone = ?`, [p]);
  const strikes = Number(row?.strikes || 0);
  if (strikes >= MAX_BOT_PROMPTS) {
    const promo = await recentInboundLooksPromotional(db, p);
    if (promo) {
      await db.run(
        `INSERT INTO wa_bot_silenced (phone, strikes, reason, silenced_until, silenced, updated_at)
         VALUES (?, ?, 'promo', NULL, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(phone) DO UPDATE SET reason='promo', silenced_until=NULL, silenced=1, updated_at=CURRENT_TIMESTAMP`,
        [p, strikes]);
      return 'silenced_promo';
    }
    await db.run(
      `INSERT INTO wa_bot_silenced (phone, strikes, reason, silenced_until, silenced, updated_at)
       VALUES (?, ?, 'no_response', datetime('now', ?), 1, CURRENT_TIMESTAMP)
       ON CONFLICT(phone) DO UPDATE SET reason='no_response', silenced_until=datetime('now', ?), silenced=1, updated_at=CURRENT_TIMESTAMP`,
      [p, strikes, `+${NO_RESPONSE_SILENCE_HOURS} hours`, `+${NO_RESPONSE_SILENCE_HOURS} hours`]);
    return 'silenced_no_response';
  }
  await db.run(
    `INSERT INTO wa_bot_silenced (phone, strikes, silenced, updated_at) VALUES (?, 1, 0, CURRENT_TIMESTAMP)
     ON CONFLICT(phone) DO UPDATE SET strikes = strikes + 1, updated_at = CURRENT_TIMESTAMP`,
    [p]);
  return 'send';
}
