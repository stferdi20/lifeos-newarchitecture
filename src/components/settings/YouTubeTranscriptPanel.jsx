import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Loader2, RefreshCw, ServerCrash, TimerReset, Youtube } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getYouTubeTranscriptSettings,
  getYouTubeTranscriptStatus,
  retryFailedYouTubeTranscripts,
  updateYouTubeTranscriptSettings,
} from '@/lib/youtube-transcript-api';

function StatusDot({ online }) {
  return (
    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.75)]' : 'bg-amber-400'}`} />
  );
}

export default function YouTubeTranscriptPanel() {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState({
    preferred_subtitle_languages: '',
    prefer_manual_captions: true,
    queue_missing_transcripts: true,
    retry_failed_jobs: true,
  });

  const settingsQuery = useQuery({
    queryKey: ['youtube-transcript-settings'],
    queryFn: getYouTubeTranscriptSettings,
  });

  const statusQuery = useQuery({
    queryKey: ['youtube-transcript-status'],
    queryFn: getYouTubeTranscriptStatus,
    refetchInterval: 15000,
  });

  React.useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) return;
    setForm({
      preferred_subtitle_languages: settings.preferred_subtitle_languages || '',
      prefer_manual_captions: settings.prefer_manual_captions ?? true,
      queue_missing_transcripts: settings.queue_missing_transcripts ?? true,
      retry_failed_jobs: settings.retry_failed_jobs ?? true,
    });
  }, [settingsQuery.data]);

  const retryMutation = useMutation({
    mutationFn: retryFailedYouTubeTranscripts,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['youtube-transcript-status'] });
      queryClient.invalidateQueries({ queryKey: ['resources'] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: updateYouTubeTranscriptSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['youtube-transcript-settings'] });
      queryClient.invalidateQueries({ queryKey: ['youtube-transcript-status'] });
    },
  });

  const worker = statusQuery.data?.worker || { online: false, label: 'YouTube Transcript Worker', last_heartbeat_at: null };
  const queue = statusQuery.data?.queue || { queued: 0, processing: 0, failed: 0, items: [] };

  return (
    <div className="rounded-2xl border border-border/40 bg-card/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Youtube className="h-4 w-4 text-red-400" />
            YouTube Transcript System
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Dedicated queue for YouTube transcript recovery and enrichment.
          </p>
        </div>
        {statusQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-border/40 bg-secondary/20 p-3">
        <StatusDot online={worker.online} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {worker.online ? 'YouTube Transcript System is running' : 'YouTube Transcript System is offline'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {worker.last_heartbeat_at
              ? `Last heartbeat ${formatDistanceToNow(new Date(worker.last_heartbeat_at), { addSuffix: true })}`
              : 'No worker heartbeat received yet.'}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${worker.online ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
          {worker.online ? <CheckCircle2 className="h-3 w-3" /> : <ServerCrash className="h-3 w-3" />}
          {worker.online ? 'Running' : 'Offline'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/40 bg-secondary/20 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Queued</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{queue.queued || 0}</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-secondary/20 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Processing</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{queue.processing || 0}</p>
        </div>
        <div className="rounded-xl border border-border/40 bg-secondary/20 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Failed</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{queue.failed || 0}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border/40 bg-secondary/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Transcript Preferences</p>
            <p className="mt-1 text-xs text-muted-foreground">
              These settings shape transcript discovery and are synced to your account.
            </p>
          </div>
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Preferred subtitle languages</span>
            <input
              type="text"
              value={form.preferred_subtitle_languages}
              onChange={(event) => setForm((current) => ({ ...current, preferred_subtitle_languages: event.target.value }))}
              className="h-10 rounded-lg border border-border/50 bg-background px-3 text-sm text-foreground"
              placeholder="en, en-US, en-GB"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.prefer_manual_captions}
              onChange={(event) => setForm((current) => ({ ...current, prefer_manual_captions: event.target.checked }))}
            />
            Prefer manual captions when available
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.queue_missing_transcripts}
              onChange={(event) => setForm((current) => ({ ...current, queue_missing_transcripts: event.target.checked }))}
            />
            Queue missing transcripts automatically
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.retry_failed_jobs}
              onChange={(event) => setForm((current) => ({ ...current, retry_failed_jobs: event.target.checked }))}
            />
            Keep failed jobs available for retry
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Preferences
            </Button>
            {saveMutation.error ? (
              <span className="text-xs text-red-300">{saveMutation.error.message}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching}>
          {statusQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh Status
        </Button>
        <Button type="button" size="sm" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending || !queue.failed}>
          {retryMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TimerReset className="mr-2 h-4 w-4" />}
          Retry Failed Jobs
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pending Items</p>
        {queue.items?.length ? (
          queue.items.slice(0, 6).map((item) => (
            <div key={item.id} className="rounded-xl border border-border/40 bg-secondary/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{item.resource_title}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{item.source_url}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${item.status === 'failed' ? 'bg-red-500/10 text-red-300' : item.status === 'processing' ? 'bg-sky-500/10 text-sky-300' : 'bg-secondary text-muted-foreground'}`}>
                  {item.status}
                </span>
              </div>
              {item.last_error ? <p className="mt-2 text-xs text-amber-200">{item.last_error}</p> : null}
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-border/40 bg-secondary/10 p-3 text-xs text-muted-foreground">
            No pending YouTube transcript jobs right now.
          </div>
        )}
      </div>
    </div>
  );
}
