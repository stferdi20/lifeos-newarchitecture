import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch top story IDs
    const topStoriesRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    if (!topStoriesRes.ok) throw new Error('Failed to fetch HackerNews top stories');
    
    const storyIds = await topStoriesRes.json();
    const topIds = storyIds.slice(0, 20); // Get top 20

    // Fetch story details in parallel
    const storyPromises = topIds.map(id =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json())
    );

    const stories = await Promise.all(storyPromises);

    const articles = stories
      .filter(story => story && story.title && story.url)
      .map(story => ({
        id: `hn_${story.id}`,
        source: 'HackerNews',
        title: story.title,
        summary: `${story.score} points • ${story.descendants || 0} comments`,
        url: story.url,
        author: story.by,
        published_date: new Date(story.time * 1000).toISOString(),
        source_name: 'Hacker News',
      }));

    return Response.json({ articles, total: articles.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});