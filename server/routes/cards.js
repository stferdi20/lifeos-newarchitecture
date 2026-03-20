import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireUser } from '../lib/supabase.js';
import {
  addCardAttachmentMetadataForUser,
  createCardCommentForUser,
  createCardForUser,
  deleteCardForUser,
  listCardActivityForUser,
  listCardCommentsForUser,
  listCardsForWorkspace,
  listLinkedTasksForCard,
  removeCardAttachmentMetadataForUser,
  reorderCardsForUser,
  updateCardCommentForUser,
  updateCardForUser,
} from '../services/boards.js';
import { createLinkedGoogleTask, createReminderFromCard, createReminderFromChecklist, syncLinkedGoogleTasks } from '../services/google-tasks.js';
import { improveCardDescription, generateCardSubtasks, summarizeCard } from '../services/card-ai.js';

const cardSchema = z.object({
  workspace_id: z.string().min(1),
  list_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['todo', 'doing', 'done', 'archived']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  position: z.number().optional(),
  labels: z.array(z.object({
    id: z.string().optional(),
    text: z.string(),
    color: z.string().optional(),
  })).optional(),
  checklist: z.array(z.object({
    id: z.string().optional(),
    text: z.string(),
    done: z.boolean().optional(),
    linked_task_id: z.string().optional(),
  })).optional(),
  attached_files: z.array(z.any()).optional(),
  cover: z.any().nullable().optional(),
  estimate: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  drive_folder_id: z.string().optional(),
  is_archived: z.boolean().optional(),
});

const updateCardSchema = cardSchema.partial();

const reorderSchema = z.object({
  updates: z.array(z.object({
    id: z.string(),
    list_id: z.string(),
    status: z.string().optional(),
    position: z.number().optional(),
  })).default([]),
});

const commentSchema = z.object({
  body: z.string().min(1),
});

const updateCommentSchema = z.object({
  body: z.string().optional(),
  is_deleted: z.boolean().optional(),
});

const attachmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  url: z.string().optional(),
  webViewLink: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().nullable().optional(),
  provider: z.string().optional(),
  file_type: z.string().optional(),
  storage_bucket: z.string().nullable().optional(),
  storage_path: z.string().nullable().optional(),
});

const summarySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  checklist: z.array(z.any()).optional(),
  priority: z.string().optional(),
  due_date: z.string().optional(),
});

const descriptionSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.string().optional(),
  start_date: z.string().optional(),
  due_date: z.string().optional(),
});

const subtaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

const syncLinkedSchema = z.object({
  taskIds: z.array(z.string()).default([]),
});

const cardRoutes = new Hono();

cardRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const workspaceId = c.req.query('workspace_id');
  if (!workspaceId) return c.json({ cards: [] });
  const cards = await listCardsForWorkspace(auth.user.id, workspaceId);
  return c.json({ cards });
});

cardRoutes.post('/', zValidator('json', cardSchema), async (c) => {
  const auth = await requireUser(c);
  const card = await createCardForUser(auth.user.id, c.req.valid('json'));
  return c.json({ card }, 201);
});

cardRoutes.patch('/:cardId', zValidator('json', updateCardSchema), async (c) => {
  const auth = await requireUser(c);
  const card = await updateCardForUser(auth.user.id, c.req.param('cardId'), c.req.valid('json'));
  return c.json({ card });
});

cardRoutes.delete('/:cardId', async (c) => {
  const auth = await requireUser(c);
  const card = await deleteCardForUser(auth.user.id, c.req.param('cardId'));
  return c.json({ card });
});

cardRoutes.post('/reorder', zValidator('json', reorderSchema), async (c) => {
  const auth = await requireUser(c);
  const cards = await reorderCardsForUser(auth.user.id, c.req.valid('json').updates);
  return c.json({ cards });
});

cardRoutes.get('/:cardId/comments', async (c) => {
  const auth = await requireUser(c);
  const comments = await listCardCommentsForUser(auth.user.id, c.req.param('cardId'));
  return c.json({ comments });
});

cardRoutes.post('/:cardId/comments', zValidator('json', commentSchema), async (c) => {
  const auth = await requireUser(c);
  const comment = await createCardCommentForUser(auth.user.id, c.req.param('cardId'), c.req.valid('json'));
  return c.json({ comment }, 201);
});

cardRoutes.patch('/comments/:commentId', zValidator('json', updateCommentSchema), async (c) => {
  const auth = await requireUser(c);
  const comment = await updateCardCommentForUser(auth.user.id, c.req.param('commentId'), c.req.valid('json'));
  return c.json({ comment });
});

cardRoutes.get('/:cardId/activity', async (c) => {
  const auth = await requireUser(c);
  const activities = await listCardActivityForUser(auth.user.id, c.req.param('cardId'));
  return c.json({ activities });
});

cardRoutes.get('/:cardId/linked-tasks', async (c) => {
  const auth = await requireUser(c);
  const tasks = await listLinkedTasksForCard(auth.user.id, c.req.param('cardId'));
  return c.json({ tasks });
});

cardRoutes.post('/:cardId/linked-tasks/sync', zValidator('json', syncLinkedSchema), async (c) => {
  const auth = await requireUser(c);
  const tasks = await syncLinkedGoogleTasks(auth.user.id, c.req.valid('json').taskIds);
  return c.json({ tasks });
});

cardRoutes.post('/:cardId/attachments/metadata', zValidator('json', attachmentSchema), async (c) => {
  const auth = await requireUser(c);
  const result = await addCardAttachmentMetadataForUser(auth.user.id, c.req.param('cardId'), c.req.valid('json'));
  return c.json(result, 201);
});

cardRoutes.delete('/:cardId/attachments/:attachmentId', async (c) => {
  const auth = await requireUser(c);
  const card = await removeCardAttachmentMetadataForUser(auth.user.id, c.req.param('cardId'), c.req.param('attachmentId'));
  return c.json({ card });
});

cardRoutes.post('/ai/subtasks', zValidator('json', subtaskSchema), async (c) => {
  const auth = await requireUser(c);
  const result = await generateCardSubtasks({
    ...c.req.valid('json'),
    userId: auth.user.id,
  });
  return c.json({ data: result.data, provider: result.provider, model: result.model });
});

cardRoutes.post('/ai/description', zValidator('json', descriptionSchema), async (c) => {
  const auth = await requireUser(c);
  const result = await improveCardDescription({
    ...c.req.valid('json'),
    userId: auth.user.id,
  });
  return c.json({ data: result.data, provider: result.provider, model: result.model });
});

cardRoutes.post('/ai/summary', zValidator('json', summarySchema), async (c) => {
  const auth = await requireUser(c);
  const result = await summarizeCard({
    ...c.req.valid('json'),
    userId: auth.user.id,
  });
  return c.json({ data: result.data, provider: result.provider, model: result.model });
});

cardRoutes.post('/:cardId/reminder/create', async (c) => {
  const auth = await requireUser(c);
  const task = await createReminderFromCard(auth.user.id, c.req.param('cardId'));
  return c.json({ task });
});

cardRoutes.post('/:cardId/checklist/:itemId/reminder/create', async (c) => {
  const auth = await requireUser(c);
  const task = await createReminderFromChecklist(auth.user.id, c.req.param('cardId'), c.req.param('itemId'));
  return c.json({ task });
});

export default cardRoutes;
