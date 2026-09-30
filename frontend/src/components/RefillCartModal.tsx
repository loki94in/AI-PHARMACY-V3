import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart, X, Loader2, Check, AlertTriangle, RotateCcw, Search, Link2 } from 'lucide-react';
import { api, type RefillCartCandidate, type RefillCartPick, type RefillCartResult } from '../services/api';
import { useModalEscape } from '../services/keyboardShortcuts';

/**
 * Refill → Live Cart popup (CRM refills). Works through the patient's medicines
 * ONE AT A TIME: the server reads the cart, checks live stock, adds to the saved
 * distributor and re-reads the cart before a row turns "Added". Rows whose saved
 * distributor is out of stock (or that have none yet) stay highlighted with a
 * tick-list; ticking one or more distributors saves them for next time.
 */

export interface RefillCartItemInput {
  refillId: number;
  medicineName: string;
  qty: number;
}

type RowState = 'queued' | 'working' | RefillCartResult['status'];

interface Row extends RefillCartItemInput {
  state: RowState;
  message: string;
  linked: RefillCartResult['linked'];
  line?: RefillCartResult['line'];
  candidates: RefillCartCandidate[];
  ticked: string[];
  picking: boolean;
  searchText: string;
  searching: boolean;
}

interface LocalPrSearchItem {
  name?: string;
  distributor?: string;
  storeId?: number | string;
  productCode?: string;
  productId?: string | number;
  packaging?: string;
  company?: string;
  mapped?: boolean;
  rate?: number | null;
  mrp?: number | null;
  scheme?: string;
  stock?: string | number | null;
  isOffline?: boolean;
  isLocalPharmacy?: boolean;
}

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

const keyOf = (c: { storeId: number; productCode: string }) => `${c.storeId}|${c.productCode}`;
const NEEDS_PICK: RowState[] = ['needs_link', 'linked_oos', 'not_found'];

// Mirrors backend isItemInStock (routes/pharmarack.ts) for manual search results.
function isInStock(stock: unknown): boolean {
  if (stock === null || stock === undefined || stock === '') return false;
  const s = String(stock).trim().toLowerCase();
  if (['0', 'out of stock', 'oos', 'nil', 'none', 'false', 'no', 'unavailable'].includes(s)) return false;
  const n = parseFloat(s);
  return isNaN(n) ? true : n > 0;
}

// ponytail: one module-level chain = one Pharmarack cart write at a time.
let cartChain: Promise<unknown> = Promise.resolve();
function enqueueCartTask(task: () => Promise<void>): void {
  cartChain = cartChain.then(task, task).catch(() => {});
}

