import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

export function getYouTubeTranscriptStatus() {
  return apiGet('/youtube-transcript/status');
}

export function retryFailedYouTubeTranscripts() {
  return apiPost('/youtube-transcript/retry-failed', {});
}

export function retryYouTubeTranscriptForResource(resourceId) {
  return apiPost(`/youtube-transcript/resources/${resourceId}/retry`, {});
}

export function removeYouTubeTranscriptJob(jobId) {
  return apiDelete(`/youtube-transcript/jobs/${jobId}`);
}

export function getYouTubeTranscriptSettings() {
  return apiGet('/youtube-transcript/settings');
}

export function updateYouTubeTranscriptSettings(payload) {
  return apiPatch('/youtube-transcript/settings', payload);
}
