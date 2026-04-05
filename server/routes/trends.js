import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import { getNewsTrends } from '../services/news.js';

const trendRoutes = new Hono();

trendRoutes.get('/', async (c) => {
  await requireUser(c);
  const data = await getNewsTrends();
  return c.json(data);
});

export default trendRoutes;
