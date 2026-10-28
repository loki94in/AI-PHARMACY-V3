import { detectPackSize, evaluatePackSize, normalizeUnit } from '../frontend/src/utils/packSizeDetector';

describe('Pack-Size Detector & Validation Utility', () => {
  describe('detectPackSize', () => {
    it('detects explicit "STRIP OF 15" format with high confidence', () => {
      const res = detectPackSize('TELMA 40 STRIP OF 15 TABLETS', 'STRIP OF 15 TAB');
      expect(res.confidence).toBe('HIGH');
      expect(res.detectedPackSize).toBe(15);
      expect(res.detectedUnit).toBe('TAB');
    });

    it('detects explicit "14 TAB" format with high confidence', () => {
      const res = detectPackSize('AUGMENTIN 625 DUO 14 TAB', '14 TAB');
      expect(res.confidence).toBe('HIGH');
      expect(res.detectedPackSize).toBe(14);
      expect(res.detectedUnit).toBe('TAB');
    });

    it('detects explicit "20 CAP" format with high confidence', () => {
      const res = detectPackSize('BECOSULES 20 CAP', '20 CAP');
      expect(res.confidence).toBe('HIGH');
      expect(res.detectedPackSize).toBe(20);
      expect(res.detectedUnit).toBe('CAP');
    });

    it('detects explicit "\'S" suffix format e.g. 15\'S', () => {
      const res = detectPackSize('PAN 40 15\'S', '15\'S');
      expect(res.confidence).toBe('HIGH');
      expect(res.detectedPackSize).toBe(15);
    });

    it('does NOT infer pack size from standalone dosage strengths like 650mg, 625, 40', () => {
      const dolo = detectPackSize('DOLO 650MG TAB', 'TAB');
      expect(dolo.detectedPackSize).toBeNull();
      expect(dolo.confidence).not.toBe('HIGH');

      const aug = detectPackSize('AUGMENTIN 625 DUO', '');
      expect(aug.detectedPackSize).toBeNull();
      expect(aug.confidence).toBe('AMBIGUOUS');

      const telma = detectPackSize('TELMA 40', '');
      expect(telma.detectedPackSize).toBeNull();
      expect(telma.confidence).toBe('AMBIGUOUS');
    });

    it('does NOT infer dimensions like 15 x 8 cm as pack sizes', () => {
      const pad = detectPackSize('PRIMAPORE DRESSING PAD 15 X 8 CM', '1 NO\'S');
      expect(pad.detectedPackSize).not.toBe(15);
      expect(pad.detectedPackSize).not.toBe(120);
    });

    it('identifies liquids, syrups, and drops as pack size 1 with appropriate unit', () => {
      const syp = detectPackSize('CALPOL 250MG SUSPENSION 60ML', '60 ML');
      expect(syp.confidence).toBe('HIGH');
      expect(syp.detectedPackSize).toBe(1);
      expect(syp.detectedUnit).toBe('BOTTLE');
    });
  });

  describe('evaluatePackSize & Mismatch Detection', () => {
    it('flags mismatch when name says 15 tablets but saved pack size is 10', () => {
      const evaluation = evaluatePackSize({
        name: 'TELMA 40 STRIP OF 15 TABLETS',
        packaging: 'STRIP OF 15 TAB',
        savedPackSize: 10,
        savedUnit: 'TAB',
        mrp: 150
      });

      expect(evaluation.hasMismatch).toBe(true);
      expect(evaluation.savedPackSize).toBe(10);
      expect(evaluation.detectedPackSize).toBe(15);
      expect(evaluation.calculatedSavedUnitPrice).toBe(15.00); // 150 / 10
      expect(evaluation.calculatedDetectedUnitPrice).toBe(10.00); // 150 / 15
      expect(evaluation.message).toContain('Saved pack size (10 TAB) conflicts with detected packaging (15 TAB)');
    });

    it('reports no mismatch when saved pack size matches detected pack size', () => {
      const evaluation = evaluatePackSize({
        name: 'PAN 40 STRIP OF 15 TABLETS',
        packaging: 'STRIP OF 15 TAB',
        savedPackSize: 15,
        savedUnit: 'TAB',
        mrp: 150
      });

      expect(evaluation.hasMismatch).toBe(false);
      expect(evaluation.savedPackSize).toBe(15);
      expect(evaluation.detectedPackSize).toBe(15);
    });

    it('does not produce false mismatch warnings for pure strength numbers', () => {
      const evaluation = evaluatePackSize({
        name: 'DOLO 650MG TAB',
        packaging: '10 TAB',
        savedPackSize: 10,
        savedUnit: 'TAB',
        mrp: 30
      });

      // 10 TAB in packaging matches saved 10 TAB
      expect(evaluation.hasMismatch).toBe(false);
      expect(evaluation.detectedPackSize).toBe(10);
      expect(evaluation.calculatedSavedUnitPrice).toBe(3.00);
    });
  });
});
