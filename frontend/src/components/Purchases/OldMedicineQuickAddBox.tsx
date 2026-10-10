import React, { useState, useEffect, useRef } from 'react';
import { History, Search, Plus, Sparkles, X, Star, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { api, type DistributorFrequentRow } from '../../services/api';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';

export interface OldMedicineQuickAddBoxProps {
  selectedDistributor: number | null;
  selectedDistributorName?: string;
  minOrderWarning: string | null;
  minItemsRequired?: number;
  currentValidCount?: number;
  existingMedicineIds: Set<number>;
  onQuickAdd: (medicine: {
    id: number;
    name: string;
    manufacturer?: string;
    rate?: number | string | null;
    mrp?: number | string | null;
    batch_no?: string | null;
    expiry_date?: string | null;
    cgst_per?: number | null;
    sgst_per?: number | null;
    hsn_code?: string | null;
  }) => Promise<void> | void;
}

export const OldMedicineQuickAddBox: React.FC<OldMedicineQuickAddBoxProps> = ({
  selectedDistributor,
  selectedDistributorName,
  minOrderWarning,
  minItemsRequired = 0,
  currentValidCount = 0,
  existingMedicineIds,
  onQuickAdd,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [frequentItems, setFrequentItems] = useState<DistributorFrequentRow[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  useOnClickOutside(containerRef, () => {
    setIsOpen(false);
    setHighlightIndex(-1);
  });

  // Global shortcut Alt+H to focus Quick-Add box
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && e.key.toLowerCase() === 'h') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'h')) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Fetch distributor frequent items whenever distributor changes
  useEffect(() => {
    if (!selectedDistributor || selectedDistributor <= 0) {
      setFrequentItems([]);
      return;
    }
    let alive = true;
    api.getDistributorFrequent(selectedDistributor, { days: 365, limit: 40 })
      .then(res => {
        if (alive) {
          const list = Array.isArray(res?.data) ? res.data : [];
          list.sort((a, b) => (Number(b.bill_count || 0) - Number(a.bill_count || 0)) || (Number(b.total_qty || 0) - Number(a.total_qty || 0)));
          setFrequentItems(list);
        }
      })
      .catch(() => {
        if (alive) setFrequentItems([]);
      });
    return () => { alive = false; };
  }, [selectedDistributor]);

  // Debounced search querying catalog & medicine history
  useEffect(() => {
    const clean = query.trim().replace(/\s+/g, ' ');
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!clean || clean.length < 2) {
      setSearchResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await api.catalogSearch(clean, controller.signal);
        if (Array.isArray(res)) {
          setSearchResults(res);
          setHighlightIndex(-1);
        }
      } catch (err: any) {
        if (err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
          setSearchResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [query]);

  // Items to display in dropdown:
  // If query < 2: show frequent items from this distributor
  // If query >= 2: show catalog search results
  const displayItems = query.trim().length >= 2 ? searchResults : frequentItems;

  const handleSelect = async (item: any) => {
    const medPayload = {
      id: item.id || item.medicine_id,
      name: item.name || item.medicine_name,
      manufacturer: item.manufacturer || '',
      rate: item.cost_price ?? item.last_rate ?? item.rate ?? null,
      mrp: item.mrp ?? item.last_mrp ?? null,
      batch_no: item.last_batch ?? item.batch_no ?? null,
      expiry_date: item.last_expiry ?? item.expiry_date ?? null,
      cgst_per: item.cgst_per ?? item.last_cgst ?? null,
      sgst_per: item.sgst_per ?? item.last_sgst ?? null,
      hsn_code: item.hsn_code ?? item.last_hsn ?? null,
    };
    await onQuickAdd(medPayload);
    setQuery('');
    setIsOpen(false);
    setHighlightIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || displayItems.length === 0) {
      if (e.key === 'ArrowDown') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => (prev < displayItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => (prev > 0 ? prev - 1 : displayItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && displayItems[highlightIndex]) {
        handleSelect(displayItems[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setHighlightIndex(-1);
    }
  };

  const neededCount = minItemsRequired > currentValidCount ? minItemsRequired - currentValidCount : 0;

  return (
    <div ref={containerRef} className="relative z-30 mb-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-bg2 border border-border rounded-xl shadow-xs">
        {/* Left Side: Quick Add Search Input */}
        <div className="relative flex-1 min-w-[280px]">
          <div className="relative flex items-center">
            <div className="absolute left-3 text-muted pointer-events-none flex items-center gap-1">
              <History size={15} className="text-primary" />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedDistributor
                  ? `⚡ Quick Add from Old Medicine List / Past Orders... (Alt+H)`
                  : `⚡ Quick Add from Old Medicine List / Catalog... (Alt+H)`
              }
              className="w-full bg-bg border border-border hover:border-border/80 focus:border-primary rounded-lg pl-9 pr-8 py-1.5 text-xs text-text placeholder:text-muted focus:outline-none transition-colors"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSearchResults([]);
                  inputRef.current?.focus();
                }}
                className="absolute right-2.5 text-muted hover:text-text cursor-pointer p-0.5"
                title="Clear"
              >
                <X size={14} />
              </button>
            ) : loading ? (
              <div className="absolute right-2.5 text-muted pointer-events-none">
                <RefreshCw size={13} className="animate-spin text-primary" />
              </div>
            ) : null}
          </div>

          {/* Results Dropdown */}
          {isOpen && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-bg border border-border rounded-xl shadow-xl max-h-72 overflow-y-auto dropdown-scroll z-50 p-1 space-y-1">
              {query.trim().length < 2 && frequentItems.length > 0 && (
                <div className="px-2.5 py-1 text-[10px] font-bold text-muted uppercase tracking-wider flex items-center gap-1 border-b border-border/50">
                  <Star size={11} className="fill-amber-400 text-amber-400" />
                  Frequently Ordered from {selectedDistributorName || 'this Distributor'}
                </div>
              )}

              {loading && displayItems.length === 0 ? (
                <div className="py-6 flex items-center justify-center gap-2 text-xs text-muted">
                  <RefreshCw size={15} className="animate-spin text-primary" /> Searching medicines...
                </div>
              ) : displayItems.length === 0 ? (
                <div className="py-5 px-3 text-center text-xs text-muted">
                  {query.trim().length >= 2
                    ? `No medicine found matching "${query}".`
                    : selectedDistributor
                    ? `No past purchase history recorded for this distributor. Type to search all medicines.`
                    : `Type medicine name to search previous records.`}
                </div>
              ) : (
                displayItems.map((item, idx) => {
                  const id = item.id || item.medicine_id;
                  const name = item.name || item.medicine_name;
                  const isAlreadyAdded = existingMedicineIds.has(id);
                  const isHighlighted = idx === highlightIndex;
                  const ptr = item.cost_price ?? item.last_rate ?? item.rate;
                  const mrp = item.mrp ?? item.last_mrp;
                  const billCount = item.bill_count;

                  return (
                    <div
                      key={`${id}-${idx}`}
                      onMouseEnter={() => setHighlightIndex(idx)}
                      onClick={() => handleSelect(item)}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-xs ${
                        isHighlighted ? 'bg-primary/10 border border-primary/30' : 'hover:bg-bg3 border border-transparent'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-text truncate">{name}</span>
                          {billCount && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                              <Star size={9} className="fill-amber-400" /> ×{billCount} orders
                            </span>
                          )}
                          {isAlreadyAdded && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
                              <Check size={9} /> on bill
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted truncate mt-0.5">
                          {item.manufacturer ? `${item.manufacturer} · ` : ''}
                          {ptr ? `PTR: ₹${Number(ptr).toFixed(2)}` : ''}
                          {mrp ? ` · MRP: ₹${Number(mrp).toFixed(2)}` : ''}
                          {item.last_expiry ? ` · Exp: ${item.last_expiry}` : ''}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(item);
                        }}
                        className="h-6 px-2 rounded-md bg-primary hover:bg-primary/90 text-white text-[11px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
                      >
                        <Plus size={11} className="stroke-[3]" /> Add
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Right Side: Minimum Order Shortfall Notice */}
        {minOrderWarning && (
          <div
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-2xs shrink-0"
            title="Distributor minimum order requirement"
          >
            <AlertTriangle size={13} className="text-amber-400 shrink-0" />
            <span>
              Min Shortfall: {minOrderWarning}
              {neededCount > 0 ? ` (${neededCount} needed)` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
