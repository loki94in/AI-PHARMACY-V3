import { filterLocalInventory, type PosBatchItem } from '../frontend/src/utils/posSearchFilter';

const makeBatch = (overrides: Partial<PosBatchItem>): PosBatchItem => ({
  id: 1,
  inventory_id: 1,
  medicine_id: 9488451,
  name: 'VERTIN 8MG STRIP OF 15 TABLETS',
  medicine_name: 'VERTIN 8MG STRIP OF 15 TABLETS',
  batch_no: 'B1',
  expiry_date: '2029-05-31',
  mrp: 220.35,
  sell_price: 220.35,
  unit_price: 220.35,
  cost_price: 150,
  quantity: 0,
  stock_qty: 0,
  loose_quantity: 0,
  pack_size: 15,
  ...overrides,
});

describe('POS Single-Row Medicine Dropdown Filter (posSearchFilter)', () => {
  it('combines multiple batches of the same medicine with different MRPs, rates, and expiries into one single row', () => {
    const inventory: PosBatchItem[] = [
      makeBatch({
        id: 192144,
        inventory_id: 192144,
        batch_no: 'VEA26009',
        expiry_date: '2029-06-30',
        mrp: 220.89,
        sell_price: 220.89,
        unit_price: 220.89,
        cost_price: 155,
        quantity: 0,
        stock_qty: 0,
        loose_quantity: 3,
      }),
      makeBatch({
        id: 191652,
        inventory_id: 191652,
        batch_no: 'SSM0069',
        expiry_date: '2029-05-31',
        mrp: 220.35,
        sell_price: 215.0,
        unit_price: 215.0,
        cost_price: 148,
        quantity: 0,
        stock_qty: 0,
        loose_quantity: 7,
      }),
    ];

    const results = filterLocalInventory('vertin', inventory);
    expect(results).toHaveLength(1);
    expect(results[0].medicine_name).toBe('VERTIN 8MG STRIP OF 15 TABLETS');
    expect(results[0].loose_quantity).toBe(10);
    // Earliest-expiry FEFO batch wins
    expect(results[0].batch_no).toBe('SSM0069');
    expect(results[0].expiry_date).toBe('2029-05-31');
    expect(results[0].mrp).toBe(220.35);
    expect(results[0].sell_price).toBe(215.0);
    expect(results[0].inventory_id).toBe(191652);
  });

  it('sums strip and loose stock across 3 batches with different MRPs while keeping distinct medicines separate', () => {
    const inventory: PosBatchItem[] = [
      makeBatch({
        inventory_id: 101,
        medicine_id: 1,
        name: 'DOLO 650 TABLET',
        medicine_name: 'DOLO 650 TABLET',
        batch_no: 'D3',
        expiry_date: '2029-12-31',
        mrp: 35.0,
        quantity: 5,
        stock_qty: 5,
        loose_quantity: 2,
      }),
      makeBatch({
        inventory_id: 102,
        medicine_id: 1,
        name: 'DOLO 650 TABLET',
        medicine_name: 'DOLO 650 TABLET',
        batch_no: 'D1',
        expiry_date: '2028-06-30',
        mrp: 30.0,
        quantity: 2,
        stock_qty: 2,
        loose_quantity: 4,
      }),
      makeBatch({
        inventory_id: 103,
        medicine_id: 1,
        name: 'DOLO 650 TABLET',
        medicine_name: 'DOLO 650 TABLET',
        batch_no: 'D2',
        expiry_date: '2029-01-31',
        mrp: 32.5,
        quantity: 3,
        stock_qty: 3,
        loose_quantity: 0,
      }),
      makeBatch({
        inventory_id: 201,
        medicine_id: 2,
        name: 'DOLO 500 TABLET',
        medicine_name: 'DOLO 500 TABLET',
        batch_no: 'D500',
        expiry_date: '2029-03-31',
        mrp: 20.0,
        quantity: 4,
        stock_qty: 4,
        loose_quantity: 0,
      }),
    ];

    const results = filterLocalInventory('dolo', inventory);
    expect(results).toHaveLength(2);
    expect(results[0].medicine_name).toBe('DOLO 500 TABLET');
    expect(results[1].medicine_name).toBe('DOLO 650 TABLET');
    expect(results[1].quantity).toBe(10);
    expect(results[1].stock_qty).toBe(10);
    expect(results[1].loose_quantity).toBe(6);
    expect(results[1].batch_no).toBe('D1');
  });

  it('merges same medicine across tiers and excludes expired or empty batches', () => {
    const inventory: PosBatchItem[] = [
      makeBatch({
        inventory_id: 301,
        medicine_id: 3,
        name: 'PARACETAMOL DOLO 650',
        medicine_name: 'PARACETAMOL DOLO 650',
        item_code: 'dolo99',
        batch_no: 'P1',
        expiry_date: '2029-09-30',
        mrp: 25.0,
        quantity: 3,
        stock_qty: 3,
      }),
      makeBatch({
        inventory_id: 302,
        medicine_id: 3,
        name: 'PARACETAMOL DOLO 650',
        medicine_name: 'PARACETAMOL DOLO 650',
        item_code: 'other',
        batch_no: 'P2',
        expiry_date: '2028-09-30',
        mrp: 28.0,
        quantity: 4,
        stock_qty: 4,
      }),
      makeBatch({
        inventory_id: 303,
        medicine_id: 3,
        name: 'PARACETAMOL DOLO 650',
        medicine_name: 'PARACETAMOL DOLO 650',
        batch_no: 'EXP1',
        expiry_date: '2020-01-31',
        mrp: 20.0,
        quantity: 10,
        stock_qty: 10,
      }),
    ];

    const results = filterLocalInventory('dolo', inventory);
    expect(results).toHaveLength(1);
    expect(results[0].quantity).toBe(7);
    expect(results[0].batch_no).toBe('P2');
  });
});
