import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import { invokeCompatFunction } from '../services/compat-functions.js';

const newsRoutes = new Hono();

newsRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const query = c.req.query('query') || 'technology';
  const data = await invokeCompatFunction(auth.user.id, 'fetchNewsAPI', { query });
  return c.json(data);
});

export default newsRoutes;
