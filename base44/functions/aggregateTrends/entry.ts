import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch from all sources
    const [newsRes, hnRes, devtoRes] = await Promise.all([
      base44.functions.invoke('fetchNewsAPI', { query: 'trending technology' }).catch(() => ({ data: { articles: [] } })),
      base44.functions.invoke('fetchHackerNews', {}).catch(() => ({ data: { articles: [] } })),
      base44.functions.invoke('fetchDevTo', { tag: 'ai', perPage: 20 }).catch(() => ({ data: { articles: [] } })),
    ]);

    const allArticles = [
      ...(newsRes.data?.articles || []),
      ...(hnRes.data?.articles || []),
      ...(devtoRes.data?.articles || []),
    ];

    // Simple trend detection: find most common keywords/phrases
    const trends = {};
    const keywords = ['AI', 'machine learning', 'startup', 'funding', 'blockchain', 'crypto', 'web3', 'API', 'cloud', 'opensource'];

    allArticles.forEach(article => {
      const text = `${article.title} ${article.summary}`.toLowerCase();
      keywords.forEach(keyword => {
        if (text.includes(keyword.toLowerCase())) {
          if (!trends[keyword]) {
            trends[keyword] = {
              topic: keyword,
              article_count: 0,
              source_breakdown: { news_api: 0, hackernews: 0, devto: 0, rss: 0 },
              articles: [],
            };
          }
          trends[keyword].article_count += 1;
          trends[keyword].source_breakdown[article.source || 'news_api'] = (trends[keyword].source_breakdown[article.source || 'news_api'] || 0) + 1;
          if (trends[keyword].articles.length < 10) {
            trends[keyword].articles.push(article);
          }
        }
      });
    });

    // Calculate trend scores and sort
    const trendList = Object.values(trends)
      .map(trend => ({
        ...trend,
        trend_score: Math.min(100, trend.article_count * 5),
        category: trend.topic.includes('AI') || trend.topic.includes('machine') ? 'ai' : 
                  trend.topic.includes('startup') || trend.topic.includes('funding') ? 'startups' :
                  trend.topic.includes('crypto') || trend.topic.includes('blockchain') ? 'crypto' : 'tech',
      }))
      .sort((a, b) => b.trend_score - a.trend_score)
      .slice(0, 10);

    return Response.json({ trends: trendList, total_articles: allArticles.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});