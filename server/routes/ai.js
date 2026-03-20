import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireUser } from '../lib/supabase.js';
import { routeJson, routeText } from '../lib/llm-router.js';

const policySchema = z.object({
  tier: z.enum(['cheap', 'standard', 'premium']).optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
});

const metadataSchema = z.object({
  requestSummary: z.string().optional(),
});

const textSchema = z.object({
  taskType: z.string().min(1),
  prompt: z.string().min(1),
  policy: policySchema.optional(),
  metadata: metadataSchema.optional(),
  groundWithGoogleSearch: z.boolean().optional(),
});

const structuredSchema = textSchema.extend({
  schema: z.any().optional(),
});

const aiRoutes = new Hono();

aiRoutes.post('/text', zValidator('json', textSchema), async (c) => {
  const auth = await requireUser(c);
  const body = c.req.valid('json');
  const result = await routeText({
    taskType: body.taskType,
    prompt: body.prompt,
    userId: auth.user.id,
    policy: body.policy || {},
    metadata: body.metadata || {},
    groundWithGoogleSearch: body.groundWithGoogleSearch || false,
  });

  return c.json(result);
});

aiRoutes.post('/structured', zValidator('json', structuredSchema), async (c) => {
  const auth = await requireUser(c);
  const body = c.req.valid('json');
  const result = await routeJson({
    taskType: body.taskType,
    prompt: body.prompt,
    userId: auth.user.id,
    policy: body.policy || {},
    metadata: body.metadata || {},
    groundWithGoogleSearch: body.groundWithGoogleSearch || false,
  });

  return c.json({
    provider: result.provider,
    model: result.model,
    data: result.data,
  });
});

export default aiRoutes;
