import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMediaDuplicateMatch,
  getMediaDuplicateLabel,
  normalizeMediaDuplicateTitle,
} from '../media-duplicates.js';

test('normalizeMediaDuplicateTitle keeps the server duplicate matcher aligned with the client', () => {
  assert.equal(normalizeMediaDuplicateTitle('One Piece: East Blue (1999)'), 'one piece east blue');
});

test('getMediaDuplicateMatch returns the existing provider-backed media entry', () => {
  const existingEntries = [
    {
      id: 'media-1',
      title: 'Solo Leveling',
      media_type: 'anime',
      external_id: 'anilist:9001',
      primary_provider: 'anilist',
    },
  ];

  const match = getMediaDuplicateMatch({
    title: 'Solo Leveling',
    media_type: 'anime',
    external_id: '9001',
    primary_provider: 'anilist',
  }, existingEntries);

  assert.equal(match?.entry?.id, 'media-1');
  assert.equal(match?.matchType, 'provider');
  assert.equal(getMediaDuplicateLabel(match), 'Already saved');
});

test('getMediaDuplicateMatch falls back to matching normalized title and media type', () => {
  const existingEntries = [
    {
      id: 'media-2',
      title: 'Dune',
      media_type: 'movie',
      year_released: 2021,
    },
  ];

  const match = getMediaDuplicateMatch({
    title: 'Dune',
    media_type: 'movie',
    year_consumed: 2021,
  }, existingEntries);

  assert.equal(match?.entry?.id, 'media-2');
  assert.equal(match?.matchType, 'title_year');
});
