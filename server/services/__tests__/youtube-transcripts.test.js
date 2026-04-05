import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeYouTubeTranscriptResult,
  shouldQueueYouTubeTranscriptBackfill,
} from '../youtube-transcripts.js';

test('normalizeYouTubeTranscriptResult preserves transcript status details', () => {
  const result = normalizeYouTubeTranscriptResult({
    success: false,
    transcript: '',
    language: 'en',
    status: 'worker_unavailable',
    error: 'service unavailable',
    transcript_source: 'worker_yt_dlp',
    selected_mode: 'manual',
  });

  assert.deepEqual(result, {
    transcript: '',
    language: 'en',
    status: 'worker_unavailable',
    error: 'service unavailable',
    transcriptSource: 'worker_yt_dlp',
    selectedMode: 'manual',
  });
});

test('shouldQueueYouTubeTranscriptBackfill queues youtube resources that still need transcript recovery', () => {
  assert.equal(shouldQueueYouTubeTranscriptBackfill({
    resource_type: 'youtube',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    content_source: 'metadata_only',
  }), true);

  assert.equal(shouldQueueYouTubeTranscriptBackfill({
    resource_type: 'youtube',
    source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    content_source: 'youtube_transcript',
  }), false);

  assert.equal(shouldQueueYouTubeTranscriptBackfill({
    resource_type: 'article',
    url: 'https://example.com',
    content_source: 'html_text',
  }), false);
});
