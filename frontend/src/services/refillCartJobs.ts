import { api, type RefillCartCandidate, type RefillCartResult } from './api';
import { toastEvent } from './events';

/**
 * Refill → Live Cart runs, kept OUTSIDE React so closing the popup never stops
 * a run: it keeps adding one medicine at a time in the background, and
 * RefillCartJobHost shows a small card with the result. One module-level chain
 * = one Pharmarack cart write at a time across all runs. A refill that is
 * queued or working is never queued again (no double add).
 * When a run that added something finishes, ONE WhatsApp summary goes to the
 * OWNER (server builds it from saved rows; never the patient).
 */

export interface RefillCartItemInput {
  refillId: number;
  medicineId?: number;
  medicineName: string;
  qty: number;
  neededQty?: number;
  stockQty?: number;
  cartStoreName?: string | null;
  cartQty?: number | null;
  inLiveCart?: boolean;
}

export type RefillRowState = 'queued' | 'working' | RefillCartResult['status'];

export interface RefillCartRow extends RefillCartItemInput {
  state: RefillRowState;
  message: string;
  linked: RefillCartResult['linked'];
  line?: RefillCartResult['line'];
  candidates: RefillCartCandidate[];
}

export interface RefillCartJob {
  id: number;
  patientName: string;
  rows: RefillCartRow[];
  open: boolean;
  /** an add ran since the last owner summary */
  summaryPending: boolean;
  whatsapp?: { queued: boolean; reason?: string };
}

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

let jobs: RefillCartJob[] = [];
let jobSeq = 1;
const listeners = new Set<() => void>();

function publish(next: RefillCartJob[]): void {
  jobs = next;
  listeners.forEach(l => l());
}

export function subscribeRefillCartJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const getRefillCartJobs = (): RefillCartJob[] => jobs;

export const isRefillJobRunning = (j: RefillCartJob): boolean =>
  j.rows.some(r => r.state === 'queued' || r.state === 'working');

const patchJob = (jobId: number, fn: (j: RefillCartJob) => RefillCartJob) =>
  publish(jobs.map(j => (j.id === jobId ? fn(j) : j)));

const patchRow = (jobId: number, refillId: number, patch: Partial<RefillCartRow>) =>
  patchJob(jobId, j => ({ ...j, rows: j.rows.map(r => (r.refillId === refillId ? { ...r, ...patch } : r)) }));

let chain: Promise<unknown> = Promise.resolve();
const enqueue = (task: () => Promise<void>) => { chain = chain.then(task, task).catch(() => {}); };

async function sendSummaryIfDone(jobId: number): Promise<void> {
  const job = jobs.find(j => j.id === jobId);
  if (!job || isRefillJobRunning(job) || !job.summaryPending) return;
  patchJob(jobId, j => ({ ...j, summaryPending: false }));
  try {
    const out = await api.sendRefillCartSummary(job.patientName, job.rows.map(r => ({
      refillId: r.refillId, medicineName: r.medicineName, status: r.state,
      storeName: r.line?.storeName, qty: r.line?.qty, message: r.message
    })));
    patchJob(jobId, j => ({ ...j, whatsapp: { queued: out.queued, reason: out.reason } }));
  } catch {
    patchJob(jobId, j => ({ ...j, whatsapp: { queued: false, reason: 'Could not queue the WhatsApp summary.' } }));
  }

  // Emit ONE consolidated in-app summary message
  const addedCount = job.rows.filter(r => r.state === 'added').length;
  const inCartCount = job.rows.filter(r => r.state === 'in_cart').length;
  const needsLinkCount = job.rows.filter(r => r.state === 'needs_link' || r.state === 'linked_oos').length;
  const failedCount = job.rows.filter(r => r.state === 'failed' || r.state === 'not_found').length;

  const parts: string[] = [];
  if (addedCount > 0) parts.push(`${addedCount} added`);
  if (inCartCount > 0) parts.push(`${inCartCount} already in cart`);
  if (needsLinkCount > 0) parts.push(`${needsLinkCount} need link`);
  if (failedCount > 0) parts.push(`${failedCount} failed`);

  const summary = parts.length > 0
    ? `Cart Order for ${job.patientName}: ${parts.join(', ')}.`
    : `Cart Order completed for ${job.patientName}.`;

  const toastType = failedCount > 0 ? 'error' : needsLinkCount > 0 ? 'info' : 'success';
  toastEvent.trigger(summary, toastType, '/crm');
}

