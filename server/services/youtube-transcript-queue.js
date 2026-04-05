import { HttpError } from '../lib/http.js';
import { getServiceRoleClient } from '../lib/supabase.js';
import { getServerEnv } from '../config/env.js';
import { getCompatEntity, updateCompatEntity } from './compat-store.js';
import { analyzeResource, preserveStrongerExistingData } from './resources.js';
import {
  normalizeYouTubeTranscriptResult,
  shouldQueueYouTubeTranscriptBackfill,
  YOUTUBE_TRANSCRIPT_JOB_TYPE,
  YOUTUBE_TRANSCRIPT_PRIMARY_SOURCE,
} from './youtube-transcripts.js';

function getAdmin() {
  return getServiceRoleClient();
}

function normalizePreferredSubtitleLanguages(value = '') {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

function splitPreferredSubtitleLanguages(value = '') {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const lowered = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(lowered)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(lowered)) return false;
  return fallback;
}

function buildQueuedSummary() {
  return 'Queued for YouTube transcript enrichment. It will upgrade automatically when your local worker is online.';
}

function buildProcessingSummary() {
  return 'YouTube transcript is being fetched by your local downloader worker.';
}

function buildFailedSummary(message = '') {
  return message ? `YouTube transcript enrichment failed: ${message}` : 'YouTube transcript enrichment failed.';
}

function normalizeSettings(row, fallback = {}) {
  const record = row || {};
  return {
    preferred_subtitle_languages: normalizePreferredSubtitleLanguages(
      record.preferred_subtitle_languages ?? fallback.preferred_subtitle_languages ?? '',
    ),
    prefer_manual_captions: toBoolean(record.prefer_manual_captions, fallback.prefer_manual_captions ?? true),
    queue_missing_transcripts: toBoolean(record.queue_missing_transcripts, fallback.queue_missing_transcripts ?? true),
    retry_failed_jobs: toBoolean(record.retry_failed_jobs, fallback.retry_failed_jobs ?? true),
  };
}

function normalizeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    resource_id: row.resource_id,
    source_url: row.source_url,
    status: row.status,
    retry_count: Number(row.retry_count || 0),
    last_error: row.last_error || '',
    worker_id: row.worker_id || '',
    requested_at: row.requested_at || row.created_at || null,
    scheduled_for: row.scheduled_for || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    payload: row.payload || {},
    job_type: row.payload?.job_type || YOUTUBE_TRANSCRIPT_JOB_TYPE,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function isTimestampOlderThan(value, thresholdMs) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > thresholdMs;
}

function getStatusStaleMs() {
  const env = getServerEnv();
  return Math.max(Number(env.YOUTUBE_TRANSCRIPT_STATUS_STALE_MS || env.INSTAGRAM_DOWNLOADER_STATUS_STALE_MS || 90000), 10000);
}

function getProcessingRecoveryThresholdMs() {
  return Math.max(getStatusStaleMs() * 3, 5 * 60 * 1000);
}

