import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Loader2, Zap, Tag, Sparkles, Store, ShoppingCart, WifiOff, Package } from 'lucide-react';
import { api } from '../services/api';
import { loadDistributorPriority, priorityRankOf } from '../utils/pharmarackLinkCandidates';
import { toastEvent } from '../services/events';
import { useDropdownAutoScroll } from '../hooks/useDropdownAutoScroll';

export interface SuggestionMedicine {
  medicine_name: string;
  shortName?: string;
  fullName?: string;
  isPharmarack?: boolean;
  distributor?: string;
  rate?: number | null;
  mapped?: boolean;
  packaging?: string;
  stock?: string;
  isErrorMessage?: boolean;
  scheme?: string;
  productId?: string | number;
  storeId?: string | number;
  productCode?: string;
  company?: string;
  manufacturer?: string;
  mrp?: number | null;
  isOffline?: boolean;
  cartItemCount?: number;
  cartTotalAmount?: number;
}

type LocalApiError = { response?: { data?: { error?: string; details?: string } }; message?: string };
type LocalPrSearchFallback = { isError: boolean; message: string };
type LocalPrSearchOutcome = LocalPharmarackSearchItem[] | LocalPrSearchFallback;

interface LocalPharmarackSearchItem {
  name: string;
  shortName?: string;
  fullName?: string;
  packaging?: string;
  distributor?: string;
  rate?: number | null;
  mrp?: number | null;
  mapped?: boolean;
  stock?: string;
  scheme?: string;
  productId?: string | number;
  storeId?: string | number;
  productCode?: string;
  company?: string;
  isOffline?: boolean;
}

