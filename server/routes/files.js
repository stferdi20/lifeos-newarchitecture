import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getServerEnv } from '../config/env.js';
import { HttpError } from '../lib/http.js';
import { requireUser } from '../lib/supabase.js';
import { getServiceRoleClient } from '../lib/supabase.js';
import { buildTemplateContent, createGoogleWorkspaceDocument } from '../services/google-drive-docs.js';

const uploadSchema = z.object({
  path: z.string().min(1),
});

const signedUrlSchema = z.object({
  bucket: z.string().min(1),
  path: z.string().min(1),
  expiresIn: z.number().optional(),
});

const googleDocSchema = z.object({
  title: z.string().min(1),
  fileType: z.enum(['docs', 'sheets', 'slides']).default('docs'),
  content: z.string().default(''),
  templateKey: z.string().nullable().optional(),
  card: z.object({
    id: z.string().optional(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
  }).optional(),
});

const fileRoutes = new Hono();

fileRoutes.post('/upload', zValidator('json', uploadSchema), async (c) => {
  const auth = await requireUser(c);
  const env = getServerEnv();
  const admin = getServiceRoleClient();
  const { path } = c.req.valid('json');
  const result = await admin.storage
    .from(env.SUPABASE_STORAGE_BUCKET_UPLOADS)
    .createSignedUploadUrl(`${auth.user.id}/${path}`);

  if (result.error) throw new HttpError(500, result.error.message);
  return c.json({ upload: result.data, bucket: env.SUPABASE_STORAGE_BUCKET_UPLOADS });
});

fileRoutes.post('/sign', zValidator('json', signedUrlSchema), async (c) => {
  await requireUser(c);
  const { bucket, path, expiresIn = 60 * 60 * 24 * 30 } = c.req.valid('json');
  const admin = getServiceRoleClient();
  const result = await admin.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (result.error) throw new HttpError(500, result.error.message);
  return c.json({ signedUrl: result.data.signedUrl });
});

fileRoutes.post('/google-doc', zValidator('json', googleDocSchema), async (c) => {
  const auth = await requireUser(c);
  const payload = c.req.valid('json');
  const content = payload.content?.trim()
    ? payload.content
    : buildTemplateContent({
      title: payload.title,
      templateKey: payload.templateKey || null,
      card: payload.card,
    });

  const document = await createGoogleWorkspaceDocument(auth.user.id, {
    title: payload.title,
    fileType: payload.fileType,
    content,
  });

  return c.json(document);
});

export default fileRoutes;
