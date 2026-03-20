import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import { invokeCompatFunction } from '../services/compat-functions.js';

const trendRoutes = new Hono();

trendRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const data = await invokeCompatFunction(auth.user.id, 'aggregateTrends', {});
  return c.json(data);
});

export default trendRoutes;
