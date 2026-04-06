import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ArrowUpRight, Microscope, Newspaper, RefreshCw, Sparkles, Waves } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchNewsDigest as fetchNewsDigestApi } from '@/lib/news-api';
import { cn, formatUiLabel } from '@/lib/utils';

const DIGEST_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'ai', label: 'AI' },
  { key: 'ai_research', label: 'AI Research' },
  { key: 'tech', label: 'Tech' },
  { key: 'startups', label: 'Startups' },
  { key: 'crypto', label: 'Crypto' },
];

const catColors = {
  all: 'text-slate-100 bg-slate-400/10 border-slate-300/20',
  ai: 'text-fuchsia-200 bg-fuchsia-500/10 border-fuchsia-400/20',
  ai_research: 'text-cyan-200 bg-cyan-500/10 border-cyan-400/20',
  tech: 'text-sky-200 bg-sky-500/10 border-sky-400/20',
  startups: 'text-emerald-200 bg-emerald-500/10 border-emerald-400/20',
  crypto: 'text-amber-200 bg-amber-500/10 border-amber-400/20',
  general: 'text-slate-100 bg-slate-400/10 border-slate-300/20',
};

function getLocalYesterdayDate() {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = `${yesterday.getMonth() + 1}`.padStart(2, '0');
  const day = `${yesterday.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatGeneratedAt(value) {
  if (!value) return '';
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return '';
  }
}

function formatDigestDate(dateString) {
  if (!dateString) return 'Yesterday';

  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(`${dateString}T12:00:00`));
  } catch {
    return 'Yesterday';
  }
}

function formatArticleTime(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

export default function NewsWidget() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const digestDate = useMemo(() => getLocalYesterdayDate(), []);

  const {
    data,
    error,
    isError,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['news-digest-widget', digestDate, selectedCategory],
    queryFn: () => fetchNewsDigestApi({ date: digestDate, category: selectedCategory }),
    staleTime: 30 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  const supportingArticles = data?.article_refs || [];
  const keyPoints = data?.key_points?.slice(0, 3) || [];
  const showNoDigestYet = isError && String(error?.message || '').toLowerCase().includes('no digest is available');

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(217,70,239,0.14),_transparent_28%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(8,15,29,0.96))] p-5 text-white shadow-[0_24px_60px_rgba(2,6,23,0.42)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_35%,transparent_70%,rgba(255,255,255,0.03))]" />

      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.28em] text-sky-100/80">
              <Waves className="h-3.5 w-3.5 text-sky-300" />
              Daily briefing
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl border border-sky-300/15 bg-sky-400/10 p-2.5">
                <Newspaper className="h-5 w-5 text-sky-300" />
              </div>
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-white">Daily News Digest</h3>
                <p className="mt-1 text-sm text-slate-300">
                  A calmer read on yesterday&apos;s most important stories, grouped by category.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
            aria-label="Refresh digest"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {DIGEST_CATEGORIES.map((category) => (
            <button
              key={category.key}
              onClick={() => setSelectedCategory(category.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
                selectedCategory === category.key
                  ? (catColors[category.key] || catColors.all)
                  : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:bg-white/[0.06] hover:text-white',
              )}
            >
              {category.label}
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="flex min-h-[320px] flex-1 items-center justify-center">
            <div className="h-6 w-6 rounded-full border-2 border-white/15 border-t-sky-300 animate-spin" />
          </div>
        )}

        {showNoDigestYet && !isLoading && (
          <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center text-center">
            <Sparkles className="mb-3 h-9 w-9 text-sky-300/80" />
            <p className="text-lg font-medium text-white">No digest yet</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-300">
              The morning digest job has not saved a snapshot for this category yet.
            </p>
          </div>
        )}

        {isError && !isLoading && !showNoDigestYet && (
          <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center text-center">
            <p className="text-lg font-medium text-white">Digest unavailable</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-300">
              {error?.message || 'The digest request failed.'}
            </p>
          </div>
        )}

        {!isLoading && !isError && data && (
          <div className="mt-5 flex flex-1 flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Category</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]', catColors[data.category] || catColors.all)}>
                    {formatUiLabel(data.category)}
                  </span>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Snapshot</p>
                <p className="mt-2 text-lg font-semibold text-white">{formatDigestDate(data.digest_date)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Coverage</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {(data.article_count || 0).toLocaleString()} stories
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  from {(data.source_count || 0).toLocaleString()} sources
                </p>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] px-5 py-5">
              <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                <span>Lead summary</span>
                {data.generated_at && <span>Updated {formatGeneratedAt(data.generated_at)}</span>}
              </div>
              <p className="mt-3 text-[15px] leading-7 text-slate-100">
                {data.headline_summary}
              </p>
            </div>

            {data.degraded && (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
                Coverage is lighter than usual for this category, so this digest is intentionally concise.
              </div>
            )}

            {!!keyPoints.length && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-slate-400">
                  <Microscope className="h-3.5 w-3.5 text-cyan-300" />
                  Key takeaways
                </div>
                <div className="space-y-3">
                  {keyPoints.map((point, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 rounded-2xl border border-white/8 bg-black/10 px-3 py-3"
                    >
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white">
                        {index + 1}
                      </div>
                      <p className="text-sm leading-6 text-slate-200">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Source trail</p>
                  <p className="mt-1 text-sm text-slate-300">The stories that shaped this digest.</p>
                </div>
              </div>

              <div className="space-y-3">
                {supportingArticles.slice(0, 3).map((article, index) => (
                  <a
                    key={article.id || index}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.025))] px-4 py-4 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.075]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={cn('rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]', catColors[article.category] || catColors.general)}>
                            {formatUiLabel(article.category)}
                          </span>
                          <span className="text-[11px] text-slate-400">{article.source_name}</span>
                          {article.published_at && (
                            <span className="text-[11px] text-slate-500">{formatArticleTime(article.published_at)}</span>
                          )}
                        </div>
                        <p className="text-sm font-semibold leading-6 text-white">
                          {article.title}
                        </p>
                        {article.summary && (
                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-300">
                            {article.summary}
                          </p>
                        )}
                      </div>
                      <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-sky-300" />
                    </div>
                  </a>
                ))}

                {!supportingArticles.length && (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center">
                    <p className="text-sm font-medium text-white">No supporting links saved</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      This digest still generated, but there were no validated source cards to attach.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <Link
          to="/News"
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
        >
          View full news page
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
