import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import { safeJson } from '../lib/http.js';
import { createCompatCrudRoute } from './compat-crud.js';
import { invokeCompatFunction } from '../services/compat-functions.js';

const creatorRoutes = createCompatCrudRoute({
  entityType: 'CreatorInspo',
  collectionKey: 'creators',
  itemKey: 'creator',
});

creatorRoutes.post('/enrich', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const data = await invokeCompatFunction(auth.user.id, 'enrichCreator', body);
  return c.json(data);
});

export default creatorRoutes;
