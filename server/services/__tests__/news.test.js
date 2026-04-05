import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrendsFromArticles, dedupeArticles, parseFeedArticles } from '../news.js';

const rssSource = {
  id: 'test-rss',
  name: 'Test Feed',
  url: 'https://example.com/feed',
  category: 'ai',
  priority: 10,
};

test('parseFeedArticles normalizes rss items with direct article fields', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Anthropic ships a new coding model</title>
          <link>https://example.com/anthropic-model?utm_source=rss</link>
          <description><![CDATA[<p>Anthropic unveiled a faster coding model for enterprise teams.</p>]]></description>
          <pubDate>Sun, 05 Apr 2026 10:00:00 GMT</pubDate>
          <category>Anthropic</category>
          <media:thumbnail xmlns:media="http://search.yahoo.com/mrss/" url="https://example.com/thumb.jpg" />
        </item>
      </channel>
    </rss>`;

  const articles = parseFeedArticles(xml, rssSource);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, 'Anthropic ships a new coding model');
  assert.equal(articles[0].url, 'https://example.com/anthropic-model');
  assert.equal(articles[0].source_name, 'Test Feed');
  assert.equal(articles[0].category, 'ai');
  assert.equal(articles[0].image_url, 'https://example.com/thumb.jpg');
  assert.match(articles[0].published_at, /^2026-04-05T10:00:00/);
  assert.deepEqual(articles[0].tags, ['anthropic']);
});

test('dedupeArticles drops duplicate urls and near-duplicate titles', () => {
  const base = {
    summary: 'A real article summary that is long enough to keep.',
    source_name: 'Example',
    image_url: null,
    published_at: '2026-04-05T10:00:00.000Z',
    category: 'tech',
    is_ai_summary: false,
  };

  const result = dedupeArticles([
    { ...base, id: '1', title: 'OpenAI launches a new agent product', url: 'https://example.com/openai-agent' },
    { ...base, id: '2', title: 'OpenAI launches a new agent product', url: 'https://example.com/openai-agent' },
    { ...base, id: '3', title: 'OpenAI launches new agent product for developers', url: 'https://example.com/openai-agent-dev' },
    { ...base, id: '4', title: 'Anthropic expands Claude usage controls', url: 'https://example.com/claude-controls' },
  ]);

  assert.equal(result.articles.length, 2);
  assert.equal(result.dropped.duplicate_url, 1);
  assert.equal(result.dropped.duplicate_title, 1);
});

test('buildTrendsFromArticles groups recurring article tags into trend cards', () => {
  const articles = [
    {
      id: '1',
      title: 'Anthropic raises enterprise AI stakes',
      summary: 'Anthropic expands enterprise AI deals.',
      url: 'https://example.com/1',
      source_name: 'TechCrunch',
      image_url: null,
      published_at: new Date().toISOString(),
      category: 'ai',
      is_ai_summary: false,
      tags: ['anthropic', 'enterprise'],
    },
    {
      id: '2',
      title: 'Anthropic launches new coding workflow',
      summary: 'A fresh coding workflow lands for Claude users.',
      url: 'https://example.com/2',
      source_name: 'The Verge',
      image_url: null,
      published_at: new Date().toISOString(),
      category: 'ai',
      is_ai_summary: false,
      tags: ['anthropic', 'claude'],
    },
    {
      id: '3',
      title: 'Crypto ETF momentum rises again',
      summary: 'ETF approval momentum lifts market sentiment.',
      url: 'https://example.com/3',
      source_name: 'Decrypt',
      image_url: null,
      published_at: new Date().toISOString(),
      category: 'crypto',
      is_ai_summary: false,
      tags: ['etf', 'bitcoin'],
    },
  ];

  const trends = buildTrendsFromArticles(articles, 3);
  assert.equal(trends[0].topic, 'Anthropic');
  assert.equal(trends[0].category, 'ai');
  assert.equal(trends[0].article_count, 2);
  assert.equal(trends[0].source_breakdown.TechCrunch, 1);
  assert.equal(trends[0].source_breakdown['The Verge'], 1);
});
