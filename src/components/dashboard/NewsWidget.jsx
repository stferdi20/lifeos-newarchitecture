import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ArrowUpRight, Newspaper, RefreshCw, Sparkles } from 'lucide-react';
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

function firstSentence(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const match = normalized.match(/^(.+?[.!?])(\s|$)/);
  return match ? match[1].trim() : normalized;
}

function trimSummary(value = '', maxLength = 220) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function buildTakeaways(data) {
  const articles = Array.isArray(data?.article_refs) ? data.article_refs : [];
  const rawKeyPoints = Array.isArray(data?.key_points) ? data.key_points : [];

  return articles.slice(0, 3).map((article, index) => {
    const fallbackPoint = rawKeyPoints[index] || rawKeyPoints[0] || '';
    const detail = article.summary && article.summary.length > 90
      ? article.summary
      : fallbackPoint || article.summary || article.title;

    return {
      title: article.title,
      source: article.source_name,
      detail: trimSummary(detail, 240),
    };
  });
}

export default function NewsWidget() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const digestDate = useMemo(() => getLocalYesterdayDate(), []);
  const queryClient = useQueryClient();

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
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  const supportingArticles = data?.article_refs || [];
  const leadArticle = supportingArticles[0] || null;
  const secondaryArticle = supportingArticles[1] || null;
  const takeaways = buildTakeaways(data);
  const showNoDigestYet = isError && String(error?.message || '').toLowerCase().includes('no digest is available');

  useEffect(() => {
    DIGEST_CATEGORIES.forEach((category) => {
      if (category.key === selectedCategory) return;
      queryClient.prefetchQuery({
        queryKey: ['news-digest-widget', digestDate, category.key],
        queryFn: () => fetchNewsDigestApi({ date: digestDate, category: category.key }),
        staleTime: 30 * 60 * 1000,
      });
    });
  }, [digestDate, queryClient, selectedCategory]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-blue-400/10 bg-gradient-to-br from-[#101726] via-card to-card p-4 text-white hover:border-blue-400/20 hover:shadow-lg hover:shadow-blue-400/5 transition-all duration-300">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_28%),radial-gradient(circle_at_top_right,rgba(148,163,184,0.08),transparent_24%)]" />

      <div className="relative flex h-full flex-col">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-blue-300" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold tracking-tight text-white">Daily News Digest</h3>
              <p className="text-[11px] text-muted-foreground">
                Yesterday with context, not just headlines.
              </p>
            </div>
          </div>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
            aria-label="Refresh digest"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {DIGEST_CATEGORIES.map((category) => (
            <button
              key={category.key}
              onClick={() => setSelectedCategory(category.key)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all',
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
          <div className="flex min-h-[220px] flex-1 items-center justify-center">
            <div className="h-5 w-5 rounded-full border-2 border-white/15 border-t-sky-300 animate-spin" />
          </div>
        )}

        {showNoDigestYet && !isLoading && (
          <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center text-center">
            <Sparkles className="mb-3 h-8 w-8 text-sky-300/80" />
            <p className="text-sm font-medium text-white">No digest yet</p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-slate-300">
              The morning digest job has not saved a snapshot for this category yet.
            </p>
          </div>
        )}

        {isError && !isLoading && !showNoDigestYet && (
          <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-white">Digest unavailable</p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-slate-300">
              {error?.message || 'The digest request failed.'}
            </p>
          </div>
        )}

        {!isLoading && !isError && data && (
          <div className="flex flex-1 flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Category</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', catColors[data.category] || catColors.all)}>
                    {formatUiLabel(data.category)}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Snapshot</p>
                <p className="mt-1.5 text-sm font-semibold text-white">{formatDigestDate(data.digest_date)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Coverage</p>
                <p className="mt-1.5 text-sm font-semibold text-white">
                  {(data.article_count || 0).toLocaleString()} stories
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  from {(data.source_count || 0).toLocaleString()} sources
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Updated</p>
                <p className="mt-1.5 text-sm font-semibold text-white">
                  {data.generated_at ? formatGeneratedAt(data.generated_at) : 'Just now'}
                </p>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-12">
              <div className="rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-4 lg:col-span-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Lead story</p>
                  {isFetching && <span className="text-[10px] text-slate-400">Refreshing...</span>}
                </div>
                <p className="mt-2 text-sm font-semibold leading-6 text-white">
                  {leadArticle?.title || data.headline_summary}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  {trimSummary(leadArticle?.summary || data.headline_summary, 360)}
                </p>
                {secondaryArticle && (
                  <div className="mt-3 rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Also driving the category
                    </p>
                    <p className="mt-1 text-xs font-medium leading-5 text-white">{secondaryArticle.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-300">
                      {trimSummary(firstSentence(secondaryArticle.summary), 160)}
                    </p>
                  </div>
                )}
                {data.degraded && (
                  <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-300/10 px-3 py-2.5 text-xs leading-5 text-amber-100">
                    Coverage is lighter than usual for this category, so this digest is more compact than normal.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:col-span-4">
                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Context and takeaways</p>
                  <p className="mt-1 text-[11px] text-slate-400">What happened, and why it matters.</p>
                </div>
                <div className="space-y-2.5">
                  {takeaways.map((takeaway, index) => (
                    <div
                      key={`${takeaway.title}-${index}`}
                      className="rounded-xl border border-white/8 bg-black/10 px-3 py-3"
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium leading-5 text-white">{takeaway.title}</p>
                          <p className="mt-1 text-[11px] text-slate-400">{takeaway.source}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-200">{takeaway.detail}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!takeaways.length && (
                    <p className="text-xs leading-5 text-slate-400">
                      No contextual takeaways were available for this category yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="self-start rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:col-span-3">
                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Source trail</p>
                  <p className="mt-1 text-[11px] text-slate-400">Scroll to inspect the original coverage.</p>
                </div>

                <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
                  {supportingArticles.map((article, index) => (
                    <a
                      key={article.id || index}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block rounded-xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.025))] px-3 py-3 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.075]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', catColors[article.category] || catColors.general)}>
                              {formatUiLabel(article.category)}
                            </span>
                            <span className="text-[10px] text-slate-400">{article.source_name}</span>
                            {article.published_at && (
                              <span className="text-[10px] text-slate-500">{formatArticleTime(article.published_at)}</span>
                            )}
                          </div>
                          <p className="text-xs font-semibold leading-5 text-white">
                            {article.title}
                          </p>
                          {article.summary && (
                            <p className="mt-1.5 line-clamp-4 text-[11px] leading-5 text-slate-300">
                              {trimSummary(article.summary, 220)}
                            </p>
                          )}
                        </div>
                        <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-sky-300" />
                      </div>
                    </a>
                  ))}

                  {!supportingArticles.length && (
                    <div className="rounded-xl border border-dashed border-white/10 bg-black/10 px-3 py-6 text-center">
                      <p className="text-xs font-medium text-white">No supporting links saved</p>
                      <p className="mt-2 text-[11px] leading-5 text-slate-400">
                        This digest still generated, but there were no validated source cards to attach.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <Link
          to="/News"
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
        >
          View full news page
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
