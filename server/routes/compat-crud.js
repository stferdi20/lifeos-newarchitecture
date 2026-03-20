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

export function createCompatCrudRoute({
  entityType,
  collectionKey = 'rows',
  itemKey = 'row',
  defaultSort = '-created_date',
} = {}) {
  const routes = new Hono();

  routes.get('/', async (c) => {
    const auth = await requireUser(c);
    const query = c.req.query();
    const filter = query.q ? JSON.parse(query.q) : {};
    const fields = query.fields ? query.fields.split(',') : null;
    const rows = await listCompatEntities(auth.user.id, entityType, {
      filter,
      sort: query.sort || defaultSort,
      limit: query.limit,
      skip: query.skip,
      fields,
    });
    return c.json({ [collectionKey]: rows });
  });

  routes.post('/query', async (c) => {
    const auth = await requireUser(c);
    const body = await safeJson(c.req.raw);
    const rows = await listCompatEntities(auth.user.id, entityType, {
      ...body,
      sort: body.sort || defaultSort,
    });
    return c.json({ [collectionKey]: rows });
  });

  routes.get('/:recordId', async (c) => {
    const auth = await requireUser(c);
    const row = await getCompatEntity(auth.user.id, entityType, c.req.param('recordId'));
    return c.json({ [itemKey]: row });
  });

  routes.post('/', async (c) => {
    const auth = await requireUser(c);
    const body = await safeJson(c.req.raw);
    const row = await createCompatEntity(auth.user.id, entityType, body);
    return c.json({ [itemKey]: row }, 201);
  });

  routes.post('/bulk', async (c) => {
    const auth = await requireUser(c);
    const body = await safeJson(c.req.raw);
    const rows = await bulkCreateCompatEntities(auth.user.id, entityType, body);
    return c.json({ [collectionKey]: rows }, 201);
  });

  routes.patch('/:recordId', async (c) => {
    const auth = await requireUser(c);
    const body = await safeJson(c.req.raw);
    const row = await updateCompatEntity(auth.user.id, entityType, c.req.param('recordId'), body);
    return c.json({ [itemKey]: row });
  });

  routes.delete('/:recordId', async (c) => {
    const auth = await requireUser(c);
    const row = await deleteCompatEntity(auth.user.id, entityType, c.req.param('recordId'));
    return c.json({ [itemKey]: row });
  });

  return routes;
}
