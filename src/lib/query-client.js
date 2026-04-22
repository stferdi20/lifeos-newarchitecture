import { QueryClient } from '@tanstack/react-query';

const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_STALE_MS = 60 * 1000;

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			gcTime: DEFAULT_CACHE_MS,
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: DEFAULT_STALE_MS,
		},
	},
});
