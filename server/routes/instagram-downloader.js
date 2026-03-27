import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireUser } from '../lib/supabase.js';
import { HttpError } from '../lib/http.js';
import { getServerEnv } from '../config/env.js';
import {
  claimNextInstagramDownloadJob,
  completeInstagramDownloadJob,
  failInstagramDownloadJob,
  getInstagramDownloaderStatusForUser,
  getInstagramDownloaderSettingsForUser,
  registerInstagramWorkerHeartbeat,
  requeueFailedInstagramJobs,
  retryInstagramDownloadForResource,
  updateInstagramDownloaderSettingsForUser,
} from '../services/instagram-download-queue.js';

const workerHeartbeatSchema = z.object({
  worker_id: z.string().min(1),
  label: z.string().optional(),
  version: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  current_job_id: z.string().optional().nullable(),
});

const workerFailSchema = z.object({
  error: z.string().min(1),
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
  download_dir: z.string().nullable().optional(),
  files: z.array(z.object({
    filename: z.string(),
    filepath: z.string(),
    type: z.string(),
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
  error: z.string().nullable().optional(),
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
  const status = await getInstagramDownloaderStatusForUser(auth.user.id);
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

instagramDownloaderRoutes.post('/worker/jobs/:jobId/complete', zValidator('json', workerCompleteSchema), async (c) => {
  assertWorkerSecret(c);
  const result = await completeInstagramDownloadJob(c.req.param('jobId'), c.req.valid('json'));
  return c.json({ success: true, job: result.job, resource: result.resource });
});

instagramDownloaderRoutes.post('/worker/jobs/:jobId/fail', zValidator('json', workerFailSchema), async (c) => {
  assertWorkerSecret(c);
  const job = await failInstagramDownloadJob(c.req.param('jobId'), c.req.valid('json').error);
  return c.json({ success: true, job });
});

export default instagramDownloaderRoutes;
