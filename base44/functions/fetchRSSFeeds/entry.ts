import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const FEEDS = [
  { name: 'Medium', url: 'https://medium.com/feed/tag/artificial-intelligence' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
];

function parseRSSItem(item, feedName) {
  const titleMatch = item.match(/<title[^>]*>(.*?)<\/title>/i);
  const descMatch = item.match(/<description[^>]*>(.*?)<\/description>/i);
  const linkMatch = item.match(/<link[^>]*>(.*?)<\/link>/i);
  const pubDateMatch = item.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i);
  const imageMatch = item.match(/<image[^>]*>(.*?)<\/image>/i) || item.match(/<media:content[^>]*url="([^"]*)"[^>]*>/i);

  const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '') : 'Untitled';
  const summary = descMatch ? descMatch[1].replace(/<[^>]*>/g, '').slice(0, 200) : '';
  const url = linkMatch ? linkMatch[1] : '';
  const pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString();

  return {
    title,
    summary,
    url,
    published_date: pubDate,
    source_name: feedName,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const articles = [];

    for (const feed of FEEDS) {
      try {
        const res = await fetch(feed.url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;

        const xml = await res.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

        const feedArticles = items.slice(0, 5).map((item, idx) => {
          const parsed = parseRSSItem(item, feed.name);
          return {
            id: `rss_${feed.name.toLowerCase()}_${idx}`,
            source: 'RSS',
            ...parsed,
          };
        });

        articles.push(...feedArticles);
      } catch (error) {
        console.error(`Error fetching ${feed.name}:`, error.message);
      }
    }

    return Response.json({ articles, total: articles.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});