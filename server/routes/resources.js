import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { timingSafeEqual } from 'node:crypto';
import { getServerEnv } from '../config/env.js';
import { HttpError } from '../lib/http.js';
import { requireUser } from '../lib/supabase.js';
import { safeJson } from '../lib/http.js';
import { invokeCompatFunction } from '../services/compat-functions.js';
import {
  reconcileInstagramResourceStatesForUser,
  submitInstagramDownload,
} from '../services/instagram-download-queue.js';
import {
  getResourceCaptureStatusForUser,
  retryResourceCaptureForResource,
  submitResourceCapture,
} from '../services/resource-capture-queue.js';
import { reEnrichResourcesForUser } from '../services/resources.js';
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

const instagramDownloadSchema = z.object({
  url: z.string().url(),
  upload_to_drive: z.boolean().optional().default(true),
  drive_folder_id: z.string().optional(),
  include_analysis: z.boolean().optional().default(true),
  project_id: z.string().optional(),
});

const resourceCaptureSchema = z.object({
  url: z.string().url(),
  project_id: z.string().optional(),
  source: z.enum(['manual_modal', 'ios_share_shortcut', 'capture_page', 'quick_paste']).optional().default('manual_modal'),
});

const shortcutCaptureSchema = z.object({
  url: z.string().min(1),
  project_id: z.string().optional(),
  source: z.enum(['ios_share_shortcut', 'capture_page', 'quick_paste']).optional().default('ios_share_shortcut'),
});

const resourceReenrichSchema = z.object({
  resource_ids: z.array(z.string()).optional().default([]),
  filters: z.object({
    search: z.string().optional().default(''),
    type: z.string().optional().default('all'),
    area_id: z.string().optional().default('all'),
    archived: z.enum(['active', 'archived', 'all']).optional().default('all'),
    project_id: z.string().optional().default(''),
    tag: z.string().optional().default(''),
  }).optional().default({}),
  batch_size: z.number().int().min(1).max(500).optional().default(100),
});

const resourceRoutes = new Hono();

const INSTAGRAM_RESOURCE_REPAIR_FIELDS = new Set([
  'download_status',
  'download_status_message',
  'instagram_display_title',
  'instagram_author_handle',
  'instagram_media_type_label',
  'drive_folder_url',
  'drive_files',
  'instagram_media_items',
  'thumbnail',
  'summary',
]);

function shouldRepairInstagramResourceState(fields) {
  if (!fields) return true;
  const normalized = Array.isArray(fields)
    ? fields
    : String(fields)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  if (!normalized.length) return true;
  return normalized.some((field) => INSTAGRAM_RESOURCE_REPAIR_FIELDS.has(field));
}

function tokensMatch(provided = '', expected = '') {
  const providedBuffer = Buffer.from(String(provided || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  if (!providedBuffer.length || providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function requireShortcutCaptureUser(c) {
  const env = getServerEnv();
  if (!env.LIFEOS_SHORTCUT_CAPTURE_TOKEN || !env.LIFEOS_SHORTCUT_CAPTURE_USER_ID) {
    throw new HttpError(500, 'Shortcut capture is not configured.');
  }

  const provided = c.req.header('x-lifeos-shortcut-token') || '';
  if (!tokensMatch(provided, env.LIFEOS_SHORTCUT_CAPTURE_TOKEN)) {
    throw new HttpError(401, 'Invalid shortcut capture token.');
  }

  return env.LIFEOS_SHORTCUT_CAPTURE_USER_ID;
}

function decodeShortcutUrl(value = '') {
  let next = String(value || '').trim().replace(/^["']|["']$/g, '');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(next);
      if (decoded === next) break;
      next = decoded.trim().replace(/^["']|["']$/g, '');
    } catch {
      break;
    }
  }
  return next;
}

function isShortcutInstagramUrl(value = '') {
  return /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:(?:share\/)?(?:reel|p|tv))\//i.test(value);
}

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

resourceRoutes.post('/instagram-download', zValidator('json', instagramDownloadSchema), async (c) => {
  const auth = await requireUser(c);
  const body = c.req.valid('json');

  const result = await submitInstagramDownload(auth.user.id, {
    url: body.url,
    projectId: body.project_id || '',
    driveFolderId: body.upload_to_drive ? (body.drive_folder_id || '') : '',
    includeAnalysis: body.include_analysis,
  });

  return c.json(result, result.queued ? 202 : 200);
});

resourceRoutes.post('/capture', zValidator('json', resourceCaptureSchema), async (c) => {
  const auth = await requireUser(c);
  const body = c.req.valid('json');
  const result = await submitResourceCapture(auth.user.id, {
    url: body.url,
    projectId: body.project_id || '',
    source: body.source,
  });
  return c.json(result, 202);
});

resourceRoutes.post('/shortcut-capture', zValidator('json', shortcutCaptureSchema), async (c) => {
  const userId = requireShortcutCaptureUser(c);
  const body = c.req.valid('json');
  const url = decodeShortcutUrl(body.url);
  if (isShortcutInstagramUrl(url)) {
    const result = await submitInstagramDownload(userId, {
      url,
      projectId: body.project_id || '',
      includeAnalysis: true,
    });
    return c.json(result, result.queued ? 202 : 200);
  }

  const result = await submitResourceCapture(userId, {
    url,
    projectId: body.project_id || '',
    source: body.source,
  });
  return c.json(result, 202);
});

resourceRoutes.post('/:resourceId/retry-capture', async (c) => {
  const auth = await requireUser(c);
  const result = await retryResourceCaptureForResource(auth.user.id, c.req.param('resourceId'));
  return c.json({ success: true, ...result }, 202);
});

resourceRoutes.get('/capture/status', async (c) => {
  const auth = await requireUser(c);
  const status = await getResourceCaptureStatusForUser(auth.user.id);
  return c.json(status);
});

resourceRoutes.post('/re-enrich', zValidator('json', resourceReenrichSchema), async (c) => {
  const auth = await requireUser(c);
  const body = c.req.valid('json');
  const result = await reEnrichResourcesForUser(auth.user.id, {
    resourceIds: body.resource_ids,
    filters: body.filters,
    batchSize: body.batch_size,
  });
  return c.json(result);
});

resourceRoutes.get('/', async (c) => {
  const auth = await requireUser(c);
  const query = c.req.query();
  const fields = query.fields ? query.fields.split(',') : null;
  if (query.repair === '1' && shouldRepairInstagramResourceState(fields)) {
    await reconcileInstagramResourceStatesForUser(auth.user.id).catch(() => null);
  }
  const resources = await listCompatEntities(auth.user.id, 'Resource', {
    filter: query.q ? JSON.parse(query.q) : {},
    sort: query.sort || '-created_date',
    limit: query.limit,
    skip: query.skip,
    fields,
  });
  return c.json({ resources });
});

resourceRoutes.post('/query', async (c) => {
  const auth = await requireUser(c);
  const body = await safeJson(c.req.raw);
  if (body?.repair === true && shouldRepairInstagramResourceState(body?.fields || null)) {
    await reconcileInstagramResourceStatesForUser(auth.user.id).catch(() => null);
  }
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
