import { describe, it, expect } from '@jest/globals';

interface SuggestionMedicine {
  medicine_name: string;
  shortName?: string;
  distributor?: string;
  stock?: string | number;
  mapped?: boolean;
  rate?: number;
  cartItemCount?: number;
  cartTotalAmount?: number;
  isErrorMessage?: boolean;
}

// Mirror of the sorting logic in LiveCartAddModal.tsx and QuickOrderModal.tsx
function getStockTier(stockStr: string | undefined | null): number {
  if (!stockStr) return 2;
  const s = String(stockStr).toLowerCase().trim();
  if (s === 'offline') return 1;
  if (s === 'high') return 2;
  if (s === 'low') return 1;
  if (s === '0' || s === 'out of stock' || s === 'nil' || s === 'no stock' || s === 'oos') return 0;
  const num = parseInt(s, 10);
  if (!isNaN(num)) {
    if (num >= 15) return 2;
    if (num > 0) return 1;
    return 0;
  }
  return 2;
}

function sortSuggestions(
  list: SuggestionMedicine[],
  cleanQuery: string,
  lastAddedDistributor: string = ''
): SuggestionMedicine[] {
  const cleanQ = cleanQuery.toLowerCase().trim();
  const lastDist = lastAddedDistributor.toLowerCase().trim();

  return [...list].sort((a, b) => {
    if (a.isErrorMessage || b.isErrorMessage) return 0;

    // 1. Mapped Wall: Mapped ALWAYS before Unmapped (Non-mapped never at top, always at bottom)
    const aMapped = Boolean(a.mapped);
    const bMapped = Boolean(b.mapped);
    if (aMapped !== bMapped) return aMapped ? -1 : 1;

    // 2. Exact title / core query proximity (e.g. "NICIP P" vs "NICIP PLUS")
    const aName = (a.medicine_name || a.shortName || '').toLowerCase().trim();
    const bName = (b.medicine_name || b.shortName || '').toLowerCase().trim();
    const aExact = aName === cleanQ || aName.startsWith(cleanQ + ' ');
    const bExact = bName === cleanQ || bName.startsWith(cleanQ + ' ');
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    // 3. Stock Tier: Green (2) -> Yellow (1) -> Red (0) (High/In-stock ALWAYS above Out-of-Stock)
    const aStock = getStockTier(a.stock !== undefined ? String(a.stock) : undefined);
    const bStock = getStockTier(b.stock !== undefined ? String(b.stock) : undefined);
    if (aStock !== bStock) return bStock - aStock;

    // 4. In Active Live Cart (within the same stock tier)
    const aInCart = Boolean(a.cartItemCount && a.cartItemCount > 0);
    const bInCart = Boolean(b.cartItemCount && b.cartItemCount > 0);
    if (aInCart && !bInCart) return -1;
    if (!aInCart && bInCart) return 1;
    if (aInCart && bInCart) {
      if ((b.cartItemCount || 0) !== (a.cartItemCount || 0)) {
        return (b.cartItemCount || 0) - (a.cartItemCount || 0);
      }
      if ((b.cartTotalAmount || 0) !== (a.cartTotalAmount || 0)) {
        return (b.cartTotalAmount || 0) - (a.cartTotalAmount || 0);
      }
    }

    // 5. Recent distributor boost
    if (lastDist) {
      const aMatch = (a.distributor || '').toLowerCase().includes(lastDist);
      const bMatch = (b.distributor || '').toLowerCase().includes(lastDist);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
    }

    // 6. Effective rate
    if (a.rate && b.rate && a.rate !== b.rate) {
      return a.rate - b.rate;
    }

    return 0;
  });
}

