import { QueryClient } from '@tanstack/react-query';
import { getLocalQueryCachePolicy, getPersistedQueryPrefixes } from '@/lib/local-query-cache';

const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_STALE_MS = 60 * 1000;

const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			gcTime: DEFAULT_CACHE_MS,
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: DEFAULT_STALE_MS,
		},
	},
});

for (const prefix of getPersistedQueryPrefixes()) {
	const policy = getLocalQueryCachePolicy(prefix);
	if (policy) queryClientInstance.setQueryDefaults([prefix], policy);
}

export { queryClientInstance };
