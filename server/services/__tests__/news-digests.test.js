import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackDigestContent,
  deriveDigestContent,
  formatDigestRow,
  getDefaultDigestDateUtc,
  isDigestTableMissingError,
  normalizeDigestCategory,
  normalizeDigestDateInput,
} from '../news-digests.js';

function makeArticle(overrides = {}) {
  return {
    id: overrides.id || 'article-1',
    title: overrides.title || 'Default article title',
    summary: overrides.summary || 'A solid summary of the most important development.',
    url: overrides.url || 'https://example.com/article-1',
    source_name: overrides.source_name || 'Example Source',
    image_url: null,
    published_at: overrides.published_at || '2026-04-05T03:00:00.000Z',
    category: overrides.category || 'ai',
    is_ai_summary: false,
  };
}

test('normalizeDigestCategory keeps supported categories and defaults invalid values to all', () => {
  assert.equal(normalizeDigestCategory('ai_research'), 'ai_research');
  assert.equal(normalizeDigestCategory('all'), 'all');
  assert.equal(normalizeDigestCategory('unexpected'), 'all');
});

test('normalizeDigestDateInput accepts YYYY-MM-DD and rejects invalid formats', () => {
  assert.equal(normalizeDigestDateInput('2026-04-05'), '2026-04-05');
  assert.throws(() => normalizeDigestDateInput('04/05/2026'), /YYYY-MM-DD/);
});

test('getDefaultDigestDateUtc returns the previous UTC day', () => {
  const now = new Date('2026-04-06T08:15:00.000Z');
  assert.equal(getDefaultDigestDateUtc(now), '2026-04-05');
});

test('buildFallbackDigestContent creates a calm empty-state digest when no articles are available', () => {
  const digest = buildFallbackDigestContent([], 'all');
  assert.match(digest.headline_summary, /No validated news stories/);
  assert.equal(digest.key_points.length, 2);
  assert.equal(digest.metadata.summary_fallback, 'empty_window');
});

test('buildFallbackDigestContent rolls up the lead supporting articles when articles exist', () => {
  const digest = buildFallbackDigestContent([
    makeArticle({ title: 'OpenAI released a new reasoning system', source_name: 'OpenAI' }),
    makeArticle({ id: 'article-2', title: 'Google DeepMind published a benchmark update', source_name: 'Google DeepMind', url: 'https://example.com/article-2' }),
  ], 'ai');

  assert.match(digest.headline_summary, /OpenAI/);
  assert.equal(digest.key_points.length, 2);
  assert.equal(digest.metadata.summary_fallback, 'article_rollup');
});

test('deriveDigestContent keeps fallback summaries focused on the top three articles', async () => {
  const digest = await deriveDigestContent({
    userId: null,
    digestDate: '2026-04-05',
    category: 'all',
    articles: [
      makeArticle({ id: '1', title: 'Lead one', source_name: 'Source A', summary: 'Summary one has enough detail to stand alone.' }),
      makeArticle({ id: '2', title: 'Lead two', source_name: 'Source B', summary: 'Summary two has enough detail to stand alone.', url: 'https://example.com/2' }),
      makeArticle({ id: '3', title: 'Lead three', source_name: 'Source C', summary: 'Summary three has enough detail to stand alone.', url: 'https://example.com/3' }),
      makeArticle({ id: '4', title: 'Lead four', source_name: 'Source D', summary: 'Summary four should not appear in fallback key points.', url: 'https://example.com/4' }),
    ],
  });

  assert.equal(digest.key_points.length, 3);
  assert.equal(digest.key_points.some((point) => point.includes('Summary four')), false);
});

test('formatDigestRow normalizes missing json fields into dashboard-safe arrays and objects', () => {
  const row = formatDigestRow({
    digest_date: '2026-04-05',
    category: 'tech',
    headline_summary: 'A concise recap.',
    key_points: null,
    article_refs: null,
    source_count: 0,
    article_count: 0,
    generated_at: '2026-04-06T00:05:00.000Z',
    partial: false,
    degraded: true,
    metadata: null,
  });

  assert.deepEqual(row.key_points, []);
  assert.deepEqual(row.article_refs, []);
  assert.deepEqual(row.metadata, {});
  assert.equal(row.degraded, true);
});

test('isDigestTableMissingError recognizes missing-table responses from Supabase and Postgres', () => {
  assert.equal(isDigestTableMissingError({
    code: 'PGRST205',
    message: "Could not find the table 'public.news_digests' in the schema cache",
  }), true);

  assert.equal(isDigestTableMissingError({
    code: '42P01',
    message: 'relation "public.news_digests" does not exist',
  }), true);

  assert.equal(isDigestTableMissingError({
    code: '23505',
    message: 'duplicate key value violates unique constraint',
  }), false);
});
