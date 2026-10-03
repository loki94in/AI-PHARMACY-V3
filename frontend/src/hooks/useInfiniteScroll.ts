import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';

// Shared server-filter contract across all pages that page through lists via
// this hook (Inventory, Sells, PurchaseHistory, CustomerReturnHistory,
// Investigation). Keys are optional so each page passes only its own subset.
export interface InfiniteScrollFilters {
  search?: string;
  start?: string;
  end?: string;
  medicine?: string;
  id?: string;
  batch?: string;
  expiry?: string;
  packs?: string;
  loose?: string;
  mrp?: string;
  rack?: string;
  stock_filter?: string;
  online_filter?: string;
  date_from?: string;
  date_to?: string;
  min_amount?: string;
  max_amount?: string;
  payment_medium?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  medicineName?: string;
  batchNo?: string;
  reference?: string;
  party?: string;
}

// Aggregate metadata a fetchPage may return alongside rows (PurchaseHistory
// returns totalAmount; other pages omit meta entirely).
export interface InfiniteScrollMeta {
  totalAmount?: number;
}

interface UseInfiniteScrollOptions<T> {
  queryKey: string;
  cacheKey: string;
  fetchPage: (pageParam: number, filters: InfiniteScrollFilters) => Promise<{ data: T[]; totalItems: number; totalPages: number; meta?: InfiniteScrollMeta }>;
  serverFilters?: InfiniteScrollFilters;
  clientFilterFn?: (item: T) => boolean;
  pageSize?: number;
}

const globalModuleCache: Record<string, unknown[]> = {};
const globalTotalItems: Record<string, number> = {};
const globalMeta: Record<string, InfiniteScrollMeta> = {};

export const clearInfiniteScrollCache = (cacheKey?: string, forceEmpty = false) => {
  if (forceEmpty) {
    if (cacheKey) {
      globalModuleCache[cacheKey] = [];
      globalTotalItems[cacheKey] = 0;
    } else {
      Object.keys(globalModuleCache).forEach(k => {
        globalModuleCache[k] = [];
        globalTotalItems[k] = 0;
      });
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('clear-module-cache', { detail: { cacheKey } }));
  }
};