export interface LiveCartSearchSectionProps {
  initialValue?: string;
  externalQuery?: string;
  qty: number;
  sessionStatus: 'active' | 'restoring' | 'disconnected';
  cartDistributors: Array<{
    storeId: number;
    storeName: string;
    lineTotal: number;
    items?: Array<{ amount?: number; ptr?: number; qty?: number }>;
  }>;
  lastAddedDistributor: string;
  onSelectSuggestion: (med: SuggestionMedicine, allCandidates: SuggestionMedicine[]) => void;
  onClearSelection?: () => void;
  onTopSuggestionChange?: (top: SuggestionMedicine | null) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const MAX_CLIENT_SEARCH_CACHE = 150;
const clientSearchCache = new Map<string, SuggestionMedicine[]>();

const parseScheme = (schemeStr: string | undefined): { buy: number; free: number } | null => {
  if (!schemeStr) return null;
  const match = schemeStr.match(/^(\d+)\+(\d+)$/);
  if (match) {
    return {
      buy: parseInt(match[1]),
      free: parseInt(match[2])
    };
  }
  return null;
};

const getEffectiveRate = (rate: number, schemeStr: string | undefined, qty: number): number => {
  if (!rate) return 0;
  const scheme = parseScheme(schemeStr);
  if (!scheme || qty < scheme.buy) {
    return rate;
  }
  const freeItems = Math.floor(qty / scheme.buy) * scheme.free;
  const totalItems = qty + freeItems;
  return (qty * rate) / totalItems;
};

const getStockTier = (stockStr: string | undefined | null): number => {
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
};

export const LiveCartSearchSection: React.FC<LiveCartSearchSectionProps> = React.memo(({
  initialValue = '',
  externalQuery,
  qty,
  sessionStatus,
  cartDistributors,
  lastAddedDistributor,
  onSelectSuggestion,
  onClearSelection,
  onTopSuggestionChange,
  inputRef: externalInputRef
}) => {
  const [product, setProduct] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<SuggestionMedicine[]>([]);

  useEffect(() => {
    if (onTopSuggestionChange) {
      const topValid = suggestions.find(s => !s.isErrorMessage && s.productId && s.storeId) || null;
      onTopSuggestionChange(topValid);
    }
  }, [suggestions, onTopSuggestionChange]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);

  const localInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || localInputRef;
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const suggestionsListRef = useRef<HTMLUListElement>(null);
  const isSelectingRef = useRef(false);
  const ignoreNextSearchRef = useRef(false);
  const lastToastedQueryRef = useRef<string>('');
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  useDropdownAutoScroll(suggestionsListRef, activeSuggestionIndex, showSuggestions);

  // Pre-warm distributor priority once on mount
  useEffect(() => {
    loadDistributorPriority().catch(() => {});
  }, []);

  // Handle external query transfers (e.g. from bounced/order table click)
  useEffect(() => {
    if (externalQuery !== undefined && externalQuery !== null) {
      ignoreNextSearchRef.current = false;
      isSelectingRef.current = false;
      setProduct(externalQuery);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 30);
    }
  }, [externalQuery, inputRef]);

  // Click outside to dismiss suggestions
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Find min effective rate for Best Rate badge
  const minEffectiveRate = useMemo(() => {
    let min = Infinity;
    suggestions.forEach(item => {
      if (item.isErrorMessage || !item.rate) return;
      const eff = getEffectiveRate(item.rate, item.scheme, qty);
      if (eff < min) {
        min = eff;
      }
    });
    return min;
  }, [suggestions, qty]);

  // Debounced search query execution with instant cache lookup
  useEffect(() => {
    if (isSelectingRef.current || ignoreNextSearchRef.current) {
      ignoreNextSearchRef.current = false;
      return;
    }

    const cleanQuery = product.replace(/\s*\([^)]*\)$/, '').trim();

    if (cleanQuery.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const cacheKey = cleanQuery.toLowerCase();
    const cachedResults = clientSearchCache.get(cacheKey);
    if (cachedResults && cachedResults.length > 0) {
      setSuggestions(cachedResults);
      setShowSuggestions(true);
      setActiveSuggestionIndex(0);
    }

    const delayDebounce = setTimeout(async () => {
      if (isSelectingRef.current) return;
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      searchAbortControllerRef.current = controller;

      if (!cachedResults) {
        setSearchLoading(true);
      }

      try {
        const prData = await api.searchPharmarack(cleanQuery, undefined, undefined, controller.signal).catch((err: unknown): LocalPrSearchOutcome | null => {
          if (controller.signal.aborted) return null;
          const apiErr = err as LocalApiError;
          const errMsg = apiErr?.response?.data?.error || 'Connection error, please check internet or reconnect';
          return { isError: true, message: errMsg };
        }) as LocalPrSearchOutcome | null;

        if (searchAbortControllerRef.current !== controller || controller.signal.aborted || isSelectingRef.current) return;

        const mergedList: SuggestionMedicine[] = [];

        if (prData && !(prData as LocalPrSearchFallback).isError && Array.isArray(prData) && prData.length > 0) {
          const activeCartMap = new Map<string, { storeId: number; count: number; total: number; name: string }>();
          cartDistributors.forEach(d => {
            if (d.items && d.items.length > 0) {
              const count = d.items.length;
              const total = d.lineTotal || d.items.reduce((sum, item) => sum + (item.amount || 0), 0);
              if (d.storeId) {
                activeCartMap.set(String(d.storeId), { storeId: d.storeId, count, total, name: d.storeName });
              }
              if (d.storeName) {
                activeCartMap.set(d.storeName.toLowerCase().trim(), { storeId: d.storeId, count, total, name: d.storeName });
              }
            }
          });

          prData.forEach((item) => {
            const displayName = item.shortName || item.name;
            const cartInfo = (item.storeId && activeCartMap.get(String(item.storeId))) ||
                             (item.distributor && activeCartMap.get(item.distributor.toLowerCase().trim()));

            mergedList.push({
              medicine_name: displayName,
              shortName: item.shortName || item.name,
              fullName: item.fullName || item.name,
              mrp: item.mrp,
              isPharmarack: true,
              distributor: item.distributor,
              rate: item.rate,
              mapped: item.mapped,
              packaging: item.packaging,
              stock: item.stock,
              scheme: item.scheme,
              productId: item.productId,
              storeId: item.storeId,
              productCode: item.productCode,
              company: item.company,
              isOffline: item.isOffline,
              cartItemCount: cartInfo ? cartInfo.count : undefined,
              cartTotalAmount: cartInfo ? cartInfo.total : undefined
            });
          });

          const distPrio = await loadDistributorPriority();
          const lastDist = (lastAddedDistributor || localStorage.getItem('pharmarack_last_added_distributor') || '').toLowerCase().trim();
          const cleanQ = cleanQuery.toLowerCase().trim();

          if (mergedList.length > 1) {
            mergedList.sort((a, b) => {
              if (a.isErrorMessage || b.isErrorMessage) return 0;

              // 1. Mapped Wall
              const aMapped = Boolean(a.mapped);
              const bMapped = Boolean(b.mapped);
              if (aMapped !== bMapped) return aMapped ? -1 : 1;

              // 2. Exact Title
              const aName = (a.medicine_name || a.shortName || '').toLowerCase().trim();
              const bName = (b.medicine_name || b.shortName || '').toLowerCase().trim();
              const aExact = aName === cleanQ || aName.startsWith(cleanQ + ' ');
              const bExact = bName === cleanQ || bName.startsWith(cleanQ + ' ');
              if (aExact && !bExact) return -1;
              if (!aExact && bExact) return 1;

              const qWords = cleanQ.split(/\s+/).filter(w => w.length >= 2);
              if (qWords.length > 1) {
                let aMatches = 0;
                let bMatches = 0;
                for (const w of qWords) {
                  if (aName.includes(w)) aMatches++;
                  if (bName.includes(w)) bMatches++;
                }
                if (aMatches !== bMatches) return bMatches - aMatches;
              }

              // 3. Stock Tier
              const aStock = getStockTier(a.stock);
              const bStock = getStockTier(b.stock);
              if (aStock !== bStock) return bStock - aStock;

              // 3b. Distributor Priority
              const aPrio = priorityRankOf(a.distributor, distPrio);
              const bPrio = priorityRankOf(b.distributor, distPrio);
              if (aPrio !== bPrio) return aPrio - bPrio;

              // 4. In Active Live Cart
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

              // 5. Recent Distributor
              if (lastDist) {
                const aMatch = (a.distributor || '').toLowerCase().includes(lastDist);
                const bMatch = (b.distributor || '').toLowerCase().includes(lastDist);
                if (aMatch && !bMatch) return -1;
                if (!aMatch && bMatch) return 1;
              }

              // 6. Rate
              if (a.rate && b.rate && a.rate !== b.rate) {
                return a.rate - b.rate;
              }

              return 0;
            });
          }
        } else if (prData && (prData as LocalPrSearchFallback).isError) {
          mergedList.push({
            medicine_name: `⚠️ ${(prData as LocalPrSearchFallback).message}`,
            isPharmarack: true,
            isErrorMessage: true
          });
        } else {
          if (cleanQuery.length >= 3 && cleanQuery !== lastToastedQueryRef.current) {
            toastEvent.trigger('No mapped distributor has product', 'info');
            lastToastedQueryRef.current = cleanQuery;
          }
        }

        // Cache valid response
        if (mergedList.length > 0 && !mergedList[0].isErrorMessage) {
          if (clientSearchCache.size >= MAX_CLIENT_SEARCH_CACHE) {
            const firstKey = clientSearchCache.keys().next().value;
            if (firstKey) clientSearchCache.delete(firstKey);
          }
          clientSearchCache.set(cacheKey, mergedList);
        }

        if (isSelectingRef.current) return;
        setSuggestions(mergedList);
        setShowSuggestions(mergedList.length > 0);
        setActiveSuggestionIndex(prev => (prev >= 0 && prev < mergedList.length ? prev : (mergedList.length > 0 ? 0 : -1)));
      } catch (err) {
        console.error('Error searching Pharmarack catalog:', err);
      } finally {
        if (searchAbortControllerRef.current === controller) {
          setSearchLoading(false);
        }
      }
    }, 120); // Snappy 120ms debounce for near-instant typing feedback

    return () => {
      clearTimeout(delayDebounce);
    };
  }, [product, cartDistributors, lastAddedDistributor]);

  const handleProductChange = (val: string) => {
    isSelectingRef.current = false;
    setProduct(val);
    if (onClearSelection) {
      onClearSelection();
    }
  };

  const selectSuggestion = useCallback((med: SuggestionMedicine) => {
    if (med.isErrorMessage) return;
    isSelectingRef.current = true;
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    ignoreNextSearchRef.current = true;

    setProduct(med.medicine_name);
    setShowSuggestions(false);
    setActiveSuggestionIndex(-1);

    const validCandidates = suggestions.filter(s => !s.isErrorMessage);
    onSelectSuggestion(med, validCandidates);
  }, [suggestions, onSelectSuggestion]);

  const handleProductKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev + 1) % suggestions.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
    }

    if (e.key === 'Enter' || (e.key === 'Tab' && showSuggestions)) {
      if (showSuggestions && suggestions.length > 0) {
        const targetIdx = activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0;
        if (targetIdx < suggestions.length && !suggestions[targetIdx].isErrorMessage) {
          e.preventDefault();
          selectSuggestion(suggestions[targetIdx]);
        }
      }
    }

    if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  // Render top 30 items for ultra-light DOM tree & fast CPU rasterization
  const visibleSuggestions = useMemo(() => suggestions.slice(0, 30), [suggestions]);

  return (
    <div className="relative z-50 animate-in fade-in duration-200" ref={autocompleteRef}>
      <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">Medicine Search</label>
      <div className="relative">
        <span className="absolute left-3.5 top-[13px] text-muted">
          {searchLoading ? <Loader2 size={16} className="animate-spin text-primary" /> : <Search size={16} />}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={product}
          onChange={(e) => handleProductChange(e.target.value)}
          onKeyDown={handleProductKeyDown}
          className="w-full premium-input pl-11 pr-5 py-3 text-sm font-semibold rounded-2xl"
          placeholder="Search or enter medicine name..."
          autoComplete="off"
        />
      </div>

      {sessionStatus === 'restoring' && !showSuggestions && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-xl animate-in fade-in">
          <Loader2 size={12} className="animate-spin shrink-0 text-amber-400" />
          <span>Reconnecting live Pharmarack session in background… suggestions will appear automatically once ready.</span>
        </div>
      )}

      {showSuggestions && visibleSuggestions.length > 0 && (
        <div className="absolute z-[9999] left-0 right-0 mt-1.5 max-h-[520px] md:max-h-[calc(80vh-210px)] flex flex-col bg-bg2 border-2 border-primary/40 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden">
          {!visibleSuggestions[0]?.isErrorMessage && (
            <div className="px-3.5 py-1.5 bg-bg3 shrink-0 border-b border-border/40 text-[10.5px] text-muted flex items-center justify-between select-none">
              <span className="flex items-center gap-1.5 font-medium">
                <Zap size={12} className="text-primary shrink-0" />
                <span>Found <strong className="text-text font-bold">{suggestions.filter(s => !s.isErrorMessage).length}</strong> distributor options</span>
              </span>
              <span className="text-[9.5px] text-muted font-mono font-semibold uppercase tracking-wider">Live Distributor Data</span>
            </div>
          )}
          <ul ref={suggestionsListRef} className="flex-1 min-h-0 overflow-y-auto dropdown-scroll divide-y divide-border/30 py-1">
            {visibleSuggestions.map((med, index) => (
              <li
                key={index}
                data-highlighted={index === activeSuggestionIndex ? "true" : "false"}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSuggestion(med);
                }}
                className={`px-3.5 py-2.5 text-xs cursor-pointer flex justify-between items-center transition-all ${
                  med.isErrorMessage
                    ? 'bg-red-500/10 text-red border-l-2 border-red cursor-default'
                    : index === activeSuggestionIndex 
                    ? 'bg-primary/20 text-text font-bold border-l-4 border-primary ring-1 ring-primary/40' 
                    : 'text-muted hover:text-text hover:bg-bg3/60'
                }`}
              >
                <div className="flex-1 min-w-0 pr-2">
                  {/* Line 1: Product name + In Cart badge + scheme badge + Best Rate badge */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-text truncate text-sm">
                      {med.medicine_name}
                    </span>
                    {med.cartItemCount !== undefined && med.cartItemCount > 0 && (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-md font-bold uppercase flex items-center gap-1 shrink-0 select-none animate-in fade-in">
                        <ShoppingCart size={10} className="text-emerald-400" /> In Cart ({med.cartItemCount} items • ₹{Math.round(med.cartTotalAmount || 0)})
                      </span>
                    )}
                    {med.scheme && !med.isErrorMessage && (
                      <span className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-md font-bold uppercase shrink-0 flex items-center gap-1">
                        <Tag size={10} /> {med.scheme}
                      </span>
                    )}
                    {med.rate !== undefined && med.rate !== null && !med.isErrorMessage && getEffectiveRate(med.rate, med.scheme, qty) === minEffectiveRate && (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-md font-bold uppercase flex items-center gap-0.5 shrink-0 select-none">
                        <Sparkles size={9} className="text-emerald-400 animate-pulse" /> Best Rate
                      </span>
                    )}
                  </div>

                  {/* Line 2: Distributor name + company */}
                  {!med.isErrorMessage && (
                    <div className="flex items-center gap-2 flex-wrap mt-1 text-xs">
                      <span className={`font-semibold flex items-center gap-1 ${ med.isPharmarack ? (med.mapped ? 'text-sky-400' : 'text-purple-400') : 'text-muted' }`}>
                        <Store size={11} /> {med.isPharmarack ? (med.distributor || 'No Distributor') : 'Local Inventory'}
                        {med.isPharmarack && med.mapped && (
                          <span className="text-[8.5px] px-1 py-0.2 rounded bg-sky-500/15 text-sky-400 border border-sky-500/25 uppercase font-bold tracking-wider">
                            Mapped
                          </span>
                        )}
                      </span>
                      {(med.company || med.manufacturer) && (
                        <span className="text-[10px] text-muted/70 font-semibold uppercase tracking-wider">
                          • {med.company || med.manufacturer}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Line 3: PTR, MRP, packaging & stock pill */}
                  {!med.isErrorMessage && (
                    <div className="flex items-center gap-2.5 text-[11px] mt-1 flex-wrap">
                      {med.rate !== undefined && med.rate !== null && (
                        <span className="font-bold text-emerald-400 font-mono">PTR: ₹{med.rate}</span>
                      )}
                      {med.mrp !== undefined && med.mrp !== null && (
                        <span className="text-muted font-mono">MRP: ₹{med.mrp}</span>
                      )}
                      {med.packaging && (
                        <span className="text-muted font-mono font-semibold">{med.packaging}</span>
                      )}
                      {med.stock !== undefined && (
                        (med.isOffline || String(med.stock).toLowerCase() === 'offline') ? (
                          <span className="font-bold font-mono px-1.5 py-0.5 rounded-md text-[10px] flex items-center gap-1 bg-bg3 text-muted border border-border" title="Saved Offline History">
                            <WifiOff size={10} className="text-muted" /> Offline
                          </span>
                        ) : (
                          <span className={`font-bold font-mono px-1.5 py-0.5 rounded-md text-[10px] flex items-center gap-1 ${
                            (med.stock.toLowerCase() === 'high' || parseInt(med.stock) >= 15)
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : (med.stock.toLowerCase() === 'low' || parseInt(med.stock) > 0)
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-red-500/10 text-red border-red-500/20'
                          }`}>
                            <Package size={10} /> {med.stock}
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>
                {index === activeSuggestionIndex && !med.isErrorMessage && (
                  <span className="text-[11px] bg-primary text-white font-bold px-2 py-1 rounded-lg shadow-sm shrink-0 flex items-center gap-1">
                    ↵ Enter
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

LiveCartSearchSection.displayName = 'LiveCartSearchSection';
