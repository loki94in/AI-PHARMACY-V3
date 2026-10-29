/**
 * Regression Tests for Local-Only llama.cpp Structured Intent Parser & Shadow Classifier
 * Spec: Qwen3-1.7B Q4_K_M structured parser, field bounds, bypass guards, and missing-asset fallback.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import {
  parseStructuredIntent,
  normalizeIntent,
  normalizeConfidence,
  normalizeMedicineItem,
  MAX_MEDICINE_ITEMS,
  MAX_NAME_LENGTH,
  MAX_UNIT_LENGTH,
  MAX_EXPLANATION_LENGTH,
  MIN_QUANTITY,
  MAX_QUANTITY
} from '../src/services/localAi/structuredIntentParser.js';
import {
  evaluateShadowEligibility,
  runShadowClassification,
  clearRecentShadowClassifications,
  getRecentShadowClassifications
} from '../src/services/localAi/shadowIntentClassifier.js';
import {
  validateLocalAiAssets,
  assertLocalAiAssetsPresent
} from '../src/services/localAi/localAiAssetValidator.js';
import { queryLocalAiIntent } from '../src/services/localAi/llamaServerClient.js';

describe('Local AI Structured Intent Parser & Shadow Classifier', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearRecentShadowClassifications();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // =========================================================================
  // 1. Invalid Model Output Regression Tests
  // =========================================================================
  describe('Invalid Model Output Handling', () => {
    test('handles empty, null, or whitespace-only model output without throwing', () => {
      const resultEmpty = parseStructuredIntent('');
      expect(resultEmpty.intent).toBe('UNKNOWN');
      expect(resultEmpty.confidence).toBe(0.0);
      expect(resultEmpty.medicines).toEqual([]);

      const resultNull = parseStructuredIntent(null as any);
      expect(resultNull.intent).toBe('UNKNOWN');

      const resultWhitespace = parseStructuredIntent('   \n\t  ');
      expect(resultWhitespace.intent).toBe('UNKNOWN');
    });

    test('handles non-JSON conversational text safely', () => {
      const conversational = 'I am an AI assistant. I can help you with your medicine order.';
      const result = parseStructuredIntent(conversational);
      expect(result.intent).toBe('UNKNOWN');
      expect(result.confidence).toBe(0.0);
      expect(result.medicines).toEqual([]);
      expect(result.explanation).toContain('Fallback: No JSON object found');
    });

    test('extracts and parses JSON wrapped in markdown code blocks', () => {
      const markdownJson = '```json\n{\n  "intent": "ORDER",\n  "confidence": 0.95,\n  "medicines": [\n    {"name": "Paracetamol 500", "quantity": 2, "unit": "strip"}\n  ],\n  "explanation": "Customer wants 2 strips of Paracetamol"\n}\n```';
      const result = parseStructuredIntent(markdownJson);
      expect(result.intent).toBe('ORDER');
      expect(result.confidence).toBe(0.95);
      expect(result.medicines.length).toBe(1);
      expect(result.medicines[0].name).toBe('Paracetamol 500');
      expect(result.medicines[0].quantity).toBe(2);
      expect(result.medicines[0].unit).toBe('strip');
    });

    test('extracts JSON when surrounded by leading and trailing chatter', () => {
      const mixedText = 'Here is the parsed intent from customer:\n{"intent": "INQUIRY", "confidence": 0.8, "medicines": [], "explanation": "Asking for store hours"}\nHope this helps!';
      const result = parseStructuredIntent(mixedText);
      expect(result.intent).toBe('INQUIRY');
      expect(result.confidence).toBe(0.8);
      expect(result.explanation).toBe('Asking for store hours');
    });

    test('handles corrupted / unclosed JSON safely', () => {
      const brokenJson = '{"intent": "ORDER", "medicines": [{"name": "Amoxicillin", "quantity": 1';
      const result = parseStructuredIntent(brokenJson);
      expect(result.intent).toBe('UNKNOWN');
      expect(result.confidence).toBe(0.0);
      expect(result.explanation).toContain('Fallback: JSON parse failed');
    });

    test('handles JSON root as array or primitive instead of object', () => {
      const arrayJson = '[{"intent": "ORDER"}]';
      const result = parseStructuredIntent(arrayJson);
      expect(result.intent).toBe('UNKNOWN');
      expect(result.confidence).toBe(0.0);
      expect(result.explanation).toContain('Fallback: JSON root is not an object');
    });
  });

  // =========================================================================
  // 2. Bounded Fields Regression Tests
  // =========================================================================
  describe('Bounded Fields Enforcement', () => {
    test('intent normalization bounds unknown values to UNKNOWN', () => {
      expect(normalizeIntent('ORDER')).toBe('ORDER');
      expect(normalizeIntent('order')).toBe('ORDER');
      expect(normalizeIntent('REFILL')).toBe('REFILL');
      expect(normalizeIntent('INQUIRY')).toBe('INQUIRY');
      expect(normalizeIntent('CHITCHAT')).toBe('CHITCHAT');
      expect(normalizeIntent('GREETING')).toBe('CHITCHAT');
      expect(normalizeIntent('BUY')).toBe('ORDER');
      expect(normalizeIntent('RANDOM_HALLUCINATION')).toBe('UNKNOWN');
      expect(normalizeIntent(12345)).toBe('UNKNOWN');
      expect(normalizeIntent(null)).toBe('UNKNOWN');
    });

    test('confidence is strictly clamped to [0.0, 1.0]', () => {
      expect(normalizeConfidence(0.85)).toBe(0.85);
      expect(normalizeConfidence(-0.5)).toBe(0.0);
      expect(normalizeConfidence(1.7)).toBe(1.0);
      expect(normalizeConfidence(85)).toBe(0.85); // 1-100 percentage conversion
      expect(normalizeConfidence(150)).toBe(1.0);
      expect(normalizeConfidence(NaN)).toBe(0.0);
      expect(normalizeConfidence('0.92')).toBe(0.92);
      expect(normalizeConfidence('invalid')).toBe(0.0);
    });

    test('quantity is clamped between MIN_QUANTITY (1) and MAX_QUANTITY (100)', () => {
      const itemHigh = normalizeMedicineItem({ name: 'Dolo 650', quantity: 999999 });
      expect(itemHigh?.quantity).toBe(MAX_QUANTITY);

      const itemNegative = normalizeMedicineItem({ name: 'Dolo 650', quantity: -10 });
      expect(itemNegative?.quantity).toBe(MIN_QUANTITY);

      const itemZero = normalizeMedicineItem({ name: 'Dolo 650', quantity: 0 });
      expect(itemZero?.quantity).toBe(MIN_QUANTITY);

      const itemFloat = normalizeMedicineItem({ name: 'Dolo 650', quantity: 3.8 });
      expect(itemFloat?.quantity).toBe(3);

      const itemString = normalizeMedicineItem({ name: 'Dolo 650', quantity: '5' });
      expect(itemString?.quantity).toBe(5);

      const itemMissing = normalizeMedicineItem({ name: 'Dolo 650' });
      expect(itemMissing?.quantity).toBe(1);
    });

    test('medicines array length is bounded to MAX_MEDICINE_ITEMS (5)', () => {
      const manyItems = {
        intent: 'ORDER',
        confidence: 0.9,
        medicines: [
          { name: 'Med 1', quantity: 1 },
          { name: 'Med 2', quantity: 1 },
          { name: 'Med 3', quantity: 1 },
          { name: 'Med 4', quantity: 1 },
          { name: 'Med 5', quantity: 1 },
          { name: 'Med 6', quantity: 1 },
          { name: 'Med 7', quantity: 1 }
        ]
      };
      const result = parseStructuredIntent(JSON.stringify(manyItems));
      expect(result.medicines.length).toBe(MAX_MEDICINE_ITEMS);
      expect(result.medicines.map(m => m.name)).toEqual(['Med 1', 'Med 2', 'Med 3', 'Med 4', 'Med 5']);
    });

    test('name, unit, and explanation strings are bounded and sanitized', () => {
      const longName = 'A'.repeat(200);
      const longUnit = 'U'.repeat(50);
      const longExplanation = 'E'.repeat(400);

      const payload = {
        intent: 'ORDER',
        medicines: [
          { name: `<b>${longName}</b>`, quantity: 2, unit: longUnit }
        ],
        explanation: `<script>${longExplanation}</script>`
      };

      const result = parseStructuredIntent(JSON.stringify(payload));
      expect(result.medicines[0].name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(result.medicines[0].name).not.toContain('<b>');
      expect(result.medicines[0].unit.length).toBeLessThanOrEqual(MAX_UNIT_LENGTH);
      expect(result.explanation.length).toBeLessThanOrEqual(MAX_EXPLANATION_LENGTH);
      expect(result.explanation).not.toContain('<script>');
    });
  });

  // =========================================================================
  // 3. Confirmation, Media, and Repeat Bypass Regression Tests
  // =========================================================================
  describe('Bypass Rules (Confirmation / Media / Repeat)', () => {
    beforeEach(() => {
      process.env.LOCAL_AI_ENABLED = 'true';
    });

    test('bypasses when LOCAL_AI_ENABLED is not true', () => {
      process.env.LOCAL_AI_ENABLED = 'false';
      const decision = evaluateShadowEligibility({ body: 'ambiguous text', hasMedia: false });
      expect(decision.shouldRun).toBe(false);
      expect(decision.reason).toBe('LOCAL_AI_DISABLED');
    });

    test('bypasses media messages (photos, prescriptions, audio)', () => {
      const decision = evaluateShadowEligibility({
        body: 'please check prescription',
        hasMedia: true
      });
      expect(decision.shouldRun).toBe(false);
      expect(decision.reason).toBe('MEDIA_BYPASS');
    });

    test('bypasses confirmation and clarification replies', () => {
      const confirmations = ['YES', 'yes', 'haan', 'ha ji', 'NO', 'cancel', 'nhi', 'ok', 'okay'];
      for (const phrase of confirmations) {
        const decision = evaluateShadowEligibility({
          body: phrase,
          hasMedia: false
        });
        expect(decision.shouldRun).toBe(false);
        expect(decision.reason).toBe('CONFIRMATION_BYPASS');
      }

      // Explicit flag bypass
      const explicitDecision = evaluateShadowEligibility({
        body: 'custom confirmation',
        hasMedia: false,
        isConfirmation: true
      });
      expect(explicitDecision.shouldRun).toBe(false);
      expect(explicitDecision.reason).toBe('CONFIRMATION_BYPASS');
    });

    test('bypasses repeat and refill requests', () => {
      const repeatPhrases = ['same', 'same medicine', 'wahi dawai', 'repeat order', 'refill my prescription'];
      for (const phrase of repeatPhrases) {
        const decision = evaluateShadowEligibility({
          body: phrase,
          hasMedia: false
        });
        expect(decision.shouldRun).toBe(false);
        expect(decision.reason).toBe('REPEAT_BYPASS');
      }

      // Explicit flag bypass
      const explicitRepeat = evaluateShadowEligibility({
        body: 'custom repeat',
        hasMedia: false,
        isRepeat: true
      });
      expect(explicitRepeat.shouldRun).toBe(false);
      expect(explicitRepeat.reason).toBe('REPEAT_BYPASS');
    });

    test('bypasses explicit medicine ID lookups', () => {
      const idLookups = ['#4512', 'med 4512', 'order 1234', 'id #789'];
      for (const phrase of idLookups) {
        const decision = evaluateShadowEligibility({
          body: phrase,
          hasMedia: false
        });
        expect(decision.shouldRun).toBe(false);
        expect(decision.reason).toBe('EXPLICIT_ID_BYPASS');
      }
    });

    test('allows ambiguous customer text when enabled and not bypassed', () => {
      const decision = evaluateShadowEligibility({
        body: 'can you send me that tablet for headache?',
        hasMedia: false
      });
      expect(decision.shouldRun).toBe(true);
      expect(decision.reason).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. Missing-Asset Fallback Regression Tests
  // =========================================================================
  describe('Missing-Asset Fallback & Offline Layout Validation', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-test-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    });

    test('validates missing directory gracefully', () => {
      const nonExistentDir = path.join(tempDir, 'does-not-exist');
      const verification = validateLocalAiAssets(nonExistentDir);
      expect(verification.valid).toBe(false);
      expect(verification.missing.length).toBeGreaterThan(0);
      expect(verification.missing[0]).toContain('Directory does not exist');
    });

    test('reports missing runtime, model, license, and metadata when dir is empty', () => {
      const verification = validateLocalAiAssets(tempDir);
      expect(verification.valid).toBe(false);
      expect(verification.missing.some(m => m.includes('Runtime executable'))).toBe(true);
      expect(verification.missing.some(m => m.includes('Model file'))).toBe(true);
      expect(verification.missing.some(m => m.includes('License notice'))).toBe(true);
      expect(verification.missing.some(m => m.includes('Metadata'))).toBe(true);
    });

    test('validates successfully when all 4 offline assets are provisioned', () => {
      fs.writeFileSync(path.join(tempDir, 'llama-server.exe'), 'dummy-exe');
      fs.writeFileSync(path.join(tempDir, 'qwen3-1.7b-q4_k_m.gguf'), 'dummy-model');
      fs.writeFileSync(path.join(tempDir, 'LICENSE.txt'), 'Apache 2.0');
      fs.writeFileSync(path.join(tempDir, 'metadata.json'), JSON.stringify({ model: 'Qwen3-1.7B' }));

      const verification = validateLocalAiAssets(tempDir);
      expect(verification.valid).toBe(true);
      expect(verification.missing).toEqual([]);
      expect(verification.details.runtimePresent).toBe(true);
      expect(verification.details.modelPresent).toBe(true);
      expect(verification.details.licensePresent).toBe(true);
      expect(verification.details.metadataPresent).toBe(true);
    });

    test('assertLocalAiAssetsPresent throws descriptive error on missing asset', () => {
      expect(() => assertLocalAiAssetsPresent(tempDir)).toThrow(/Asset verification failed/);
    });

    test('queryLocalAiIntent falls back safely when server is unreachable', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        // Point to an unused random port
        const result = await queryLocalAiIntent('need dolo 650', {
          host: '127.0.0.1',
          port: 59999,
          timeoutMs: 500
        });

        expect(result.intent).toBe('UNKNOWN');
        expect(result.confidence).toBe(0.0);
        expect(result.medicines).toEqual([]);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  // =========================================================================
  // 5. Non-Blocking Shadow Execution & Zero-Business-Action Guarantee
  // =========================================================================
  describe('Non-Blocking Shadow Execution', () => {
    test('shadow classification records audit log without modifying business state', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        process.env.LOCAL_AI_ENABLED = 'true';

        const result = await runShadowClassification(
          {
            phone: '919876543210',
            body: 'is paracetamol available in 500mg?',
            hasMedia: false
          },
          {
            isMedicineRequest: true,
            candidateNames: ['paracetamol']
          }
        );

        expect(result.shouldRun).toBe(true);
        expect(result.phone).toBe('919876543210');
        expect(result.deterministicResult.isMedicineRequest).toBe(true);
        expect(result.deterministicResult.candidateNames).toEqual(['paracetamol']);

        const logs = getRecentShadowClassifications();
        expect(logs.length).toBeGreaterThan(0);
        expect(logs[0].phone).toBe('919876543210');
      } finally {
        warnSpy.mockRestore();
      }
    });

    test('bypassed messages are recorded with explicit bypass reason', async () => {
      process.env.LOCAL_AI_ENABLED = 'true';

      const result = await runShadowClassification(
        {
          phone: '919876543210',
          body: 'YES confirm my order',
          hasMedia: false,
          isConfirmation: true
        },
        {
          isMedicineRequest: false,
          candidateNames: []
        }
      );

      expect(result.shouldRun).toBe(false);
      expect(result.bypassReason).toBe('CONFIRMATION_BYPASS');
      expect(result.shadowModelResult).toBeNull();
    });
  });
});
