import { Hono } from 'hono';
import { requireUser } from '../lib/supabase.js';
import { safeJson } from '../lib/http.js';
import {
  bulkCreateCompatEntities,
  createCompatEntity,
  deleteCompatEntity,
  getCompatEntity,
  listCompatEntities,
  updateCompatEntity,
} from '../services/compat-store.js';
import { invokeCompatFunction } from '../services/compat-functions.js';

const compatRoutes = new Hono();

compatRoutes.get('/entities/:entity', async (c) => {
  const auth = await requireUser(c);
  const query = c.req.query();
  const filter = query.q ? JSON.parse(query.q) : {};
  const fields = query.fields ? query.fields.split(',') : null;
  const rows = await listCompatEntities(auth.user.id, c.req.param('entity'), {
    filter,
    sort: query.sort,
    limit: query.limit,
    skip: query.skip,
    fields,
  });
  return c.json({ rows });
});

compatRoutes.post('/entities/:entity/query', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const rows = await listCompatEntities(auth.user.id, c.req.param('entity'), body);
  return c.json({ rows });
});

compatRoutes.get('/entities/:entity/:recordId', async (c) => {
  const auth = await requireUser(c);
  const row = await getCompatEntity(auth.user.id, c.req.param('entity'), c.req.param('recordId'));
  return c.json({ row });
});

compatRoutes.post('/entities/:entity', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const row = await createCompatEntity(auth.user.id, c.req.param('entity'), body);
  return c.json({ row }, 201);
});

compatRoutes.post('/entities/:entity/bulk', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const rows = await bulkCreateCompatEntities(auth.user.id, c.req.param('entity'), body);
  return c.json({ rows }, 201);
});

compatRoutes.patch('/entities/:entity/:recordId', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const row = await updateCompatEntity(auth.user.id, c.req.param('entity'), c.req.param('recordId'), body);
  return c.json({ row });
});

compatRoutes.delete('/entities/:entity/:recordId', async (c) => {
  const auth = await requireUser(c);
  const row = await deleteCompatEntity(auth.user.id, c.req.param('entity'), c.req.param('recordId'));
  return c.json({ row });
});

compatRoutes.post('/functions/:functionName', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const data = await invokeCompatFunction(auth.user.id, c.req.param('functionName'), body);
  return c.json({ data });
});

export default compatRoutes;
