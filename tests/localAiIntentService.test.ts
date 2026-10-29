import { buildLocalAiPrompt, parseLocalAiResponse } from '../src/services/localAiIntentService.js';

describe('local AI intent response validation', () => {
  test('accepts a valid medicine-order classification', () => {
    expect(parseLocalAiResponse(JSON.stringify({ intent: 'medicine_order', medicineNames: ['Dolo 650'], quantity: 2, unit: 'strip', refersToPreviousMessage: false, needsClarification: false, confidence: 0.91 }))).toEqual({
      intent: 'medicine_order', medicineNames: ['Dolo 650'], quantity: 2, unit: 'strip', refersToPreviousMessage: false, needsClarification: false, confidence: 0.91
    });
  });
  test('rejects unknown intents and malformed JSON', () => {
    expect(parseLocalAiResponse('{"intent":"place_order_now"}')).toBeNull();
    expect(parseLocalAiResponse('not json')).toBeNull();
  });
  test('bounds names, quantity, unit, booleans, and confidence', () => {
    expect(parseLocalAiResponse(JSON.stringify({ intent: 'medicine_order', medicineNames: ['Dolo 650', '', 12, 'x'.repeat(101)], quantity: 999999, unit: 'x'.repeat(31), refersToPreviousMessage: 'yes', needsClarification: 'no', confidence: 5 }))).toEqual({
      intent: 'medicine_order', medicineNames: ['Dolo 650'], quantity: null, unit: null, refersToPreviousMessage: false, needsClarification: true, confidence: 1
    });
  });
  test('does not pass arbitrary model fields through as actions', () => {
    const result = parseLocalAiResponse('{"intent":"chitchat","medicineNames":[],"execute_sql":"DROP TABLE medicines"}');
    expect(result?.intent).toBe('chitchat');
    expect(result).not.toHaveProperty('execute_sql');
  });
  test('uses at most four context messages and warns against invented medicines', () => {
    const prompt = buildLocalAiPrompt('haan', ['one', 'two', 'three', 'four', 'five']);
    expect(prompt).toContain('Current message: haan');
    expect(prompt).toContain('"two"');
    expect(prompt).toContain('"five"');
    expect(prompt).not.toContain('"one"');
    expect(prompt).toContain('Never invent a medicine name');
  });
});

describe('local AI shadow-mode workflow guard', () => {
  const base = { message: 'Do you have azithromycin?', hasMedia: false, affirmative: false, negative: false, repeat: false, enabled: true, mode: 'shadow' };
  test('runs only for ambiguous text when explicitly enabled in shadow mode', async () => {
    const { shouldRunLocalAiShadow } = await import('../src/services/localAiIntentService.js');
    expect(shouldRunLocalAiShadow(base)).toBe(true);
    expect(shouldRunLocalAiShadow({ ...base, enabled: false })).toBe(false);
    expect(shouldRunLocalAiShadow({ ...base, mode: 'off' })).toBe(false);
  });
  test('does not run on recognized medicine, confirmations, rejections, repeats, or media', async () => {
    const { shouldRunLocalAiShadow } = await import('../src/services/localAiIntentService.js');
    expect(shouldRunLocalAiShadow({ ...base, parsedMedicineName: 'Dolo 650' })).toBe(false);
    expect(shouldRunLocalAiShadow({ ...base, affirmative: true })).toBe(false);
    expect(shouldRunLocalAiShadow({ ...base, negative: true })).toBe(false);
    expect(shouldRunLocalAiShadow({ ...base, repeat: true })).toBe(false);
    expect(shouldRunLocalAiShadow({ ...base, hasMedia: true })).toBe(false);
  });
  test('missing bundled assets fail closed without remote fallback', async () => {
    const { classifyWhatsAppIntent } = await import('../src/services/localAiIntentService.js');
    const result = await classifyWhatsAppIntent('Do you have azithromycin?', [], {
      enabled: true, mode: 'shadow', modelPath: '/missing/local-model.gguf', serverPath: '/missing/llama-server'
    });
    expect(result).toBeNull();
  });
});
