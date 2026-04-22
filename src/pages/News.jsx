import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Newspaper, RefreshCw, Cpu, Rocket, Bitcoin, Globe, Microscope } from 'lucide-react';
import { fetchNews as fetchNewsApi } from '@/lib/news-api';
import { getLocalQueryCacheOptions } from '@/lib/local-query-cache';
import { cn, formatUiLabel } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';

const CATEGORIES = [
  { key: 'ai', label: 'AI News', icon: Cpu, query: 'artificial intelligence' },
  { key: 'ai_research', label: 'AI Research', icon: Microscope, query: 'artificial intelligence research' },
  { key: 'tech', label: 'Tech', icon: Globe, query: 'technology' },
  { key: 'startups', label: 'Startups', icon: Rocket, query: 'startup funding' },
  { key: 'crypto', label: 'Crypto & Web3', icon: Bitcoin, query: 'cryptocurrency blockchain' },
];

const catColors = {
  ai: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  ai_research: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
  tech: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  startups: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  crypto: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  general: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
};

function formatPublishedAt(value) {
  if (!value) return '';
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return '';
  }
}

export default function News() {
  const [activeCategory, setActiveCategory] = useState('ai');
  const activeConfig = useMemo(
    () => CATEGORIES.find((entry) => entry.key === activeCategory) || CATEGORIES[0],
    [activeCategory],
  );

  const {
    data,
    error,
    isError,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['news', activeCategory],
    queryFn: () => fetchNewsApi({
      category: activeCategory,
      query: activeConfig.query,
      limit: 8,
    }),
    ...getLocalQueryCacheOptions(['news']),
    retry: 1,
  });

  const currentArticles = data?.articles || [];
  const hasArticles = currentArticles.length > 0;
  const isInitialLoading = isLoading && !hasArticles;
  const isRefreshing = isFetching && hasArticles;

  return (
    <div>
      <PageHeader
        icon={Newspaper}
        title="AI News Aggregator"
        description="Source-backed AI, research, tech, startup, and crypto coverage."
        className="mb-6"
        actions={(
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary/20 px-4 py-2 text-sm text-primary transition-colors hover:bg-primary/30 sm:w-auto"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
            {isRefreshing ? 'Refreshing' : 'Refresh'}
          </button>
        )}
      />

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={cn(
              "flex shrink-0 items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border",
              activeCategory === cat.key
                ? catColors[cat.key]
                : "text-muted-foreground bg-card border-border/50 hover:text-foreground"
            )}
          >
            <cat.icon className="w-4 h-4" />
            {cat.label}
          </button>
        ))}
      </div>

      {isInitialLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {data?.partial && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Some feeds were unavailable, so this refresh may be incomplete.
        </div>
      )}

      {data?.degraded && !data?.partial && (
        <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
          Results are source-backed, but coverage is lighter than usual right now.
        </div>
      )}

      {isError && !hasArticles && (
        <div className="text-center py-20">
          <Newspaper className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground mb-2">News couldn’t load right now</p>
          <p className="text-muted-foreground mb-4 text-sm">{error?.message || 'The feed request failed.'}</p>
          <button
            onClick={() => refetch()}
            className="px-6 py-2 rounded-lg bg-primary/20 text-primary text-sm hover:bg-primary/30 transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {!isInitialLoading && !isError && currentArticles.length === 0 && (
        <div className="text-center py-20">
          <Newspaper className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">No validated articles matched this category right now.</p>
        </div>
      )}

      {!isInitialLoading && currentArticles.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{data?.source_count || 0} sources</span>
            {data?.generated_at && <span>Updated {formatPublishedAt(data.generated_at)}</span>}
            {data?.query_used && <span>Query: {data.query_used}</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {currentArticles.map((article, i) => (
            <a
              key={article.id || i}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-card border border-border/50 p-5 hover:border-primary/20 transition-all block hover:shadow-md"
            >
              {article.image_url && (
                <img src={article.image_url} alt={article.title} className="w-full h-32 object-cover rounded-lg mb-3" />
              )}
              <div className="flex flex-wrap items-center gap-2 text-[10px] mb-3">
                <span className={cn('rounded-full border px-2 py-1 uppercase tracking-widest font-semibold', catColors[article.category] || catColors.general)}>
                  {formatUiLabel(article.category)}
                </span>
                {article.is_ai_summary && (
                  <span className="rounded-full border border-white/10 px-2 py-1 uppercase tracking-widest font-semibold text-muted-foreground">
                    AI Summary
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold leading-snug">{article.title}</p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{article.summary}</p>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-muted-foreground">
                <span>{article.source_name}</span>
                {article.published_at && <span>{formatPublishedAt(article.published_at)}</span>}
              </div>
            </a>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}
