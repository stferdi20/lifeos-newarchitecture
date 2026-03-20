import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const apiKey = Deno.env.get('NEWSAPI_KEY');
    if (!apiKey) return Response.json({ error: 'API key not configured' }, { status: 500 });

    const { query = 'AI technology startup', sortBy = 'publishedAt' } = await req.json();

    const params = new URLSearchParams({
      q: query,
      sortBy,
      language: 'en',
      pageSize: '20',
      apiKey,
    });

    const res = await fetch(`https://newsapi.org/v2/everything?${params}`);
    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: `NewsAPI error: ${err}` }, { status: res.status });
    }

    const data = await res.json();
    const articles = (data.articles || []).map((article) => ({
      id: `newsapi_${article.url}`,
      source: 'News API',
      title: article.title,
      summary: article.description,
      url: article.url,
      image_url: article.urlToImage,
      author: article.author,
      published_date: article.publishedAt,
      source_name: article.source.name,
    }));

    return Response.json({ articles, total: data.totalResults });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});