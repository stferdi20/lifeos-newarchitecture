export const YOUTUBE_TRANSCRIPT_JOB_TYPE = 'youtube_transcript';
export const YOUTUBE_TRANSCRIPT_PRIMARY_SOURCE = 'worker_youtube_transcript_api';

export function normalizeYouTubeTranscriptResult(result = {}) {
  return {
    transcript: String(result.transcript || ''),
    language: String(result.language || ''),
    status: String(result.status || (result.success ? 'ok' : 'error')),
    error: String(result.error || ''),
    transcriptSource: String(result.transcript_source || result.transcriptSource || YOUTUBE_TRANSCRIPT_PRIMARY_SOURCE),
    selectedMode: String(result.selected_mode || result.selectedMode || ''),
  };
}

export function shouldQueueYouTubeTranscriptBackfill(resource = {}) {
  return resource?.resource_type === 'youtube'
    && String(resource.content_source || '') !== 'youtube_transcript'
    && Boolean(String(resource.source_url || resource.url || '').trim());
}
