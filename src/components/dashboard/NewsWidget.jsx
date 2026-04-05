import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Newspaper, RefreshCw } from 'lucide-react';
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
  all: 'text-slate-200 bg-slate-500/10 border-slate-500/20',
  ai: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  ai_research: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
  tech: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  startups: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  crypto: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  general: 'text-slate-200 bg-slate-500/10 border-slate-500/20',
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
  const showNoDigestYet = isError && String(error?.message || '').toLowerCase().includes('no digest is available');

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#0f1520] via-card to-card border border-blue-400/10 p-5 h-full flex flex-col hover:border-blue-400/25 hover:shadow-lg hover:shadow-blue-400/5 transition-all duration-300">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-blue-400" />
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Daily News Digest</h3>
            <p className="text-[11px] text-muted-foreground">Yesterday by category</p>
          </div>
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {DIGEST_CATEGORIES.map((category) => (
          <button
            key={category.key}
            onClick={() => setSelectedCategory(category.key)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              selectedCategory === category.key
                ? (catColors[category.key] || catColors.all)
                : 'border-border/50 bg-secondary/20 text-muted-foreground hover:text-foreground',
            )}
          >
            {category.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {showNoDigestYet && !isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-foreground">No digest yet</p>
          <p className="text-xs text-muted-foreground mt-1">Run the morning digest job and the summary will appear here.</p>
        </div>
      )}

      {isError && !isLoading && !showNoDigestYet && (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-foreground">Digest unavailable</p>
          <p className="text-xs text-muted-foreground mt-1">{error?.message || 'The digest request failed.'}</p>
        </div>
      )}

      {!isLoading && !isError && data && (
        <div className="flex-1 flex flex-col">
          <div className="flex flex-wrap items-center gap-2 mb-3 text-[10px] text-muted-foreground">
            <span className={cn('rounded-full border px-2 py-1 uppercase tracking-widest font-semibold', catColors[data.category] || catColors.all)}>
              {formatUiLabel(data.category)}
            </span>
            <span>Yesterday</span>
            <span>{data.source_count || 0} sources</span>
            {data.generated_at && <span>Generated {formatGeneratedAt(data.generated_at)}</span>}
          </div>

          {data.degraded && (
            <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              This digest is lighter than usual because some sources were unavailable or yesterday’s coverage was sparse.
            </div>
          )}

          <div className="rounded-xl bg-secondary/20 px-4 py-3">
            <p className="text-sm leading-6 text-foreground">{data.headline_summary}</p>
          </div>

          {!!data.key_points?.length && (
            <div className="mt-3 space-y-2">
              {data.key_points.slice(0, 3).map((point, index) => (
                <p key={index} className="text-xs text-muted-foreground leading-5">
                  {point}
                </p>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-2 flex-1">
            {supportingArticles.slice(0, 3).map((article, index) => (
              <a
                key={article.id || index}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-border/40 bg-secondary/20 px-3 py-2 hover:bg-secondary/35 transition-colors"
              >
                <p className="text-sm font-medium line-clamp-2">{article.title}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {article.source_name}
                </p>
              </a>
            ))}

            {!supportingArticles.length && (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
                <p className="text-sm text-foreground">No digest yet</p>
                <p className="text-xs text-muted-foreground mt-1">Run the morning digest job and the summary will appear here.</p>
              </div>
            )}
          </div>
        </div>
      )}

      <Link to="/News" className="mt-3 text-xs text-primary hover:underline text-center">
        View full news page →
      </Link>
    </div>
  );
}