function runRow(jobId: number, row: RefillCartRow, mode: 'add' | 'plan'): void {
  patchRow(jobId, row.refillId, { state: 'queued', message: mode === 'plan' ? 'Waiting to re-check…' : 'Waiting…' });
  if (mode === 'add') patchJob(jobId, j => ({ ...j, summaryPending: true, whatsapp: undefined }));
  enqueue(async () => {
    patchRow(jobId, row.refillId, {
      state: 'working',
      message: mode === 'plan' ? 'Checking cart and stock…' : 'Checking cart and stock, adding, re-reading cart…'
    });
    try {
      const res = await api.addRefillToCart(row.refillId, { qty: row.qty, dryRun: mode === 'plan' });
      patchRow(jobId, row.refillId, {
        state: res.status, message: res.message, linked: res.linked || [], line: res.line, candidates: res.candidates || []
      });
    } catch (err) {
      const e = err as LocalApiError;
      patchRow(jobId, row.refillId, { state: 'failed', message: e.response?.data?.error || e.message || 'Request failed. Retry.' });
    }
    await sendSummaryIfDone(jobId);
  });
}

/**
 * Re-run one row. 'add' writes the cart; 'plan' only checks (used right after
 * linking a distributor — linking never adds to the cart by itself).
 */
export function queueRefillRow(jobId: number, refillId: number, mode: 'add' | 'plan' = 'add'): void {
  const row = jobs.find(j => j.id === jobId)?.rows.find(r => r.refillId === refillId);
  if (!row || row.state === 'queued' || row.state === 'working') return;
  runRow(jobId, row, mode);
}

/** Order to Cart / + Live Cart click. Reuses this patient's live run instead of starting a second one. */
export function startRefillCartJob(patientName: string, items: RefillCartItemInput[]): void {
  const busy = new Set(jobs.flatMap(j => j.rows.filter(r => r.state === 'queued' || r.state === 'working').map(r => r.refillId)));
  let job = jobs.find(j => j.patientName === patientName && isRefillJobRunning(j));
  if (!job) {
    job = { id: jobSeq++, patientName, rows: [], open: true, summaryPending: false };
    // A finished run for the same patient is replaced by the new one.
    publish([...jobs.filter(j => j.patientName !== patientName || isRefillJobRunning(j)), job]);
  }
  const jobId = job.id;
  const fresh: RefillCartRow[] = items
    .filter(i => !busy.has(i.refillId) && !job!.rows.some(r => r.refillId === i.refillId))
    .map(i => ({ ...i, state: 'queued', message: 'Waiting…', linked: [], candidates: [] }));
  publish(jobs.map(j => (j.id === jobId ? { ...j, open: true, rows: [...j.rows, ...fresh] } : { ...j, open: false })));
  fresh.forEach(r => runRow(jobId, r, 'add'));
}

export function openRefillCartJob(jobId: number): void {
  publish(jobs.map(j => ({ ...j, open: j.id === jobId })));
}

/** Close the popup. A running job keeps going and reports through a small card; a finished one is cleared. */
export function closeRefillCartJob(jobId: number): void {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  if (isRefillJobRunning(job)) patchJob(jobId, j => ({ ...j, open: false }));
  else publish(jobs.filter(j => j.id !== jobId));
}

export function dismissRefillCartJob(jobId: number): void {
  const job = jobs.find(j => j.id === jobId);
  if (job && !isRefillJobRunning(job)) publish(jobs.filter(j => j.id !== jobId));
}
