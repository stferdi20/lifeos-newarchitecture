import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireUser } from '../lib/supabase.js';
import {
  createTaskForUser,
  deleteTaskForUser,
  listStandaloneTasksForUser,
  updateTaskForUser,
} from '../services/tasks.js';
import {
  createLinkedGoogleTask,
  disconnectLinkedGoogleTask,
  fetchLinkedGoogleTask,
  syncLinkedGoogleTasks,
  updateLinkedGoogleTask,
} from '../services/google-tasks.js';

const taskSchema = z.object({
  task_kind: z.string().optional(),
  title: z.string().min(1),
  status: z.enum(['todo', 'doing', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  due_date: z.string().nullable().optional(),
  due_time: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  workspace_id: z.string().nullable().optional(),
  card_id: z.string().nullable().optional(),
  source_checklist_item_id: z.string().nullable().optional(),
  google_task_id: z.string().nullable().optional(),
  google_task_list_id: z.string().nullable().optional(),
  google_sync_status: z.string().nullable().optional(),
  google_last_synced_at: z.string().nullable().optional(),
  reminder_enabled: z.boolean().optional(),
  reminder_source: z.string().nullable().optional(),
});

const updateTaskSchema = taskSchema.partial();
const syncLinkedSchema = z.object({
  taskIds: z.array(z.string()).default([]),
});

const taskRoutes = new Hono();

taskRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const tasks = await listStandaloneTasksForUser(auth.user.id);
  return c.json({ tasks });
});

taskRoutes.post('/', zValidator('json', taskSchema), async (c) => {
  const auth = await requireUser(c);
  const task = await createTaskForUser(auth.user.id, c.req.valid('json'));
  return c.json({ task }, 201);
});

taskRoutes.patch('/:taskId', zValidator('json', updateTaskSchema), async (c) => {
  const auth = await requireUser(c);
  const task = await updateTaskForUser(auth.user.id, c.req.param('taskId'), c.req.valid('json'));
  return c.json({ task });
});

taskRoutes.delete('/:taskId', async (c) => {
  const auth = await requireUser(c);
  const task = await deleteTaskForUser(auth.user.id, c.req.param('taskId'));
  return c.json({ task });
});

taskRoutes.post('/sync-linked', zValidator('json', syncLinkedSchema), async (c) => {
  const auth = await requireUser(c);
  const tasks = await syncLinkedGoogleTasks(auth.user.id, c.req.valid('json').taskIds);
  return c.json({ tasks });
});

taskRoutes.post('/:taskId/reminder/create', async (c) => {
  const auth = await requireUser(c);
  const task = await createLinkedGoogleTask(auth.user.id, c.req.param('taskId'));
  return c.json({ task });
});

taskRoutes.post('/:taskId/reminder/update', async (c) => {
  const auth = await requireUser(c);
  const task = await updateLinkedGoogleTask(auth.user.id, c.req.param('taskId'));
  return c.json({ task });
});

taskRoutes.post('/:taskId/reminder/sync', async (c) => {
  const auth = await requireUser(c);
  const task = await fetchLinkedGoogleTask(auth.user.id, c.req.param('taskId'));
  return c.json({ task });
});

taskRoutes.post('/:taskId/reminder/disconnect', async (c) => {
  const auth = await requireUser(c);
  const task = await disconnectLinkedGoogleTask(auth.user.id, c.req.param('taskId'));
  return c.json({ task });
});

export default taskRoutes;