export function useInfiniteScroll<T>({
  queryKey,
  cacheKey,
  fetchPage,
  serverFilters = {},
  clientFilterFn,
}: UseInfiniteScrollOptions<T>) {
  const queryClient = useQueryClient();

  const [items, setItems] = useState<T[]>(() => {
    const cached = globalModuleCache[cacheKey] as T[] | undefined;
    if (cached && cached.length > 0) return cached;
    // Stale-while-revalidate fallback: read existing React Query cache if module cache is empty
    try {
      const existing = queryClient.getQueryData<{ pages: Array<{ data: T[] }> }>([queryKey, serverFilters]);
      if (existing?.pages?.length) {
        const flat = existing.pages.flatMap(p => p.data);
        if (flat.length > 0) {
          globalModuleCache[cacheKey] = flat.slice(0, 200);
          return flat;
        }
      }
    } catch { /* ignore */ }
    return [];
  });

  const [totalItems, setTotalItems] = useState<number>(() => {
    return globalTotalItems[cacheKey] || 0;
  });

  const [meta, setMeta] = useState<InfiniteScrollMeta>(() => {
    return globalMeta[cacheKey] || {};
  });

  // A mounted list is never blanked by clearInfiniteScrollCache(): it keeps its last rows
  // until its own refetch replaces them. Blanking here left kept-alive Inventory/Sells empty
  // after a write, because an identical refetch never re-fired the sync effect below.

  const [prevFilters, setPrevFilters] = useState<InfiniteScrollFilters>(serverFilters);

  // Detect server filter changes to prevent stale flash while the new page loads
  const filtersChanged = useMemo(
    () => JSON.stringify(prevFilters) !== JSON.stringify(serverFilters),
    [prevFilters, serverFilters]
  );

  useEffect(() => {
    if (filtersChanged) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional stale-cache reset on filter change
      setPrevFilters(serverFilters);
      globalModuleCache[cacheKey] = [];
      globalTotalItems[cacheKey] = 0;
      globalMeta[cacheKey] = {};
      setItems([]);
      setTotalItems(0);
      setMeta({});
    }
  }, [filtersChanged, serverFilters, cacheKey]);

  const {
    data,
    dataUpdatedAt,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: [queryKey, serverFilters],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await fetchPage(pageParam, serverFilters);
      return res;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const currentPage = allPages.length;
      if (currentPage >= lastPage.totalPages) {
        return undefined;
      }
      return currentPage + 1;
    },
    staleTime: 1 * 60 * 1000,     // 1 minute
    gcTime: 8 * 60 * 60 * 1000,   // 8 hours — never evict during a full working day
    refetchOnMount: false,         // paint module cache instantly; SSE invalidation refreshes on writes
  });

  // Sync React Query data with local state & module cache. dataUpdatedAt is a dep because an
  // identical refetch keeps the same `data` reference (structural sharing) — every successful
  // fetch must still re-sync rows and refill a module cache emptied by clearInfiniteScrollCache().
  useEffect(() => {
    if (data && data.pages.length > 0) {
      const flat = data.pages.flatMap(page => page.data);
      globalModuleCache[cacheKey] = flat.slice(0, 200); // Cap in-memory module cache to 200 items
      
      const lastPage = data.pages[data.pages.length - 1];
      if (lastPage && typeof lastPage.totalItems === 'number') {
        globalTotalItems[cacheKey] = lastPage.totalItems;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing query data into render state
        setTotalItems(lastPage.totalItems);
      }
      if (lastPage && lastPage.meta) {
        globalMeta[cacheKey] = lastPage.meta;
        setMeta(lastPage.meta);
      }

      setItems(flat);
    }
  }, [data, dataUpdatedAt, cacheKey]);

  // Keep latest dependencies in a ref to avoid stale closures in stable callback
  const latestDepsRef = useRef({ hasNextPage, fetchNextPage, isFetching, isFetchingNextPage });
  useEffect(() => {
    latestDepsRef.current = { hasNextPage, fetchNextPage, isFetching, isFetchingNextPage };
  });

  // intersection observer for loading more items when scrolling to the bottom
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (node) {
      observerRef.current = new IntersectionObserver(entries => {
        const { hasNextPage: hasNext, fetchNextPage: fetchNext, isFetching: fetching, isFetchingNextPage: fetchingNext } = latestDepsRef.current;
        if (entries[0].isIntersecting && hasNext && !fetching && !fetchingNext) {
          fetchNext();
        }
      });
      observerRef.current.observe(node);
    }
  }, []);

  // Optimistic row eviction (e.g. on delete)
  const removeItem = useCallback((predicate: (item: T) => boolean) => {
    setItems(prev => {
      const next = prev.filter(item => !predicate(item));
      globalModuleCache[cacheKey] = next.slice(0, 200);
      return next;
    });
    setTotalItems(prev => Math.max(0, prev - 1));
  }, [cacheKey]);

  // Optimistic row update (e.g. on modify/save)
  const updateItem = useCallback((predicate: (item: T) => boolean, updater: (item: T) => T) => {
    setItems(prev => {
      const next = prev.map(item => predicate(item) ? updater(item) : item);
      globalModuleCache[cacheKey] = next.slice(0, 200);
      return next;
    });
  }, [cacheKey]);

  // Apply synchronous client-side filtering on the retrieved list
  const filteredItems = useMemo(() => {
    return clientFilterFn ? items.filter(clientFilterFn) : items;
  }, [items, clientFilterFn]);

  return {
    items: filteredItems,
    allItems: items,
    totalItems,
    meta,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    sentinelRef,
    removeItem,
    updateItem,
  };
}
