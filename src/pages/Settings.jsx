import React, { useEffect, useState } from 'react';
import { Database, LogOut, Settings as SettingsIcon, Trash2, UserRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import GoogleConnectionsPanel from '@/components/google/GoogleConnectionsPanel';
import InstagramDownloaderPanel from '@/components/settings/InstagramDownloaderPanel';
import YouTubeTranscriptPanel from '@/components/settings/YouTubeTranscriptPanel';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { clearLocalQueryCache, getLocalQueryCacheInfo } from '@/lib/local-query-cache';

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Settings() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [cacheInfo, setCacheInfo] = useState({ sizeBytes: 0, updatedAt: null, queryCount: 0 });
  const [cacheClearing, setCacheClearing] = useState(false);

  const refreshCacheInfo = () => {
    getLocalQueryCacheInfo(user?.id)
      .then(setCacheInfo)
      .catch(() => setCacheInfo({ sizeBytes: 0, updatedAt: null, queryCount: 0 }));
  };

  useEffect(() => {
    refreshCacheInfo();
  }, [user?.id]);

  const clearCache = async () => {
    setCacheClearing(true);
    try {
      queryClient.clear();
      await clearLocalQueryCache(user?.id);
      refreshCacheInfo();
    } finally {
      setCacheClearing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        description="Manage your connections and preferences"
      />

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <UserRound className="h-4 w-4" />
              Account
            </div>
            <p className="text-base font-medium text-foreground">
              {user?.full_name || user?.name || 'LifeOS user'}
            </p>
            <p className="text-sm text-muted-foreground">
              {user?.email || 'Signed in with Supabase'}
            </p>
          </div>

          <Button variant="outline" className="gap-2" onClick={() => logout(true)}>
            <LogOut className="h-4 w-4" />
            Log Out
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Database className="h-4 w-4" />
              Local Cache
            </div>
            <p className="text-sm text-muted-foreground">
              Stores recently opened section data in this browser for faster reloads.
            </p>
            <p className="text-xs text-muted-foreground">
              {cacheInfo.queryCount} cached views · {formatBytes(cacheInfo.sizeBytes)}
            </p>
          </div>

          <Button variant="outline" className="gap-2" onClick={clearCache} disabled={cacheClearing}>
            <Trash2 className="h-4 w-4" />
            {cacheClearing ? 'Clearing...' : 'Clear Local Cache'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Connections
        </h2>
        <GoogleConnectionsPanel />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Automation
        </h2>
        <InstagramDownloaderPanel />
        <div className="h-2" />
        <YouTubeTranscriptPanel />
      </div>
    </div>
  );
}
