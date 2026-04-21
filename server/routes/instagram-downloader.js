import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireUser } from '../lib/supabase.js';
import { HttpError } from '../lib/http.js';
import { getServerEnv } from '../config/env.js';
import { uploadInstagramThumbnailToStorage } from '../services/instagram-downloader.js';
import {
  claimNextInstagramDownloadJob,
  completeInstagramDownloadJob,
  completeInstagramResourceEnrichment,
  failInstagramDownloadJob,
  failInstagramResourceEnrichment,
  getInstagramDownloaderStatusForUser,
  getInstagramDownloaderSettingsForUser,
  registerInstagramWorkerHeartbeat,
  requeueAllFailedInstagramJobs,
  requeueAllGoogleDriveBlockedInstagramJobs,
  requeueFailedInstagramJobs,
  retryInstagramDownloadForResource,
  updateInstagramResourceUploading,
  updateInstagramDownloaderSettingsForUser,
} from '../services/instagram-download-queue.js';
import {
  claimNextGenericCaptureJob,
  completeGenericCaptureJob,
  failResourceCaptureJob,
  getGenericCaptureWorkerSummary,
} from '../services/resource-capture-queue.js';

const workerHeartbeatSchema = z.object({
  worker_id: z.string().min(1),
  label: z.string().optional(),
  version: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  current_job_id: z.string().optional().nullable(),
});

const workerFailSchema = z.object({
  error: z.string().min(1),
  claim_token: z.string().optional(),
});

const settingsSchema = z.object({
  download_base_dir: z.string().min(1).optional(),
  worker_enabled: z.boolean().optional(),
  auto_start_worker: z.boolean().optional(),
  poll_interval_seconds: z.number().int().min(2).max(3600).optional(),
  preferred_drive_folder_id: z.string().optional(),
});

const workerCompleteSchema = z.object({
  success: z.boolean(),
  input_url: z.string().url(),
  media_type: z.string().optional(),
  media_type_label: z.string().optional(),
  download_dir: z.string().nullable().optional(),
  files: z.array(z.object({
    filename: z.string(),
    filepath: z.string(),
    type: z.string(),
  })).default([]).optional(),
  media_items: z.array(z.object({
    index: z.number().int().optional(),
    label: z.string().optional(),
    type: z.string().optional(),
    filename: z.string().nullable().optional(),
    filepath: z.string().nullable().optional(),
    source_url: z.string().nullable().optional(),
    thumbnail_url: z.string().nullable().optional(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    duration_seconds: z.number().nullable().optional(),
  })).default([]).optional(),
  drive_folder: z.object({
    id: z.string(),
    name: z.string(),
    url: z.string().url(),
  }).nullable().optional(),
  drive_files: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mime_type: z.string().nullable().optional(),
    url: z.string().url(),
    size: z.number().nullable().optional(),
  })).default([]).optional(),
  transcript: z.string().optional(),
  language: z.string().optional(),
  status: z.string().optional(),
  transcript_source: z.string().optional(),
  selected_mode: z.string().optional(),
  normalized_title: z.string().optional(),
  creator_handle: z.string().optional(),
  caption: z.string().optional(),
  published_at: z.string().optional(),
  thumbnail_url: z.string().optional(),
  extractor: z.string().optional(),
  review_state: z.string().optional(),
  review_reason: z.string().optional(),
  claim_token: z.string().optional(),
  worker_id: z.string().optional(),
  error: z.string().nullable().optional(),
});

