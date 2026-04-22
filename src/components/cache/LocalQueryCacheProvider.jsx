import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import {
  restoreLocalQueryCache,
  startLocalQueryCachePersistence,
} from '@/lib/local-query-cache';

export default function LocalQueryCacheProvider({ children }) {
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [hydratedUserId, setHydratedUserId] = useState(null);
  const userId = isAuthenticated ? user?.id || '' : '';

  useEffect(() => {
    let cancelled = false;

    if (isLoadingAuth) return undefined;
    if (!userId) {
      setHydratedUserId('');
      return undefined;
    }

    setHydratedUserId(null);
    restoreLocalQueryCache(queryClient, userId)
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setHydratedUserId(userId);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, queryClient, userId]);

  useEffect(() => {
    if (!userId || hydratedUserId !== userId) return undefined;
    return startLocalQueryCachePersistence(queryClient, userId);
  }, [hydratedUserId, queryClient, userId]);

  if (!isLoadingAuth && userId && hydratedUserId !== userId) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-4 border-slate-200 border-t-slate-800 animate-spin" />
      </div>
    );
  }

  return children;
}
