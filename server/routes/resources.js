import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireUser } from '../lib/supabase.js';
import { safeJson } from '../lib/http.js';
import { invokeCompatFunction } from '../services/compat-functions.js';
import {
  bulkCreateCompatEntities,
  createCompatEntity,
  deleteCompatEntity,
  getCompatEntity,
  listCompatEntities,
  updateCompatEntity,
} from '../services/compat-store.js';

const resourceAnalyzeSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  content: z.string().optional(),
  project_id: z.string().optional(),
});

const resourceRoutes = new Hono();

resourceRoutes.post('/analyze', zValidator('json', resourceAnalyzeSchema), async (c) => {
  const auth = await requireUser(c);
  const result = await invokeCompatFunction(auth.user.id, 'analyzeResource', c.req.valid('json'));

  return c.json({
    resource: result.resource,
    analysis: result.analysis,
    provider: result.provider,
    model: result.model,
  });
});

resourceRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const query = c.req.query();
  const resources = await listCompatEntities(auth.user.id, 'Resource', {
    filter: query.q ? JSON.parse(query.q) : {},
    sort: query.sort || '-created_date',
    limit: query.limit,
    skip: query.skip,
    fields: query.fields ? query.fields.split(',') : null,
  });
  return c.json({ resources });
});

resourceRoutes.post('/query', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const resources = await listCompatEntities(auth.user.id, 'Resource', body);
  return c.json({ resources });
});

resourceRoutes.get('/:recordId', async (c) => {
  const auth = await requireUser(c);
  const resource = await getCompatEntity(auth.user.id, 'Resource', c.req.param('recordId'));
  return c.json({ resource });
});

resourceRoutes.post('/', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const resource = await createCompatEntity(auth.user.id, 'Resource', body);
  return c.json({ resource }, 201);
});

resourceRoutes.post('/bulk', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const resources = await bulkCreateCompatEntities(auth.user.id, 'Resource', body);
  return c.json({ resources }, 201);
});

resourceRoutes.patch('/:recordId', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  const resource = await updateCompatEntity(auth.user.id, 'Resource', c.req.param('recordId'), body);
  return c.json({ resource });
});

resourceRoutes.delete('/:recordId', async (c) => {
  const auth = await requireUser(c);
  const resource = await deleteCompatEntity(auth.user.id, 'Resource', c.req.param('recordId'));
  return c.json({ resource });
});

export default resourceRoutes;
