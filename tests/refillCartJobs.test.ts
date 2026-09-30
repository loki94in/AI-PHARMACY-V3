import { jest } from '@jest/globals';

// Frontend refill cart run store (frontend/src/services/refillCartJobs.ts) with the API mocked.
let inFlight = 0;
let maxInFlight = 0;
const calls: Array<{ id: number; dryRun?: boolean }> = [];
const outcome: Record<number, string> = {};

const mockAdd = jest.fn(async (id: number, body: any) => {
  calls.push({ id, dryRun: body?.dryRun });
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise(r => setTimeout(r, 15));
  inFlight--;
  const status = body?.dryRun ? 'ready' : (outcome[id] || 'added');
  return { success: status === 'added', status, message: status, refillId: id, medicineName: `MED ${id}`, qty: 1,
    line: { storeName: 'ALPHA PHARMA', productName: `MED ${id}`, qty: 1 }, linked: [], candidates: [] };
});
const mockSummary = jest.fn(async (..._args: any[]) => ({ ok: true, queued: true }));

jest.unstable_mockModule('../frontend/src/services/api.js', () => ({
  __esModule: true,
  api: { addRefillToCart: mockAdd, sendRefillCartSummary: mockSummary }
}));

const store = await import('../frontend/src/services/refillCartJobs.js');

const waitIdle = async () => {
  for (let i = 0; i < 200 && store.getRefillCartJobs().some(j => store.isRefillJobRunning(j) || j.summaryPending); i++) {
    await new Promise(r => setTimeout(r, 10));
  }
  await new Promise(r => setTimeout(r, 20));
};
const items = (...ids: number[]) => ids.map(id => ({ refillId: id, medicineId: id * 10, medicineName: `MED ${id}`, qty: 1 }));

describe('Refill cart run store (popup can close, run keeps going)', () => {
  beforeEach(() => {
    calls.length = 0; inFlight = 0; maxInFlight = 0;
    for (const k of Object.keys(outcome)) delete outcome[Number(k)];
    jest.clearAllMocks();
    for (const j of store.getRefillCartJobs()) store.dismissRefillCartJob(j.id);
  });

  test('adds ONE medicine at a time and keeps running after the popup is closed; one owner summary at the end', async () => {
    store.startRefillCartJob('Ravi', items(1, 2, 3));
    const job = store.getRefillCartJobs()[0];
    expect(job.open).toBe(true);
    store.closeRefillCartJob(job.id); // closed while running → keeps going in the background
    expect(store.getRefillCartJobs()[0].open).toBe(false);
    await waitIdle();
    expect(calls.map(c => c.id)).toEqual([1, 2, 3]);
    expect(maxInFlight).toBe(1);
    const done = store.getRefillCartJobs()[0];
    expect(done.rows.map(r => r.state)).toEqual(['added', 'added', 'added']);
    expect(mockSummary).toHaveBeenCalledTimes(1);
    expect(done.whatsapp).toEqual({ queued: true, reason: undefined });
  });

  test('clicking Order to Cart again while it runs never queues the same refill twice', async () => {
    store.startRefillCartJob('Ravi', items(1, 2));
    store.startRefillCartJob('Ravi', items(1, 2, 3)); // double click + one new medicine
    await waitIdle();
    expect(calls.map(c => c.id).sort()).toEqual([1, 2, 3]);
    expect(store.getRefillCartJobs()).toHaveLength(1);
  });

  test('re-check after linking uses dryRun (never adds) and does not send another summary', async () => {
    outcome[5] = 'needs_link';
    store.startRefillCartJob('Asha', items(5));
    await waitIdle();
    const job = store.getRefillCartJobs()[0];
    expect(job.rows[0].state).toBe('needs_link');
    mockSummary.mockClear();
    store.queueRefillRow(job.id, 5, 'plan');
    await waitIdle();
    expect(calls[calls.length - 1]).toEqual({ id: 5, dryRun: true });
    expect(store.getRefillCartJobs()[0].rows[0].state).toBe('ready');
    expect(mockSummary).not.toHaveBeenCalled();
    store.queueRefillRow(job.id, 5, 'add'); // the pharmacist presses Add
    await waitIdle();
    expect(calls[calls.length - 1]).toEqual({ id: 5, dryRun: false });
    expect(mockSummary).toHaveBeenCalledTimes(1);
  });

  test('closing a finished run clears it; a finished card can be dismissed', async () => {
    store.startRefillCartJob('Ravi', items(1));
    await waitIdle();
    const job = store.getRefillCartJobs()[0];
    store.closeRefillCartJob(job.id);
    expect(store.getRefillCartJobs()).toHaveLength(0);

    store.startRefillCartJob('Asha', items(2));
    const j2 = store.getRefillCartJobs()[0];
    store.closeRefillCartJob(j2.id); // card while running
    store.dismissRefillCartJob(j2.id); // cannot dismiss a running card
    expect(store.getRefillCartJobs()).toHaveLength(1);
    await waitIdle();
    store.dismissRefillCartJob(j2.id);
    expect(store.getRefillCartJobs()).toHaveLength(0);
  });
});
