import React, { useState } from 'react';
import { Newspaper, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchNews as fetchNewsApi } from '@/lib/news-api';

export default function NewsWidget() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchNews = async () => {
    setLoading(true);
    try {
      const articles = await fetchNewsApi('artificial intelligence technology startups');
      setNews((articles || []).slice(0, 4).map((article) => ({
        ...article,
        category: article.category || 'Tech',
      })));
      setLoaded(true);
    } catch {
      setNews([]);
    }
    setLoading(false);
  };

  const catColors = {
    AI: 'text-violet-400 bg-violet-500/10',
    Tech: 'text-blue-400 bg-blue-500/10',
    Startup: 'text-emerald-400 bg-emerald-500/10',
    Crypto: 'text-amber-400 bg-amber-500/10',
  };

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#0f1520] via-card to-card border border-blue-400/10 p-5 h-full flex flex-col hover:border-blue-400/25 hover:shadow-lg hover:shadow-blue-400/5 transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold tracking-tight">AI News Feed</h3>
        </div>
        <button onClick={fetchNews} disabled={loading} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {!loaded && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <button onClick={fetchNews} className="px-4 py-2 rounded-lg bg-primary/20 text-primary text-sm hover:bg-primary/30 transition-colors">
            Load Latest News
          </button>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {loaded && !loading && (
        <div className="space-y-3 flex-1">
          {news.map((article, i) => (
            <div key={i} className="px-3 py-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors">
              <div className="flex items-start gap-2">
                <span className={`text-[10px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${catColors[article.category] || 'text-muted-foreground bg-secondary'}`}>
                  {article.category}
                </span>
              </div>
              <p className="text-sm font-medium mt-1 line-clamp-2">{article.title}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{article.summary}</p>
            </div>
          ))}
        </div>
      )}

      <Link to="/News" className="mt-3 text-xs text-primary hover:underline text-center">
        View full news page →
      </Link>
    </div>
  );
}