const workerEnrichmentSchema = z.object({
  owner_user_id: z.string().min(1),
  source_url: z.string().url(),
  media_type: z.string().optional(),
  media_type_label: z.string().optional(),
  normalized_title: z.string().optional(),
  creator_handle: z.string().optional(),
  caption: z.string().optional(),
  published_at: z.string().optional(),
  thumbnail_url: z.string().optional(),
  media_items: z.array(z.object({
    index: z.number().int().optional(),
    label: z.string().optional(),
    type: z.string().optional(),
    filename: z.string().nullable().optional(),
    filepath: z.string().nullable().optional(),
    source_url: z.string().nullable().optional(),
    thumbnail_url: z.string().nullable().optional(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    duration_seconds: z.number().nullable().optional(),
  })).optional(),
});

const workerDownloadStateSchema = z.object({
  owner_user_id: z.string().min(1),
  status: z.enum(['uploading']),
});

const workerThumbnailUploadSchema = z.object({
  owner_user_id: z.string().min(1),
  resource_id: z.string().min(1),
  filename: z.string().min(1).optional().default('thumbnail.webp'),
  content_type: z.string().min(1).optional().default('image/webp'),
  data_base64: z.string().min(1),
});

const genericCaptureCompleteSchema = z.object({
  success: z.boolean().optional().default(true),
  claim_token: z.string().optional(),
  worker_id: z.string().optional(),
});

function assertWorkerSecret(c) {
  const expected = getServerEnv().INSTAGRAM_DOWNLOADER_SHARED_SECRET;
  if (!expected) {
    throw new HttpError(500, 'Instagram downloader shared secret is not configured.');
  }

  const provided = c.req.header('x-downloader-secret') || '';
  if (!provided || provided !== expected) {
    throw new HttpError(401, 'Unauthorized downloader worker request.');
  }
}

const instagramDownloaderRoutes = new Hono();

instagramDownloaderRoutes.get('/status', async (c) => {
  const auth = await requireUser(c);
  const [status, genericCapture] = await Promise.all([
    getInstagramDownloaderStatusForUser(auth.user.id),
    getGenericCaptureWorkerSummary().catch(() => ({ total: 0, queued: 0, processing: 0, failed: 0 })),
  ]);
  status.generic_capture_queue = genericCapture;
  return c.json(status);
});

instagramDownloaderRoutes.get('/settings', async (c) => {
  const auth = await requireUser(c);
  const settings = await getInstagramDownloaderSettingsForUser(auth.user.id);
  return c.json({ settings });
});

instagramDownloaderRoutes.patch('/settings', zValidator('json', settingsSchema), async (c) => {
  const auth = await requireUser(c);
  const settings = await updateInstagramDownloaderSettingsForUser(auth.user.id, c.req.valid('json'));
  return c.json({ success: true, settings });
});

instagramDownloaderRoutes.post('/retry-failed', async (c) => {
  const auth = await requireUser(c);
  const jobs = await requeueFailedInstagramJobs(auth.user.id);
  return c.json({ success: true, jobs });
});

instagramDownloaderRoutes.post('/resources/:resourceId/retry', async (c) => {
  const auth = await requireUser(c);
  const result = await retryInstagramDownloadForResource(auth.user.id, c.req.param('resourceId'));
  return c.json({ success: true, ...result });
});

instagramDownloaderRoutes.post('/worker/heartbeat', zValidator('json', workerHeartbeatSchema), async (c) => {
  assertWorkerSecret(c);
  const body = c.req.valid('json');
  const worker = await registerInstagramWorkerHeartbeat({
    workerId: body.worker_id,
    label: body.label,
    version: body.version,
    metadata: body.metadata,
    currentJobId: body.current_job_id,
  });
  return c.json({ success: true, worker });
});

instagramDownloaderRoutes.post('/worker/claim', async (c) => {
  assertWorkerSecret(c);
  const workerId = c.req.header('x-worker-id') || 'instagram-worker';
  const claimed = await claimNextInstagramDownloadJob(workerId);
  return c.json({ success: true, job: claimed });
});

instagramDownloaderRoutes.post('/worker/requeue-drive-blocked', async (c) => {
  assertWorkerSecret(c);
  try {
    const jobs = await requeueAllGoogleDriveBlockedInstagramJobs();
    return c.json({ success: true, jobs, count: jobs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown requeue error');
    throw new HttpError(500, message);
  }
});

instagramDownloaderRoutes.post('/worker/requeue-failed', async (c) => {
  assertWorkerSecret(c);
  try {
    const jobs = await requeueAllFailedInstagramJobs();
    return c.json({ success: true, jobs, count: jobs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown requeue error');
    throw new HttpError(500, message);
  }
});

instagramDownloaderRoutes.post('/worker/jobs/:jobId/complete', zValidator('json', workerCompleteSchema), async (c) => {
  assertWorkerSecret(c);
  const body = c.req.valid('json');
  const result = await completeInstagramDownloadJob(c.req.param('jobId'), {
    ...body,
    worker_id: c.req.header('x-worker-id') || body.worker_id || '',
  });
  return c.json({ success: true, job: result.job, resource: result.resource });
});

instagramDownloaderRoutes.post('/worker/resources/:resourceId/enrich', zValidator('json', workerEnrichmentSchema), async (c) => {
  assertWorkerSecret(c);
  const body = c.req.valid('json');
  try {
    const resource = await completeInstagramResourceEnrichment(
      body.owner_user_id,
      c.req.param('resourceId'),
      body.source_url,
      body,
    );
    return c.json({ success: true, resource });
  } catch (error) {
    await failInstagramResourceEnrichment(
      body.owner_user_id,
      c.req.param('resourceId'),
      error?.message || 'Instagram enrichment failed.',
    ).catch(() => null);
    throw error;
  }
});

instagramDownloaderRoutes.post('/worker/resources/:resourceId/download-state', zValidator('json', workerDownloadStateSchema), async (c) => {
  assertWorkerSecret(c);
  const body = c.req.valid('json');
  let resource = null;
  if (body.status === 'uploading') {
    resource = await updateInstagramResourceUploading(body.owner_user_id, c.req.param('resourceId'));
  }
  return c.json({ success: true, resource });
});

instagramDownloaderRoutes.post('/worker/thumbnails/upload', zValidator('json', workerThumbnailUploadSchema), async (c) => {
  assertWorkerSecret(c);
  const body = c.req.valid('json');
  const result = await uploadInstagramThumbnailToStorage({
    ownerUserId: body.owner_user_id,
    resourceId: body.resource_id,
    filename: body.filename,
    contentType: body.content_type,
    dataBase64: body.data_base64,
  });
  return c.json({ success: true, ...result, thumbnail_url: result.thumbnail_url || result.url || '' });
});

instagramDownloaderRoutes.post('/worker/jobs/:jobId/fail', zValidator('json', workerFailSchema), async (c) => {
  assertWorkerSecret(c);
  const body = c.req.valid('json');
  const job = await failInstagramDownloadJob(c.req.param('jobId'), {
    message: body.error,
    claimToken: body.claim_token || '',
    workerId: c.req.header('x-worker-id') || '',
  });
  return c.json({ success: true, job });
});

instagramDownloaderRoutes.post('/worker/resource-capture/claim', async (c) => {
  assertWorkerSecret(c);
  const workerId = c.req.header('x-worker-id') || 'instagram-worker';
  const claimed = await claimNextGenericCaptureJob(workerId);
  return c.json({ success: true, job: claimed });
});

instagramDownloaderRoutes.post('/worker/resource-capture/jobs/:jobId/complete', zValidator('json', genericCaptureCompleteSchema), async (c) => {
  assertWorkerSecret(c);
  const body = c.req.valid('json');
  const result = await completeGenericCaptureJob(c.req.param('jobId'), {
    claim_token: body.claim_token || '',
    worker_id: c.req.header('x-worker-id') || body.worker_id || '',
  });
  return c.json({ success: true, job: result.job, resource: result.resource });
});

instagramDownloaderRoutes.post('/worker/resource-capture/jobs/:jobId/fail', zValidator('json', workerFailSchema), async (c) => {
  assertWorkerSecret(c);
  const body = c.req.valid('json');
  const job = await failResourceCaptureJob(c.req.param('jobId'), {
    message: body.error,
    claimToken: body.claim_token || '',
    workerId: c.req.header('x-worker-id') || '',
  });
  return c.json({ success: true, job });
});

export default instagramDownloaderRoutes;
