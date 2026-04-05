import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMediaDuplicateMatch,
  getMediaDuplicateLabel,
  normalizeMediaDuplicateTitle,
} from '../mediaUtils.js';

test('normalizeMediaDuplicateTitle strips punctuation and year suffixes', () => {
  assert.equal(normalizeMediaDuplicateTitle('Demon Slayer: Kimetsu no Yaiba (2019)'), 'demon slayer kimetsu no yaiba');
});

test('getMediaDuplicateMatch prefers exact provider or external id matches first', () => {
  const existingEntries = [
    {
      id: 'existing-1',
      title: 'Attack on Titan',
      media_type: 'anime',
      external_id: 'anilist:12345',
      primary_provider: 'anilist',
    },
  ];

  const match = getMediaDuplicateMatch({
    title: 'Attack on Titan Final Season',
    media_type: 'anime',
    external_id: '12345',
    primary_provider: 'anilist',
  }, existingEntries);

  assert.equal(match?.entry?.id, 'existing-1');
  assert.equal(match?.matchType, 'provider');
  assert.equal(getMediaDuplicateLabel(match), 'Already saved');
});

test('getMediaDuplicateMatch falls back to title and media type matching', () => {
  const existingEntries = [
    {
      id: 'existing-2',
      title: 'The Last of Us',
      media_type: 'series',
      year_released: 2023,
    },
  ];

  const match = getMediaDuplicateMatch({
    title: 'The Last of Us',
    media_type: 'series',
    year_consumed: 2023,
  }, existingEntries);

  assert.equal(match?.entry?.id, 'existing-2');
  assert.equal(match?.matchType, 'title_year');
});
