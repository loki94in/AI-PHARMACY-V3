// Shared recent-search cache (module scope, survives KeepAlive navigation) used by
// every medicine autocomplete. Stale-while-revalidate: an entry past `ttlMs` is
// still returned (`stale: true`) so the caller paints instantly and revalidates
// ONCE in the background. Prefix narrowing also uses stale entries.
export interface RecentSearchCache<T> {
  get: (term: string) => { results: T[]; stale: boolean } | null;
  set: (term: string, results: T[]) => void;
  /** Longest cached term that is a strict prefix of `term` (rows are a superset to narrow locally). */
  longestPrefix: (term: string) => T[] | null;
  clear: () => void;
}

export const normalizeSearchKey = (term: string): string => term.toLowerCase().replace(/\s+/g, ' ').trim();

export const createRecentSearchCache = <T>(ttlMs: number, maxEntries = 40): RecentSearchCache<T> => {
  const map = new Map<string, { at: number; results: T[] }>();
  return {
    get(term) {
      const entry = map.get(normalizeSearchKey(term));
      if (!entry) return null;
      return { results: entry.results, stale: Date.now() - entry.at >= ttlMs };
    },
    set(term, results) {
      const key = normalizeSearchKey(term);
      if (!key) return;
      map.delete(key); // re-insert = LRU touch + fresh timestamp
      map.set(key, { at: Date.now(), results });
      if (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
    },
    longestPrefix(term) {
      const target = normalizeSearchKey(term);
      let bestKey = '';
      let best: T[] | null = null;
      for (const [key, entry] of map) {
        if (key !== target && target.startsWith(key) && key.length > bestKey.length && entry.results.length > 0) {
          bestKey = key;
          best = entry.results;
        }
      }
      return best;
    },
    clear() {
      map.clear();
    },
  };
};
