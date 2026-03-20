import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Loader2, PlugZap, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { connectGoogleService, disconnectGoogleService, listGoogleConnections } from '@/lib/google-api';

const SERVICE_META = {
  drive: {
    title: 'Google Drive',
    description: 'Drive-backed attachments and file links.',
  },
  docs: {
    title: 'Google Docs',
    description: 'Create docs directly from cards.',
  },
  calendar: {
    title: 'Google Calendar',
    description: 'Fetch, create, and manage calendar events.',
  },
  tasks: {
    title: 'Google Tasks',
    description: 'Reminder sync for linked tasks and checklists.',
  },
};

export default function GoogleConnectionsPanel() {
  const queryClient = useQueryClient();
  const [busyService, setBusyService] = useState('');

  const connectionsQuery = useQuery({
    queryKey: ['google-connections'],
    queryFn: listGoogleConnections,
    staleTime: 30_000,
  });

  useEffect(() => {
    const handleMessage = (event) => {
      if (event?.data?.type !== 'lifeos-google-oauth-complete') return;
      queryClient.invalidateQueries({ queryKey: ['google-connections'] });
      toast.success(`Google ${event.data.service} connected.`);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [queryClient]);

  const connections = useMemo(
    () => (connectionsQuery.data || []).map((entry) => ({
      ...entry,
      meta: SERVICE_META[entry.service],
    })),
    [connectionsQuery.data],
  );

  const handleConnect = async (service) => {
    setBusyService(service);
    try {
      const result = await connectGoogleService(service);
      const popup = window.open(result.authUrl, `lifeos-google-${service}`, 'popup,width=540,height=760');
      if (!popup) {
        window.location.assign(result.authUrl);
      }
    } catch (error) {
      toast.error(error?.message || `Failed to start Google ${service} connection.`);
    } finally {
      setBusyService('');
    }
  };

  const handleDisconnect = async (service) => {
    setBusyService(service);
    try {
      await disconnectGoogleService(service);
      queryClient.invalidateQueries({ queryKey: ['google-connections'] });
      toast.success(`Google ${service} disconnected.`);
    } catch (error) {
      toast.error(error?.message || `Failed to disconnect Google ${service}.`);
    } finally {
      setBusyService('');
    }
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Google Connections</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect each service once so Calendar, Docs, Drive links, and Tasks reminders run through your backend.
          </p>
        </div>
        {connectionsQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="mt-4 space-y-3">
        {connections.map((connection) => {
          const isConnected = connection.status === 'connected';
          const isBusy = busyService === connection.service;

          return (
            <div key={connection.service} className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-secondary/20 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{connection.meta?.title || connection.service}</p>
                  {isConnected ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/30 px-2 py-0.5 text-[11px] text-muted-foreground">
                      Disconnected
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{connection.meta?.description}</p>
              </div>
              {isConnected ? (
                <Button type="button" variant="outline" size="sm" onClick={() => handleDisconnect(connection.service)} disabled={isBusy}>
                  {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}
                  Disconnect
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => handleConnect(connection.service)} disabled={isBusy}>
                  {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                  Connect
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <a
        href="https://myaccount.google.com/permissions"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Review Google app permissions <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
