import React, { useState, useEffect } from 'react';
import { TrendingUp, RefreshCw, Cpu, Rocket, Bitcoin, Globe } from 'lucide-react';
import { fetchTrends as fetchTrendsApi } from '@/lib/news-api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';

const categoryConfig = {
  ai: { icon: Cpu, color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  tech: { icon: Globe, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  startups: { icon: Rocket, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  crypto: { icon: Bitcoin, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
};

export default function Trends() {
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedTrend, setExpandedTrend] = useState(null);

  const fetchTrends = async () => {
    setLoading(true);
    try {
      setTrends(await fetchTrendsApi());
    } catch (error) {
      console.error('Failed to fetch trends:', error);
      setTrends([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTrends();
  }, []);

  return (
    <div>
      <PageHeader
        icon={TrendingUp}
        title="Trending Topics"
        description="Real-time trend aggregation across AI, tech, startups & crypto"
        className="mb-6"
        actions={(
          <button
            onClick={fetchTrends}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary/20 px-4 py-2 text-sm text-primary transition-colors hover:bg-primary/30 sm:w-auto"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </button>
        )}
      />

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {!loading && trends.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {trends.map((trend, idx) => {
            const config = categoryConfig[trend.category] || categoryConfig.tech;
            const Icon = config.icon;
            const isExpanded = expandedTrend === idx;

            return (
              <div key={idx} className="rounded-2xl bg-card border border-border/50 overflow-hidden hover:border-primary/20 transition-all">
                <button
                  onClick={() => setExpandedTrend(isExpanded ? null : idx)}
                  className="w-full p-5 text-left hover:bg-card/50 transition-colors"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <span className={cn("px-3 py-1 rounded-full text-sm font-medium border", config.color)}>
                          <Icon className="w-3 h-3 inline mr-1" />
                          {trend.category}
                        </span>
                        <div className="text-left sm:text-right">
                          <p className="text-lg font-bold text-primary">{trend.trend_score}</p>
                          <p className="text-xs text-muted-foreground">Trend Score</p>
                        </div>
                      </div>
                      <h2 className="text-lg font-semibold break-words">{trend.topic}</h2>
                      <p className="text-sm text-muted-foreground mt-1">{trend.article_count} articles across sources</p>
                    </div>
                    <div className="text-left sm:text-right sm:ml-4 shrink-0">
                      <p className="text-2xl font-bold text-emerald-500">↑ {trend.growth_rate || '—'}%</p>
                      <p className="text-xs text-muted-foreground">Growth</p>
                    </div>
                  </div>

                  {/* Source breakdown */}
                  <div className="flex flex-wrap gap-3 mt-3 text-xs">
                    {Object.entries(trend.source_breakdown).map(([source, count]) => (
                      <span key={source} className="text-muted-foreground">
                        {source.replace(/_/g, ' ')}: <span className="font-semibold">{count || 0}</span>
                      </span>
                    ))}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/50 p-5 bg-muted/20">
                    <div className="space-y-3">
                      {trend.articles?.slice(0, 5).map((article, i) => (
                        <a
                          key={i}
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-3 rounded-lg bg-card hover:bg-card/50 border border-border/30 hover:border-primary/20 transition-all group"
                        >
                          <p className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-2">{article.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{article.source_name || 'Unknown Source'}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && trends.length === 0 && (
        <div className="text-center py-20">
          <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">Click refresh to load trends</p>
          <button
            onClick={fetchTrends}
            className="px-6 py-2 rounded-lg bg-primary/20 text-primary text-sm hover:bg-primary/30 transition-colors"
          >
            Load Trends
          </button>
        </div>
      )}
    </div>
  );
}
