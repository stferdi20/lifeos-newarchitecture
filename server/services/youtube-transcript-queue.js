import { HttpError } from '../lib/http.js';
import { randomUUID } from 'node:crypto';
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

const YOUTUBE_SETTINGS_COMPAT_RECORD_ID = 'default';
const YOUTUBE_SETTINGS_COMPAT_ENTITY_TYPE = 'YouTubeTranscriptSettings';
const LEGACY_QUEUE_TABLE = 'instagram_download_jobs';
const LEGACY_WORKER_TABLE = 'instagram_downloader_workers';
const LEGACY_QUEUE_DRIVE_TARGET = 'global_instagram_folder';

function getAdmin() {
  return getServiceRoleClient();
}

function errorIncludes(error, patterns = []) {
  const haystack = [
    error?.message,
    error?.details,
    error?.hint,
    error?.error_description,
    error?.error,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return patterns.some((pattern) => haystack.includes(String(pattern || '').toLowerCase()));
}

function isMissingYouTubeTranscriptQueueTableError(error) {
  return errorIncludes(error, [
    'youtube_transcript_jobs',
    'youtube_transcript_workers',
    'youtube_transcript_settings',
    "could not find the table 'public.youtube_transcript_jobs'",
    "could not find the table 'public.youtube_transcript_workers'",
    "could not find the table 'public.youtube_transcript_settings'",
  ]);
}

async function getCompatSettingsRecord(userId) {
  const result = await getAdmin()
    .from('legacy_entity_records')
    .select('data')
    .eq('entity_type', YOUTUBE_SETTINGS_COMPAT_ENTITY_TYPE)
    .eq('owner_user_id', userId)
    .eq('record_id', YOUTUBE_SETTINGS_COMPAT_RECORD_ID)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  return result.data?.data || {};
}

async function upsertCompatSettingsRecord(userId, payload = {}) {
  const now = new Date().toISOString();
  const data = {
    ...payload,
    id: YOUTUBE_SETTINGS_COMPAT_RECORD_ID,
    created_date: payload.created_date || now,
    updated_date: now,
  };

  const result = await getAdmin()
    .from('legacy_entity_records')
    .upsert({
      entity_type: YOUTUBE_SETTINGS_COMPAT_ENTITY_TYPE,
      owner_user_id: userId,
      record_id: YOUTUBE_SETTINGS_COMPAT_RECORD_ID,
      data,
      updated_at: now,
    }, { onConflict: 'entity_type,owner_user_id,record_id' })
    .select('data')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return result.data?.data || data;
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
    claim_token: row.payload?.claim_token || '',
    recovery_count: Number(row.payload?.recovery_count || 0),
    recovered_at: row.payload?.recovered_at || null,
    recovery_reason: row.payload?.recovery_reason || '',
    recovered_from_worker_id: row.payload?.recovered_from_worker_id || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function isTimestampOlderThan(value, thresholdMs) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > thresholdMs;
}

function getWorkerState(lastHeartbeatAt, staleThresholdMs) {
  if (!lastHeartbeatAt) return 'offline';
  return isTimestampOlderThan(lastHeartbeatAt, staleThresholdMs) ? 'stale' : 'online';
}

function buildRecoveredPayload(payload = {}, { recoveredAt, workerId, reason }) {
  return {
    ...payload,
    claim_token: null,
    recovery_count: Number(payload?.recovery_count || 0) + 1,
    recovered_at: recoveredAt,
    recovery_reason: reason,
    recovered_from_worker_id: workerId || '',
  };
}

function buildClaimedPayload(payload = {}) {
  return {
    ...payload,
    claim_token: randomUUID(),
    claimed_at: new Date().toISOString(),
  };
}

function assertJobOwnership(job, { workerId = '', claimToken = '', action = 'complete' } = {}) {
  if (!job) {
    throw new HttpError(404, 'YouTube transcript job not found.');
  }

  const expectedClaimToken = String(job.payload?.claim_token || '');
  const currentWorkerId = String(job.worker_id || '');
  const ownershipMismatch = (
    job.status !== 'processing'
    || (workerId && currentWorkerId && currentWorkerId !== workerId)
    || (expectedClaimToken && claimToken !== expectedClaimToken)
  );

  if (!ownershipMismatch) return;

  console.warn('[youtube-worker] rejected stale worker mutation', {
    action,
    jobId: job.id,
    status: job.status,
    workerId,
    currentWorkerId,
    claimTokenMatches: expectedClaimToken ? claimToken === expectedClaimToken : null,
  });
  throw new HttpError(409, 'This YouTube transcript job is no longer owned by the current worker.');
}

function getStatusStaleMs() {
  const env = getServerEnv();
  return Math.max(Number(
    env.YOUTUBE_TRANSCRIPT_WORKER_STATUS_STALE_MS
    || env.INSTAGRAM_DOWNLOADER_STATUS_STALE_MS
    || 90000,
  ), 10000);
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

  if (result.error) {
    if (!isMissingYouTubeTranscriptQueueTableError(result.error)) {
      throw new HttpError(500, result.error.message);
    }
    return normalizeSettings(await getCompatSettingsRecord(userId));
  }

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

  if (result.error) {
    if (!isMissingYouTubeTranscriptQueueTableError(result.error)) {
      throw new HttpError(500, result.error.message);
    }
    const compat = await upsertCompatSettingsRecord(userId, payload);
    return normalizeSettings(compat);
  }
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

  if (result.error) {
    if (!isMissingYouTubeTranscriptQueueTableError(result.error)) {
      throw new HttpError(500, result.error.message);
    }

    const fallback = await getAdmin()
      .from(LEGACY_QUEUE_TABLE)
      .insert({
        owner_user_id: userId,
        resource_id: resourceId,
        source_url: url,
        status: 'queued',
        retry_count: 0,
        drive_target: LEGACY_QUEUE_DRIVE_TARGET,
        drive_folder_id: null,
        project_id: null,
        include_analysis: false,
        requested_at: now,
        scheduled_for: now,
        payload: {
          job_type: YOUTUBE_TRANSCRIPT_JOB_TYPE,
        },
      })
      .select('*')
      .single();

    if (fallback.error) throw new HttpError(500, fallback.error.message);
    return normalizeJob(fallback.data);
  }
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

  if (result.error) {
    if (!isMissingYouTubeTranscriptQueueTableError(result.error)) {
      throw new HttpError(500, result.error.message);
    }

    const fallback = await getAdmin()
      .from(LEGACY_QUEUE_TABLE)
      .select('*')
      .eq('owner_user_id', userId)
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (fallback.error) throw new HttpError(500, fallback.error.message);
    return (fallback.data || [])
      .map(normalizeJob)
      .filter((job) => job.job_type === YOUTUBE_TRANSCRIPT_JOB_TYPE)
      .find((job) => ['queued', 'processing'].includes(job.status)) || null;
  }

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

  if (existing.error && !isMissingYouTubeTranscriptQueueTableError(existing.error)) {
    throw new HttpError(500, existing.error.message);
  }

  const existingRow = existing.error
    ? await getAdmin()
      .from(LEGACY_QUEUE_TABLE)
      .select('*')
      .eq('owner_user_id', userId)
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then((fallback) => {
        if (fallback.error) throw new HttpError(500, fallback.error.message);
        return (fallback.data || [])
          .map(normalizeJob)
          .find((job) => job.job_type === YOUTUBE_TRANSCRIPT_JOB_TYPE) || null;
      })
    : (existing.data ? normalizeJob(existing.data) : null);

  const now = new Date().toISOString();
  if (existingRow) {
    const job = existingRow;
    if (job.status === 'processing' || job.status === 'queued') {
      const updated = await updateYouTubeTranscriptQueued(userId, resourceId, job.id);
      return { resource: updated, job, queued: true };
    }

    const retried = await getAdmin()
      .from(existing.error ? LEGACY_QUEUE_TABLE : 'youtube_transcript_jobs')
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

  if (jobsRes.error && !isMissingYouTubeTranscriptQueueTableError(jobsRes.error)) {
    throw new HttpError(500, jobsRes.error.message);
  }

  const jobs = jobsRes.error
    ? await getAdmin()
      .from(LEGACY_QUEUE_TABLE)
      .select('*')
      .eq('owner_user_id', userId)
      .eq('status', 'failed')
      .then((fallback) => {
        if (fallback.error) throw new HttpError(500, fallback.error.message);
        return (fallback.data || [])
          .map(normalizeJob)
          .filter((job) => job.job_type === YOUTUBE_TRANSCRIPT_JOB_TYPE);
      })
    : (jobsRes.data || []).map(normalizeJob);

  await Promise.all(jobs.map(async (job) => {
    const updateResult = await getAdmin()
      .from(jobsRes.error ? LEGACY_QUEUE_TABLE : 'youtube_transcript_jobs')
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
      .single();
    if (updateResult.error) throw new HttpError(500, updateResult.error.message);
  }));

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

  if (result.error) {
    if (!isMissingYouTubeTranscriptQueueTableError(result.error)) {
      throw new HttpError(500, result.error.message);
    }
    const fallback = await getAdmin()
      .from(LEGACY_WORKER_TABLE)
      .upsert({
        worker_id: workerId,
        label: label || 'YouTube Transcript Worker',
        version: version || '',
        metadata: metadata || {},
        status: 'online',
        last_heartbeat_at: new Date().toISOString(),
        current_job_id: currentJobId || null,
      }, { onConflict: 'worker_id' })
      .select('*')
      .single();
    if (fallback.error) throw new HttpError(500, fallback.error.message);
    return fallback.data;
  }
  return result.data;
}

async function recoverStaleYouTubeTranscriptJobs() {
  const recoveryThresholdMs = getProcessingRecoveryThresholdMs();
  const [jobsRes, workersRes] = await Promise.all([
    getAdmin()
      .from('youtube_transcript_jobs')
      .select('*')
      .eq('status', 'processing')
      .order('started_at', { ascending: true })
      .limit(25),
    getAdmin()
      .from('youtube_transcript_workers')
      .select('*'),
  ]);

  if (jobsRes.error && !isMissingYouTubeTranscriptQueueTableError(jobsRes.error)) {
    throw new HttpError(500, jobsRes.error.message);
  }
  if (workersRes.error && !isMissingYouTubeTranscriptQueueTableError(workersRes.error)) {
    throw new HttpError(500, workersRes.error.message);
  }

  if (jobsRes.error || workersRes.error) {
    const [legacyJobsRes, legacyWorkersRes] = await Promise.all([
      getAdmin()
        .from(LEGACY_QUEUE_TABLE)
        .select('*')
        .eq('status', 'processing')
        .order('started_at', { ascending: true })
        .limit(50),
      getAdmin()
        .from(LEGACY_WORKER_TABLE)
        .select('*'),
    ]);

    if (legacyJobsRes.error) throw new HttpError(500, legacyJobsRes.error.message);
    if (legacyWorkersRes.error) throw new HttpError(500, legacyWorkersRes.error.message);

    const workersById = new Map((legacyWorkersRes.data || []).map((worker) => [worker.worker_id, worker]));
    const now = new Date().toISOString();

    for (const row of (legacyJobsRes.data || []).filter((item) => (item.payload?.job_type || '') === YOUTUBE_TRANSCRIPT_JOB_TYPE)) {
      const worker = row.worker_id ? workersById.get(row.worker_id) : null;
      const workerHeartbeatStale = !worker || isTimestampOlderThan(worker.last_heartbeat_at, recoveryThresholdMs);
      const jobStartedTooLongAgo = isTimestampOlderThan(row.started_at || row.updated_at || row.created_at, recoveryThresholdMs);
      if (!workerHeartbeatStale || !jobStartedTooLongAgo) continue;

      const recovered = await getAdmin()
        .from(LEGACY_QUEUE_TABLE)
        .update({
          status: 'queued',
          scheduled_for: now,
          started_at: null,
          completed_at: null,
          worker_id: null,
          last_error: row.last_error || null,
          payload: buildRecoveredPayload(row.payload || {}, {
            recoveredAt: now,
            workerId: row.worker_id || '',
            reason: 'stale_worker_heartbeat',
          }),
        })
        .eq('id', row.id)
        .eq('status', 'processing')
        .select('*')
        .maybeSingle();

      if (recovered.error) throw new HttpError(500, recovered.error.message);
      if (recovered.data) {
        const job = normalizeJob(recovered.data);
        console.warn('[youtube-worker] recovered stale processing job', {
          jobId: job.id,
          previousWorkerId: row.worker_id || '',
          recoveredAt: job.recovered_at,
        });
        await updateYouTubeTranscriptQueued(job.owner_user_id, job.resource_id, job.id).catch(() => null);
      }
    }
    return;
  }

  const workersById = new Map((workersRes.data || []).map((worker) => [worker.worker_id, worker]));
  const now = new Date().toISOString();

  for (const row of jobsRes.data || []) {
    const worker = row.worker_id ? workersById.get(row.worker_id) : null;
    const workerHeartbeatStale = !worker || isTimestampOlderThan(worker.last_heartbeat_at, recoveryThresholdMs);
    const jobStartedTooLongAgo = isTimestampOlderThan(row.started_at || row.updated_at || row.created_at, recoveryThresholdMs);
    if (!workerHeartbeatStale || !jobStartedTooLongAgo) continue;

    const recovered = await getAdmin()
      .from('youtube_transcript_jobs')
      .update({
        status: 'queued',
        scheduled_for: now,
        started_at: null,
        completed_at: null,
        worker_id: null,
        last_error: row.last_error || null,
        payload: buildRecoveredPayload(row.payload || {}, {
          recoveredAt: now,
          workerId: row.worker_id || '',
          reason: 'stale_worker_heartbeat',
        }),
      })
      .eq('id', row.id)
      .eq('status', 'processing')
      .select('*')
      .maybeSingle();

    if (recovered.error) throw new HttpError(500, recovered.error.message);
    if (recovered.data) {
      const job = normalizeJob(recovered.data);
      console.warn('[youtube-worker] recovered stale processing job', {
        jobId: job.id,
        previousWorkerId: row.worker_id || '',
        recoveredAt: job.recovered_at,
      });
      await updateYouTubeTranscriptQueued(job.owner_user_id, job.resource_id, job.id).catch(() => null);
    }
  }
}

export async function claimNextYouTubeTranscriptJob(workerId) {
  await recoverStaleYouTubeTranscriptJobs();

  const queued = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('scheduled_for', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(10);

  if (queued.error) {
    if (!isMissingYouTubeTranscriptQueueTableError(queued.error)) {
      throw new HttpError(500, queued.error.message);
    }

    const legacyQueued = await getAdmin()
      .from(LEGACY_QUEUE_TABLE)
      .select('*')
      .eq('status', 'queued')
      .order('scheduled_for', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(20);

    if (legacyQueued.error) throw new HttpError(500, legacyQueued.error.message);

    for (const row of (legacyQueued.data || []).filter((item) => (item.payload?.job_type || '') === YOUTUBE_TRANSCRIPT_JOB_TYPE)) {
      const claimed = await getAdmin()
        .from(LEGACY_QUEUE_TABLE)
        .update({
          status: 'processing',
          started_at: new Date().toISOString(),
          worker_id: workerId,
          payload: buildClaimedPayload(row.payload || {}),
        })
        .eq('id', row.id)
        .eq('status', 'queued')
        .select('*')
        .maybeSingle();

      if (claimed.error) throw new HttpError(500, claimed.error.message);
      if (!claimed.data) continue;

      const job = normalizeJob(claimed.data);
      console.info('[youtube-worker] claimed job', {
        jobId: job.id,
        workerId,
        resourceId: job.resource_id,
      });
      await updateYouTubeTranscriptProcessing(job.owner_user_id, job.resource_id, workerId, job.id).catch(() => null);
      return {
        job,
        settings: await getYouTubeTranscriptSettingsForUser(job.owner_user_id),
      };
    }

    return null;
  }

  for (const row of queued.data || []) {
    const claimed = await getAdmin()
      .from('youtube_transcript_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        worker_id: workerId,
        payload: buildClaimedPayload(row.payload || {}),
      })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('*')
      .maybeSingle();

    if (claimed.error) throw new HttpError(500, claimed.error.message);
    if (!claimed.data) continue;

    const job = normalizeJob(claimed.data);
    console.info('[youtube-worker] claimed job', {
      jobId: job.id,
      workerId,
      resourceId: job.resource_id,
    });
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

  if (result.error && !isMissingYouTubeTranscriptQueueTableError(result.error)) {
    throw new HttpError(500, result.error.message);
  }
  const row = result.error
    ? await getAdmin()
      .from(LEGACY_QUEUE_TABLE)
      .select('*')
      .eq('id', jobId)
      .maybeSingle()
      .then((fallback) => {
        if (fallback.error) throw new HttpError(500, fallback.error.message);
        return fallback.data;
      })
    : result.data;

  if (!row) throw new HttpError(404, 'YouTube transcript job not found.');

  const job = normalizeJob(row);
  assertJobOwnership(job, {
    workerId: transcript?.worker_id || '',
    claimToken: transcript?.claim_token || '',
    action: 'complete',
  });
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
    .from(result.error ? LEGACY_QUEUE_TABLE : 'youtube_transcript_jobs')
    .delete()
    .eq('id', jobId);

  if (deleteResult.error) throw new HttpError(500, deleteResult.error.message);
  console.info('[youtube-worker] completed job', {
    jobId: job.id,
    workerId: job.worker_id || transcript?.worker_id || '',
    resourceId: job.resource_id,
  });

  await registerYouTubeTranscriptWorkerHeartbeat({
    workerId: job.worker_id || 'worker',
    currentJobId: null,
  }).catch(() => null);

  return { job, resource };
}

export async function failYouTubeTranscriptJob(jobId, errorMessage) {
  const workerId = typeof errorMessage === 'object' ? (errorMessage?.workerId || '') : '';
  const claimToken = typeof errorMessage === 'object' ? (errorMessage?.claimToken || '') : '';
  const resolvedErrorMessage = typeof errorMessage === 'object' ? (errorMessage?.message || '') : errorMessage;
  const current = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (current.error && !isMissingYouTubeTranscriptQueueTableError(current.error)) {
    throw new HttpError(500, current.error.message);
  }
  const row = current.error
    ? await getAdmin()
      .from(LEGACY_QUEUE_TABLE)
      .select('*')
      .eq('id', jobId)
      .maybeSingle()
      .then((fallback) => {
        if (fallback.error) throw new HttpError(500, fallback.error.message);
        return fallback.data;
      })
    : current.data;

  if (!row) throw new HttpError(404, 'YouTube transcript job not found.');

  assertJobOwnership(normalizeJob(row), {
    workerId,
    claimToken,
    action: 'fail',
  });
  const retryCount = Number(row.retry_count || 0) + 1;
  const result = await getAdmin()
    .from(current.error ? LEGACY_QUEUE_TABLE : 'youtube_transcript_jobs')
    .update({
      status: 'failed',
      retry_count: retryCount,
      last_error: resolvedErrorMessage || 'YouTube transcript failed.',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'processing')
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);

  const job = normalizeJob(result.data);
  console.warn('[youtube-worker] failed job', {
    jobId: job.id,
    workerId: workerId || job.worker_id || '',
    error: job.last_error,
  });
  await updateYouTubeTranscriptFailed(job.owner_user_id, job.resource_id, job.last_error).catch(() => null);
  return job;
}

export async function getYouTubeTranscriptStatusForUser(userId) {
  const env = getServerEnv();
  const staleMs = getStatusStaleMs();
  const settings = await getYouTubeTranscriptSettingsForUser(userId);

  const workerRes = await getAdmin()
    .from('youtube_transcript_workers')
    .select('*')
    .order('last_heartbeat_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (workerRes.error && !isMissingYouTubeTranscriptQueueTableError(workerRes.error)) {
    throw new HttpError(500, workerRes.error.message);
  }

  const jobsRes = await getAdmin()
    .from('youtube_transcript_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(25);

  if (jobsRes.error && !isMissingYouTubeTranscriptQueueTableError(jobsRes.error)) {
    throw new HttpError(500, jobsRes.error.message);
  }

  let jobs = jobsRes.error
    ? await getAdmin()
      .from(LEGACY_QUEUE_TABLE)
      .select('*')
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then((fallback) => {
        if (fallback.error) throw new HttpError(500, fallback.error.message);
        return (fallback.data || [])
          .map(normalizeJob)
          .filter((job) => job.job_type === YOUTUBE_TRANSCRIPT_JOB_TYPE)
          .slice(0, 25);
      })
    : (jobsRes.data || []).map(normalizeJob);
  const thresholdMs = getProcessingRecoveryThresholdMs();
  const resourcesById = await fetchResourceRecords(userId, jobs.map((job) => job.resource_id));

  let repaired = false;
  for (const job of jobs) {
    if (job.status !== 'processing') continue;
    if (!isTimestampOlderThan(job.started_at || job.requested_at || job.created_at, thresholdMs)) continue;
    const recoveredAt = new Date().toISOString();
    const recovered = await getAdmin()
      .from(jobsRes.error ? LEGACY_QUEUE_TABLE : 'youtube_transcript_jobs')
      .update({
        status: 'queued',
        scheduled_for: recoveredAt,
        started_at: null,
        completed_at: null,
        worker_id: null,
        updated_at: recoveredAt,
        payload: buildRecoveredPayload(job.payload || {}, {
          recoveredAt,
          workerId: job.worker_id || '',
          reason: 'stale_worker_heartbeat',
        }),
      })
      .eq('id', job.id)
      .eq('status', 'processing')
      .select('*')
      .maybeSingle();
    if (recovered.error) throw new HttpError(500, recovered.error.message);
    console.warn('[youtube-worker] recovered stale processing job from status repair', {
      jobId: job.id,
      previousWorkerId: job.worker_id || '',
      recoveredAt,
    });
    await updateYouTubeTranscriptQueued(userId, job.resource_id, job.id).catch(() => null);
    repaired = true;
  }

  if (repaired) {
    const refreshed = await getAdmin()
      .from(jobsRes.error ? LEGACY_QUEUE_TABLE : 'youtube_transcript_jobs')
      .select('*')
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(jobsRes.error ? 50 : 25);
    if (refreshed.error) throw new HttpError(500, refreshed.error.message);
    jobs = (refreshed.data || [])
      .map(normalizeJob)
      .filter((job) => (jobsRes.error ? job.job_type === YOUTUBE_TRANSCRIPT_JOB_TYPE : true))
      .slice(0, 25);
  }

  const counts = jobs.reduce((acc, job) => {
    acc.total += 1;
    if (job.status === 'queued') acc.queued += 1;
    if (job.status === 'processing') acc.processing += 1;
    if (job.status === 'failed') acc.failed += 1;
    if (job.recovery_reason === 'stale_worker_heartbeat') acc.recovered += 1;
    return acc;
  }, { total: 0, queued: 0, processing: 0, failed: 0, recovered: 0 });

  const workerRow = workerRes.error
    ? await getAdmin()
      .from(LEGACY_WORKER_TABLE)
      .select('*')
      .order('last_heartbeat_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((fallback) => {
        if (fallback.error) throw new HttpError(500, fallback.error.message);
        return fallback.data;
      })
    : workerRes.data;

  const worker = workerRow
    ? {
        worker_id: workerRow.worker_id,
        label: workerRow.label || workerRow.worker_id,
        status: workerRow.status || 'unknown',
        last_heartbeat_at: workerRow.last_heartbeat_at,
        current_job_id: workerRow.current_job_id || '',
        version: workerRow.version || '',
        metadata: workerRow.metadata || {},
        state: getWorkerState(workerRow.last_heartbeat_at, staleMs),
        online: getWorkerState(workerRow.last_heartbeat_at, staleMs) === 'online',
      }
    : {
        worker_id: '',
        label: 'YouTube Transcript Worker',
        status: 'offline',
        last_heartbeat_at: null,
        current_job_id: '',
        version: '',
        metadata: {},
        state: 'offline',
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

export async function getYouTubeTranscriptWorkerQueueSummary() {
  await recoverStaleYouTubeTranscriptJobs();

  const [jobsRes, workerRes] = await Promise.all([
    getAdmin()
      .from('youtube_transcript_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50),
    getAdmin()
      .from('youtube_transcript_workers')
      .select('*')
      .order('last_heartbeat_at', { ascending: false })
      .limit(5),
  ]);

  if (jobsRes.error && !isMissingYouTubeTranscriptQueueTableError(jobsRes.error)) {
    throw new HttpError(500, jobsRes.error.message);
  }
  if (workerRes.error && !isMissingYouTubeTranscriptQueueTableError(workerRes.error)) {
    throw new HttpError(500, workerRes.error.message);
  }

  const jobs = jobsRes.error
    ? await getAdmin()
      .from(LEGACY_QUEUE_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
      .then((fallback) => {
        if (fallback.error) throw new HttpError(500, fallback.error.message);
        return (fallback.data || [])
          .map(normalizeJob)
          .filter((job) => job.job_type === YOUTUBE_TRANSCRIPT_JOB_TYPE)
          .slice(0, 50);
      })
    : (jobsRes.data || []).map(normalizeJob);

  const counts = jobs.reduce((acc, job) => {
    acc.total += 1;
    if (job.status === 'queued') acc.queued += 1;
    if (job.status === 'processing') acc.processing += 1;
    if (job.status === 'failed') acc.failed += 1;
    if (job.recovery_reason === 'stale_worker_heartbeat') acc.recovered += 1;
    return acc;
  }, { total: 0, queued: 0, processing: 0, failed: 0, recovered: 0 });

  const workerRows = workerRes.error
    ? await getAdmin()
      .from(LEGACY_WORKER_TABLE)
      .select('*')
      .order('last_heartbeat_at', { ascending: false })
      .limit(5)
      .then((fallback) => {
        if (fallback.error) throw new HttpError(500, fallback.error.message);
        return fallback.data || [];
      })
    : (workerRes.data || []);

  return {
    queue: {
      ...counts,
      items: jobs.slice(0, 10).map((job) => ({
        id: job.id,
        resource_id: job.resource_id,
        source_url: job.source_url,
        status: job.status,
        last_error: job.last_error || '',
        worker_id: job.worker_id || '',
        requested_at: job.requested_at,
        scheduled_for: job.scheduled_for,
        started_at: job.started_at,
        completed_at: job.completed_at,
        recovered_at: job.recovered_at,
        recovery_reason: job.recovery_reason,
      })),
    },
    workers: workerRows.map((worker) => ({
      worker_id: worker.worker_id,
      label: worker.label || worker.worker_id,
      status: worker.status || 'unknown',
      last_heartbeat_at: worker.last_heartbeat_at,
      current_job_id: worker.current_job_id || '',
      state: getWorkerState(worker.last_heartbeat_at, getStatusStaleMs()),
    })),
  };
}
