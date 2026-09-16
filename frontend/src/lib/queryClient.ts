import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60_000, // 2 minutes — fast bounce-backs render instantly from cache
      gcTime: 24 * 60 * 60 * 1000, // 24 hours — persistent memory cache prevents white screen and eliminates cold fetch delays
      refetchOnWindowFocus: false,
      refetchOnMount: false, // Serve instant cached data on page switch without mounting delay
      retry: 1,
      refetchOnReconnect: false,
    },
  },
});