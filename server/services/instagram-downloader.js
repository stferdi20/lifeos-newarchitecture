import { getServerEnv } from '../config/env.js';
import { HttpError } from '../lib/http.js';
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
    transcript_source: payload.transcript_source || 'worker_yt_dlp',
    selected_mode: payload.selected_mode || '',
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
  if (!env.INSTAGRAM_DOWNLOADER_BASE_URL) {
    throw new HttpError(500, 'Instagram downloader service is not configured.');
  }

  const response = await fetchImpl(`${env.INSTAGRAM_DOWNLOADER_BASE_URL.replace(/\/+$/, '')}/youtube-transcript`, {
    method: 'POST',
    headers: buildDownloaderHeaders(),
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(Math.max(env.INSTAGRAM_DOWNLOADER_TIMEOUT_MS || 120000, 1000)),
  }).catch((error) => {
    throw new HttpError(502, `Instagram downloader service is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok && !payload) {
    throw new HttpError(response.status, 'YouTube transcript worker failed.');
  }

  return toPublicYouTubeTranscriptResult(payload || {});
}
