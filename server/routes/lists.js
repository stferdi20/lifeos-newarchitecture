import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireUser } from '../lib/supabase.js';
import {
  createListForWorkspace,
  deleteListForWorkspace,
  listListsForWorkspace,
  updateListForWorkspace,
} from '../services/boards.js';

const createListSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  position: z.number().optional(),
  is_archived: z.boolean().optional(),
});

const updateListSchema = createListSchema.partial();

const listRoutes = new Hono();

listRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const workspaceId = c.req.query('workspace_id');
  if (!workspaceId) return c.json({ lists: [] });
  const lists = await listListsForWorkspace(auth.user.id, workspaceId);
  return c.json({ lists });
});

listRoutes.post('/', zValidator('json', createListSchema), async (c) => {
  const auth = await requireUser(c);
  const list = await createListForWorkspace(auth.user.id, c.req.valid('json'));
  return c.json({ list }, 201);
});

listRoutes.patch('/:listId', zValidator('json', updateListSchema), async (c) => {
  const auth = await requireUser(c);
  const list = await updateListForWorkspace(auth.user.id, c.req.param('listId'), c.req.valid('json'));
  return c.json({ list });
});

listRoutes.delete('/:listId', async (c) => {
  const auth = await requireUser(c);
  const result = await deleteListForWorkspace(auth.user.id, c.req.param('listId'));
  return c.json({ list: result });
});

export default listRoutes;
