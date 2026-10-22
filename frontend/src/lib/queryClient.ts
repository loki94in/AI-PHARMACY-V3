import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity, // Pure event-driven freshness via SSE; eliminates timer-based wake-up refetch storms
      gcTime: 24 * 60 * 60 * 1000, // 24 hours — persistent memory cache prevents white screen and eliminates cold fetch delays
      refetchOnWindowFocus: false,
      refetchOnMount: false, // Serve instant cached data on page switch without mounting delay
      retry: 1,
      refetchOnReconnect: false,
    },
  },
});