import React, { useState } from 'react';
import { Newspaper, RefreshCw, Cpu, Rocket, Bitcoin, Globe } from 'lucide-react';
import { fetchNews as fetchNewsApi } from '@/lib/news-api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';

const CATEGORIES = [
  { key: 'ai', label: 'AI & ML', icon: Cpu, query: 'artificial intelligence' },
  { key: 'tech', label: 'Tech', icon: Globe, query: 'technology' },
  { key: 'startups', label: 'Startups', icon: Rocket, query: 'startup funding' },
  { key: 'crypto', label: 'Crypto & Web3', icon: Bitcoin, query: 'cryptocurrency blockchain' },
];

const catColors = {
  ai: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  tech: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  startups: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  crypto: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
};

export default function News() {
  const [activeCategory, setActiveCategory] = useState('ai');
  const [articles, setArticles] = useState({});
  const [loading, setLoading] = useState(false);

  const fetchNews = async (category) => {
    setLoading(true);
    const cat = CATEGORIES.find(c => c.key === category);
    try {
      const allArticles = (await fetchNewsApi(cat.query)).slice(0, 8);
      setArticles(prev => ({ ...prev, [category]: allArticles }));
    } catch {
      setArticles(prev => ({ ...prev, [category]: [] }));
    }
    setLoading(false);
  };

  const handleCategoryChange = (key) => {
    setActiveCategory(key);
    if (!articles[key]) fetchNews(key);
  };

  const currentArticles = articles[activeCategory] || [];

  return (
    <div>
      <PageHeader
        icon={Newspaper}
        title="AI News Aggregator"
        description="Stay informed. AI-curated news feed."
        className="mb-6"
        actions={(
          <button
            onClick={() => fetchNews(activeCategory)}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary/20 px-4 py-2 text-sm text-primary transition-colors hover:bg-primary/30 sm:w-auto"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </button>
        )}
      />

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => handleCategoryChange(cat.key)}
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

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {!loading && currentArticles.length === 0 && (
        <div className="text-center py-20">
          <Newspaper className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">Click refresh to load latest news</p>
          <button onClick={() => fetchNews(activeCategory)} className="px-6 py-2 rounded-lg bg-primary/20 text-primary text-sm hover:bg-primary/30 transition-colors">
            Load News
          </button>
        </div>
      )}

      {!loading && currentArticles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {currentArticles.map((article, i) => (
            <a key={i} href={article.url} target="_blank" rel="noopener noreferrer" className="rounded-2xl bg-card border border-border/50 p-5 hover:border-primary/20 transition-all block hover:shadow-md">
              {article.image_url && (
                <img src={article.image_url} alt={article.title} className="w-full h-32 object-cover rounded-lg mb-3" />
              )}
              <p className="text-sm font-semibold leading-snug">{article.title}</p>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{article.summary}</p>
              <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
                <span>{article.source_name}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
