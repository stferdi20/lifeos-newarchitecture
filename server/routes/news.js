import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import { getNewsFeed, getTopNews } from '../services/news.js';

const newsRoutes = new Hono();

newsRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const query = c.req.query('query') || '';
  const category = c.req.query('category') || 'general';
  const limit = c.req.query('limit') || '8';
  const data = await getNewsFeed({
    userId: auth.user.id,
    query,
    category,
    limit,
  });
  return c.json(data);
});

newsRoutes.get('/top', async (c) => {
  const auth = await requireUser(c);
  const limit = c.req.query('limit') || '4';
  const data = await getTopNews({
    userId: auth.user.id,
    limit,
  });
  return c.json(data);
});

export default newsRoutes;
