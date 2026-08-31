import { rankAndSortMedicines, isSellableMedicine, type SearchableMedicineItem } from '../frontend/src/utils/searchRanker.js';

interface SampleMed extends SearchableMedicineItem {
  id: number;
  name: string;
  mrp: number;
  batch_no: string;
  stock_qty?: number;
  loose_qty?: number;
  expiry_date?: string | null;
}

describe('Smart Medicine Search & Ranking', () => {
  const sampleMedicines: SampleMed[] = [
    { id: 1, name: 'CROCIN DS 12 SUSPENSION', mrp: 45.0, batch_no: 'B101', stock_qty: 10, expiry_date: '2028-12' },
    { id: 2, name: 'CROCIN 650 ADVANCE', mrp: 32.5, batch_no: 'CR99', stock_qty: 5, expiry_date: '2028-12' },
    { id: 3, name: 'CLAVAM 625 TABLET', mrp: 210.0, batch_no: 'CV101', stock_qty: 15, expiry_date: '2028-12' },
    { id: 4, name: 'AMOXYCLAV 625 TABLET', mrp: 180.0, batch_no: 'AM625', stock_qty: 20, expiry_date: '2028-12' },
    { id: 5, name: 'MOKIKEM 625 INJECTION', mrp: 195.0, batch_no: 'MK625', stock_qty: 8, expiry_date: '2028-12' },
    { id: 6, name: 'DOLO 650 TABLET', mrp: 30.5, batch_no: 'D2401', stock_qty: 12, expiry_date: '2028-12' },
    { id: 7, name: 'AUGMENTIN 625 DUO', mrp: 220.0, batch_no: 'AG625', stock_qty: 0, expiry_date: '2028-12' }, // Sold out
    { id: 8, name: 'PARACETAMOL 650 IP', mrp: 20.0, batch_no: 'PCM650', stock_qty: 10, expiry_date: '2020-01' }, // Expired
  ];

  it('1. Acronym & Shorthand search (e.g. CD 12 -> CROCIN DS 12)', () => {
    const result = rankAndSortMedicines(sampleMedicines, 'CD 12');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('CROCIN DS 12 SUSPENSION');

    const result2 = rankAndSortMedicines(sampleMedicines, 'cd12');
    expect(result2.length).toBeGreaterThan(0);
    expect(result2[0].name).toBe('CROCIN DS 12 SUSPENSION');
  });

  it('2. Strength / Number search (e.g. 625 -> CLAVAM 625, AMOXYCLAV 625, MOKIKEM 625)', () => {
    const result = rankAndSortMedicines(sampleMedicines, '625');
    const names = result.map((r: SampleMed) => r.name);
    expect(names).toContain('CLAVAM 625 TABLET');
    expect(names).toContain('AMOXYCLAV 625 TABLET');
    expect(names).toContain('MOKIKEM 625 INJECTION');
    expect(names).toContain('AUGMENTIN 625 DUO');
  });

  it('3. MRP search (e.g. 30 -> DOLO 650 with MRP 30.5)', () => {
    const result = rankAndSortMedicines(sampleMedicines, '30');
    const names = result.map((r: SampleMed) => r.name);
    expect(names).toContain('DOLO 650 TABLET');
  });

  it('4. Multi-token search (e.g. Dolo 30 -> DOLO 650)', () => {
    const result = rankAndSortMedicines(sampleMedicines, 'Dolo 30');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('DOLO 650 TABLET');
  });

  it('5. Batch search (e.g. D2401 -> DOLO 650)', () => {
    const result = rankAndSortMedicines(sampleMedicines, 'D2401');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('DOLO 650 TABLET');
  });

  it('6. OnlySellable filter automatically skips zero-stock and expired items for POS', () => {
    const sellableResults = rankAndSortMedicines(sampleMedicines, '650', { onlySellable: true });
    const sellableNames = sellableResults.map((r: SampleMed) => r.name);
    
    // Dolo 650 (in stock, not expired) must be included
    expect(sellableNames).toContain('DOLO 650 TABLET');
    expect(sellableNames).toContain('CROCIN 650 ADVANCE');
    
    // Paracetamol 650 (expired) must be automatically skipped
    expect(sellableNames).not.toContain('PARACETAMOL 650 IP');

    // Augmentin 625 (stock = 0) must be skipped when searching 625 with onlySellable: true
    const sellable625 = rankAndSortMedicines(sampleMedicines, '625', { onlySellable: true });
    const names625 = sellable625.map((r: SampleMed) => r.name);
    expect(names625).not.toContain('AUGMENTIN 625 DUO');
    expect(names625).toContain('CLAVAM 625 TABLET');
  });
});
