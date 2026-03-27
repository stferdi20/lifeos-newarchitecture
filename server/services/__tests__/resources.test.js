import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveStrongerExistingData, resolveAreaAssignment } from '../resources.js';

const areas = [
  { id: 'knowledge', name: 'Knowledge' },
  { id: 'career', name: 'Career' },
  { id: 'faith', name: 'Faith' },
];

const richExtracted = {
  resourceType: 'article',
  content: 'x'.repeat(1200),
};

const richMergedData = {
  summary: 'Useful summary.',
  why_it_matters: 'This matters for growth.',
  who_its_for: 'People exploring a career move.',
  key_points: ['One', 'Two'],
  actionable_points: ['Do a thing'],
  use_cases: ['Revisit before applying'],
};

test('resolveAreaAssignment does not force Knowledge when fallback is disabled', () => {
  const result = resolveAreaAssignment('Unknown Area', areas, richMergedData, richExtracted, {
    allowKnowledgeFallback: false,
  });

  assert.deepEqual(result, {
    area_id: '',
    area_name: '',
    area_needs_review: false,
  });
});

test('resolveAreaAssignment can still fall back to Knowledge explicitly', () => {
  const result = resolveAreaAssignment('', areas, richMergedData, richExtracted, {
    allowKnowledgeFallback: true,
  });

  assert.equal(result.area_id, 'knowledge');
  assert.equal(result.area_name, 'Knowledge');
});

test('preserveStrongerExistingData keeps an existing strong non-Knowledge area over weak Knowledge', () => {
  const result = preserveStrongerExistingData({
    area_id: 'faith',
    area_name: 'Faith',
    area_needs_review: false,
    enrichment_status: 'rich',
    summary: 'Existing summary',
    why_it_matters: 'Existing why',
    who_its_for: 'Existing audience',
  }, {
    area_id: 'knowledge',
    area_name: 'Knowledge',
    area_needs_review: true,
    enrichment_status: 'partial',
    summary: 'New summary',
    why_it_matters: 'New why',
    who_its_for: 'New audience',
  });

  assert.equal(result.area_id, 'faith');
  assert.equal(result.area_name, 'Faith');
});

test('preserveStrongerExistingData allows a better confident non-Knowledge replacement', () => {
  const result = preserveStrongerExistingData({
    area_id: 'career',
    area_name: 'Career',
    area_needs_review: true,
    enrichment_status: 'partial',
    summary: 'Existing summary',
    why_it_matters: 'Existing why',
    who_its_for: 'Existing audience',
  }, {
    area_id: 'faith',
    area_name: 'Faith',
    area_needs_review: false,
    enrichment_status: 'rich',
    summary: 'New summary',
    why_it_matters: 'New why',
    who_its_for: 'New audience',
  });

  assert.equal(result.area_id, 'faith');
  assert.equal(result.area_name, 'Faith');
});
