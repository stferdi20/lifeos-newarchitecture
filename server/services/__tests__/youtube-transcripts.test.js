import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeYouTubeTranscriptResult,
  shouldQueueYouTubeTranscriptBackfill,
} from '../youtube-transcripts.js';
import { parsePreferredSubtitleLanguages } from '../youtube-transcript-queue.js';

test('normalizeYouTubeTranscriptResult preserves transcript status details', () => {
  const result = normalizeYouTubeTranscriptResult({
    success: false,
    transcript: '',
    language: 'en',
    status: 'worker_unavailable',
    error: 'service unavailable',
    transcript_source: 'worker_youtube_transcript_api',
    selected_mode: 'manual',
  });

  assert.deepEqual(result, {
    transcript: '',
    language: 'en',
    status: 'worker_unavailable',
    error: 'service unavailable',
    transcriptSource: 'worker_youtube_transcript_api',
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

test('parsePreferredSubtitleLanguages keeps the preference list stable', () => {
  assert.deepEqual(parsePreferredSubtitleLanguages('en, en-US,  es '), ['en', 'en-US', 'es']);
});

test('youtube transcript routes remain protected by auth', async () => {
  const { default: app } = await import('../../app.js');
  const res = await app.request('http://localhost/api/youtube-transcript/status');
  assert.equal(res.status, 401);
});
