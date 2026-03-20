import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireUser } from '../lib/supabase.js';
import {
  createBoardWorkspaceForUser,
  deleteBoardWorkspaceForUser,
  listBoardWorkspacesForUser,
  updateBoardWorkspaceForUser,
} from '../services/boards.js';

const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  position: z.number().optional(),
  is_archived: z.boolean().optional(),
});

const updateWorkspaceSchema = createWorkspaceSchema.partial();

const workspaceRoutes = new Hono();

workspaceRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const workspaces = await listBoardWorkspacesForUser(auth.user.id);
  return c.json({ workspaces });
});

workspaceRoutes.post('/', zValidator('json', createWorkspaceSchema), async (c) => {
  const auth = await requireUser(c);
  const payload = c.req.valid('json');
  const workspace = await createBoardWorkspaceForUser(auth.user.id, payload);
  return c.json({ workspace }, 201);
});

workspaceRoutes.patch('/:workspaceId', zValidator('json', updateWorkspaceSchema), async (c) => {
  const auth = await requireUser(c);
  const workspace = await updateBoardWorkspaceForUser(auth.user.id, c.req.param('workspaceId'), c.req.valid('json'));
  return c.json({ workspace });
});

workspaceRoutes.delete('/:workspaceId', async (c) => {
  const auth = await requireUser(c);
  const workspace = await deleteBoardWorkspaceForUser(auth.user.id, c.req.param('workspaceId'));
  return c.json({ workspace });
});

export default workspaceRoutes;
