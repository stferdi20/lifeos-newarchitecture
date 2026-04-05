export const YOUTUBE_TRANSCRIPT_JOB_TYPE = 'youtube_transcript';

export function normalizeYouTubeTranscriptResult(result = {}) {
  return {
    transcript: String(result.transcript || ''),
    language: String(result.language || ''),
    status: String(result.status || (result.success ? 'ok' : 'error')),
    error: String(result.error || ''),
    transcriptSource: String(result.transcript_source || result.transcriptSource || 'worker_yt_dlp'),
    selectedMode: String(result.selected_mode || result.selectedMode || ''),
  };
}

export function shouldQueueYouTubeTranscriptBackfill(resource = {}) {
  return resource?.resource_type === 'youtube'
    && String(resource.content_source || '') !== 'youtube_transcript'
    && Boolean(String(resource.source_url || resource.url || '').trim());
}
