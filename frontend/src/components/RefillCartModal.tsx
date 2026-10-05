import React, { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart, X, Loader2, Check, AlertTriangle, RotateCcw, Link2, MessageCircle } from 'lucide-react';
import { useModalEscape } from '../services/keyboardShortcuts';
import {
  subscribeRefillCartJobs, getRefillCartJobs, isRefillJobRunning, queueRefillRow, openRefillCartJob,
  closeRefillCartJob, dismissRefillCartJob, type RefillCartJob, type RefillCartRow, type RefillRowState
} from '../services/refillCartJobs';
import { MedicineLinkModal } from './MedicineLinkModal';

/**
 * Refill → Live Cart UI. The run itself lives in services/refillCartJobs.ts:
 * the server reads the cart, checks live stock, adds to the linked distributor
 * and re-reads the cart before a row turns "Added". Linking a distributor here
 * only saves the link and re-checks the row ("Ready" + Add) — it never adds.
 * Closing the popup keeps the run going; RefillCartJobHost then shows a small
 * card with every medicine's distributor and qty. Mounted once in Layout.
 */

const NEEDS_LINK: RefillRowState[] = ['needs_link', 'linked_oos', 'not_found'];

const STATE_CHIP: Record<RefillRowState, { label: string; cls: string }> = {
  queued: { label: 'Waiting', cls: 'bg-bg3 text-muted border-border' },
  working: { label: 'Checking…', cls: 'bg-primary/10 text-primary border-primary/30' },
  added: { label: 'Added', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  ready: { label: 'Ready — press Add', cls: 'bg-primary/10 text-primary border-primary/30' },
  in_cart: { label: 'Already in cart', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  needs_link: { label: 'Link distributor', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  linked_oos: { label: 'Out of stock', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  not_found: { label: 'Not found', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  failed: { label: 'Failed', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const countOf = (job: RefillCartJob, states: RefillRowState[]) => job.rows.filter(r => states.includes(r.state)).length;

const WhatsAppNote: React.FC<{ job: RefillCartJob }> = ({ job }) => {
  if (!job.whatsapp) return null;
  return job.whatsapp.queued
    ? <span className="flex items-center gap-1 text-emerald-400"><MessageCircle size={11} /> Summary queued to owner WhatsApp</span>
    : <span className="flex items-center gap-1 text-amber-400"><MessageCircle size={11} /> WhatsApp summary not sent: {job.whatsapp.reason}</span>;
};

const RefillCartModal: React.FC<{ job: RefillCartJob }> = ({ job }) => {
  const [linkRow, setLinkRow] = useState<RefillCartRow | null>(null);
  const running = isRefillJobRunning(job);
  const close = () => closeRefillCartJob(job.id);
  useModalEscape(!linkRow, close);

  const ready = job.rows.filter(r => r.state === 'ready');
  const failed = job.rows.filter(r => r.state === 'failed');

  return createPortal(
    <div className="fixed inset-0 z-global-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-3xl h-[80vh] min-h-[520px] max-h-[760px] shadow-2xl overflow-hidden flex flex-col text-text">
        <div className="bg-bg3/80 px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
              <ShoppingCart size={16} />
            </div>
            <div>
              <h3 className="font-extrabold text-text text-sm">Add refill to Live Cart — {job.patientName}</h3>
              <p className="text-[11px] text-muted">One medicine at a time, each add confirmed in the Pharmarack cart. Closing keeps it running in the background.</p>
            </div>
          </div>
          <button type="button" onClick={close} className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer" title="Close (keeps running)">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-2.5 text-xs">
          {job.rows.map(row => {
            const chip = STATE_CHIP[row.state];
            const highlight = row.state === 'linked_oos' || row.state === 'failed'
              ? 'border-red-500/50 bg-red-500/5'
              : NEEDS_LINK.includes(row.state) ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-bg';
            const canLink = !!row.medicineId && (NEEDS_LINK.includes(row.state) || row.state === 'failed' || row.state === 'ready');
            return (
              <div key={row.refillId} className={`rounded-xl border p-3 space-y-2 ${highlight}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-bold text-text truncate">{row.medicineName}</div>
                    <div className="text-[11px] text-muted">
                      Qty {row.qty}{row.line && (row.state === 'added' || row.state === 'in_cart') ? ` · ${row.line.storeName}` : ''}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold flex items-center gap-1 ${chip.cls}`}>
                    {row.state === 'working' && <Loader2 size={10} className="animate-spin" />}
                    {row.state === 'added' && <Check size={10} />}
                    {(row.state === 'linked_oos' || row.state === 'failed') && <AlertTriangle size={10} />}
                    {chip.label}
                  </span>
                </div>

                {row.message && <div className="text-[11px] text-muted">{row.message}</div>}

                {row.linked.length > 0 && row.state !== 'added' && (
                  <div className="flex flex-wrap gap-1.5">
                    {row.linked.map((l, i) => (
                      <span key={`${l.storeName}|${l.productName}`} className={`px-1.5 py-0.5 rounded border text-[10px] flex items-center gap-1 ${l.inStock ? 'border-border text-muted' : 'border-red-500/40 text-red-400'}`}>
                        <Link2 size={9} /> {i + 1}. {l.storeName}: {l.inStock ? 'in stock' : `out of stock (${l.stock || 'nil'})`}
                      </span>
                    ))}
                  </div>
                )}

                {(row.state === 'ready' || row.state === 'failed' || canLink) && (
                  <div className="flex gap-2 flex-wrap">
                    {row.state === 'ready' && (
                      <button type="button" onClick={() => queueRefillRow(job.id, row.refillId, 'add')} className="px-3 py-1 rounded-lg bg-primary hover:bg-primary/90 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer">
                        <ShoppingCart size={11} /> Add to cart
                      </button>
                    )}
                    {row.state === 'failed' && (
                      <button type="button" onClick={() => queueRefillRow(job.id, row.refillId, 'add')} className="px-2.5 py-1 rounded-lg bg-bg3 border border-border text-text hover:border-primary/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer">
                        <RotateCcw size={11} /> Retry
                      </button>
                    )}
                    {canLink && (
                      <button type="button" onClick={() => setLinkRow(row)} className="px-2.5 py-1 rounded-lg bg-bg3 border border-border text-text hover:border-primary/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer">
                        <Link2 size={11} /> {row.linked.length > 0 ? 'Change distributor' : 'Link distributor'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border bg-bg3/40 flex items-center justify-between gap-2 flex-wrap shrink-0 text-[11px]">
          <div className="space-y-0.5">
            <div className="text-muted">
              Added {countOf(job, ['added'])} · In cart {countOf(job, ['in_cart'])} · Ready {ready.length} · Needs link {countOf(job, NEEDS_LINK)} · Failed {failed.length}
              {running ? ` · Working ${countOf(job, ['queued', 'working'])}` : ''}
            </div>
            <WhatsAppNote job={job} />
          </div>
          <div className="flex gap-2">
            {ready.length > 0 && (
              <button type="button" onClick={() => ready.forEach(r => queueRefillRow(job.id, r.refillId, 'add'))} className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold flex items-center gap-1 cursor-pointer">
                <ShoppingCart size={11} /> Add ready ({ready.length})
              </button>
            )}
            {failed.length > 0 && (
              <button type="button" onClick={() => failed.forEach(r => queueRefillRow(job.id, r.refillId, 'add'))} className="px-3 py-1.5 rounded-lg bg-bg3 border border-border text-text font-bold flex items-center gap-1 cursor-pointer">
                <RotateCcw size={11} /> Retry failed
              </button>
            )}
            <button type="button" onClick={close} className="px-3 py-1.5 rounded-lg bg-bg3 border border-border text-text font-bold cursor-pointer">
              {running ? 'Close (keeps adding)' : 'Close'}
            </button>
          </div>
        </div>
      </div>

      {linkRow && linkRow.medicineId && (
        <MedicineLinkModal
          medicineId={linkRow.medicineId}
          medicineName={linkRow.medicineName}
          initialResults={linkRow.candidates}
          onSaved={() => queueRefillRow(job.id, linkRow.refillId, 'plan')}
          onClose={() => setLinkRow(null)}
        />
      )}
    </div>,
    document.body
  );
};

/** Small corner card for a run whose popup was closed: progress, then the result list. */
const RefillCartCard: React.FC<{ job: RefillCartJob }> = ({ job }) => {
  const running = isRefillJobRunning(job);
  const done = job.rows.filter(r => r.state !== 'queued' && r.state !== 'working').length;
  const attention = job.rows.filter(r => r.state !== 'added' && r.state !== 'in_cart' && r.state !== 'queued' && r.state !== 'working');
  return (
    <div className="bg-bg2 border border-border rounded-xl shadow-2xl p-3 text-xs text-text space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold flex items-center gap-1.5 min-w-0">
          {running ? <Loader2 size={12} className="animate-spin text-primary shrink-0" /> : <ShoppingCart size={12} className="text-primary shrink-0" />}
          <span className="truncate">
            {running
              ? `Adding refill to cart — ${job.patientName} (${done}/${job.rows.length})`
              : attention.length === 0 ? `All refill medicines in cart — ${job.patientName}` : `Refill cart — ${job.patientName}`}
          </span>
        </div>
        {!running && (
          <button type="button" onClick={() => dismissRefillCartJob(job.id)} className="p-0.5 rounded text-muted hover:text-text cursor-pointer" title="Dismiss">
            <X size={13} />
          </button>
        )}
      </div>
      {!running && (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {job.rows.map(r => (
            <li key={r.refillId} className="flex items-start gap-1.5">
              {r.state === 'added' || r.state === 'in_cart'
                ? <Check size={11} className="text-emerald-400 mt-0.5 shrink-0" />
                : <AlertTriangle size={11} className="text-amber-400 mt-0.5 shrink-0" />}
              <span className="min-w-0">
                <span className="font-semibold">{r.medicineName}</span>
                <span className="text-muted">
                  {r.state === 'added' && r.line ? ` → ${r.line.storeName} × ${r.qty}` : ''}
                  {r.state === 'in_cart' && r.line ? ` → already in ${r.line.storeName} (qty ${r.line.qty})` : ''}
                  {r.state !== 'added' && r.state !== 'in_cart' ? ` — ${STATE_CHIP[r.state].label}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <WhatsAppNote job={job} />
        <button type="button" onClick={() => openRefillCartJob(job.id)} className="ml-auto px-2.5 py-1 rounded-lg bg-bg3 border border-border text-text font-bold cursor-pointer hover:border-primary/40">
          Open
        </button>
      </div>
    </div>
  );
};

/** Mounted once in Layout so runs and their result cards survive page changes. */
export const RefillCartJobHost: React.FC = () => {
  const jobs = useSyncExternalStore(subscribeRefillCartJobs, getRefillCartJobs);
  const openJob = jobs.find(j => j.open);
  const cards = jobs.filter(j => !j.open);
  return (
    <>
      {openJob && <RefillCartModal job={openJob} />}
      {cards.length > 0 && createPortal(
        <div className="fixed top-16 right-6 z-modal w-[340px] max-w-[calc(100vw-2rem)] flex flex-col gap-2">
          {cards.map(j => <RefillCartCard key={j.id} job={j} />)}
        </div>,
        document.body
      )}
    </>
  );
};