async function fetchResourceRecords(ownerUserId, resourceIds = []) {
  const ids = [...new Set((resourceIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const result = await getAdmin()
    .from('legacy_entity_records')
    .select('record_id,data')
    .eq('entity_type', 'Resource')
    .eq('owner_user_id', ownerUserId)
    .in('record_id', ids);

  if (result.error) throw new HttpError(500, result.error.message);
  return new Map((result.data || []).map((row) => [row.record_id, row.data || {}]));
}

export async function getYouTubeTranscriptSettingsForUser(userId) {
  const result = await getAdmin()
    .from('youtube_transcript_settings')
    .select('*')
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeSettings(result.data);
}

export async function updateYouTubeTranscriptSettingsForUser(userId, updates = {}) {
  const payload = normalizeSettings({
    ...updates,
    preferred_subtitle_languages: updates.preferred_subtitle_languages,
  }, await getYouTubeTranscriptSettingsForUser(userId));

  const result = await getAdmin()
    .from('youtube_transcript_settings')
    .upsert({
      owner_user_id: userId,
      preferred_subtitle_languages: payload.preferred_subtitle_languages || null,
      prefer_manual_captions: payload.prefer_manual_captions,
      queue_missing_transcripts: payload.queue_missing_transcripts,
      retry_failed_jobs: payload.retry_failed_jobs,
    }, { onConflict: 'owner_user_id' })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeSettings(result.data);
}

export function parsePreferredSubtitleLanguages(value = '') {
  return splitPreferredSubtitleLanguages(value);
}

function mergeYouTubeTranscriptResourceState(current = {}, patch = {}) {
  return {
    ...current,
    ...patch,
  };
}

function buildYouTubeTranscriptAnalysisPayload(userId, current = {}, sourceUrl = '', transcript = '') {
  return analyzeResource({
    url: sourceUrl,
    title: current.title || '',
    content: transcript || '',
    userId,
  }).then((analyzed) => analyzed?.data || {}).catch(() => ({}));
}

async function applySuccessfulYouTubeTranscript(userId, resourceId, sourceUrl, transcriptResult = {}) {
  const current = await getCompatEntity(userId, 'Resource', resourceId);
  const normalizedTranscript = normalizeYouTubeTranscriptResult(transcriptResult);
  const analyzedData = normalizedTranscript.transcript
    ? await buildYouTubeTranscriptAnalysisPayload(userId, current, sourceUrl, normalizedTranscript.transcript)
    : {};

  const merged = preserveStrongerExistingData(current, {
    ...current,
    ...analyzedData,
    content: normalizedTranscript.transcript || analyzedData.content || current.content || '',
    content_source: normalizedTranscript.transcript ? 'youtube_transcript' : (analyzedData.content_source || current.content_source || ''),
    content_language: normalizedTranscript.language || analyzedData.content_language || current.content_language || '',
    youtube_transcript: normalizedTranscript.transcript || current.youtube_transcript || '',
    youtube_transcript_status: normalizedTranscript.status || 'ok',
    youtube_transcript_error: normalizedTranscript.error || '',
    youtube_transcript_source: normalizedTranscript.transcriptSource || YOUTUBE_TRANSCRIPT_PRIMARY_SOURCE,
    youtube_caption_language: normalizedTranscript.language || current.youtube_caption_language || '',
  });

  return updateCompatEntity(userId, 'Resource', resourceId, mergeYouTubeTranscriptResourceState(current, {
    ...current,
    ...merged,
    id: resourceId,
    created_date: current.created_date,
    youtube_transcript_job_id: '',
    downloader_updated_at: new Date().toISOString(),
  }));
}

async function updateYouTubeTranscriptQueued(userId, resourceId, jobId) {
  const current = await getCompatEntity(userId, 'Resource', resourceId);
  return updateCompatEntity(userId, 'Resource', resourceId, mergeYouTubeTranscriptResourceState(current, {
    youtube_transcript_status: 'queued',
    youtube_transcript_source: YOUTUBE_TRANSCRIPT_PRIMARY_SOURCE,
    youtube_transcript_error: 'Waiting for your local worker to fetch subtitles.',
    youtube_transcript_job_id: jobId || current.youtube_transcript_job_id || '',
    summary: buildQueuedSummary(),
    downloader_updated_at: new Date().toISOString(),
  }));
}

async function updateYouTubeTranscriptProcessing(userId, resourceId, workerId = '', jobId = '') {
  return updateCompatEntity(userId, 'Resource', resourceId, {
    youtube_transcript_status: 'processing',
    youtube_transcript_source: YOUTUBE_TRANSCRIPT_PRIMARY_SOURCE,
    youtube_transcript_error: '',
    youtube_transcript_job_id: jobId || '',
    summary: buildProcessingSummary(),
    downloader_worker_id: workerId,
    downloader_updated_at: new Date().toISOString(),
  });
}

async function updateYouTubeTranscriptFailed(userId, resourceId, errorMessage, transcriptStatus = 'error', transcriptSource = YOUTUBE_TRANSCRIPT_PRIMARY_SOURCE) {
  const current = await getCompatEntity(userId, 'Resource', resourceId);
  return updateCompatEntity(userId, 'Resource', resourceId, mergeYouTubeTranscriptResourceState(current, {
    youtube_transcript_status: transcriptStatus || 'error',
    youtube_transcript_source: transcriptSource || YOUTUBE_TRANSCRIPT_PRIMARY_SOURCE,
    youtube_transcript_error: errorMessage || 'YouTube transcript enrichment failed.',
    youtube_transcript_job_id: '',
    summary: buildFailedSummary(errorMessage),
    downloader_updated_at: new Date().toISOString(),
  }));
}

export async function createYouTubeTranscriptJob(userId, {
  resourceId,
  url,
}) {
  const now = new Date().toISOString();
  const result = await getAdmin()
    .from('youtube_transcript_jobs')
    .insert({
      owner_user_id: userId,
      resource_id: resourceId,
      source_url: url,
      status: 'queued',
      retry_count: 0,
      requested_at: now,
      scheduled_for: now,
      payload: {
        job_type: YOUTUBE_TRANSCRIPT_JOB_TYPE,
      },
    })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeJob(result.data);
}

async function findExistingYouTubeTranscriptJob(userId, resourceId) {
  const result = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (result.error) throw new HttpError(500, result.error.message);
  return (result.data || [])
    .map(normalizeJob)
    .find((job) => ['queued', 'processing'].includes(job.status)) || null;
}

export async function maybeQueueYouTubeTranscriptJobForResource(userId, resource = {}) {
  if (!userId) return resource;
  if (!shouldQueueYouTubeTranscriptBackfill(resource)) return resource;

  const settings = await getYouTubeTranscriptSettingsForUser(userId);
  if (!settings.queue_missing_transcripts) return resource;

  const existingJob = await findExistingYouTubeTranscriptJob(userId, resource.id);
  if (existingJob) {
    return updateYouTubeTranscriptQueued(userId, resource.id, existingJob.id);
  }

  const sourceUrl = resource.source_url || resource.url || '';
  if (!sourceUrl) return resource;

  const job = await createYouTubeTranscriptJob(userId, {
    resourceId: resource.id,
    url: sourceUrl,
  });

  return updateYouTubeTranscriptQueued(userId, resource.id, job.id);
}

export async function retryYouTubeTranscriptForResource(userId, resourceId) {
  const resource = await getCompatEntity(userId, 'Resource', resourceId);
  if (resource?.resource_type !== 'youtube') {
    throw new HttpError(400, 'This resource is not a YouTube transcript.');
  }

  const existing = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) throw new HttpError(500, existing.error.message);

  const now = new Date().toISOString();
  if (existing.data) {
    const job = normalizeJob(existing.data);
    if (job.status === 'processing' || job.status === 'queued') {
      const updated = await updateYouTubeTranscriptQueued(userId, resourceId, job.id);
      return { resource: updated, job, queued: true };
    }

    const retried = await getAdmin()
      .from('youtube_transcript_jobs')
      .update({
        status: 'queued',
        last_error: null,
        scheduled_for: now,
        started_at: null,
        completed_at: null,
        worker_id: null,
      })
      .eq('id', job.id)
      .select('*')
      .single();

    if (retried.error) throw new HttpError(500, retried.error.message);
    const normalizedJob = normalizeJob(retried.data);
    const updated = await updateYouTubeTranscriptQueued(userId, resourceId, normalizedJob.id);
    return { resource: updated, job: normalizedJob, queued: true };
  }

  const newJob = await createYouTubeTranscriptJob(userId, {
    resourceId,
    url: resource.source_url || resource.url,
  });
  const updated = await updateYouTubeTranscriptQueued(userId, resourceId, newJob.id);
  return { resource: updated, job: newJob, queued: true };
}

export async function requeueFailedYouTubeTranscriptJobs(userId) {
  const now = new Date().toISOString();
  const jobsRes = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('status', 'failed');

  if (jobsRes.error) throw new HttpError(500, jobsRes.error.message);

  const jobs = (jobsRes.data || []).map(normalizeJob);
  await Promise.all(jobs.map((job) => getAdmin()
    .from('youtube_transcript_jobs')
    .update({
      status: 'queued',
      last_error: null,
      scheduled_for: now,
      started_at: null,
      completed_at: null,
      worker_id: null,
      updated_at: now,
    })
    .eq('id', job.id)
    .select('*')
    .single()
    .catch((error) => { throw error; })));

  await Promise.all(jobs.map((job) => updateYouTubeTranscriptQueued(userId, job.resource_id, job.id).catch(() => null)));
  return jobs;
}

export async function registerYouTubeTranscriptWorkerHeartbeat({
  workerId,
  label,
  version,
  metadata,
  currentJobId,
}) {
  const result = await getAdmin()
    .from('youtube_transcript_workers')
    .upsert({
      worker_id: workerId,
      label: label || workerId,
      version: version || '',
      metadata: metadata || {},
      status: 'online',
      last_heartbeat_at: new Date().toISOString(),
      current_job_id: currentJobId || null,
    }, { onConflict: 'worker_id' })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return result.data;
}

export async function claimNextYouTubeTranscriptJob(workerId) {
  const queued = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('scheduled_for', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(10);

  if (queued.error) throw new HttpError(500, queued.error.message);

  for (const row of queued.data || []) {
    const claimed = await getAdmin()
      .from('youtube_transcript_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        worker_id: workerId,
      })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('*')
      .maybeSingle();

    if (claimed.error) throw new HttpError(500, claimed.error.message);
    if (!claimed.data) continue;

    const job = normalizeJob(claimed.data);
    await updateYouTubeTranscriptProcessing(job.owner_user_id, job.resource_id, workerId, job.id).catch(() => null);
    return {
      job,
      settings: await getYouTubeTranscriptSettingsForUser(job.owner_user_id),
    };
  }

  return null;
}

export async function completeYouTubeTranscriptJob(jobId, transcript) {
  const result = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, 'YouTube transcript job not found.');

  const job = normalizeJob(result.data);
  const normalizedTranscript = normalizeYouTubeTranscriptResult(transcript);

  let resource;
  if (transcript?.success !== false && normalizedTranscript.transcript) {
    resource = await applySuccessfulYouTubeTranscript(job.owner_user_id, job.resource_id, job.source_url, transcript);
  } else {
    await updateYouTubeTranscriptFailed(
      job.owner_user_id,
      job.resource_id,
      normalizedTranscript.error || 'YouTube transcript extraction failed.',
      normalizedTranscript.status || 'error',
      normalizedTranscript.transcriptSource || YOUTUBE_TRANSCRIPT_PRIMARY_SOURCE,
    );
    resource = await getCompatEntity(job.owner_user_id, 'Resource', job.resource_id);
  }

  const deleteResult = await getAdmin()
    .from('youtube_transcript_jobs')
    .delete()
    .eq('id', jobId);

  if (deleteResult.error) throw new HttpError(500, deleteResult.error.message);

  await registerYouTubeTranscriptWorkerHeartbeat({
    workerId: job.worker_id || 'worker',
    currentJobId: null,
  }).catch(() => null);

  return { job, resource };
}

export async function failYouTubeTranscriptJob(jobId, errorMessage) {
  const current = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (current.error) throw new HttpError(500, current.error.message);
  if (!current.data) throw new HttpError(404, 'YouTube transcript job not found.');

  const row = current.data;
  const retryCount = Number(row.retry_count || 0) + 1;
  const result = await getAdmin()
    .from('youtube_transcript_jobs')
    .update({
      status: 'failed',
      retry_count: retryCount,
      last_error: errorMessage || 'YouTube transcript failed.',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);

  const job = normalizeJob(result.data);
  await updateYouTubeTranscriptFailed(job.owner_user_id, job.resource_id, job.last_error).catch(() => null);
  return job;
}

export async function getYouTubeTranscriptStatusForUser(userId) {
  const env = getServerEnv();
  const settings = await getYouTubeTranscriptSettingsForUser(userId);

  const workerRes = await getAdmin()
    .from('youtube_transcript_workers')
    .select('*')
    .order('last_heartbeat_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (workerRes.error) throw new HttpError(500, workerRes.error.message);

  const jobsRes = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(25);

  if (jobsRes.error) throw new HttpError(500, jobsRes.error.message);

  let jobs = (jobsRes.data || []).map(normalizeJob);
  const thresholdMs = getProcessingRecoveryThresholdMs();
  const resourcesById = await fetchResourceRecords(userId, jobs.map((job) => job.resource_id));

  let repaired = false;
  for (const job of jobs) {
    if (job.status !== 'processing') continue;
    if (!isTimestampOlderThan(job.started_at || job.requested_at || job.created_at, thresholdMs)) continue;
    await getAdmin()
      .from('youtube_transcript_jobs')
      .update({
        status: 'queued',
        started_at: null,
        worker_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'processing')
      .select('*')
      .maybeSingle()
      .catch(() => null);
    await updateYouTubeTranscriptQueued(userId, job.resource_id, job.id).catch(() => null);
    repaired = true;
  }

  if (repaired) {
    const refreshed = await getAdmin()
      .from('youtube_transcript_jobs')
      .select('*')
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(25);
    if (refreshed.error) throw new HttpError(500, refreshed.error.message);
    jobs = (refreshed.data || []).map(normalizeJob);
  }

  const counts = jobs.reduce((acc, job) => {
    acc.total += 1;
    if (job.status === 'queued') acc.queued += 1;
    if (job.status === 'processing') acc.processing += 1;
    if (job.status === 'failed') acc.failed += 1;
    return acc;
  }, { total: 0, queued: 0, processing: 0, failed: 0 });

  const worker = workerRes.data
    ? {
        worker_id: workerRes.data.worker_id,
        label: workerRes.data.label || workerRes.data.worker_id,
        status: workerRes.data.status || 'unknown',
        last_heartbeat_at: workerRes.data.last_heartbeat_at,
        current_job_id: workerRes.data.current_job_id || '',
        version: workerRes.data.version || '',
        metadata: workerRes.data.metadata || {},
        online: !isTimestampOlderThan(workerRes.data.last_heartbeat_at, getStatusStaleMs()),
      }
    : {
        worker_id: '',
        label: 'YouTube Transcript Worker',
        status: 'offline',
        last_heartbeat_at: null,
        current_job_id: '',
        version: '',
        metadata: {},
        online: false,
      };

  return {
    worker,
    queue: {
      ...counts,
      items: jobs.map((job) => {
        const resource = resourcesById.get(job.resource_id) || {};
        return {
          id: job.id,
          resource_id: job.resource_id,
          resource_title: resource.title || resource.instagram_display_title || 'YouTube resource',
          source_url: job.source_url,
          status: job.status,
          last_error: job.last_error || '',
          requested_at: job.requested_at,
          scheduled_for: job.scheduled_for,
          started_at: job.started_at,
          completed_at: job.completed_at,
        };
      }),
    },
    settings,
    worker_enabled: true,
  };
}
