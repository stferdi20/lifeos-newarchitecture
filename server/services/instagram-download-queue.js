import { HttpError } from '../lib/http.js';
import { randomUUID } from 'node:crypto';
import { getServiceRoleClient } from '../lib/supabase.js';
import { getServerEnv } from '../config/env.js';
import { createCompatEntity, getCompatEntity, updateCompatEntity } from './compat-store.js';
import { inferResourceType, normalizeResourceRecord } from './compat-functions.js';
import { analyzeResource, buildInstagramDisplayTitleFromData, preserveStrongerExistingData } from './resources.js';
import { getGoogleAccessToken } from './google.js';
import { requestInstagramDownload } from './instagram-downloader.js';
import {
  normalizeYouTubeTranscriptResult,
  YOUTUBE_TRANSCRIPT_JOB_TYPE,
} from './youtube-transcripts.js';

const INSTAGRAM_JOB_TYPE = 'instagram_download';
const GLOBAL_DRIVE_TARGET = 'global_instagram_folder';
const INSTAGRAM_IMPORTS_FOLDER_NAME = 'Instagram Imports';
const DEFAULT_POLL_INTERVAL_SECONDS = 10;

function getAdmin() {
  return getServiceRoleClient();
}

function extractInstagramToken(url = '') {
  const match = String(url || '').match(/instagram\.com\/(?:reel|p|tv)\/([^/?#]+)/i);
  return match?.[1] || '';
}

function buildPendingTitle(url = '') {
  const resourceType = inferResourceType(url);
  const token = extractInstagramToken(url);
  const label = resourceType === 'instagram_reel' ? 'Instagram Reel' : 'Instagram Post';
  return token ? `${label} ${token}` : label;
}

function isInstagramResourceType(resourceType = '') {
  return ['instagram_reel', 'instagram_carousel', 'instagram_post'].includes(String(resourceType || ''));
}

function shouldReplaceWithPendingInstagramTitle(currentTitle = '') {
  const title = String(currentTitle || '').trim();
  return !title || /^Queued from /i.test(title);
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

export function buildInstagramClaimFailurePayload(job = {}, message = '', workerId = '') {
  return {
    message: message || 'Google Drive is not connected for this account.',
    workerId,
    claimToken: job?.claim_token || '',
  };
}

export function isGoogleDriveAuthRequiredError(message = '') {
  const lowered = String(message || '').toLowerCase();
  return lowered.includes('google drive')
    && (
      lowered.includes('not connected')
      || lowered.includes('reconnect')
      || lowered.includes('needs to be reconnected')
    );
}

async function failClaimedInstagramDownloadJob(job, message = '', workerId = '') {
  const normalizedJob = normalizeJob(job);
  if (!normalizedJob?.id) {
    throw new HttpError(404, 'Instagram download job not found.');
  }

  const result = await getAdmin()
    .from('instagram_download_jobs')
    .update({
      status: 'failed',
      retry_count: Number(normalizedJob.retry_count || 0) + 1,
      last_error: message || 'Instagram download failed.',
      completed_at: new Date().toISOString(),
    })
    .eq('id', normalizedJob.id)
    .eq('status', 'processing')
    .eq('worker_id', workerId || normalizedJob.worker_id || '')
    .select('*')
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) {
    throw new HttpError(409, 'This Instagram job is no longer owned by the current worker.');
  }

  const failedJob = normalizeJob(result.data);
  console.warn('[instagram-worker] failed claimed job during preflight', {
    jobId: failedJob.id,
    workerId: workerId || failedJob.worker_id || '',
    error: failedJob.last_error,
  });
  await updateInstagramResourceFailed(
    failedJob.owner_user_id,
    failedJob.resource_id,
    failedJob.last_error,
  ).catch(() => null);
  await registerInstagramWorkerHeartbeat({
    workerId: workerId || failedJob.worker_id || 'worker',
    currentJobId: null,
  }).catch(() => null);
  return failedJob;
}

function assertJobOwnership(job, { workerId = '', claimToken = '', action = 'complete' } = {}) {
  if (!job) {
    throw new HttpError(404, 'Instagram download job not found.');
  }

  const expectedClaimToken = String(job.payload?.claim_token || '');
  const currentWorkerId = String(job.worker_id || '');
  const ownershipMismatch = (
    job.status !== 'processing'
    || (workerId && currentWorkerId && currentWorkerId !== workerId)
    || (expectedClaimToken && claimToken !== expectedClaimToken)
  );

  if (!ownershipMismatch) return;

  console.warn('[instagram-worker] rejected stale worker mutation', {
    action,
    jobId: job.id,
    status: job.status,
    workerId,
    currentWorkerId,
    claimTokenMatches: expectedClaimToken ? claimToken === expectedClaimToken : null,
  });
  throw new HttpError(409, 'This Instagram job is no longer owned by the current worker.');
}

function getProcessingRecoveryThresholdMs() {
  const env = getServerEnv();
  const staleMs = Math.max(Number(env.INSTAGRAM_DOWNLOADER_STATUS_STALE_MS || 90000), 10000);
  return Math.max(staleMs * 3, 5 * 60 * 1000);
}

function buildQueuedSummary() {
  return 'Queued for Instagram download. It will process automatically when your downloader worker is online.';
}

function buildDownloadingMessage() {
  return 'Downloading Instagram media to your local worker.';
}

function buildUploadingMessage() {
  return 'Uploading Instagram media to Google Drive.';
}

function buildUploadedMessage() {
  return 'Instagram media uploaded to Google Drive.';
}

function buildQueuedEnrichmentMessage() {
  return 'Instagram enrichment will start when your downloader worker claims this import.';
}

function buildAnalyzingEnrichmentMessage() {
  return 'Analyzing Instagram content into a full resource summary.';
}

function buildCompletedEnrichmentMessage() {
  return 'Instagram enrichment completed.';
}

function buildWeakEnrichmentMessage() {
  return 'Instagram download finished, but enrichment did not return enough metadata to upgrade this resource. Retry when your downloader worker is online.';
}

function buildFailedEnrichmentMessage(message = '') {
  return message ? `Instagram enrichment failed: ${message}` : 'Instagram enrichment failed.';
}

function buildFailedSummary(message = '') {
  return message ? `Instagram download failed: ${message}` : 'Instagram download failed.';
}

function buildNeedsReviewMessage(message = '') {
  if (isGoogleDriveAuthRequiredError(message)) {
    return 'Reconnect Google Drive; LifeOS will retry this Instagram download automatically.';
  }
  return message
    ? `Instagram media needs review: ${message}`
    : 'Instagram media needs review. LifeOS could not fetch downloadable media for this post automatically.';
}

function computeInstagramReadyState(resource = {}) {
  const downloadDone = ['uploaded', 'blocked', 'failed'].includes(String(resource.download_status || ''));
  const enrichmentDone = ['completed', 'failed'].includes(String(resource.instagram_enrichment_status || ''));
  if (downloadDone && enrichmentDone) return 'complete';
  if (downloadDone || enrichmentDone) return 'partial';
  return 'pending';
}

function withInstagramReadyState(resource = {}) {
  return {
    ...resource,
    instagram_ready_state: computeInstagramReadyState(resource),
  };
}

function mergeInstagramResourceState(current = {}, patch = {}) {
  return withInstagramReadyState({
    ...current,
    ...patch,
  });
}

function getInstagramFailureStatus(message = '') {
  const lowered = String(message || '').toLowerCase();
  if (
    isGoogleDriveAuthRequiredError(message)
    || lowered.includes('google drive is not connected')
    || lowered.includes('google drive needs to be reconnected')
    || lowered.includes('google drive reconnect')
    || lowered.includes('empty media response')
    || lowered.includes('extractor-blocked')
    || lowered.includes('blocked by instagram')
    || lowered.includes('needs review')
  ) {
    return 'blocked';
  }
  return 'failed';
}

function getInstagramMediaTypeLabel(mediaType = '') {
  switch (String(mediaType || '').toLowerCase()) {
    case 'reel':
      return 'Reel';
    case 'carousel':
      return 'Carousel';
    case 'post':
      return 'Post';
    default:
      return 'Post';
  }
}

function normalizeCreatorHandle(value = '') {
  return String(value || '').replace(/^@+/, '').trim();
}

function normalizeUrlString(value = '') {
  const normalized = String(value || '').trim();
  return /^https?:\/\//i.test(normalized) ? normalized : '';
}

function isRenderableImageUrl(value = '') {
  const url = normalizeUrlString(value);
  if (!url) return false;
  if (/\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(url)) return true;
  return /(cdninstagram|fbcdn|instagram|media\.fastdl|scontent)/i.test(url) && !/\.mp4(?:$|\?)/i.test(url);
}

function isDirectRenderableDriveUrl(value = '') {
  const url = normalizeUrlString(value);
  if (!url) return false;
  if (!/drive\.google|googleusercontent/i.test(url)) return false;
  return /\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(url) || /googleusercontent/i.test(url);
}

function isImageMimeType(value = '') {
  return /^image\//i.test(String(value || '').trim());
}

function buildDriveImagePreviewUrl(file = {}) {
  const fileId = String(file?.id || '').trim();
  if (!fileId) return '';

  if (isImageMimeType(file?.mime_type)) {
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }

  const filename = String(file?.name || '').trim();
  if (/\.(?:avif|gif|jpe?g|png|webp)$/i.test(filename)) {
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }

  return '';
}

function scoreInstagramThumbnail(value = '') {
  const url = normalizeUrlString(value);
  if (!url) return 0;
  if (isRenderableImageUrl(url) && !/drive\.google/i.test(url)) return 4;
  if (isDirectRenderableDriveUrl(url)) return 2;
  return 1;
}

function collectInstagramThumbnailCandidates(download = {}, current = {}, normalized = {}, options = {}) {
  const currentItems = Array.isArray(current.instagram_media_items) ? current.instagram_media_items : [];
  const downloadItems = Array.isArray(download.media_items) ? download.media_items : [];
  const driveFiles = Array.isArray(download.drive_files) ? download.drive_files : [];
  const currentDriveFiles = Array.isArray(current.drive_files) ? current.drive_files : [];
  const ordered = Array.isArray(options.preferred) ? options.preferred : [];
  const candidates = [
    ...ordered,
    download.thumbnail_url,
    normalized.thumbnail,
    ...downloadItems.map((item) => item?.thumbnail_url),
    ...downloadItems.filter((item) => item?.type === 'image').map((item) => item?.source_url),
    current.thumbnail,
    ...currentItems.map((item) => item?.thumbnail_url),
    ...currentItems.filter((item) => item?.type === 'image').map((item) => item?.source_url),
    ...driveFiles.map((file) => buildDriveImagePreviewUrl(file)),
    ...currentDriveFiles.map((file) => buildDriveImagePreviewUrl(file)),
  ];

  return [...new Set(candidates.map((value) => normalizeUrlString(value)).filter(Boolean))];
}

function chooseFirstInstagramImageThumbnail(...sources) {
  for (const source of sources) {
    const items = Array.isArray(source) ? source : [];
    for (const item of items) {
      if (item?.type !== 'image') continue;
      const thumbnail = normalizeUrlString(item?.thumbnail_url);
      if (thumbnail) return thumbnail;
      const sourceUrl = normalizeUrlString(item?.source_url);
      if (sourceUrl) return sourceUrl;
    }
  }
  return '';
}

function chooseFirstInstagramDriveImage(...sources) {
  for (const source of sources) {
    const files = Array.isArray(source) ? source : [];
    for (const file of files) {
      const previewUrl = buildDriveImagePreviewUrl(file);
      if (previewUrl) return previewUrl;
    }
  }
  return '';
}

export function chooseInstagramThumbnail(download = {}, current = {}, normalized = {}) {
  const resourceType = String(
    download.media_type
    || normalized.resource_type
    || current.resource_type
    || '',
  );
  const preferred = [];
  if (['instagram_carousel', 'instagram_post'].includes(resourceType)) {
    const firstDriveImage = chooseFirstInstagramDriveImage(download.drive_files, current.drive_files);
    if (firstDriveImage) preferred.push(firstDriveImage);
    const firstImage = chooseFirstInstagramImageThumbnail(download.media_items, current.instagram_media_items);
    if (firstImage) preferred.push(firstImage);
  }

  const candidates = collectInstagramThumbnailCandidates(download, current, normalized, { preferred });
  let best = normalizeUrlString(current.thumbnail);
  let bestScore = scoreInstagramThumbnail(best);

  for (const candidate of candidates) {
    const score = scoreInstagramThumbnail(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function chooseInstagramDisplayTitle({
  sourceUrl = '',
  normalized = {},
  download = {},
  current = {},
}) {
  const fallback = buildPendingTitle(sourceUrl);
  const metadataTitle = buildInstagramDisplayTitleFromData({
    resourceType: normalized.resource_type || current.resource_type || inferResourceType(sourceUrl),
    authorHandle: download.creator_handle || normalized.instagram_author_handle || current.instagram_author_handle || '',
    caption: download.caption || normalized.instagram_caption || current.instagram_caption || '',
    transcript: normalized.instagram_transcript || current.instagram_transcript || '',
    publishedAt: download.published_at || normalized.instagram_posted_at || current.instagram_posted_at || '',
  });

  const analysisTitle = String(normalized.title || '').trim();
  if (
    analysisTitle
    && analysisTitle !== fallback
    && !/^instagram\s+(reel|post|carousel)\b/i.test(analysisTitle)
    && !/^[A-Za-z0-9_-]{8,}$/.test(analysisTitle)
  ) {
    return analysisTitle;
  }

  return metadataTitle || analysisTitle || current.title || fallback;
}

function isRawInstagramTitle(value = '', sourceUrl = '') {
  const title = String(value || '').trim();
  const normalizedSourceUrl = normalizeUrlString(sourceUrl);
  if (!title) return true;
  if (normalizedSourceUrl && title === normalizedSourceUrl) return true;
  if (/^https?:\/\/(?:www\.)?instagram\.com\//i.test(title)) return true;
  if (/^queued from /i.test(title)) return true;
  return false;
}

export function hasMeaningfulInstagramEnrichment(resource = {}, sourceUrl = '') {
  const tags = Array.isArray(resource.tags) ? resource.tags.filter(Boolean) : [];
  const title = String(resource.instagram_display_title || resource.title || '').trim();
  const enrichmentStatus = String(resource.enrichment_status || '').trim().toLowerCase();

  const hasMeaningfulTitle = title && !isRawInstagramTitle(title, sourceUrl) && title !== buildPendingTitle(sourceUrl);
  const hasBodyCopy = Boolean(
    String(resource.summary || '').trim()
    || String(resource.why_it_matters || '').trim()
    || String(resource.who_its_for || '').trim()
    || String(resource.explanation_for_newbies || '').trim()
  );
  const hasArea = Boolean(String(resource.area_id || '').trim() || String(resource.area_name || '').trim());
  const hasMeaningfulTags = tags.some((tag) => String(tag || '').trim().toLowerCase() !== 'instagram');
  const hasStructuredOutcome = ['partial', 'rich'].includes(enrichmentStatus);

  return hasMeaningfulTitle && (hasBodyCopy || hasArea || hasMeaningfulTags || hasStructuredOutcome);
}

function getJobType(job = {}) {
  return job?.payload?.job_type || INSTAGRAM_JOB_TYPE;
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
    drive_target: row.drive_target,
    drive_folder_id: row.drive_folder_id || '',
    project_id: row.project_id || '',
    include_analysis: Boolean(row.include_analysis),
    worker_id: row.worker_id || '',
    requested_at: row.requested_at || row.created_at || null,
    scheduled_for: row.scheduled_for || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    payload: row.payload || {},
    job_type: row.payload?.job_type || INSTAGRAM_JOB_TYPE,
    claim_token: row.payload?.claim_token || '',
    recovery_count: Number(row.payload?.recovery_count || 0),
    recovered_at: row.payload?.recovered_at || null,
    recovery_reason: row.payload?.recovery_reason || '',
    recovered_from_worker_id: row.payload?.recovered_from_worker_id || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function normalizeSettings(row, fallback = {}) {
  const record = row || {};
  return {
    download_base_dir: record.download_base_dir || fallback.download_base_dir || '',
    worker_enabled: record.worker_enabled ?? fallback.worker_enabled ?? true,
    auto_start_worker: record.auto_start_worker ?? fallback.auto_start_worker ?? true,
    poll_interval_seconds: Math.max(Number(record.poll_interval_seconds || fallback.poll_interval_seconds || DEFAULT_POLL_INTERVAL_SECONDS), 2),
    preferred_drive_folder_id: record.preferred_drive_folder_id || fallback.preferred_drive_folder_id || '',
  };
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

async function fetchInstagramResourcesForUser(ownerUserId) {
  const result = await getAdmin()
    .from('legacy_entity_records')
    .select('record_id,data')
    .eq('entity_type', 'Resource')
    .eq('owner_user_id', ownerUserId)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (result.error) throw new HttpError(500, result.error.message);
  return (result.data || [])
    .map((row) => ({ id: row.record_id, ...(row.data || {}) }))
    .filter((resource) => isInstagramResourceType(resource.resource_type));
}

export async function getInstagramDownloaderSettingsForUser(userId) {
  const result = await getAdmin()
    .from('instagram_downloader_settings')
    .select('*')
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeSettings(result.data);
}

export async function updateInstagramDownloaderSettingsForUser(userId, updates = {}) {
  const payload = normalizeSettings({
    ...updates,
    poll_interval_seconds: updates.poll_interval_seconds,
  }, await getInstagramDownloaderSettingsForUser(userId));

  const result = await getAdmin()
    .from('instagram_downloader_settings')
    .upsert({
      owner_user_id: userId,
      ...payload,
      preferred_drive_folder_id: payload.preferred_drive_folder_id || null,
    }, { onConflict: 'owner_user_id' })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeSettings(result.data);
}

function toInstagramMediaItems(download = {}, existingItems = []) {
  const seedItems = Array.isArray(download.media_items) && download.media_items.length
    ? download.media_items
    : existingItems;

  return (download.files || []).map((file, index) => {
    const driveFile = (download.drive_files || []).find((entry) => entry.name === file.filename) || null;
    const baseItem = Array.isArray(seedItems) ? seedItems[index] || {} : {};
    return {
      ...baseItem,
      index,
      label: `#${index + 1}`,
      type: file.type || baseItem.type || 'unknown',
      filename: file.filename,
      filepath: file.filepath,
      source_url: baseItem.source_url || null,
      thumbnail_url: baseItem.thumbnail_url || buildDriveImagePreviewUrl(driveFile) || null,
      width: baseItem.width ?? null,
      height: baseItem.height ?? null,
      duration_seconds: baseItem.duration_seconds ?? null,
      drive_name: driveFile?.name || file.filename,
      drive_file_id: driveFile?.id || null,
      drive_url: driveFile?.url || null,
    };
  });
}

async function analyzeInstagramResource(userId, url, download = {}) {
  try {
    const fallbackTitle = download.normalized_title || buildInstagramDisplayTitleFromData({
      resourceType: inferResourceType(url),
      authorHandle: download.creator_handle || '',
      caption: download.caption || '',
      transcript: download.transcript || '',
      publishedAt: download.published_at || '',
    });
    const content = [download.caption || '', download.transcript || '']
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n\n');
    const analyzed = await analyzeResource({
      url,
      title: fallbackTitle,
      content,
      userId,
    });
    return analyzed?.data || {};
  } catch {
    return {};
  }
}

export async function createPendingInstagramResource(userId, { url, projectId = '' }) {
  const resource = await createCompatEntity(userId, 'Resource', buildPendingInstagramResourcePayload(url));

  if (projectId) {
    await createCompatEntity(userId, 'ProjectResource', {
      project_id: projectId,
      resource_id: resource.id,
      created_date: new Date().toISOString(),
    });
  }

  return resource;
}

function buildPendingInstagramResourcePayload(url, overrides = {}) {
  const resourceType = inferResourceType(url);
  return withInstagramReadyState({
    ...overrides,
    title: buildPendingTitle(url),
    url,
    source_url: url,
    resource_type: resourceType,
    summary: '',
    why_it_matters: '',
    who_its_for: '',
    main_topic: 'Instagram import',
    resource_score: 5,
    tags: ['instagram'],
    key_points: [],
    actionable_points: [],
    use_cases: [],
    download_status: 'queued',
    download_status_message: buildQueuedSummary(),
    instagram_enrichment_status: 'queued',
    instagram_enrichment_error: '',
    instagram_enrichment_message: buildQueuedEnrichmentMessage(),
    downloader_mode: 'queue',
    instagram_media_items: [],
    instagram_review_state: 'none',
    instagram_review_reason: '',
    drive_folder_url: '',
    drive_folder_id: '',
    drive_target: GLOBAL_DRIVE_TARGET,
    is_archived: false,
  });
}

function isMissingCompatResourceError(error) {
  return error instanceof HttpError && error.status === 404 && /Resource record not found/i.test(error.message || '');
}

async function getOrCreateInstagramJobResource(userId, resourceId, sourceUrl = '') {
  try {
    return await getCompatEntity(userId, 'Resource', resourceId);
  } catch (error) {
    if (!isMissingCompatResourceError(error)) throw error;
  }

  const jobSourceUrl = sourceUrl || await getAdmin()
    .from('instagram_download_jobs')
    .select('source_url')
    .eq('owner_user_id', userId)
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then((result) => {
      if (result.error) throw new HttpError(500, result.error.message);
      return result.data?.source_url || '';
    });

  if (!jobSourceUrl) {
    throw new HttpError(404, 'Resource record not found.');
  }

  return createCompatEntity(userId, 'Resource', buildPendingInstagramResourcePayload(jobSourceUrl, {
    id: resourceId,
  }));
}

export async function updateInstagramResourceQueued(userId, resourceId, jobId) {
  const current = await getOrCreateInstagramJobResource(userId, resourceId);
  const sourceUrl = current.source_url || current.url || '';
  const resourceType = inferResourceType(sourceUrl) || current.resource_type || '';
  const nextTitle = shouldReplaceWithPendingInstagramTitle(current.title)
    ? buildPendingTitle(sourceUrl)
    : current.title;
  const nextTags = Array.isArray(current.tags) && current.tags.length
    ? [...new Set([...current.tags, 'instagram'])]
    : ['instagram'];
  return updateCompatEntity(userId, 'Resource', resourceId, mergeInstagramResourceState(current, {
    title: nextTitle,
    source_url: sourceUrl,
    url: sourceUrl,
    resource_type: isInstagramResourceType(resourceType) ? resourceType : current.resource_type,
    main_topic: current.main_topic || 'Instagram import',
    tags: nextTags,
    download_status: 'queued',
    download_status_message: buildQueuedSummary(),
    instagram_enrichment_status: current.instagram_enrichment_status === 'completed' ? 'completed' : 'queued',
    instagram_enrichment_error: current.instagram_enrichment_status === 'completed' ? '' : (current.instagram_enrichment_error || ''),
    instagram_enrichment_message: current.instagram_enrichment_status === 'completed'
      ? buildCompletedEnrichmentMessage()
      : buildQueuedEnrichmentMessage(),
    instagram_review_state: 'none',
    instagram_review_reason: '',
    downloader_job_id: jobId,
    downloader_updated_at: new Date().toISOString(),
  }));
}

async function recoverStaleInstagramProcessingJobs() {
  const recoveryThresholdMs = getProcessingRecoveryThresholdMs();
  const [jobsRes, workersRes] = await Promise.all([
    getAdmin()
      .from('instagram_download_jobs')
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

  for (const row of (jobsRes.data || []).filter((item) => (item.payload?.job_type || INSTAGRAM_JOB_TYPE) !== YOUTUBE_TRANSCRIPT_JOB_TYPE)) {
    const worker = row.worker_id ? workersById.get(row.worker_id) : null;
    const workerHeartbeatStale = !worker || isTimestampOlderThan(worker.last_heartbeat_at, recoveryThresholdMs);
    const jobStartedTooLongAgo = isTimestampOlderThan(row.started_at || row.updated_at || row.created_at, recoveryThresholdMs);

    if (!workerHeartbeatStale || !jobStartedTooLongAgo) continue;

    const recovered = await getAdmin()
      .from('instagram_download_jobs')
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
      console.warn('[instagram-worker] recovered stale processing job', {
        jobId: job.id,
        previousWorkerId: row.worker_id || '',
        recoveredAt: job.recovered_at,
      });
      await updateInstagramResourceQueued(job.owner_user_id, job.resource_id, job.id).catch(() => null);
    }
  }
}

export async function updateInstagramResourceProcessing(userId, resourceId, workerId = '') {
  const current = await getOrCreateInstagramJobResource(userId, resourceId);
  return updateCompatEntity(userId, 'Resource', resourceId, mergeInstagramResourceState(current, {
    download_status: 'downloading',
    download_status_message: buildDownloadingMessage(),
    ingestion_error: '',
    instagram_enrichment_status: current.instagram_enrichment_status === 'completed' ? 'completed' : 'analyzing',
    instagram_enrichment_error: current.instagram_enrichment_status === 'completed' ? '' : '',
    instagram_enrichment_message: current.instagram_enrichment_status === 'completed'
      ? buildCompletedEnrichmentMessage()
      : buildAnalyzingEnrichmentMessage(),
    instagram_review_state: 'none',
    instagram_review_reason: '',
    downloader_worker_id: workerId,
    downloader_updated_at: new Date().toISOString(),
  }));
}

export async function updateInstagramResourceUploading(userId, resourceId) {
  const current = await getOrCreateInstagramJobResource(userId, resourceId);
  return updateCompatEntity(userId, 'Resource', resourceId, mergeInstagramResourceState(current, {
    download_status: 'uploading',
    download_status_message: buildUploadingMessage(),
    downloader_updated_at: new Date().toISOString(),
  }));
}

export async function updateInstagramResourceFailed(userId, resourceId, errorMessage) {
  const current = await getOrCreateInstagramJobResource(userId, resourceId);
  const failureStatus = getInstagramFailureStatus(errorMessage);
  return updateCompatEntity(userId, 'Resource', resourceId, mergeInstagramResourceState(current, {
    download_status: failureStatus,
    download_status_message: failureStatus === 'blocked' ? buildNeedsReviewMessage(errorMessage) : buildFailedSummary(errorMessage),
    ingestion_error: errorMessage || '',
    instagram_review_state: failureStatus === 'blocked' ? 'needs_review' : 'none',
    instagram_review_reason: failureStatus === 'blocked' ? (errorMessage || '') : '',
    downloader_updated_at: new Date().toISOString(),
  }));
}

async function buildInstagramEnrichmentPayload(userId, sourceUrl, current = {}, download = {}) {
  const analysis = await analyzeInstagramResource(userId, sourceUrl, download);
  const normalized = normalizeResourceRecord(sourceUrl, analysis);
  const creatorHandle = normalizeCreatorHandle(download.creator_handle || normalized.instagram_author_handle || current.instagram_author_handle || '');
  const displayTitle = chooseInstagramDisplayTitle({
    sourceUrl,
    normalized,
    download,
    current,
  });
  const merged = preserveStrongerExistingData(current, {
    ...current,
    ...normalized,
    title: displayTitle,
    author: normalized.author || (creatorHandle ? `@${creatorHandle}` : current.author || ''),
    thumbnail: chooseInstagramThumbnail(download, current, normalized),
    instagram_display_title: displayTitle,
    instagram_author_handle: creatorHandle || normalized.instagram_author_handle || current.instagram_author_handle || '',
    instagram_media_type_label: download.media_type_label || normalized.instagram_media_type_label || current.instagram_media_type_label || getInstagramMediaTypeLabel(download.media_type),
    instagram_caption: download.caption || normalized.instagram_caption || current.instagram_caption || '',
    instagram_media_items: Array.isArray(download.media_items) && download.media_items.length
      ? download.media_items
      : (current.instagram_media_items || []),
    instagram_posted_at: download.published_at || normalized.instagram_posted_at || current.instagram_posted_at || '',
  });

  return {
    ...merged,
    title: displayTitle,
    author: merged.author || normalized.author || (creatorHandle ? `@${creatorHandle}` : current.author || ''),
    instagram_display_title: displayTitle,
    instagram_author_handle: creatorHandle || merged.instagram_author_handle || '',
    instagram_media_type_label: download.media_type_label || merged.instagram_media_type_label || getInstagramMediaTypeLabel(download.media_type),
    instagram_caption: download.caption || merged.instagram_caption || '',
    thumbnail: chooseInstagramThumbnail(download, current, merged),
    instagram_posted_at: download.published_at || merged.instagram_posted_at || '',
  };
}

export async function completeInstagramResourceEnrichment(userId, resourceId, sourceUrl, download = {}) {
  const current = await getOrCreateInstagramJobResource(userId, resourceId, sourceUrl);
  const enrichmentPayload = await buildInstagramEnrichmentPayload(userId, sourceUrl, current, download);
  const enrichmentWorked = hasMeaningfulInstagramEnrichment(enrichmentPayload, sourceUrl);
  return updateCompatEntity(userId, 'Resource', resourceId, mergeInstagramResourceState(current, {
    ...enrichmentPayload,
    instagram_enrichment_status: enrichmentWorked ? 'completed' : 'failed',
    instagram_enrichment_error: enrichmentWorked ? '' : 'Instagram enrichment returned only placeholder metadata.',
    instagram_enrichment_message: enrichmentWorked
      ? buildCompletedEnrichmentMessage()
      : buildWeakEnrichmentMessage(),
    downloader_updated_at: new Date().toISOString(),
  }));
}

export async function failInstagramResourceEnrichment(userId, resourceId, errorMessage) {
  const current = await getOrCreateInstagramJobResource(userId, resourceId);
  return updateCompatEntity(userId, 'Resource', resourceId, mergeInstagramResourceState(current, {
    instagram_enrichment_status: 'failed',
    instagram_enrichment_error: errorMessage || 'Instagram enrichment failed.',
    instagram_enrichment_message: buildFailedEnrichmentMessage(errorMessage),
    downloader_updated_at: new Date().toISOString(),
  }));
}

export async function applySuccessfulInstagramDownload(userId, resourceId, sourceUrl, download, { includeAnalysis = true } = {}) {
  const current = await getOrCreateInstagramJobResource(userId, resourceId, sourceUrl);
  const shouldRunAnalysisInline = includeAnalysis && current.instagram_enrichment_status !== 'completed';
  let enrichmentPayload = {};
  let enrichmentStatus = current.instagram_enrichment_status || 'queued';
  let enrichmentError = current.instagram_enrichment_error || '';
  let enrichmentMessage = current.instagram_enrichment_message || '';

  if (shouldRunAnalysisInline) {
    try {
      enrichmentPayload = await buildInstagramEnrichmentPayload(userId, sourceUrl, current, download);
      const enrichmentWorked = hasMeaningfulInstagramEnrichment(enrichmentPayload, sourceUrl);
      enrichmentStatus = enrichmentWorked ? 'completed' : 'failed';
      enrichmentError = enrichmentWorked ? '' : 'Instagram enrichment returned only placeholder metadata.';
      enrichmentMessage = enrichmentWorked
        ? buildCompletedEnrichmentMessage()
        : buildWeakEnrichmentMessage();
    } catch (error) {
      enrichmentStatus = 'failed';
      enrichmentError = error?.message || 'Instagram enrichment failed.';
      enrichmentMessage = buildFailedEnrichmentMessage(enrichmentError);
    }
  }

  const baseResource = {
    ...current,
    ...enrichmentPayload,
  };
  const creatorHandle = normalizeCreatorHandle(download.creator_handle || baseResource.instagram_author_handle || current.instagram_author_handle || '');
  const driveFolder = download.drive_folder || null;
  const driveFiles = Array.isArray(download.drive_files) ? download.drive_files : [];
  const displayTitle = chooseInstagramDisplayTitle({
    sourceUrl,
    normalized: baseResource,
    download,
    current: baseResource,
  });
  const merged = preserveStrongerExistingData(current, {
    ...baseResource,
    title: displayTitle,
    author: baseResource.author || (creatorHandle ? `@${creatorHandle}` : current.author || ''),
    thumbnail: chooseInstagramThumbnail(download, current, baseResource),
    instagram_display_title: displayTitle,
    instagram_author_handle: creatorHandle || baseResource.instagram_author_handle || current.instagram_author_handle || '',
    instagram_media_type_label: download.media_type_label || baseResource.instagram_media_type_label || current.instagram_media_type_label || getInstagramMediaTypeLabel(download.media_type),
    instagram_caption: download.caption || baseResource.instagram_caption || current.instagram_caption || '',
    instagram_posted_at: download.published_at || baseResource.instagram_posted_at || current.instagram_posted_at || '',
  });

  return updateCompatEntity(userId, 'Resource', resourceId, mergeInstagramResourceState(current, {
    ...merged,
    title: displayTitle,
    summary: merged.summary || current.summary || '',
    download_status: driveFiles.length > 0 ? 'uploaded' : 'downloaded',
    download_status_message: buildUploadedMessage(),
    ingestion_error: '',
    downloader_job_id: '',
    downloader_updated_at: new Date().toISOString(),
    downloader_completed_at: new Date().toISOString(),
    instagram_media_items: toInstagramMediaItems(download, baseResource.instagram_media_items || current.instagram_media_items || []),
    instagram_display_title: displayTitle,
    instagram_author_handle: creatorHandle || merged.instagram_author_handle || '',
    instagram_media_type_label: download.media_type_label || merged.instagram_media_type_label || getInstagramMediaTypeLabel(download.media_type),
    instagram_extractor: download.extractor || current.instagram_extractor || '',
    ingestion_source: download.extractor || current.ingestion_source || '',
    instagram_review_state: download.review_state || 'none',
    instagram_review_reason: download.review_reason || '',
    instagram_enrichment_status: enrichmentStatus,
    instagram_enrichment_error: enrichmentError,
    instagram_enrichment_message: enrichmentMessage || (
      enrichmentStatus === 'completed'
        ? buildCompletedEnrichmentMessage()
        : enrichmentStatus === 'failed'
          ? buildFailedEnrichmentMessage(enrichmentError)
          : current.instagram_enrichment_message || buildQueuedEnrichmentMessage()
    ),
    drive_folder_id: driveFolder?.id || '',
    drive_folder_url: driveFolder?.url || '',
    drive_folder_name: driveFolder?.name || INSTAGRAM_IMPORTS_FOLDER_NAME,
    drive_files: driveFiles,
    drive_target: GLOBAL_DRIVE_TARGET,
  }));
}

export async function createInstagramDownloadJob(userId, {
  resourceId,
  url,
  driveFolderId = '',
  projectId = '',
  includeAnalysis = true,
  jobType = INSTAGRAM_JOB_TYPE,
}) {
  const now = new Date().toISOString();
  const result = await getAdmin()
    .from('instagram_download_jobs')
    .insert({
      owner_user_id: userId,
      resource_id: resourceId,
      source_url: url,
      status: 'queued',
      retry_count: 0,
      drive_target: GLOBAL_DRIVE_TARGET,
      drive_folder_id: driveFolderId || null,
      project_id: projectId || null,
      include_analysis: includeAnalysis,
      requested_at: now,
      scheduled_for: now,
      payload: {
        job_type: jobType,
      },
    })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return normalizeJob(result.data);
}

export async function createYouTubeTranscriptJob(userId, {
  resourceId,
  url,
}) {
  const module = await import('./youtube-transcript-queue.js');
  return module.createYouTubeTranscriptJob(userId, {
    resourceId,
    url,
  });
}

export async function maybeQueueYouTubeTranscriptJobForResource(userId, resource = {}) {
  const module = await import('./youtube-transcript-queue.js');
  return module.maybeQueueYouTubeTranscriptJobForResource(userId, resource);
}

export async function requeueFailedInstagramJobs(userId) {
  const now = new Date().toISOString();
  const result = await getAdmin()
    .from('instagram_download_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('status', 'failed');

  if (result.error) throw new HttpError(500, result.error.message);
  const rows = (result.data || [])
    .map(normalizeJob)
    .filter((job) => job.job_type !== YOUTUBE_TRANSCRIPT_JOB_TYPE);

  await Promise.all(rows.map(async (job) => {
    const updateResult = await getAdmin()
      .from('instagram_download_jobs')
      .update({
        status: 'queued',
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

  await Promise.all(rows.map((job) => updateInstagramResourceQueued(userId, job.resource_id, job.id).catch(() => null)));
  return rows;
}

export async function requeueAllFailedInstagramJobs() {
  const now = new Date().toISOString();
  const result = await getAdmin()
    .from('instagram_download_jobs')
    .select('*')
    .eq('status', 'failed');

  if (result.error) throw new HttpError(500, result.error.message);

  const rows = (result.data || [])
    .map(normalizeJob)
    .filter((job) => job.job_type !== YOUTUBE_TRANSCRIPT_JOB_TYPE);

  await Promise.all(rows.map(async (job) => {
    const updateResult = await getAdmin()
      .from('instagram_download_jobs')
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

  await Promise.all(rows.map((job) => updateInstagramResourceQueued(job.owner_user_id, job.resource_id, job.id).catch(() => null)));
  return rows;
}

export async function requeueGoogleDriveBlockedInstagramJobs(userId) {
  const now = new Date().toISOString();
  const result = await getAdmin()
    .from('instagram_download_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('status', 'failed');

  if (result.error) throw new HttpError(500, result.error.message);

  const rows = (result.data || [])
    .map(normalizeJob)
    .filter((job) => job.job_type !== YOUTUBE_TRANSCRIPT_JOB_TYPE)
    .filter((job) => isGoogleDriveAuthRequiredError(job.last_error));

  await Promise.all(rows.map(async (job) => {
    const updateResult = await getAdmin()
      .from('instagram_download_jobs')
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

  await Promise.all(rows.map((job) => updateInstagramResourceQueued(userId, job.resource_id, job.id).catch(() => null)));
  return rows;
}

export async function requeueAllGoogleDriveBlockedInstagramJobs() {
  const now = new Date().toISOString();
  const result = await getAdmin()
    .from('instagram_download_jobs')
    .select('*')
    .eq('status', 'failed');

  if (result.error) throw new HttpError(500, result.error.message);

  const rows = (result.data || [])
    .map(normalizeJob)
    .filter((job) => job.job_type !== YOUTUBE_TRANSCRIPT_JOB_TYPE)
    .filter((job) => isGoogleDriveAuthRequiredError(job.last_error));

  await Promise.all(rows.map((job) => getAdmin()
    .from('instagram_download_jobs')
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

  await Promise.all(rows.map((job) => updateInstagramResourceQueued(job.owner_user_id, job.resource_id, job.id).catch(() => null)));
  return rows;
}

export async function retryInstagramDownloadForResource(userId, resourceId) {
  const resource = await getCompatEntity(userId, 'Resource', resourceId);
  const resourceType = resource?.resource_type || '';
  if (!['instagram_reel', 'instagram_carousel', 'instagram_post'].includes(resourceType)) {
    throw new HttpError(400, 'This resource is not an Instagram download.');
  }

  const existing = await getAdmin()
    .from('instagram_download_jobs')
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
      const updated = await updateInstagramResourceQueued(userId, resourceId, job.id);
      return { resource: updated, job, queued: true };
    }

    const retried = await getAdmin()
      .from('instagram_download_jobs')
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
    const updated = await updateInstagramResourceQueued(userId, resourceId, normalizedJob.id);
    return { resource: updated, job: normalizedJob, queued: true };
  }

  const newJob = await createInstagramDownloadJob(userId, {
    resourceId,
    url: resource.source_url || resource.url,
    driveFolderId: resource.drive_folder_id || '',
    projectId: '',
    includeAnalysis: true,
  });
  const updated = await updateInstagramResourceQueued(userId, resourceId, newJob.id);
  return { resource: updated, job: newJob, queued: true };
}

export async function removeInstagramDownloadJob(userId, jobId) {
  const result = await getAdmin()
    .from('instagram_download_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, 'Instagram download job not found.');

  const job = normalizeJob(result.data);
  if (job.job_type === YOUTUBE_TRANSCRIPT_JOB_TYPE) {
    throw new HttpError(400, 'This is not an Instagram download job.');
  }

  const deleteResult = await getAdmin()
    .from('instagram_download_jobs')
    .delete()
    .eq('id', jobId)
    .eq('owner_user_id', userId);

  if (deleteResult.error) throw new HttpError(500, deleteResult.error.message);

  const removedAt = new Date().toISOString();
  const resource = await getCompatEntity(userId, 'Resource', job.resource_id)
    .then((current) => updateCompatEntity(userId, 'Resource', job.resource_id, mergeInstagramResourceState(current, {
      download_status: 'blocked',
      download_status_message: 'Removed from the Instagram downloader queue.',
      ingestion_error: 'Removed from pending queue manually.',
      instagram_review_state: 'needs_review',
      instagram_review_reason: 'Removed from pending queue manually.',
      downloader_job_id: '',
      downloader_updated_at: removedAt,
      downloader_completed_at: removedAt,
    })))
    .catch((error) => {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    });

  return { job, resource };
}

export async function reconcileInstagramResourceStatesForUser(userId) {
  const instagramResources = await fetchInstagramResourcesForUser(userId);
  if (!instagramResources.length) {
    return {
      repaired: false,
      jobs: [],
      instagramResources,
    };
  }

  const jobsRes = await getAdmin()
    .from('instagram_download_jobs')
    .select('*')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(25);

  if (jobsRes.error) throw new HttpError(500, jobsRes.error.message);

  let jobs = (jobsRes.data || [])
    .map(normalizeJob)
    .filter((job) => job.job_type !== YOUTUBE_TRANSCRIPT_JOB_TYPE);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const activeJobByResourceId = new Map(
    jobs
      .filter((job) => ['queued', 'processing', 'failed'].includes(job.status))
      .map((job) => [job.resource_id, job])
  );

  let repaired = false;
  for (const resource of instagramResources) {
    const downloadStatus = String(resource.download_status || '');
    const downloadStatusMessage = String(resource.download_status_message || '');
    const driveFiles = Array.isArray(resource.drive_files) ? resource.drive_files : [];
    const resourceType = String(resource.resource_type || '');
    const needsQueueRepair = ['queued', 'downloading', 'uploading'].includes(downloadStatus);
    const enrichmentStatus = String(resource.instagram_enrichment_status || '');
    const hasWeakCompletedEnrichment = enrichmentStatus === 'completed'
      && !hasMeaningfulInstagramEnrichment(resource, resource.source_url || resource.url || '');
    const needsEnrichmentRepair = ['queued', 'analyzing'].includes(enrichmentStatus) || hasWeakCompletedEnrichment;
    const thumbnailValue = normalizeUrlString(resource.thumbnail);
    const needsThumbnailRepair = (
      ['', 'uploaded', 'downloaded', 'complete', 'completed'].includes(downloadStatus)
      && (!thumbnailValue || /drive\.google|googleusercontent/i.test(thumbnailValue))
    );
    const previewRetryNeeded = (
      downloadStatus === 'failed'
      && /too many values to unpack \(expected 2\)/i.test(downloadStatusMessage)
    );
    if (!needsQueueRepair && !needsEnrichmentRepair && !needsThumbnailRepair && !previewRetryNeeded) continue;

    if (hasWeakCompletedEnrichment) {
      await updateCompatEntity(userId, 'Resource', resource.id, mergeInstagramResourceState(resource, {
        instagram_enrichment_status: 'failed',
        instagram_enrichment_error: 'Instagram enrichment returned only placeholder metadata.',
        instagram_enrichment_message: buildWeakEnrichmentMessage(),
        downloader_updated_at: new Date().toISOString(),
      })).catch(() => null);
      repaired = true;
      if (!needsQueueRepair && !needsThumbnailRepair) continue;
    }

    if (previewRetryNeeded) {
      await retryInstagramDownloadForResource(userId, resource.id).catch(() => null);
      repaired = true;
      continue;
    }

    if (needsThumbnailRepair) {
      const thumbnail = chooseInstagramThumbnail({
        thumbnail_url: '',
        media_items: resource.instagram_media_items || [],
        drive_files: driveFiles,
      }, resource, resource);
      if (thumbnail) {
        await updateCompatEntity(userId, 'Resource', resource.id, mergeInstagramResourceState(resource, {
          thumbnail,
          downloader_updated_at: new Date().toISOString(),
        })).catch(() => null);
        repaired = true;
      }
      if (
        !thumbnail
        && resourceType === 'instagram_reel'
        && driveFiles.length > 0
      ) {
        await retryInstagramDownloadForResource(userId, resource.id).catch(() => null);
        repaired = true;
        continue;
      }
      if (!needsQueueRepair && !needsEnrichmentRepair) continue;
    }

    const matchingJob = jobsById.get(resource.downloader_job_id) || activeJobByResourceId.get(resource.id) || null;
    if (!matchingJob) {
      await retryInstagramDownloadForResource(userId, resource.id).catch(() => null);
      repaired = true;
      continue;
    }

    if (matchingJob.status === 'queued' && resource.downloader_job_id !== matchingJob.id) {
      await updateInstagramResourceQueued(userId, resource.id, matchingJob.id).catch(() => null);
      repaired = true;
      continue;
    }

    if (matchingJob.status === 'processing' && resource.download_status !== 'downloading') {
      await updateInstagramResourceProcessing(userId, resource.id, matchingJob.worker_id || '').catch(() => null);
      repaired = true;
      continue;
    }

    if (matchingJob.status === 'failed' && !['failed', 'blocked'].includes(downloadStatus)) {
      await updateInstagramResourceFailed(userId, resource.id, matchingJob.last_error).catch(() => null);
      repaired = true;
    }
  }

  if (repaired) {
    jobs = await getAdmin()
      .from('instagram_download_jobs')
      .select('*')
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(25)
      .then((result) => {
        if (result.error) throw new HttpError(500, result.error.message);
        return (result.data || [])
          .map(normalizeJob)
          .filter((job) => job.job_type !== YOUTUBE_TRANSCRIPT_JOB_TYPE);
      });
  }

  return {
    repaired,
    jobs,
    instagramResources,
  };
}

export async function getInstagramDownloaderStatusForUser(userId) {
  const env = getServerEnv();
  const staleMs = Math.max(Number(env.INSTAGRAM_DOWNLOADER_STATUS_STALE_MS || 90000), 10000);
  const settings = await getInstagramDownloaderSettingsForUser(userId);
  const workerRes = await getAdmin()
    .from('instagram_downloader_workers')
    .select('*')
    .order('last_heartbeat_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (workerRes.error) throw new HttpError(500, workerRes.error.message);

  const { jobs } = await reconcileInstagramResourceStatesForUser(userId);

  const resourcesById = await fetchResourceRecords(userId, jobs.map((job) => job.resource_id));
  const worker = workerRes.data
    ? {
        worker_id: workerRes.data.worker_id,
        label: workerRes.data.label || workerRes.data.worker_id,
        status: workerRes.data.status || 'unknown',
        last_heartbeat_at: workerRes.data.last_heartbeat_at,
        current_job_id: workerRes.data.current_job_id || '',
        version: workerRes.data.version || '',
        metadata: workerRes.data.metadata || {},
        state: getWorkerState(workerRes.data.last_heartbeat_at, staleMs),
        online: getWorkerState(workerRes.data.last_heartbeat_at, staleMs) === 'online',
      }
    : {
        worker_id: '',
        label: 'Instagram Downloader',
        status: 'offline',
        last_heartbeat_at: null,
        current_job_id: '',
        version: '',
        metadata: {},
        state: 'offline',
        online: false,
      };

  const counts = jobs.reduce((acc, job) => {
    acc.total += 1;
    if (job.status === 'queued') acc.queued += 1;
    if (job.status === 'processing') acc.processing += 1;
    if (job.status === 'failed') acc.failed += 1;
    if (job.recovery_reason === 'stale_worker_heartbeat') acc.recovered += 1;
    return acc;
  }, { total: 0, queued: 0, processing: 0, failed: 0, recovered: 0 });

  return {
    worker,
    settings,
    queue: {
      ...counts,
      items: jobs.map((job) => ({
        ...job,
        resource_title: resourcesById.get(job.resource_id)?.title || buildPendingTitle(job.source_url),
      })),
    },
  };
}

export async function registerInstagramWorkerHeartbeat({ workerId, label = '', version = '', metadata = {}, currentJobId = null }) {
  const result = await getAdmin()
    .from('instagram_downloader_workers')
    .upsert({
      worker_id: workerId,
      label: label || workerId,
      status: 'online',
      last_heartbeat_at: new Date().toISOString(),
      current_job_id: currentJobId || null,
      version: version || null,
      metadata,
    }, { onConflict: 'worker_id' })
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);
  return result.data;
}

export async function claimNextInstagramDownloadJob(workerId) {
  await recoverStaleInstagramProcessingJobs();

  const queued = await getAdmin()
    .from('instagram_download_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('scheduled_for', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(10);

  if (queued.error) throw new HttpError(500, queued.error.message);

  for (const row of (queued.data || []).filter((item) => (item.payload?.job_type || INSTAGRAM_JOB_TYPE) !== YOUTUBE_TRANSCRIPT_JOB_TYPE)) {
    const claimed = await getAdmin()
      .from('instagram_download_jobs')
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
    console.info('[instagram-worker] claimed job', {
      jobId: job.id,
      workerId,
      jobType: job.job_type,
      resourceId: job.resource_id,
    });

    await registerInstagramWorkerHeartbeat({
      workerId,
      currentJobId: job.id,
    }).catch(() => null);

    await updateInstagramResourceProcessing(job.owner_user_id, job.resource_id, workerId).catch(() => null);

    let driveAccessToken = '';
    try {
      driveAccessToken = await getGoogleAccessToken(job.owner_user_id, 'drive');
    } catch (error) {
      await failClaimedInstagramDownloadJob(
        job,
        error?.message || 'Google Drive is not connected for this account.',
        workerId,
      );
      continue;
    }

    return {
      job,
      settings: await getInstagramDownloaderSettingsForUser(job.owner_user_id),
      google_drive: {
        access_token: driveAccessToken,
        parent_folder_id: job.drive_folder_id || '',
      },
    };
  }

  return null;
}

async function applySuccessfulYouTubeTranscript(userId, resourceId, sourceUrl, transcriptResult = {}) {
  const current = await getCompatEntity(userId, 'Resource', resourceId);
  const normalizedTranscript = normalizeYouTubeTranscriptResult(transcriptResult);

  let analyzedData = {};
  try {
    const analyzed = await analyzeResource({
      url: sourceUrl,
      title: current.title || '',
      content: normalizedTranscript.transcript || '',
      userId,
    });
    analyzedData = analyzed?.data || {};
  } catch {
    analyzedData = {};
  }

  const merged = preserveStrongerExistingData(current, {
    ...current,
    ...analyzedData,
    content: normalizedTranscript.transcript || analyzedData.content || current.content || '',
    content_source: normalizedTranscript.transcript ? 'youtube_transcript' : (analyzedData.content_source || current.content_source || ''),
    content_language: normalizedTranscript.language || analyzedData.content_language || current.content_language || '',
    youtube_transcript: normalizedTranscript.transcript || current.youtube_transcript || '',
    youtube_transcript_status: normalizedTranscript.status || 'ok',
    youtube_transcript_error: normalizedTranscript.error || '',
    youtube_transcript_source: normalizedTranscript.transcriptSource || 'worker_youtube_transcript_api',
    youtube_caption_language: normalizedTranscript.language || current.youtube_caption_language || '',
  });

  return updateCompatEntity(userId, 'Resource', resourceId, {
    ...current,
    ...merged,
    id: resourceId,
    created_date: current.created_date,
    downloader_job_id: '',
    downloader_updated_at: new Date().toISOString(),
    youtube_transcript_status: normalizedTranscript.status || 'ok',
    youtube_transcript_error: normalizedTranscript.error || '',
    youtube_transcript_source: normalizedTranscript.transcriptSource || 'worker_youtube_transcript_api',
    youtube_caption_language: normalizedTranscript.language || current.youtube_caption_language || '',
  });
}

export async function completeInstagramDownloadJob(jobId, download) {
  const result = await getAdmin()
    .from('instagram_download_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (result.error) throw new HttpError(500, result.error.message);
  if (!result.data) throw new HttpError(404, 'Instagram download job not found.');

  const job = normalizeJob(result.data);
  assertJobOwnership(job, {
    workerId: download?.worker_id || '',
    claimToken: download?.claim_token || '',
    action: 'complete',
  });
  const resource = job.job_type === YOUTUBE_TRANSCRIPT_JOB_TYPE
    ? await applySuccessfulYouTubeTranscript(job.owner_user_id, job.resource_id, job.source_url, download)
    : await applySuccessfulInstagramDownload(job.owner_user_id, job.resource_id, job.source_url, download, {
        includeAnalysis: job.include_analysis,
      });

  const deleteResult = await getAdmin()
    .from('instagram_download_jobs')
    .delete()
    .eq('id', jobId);

  if (deleteResult.error) throw new HttpError(500, deleteResult.error.message);
  console.info('[instagram-worker] completed job', {
    jobId: job.id,
    workerId: job.worker_id || download?.worker_id || '',
    jobType: job.job_type,
  });

  await registerInstagramWorkerHeartbeat({
    workerId: job.worker_id || 'worker',
    currentJobId: null,
  }).catch(() => null);

  return { job, resource };
}

export async function failInstagramDownloadJob(jobId, errorMessage) {
  const workerId = typeof errorMessage === 'object' ? (errorMessage?.workerId || '') : '';
  const claimToken = typeof errorMessage === 'object' ? (errorMessage?.claimToken || '') : '';
  const resolvedErrorMessage = typeof errorMessage === 'object' ? errorMessage?.message : errorMessage;
  const current = await getAdmin()
    .from('instagram_download_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (current.error) throw new HttpError(500, current.error.message);
  if (!current.data) throw new HttpError(404, 'Instagram download job not found.');

  const row = current.data;
  assertJobOwnership(normalizeJob(row), {
    workerId,
    claimToken,
    action: 'fail',
  });
  const retryCount = Number(row.retry_count || 0) + 1;
  const result = await getAdmin()
    .from('instagram_download_jobs')
    .update({
      status: 'failed',
      retry_count: retryCount,
      last_error: resolvedErrorMessage || 'Instagram download failed.',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', 'processing')
    .select('*')
    .single();

  if (result.error) throw new HttpError(500, result.error.message);

  const job = normalizeJob(result.data);
  console.warn('[instagram-worker] failed job', {
    jobId: job.id,
    workerId: workerId || job.worker_id || '',
    error: job.last_error,
  });
  await updateInstagramResourceFailed(job.owner_user_id, job.resource_id, job.last_error).catch(() => null);
  return job;
}

function isWorkerUnavailable(error) {
  return error instanceof HttpError
    && error.status === 502
    && /unavailable/i.test(error.message || '');
}

export async function submitInstagramDownload(userId, {
  url,
  projectId = '',
  driveFolderId = '',
  includeAnalysis = true,
}) {
  const settings = await getInstagramDownloaderSettingsForUser(userId);
  const targetDriveFolderId = driveFolderId || settings.preferred_drive_folder_id || '';
  const resource = await createPendingInstagramResource(userId, { url, projectId });
  let directDownload = null;

  if (settings.worker_enabled && getServerEnv().INSTAGRAM_DOWNLOADER_BASE_URL) {
    try {
      directDownload = await requestInstagramDownload({
        userId,
        url,
        uploadToDrive: true,
        driveFolderId: targetDriveFolderId,
        downloadBaseDir: settings.download_base_dir,
        includeAnalysis: false,
      });
    } catch (error) {
      if (!isWorkerUnavailable(error)) {
        await updateInstagramResourceFailed(userId, resource.id, error?.message || 'Instagram downloader failed.').catch(() => null);
        throw error;
      }
    }
  }

  if (directDownload) {
    const updated = await applySuccessfulInstagramDownload(userId, resource.id, url, directDownload, { includeAnalysis });
    return {
      success: true,
      queued: false,
      resource: updated,
      job: null,
      download: directDownload,
    };
  }

  const job = await createInstagramDownloadJob(userId, {
    resourceId: resource.id,
    url,
    driveFolderId: targetDriveFolderId,
    projectId,
    includeAnalysis,
  });
  const updated = await updateInstagramResourceQueued(userId, resource.id, job.id);

  return {
    success: true,
    queued: true,
    resource: updated,
    job,
    download: null,
  };
}
