import { randomUUID } from 'node:crypto';
import { getServerEnv } from '../config/env.js';
import { HttpError } from '../lib/http.js';
import { getServiceRoleClient } from '../lib/supabase.js';
import { getGoogleAccessToken } from './google.js';

function buildDownloaderHeaders() {
  const env = getServerEnv();
  const headers = {
    'Content-Type': 'application/json',
  };

  if (env.INSTAGRAM_DOWNLOADER_SHARED_SECRET) {
    headers['x-downloader-secret'] = env.INSTAGRAM_DOWNLOADER_SHARED_SECRET;
  }

  return headers;
}

function buildYouTubeTranscriptHeaders() {
  const env = getServerEnv();
  const headers = {
    'Content-Type': 'application/json',
  };

  if (env.YOUTUBE_TRANSCRIPT_WORKER_SHARED_SECRET) {
    headers['x-downloader-secret'] = env.YOUTUBE_TRANSCRIPT_WORKER_SHARED_SECRET;
  }

  return headers;
}

function toPublicDownloadResult(payload = {}) {
  return {
    success: Boolean(payload.success),
    input_url: payload.input_url || '',
    media_type: payload.media_type || 'unknown',
    download_dir: payload.download_dir || '',
    files: Array.isArray(payload.files) ? payload.files : [],
    media_items: Array.isArray(payload.media_items) ? payload.media_items : [],
    drive_folder: payload.drive_folder || null,
    drive_files: Array.isArray(payload.drive_files) ? payload.drive_files : [],
    extractor: payload.extractor || '',
    review_state: payload.review_state || '',
    review_reason: payload.review_reason || '',
    media_type_label: payload.media_type_label || '',
    normalized_title: payload.normalized_title || '',
    creator_handle: payload.creator_handle || '',
    caption: payload.caption || '',
    published_at: payload.published_at || '',
    thumbnail_url: payload.thumbnail_url || '',
    error: payload.error || null,
  };
}

function toPublicYouTubeTranscriptResult(payload = {}) {
  return {
    success: Boolean(payload.success),
    input_url: payload.input_url || '',
    transcript: payload.transcript || '',
    language: payload.language || '',
    status: payload.status || '',
    error: payload.error || null,
    transcript_source: payload.transcript_source || 'worker_youtube_transcript_api',
    selected_mode: payload.selected_mode || '',
  };
}

function normalizeStorageSegment(value = '', fallback = 'thumbnail') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

export function buildInstagramThumbnailStoragePath({
  ownerUserId,
  resourceId,
  filename = 'thumbnail.webp',
} = {}) {
  const ownerSegment = normalizeStorageSegment(ownerUserId, 'user');
  const resourceSegment = normalizeStorageSegment(resourceId, 'resource');
  const fileName = normalizeStorageSegment(filename, 'thumbnail.webp');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileStem = fileName.replace(/\.[^.]+$/, '') || 'thumbnail';
  return `${ownerSegment}/${resourceSegment}/${timestamp}-${randomUUID().slice(0, 8)}-${fileStem}.webp`;
}

export async function uploadInstagramThumbnailToStorage({
  ownerUserId,
  resourceId,
  filename,
  contentType = 'image/webp',
  dataBase64,
  storageClient,
  bucketName,
} = {}) {
  if (!ownerUserId || !resourceId) {
    throw new HttpError(400, 'Thumbnail upload requires owner and resource identifiers.');
  }

  const thumbnailData = Buffer.from(String(dataBase64 || ''), 'base64');
  if (!thumbnailData.length) {
    throw new HttpError(400, 'Thumbnail upload body was empty.');
  }

  const env = getServerEnv();
  const bucket = bucketName || env.SUPABASE_STORAGE_BUCKET_RESOURCE_THUMBNAILS || 'resource-thumbnails';
  const admin = storageClient ? { storage: storageClient } : getServiceRoleClient();
  const path = buildInstagramThumbnailStoragePath({
    ownerUserId,
    resourceId,
    filename,
  });

  const upload = await admin.storage
    .from(bucket)
    .upload(path, thumbnailData, {
      contentType,
      upsert: true,
      cacheControl: '31536000',
    });

  if (upload.error) {
    throw new HttpError(500, upload.error.message);
  }

  const publicUrl = admin.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || '';
  return {
    bucket,
    path,
    url: publicUrl || '',
    thumbnail_url: publicUrl || '',
  };
}

export async function requestInstagramDownload({
  userId,
  url,
  uploadToDrive = true,
  driveFolderId = '',
  downloadBaseDir = '',
  includeAnalysis = true,
  fetchImpl = fetch,
}) {
  const env = getServerEnv();
  if (!env.INSTAGRAM_DOWNLOADER_BASE_URL) {
    throw new HttpError(500, 'Instagram downloader service is not configured.');
  }

  const googleDrive = uploadToDrive
    ? {
        access_token: await getGoogleAccessToken(userId, 'drive'),
        ...(driveFolderId ? { parent_folder_id: driveFolderId } : {}),
      }
    : null;

  const response = await fetchImpl(`${env.INSTAGRAM_DOWNLOADER_BASE_URL.replace(/\/+$/, '')}/download`, {
    method: 'POST',
    headers: buildDownloaderHeaders(),
    body: JSON.stringify({
      url,
      google_drive: googleDrive,
      download_base_dir: downloadBaseDir || undefined,
      include_analysis: includeAnalysis,
    }),
    signal: AbortSignal.timeout(Math.max(env.INSTAGRAM_DOWNLOADER_TIMEOUT_MS || 120000, 1000)),
  }).catch((error) => {
    throw new HttpError(502, `Instagram downloader service is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new HttpError(response.status, payload?.error || 'Instagram downloader failed.', {
      downloader: payload || null,
    });
  }

  return toPublicDownloadResult(payload);
}

export async function requestYouTubeTranscript({
  url,
  fetchImpl = fetch,
}) {
  const env = getServerEnv();
  if (!env.YOUTUBE_TRANSCRIPT_WORKER_BASE_URL) {
    return {
      success: false,
      input_url: url,
      transcript: '',
      language: '',
      status: 'worker_unavailable',
      error: '',
      transcript_source: 'worker_youtube_transcript_api',
      selected_mode: '',
    };
  }

  const response = await fetchImpl(`${env.YOUTUBE_TRANSCRIPT_WORKER_BASE_URL.replace(/\/+$/, '')}/youtube-transcript`, {
    method: 'POST',
    headers: buildYouTubeTranscriptHeaders(),
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(Math.max(env.YOUTUBE_TRANSCRIPT_WORKER_TIMEOUT_MS || 120000, 1000)),
  }).catch((error) => {
    throw new HttpError(502, `YouTube transcript worker is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok && !payload) {
    throw new HttpError(response.status, 'YouTube transcript worker failed.');
  }

  return toPublicYouTubeTranscriptResult(payload || {});
}