describe('Live Cart Dropdown Sorting Logic', () => {
  it('1. Out-of-stock distributor in cart must NOT rank above high-stock distributor outside cart', () => {
    const suggestions: SuggestionMedicine[] = [
      {
        medicine_name: 'DOLO 650 TABLET',
        distributor: 'Distributor In Cart (Out of Stock)',
        stock: '0',
        mapped: true,
        cartItemCount: 3,
        cartTotalAmount: 1500
      },
      {
        medicine_name: 'DOLO 650 TABLET',
        distributor: 'Distributor Outside Cart (High Stock)',
        stock: 'High',
        mapped: true,
        cartItemCount: 0
      }
    ];

    const sorted = sortSuggestions(suggestions, 'DOLO 650');
    expect(sorted[0].distributor).toBe('Distributor Outside Cart (High Stock)');
    expect(sorted[1].distributor).toBe('Distributor In Cart (Out of Stock)');
  });

  it('2. When both distributors have High Stock, the distributor in active cart MUST rank first', () => {
    const suggestions: SuggestionMedicine[] = [
      {
        medicine_name: 'DOLO 650 TABLET',
        distributor: 'Distributor A (High Stock, Not in Cart)',
        stock: 'High',
        mapped: true,
        cartItemCount: 0
      },
      {
        medicine_name: 'DOLO 650 TABLET',
        distributor: 'Distributor B (High Stock, In Cart)',
        stock: 'High',
        mapped: true,
        cartItemCount: 2,
        cartTotalAmount: 850
      }
    ];

    const sorted = sortSuggestions(suggestions, 'DOLO 650');
    expect(sorted[0].distributor).toBe('Distributor B (High Stock, In Cart)');
    expect(sorted[1].distributor).toBe('Distributor A (High Stock, Not in Cart)');
  });

  it('3. High Stock beats Low Stock even if the Low Stock distributor is in active cart', () => {
    const suggestions: SuggestionMedicine[] = [
      {
        medicine_name: 'PAN D CAPSULE',
        distributor: 'Distributor In Cart (Low Stock: 2 units)',
        stock: '2',
        mapped: true,
        cartItemCount: 5,
        cartTotalAmount: 2400
      },
      {
        medicine_name: 'PAN D CAPSULE',
        distributor: 'Distributor Fresh (High Stock: >=15 units)',
        stock: 'High',
        mapped: true,
        cartItemCount: 0
      }
    ];

    const sorted = sortSuggestions(suggestions, 'PAN D');
    expect(sorted[0].distributor).toBe('Distributor Fresh (High Stock: >=15 units)');
    expect(sorted[1].distributor).toBe('Distributor In Cart (Low Stock: 2 units)');
  });

  it('4. When both distributors have Low Stock, distributor in active cart ranks first', () => {
    const suggestions: SuggestionMedicine[] = [
      {
        medicine_name: 'PAN D CAPSULE',
        distributor: 'Distributor A (Low Stock: 3 units, Not in Cart)',
        stock: '3',
        mapped: true,
        cartItemCount: 0
      },
      {
        medicine_name: 'PAN D CAPSULE',
        distributor: 'Distributor B (Low Stock: 4 units, In Cart)',
        stock: '4',
        mapped: true,
        cartItemCount: 1,
        cartTotalAmount: 300
      }
    ];

    const sorted = sortSuggestions(suggestions, 'PAN D');
    expect(sorted[0].distributor).toBe('Distributor B (Low Stock: 4 units, In Cart)');
    expect(sorted[1].distributor).toBe('Distributor A (Low Stock: 3 units, Not in Cart)');
  });

  it('5. Handles various Out-of-Stock representations (out of stock, nil, no stock, oos, 0)', () => {
    const oosTokens = ['0', 'out of stock', 'nil', 'no stock', 'oos'];
    for (const token of oosTokens) {
      expect(getStockTier(token)).toBe(0);
    }
  });

  it('6. Exact title query matches rank above partial/longer title matches', () => {
    const suggestions: SuggestionMedicine[] = [
      {
        medicine_name: 'NICIP PLUS TABLET',
        distributor: 'Distributor A',
        stock: 'High',
        mapped: true,
        cartItemCount: 2
      },
      {
        medicine_name: 'NICIP P TABLET',
        distributor: 'Distributor B',
        stock: 'High',
        mapped: true,
        cartItemCount: 0
      }
    ];

    const sorted = sortSuggestions(suggestions, 'NICIP P');
    expect(sorted[0].medicine_name).toBe('NICIP P TABLET');
    expect(sorted[1].medicine_name).toBe('NICIP PLUS TABLET');
  });

  it('7. Non-mapped distributor with High Stock must NEVER rank above Mapped distributor (even if mapped has low or out of stock)', () => {
    const suggestions: SuggestionMedicine[] = [
      {
        medicine_name: 'AZITHRAL 500 TABLET',
        distributor: 'Unmapped Distributor (High Stock)',
        stock: 'High',
        mapped: false,
        cartItemCount: 0
      },
      {
        medicine_name: 'AZITHRAL 500 TABLET',
        distributor: 'Mapped Distributor (Low Stock: 2 units)',
        stock: '2',
        mapped: true,
        cartItemCount: 0
      },
      {
        medicine_name: 'AZITHRAL 500 TABLET',
        distributor: 'Mapped Distributor (Out of Stock)',
        stock: '0',
        mapped: true,
        cartItemCount: 0
      }
    ];

    const sorted = sortSuggestions(suggestions, 'AZITHRAL 500');
    // Mapped with low stock is first
    expect(sorted[0].distributor).toBe('Mapped Distributor (Low Stock: 2 units)');
    // Mapped out of stock is second
    expect(sorted[1].distributor).toBe('Mapped Distributor (Out of Stock)');
    // Unmapped is strictly at the bottom
    expect(sorted[2].distributor).toBe('Unmapped Distributor (High Stock)');
  });

  it('8. Non-mapped distributor with exact name match must NEVER rank above Mapped distributor', () => {
    const suggestions: SuggestionMedicine[] = [
      {
        medicine_name: 'DOLO 650 TABLET',
        distributor: 'Unmapped Distributor (Exact Title Match)',
        stock: 'High',
        mapped: false
      },
      {
        medicine_name: 'DOLO 650 MG TABLET',
        distributor: 'Mapped Distributor (Partial Title)',
        stock: 'High',
        mapped: true
      }
    ];

    const sorted = sortSuggestions(suggestions, 'DOLO 650 TABLET');
    expect(sorted[0].distributor).toBe('Mapped Distributor (Partial Title)');
    expect(sorted[1].distributor).toBe('Unmapped Distributor (Exact Title Match)');
  });

  it('9. When mapped distributors have High Stock, the one already in active cart ranks #1', () => {
    const suggestions: SuggestionMedicine[] = [
      {
        medicine_name: 'TELMA 40 TABLET',
        distributor: 'Mapped Distributor A (Not in cart)',
        stock: 'High',
        mapped: true,
        cartItemCount: 0
      },
      {
        medicine_name: 'TELMA 40 TABLET',
        distributor: 'Mapped Distributor B (In live cart)',
        stock: 'High',
        mapped: true,
        cartItemCount: 4,
        cartTotalAmount: 1800
      },
      {
        medicine_name: 'TELMA 40 TABLET',
        distributor: 'Unmapped Distributor C',
        stock: 'High',
        mapped: false
      }
    ];

    const sorted = sortSuggestions(suggestions, 'TELMA 40');
    expect(sorted[0].distributor).toBe('Mapped Distributor B (In live cart)');
    expect(sorted[1].distributor).toBe('Mapped Distributor A (Not in cart)');
    expect(sorted[2].distributor).toBe('Unmapped Distributor C');
  });
});
