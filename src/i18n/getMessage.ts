import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { getTemplate } from '../database/messageDAO.js';
import messagesData from './messages.json';

const require = createRequire(import.meta.url);

// Load the JSON at module init (static import with dynamic fallback)
let ALL_MESSAGES: Record<string, Record<string, any>> = messagesData as any;
if (!ALL_MESSAGES || Object.keys(ALL_MESSAGES).length === 0) {
  try {
    ALL_MESSAGES = require('./messages.json');
  } catch (_) {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const messagesPath = join(__dirname, 'messages.json');
      if (existsSync(messagesPath)) {
        ALL_MESSAGES = JSON.parse(readFileSync(messagesPath, 'utf8'));
      }
    } catch (err) {
      console.error('[i18n] Failed to load messages.json:', err);
    }
  }
}

/**
 * Fallback defaults for core chatbot messages in case dictionary lookups fail
 */
const BOT_FALLBACK_DEFAULTS: Record<string, string> = {
  'whatsapp.bot.askName': '👋 Hello! Welcome to {{storeName}}.{{hoursNotice}}\n\nBefore we begin, *may I please know your name?*',
  'whatsapp.bot.retryName': 'Could you please tell us your name so we can assist you with your order?',
  'whatsapp.bot.welcomeMenu': '👋 Hello *{{name}}*! Welcome to {{storeName}}.{{hoursNotice}}\n\n*Place your order in simple steps:*\n\n*Step 1:* Choose your order type —\n  1️⃣ Single Medicine\n  2️⃣ Multiple Medicines\n  3️⃣ Refill — Repeat regular prescription\n\n*Reply 1, 2, or 3 to begin.*',
  'whatsapp.bot.orderTypeSinglePrompt': 'Please send the name of the medicine you need (e.g., *Dolo 650*, *Telma 40*).',
  'whatsapp.bot.orderTypeMultiPrompt': 'Please send the list of medicines you need, each on a new line (or send a clear photo of your prescription 📸).',
  'whatsapp.bot.askQuantity': 'How many units of *{{medicine}}* do you need? (e.g. 1, 2, 5)',
  'whatsapp.bot.orderConfirmed': '✅ *Order Confirmed!*\nOrder ID: *{{orderId}}*\nItem: *{{item}}*\nQuantity: *{{quantity}} {{unit}}*\nTotal: *₹{{total}}*\n\nWe are preparing your order. Thank you!\n— {{storeName}}',
  'whatsapp.bot.langSwitched': 'Language preference updated.',
  'whatsapp.bot.cancelled': 'Order cancelled. If you need anything else, feel free to message us anytime!'
};

/**
 * Get a localized string.
 * @param lang   Language code – e.g. 'en', 'hi', 'mr'
 * @param path   Dot‑separated key, e.g. "whatsapp.expiryAlert"
 * @param values Object of placeholder → replacement (e.g. {patientName: 'John'})
 */
export function getMessage(
  lang: string = 'en',
  path: string,
  values: Record<string, string> = {}
): string {
  const targetLang = (lang && typeof lang === 'string') ? lang.toLowerCase() : 'en';

  // 1. Try DB override for target language, then fallback to DB override for 'en'
  let template: string | null = getTemplate(targetLang, path);
  if (template === null && targetLang !== 'en') {
    template = getTemplate('en', path);
  }

  // 2. Fallback to JSON lookup
  if (template === null) {
    const resolveFromJson = (l: string): string | null => {
      if (!ALL_MESSAGES || !ALL_MESSAGES[l]) return null;
      const keys = path.split('.');
      let segment: any = ALL_MESSAGES[l];
      for (const k of keys) {
        if (segment == null) return null;
        segment = segment[k];
      }
      return typeof segment === 'string' ? segment : null;
    };

    // Try requested language first
    template = resolveFromJson(targetLang);

    // If missing in requested language (e.g. 'mr' or 'hi'), fall back to English ('en')
    if (template === null && targetLang !== 'en') {
      template = resolveFromJson('en');
    }
  }

  // 3. Last-resort fallback for conversational bot strings to protect customer UX
  if (template === null) {
    if (BOT_FALLBACK_DEFAULTS[path]) {
      template = BOT_FALLBACK_DEFAULTS[path];
    } else {
      return `[Missing: ${path}]`;
    }
  }

  // Simple {{placeholder}} replacement
  return template.replace(/\{\{(\w+)\}\}/g, (_, placeholder) => {
    return values[placeholder] ?? `{{${placeholder}}}`;
  });
}