const STATE_CHIP: Record<RowState, { label: string; cls: string }> = {
  queued: { label: 'Waiting', cls: 'bg-bg3 text-muted border-border' },
  working: { label: 'Checking…', cls: 'bg-primary/10 text-primary border-primary/30' },
  added: { label: 'Added', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  in_cart: { label: 'Already in cart', cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  needs_link: { label: 'Pick distributor', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  linked_oos: { label: 'Out of stock', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  not_found: { label: 'Not found', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  failed: { label: 'Failed', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

export const RefillCartModal: React.FC<{
  patientName: string;
  items: RefillCartItemInput[];
  onClose: () => void;
}> = ({ patientName, items, onClose }) => {
  useModalEscape(true, onClose);
  const [rows, setRows] = useState<Row[]>(() => items.map(i => ({
    ...i, state: 'queued', message: '', linked: [], candidates: [], ticked: [],
    picking: false, searchText: i.medicineName, searching: false
  })));
  const closedRef = useRef(false);
  const startedRef = useRef(false);

  const patchRow = (refillId: number, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => (r.refillId === refillId ? { ...r, ...patch } : r)));

  const runRow = (refillId: number, qty: number, pick?: RefillCartPick[]) => {
    patchRow(refillId, { state: 'queued', message: pick ? 'Waiting to save & add…' : 'Waiting…', picking: false });
    enqueueCartTask(async () => {
      if (closedRef.current) return;
      patchRow(refillId, { state: 'working', message: pick ? 'Saving distributor, adding, re-checking cart…' : 'Checking cart and live stock…' });
      try {
        const res = await api.addRefillToCart(refillId, { qty, pick });
        patchRow(refillId, {
          state: res.status,
          message: res.message,
          linked: res.linked || [],
          line: res.line,
          candidates: res.candidates || [],
          ticked: (res.candidates || []).filter(c => c.linked).map(keyOf),
          picking: NEEDS_PICK.includes(res.status)
        });
      } catch (err) {
        const e = err as LocalApiError;
        patchRow(refillId, { state: 'failed', message: e.response?.data?.error || e.message || 'Request failed. Retry.' });
      }
    });
  };

  // Start once per popup; closing stops rows that have not started yet.
  useEffect(() => {
    closedRef.current = false;
    if (!startedRef.current) {
      startedRef.current = true;
      items.forEach(i => runRow(i.refillId, i.qty));
    }
    return () => { closedRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on open; rows are driven by runRow
  }, []);

  const searchManually = async (row: Row) => {
    const q = row.searchText.trim();
    if (q.length < 2) return;
    patchRow(row.refillId, { searching: true });
    try {
      const data: unknown = await api.searchPharmarack(q);
      const list = (Array.isArray(data) ? data : []) as LocalPrSearchItem[];
      const ticked = new Set(row.ticked);
      const found: RefillCartCandidate[] = list
        .filter(i => !i.isOffline && !i.isLocalPharmacy && Number(i.storeId) > 0 && String(i.productCode || '').trim())
        .slice(0, 30)
        .map(i => ({
          storeId: Number(i.storeId),
          storeName: String(i.distributor || ''),
          productCode: String(i.productCode),
          productId: i.productId ?? null,
          productName: String(i.name || ''),
          packaging: String(i.packaging || ''),
          company: String(i.company || ''),
          mapped: i.mapped !== false,
          rate: i.rate ?? null,
          mrp: i.mrp ?? null,
          scheme: String(i.scheme || ''),
          stock: String(i.stock ?? ''),
          inStock: isInStock(i.stock),
          inCart: false,
          linked: ticked.has(`${Number(i.storeId)}|${String(i.productCode)}`)
        }));
      patchRow(row.refillId, {
        searching: false,
        candidates: found,
        message: found.length ? row.message : `No live Pharmarack result for "${q}".`
      });
    } catch (err) {
      const e = err as LocalApiError;
      patchRow(row.refillId, { searching: false, message: e.response?.data?.error || 'Pharmarack search failed. Retry.' });
    }
  };

  const toggleTick = (refillId: number, key: string) =>
    setRows(prev => prev.map(r => (r.refillId !== refillId ? r : {
      ...r, ticked: r.ticked.includes(key) ? r.ticked.filter(k => k !== key) : [...r.ticked, key]
    })));

  const saveAndAdd = (row: Row) => {
    const picks: RefillCartPick[] = row.ticked
      .map(k => row.candidates.find(c => keyOf(c) === k))
      .filter((c): c is RefillCartCandidate => !!c)
      .map(c => ({
        storeId: c.storeId, storeName: c.storeName, productCode: c.productCode, productId: c.productId,
        productName: c.productName, packaging: c.packaging, company: c.company, mapped: c.mapped
      }));
    if (picks.length > 0) runRow(row.refillId, row.qty, picks);
  };

  const count = (s: RowState[]) => rows.filter(r => s.includes(r.state)).length;
  const busy = count(['queued', 'working']);
  const failed = rows.filter(r => r.state === 'failed');

  return createPortal(
    <div className="fixed inset-0 z-global-modal bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-bg2 border border-border rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-text">
        <div className="bg-bg3/80 px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
              <ShoppingCart size={16} />
            </div>
            <div>
              <h3 className="font-extrabold text-text text-sm">Add refill to Live Cart — {patientName}</h3>
              <p className="text-[11px] text-muted">One medicine at a time. Each add is confirmed by re-reading the Pharmarack cart.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-2.5 text-xs">
          {rows.map(row => {
            const chip = STATE_CHIP[row.state];
            const highlight = row.state === 'linked_oos' || row.state === 'failed'
              ? 'border-red-500/50 bg-red-500/5'
              : NEEDS_PICK.includes(row.state) ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-bg';
            return (
              <div key={row.refillId} className={`rounded-xl border p-3 space-y-2 ${highlight}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-bold text-text truncate">{row.medicineName}</div>
                    <div className="text-[11px] text-muted">Qty {row.qty}</div>
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
                    {row.linked.map(l => (
                      <span key={`${l.storeName}|${l.productName}`} className={`px-1.5 py-0.5 rounded border text-[10px] flex items-center gap-1 ${l.inStock ? 'border-border text-muted' : 'border-red-500/40 text-red-400'}`}>
                        <Link2 size={9} /> {l.storeName}: {l.inStock ? 'in stock' : `out of stock (${l.stock || 'nil'})`}
                      </span>
                    ))}
                  </div>
                )}

                {row.state === 'failed' && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => runRow(row.refillId, row.qty)} className="px-2.5 py-1 rounded-lg bg-bg3 border border-border text-text hover:border-primary/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer">
                      <RotateCcw size={11} /> Retry
                    </button>
                    {row.candidates.length > 0 && !row.picking && (
                      <button type="button" onClick={() => patchRow(row.refillId, { picking: true })} className="px-2.5 py-1 rounded-lg bg-bg3 border border-border text-muted hover:text-text text-[11px] font-bold cursor-pointer">
                        Change distributor
                      </button>
                    )}
                  </div>
                )}

                {row.picking && (
                  <div className="rounded-lg border border-border bg-bg2 p-2 space-y-2">
                    <form
                      className="flex gap-1.5"
                      onSubmit={e => { e.preventDefault(); void searchManually(row); }}
                    >
                      <input
                        value={row.searchText}
                        onChange={e => patchRow(row.refillId, { searchText: e.target.value })}
                        className="flex-1 bg-bg border border-border rounded-lg px-2 py-1 text-[11px] text-text outline-none focus:border-primary/50"
                        placeholder="Search Pharmarack by another name"
                      />
                      <button type="submit" disabled={row.searching || row.searchText.trim().length < 2} className="px-2.5 py-1 rounded-lg bg-bg3 border border-border text-text text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50">
                        {row.searching ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />} Search
                      </button>
                    </form>

                    {row.candidates.length > 0 ? (
                      <ul className="max-h-56 overflow-y-auto dropdown-scroll divide-y divide-border/40 rounded-lg border border-border">
                        {row.candidates.map(c => {
                          const k = keyOf(c);
                          return (
                            <li key={k}>
                              <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-bg3/60">
                                <input type="checkbox" checked={row.ticked.includes(k)} onChange={() => toggleTick(row.refillId, k)} className="accent-primary" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] font-semibold text-text truncate">{c.productName} {c.packaging && <span className="text-muted font-normal">({c.packaging})</span>}</div>
                                  <div className="text-[10px] text-muted truncate">
                                    {c.storeName}{c.rate != null ? ` · PTR ₹${c.rate}` : ''}{c.mrp != null ? ` · MRP ₹${c.mrp}` : ''}{c.scheme ? ` · ${c.scheme}` : ''}{c.mapped ? '' : ' · unmapped'}
                                  </div>
                                </div>
                                {c.inCart && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30">in cart</span>}
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${c.inStock ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
                                  {c.inStock ? `stock ${c.stock}` : 'out of stock'}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="text-[11px] text-muted px-1">No distributor products to pick. Search another name above.</div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted">Tick one or more. The app adds to only one: the one already in your cart, else the one you buy from most.</span>
                      <button
                        type="button"
                        disabled={row.ticked.length === 0}
                        onClick={() => saveAndAdd(row)}
                        className="px-3 py-1 rounded-lg bg-primary hover:bg-primary/90 text-white text-[11px] font-bold shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        Save &amp; add ({row.ticked.length})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border bg-bg3/40 flex items-center justify-between gap-2 flex-wrap shrink-0 text-[11px]">
          <span className="text-muted">
            Added {count(['added'])} · In cart {count(['in_cart'])} · Needs pick {count(NEEDS_PICK)} · Failed {failed.length}{busy ? ` · Working ${busy}` : ''}
          </span>
          <div className="flex gap-2">
            {failed.length > 0 && (
              <button type="button" onClick={() => failed.forEach(r => runRow(r.refillId, r.qty))} className="px-3 py-1.5 rounded-lg bg-bg3 border border-border text-text font-bold flex items-center gap-1 cursor-pointer">
                <RotateCcw size={11} /> Retry failed
              </button>
            )}
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg bg-bg3 border border-border text-text font-bold cursor-pointer">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
