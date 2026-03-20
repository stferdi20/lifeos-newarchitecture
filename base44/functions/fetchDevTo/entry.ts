import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { tag = 'ai', perPage = 20 } = await req.json();

    const res = await fetch(
      `https://dev.to/api/articles?tag=${tag}&per_page=${perPage}&sort_by=latest`
    );
    if (!res.ok) throw new Error('Failed to fetch Dev.to articles');

    const articles = await res.json();

    const formatted = articles.map(article => ({
      id: `devto_${article.id}`,
      source: 'Dev.to',
      title: article.title,
      summary: article.description,
      url: article.url,
      image_url: article.cover_image,
      author: article.user.name,
      published_date: article.published_at,
      source_name: 'Dev.to',
      tags: article.tag_list,
    }));

    return Response.json({ articles: formatted, total: formatted.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});