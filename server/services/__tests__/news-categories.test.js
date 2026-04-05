import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrendsFromArticles, diversifyArticles } from '../news.js';

function makeArticle(overrides = {}) {
  return {
    id: overrides.id || 'article',
    title: overrides.title || 'Default title',
    summary: overrides.summary || 'A usable summary for validation.',
    url: overrides.url || `https://example.com/${overrides.id || 'article'}`,
    source_name: overrides.source_name || 'Example',
    image_url: overrides.image_url || null,
    published_at: overrides.published_at || new Date().toISOString(),
    category: overrides.category || 'tech',
    is_ai_summary: false,
    score: overrides.score || 0,
    tags: overrides.tags || [],
  };
}

test('diversifyArticles keeps general results from collapsing into one category', () => {
  const articles = [
    makeArticle({ id: 'a1', category: 'ai', score: 90 }),
    makeArticle({ id: 'a2', category: 'ai', score: 89 }),
    makeArticle({ id: 'a3', category: 'ai', score: 88 }),
    makeArticle({ id: 'r1', category: 'ai_research', score: 87 }),
    makeArticle({ id: 't1', category: 'tech', score: 86 }),
    makeArticle({ id: 's1', category: 'startups', score: 85 }),
  ];

  const result = diversifyArticles(articles, 4);
  assert.deepEqual(result.map((entry) => entry.category), ['ai', 'ai_research', 'tech', 'startups']);
});

test('buildTrendsFromArticles allows ai_research trends when they have enough support', () => {
  const articles = [
    makeArticle({
      id: '1',
      title: 'Gemma evaluation benchmark improves reasoning coverage',
      source_name: 'Google Research',
      category: 'ai_research',
      tags: ['gemma', 'benchmark'],
    }),
    makeArticle({
      id: '2',
      title: 'BAIR benchmark explores multimodal reasoning',
      source_name: 'BAIR Blog',
      category: 'ai_research',
      tags: ['benchmark', 'multimodal'],
    }),
    makeArticle({
      id: '3',
      title: 'New benchmark tests long-context reasoning',
      source_name: 'Google DeepMind',
      category: 'ai_research',
      tags: ['benchmark', 'reasoning'],
    }),
  ];

  const trends = buildTrendsFromArticles(articles, 3);
  assert.equal(trends[0].category, 'ai_research');
  assert.equal(trends[0].topic, 'Benchmark');
});
