import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, X, Loader2, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { api, type RefillCartCandidate, type RefillCartPick } from '../services/api';
import { toastEvent } from '../services/events';
import { useModalEscape } from '../services/keyboardShortcuts';
import {
  linkKeyOf, toLinkCandidates, loadDistributorRanks, purchaseCountFor, type DistributorRank
} from '../utils/pharmarackLinkCandidates';

/**
 * CRM "Link distributor" window: left = the medicine and its linked Pharmarack
 * distributor products in PRIORITY order, right = Pharmarack search (mapped
 * distributors only) with a tick-list. A newly ticked product is placed by how
 * often the shop buys from that distributor (auto priority); ▲▼ overrides.
 * Save replaces the links (PUT /refills/medicine-links/:id) and never touches
 * the cart. The refill cart run uses: linked distributor already in the cart,
 * else the first in-stock one in this priority order.
 */

type LocalApiError = { response?: { data?: { error?: string } }; message?: string };

const toPick = (c: RefillCartCandidate): RefillCartPick => ({
  storeId: c.storeId, storeName: c.storeName, productCode: c.productCode, productId: c.productId,
  productName: c.productName, packaging: c.packaging, company: c.company, mapped: c.mapped
});

export const MedicineLinkModal: React.FC<{
  medicineId: number;
  medicineName: string;
  /** Products already fetched by the caller (refill cart popup) — shown without a new search. */
  initialResults?: RefillCartCandidate[];
  onSaved?: (linkedDistributors?: string[]) => void;
  onClose: () => void;
}> = ({ medicineId, medicineName, initialResults, onSaved, onClose }) => {
  useModalEscape(true, onClose);
  const [selected, setSelected] = useState<RefillCartPick[]>([]);
  const [ranks, setRanks] = useState<DistributorRank[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(true);
  // A failed load shows an empty list; saving it would wipe the real links.
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RefillCartCandidate[]>(() => (initialResults || []).filter(c => c.mapped !== false));
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [distributorFilter, setDistributorFilter] = useState<string | null>(null);

  const topDistributors = React.useMemo(() => {
    return ranks.filter(r => r.purchases > 0).slice(0, 7);
  }, [ranks]);

  const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const displayedResults = React.useMemo(() => {
    if (!distributorFilter) return results;
    const target = norm(distributorFilter);
    return results.filter(c => {
      const store = norm(c.storeName);
      return store.includes(target) || target.includes(store);
    });
  }, [results, distributorFilter]);

  useEffect(() => {
    let alive = true;
    api.getMedicineLinks(medicineId)
      .then(r => { if (alive) setSelected(r.links || []); })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadFailed(true);
        toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Could not load saved distributors', 'error');
      })
      .finally(() => { if (alive) setLoadingLinks(false); });
    void loadDistributorRanks().then(r => { if (alive) setRanks(r); });
    return () => { alive = false; };
  }, [medicineId]);

  // Pharmarack search only after 3+ typed characters (dropdown gating rule), debounced, stale-safe.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchNote('');
      try {
        const data: unknown = await api.searchPharmarack(q, undefined, undefined, ctrl.signal);
        if (ctrl.signal.aborted) return;
        const found = toLinkCandidates(data, new Set());
        setResults(found);
        setSearchNote(found.length ? '' : `No mapped Pharmarack distributor has "${q}". Try another spelling.`);
      } catch (err) {
        if (!ctrl.signal.aborted) setSearchNote((err as LocalApiError).response?.data?.error || 'Pharmarack search failed. Try again.');
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [query]);

  const selectedKeys = new Set(selected.map(linkKeyOf));
  const bought = (storeName: string) => purchaseCountFor(storeName, ranks);
  // Auto priority: a newly ticked product goes above the first linked one bought from less often.
  const toggle = (c: RefillCartCandidate) => {
    const k = linkKeyOf(c);
    setSelected(prev => {
      if (prev.some(p => linkKeyOf(p) === k)) return prev.filter(p => linkKeyOf(p) !== k);
      const n = bought(c.storeName);
      const at = prev.findIndex(p => bought(p.storeName) < n);
      return at === -1 ? [...prev, toPick(c)] : [...prev.slice(0, at), toPick(c), ...prev.slice(at)];
    });
  };
  const move = (i: number, dir: -1 | 1) => setSelected(prev => {
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const next = [...prev];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const autoOrder = () => setSelected(prev => [...prev].sort((a, b) => bought(b.storeName) - bought(a.storeName)));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.saveMedicineLinks(medicineId, selected);
      const linkedNames = selected.map(p => p.storeName).filter(Boolean);
      toastEvent.trigger(
        res.saved > 0 ? `Saved ${res.saved} distributor(s) for "${medicineName}"` : `"${medicineName}" is no longer linked to any distributor`,
        'success'
      );
      onSaved?.(linkedNames);
      onClose();
    } catch (err) {
      toastEvent.trigger((err as LocalApiError).response?.data?.error || 'Failed to save linked distributors', 'error');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-global-modal bg-black/60 flex items-center justify-center p-3 sm:p-5">
      <div className="bg-bg2 border border-border rounded-2xl w-[95vw] max-w-4xl h-[85vh] min-h-[560px] max-h-[840px] shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col text-text">
        <div className="bg-bg3/80 px-5 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
              <Link2 size={16} />
            </div>
            <div>
              <h3 className="font-extrabold text-text text-sm">Link distributor</h3>
              <p className="text-[11px] text-muted">Search Pharmarack and tick the product(s) this medicine should be ordered as.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-muted hover:text-text hover:bg-bg3 transition-colors cursor-pointer" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 md:grid-cols-5 text-xs">
          {/* Left: the medicine and what is saved */}
          <div className="md:col-span-2 p-4 border-b md:border-b-0 md:border-r border-border space-y-3">
            <div className="rounded-xl bg-bg border border-border p-3">
              <div className="text-[10px] text-muted uppercase tracking-wider font-bold">Medicine</div>
              <div className="text-sm font-extrabold text-text mt-0.5 break-words">{medicineName}</div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="text-[10px] text-muted uppercase tracking-wider font-bold">
                  Linked distributors — priority ({selected.length})
                </div>
                {selected.length > 1 && (
                  <button type="button" onClick={autoOrder} className="text-[10px] font-bold text-primary hover:underline cursor-pointer" title="Order by how often you buy from each distributor">
                    Sort by most purchased
                  </button>
                )}
              </div>
              {loadingLinks ? (
                <div className="text-muted flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</div>
              ) : loadFailed ? (
                <div className="text-red-400">Could not load the saved links. Close and reopen before saving.</div>
              ) : selected.length === 0 ? (
                <div className="text-muted">Not linked yet. Search on the right and tick a product.</div>
              ) : (
                <ul className="space-y-1.5">
                  {selected.map((p, i) => (
                    <li key={linkKeyOf(p)} className="flex items-start gap-2 rounded-lg border border-border bg-bg px-2.5 py-1.5">
                      <span className="text-[10px] font-bold text-primary mt-0.5">#{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-text truncate">{p.storeName}</span>
                          {p.company && (
                            <span className="px-1.5 py-0.2 rounded bg-bg3 text-[8.5px] font-medium text-muted border border-border shrink-0 truncate max-w-[110px]" title={p.company}>
                              {p.company}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted truncate mt-0.5">
                          <span className="font-medium text-text">{p.productName}</span>{p.packaging ? ` (${p.packaging})` : ''} · bought {bought(p.storeName)}×
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-0.5 rounded text-muted hover:text-text disabled:opacity-30 cursor-pointer" title="Higher priority">
                          <ChevronUp size={12} />
                        </button>
                        <button type="button" disabled={i === selected.length - 1} onClick={() => move(i, 1)} className="p-0.5 rounded text-muted hover:text-text disabled:opacity-30 cursor-pointer" title="Lower priority">
                          <ChevronDown size={12} />
                        </button>
                      </div>
                      <button type="button" onClick={() => setSelected(prev => prev.filter(x => linkKeyOf(x) !== linkKeyOf(p)))} className="p-0.5 rounded text-muted hover:text-red-400 cursor-pointer" title="Remove this link">
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-[10px] text-muted">
              Only mapped distributors are listed. When a refill is added to the cart, the app uses ONE linked product with stock: the distributor already in your cart, else the first in-stock one in this priority order. Linking never adds to the cart.
            </p>
          </div>

          {/* Right: Pharmarack search + tick-list */}
          <div className="md:col-span-3 p-4 space-y-2 flex flex-col min-h-0">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  if (e.target.value.trim().length < 3) { setResults([]); setSearchNote(''); }
                }}
                className="w-full bg-bg border border-border rounded-lg pl-8 pr-8 py-2 text-xs text-text outline-none focus:border-primary/50"
                placeholder="Type 3+ letters — any spelling — to search Pharmarack"
              />
              {searching && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-primary animate-spin" />}
            </div>

            {/* Top Distributors Quick Filter Chips */}
            {topDistributors.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto dropdown-scroll py-1 shrink-0 select-none">
                <span className="text-[9.5px] font-bold text-muted uppercase tracking-wider shrink-0">Frequent:</span>
                <button
                  type="button"
                  onClick={() => setDistributorFilter(null)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer shrink-0 ${
                    distributorFilter === null
                      ? 'bg-primary text-white border-primary shadow-xs'
                      : 'bg-bg border-border text-muted hover:text-text'
                  }`}
                >
                  All ({results.length})
                </button>
                {topDistributors.map(d => {
                  const isSelected = distributorFilter === d.name;
                  const countForDist = results.filter(c => {
                    const store = norm(c.storeName);
                    const target = norm(d.name);
                    return store.includes(target) || target.includes(store);
                  }).length;
                  return (
                    <button
                      key={d.name}
                      type="button"
                      onClick={() => setDistributorFilter(isSelected ? null : d.name)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer shrink-0 flex items-center gap-1 ${
                        isSelected
                          ? 'bg-primary text-white border-primary shadow-xs'
                          : 'bg-bg border-border text-muted hover:text-text hover:border-primary/40'
                      }`}
                      title={`Filter candidates from ${d.name} (Bought ${d.purchases}×)`}
                    >
                      <span className="truncate max-w-[120px]">{d.name}</span>
                      <span className={`text-[9px] font-mono px-1 rounded-full ${isSelected ? 'font-bold opacity-85' : 'bg-bg3 text-muted'}`}>
                        {d.purchases}×{results.length > 0 ? ` (${countForDist})` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {query.trim().length < 3 && (
              <button type="button" onClick={() => setQuery(medicineName)} className="self-start px-2.5 py-1 rounded-lg bg-bg3 border border-border text-text hover:border-primary/40 text-[11px] font-bold cursor-pointer">
                Search “{medicineName}”
              </button>
            )}
            {searchNote && <div className="text-[11px] text-muted">{searchNote}</div>}

            {results.length > 0 && (
              <div className="flex flex-col max-h-[50vh] rounded-lg border border-border bg-bg2 overflow-hidden">
                <div className="px-3 py-1.5 bg-bg3 shrink-0 border-b border-border/40 text-[10.5px] text-muted flex items-center justify-between select-none">
                  <span className="font-semibold text-text">
                    Matching Live Candidates ({displayedResults.length}{distributorFilter ? ` of ${results.length}` : ''})
                  </span>
                  <span className="text-[9.5px] text-muted font-mono uppercase">Distributor Links</span>
                </div>
                <ul className="flex-1 min-h-0 overflow-y-auto dropdown-scroll divide-y divide-border/40">
                  {displayedResults.map(c => {
                    const k = linkKeyOf(c);
                    return (
                      <li key={k}>
                        <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-bg3/60 transition-colors">
                          <input type="checkbox" checked={selectedKeys.has(k)} onChange={() => toggle(c)} className="accent-primary shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[11.5px] font-bold text-text truncate">
                                {c.productName}
                              </span>
                              {c.packaging && (
                                <span className="text-muted text-[10px] shrink-0 font-normal">
                                  ({c.packaging})
                                </span>
                              )}
                              {c.company && (
                                <span className="px-1.5 py-0.2 rounded bg-bg3 text-[9px] font-semibold text-text border border-border shrink-0 truncate max-w-[130px]" title={c.company}>
                                  {c.company}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted truncate mt-0.5">
                              <span className="font-semibold text-text truncate">{c.storeName}</span>
                              <span>·</span>
                              <span className="shrink-0">bought {bought(c.storeName)}×</span>
                              {c.rate != null && (
                                <>
                                  <span>·</span>
                                  <span className="font-mono font-medium text-emerald-400 shrink-0">PTR ₹{c.rate}</span>
                                </>
                              )}
                              {c.mrp != null && (
                                <>
                                  <span>·</span>
                                  <span className="font-mono text-muted shrink-0">MRP ₹{c.mrp}</span>
                                </>
                              )}
                              {c.scheme && (
                                <>
                                  <span>·</span>
                                  <span className="text-amber-400 font-medium shrink-0">{c.scheme}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${c.inStock ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
                            {c.inStock ? `stock ${c.stock}` : 'out of stock'}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border bg-bg3/40 flex items-center justify-end gap-2 shrink-0 text-[11px]">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg bg-bg3 border border-border text-text font-bold cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || loadingLinks || loadFailed}
            onClick={() => void save()}
            className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1"
          >
            {saving && <Loader2 size={11} className="animate-spin" />} Save links ({selected.length})
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
