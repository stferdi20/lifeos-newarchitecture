import { apiGet, apiPatch, apiPost } from '@/lib/api-client';

export function getInstagramDownloaderStatus() {
  return apiGet('/instagram-downloader/status');
}

export function retryFailedInstagramDownloads() {
  return apiPost('/instagram-downloader/retry-failed', {});
}

export function retryInstagramDownloadForResource(resourceId) {
  return apiPost(`/instagram-downloader/resources/${resourceId}/retry`, {});
}

export function getInstagramDownloaderSettings() {
  return apiGet('/instagram-downloader/settings');
}

export function updateInstagramDownloaderSettings(payload) {
  return apiPatch('/instagram-downloader/settings', payload);
}
