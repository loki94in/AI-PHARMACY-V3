import assert from 'node:assert';
import { detectLanguage, detectExplicitLanguageSwitch } from '../src/services/languageDetector.js';
import { getMessage } from '../src/i18n/getMessage.js';

console.log('Testing Marathi & Hindi Language Detection and Chatbot Integration...');

// Language Detection Tests
assert.strictEqual(detectLanguage('नमस्कार, मला औषध पाहिजे'), 'mr', 'Should detect Marathi greeting and request');
assert.strictEqual(detectLanguage('गोळी मिळेल का?'), 'mr', 'Should detect Marathi question');
assert.strictEqual(detectLanguage('हवे आहे औषध'), 'mr', 'Should detect Marathi requirement');

assert.strictEqual(detectLanguage('नमस्ते, मुझे दवा चाहिए'), 'hi', 'Should detect Hindi greeting and request');
assert.strictEqual(detectLanguage('दवाई भेजो भाई'), 'hi', 'Should detect Hindi imperative');
assert.strictEqual(detectLanguage('कितना रुपया हुआ'), 'hi', 'Should detect Hindi pricing inquiry');

assert.strictEqual(detectLanguage('namaskar mala dolo pahije'), 'mr', 'Should detect Romanized Marathi');
assert.strictEqual(detectLanguage('kiti rupaye aushadh'), 'mr', 'Should detect Romanized Marathi');

assert.strictEqual(detectLanguage('namaste dawa bhej do'), 'hi', 'Should detect Romanized Hindi');
assert.strictEqual(detectLanguage('kitna hua bhai'), 'hi', 'Should detect Romanized Hindi');

assert.strictEqual(detectExplicitLanguageSwitch('मराठी'), 'mr', 'Explicit switch to Marathi');
assert.strictEqual(detectExplicitLanguageSwitch('हिंदी'), 'hi', 'Explicit switch to Hindi');
assert.strictEqual(detectExplicitLanguageSwitch('english'), 'en', 'Explicit switch to English');
assert.strictEqual(detectExplicitLanguageSwitch('marathi madhe bola'), 'mr', 'Phrase switch to Marathi');
assert.strictEqual(detectExplicitLanguageSwitch('hindi me baat karo'), 'hi', 'Phrase switch to Hindi');

assert.strictEqual(detectLanguage('1', 'mr'), 'mr', 'Preserve Marathi on numeric input');
assert.strictEqual(detectLanguage('2', 'hi'), 'hi', 'Preserve Hindi on numeric input');
assert.strictEqual(detectLanguage('Dolo 650 1 strip', 'mr'), 'mr', 'Preserve Marathi on medicine name input');

console.log('✔ All Language Detection tests passed!');

// Localized Chatbot Interactive Messages Tests
const langs = ['en', 'hi', 'mr'] as const;

for (const lang of langs) {
  const msg = getMessage(lang, 'whatsapp.bot.askName', { storeName: 'Apollo Medical', hoursNotice: '' });
  assert.ok(msg.includes('Apollo Medical'), `${lang} askName missing storeName`);
  assert.ok(msg.length > 15, `${lang} askName too short`);
}

for (const lang of langs) {
  const msg = getMessage(lang, 'whatsapp.bot.welcomeMenu', {
    name: 'Sachin',
    storeName: 'Apollo Medical',
    hoursNotice: '',
    hoursLine: 'Open: 9 AM - 9 PM'
  });
  assert.ok(msg.includes('Sachin'), `${lang} welcomeMenu missing name`);
  assert.ok(msg.includes('Apollo Medical'), `${lang} welcomeMenu missing storeName`);
  assert.ok(msg.includes('1'), `${lang} welcomeMenu missing option 1`);
  assert.ok(msg.includes('2'), `${lang} welcomeMenu missing option 2`);
  assert.ok(msg.includes('3'), `${lang} welcomeMenu missing option 3`);
}

for (const lang of langs) {
  const single = getMessage(lang, 'whatsapp.bot.orderTypeSinglePrompt');
  const multi = getMessage(lang, 'whatsapp.bot.orderTypeMultiPrompt');
  assert.ok(single.length > 10, `${lang} orderTypeSinglePrompt too short`);
  assert.ok(multi.length > 10, `${lang} orderTypeMultiPrompt too short`);
}

for (const lang of langs) {
  const qty = getMessage(lang, 'whatsapp.bot.askQuantity', { medicine: 'Dolo 650', unit: 'strip' });
  assert.ok(qty.includes('Dolo 650'), `${lang} askQuantity missing medicine`);
  assert.ok(qty.includes('strip'), `${lang} askQuantity missing unit`);
}

for (const lang of langs) {
  const confirmed = getMessage(lang, 'whatsapp.bot.orderConfirmed', {
    orderId: 'ORD-101',
    item: 'Pan D',
    quantity: '2',
    unit: 'strips',
    total: '240',
    storeName: 'Apollo Medical'
  });
  assert.ok(confirmed.includes('ORD-101'), `${lang} orderConfirmed missing orderId`);
  assert.ok(confirmed.includes('Pan D'), `${lang} orderConfirmed missing item`);

  const outOfStock = getMessage(lang, 'whatsapp.bot.outOfStockSpecialOrder', {
    medicine: 'RareMed 10mg',
    eta: 'Today by 6 PM'
  });
  assert.ok(outOfStock.includes('RareMed 10mg'), `${lang} outOfStockSpecialOrder missing medicine`);
}

console.log('✔ All Localized Chatbot Interactive Messages tests passed!');

// Fallback & Resilience Tests
const undefLangMsg = getMessage(undefined as any, 'whatsapp.bot.askName', { storeName: 'Apollo Medical', hoursNotice: '' });
assert.ok(undefLangMsg.includes('Apollo Medical'), 'Undefined lang should fall back to English');
assert.ok(!undefLangMsg.includes('[Missing:'), 'Undefined lang must never output [Missing: ...]');

const fallbackDefault = getMessage('unknown_lang' as any, 'whatsapp.bot.askName', { storeName: 'Apollo Medical', hoursNotice: '' });
assert.ok(fallbackDefault.includes('Apollo Medical'), 'Unknown lang should fall back cleanly');
assert.ok(!fallbackDefault.includes('[Missing:'), 'Unknown lang must never output [Missing: ...]');

console.log('✔ All i18n Fallback & Resilience tests passed!');
console.log('ALL TESTS PASSED SUCCESSFULLY! 🚀');
