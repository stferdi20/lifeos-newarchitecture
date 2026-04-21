import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInstagramMediaOnlySummary,
  hasMeaningfulInstagramEnrichment,
} from '../instagram-download-queue.js';

test('hasMeaningfulInstagramEnrichment rejects placeholder-only instagram resources', () => {
  const result = hasMeaningfulInstagramEnrichment({
    title: 'https://www.instagram.com/reel/abc123/',
    instagram_display_title: '',
    summary: '',
    why_it_matters: '',
    who_its_for: '',
    explanation_for_newbies: '',
    area_id: '',
    area_name: '',
    tags: ['instagram'],
    enrichment_status: '',
  }, 'https://www.instagram.com/reel/abc123/');

  assert.equal(result, false);
});

test('hasMeaningfulInstagramEnrichment accepts instagram resources with real enrichment fields', () => {
  const result = hasMeaningfulInstagramEnrichment({
    title: 'How this creator frames tiny apartment workflows',
    instagram_display_title: 'How this creator frames tiny apartment workflows',
    summary: 'A compact reel on organizing a small-space work setup with simple visual cues.',
    why_it_matters: '',
    who_its_for: '',
    explanation_for_newbies: '',
    area_id: 'area-1',
    area_name: 'Work',
    tags: ['instagram', 'workspace', 'productivity'],
    enrichment_status: 'partial',
  }, 'https://www.instagram.com/reel/abc123/');

  assert.equal(result, true);
});

test('media-only instagram carousel fallback provides enough enrichment signal', () => {
  const summary = buildInstagramMediaOnlySummary({
    media_type: 'carousel',
    media_items: [{}, {}, {}, {}, {}, {}],
  });

  const result = hasMeaningfulInstagramEnrichment({
    title: 'Instagram Carousel',
    instagram_display_title: 'Instagram Carousel',
    summary,
    why_it_matters: '',
    who_its_for: '',
    explanation_for_newbies: '',
    area_id: '',
    area_name: '',
    tags: ['instagram'],
    enrichment_status: 'partial',
  }, 'https://www.instagram.com/p/DWO0Sb1FvGp/');

  assert.match(summary, /6 media items/);
  assert.equal(result, true);
});
