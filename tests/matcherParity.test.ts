import { describe, it, expect } from '@jest/globals';
import { getCoreMedicineTokens as getBackendTokens, scoreOrderNameMatch } from '../src/utils/orderNameMatcher.js';
import { getCoreMedicineTokens as getFrontendTokens, normalizeToken as normalizeFrontendToken } from '../frontend/src/utils/orderFuzzyMatcher.js';

describe('Matcher Parity and Tokenizer Normalization', () => {
  it('correctly collapses glued strength units in both backend and frontend', () => {
    const backendTokens = getBackendTokens('Telmisartan 40mg Tab 10s');
    const frontendTokens = getFrontendTokens('Telmisartan 40mg Tab 10s');

    expect(backendTokens.has('telmisartan')).toBe(true);
    expect(backendTokens.has('40')).toBe(true);
    expect(backendTokens.has('10s')).toBe(false);

    expect(frontendTokens.has('telmisartan')).toBe(true);
    expect(frontendTokens.has('40')).toBe(true);
    expect(frontendTokens.has('10s')).toBe(false);
  });

  it('preserves strength numbers without stripping them as stop words', () => {
    const backendTokens = getBackendTokens('Atorvastatin 10 mg Tablet');
    const frontendTokens = getFrontendTokens('Atorvastatin 10 mg Tablet');

    expect(backendTokens.has('atorvastatin')).toBe(true);
    expect(backendTokens.has('10')).toBe(true);

    expect(frontendTokens.has('atorvastatin')).toBe(true);
    expect(frontendTokens.has('10')).toBe(true);
  });

  it('scores exact and high-similarity medicine names above threshold (75)', () => {
    const score1 = scoreOrderNameMatch(
      'Dolo 650mg Tab',
      'DOLO 650 TABLET',
      { incomingDistributor: 'Balaji Pharma', orderDistributor: 'Balaji Pharma' }
    );
    expect(score1.score).toBeGreaterThanOrEqual(75);

    const score2 = scoreOrderNameMatch(
      'PAN 40MG TAB',
      'PAN 40 TABLETS',
      { incomingDistributor: 'Medica', orderDistributor: 'Medica' }
    );
    expect(score2.score).toBeGreaterThanOrEqual(75);
  });

  it('rejects completely different medicines regardless of distributor', () => {
    const score = scoreOrderNameMatch(
      'Azithral 500 Tablet',
      'Dolo 650 Tablet',
      { incomingDistributor: 'Balaji Pharma', orderDistributor: 'Balaji Pharma' }
    );
    expect(score.score).toBeLessThan(75);
  });
});
