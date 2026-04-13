import { HttpError } from '../lib/http.js';
import { randomUUID } from 'node:crypto';
import { getServerEnv } from '../config/env.js';
import { getServiceRoleClient } from '../lib/supabase.js';
import { analyzeResource } from './resources.js';
import { createCompatEntity, getCompatEntity, updateCompatEntity } from './compat-store.js';
import { inferResourceType, normalizeResourceRecord } from './compat-functions.js';

const CAPTURE_SOURCE_VALUES = new Set([
  'manual_modal',
  'ios_share_shortcut',
  'capture_page',
  'quick_paste',
]);
const RESOURCE_CAPTURE_JOB_TYPE = 'resource_capture';

function getAdmin() {
  return getServiceRoleClient();
}

function normalizeHttpUrl(input = '') {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';

  let value = trimmed;
  if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, 'A valid URL is required.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(400, 'Only http and https URLs are supported.');
  }

  parsed.hash = '';
  if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
    parsed.port = '';
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = pathname || '/';
  return parsed.toString();
}

function normalizeCaptureSource(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return CAPTURE_SOURCE_VALUES.has(normalized) ? normalized : 'manual_modal';
}

function buildPendingCaptureTitle(url = '') {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const segments = parsed.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .slice(0, 2);
    const suffix = segments.length ? `/${segments.join('/')}` : '';
    return `Queued from ${host}${suffix}`;
  } catch {
    return 'Queued Resource Capture';
  }
}

function buildQueuedMessage() {
  return 'Queued for background capture. LifeOS will analyze and save it automatically.';
}

function buildProcessingMessage() {
  return 'Analyzing and saving this resource in the background.';
}

function buildCompletedMessage() {
  return 'Resource capture completed.';
}

function buildFailedMessage(message = '') {
  return message ? `Resource capture failed: ${message}` : 'Resource capture failed.';
}

function isInstagramResourceType(resourceType = '') {
  return ['instagram_reel', 'instagram_carousel', 'instagram_post'].includes(String(resourceType || ''));
}

function isTimestampOlderThan(value, thresholdMs) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > thresholdMs;
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
    throw new HttpError(404, 'Resource capture job not found.');
  }

  const expectedClaimToken = String(job.payload?.claim_token || '');
  const currentWorkerId = String(job.worker_id || '');
  const ownershipMismatch = (
    job.status !== 'processing'
    || (workerId && currentWorkerId && currentWorkerId !== workerId)
    || (expectedClaimToken && claimToken !== expectedClaimToken)
  );

  if (!ownershipMismatch) return;

  console.warn('[resource-capture-worker] rejected stale worker mutation', {
    action,
    jobId: job.id,
    status: job.status,
    workerId,
    currentWorkerId,
    claimTokenMatches: expectedClaimToken ? claimToken === expectedClaimToken : null,
  });
  throw new HttpError(409, 'This resource capture job is no longer owned by the current worker.');
}

function getProcessingRecoveryThresholdMs() {
  const env = getServerEnv();
  const staleMs = Math.max(Number(env.INSTAGRAM_DOWNLOADER_STATUS_STALE_MS || 90000), 10000);
  return Math.max(staleMs * 3, 5 * 60 * 1000);
}

function normalizeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    resource_id: row.resource_id,
    source_url: row.source_url,
    normalized_url: row.normalized_url,
    status: row.status,
    retry_count: Number(row.retry_count || 0),
    last_error: row.last_error || '',
    project_id: row.project_id || '',
    capture_source: row.capture_source || 'manual_modal',
    worker_id: row.worker_id || '',
    requested_at: row.requested_at || row.created_at || null,
    scheduled_for: row.scheduled_for || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    payload: row.payload || {},
    job_type: row.payload?.job_type || RESOURCE_CAPTURE_JOB_TYPE,
    claim_token: row.payload?.claim_token || '',
    recovery_count: Number(row.payload?.recovery_count || 0),
    recovered_at: row.payload?.recovered_at || null,
    recovery_reason: row.payload?.recovery_reason || '',
    recovered_from_worker_id: row.payload?.recovered_from_worker_id || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function fetchResourceTitles(ownerUserId, resourceIds = []) {
  const ids = [...new Set((resourceIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const result = await getAdmin()
    .from('legacy_entity_records')
    .select('record_id,data')
    .eq('entity_type', 'Resource')
    .eq('owner_user_id', ownerUserId)
    .in('record_id', ids);

  if (result.error) throw new HttpError(500, result.error.message);
  return new Map((result.data || []).map((row) => [row.record_id, row.data?.title || '']));
}

export async function createPendingCapturedResource(userId, {
  url,
  projectId = '',
  captureSource = 'manual_modal',
}) {
  const resourceType = inferResourceType(url);
  const resource = await createCompatEntity(userId, 'Resource', {
    title: buildPendingCaptureTitle(url),
    url,
    source_url: url,
    resource_type: resourceType,
    summary: '',
    why_it_matters: '',
    who_its_for: '',
    main_topic: '',
    resource_score: 5,
    tags: [],
    key_points: [],
    actionable_points: [],
    use_cases: [],
    learning_outcomes: [],
    notable_quotes_or_moments: [],
    capture_status: 'queued',
    capture_status_message: buildQueuedMessage(),
    capture_job_id: '',
    capture_source: normalizeCaptureSource(captureSource),
    capture_error: '',
    is_archived: false,
  });

  if (projectId) {
    await createCompatEntity(userId, 'ProjectResource', {
      project_id: projectId,
      resource_id: resource.id,
      created_date: new Date().toISOString(),
    });
  }

  return resource;
}

export async function createResourceCaptureJob(userId, {
  resourceId,
  url,
  normalizedUrl = '',
  projectId = '',
  captureSource = 'manual_modal',
}) {
  const now = new Date().toISOString();
  const result = await getAdmin()
    .from('resource_capture_jobs')
    .insert({
      owner_user_id: userId,
      resource_id: resourceId,
      source_url: url,
      normalized_url: normalizedUrl || normalizeHttpUrl(url),
      status: 'queued',
      retry_count: 0,
      project_id: projectId || null,
      capture_source: normalizeCaptureSource(captureSource),
      requested_at: now,
      scheduled_for: now,
      payload: {
        job_type: RESOURCE_CAPTURE_JOB_TYPE,
      },
    })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeJob(result.data);
}

export async function getGenericCaptureWorkerSummary() {
  const jobsRes = await getAdmin()
    .from('resource_capture_jobs')
    .select('status');

  if (jobsRes.error) throw new HttpError(500, jobsRes.error.message);
  return (jobsRes.data || []).reduce((acc, row) => {
    acc.total += 1;
    if (row.status === 'queued') acc.queued += 1;
    if (row.status === 'processing') acc.processing += 1;
    if (row.status === 'failed') acc.failed += 1;
    return acc;
  }, { total: 0, queued: 0, processing: 0, failed: 0 });
}

async function updateResourceQueued(userId, resourceId, job) {
  return updateCompatEntity(userId, 'Resource', resourceId, {
    capture_status: 'queued',
    capture_status_message: buildQueuedMessage(),
    capture_job_id: job?.id || '',
    capture_source: job?.capture_source || 'manual_modal',
    capture_error: '',
  });
}

async function updateResourceProcessing(userId, resourceId, job) {
  return updateCompatEntity(userId, 'Resource', resourceId, {
    capture_status: 'processing',
    capture_status_message: buildProcessingMessage(),
    capture_job_id: job?.id || '',
    capture_source: job?.capture_source || 'manual_modal',
    capture_error: '',
  });
}

async function updateResourceFailed(userId, resourceId, message, job) {
  return updateCompatEntity(userId, 'Resource', resourceId, {
    capture_status: 'failed',
    capture_status_message: buildFailedMessage(message),
    capture_job_id: job?.id || '',
    capture_source: job?.capture_source || 'manual_modal',
    capture_error: message || 'Resource capture failed.',
  });
}

function mergePreservingCaptureState(current = {}, normalized = {}, job = {}) {
  return {
    ...current,
    ...normalized,
    id: current.id,
    created_date: current.created_date,
    capture_status: 'completed',
    capture_status_message: buildCompletedMessage(),
    capture_job_id: '',
    capture_source: current.capture_source || job.capture_source || 'manual_modal',
    capture_error: '',
  };
}

export async function findActiveCaptureJobForUrl(userId, normalizedUrl) {
  const result = await getAdmin()
    .from('resource_capture_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('normalized_url', normalizedUrl)
    .in('status', ['queued', 'processing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeJob(result.data);
}

export async function submitResourceCapture(userId, {
  url,
  projectId = '',
  source = 'manual_modal',
}) {
  const normalizedUrl = normalizeHttpUrl(url);
  const captureSource = normalizeCaptureSource(source);
  const activeJob = await findActiveCaptureJobForUrl(userId, normalizedUrl);

  if (activeJob) {
    const resource = await updateResourceQueued(userId, activeJob.resource_id, activeJob);
    return {
      success: true,
      queued: true,
      deduped: true,
      resource,
      job: activeJob,
    };
  }

  const resource = await createPendingCapturedResource(userId, {
    url: normalizedUrl,
    projectId,
    captureSource,
  });
  const job = await createResourceCaptureJob(userId, {
    resourceId: resource.id,
    url: normalizedUrl,
    normalizedUrl,
    projectId,
    captureSource,
  });
  const updated = await updateResourceQueued(userId, resource.id, job);

  return {
    success: true,
    queued: true,
    deduped: false,
    resource: updated,
    job,
  };
}

export async function getResourceCaptureStatusForUser(userId) {
  const jobsRes = await getAdmin()
    .from('resource_capture_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(25);

  if (jobsRes.error) throw new HttpError(500, jobsRes.error.message);
  const jobs = (jobsRes.data || []).map(normalizeJob);
  const titlesById = await fetchResourceTitles(userId, jobs.map((job) => job.resource_id));

  const counts = jobs.reduce((acc, job) => {
    acc.total += 1;
    if (job.status === 'queued') acc.queued += 1;
    if (job.status === 'processing') acc.processing += 1;
    if (job.status === 'failed') acc.failed += 1;
    return acc;
  }, { total: 0, queued: 0, processing: 0, failed: 0 });

  return {
    queue: {
      ...counts,
      items: jobs.map((job) => ({
        ...job,
        resource_title: titlesById.get(job.resource_id) || buildPendingCaptureTitle(job.source_url),
      })),
    },
  };
}

async function hasProcessingJobForUser(userId) {
  const result = await getAdmin()
    .from('resource_capture_jobs')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('status', 'processing')
    .limit(1)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  return Boolean(result.data?.id);
}

async function recoverStaleResourceCaptureJobs() {
  const recoveryThresholdMs = getProcessingRecoveryThresholdMs();
  const [jobsRes, workersRes] = await Promise.all([
    getAdmin()
      .from('resource_capture_jobs')
      .select('*')
      .eq('status', 'processing')
      .order('started_at', { ascending: true })
      .limit(25),
    getAdmin()
      .from('instagram_downloader_workers')
      .select('*'),
  ]);

  if (jobsRes.error) throw new HttpError(500, jobsRes.error.message);
  if (workersRes.error) throw new HttpError(500, workersRes.error.message);

  const workersById = new Map((workersRes.data || []).map((worker) => [worker.worker_id, worker]));
  const now = new Date().toISOString();

  for (const row of jobsRes.data || []) {
    const worker = row.worker_id ? workersById.get(row.worker_id) : null;
    const workerHeartbeatStale = !worker || isTimestampOlderThan(worker.last_heartbeat_at, recoveryThresholdMs);
    const jobStartedTooLongAgo = isTimestampOlderThan(row.started_at || row.updated_at || row.created_at, recoveryThresholdMs);

    if (!workerHeartbeatStale || !jobStartedTooLongAgo) continue;

    const recovered = await getAdmin()
      .from('resource_capture_jobs')
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
      console.warn('[resource-capture-worker] recovered stale processing job', {
        jobId: job.id,
        previousWorkerId: row.worker_id || '',
        recoveredAt: job.recovered_at,
      });
      await updateResourceQueued(job.owner_user_id, job.resource_id, job).catch(() => null);
    }
  }
}

export async function claimNextResourceCaptureJob(workerId = 'resource-capture-worker') {
  await recoverStaleResourceCaptureJobs();

  const queued = await getAdmin()
    .from('resource_capture_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('scheduled_for', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(20);

  if (queued.error) throw new HttpError(500, queued.error.message);

  for (const row of queued.data || []) {
    if (await hasProcessingJobForUser(row.owner_user_id)) continue;

    const claimed = await getAdmin()
      .from('resource_capture_jobs')
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
    console.info('[resource-capture-worker] claimed job', {
      jobId: job.id,
      workerId,
      resourceId: job.resource_id,
    });
    await updateResourceProcessing(job.owner_user_id, job.resource_id, job).catch(() => null);
    return job;
  }

  return null;
}

export async function claimNextGenericCaptureJob(workerId = 'resource-capture-worker') {
  const job = await claimNextResourceCaptureJob(workerId);
  if (!job) return null;
  return {
    job,
  };
}

export async function completeResourceCaptureJob(jobId, analyzed) {
  const currentJobRes = await getAdmin()
    .from('resource_capture_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (currentJobRes.error) throw new HttpError(500, currentJobRes.error.message);
  if (!currentJobRes.data) throw new HttpError(404, 'Resource capture job not found.');

  const job = normalizeJob(currentJobRes.data);
  assertJobOwnership(job, {
    workerId: analyzed?.worker_id || '',
    claimToken: analyzed?.claim_token || '',
    action: 'complete',
  });
  const currentResource = await getCompatEntity(job.owner_user_id, 'Resource', job.resource_id);
  const normalized = normalizeResourceRecord(job.source_url, analyzed?.data || {});
  const updated = await updateCompatEntity(
    job.owner_user_id,
    'Resource',
    job.resource_id,
    mergePreservingCaptureState(currentResource, normalized, job),
  );

  const done = await getAdmin()
    .from('resource_capture_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', jobId)
    .select('*')
    .single();

  if (done.error) throw new HttpError(500, done.error.message);
  console.info('[resource-capture-worker] completed job', {
    jobId: job.id,
    workerId: job.worker_id || analyzed?.worker_id || '',
    resourceId: job.resource_id,
  });

  if (updated?.resource_type === 'youtube' && updated?.content_source !== 'youtube_transcript') {
    try {
      const { maybeQueueYouTubeTranscriptJobForResource } = await import('./instagram-download-queue.js');
      const maybeQueued = await maybeQueueYouTubeTranscriptJobForResource(job.owner_user_id, updated);
      return { job: normalizeJob(done.data), resource: maybeQueued };
    } catch {
      return { job: normalizeJob(done.data), resource: updated };
    }
  }

  return { job: normalizeJob(done.data), resource: updated };
}

export async function completeGenericCaptureJob(jobId, workerMeta = {}) {
  const jobRes = await getAdmin()
    .from('resource_capture_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (jobRes.error) throw new HttpError(500, jobRes.error.message);
  if (!jobRes.data) throw new HttpError(404, 'Resource capture job not found.');

  const job = normalizeJob(jobRes.data);
  const resourceType = inferResourceType(job.source_url);
  if (isInstagramResourceType(resourceType)) {
    const { retryInstagramDownloadForResource } = await import('./instagram-download-queue.js');
    const handoff = await retryInstagramDownloadForResource(job.owner_user_id, job.resource_id);
    await completeResourceCaptureJob(jobId, {
      ...workerMeta,
      data: {
        title: handoff?.resource?.title || buildPendingCaptureTitle(job.source_url),
        summary: handoff?.resource?.download_status_message || 'Instagram download queued.',
        resource_type: handoff?.resource?.resource_type || resourceType,
      },
    });
    return {
      job: {
        ...job,
        status: 'completed',
      },
      resource: handoff?.resource,
      handed_off: 'instagram_download',
    };
  }

  const analyzed = await analyzeResource({
    url: job.source_url,
    userId: job.owner_user_id,
  });
  return completeResourceCaptureJob(jobId, {
    ...analyzed,
    ...workerMeta,
  });
}

export async function failResourceCaptureJob(jobId, message = '') {
  const workerId = typeof message === 'object' ? (message?.workerId || '') : '';
  const claimToken = typeof message === 'object' ? (message?.claimToken || '') : '';
  const resolvedMessage = typeof message === 'object' ? (message?.message || '') : message;
  const currentJobRes = await getAdmin()
    .from('resource_capture_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (currentJobRes.error) throw new HttpError(500, currentJobRes.error.message);
  if (!currentJobRes.data) throw new HttpError(404, 'Resource capture job not found.');

  const currentJob = normalizeJob(currentJobRes.data);
  assertJobOwnership(currentJob, {
    workerId,
    claimToken,
    action: 'fail',
  });
  const result = await getAdmin()
    .from('resource_capture_jobs')
    .update({
      status: 'failed',
      retry_count: Number(currentJob.retry_count || 0) + 1,
      last_error: resolvedMessage || 'Resource capture failed.',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'processing')
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  const job = normalizeJob(result.data);
  console.warn('[resource-capture-worker] failed job', {
    jobId: job.id,
    workerId: workerId || job.worker_id || '',
    error: job.last_error,
  });
  await updateResourceFailed(job.owner_user_id, job.resource_id, job.last_error, job).catch(() => null);
  return job;
}

export async function retryResourceCaptureForResource(userId, resourceId) {
  const existing = await getAdmin()
    .from('resource_capture_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) throw new HttpError(500, existing.error.message);

  if (existing.data) {
    const job = normalizeJob(existing.data);
    if (job.status === 'queued' || job.status === 'processing') {
      const resource = await updateResourceQueued(userId, resourceId, job);
      return { queued: true, resource, job };
    }

    const retried = await getAdmin()
      .from('resource_capture_jobs')
      .update({
        status: 'queued',
        last_error: null,
        scheduled_for: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        worker_id: null,
      })
      .eq('id', job.id)
      .select('*')
      .single();

    if (retried.error) throw new HttpError(500, retried.error.message);
    const retriedJob = normalizeJob(retried.data);
    const resource = await updateResourceQueued(userId, resourceId, retriedJob);
    return { queued: true, resource, job: retriedJob };
  }

  const resource = await getCompatEntity(userId, 'Resource', resourceId);
  const submitted = await submitResourceCapture(userId, {
    url: resource.source_url || resource.url,
    projectId: '',
    source: resource.capture_source || 'manual_modal',
  });
  return submitted;
}
