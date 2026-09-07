import { jest } from '@jest/globals';

// whatsappIntentService transitively imports the WhatsApp client — mock it out
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve()),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isReady: true, initializing: false, isSyncing: false })),
  isReady: true,
  currentQr: null,
  shouldRouteToBusiness: jest.fn(() => Promise.resolve(false)),
  initClient: jest.fn(() => Promise.resolve()),
  hashMessageBody: (msg: string) => String(msg).slice(0, 16),
  normalizeWhatsAppPhone: (phone: string) => String(phone).replace(/\D/g, ''),
  hasSavedSession: jest.fn(() => true),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  markWhatsAppActivity: jest.fn(),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  isPuppeteerDetachedError: jest.fn(() => false),
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn(),
  destroyClient: jest.fn(() => Promise.resolve(undefined)),
  forceReconnect: jest.fn(() => Promise.resolve(undefined)),
  reconnectClient: jest.fn(() => Promise.resolve(undefined)),
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([])),
  getMessageMedia: jest.fn(() => Promise.resolve({ mimetype: 'image/jpeg', data: '' })),
  downloadMessageMediaById: jest.fn(() => Promise.resolve(undefined)),
  ensureWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  isWhatsAppAutoConnectAllowed: jest.fn(() => Promise.resolve(true))
}));

describe('WhatsApp Intent Confidence Gate', () => {
  let passesGate: any;

  beforeAll(async () => {
    passesGate = (await import('../src/services/whatsappIntentService.js')).passesGate;
  });

  test('bare text with no intent words needs a strong match (0.72)', () => {
    expect(passesGate(0.71, false, 'text')).toBe(false);
    expect(passesGate(0.72, false, 'text')).toBe(true);
  });

  test('intent words lower the bar to 0.60', () => {
    expect(passesGate(0.60, true, 'text')).toBe(true);
    expect(passesGate(0.59, true, 'text')).toBe(false);
  });

  test('photos (OCR) count as strong intent', () => {
    expect(passesGate(0.60, false, 'ocr')).toBe(true);
    expect(passesGate(0.60, false, 'both')).toBe(true);
    expect(passesGate(0.30, false, 'ocr')).toBe(false);
  });

  test('zero score never escalates — the chit-chat case', () => {
    expect(passesGate(0, false, 'text')).toBe(false);
    expect(passesGate(0, true, 'text')).toBe(false);
  });
});

describe('OCR Stage-0 Scan Gate — must never fail open on an empty api_substances dictionary', () => {
  let resolveOcrGateDecision: any;

  beforeAll(async () => {
    resolveOcrGateDecision = (await import('../src/services/whatsappIntentService.js')).resolveOcrGateDecision;
  });

  test('empty dictionary still SKIPS a plausible name with no dose-form/strength signal (e.g. a ticket or bill)', () => {
    const decision = resolveOcrGateDecision('PNR 1234567 Boarding pass seat 22A', 'Azithromycin', new Set());
    expect(decision).toBe('skip');
  });

  test('empty dictionary still IDENTIFIES a real medicine scan carrying a dose-form/strength signal', () => {
    const decision = resolveOcrGateDecision('Azithromycin 500mg tablet strip of 10', 'Azithromycin', new Set());
    expect(decision).toBe('identify');
  });

  test('a populated dictionary can identify purely from a known API name, no dose-form needed', () => {
    const decision = resolveOcrGateDecision('some random label text mentioning azithromycin', 'Azithromycin', new Set(['azithromycin']));
    expect(decision).toBe('identify');
  });
});

describe('Multilingual Two-Way Refill Confirmation Detection', () => {
  let isRefillConfirmationResponse: (text: string) => boolean;

  beforeAll(async () => {
    isRefillConfirmationResponse = (await import('../src/services/intentKeywords.js')).isRefillConfirmationResponse;
  });

  test('English confirmation keywords match correctly', () => {
    expect(isRefillConfirmationResponse('REFILL')).toBe(true);
    expect(isRefillConfirmationResponse('yes')).toBe(true);
    expect(isRefillConfirmationResponse('confirm')).toBe(true);
    expect(isRefillConfirmationResponse('send')).toBe(true);
    expect(isRefillConfirmationResponse('okay')).toBe(true);
    expect(isRefillConfirmationResponse('Yes, please!')).toBe(true);
    expect(isRefillConfirmationResponse('confirmed.')).toBe(true);
  });

  test('Hindi confirmation keywords match correctly', () => {
    expect(isRefillConfirmationResponse('हाँ')).toBe(true);
    expect(isRefillConfirmationResponse('हां')).toBe(true);
    expect(isRefillConfirmationResponse('भेज दो')).toBe(true);
    expect(isRefillConfirmationResponse('दे दो')).toBe(true);
    expect(isRefillConfirmationResponse('दवाई चाहिए')).toBe(true);
  });

  test('Marathi confirmation keywords match correctly', () => {
    expect(isRefillConfirmationResponse('हो')).toBe(true);
    expect(isRefillConfirmationResponse('पाठवा')).toBe(true);
    expect(isRefillConfirmationResponse('द्या')).toBe(true);
    expect(isRefillConfirmationResponse('औषध लागतं')).toBe(true);
  });

  test('Non-confirmation chatter is rejected', () => {
    expect(isRefillConfirmationResponse('')).toBe(false);
    expect(isRefillConfirmationResponse('How much is the total?')).toBe(false);
    expect(isRefillConfirmationResponse('Where is your pharmacy located?')).toBe(false);
  });
});
