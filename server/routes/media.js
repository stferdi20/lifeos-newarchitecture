import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import { safeJson } from '../lib/http.js';
import { createCompatCrudRoute } from './compat-crud.js';
import { invokeCompatFunction } from '../services/compat-functions.js';

const mediaRoutes = createCompatCrudRoute({
  entityType: 'MediaEntry',
  collectionKey: 'mediaEntries',
  itemKey: 'mediaEntry',
});

mediaRoutes.post('/search', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const data = await invokeCompatFunction(auth.user.id, 'mediaSearch', body);
  return c.json(data);
});

mediaRoutes.post('/enrich', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const data = await invokeCompatFunction(auth.user.id, 'mediaEnrich', body);
  return c.json(data);
});

mediaRoutes.get('/health', async (c) => {
  const auth = await requireUser(c);
  const data = await invokeCompatFunction(auth.user.id, 'mediaHealth', {});
  return c.json(data);
});

mediaRoutes.post('/bulk-update', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const data = await invokeCompatFunction(auth.user.id, 'bulkUpdateMediaEntries', body);
  return c.json(data);
});

export default mediaRoutes;
