import type { CompactInventoryItem } from '../frontend/src/services/api';
import { allocateMedicineBatches, fefoRank } from '../frontend/src/utils/posBatchAllocator';

const makeBatch = (overrides: Partial<CompactInventoryItem>): CompactInventoryItem => ({
  medicine_id: 1140805,
  inventory_id: 1,
  id: 1,
  name: 'NICIP PLUS TABLET',
  medicine_name: 'NICIP PLUS TABLET',
  batch_no: 'B1',
  expiry_date: '01/29',
  mrp: 67.13,
  sell_price: 67.13,
  stock_qty: 10,
  quantity: 10,
  loose_quantity: 0,
  unit_price: 67.13,
  cost_price: 13.5,
  item_code: 'NP01',
  manufacturer: 'CIPLA',
  packaging: "10 NO'S",
  pack_size: 10,
  pack_unit: 'TAB',
  allow_loose_sale: 1,
  ...overrides,
});

describe('POS FEFO Batch Allocator (posBatchAllocator)', () => {
  it('prioritizes near-expiry loose-only batch (CP60085: 4 loose) before newer full-strip batch (STC26334: 15 strips) and splits into 2 rows', () => {
    const inventory: CompactInventoryItem[] = [
      makeBatch({
        inventory_id: 37147,
        id: 37147,
        batch_no: 'STC26334',
        expiry_date: '05/29',
        stock_qty: 15,
        quantity: 15,
        loose_quantity: 0,
      }),
      makeBatch({
        inventory_id: 38023,
        id: 38023,
        batch_no: 'CP60085',
        expiry_date: '01/27',
        stock_qty: 0,
        quantity: 0,
        loose_quantity: 4,
      }),
    ];

    // Even if caller passes stale priorityBatchNo = STC26334 without respectPriorityBatch, FEFO must win
    const rowsFor8 = allocateMedicineBatches({
      medicineId: 1140805,
      medicineName: 'NICIP PLUS TABLET',
      requestedQty: 0,
      requestedLooseQty: 8,
      packSize: 10,
      compactInventory: inventory,
      priorityBatchNo: 'STC26334',
      priorityInventoryId: 37147,
    });

    expect(rowsFor8).toHaveLength(2);
    expect(rowsFor8[0].batch).toBe('CP60085');
    expect(rowsFor8[0].qty).toBe(0);
    expect(rowsFor8[0].looseQty).toBe(4);
    expect(rowsFor8[1].batch).toBe('STC26334');
    expect(rowsFor8[1].qty).toBe(0);
    expect(rowsFor8[1].looseQty).toBe(4);

    // 6 tabs requested -> 4 from CP60085 + 2 from STC26334
    const rowsFor6 = allocateMedicineBatches({
      medicineId: 1140805,
      medicineName: 'NICIP PLUS TABLET',
      requestedQty: 0,
      requestedLooseQty: 6,
      packSize: 10,
      compactInventory: inventory,
    });

    expect(rowsFor6).toHaveLength(2);
    expect(rowsFor6[0].batch).toBe('CP60085');
    expect(rowsFor6[0].looseQty).toBe(4);
    expect(rowsFor6[1].batch).toBe('STC26334');
    expect(rowsFor6[1].looseQty).toBe(2);
  });

  it('handles mixed expiry date formats (YYYY-MM-DD vs MM/YY) correctly in fefoRank and strip allocation', () => {
    // 2028-12-31 is earlier than 05/29 (May 2029), even though '05/29' < '2028-12-31' lexicographically
    expect(fefoRank(0, '2028-12-31', 4) < fefoRank(15, '05/29', 0)).toBe(true);
    expect(fefoRank(4, '12/28', 0) < fefoRank(15, '01/29', 0)).toBe(true);

    const inventory: CompactInventoryItem[] = [
      makeBatch({
        inventory_id: 2,
        id: 2,
        batch_no: 'STC26334',
        expiry_date: '05/29',
        stock_qty: 15,
        quantity: 15,
      }),
      makeBatch({
        inventory_id: 1,
        id: 1,
        batch_no: 'CP60085',
        expiry_date: '2028-12-31',
        stock_qty: 4,
        quantity: 4,
      }),
    ];

    const rows = allocateMedicineBatches({
      medicineId: 1140805,
      medicineName: 'NICIP PLUS TABLET',
      requestedQty: 8,
      requestedLooseQty: 0,
      packSize: 10,
      compactInventory: inventory,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].batch).toBe('CP60085');
    expect(rows[0].qty).toBe(4);
    expect(rows[1].batch).toBe('STC26334');
    expect(rows[1].qty).toBe(4);
  });

  it('splits across batches even when MRPs differ and keeps each batch row at its own MRP/unitPrice', () => {
    const inventory: CompactInventoryItem[] = [
      makeBatch({
        inventory_id: 1,
        id: 1,
        batch_no: 'CP60085',
        expiry_date: '01/27',
        stock_qty: 4,
        quantity: 4,
        mrp: 65.10,
        unit_price: 65.10,
        sell_price: 65.10,
      }),
      makeBatch({
        inventory_id: 2,
        id: 2,
        batch_no: 'STC26334',
        expiry_date: '05/29',
        stock_qty: 15,
        quantity: 15,
        mrp: 67.13,
        unit_price: 67.13,
        sell_price: 67.13,
      }),
    ];

    const rows = allocateMedicineBatches({
      medicineId: 1140805,
      medicineName: 'NICIP PLUS TABLET',
      requestedQty: 8,
      requestedLooseQty: 0,
      packSize: 10,
      fallbackItem: { mrp: 67.13, unitPrice: 67.13 },
      compactInventory: inventory,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].batch).toBe('CP60085');
    expect(rows[0].qty).toBe(4);
    expect(rows[0].mrp).toBe(65.10);
    expect(rows[0].unitPrice).toBe(65.10);
    expect(rows[1].batch).toBe('STC26334');
    expect(rows[1].qty).toBe(4);
    expect(rows[1].mrp).toBe(67.13);
    expect(rows[1].unitPrice).toBe(67.13);
  });

  it('honors priorityBatchNo only when respectPriorityBatch is true (manual Switch Batch / invoice edit)', () => {
    const inventory: CompactInventoryItem[] = [
      makeBatch({
        inventory_id: 1,
        id: 1,
        batch_no: 'CP60085',
        expiry_date: '01/27',
        stock_qty: 4,
        quantity: 4,
      }),
      makeBatch({
        inventory_id: 2,
        id: 2,
        batch_no: 'STC26334',
        expiry_date: '05/29',
        stock_qty: 15,
        quantity: 15,
      }),
    ];

    const rows = allocateMedicineBatches({
      medicineId: 1140805,
      medicineName: 'NICIP PLUS TABLET',
      requestedQty: 8,
      requestedLooseQty: 0,
      packSize: 10,
      compactInventory: inventory,
      priorityBatchNo: 'STC26334',
      priorityInventoryId: 2,
      respectPriorityBatch: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].batch).toBe('STC26334');
    expect(rows[0].qty).toBe(8);
  });

  it('excludes expired batches and notifies when total requested exceeds all active batches', () => {
    const notifications: Array<{ msg: string; type: string }> = [];
    const inventory: CompactInventoryItem[] = [
      makeBatch({
        inventory_id: 9,
        id: 9,
        batch_no: 'EXPIRED1',
        expiry_date: '01/25',
        stock_qty: 10,
        quantity: 10,
      }),
      makeBatch({
        inventory_id: 1,
        id: 1,
        batch_no: 'CP60085',
        expiry_date: '01/27',
        stock_qty: 0,
        quantity: 0,
        loose_quantity: 4,
      }),
      makeBatch({
        inventory_id: 2,
        id: 2,
        batch_no: 'STC26334',
        expiry_date: '05/29',
        stock_qty: 0,
        quantity: 0,
        loose_quantity: 2,
      }),
    ];

    const rows = allocateMedicineBatches({
      medicineId: 1140805,
      medicineName: 'NICIP PLUS TABLET',
      requestedQty: 0,
      requestedLooseQty: 8,
      packSize: 10,
      compactInventory: inventory,
      onNotify: (msg, type) => notifications.push({ msg, type }),
    });

    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.batch)).toEqual(['CP60085', 'STC26334']);
    expect(rows[0].looseQty).toBe(4);
    expect(rows[1].looseQty).toBe(2);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].msg).toContain('6 loose');
  });
});
