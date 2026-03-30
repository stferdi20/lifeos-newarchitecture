import { HttpError } from '../lib/http.js';
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

export async function claimNextResourceCaptureJob(workerId = 'resource-capture-worker') {
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
      })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('*')
      .maybeSingle();

    if (claimed.error) throw new HttpError(500, claimed.error.message);
    if (!claimed.data) continue;

    const job = normalizeJob(claimed.data);
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

export async function completeGenericCaptureJob(jobId) {
  const jobRes = await getAdmin()
    .from('resource_capture_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (jobRes.error) throw new HttpError(500, jobRes.error.message);
  if (!jobRes.data) throw new HttpError(404, 'Resource capture job not found.');

  const job = normalizeJob(jobRes.data);
  const analyzed = await analyzeResource({
    url: job.source_url,
    userId: job.owner_user_id,
  });
  return completeResourceCaptureJob(jobId, analyzed);
}

export async function failResourceCaptureJob(jobId, message = '') {
  const currentJobRes = await getAdmin()
    .from('resource_capture_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (currentJobRes.error) throw new HttpError(500, currentJobRes.error.message);
  if (!currentJobRes.data) throw new HttpError(404, 'Resource capture job not found.');

  const currentJob = normalizeJob(currentJobRes.data);
  const result = await getAdmin()
    .from('resource_capture_jobs')
    .update({
      status: 'failed',
      retry_count: Number(currentJob.retry_count || 0) + 1,
      last_error: message || 'Resource capture failed.',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  const job = normalizeJob(result.data);
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
