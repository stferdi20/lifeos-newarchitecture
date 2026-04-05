import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Newspaper, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchTopNews as fetchTopNewsApi } from '@/lib/news-api';
import { cn, formatUiLabel } from '@/lib/utils';

const catColors = {
  ai: 'text-violet-400 bg-violet-500/10',
  tech: 'text-blue-400 bg-blue-500/10',
  startups: 'text-emerald-400 bg-emerald-500/10',
  crypto: 'text-amber-400 bg-amber-500/10',
  general: 'text-slate-300 bg-slate-500/10',
};

function formatPublishedAt(value) {
  if (!value) return '';
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return '';
  }
}

export default function NewsWidget() {
  const {
    data,
    error,
    isError,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['news-widget'],
    queryFn: () => fetchTopNewsApi({ limit: 4 }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const news = data?.articles || [];

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#0f1520] via-card to-card border border-blue-400/10 p-5 h-full flex flex-col hover:border-blue-400/25 hover:shadow-lg hover:shadow-blue-400/5 transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold tracking-tight">AI News Feed</h3>
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <p className="text-sm text-foreground">News is unavailable</p>
          <p className="text-xs text-muted-foreground mt-1">{error?.message || 'The feed request failed.'}</p>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3 flex-1">
          {news.map((article, i) => (
            <a
              key={article.id || i}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-start gap-2">
                <span className={cn('text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded-full shrink-0', catColors[article.category] || catColors.general)}>
                  {formatUiLabel(article.category)}
                </span>
              </div>
              <p className="text-sm font-medium mt-1 line-clamp-2">{article.title}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{article.summary}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span>{article.source_name}</span>
                {article.published_at && <span>{formatPublishedAt(article.published_at)}</span>}
              </div>
            </a>
          ))}

          {!news.length && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <p className="text-sm text-foreground">No validated articles yet</p>
              <p className="text-xs text-muted-foreground mt-1">Top headlines will appear here when feeds return fresh items.</p>
            </div>
          )}
        </div>
      )}

      <Link to="/News" className="mt-3 text-xs text-primary hover:underline text-center">
        View full news page →
      </Link>
    </div>
  );
}
