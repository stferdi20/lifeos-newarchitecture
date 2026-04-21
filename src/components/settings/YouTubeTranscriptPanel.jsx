import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ServerCrash, TimerReset, Trash2, Youtube } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getYouTubeTranscriptSettings,
  getYouTubeTranscriptStatus,
  removeYouTubeTranscriptJob,
  retryFailedYouTubeTranscripts,
  updateYouTubeTranscriptSettings,
} from '@/lib/youtube-transcript-api';

function getWorkerPresentation(state = 'offline') {
  switch (state) {
    case 'online':
      return {
        dotClass: 'bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.75)]',
        badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        icon: CheckCircle2,
        label: 'Running',
        summary: 'YouTube Transcript System is running',
      };
    case 'stale':
      return {
        dotClass: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.55)]',
        badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
        icon: AlertTriangle,
        label: 'Stale',
        summary: 'Worker heartbeat is stale. Queue recovery is active.',
      };
    default:
      return {
        dotClass: 'bg-rose-400',
        badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
        icon: ServerCrash,
        label: 'Offline',
        summary: 'YouTube Transcript System is offline',
      };
  }
}

function StatusDot({ state }) {
  const presentation = getWorkerPresentation(state);
  return (
    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${presentation.dotClass}`} />
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

  const removeMutation = useMutation({
    mutationFn: removeYouTubeTranscriptJob,
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

  const worker = statusQuery.data?.worker || { online: false, state: 'offline', label: 'YouTube Transcript Worker', last_heartbeat_at: null };
  const workerState = worker.state || (worker.online ? 'online' : 'offline');
  const workerPresentation = getWorkerPresentation(workerState);
  const WorkerStateIcon = workerPresentation.icon;
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
        <StatusDot state={workerState} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {workerPresentation.summary}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {worker.last_heartbeat_at
              ? `Last heartbeat ${formatDistanceToNow(new Date(worker.last_heartbeat_at), { addSuffix: true })}`
              : 'No worker heartbeat received yet.'}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${workerPresentation.badgeClass}`}>
          <WorkerStateIcon className="h-3 w-3" />
          {workerPresentation.label}
        </span>
      </div>

      {queue.recovered ? (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {queue.recovered} queued job{queue.recovered !== 1 ? 's were' : ' was'} auto-recovered after a stale worker heartbeat.
        </div>
      ) : null}

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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{item.resource_title}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{item.source_url}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${item.status === 'failed' ? 'bg-red-500/10 text-red-300' : item.status === 'processing' ? 'bg-sky-500/10 text-sky-300' : 'bg-secondary text-muted-foreground'}`}>
                    {item.status}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    title="Remove from pending"
                    aria-label="Remove from pending"
                    disabled={removeMutation.isPending}
                    onClick={() => {
                      if (window.confirm('Remove this YouTube transcript item from pending?')) {
                        removeMutation.mutate(item.id);
                      }
                    }}
                  >
                    {removeMutation.isPending && removeMutation.variables === item.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              {item.last_error ? <p className="mt-2 text-xs text-amber-200">{item.last_error}</p> : null}
              {item.recovery_reason === 'stale_worker_heartbeat' && item.recovered_at ? (
                <p className="mt-2 text-xs text-amber-100">
                  Auto-requeued {formatDistanceToNow(new Date(item.recovered_at), { addSuffix: true })} after the previous worker heartbeat went stale.
                </p>
              ) : null}
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
