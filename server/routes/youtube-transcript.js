import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { requireUser } from '../lib/supabase.js';
import { HttpError } from '../lib/http.js';
import { getServerEnv } from '../config/env.js';
import {
  claimNextYouTubeTranscriptJob,
  completeYouTubeTranscriptJob,
  failYouTubeTranscriptJob,
  getYouTubeTranscriptSettingsForUser,
  getYouTubeTranscriptStatusForUser,
  registerYouTubeTranscriptWorkerHeartbeat,
  requeueFailedYouTubeTranscriptJobs,
  retryYouTubeTranscriptForResource,
  updateYouTubeTranscriptSettingsForUser,
} from '../services/youtube-transcript-queue.js';

const youtubeTranscriptRoutes = new Hono();

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

const workerCompleteSchema = z.object({
  success: z.boolean(),
  input_url: z.string().url().optional(),
  transcript: z.string().optional(),
  language: z.string().optional(),
  status: z.string().optional(),
  error: z.string().nullable().optional(),
  transcript_source: z.string().optional(),
  selected_mode: z.string().optional(),
});

const settingsSchema = z.object({
  preferred_subtitle_languages: z.string().optional(),
  prefer_manual_captions: z.boolean().optional(),
  queue_missing_transcripts: z.boolean().optional(),
  retry_failed_jobs: z.boolean().optional(),
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

youtubeTranscriptRoutes.get('/status', async (c) => {
  const auth = await requireUser(c);
  const status = await getYouTubeTranscriptStatusForUser(auth.user.id);
  return c.json(status);
});

youtubeTranscriptRoutes.get('/settings', async (c) => {
  const auth = await requireUser(c);
  const settings = await getYouTubeTranscriptSettingsForUser(auth.user.id);
  return c.json({ settings });
});

youtubeTranscriptRoutes.patch('/settings', zValidator('json', settingsSchema), async (c) => {
  const auth = await requireUser(c);
  const settings = await updateYouTubeTranscriptSettingsForUser(auth.user.id, c.req.valid('json'));
  return c.json({ success: true, settings });
});

youtubeTranscriptRoutes.post('/retry-failed', async (c) => {
  const auth = await requireUser(c);
  const jobs = await requeueFailedYouTubeTranscriptJobs(auth.user.id);
  return c.json({ success: true, jobs });
});

youtubeTranscriptRoutes.post('/resources/:resourceId/retry', async (c) => {
  const auth = await requireUser(c);
  const result = await retryYouTubeTranscriptForResource(auth.user.id, c.req.param('resourceId'));
  return c.json({ success: true, ...result });
});

youtubeTranscriptRoutes.post('/worker/heartbeat', zValidator('json', workerHeartbeatSchema), async (c) => {
  assertWorkerSecret(c);
  const body = c.req.valid('json');
  const worker = await registerYouTubeTranscriptWorkerHeartbeat({
    workerId: body.worker_id,
    label: body.label,
    version: body.version,
    metadata: body.metadata,
    currentJobId: body.current_job_id,
  });
  return c.json({ success: true, worker });
});

youtubeTranscriptRoutes.post('/worker/claim', async (c) => {
  assertWorkerSecret(c);
  const workerId = c.req.header('x-worker-id') || 'youtube-worker';
  const claimed = await claimNextYouTubeTranscriptJob(workerId);
  return c.json({ success: true, job: claimed });
});

youtubeTranscriptRoutes.post('/worker/jobs/:jobId/complete', zValidator('json', workerCompleteSchema), async (c) => {
  assertWorkerSecret(c);
  const result = await completeYouTubeTranscriptJob(c.req.param('jobId'), c.req.valid('json'));
  return c.json({ success: true, job: result.job, resource: result.resource });
});

youtubeTranscriptRoutes.post('/worker/jobs/:jobId/fail', zValidator('json', workerFailSchema), async (c) => {
  assertWorkerSecret(c);
  const result = await failYouTubeTranscriptJob(c.req.param('jobId'), c.req.valid('json').error);
  return c.json({ success: true, job: result });
});

export default youtubeTranscriptRoutes;
