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
    drive_folder: payload.drive_folder || null,
    drive_files: Array.isArray(payload.drive_files) ? payload.drive_files : [],
    error: payload.error || null,
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
