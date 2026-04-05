import { DOMParser } from 'linkedom';
import { z } from 'zod';
import { hasAiProviderConfig } from '../config/env.js';
import { fetchExternalText } from '../lib/external-api.js';
import { HttpError, toSlug } from '../lib/http.js';
import { routeStructuredJson } from '../lib/llm-router.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ARTICLE_AGE_MS = 14 * DAY_MS;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const DEFAULT_TOP_LIMIT = 4;

const CATEGORY_DEFAULTS = {
  ai: 'artificial intelligence',
  tech: 'technology',
  startups: 'startup funding',
  crypto: 'cryptocurrency blockchain',
  general: 'top headlines',
};

const CATEGORY_PRIORITY = {
  ai: 1,
  tech: 2,
  startups: 3,
  crypto: 4,
  general: 5,
};

const CATEGORY_RULES = [
  { category: 'ai', keywords: ['ai', 'artificial intelligence', 'machine learning', 'llm', 'anthropic', 'openai', 'chatgpt', 'claude', 'copilot'] },
  { category: 'crypto', keywords: ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'token', 'web3', 'solana'] },
  { category: 'startups', keywords: ['startup', 'startups', 'funding', 'venture capital', 'seed', 'series a', 'series b', 'acquisition'] },
  { category: 'tech', keywords: ['tech', 'technology', 'software', 'hardware', 'app', 'apps', 'device', 'cloud', 'chip'] },
];

const GENERIC_TREND_TAGS = new Set([
  'ai',
  'news',
  'tech',
  'technology',
  'startups',
  'startup',
  'crypto',
  'web3',
  'blockchain',
  'artificial intelligence',
  'machine learning',
]);

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'over',
  'after',
  'this',
  'that',
  'your',
  'will',
  'have',
  'about',
  'more',
  'than',
  'what',
  'when',
  'where',
  'which',
  'their',
  'they',
  'them',
  'you',
  'how',
]);

const FEED_SOURCES = {
  ai: [
    {
      id: 'techcrunch-ai',
      name: 'TechCrunch',
      url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
      category: 'ai',
      priority: 10,
    },
    {
      id: 'verge-ai',
      name: 'The Verge',
      url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
      category: 'ai',
      priority: 9,
    },
    {
      id: 'wired-ai',
      name: 'Wired',
      url: 'https://www.wired.com/feed/tag/ai/latest/rss',
      category: 'ai',
      priority: 8,
    },
  ],
  tech: [
    {
      id: 'verge-tech',
      name: 'The Verge',
      url: 'https://www.theverge.com/rss/index.xml',
      category: 'tech',
      priority: 10,
    },
    {
      id: 'ars-tech',
      name: 'Ars Technica',
      url: 'https://feeds.arstechnica.com/arstechnica/index',
      category: 'tech',
      priority: 9,
    },
    {
      id: 'tnw',
      name: 'The Next Web',
      url: 'https://thenextweb.com/feed',
      category: 'tech',
      priority: 7,
    },
  ],
  startups: [
    {
      id: 'techcrunch-startups',
      name: 'TechCrunch',
      url: 'https://techcrunch.com/category/startups/feed/',
      category: 'startups',
      priority: 10,
    },
    {
      id: 'crunchbase-news',
      name: 'Crunchbase News',
      url: 'https://news.crunchbase.com/feed/',
      category: 'startups',
      priority: 9,
    },
    {
      id: 'sifted',
      name: 'Sifted',
      url: 'https://sifted.eu/feed',
      category: 'startups',
      priority: 8,
    },
  ],
  crypto: [
    {
      id: 'decrypt',
      name: 'Decrypt',
      url: 'https://decrypt.co/feed',
      category: 'crypto',
      priority: 10,
    },
    {
      id: 'cointelegraph',
      name: 'Cointelegraph',
      url: 'https://cointelegraph.com/rss',
      category: 'crypto',
      priority: 9,
    },
  ],
};

const SUMMARY_SCHEMA = z.object({
  summary: z.string().min(24).max(280),
});

function logNews(level, event, details = {}) {
  console[level](`[news] ${event}`, details);
}

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function resolveRequestedCategory(category = '') {
  const normalized = String(category || '').trim().toLowerCase();
  return FEED_SOURCES[normalized] ? normalized : 'general';
}

function getCategorySources(category = 'general') {
  if (category !== 'general') return FEED_SOURCES[category];

  const seen = new Set();
  return Object.values(FEED_SOURCES)
    .flat()
    .filter((source) => {
      if (seen.has(source.id)) return false;
      seen.add(source.id);
      return true;
    });
}

function cleanWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeElementName(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.includes(':') ? normalized.split(':').pop() : normalized;
}

function extractElementText(element) {
  if (!element) return '';
  const direct = cleanWhitespace(element.textContent || '');
  if (direct) return direct;

  const firstChildData = cleanWhitespace(element.firstChild?.data || '');
  if (firstChildData) return firstChildData;

  const inner = cleanWhitespace(
    String(element.innerHTML || '')
      .replace(/^<!\[CDATA\[/, '')
      .replace(/\]\]>$/, '')
  );
  if (inner) return inner;

  return '';
}

function decodeHtml(value = '') {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value = '') {
  const decoded = decodeHtml(value);
  return cleanWhitespace(
    decoded
      .replace(/^<!\[CDATA\[/, '')
      .replace(/\]\]>$/, '')
      .replace(/<[^>]+>/g, ' ')
  );
}

function summarizePlainText(value = '', maxLength = 220) {
  const normalized = cleanWhitespace(value);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeUrl(input = '') {
  try {
    const parsed = new URL(String(input || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'utm_id',
      'utm_name',
      'utm_cid',
      'utm_reader',
      'utm_referrer',
      'utm_brand',
      'rss',
      'ref',
      'ref_src',
      'fbclid',
      'gclid',
      'oc',
    ].forEach((key) => parsed.searchParams.delete(key));
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function findElementsByNames(node, names = []) {
  const expected = new Set(names.map((name) => normalizeElementName(name)));
  const stack = Array.from(node.children || []);
  const matches = [];

  while (stack.length) {
    const element = stack.shift();
    if (!element) continue;
    const localName = normalizeElementName(element.localName || element.nodeName || element.tagName || '');
    if (expected.has(localName)) {
      matches.push(element);
    }
    stack.unshift(...Array.from(element.children || []));
  }

  return matches;
}

function textFromNode(node, selectors = []) {
  for (const name of selectors) {
    const element = findElementsByNames(node, [name])[0];
    const text = extractElementText(element);
    if (text) return text;
  }

  return '';
}

function extractLink(node) {
  const atomLinks = findElementsByNames(node, ['link']);
  for (const element of atomLinks) {
    const href = cleanWhitespace(element.getAttribute('href') || '');
    if (href) return href;
    const text = extractElementText(element);
    if (text) return text;
  }
  return '';
}

function extractImageUrl(node, html = '') {
  const namespacedCandidates = findElementsByNames(node, ['media:content', 'media:thumbnail', 'enclosure']);
  for (const element of namespacedCandidates) {
    const url = normalizeUrl(element.getAttribute('url') || element.getAttribute('href') || '');
    const type = cleanWhitespace(element.getAttribute('type') || '');
    if (url && (!type || type.startsWith('image/'))) return url;
  }

  if (html) {
    const doc = new DOMParser().parseFromString(`<body>${decodeHtml(html)}</body>`, 'text/html');
    const image = doc.querySelector('img');
    const url = normalizeUrl(image?.getAttribute('src') || '');
    if (url) return url;
  }

  return '';
}

function parsePublishedAt(value = '') {
  const parsed = new Date(String(value || '').trim());
  if (Number.isNaN(parsed.valueOf())) return '';
  return parsed.toISOString();
}

function tokenize(value = '') {
  return Array.from(new Set(
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 3)
  ));
}

function jaccardSimilarity(left = '', right = '') {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (!a.size || !b.size) return 0;
  const intersection = Array.from(a).filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function inferCategory(text = '', fallback = 'general') {
  const haystack = String(text || '').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return rule.category;
    }
  }
  return fallback;
}

function getCategoryBadge(category = '') {
  return CATEGORY_PRIORITY[category] ? category : 'general';
}

function buildFallbackTags(article) {
  const tokens = tokenize(`${article.title} ${article.source_name}`)
    .filter((token) => !GENERIC_TREND_TAGS.has(token) && !STOPWORDS.has(token))
    .slice(0, 3);
  return tokens;
}

function normalizeTags(node, article) {
  const tags = new Set();

  findElementsByNames(node, ['category']).forEach((element) => {
    const term = cleanWhitespace(element.getAttribute('term') || element.textContent || '').toLowerCase();
    if (term) tags.add(term);
  });

  if (!tags.size) {
    buildFallbackTags(article).forEach((tag) => tags.add(tag));
  }

  return Array.from(tags).filter((tag) => tag && !GENERIC_TREND_TAGS.has(tag));
}

function scoreArticle(article, { queryTokens = [], requestedCategory = 'general' } = {}) {
  const publishedAt = new Date(article.published_at);
  const ageHours = Math.max(0, (Date.now() - publishedAt.valueOf()) / (60 * 60 * 1000));
  const recencyScore = Math.max(0, 96 - Math.min(ageHours, 96));
  const haystack = `${article.title} ${article.summary} ${article.source_name}`.toLowerCase();
  const queryScore = queryTokens.reduce((total, token) => total + (haystack.includes(token) ? 20 : 0), 0);
  const categoryScore = requestedCategory !== 'general' && article.category === requestedCategory ? 30 : 0;
  const summaryScore = article.summary.length >= 48 ? 8 : 0;
  const sourceScore = article.source_priority || 0;
  return recencyScore + queryScore + categoryScore + summaryScore + sourceScore;
}

function buildArticleId(article) {
  return `${article.category}-${toSlug(`${article.source_name}-${article.title}-${article.published_at}`)}`;
}

export function parseFeedArticles(xml = '', source) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const entries = Array.from(doc.getElementsByTagName('item') || []);
  const nodes = entries.length ? entries : Array.from(doc.getElementsByTagName('entry') || []);

  return nodes.map((node) => {
    const rawTitle = textFromNode(node, ['title']);
    const rawLink = extractLink(node);
    const rawDescription = textFromNode(node, ['description', 'summary', 'content']);
    const rawPublished = textFromNode(node, ['pubDate', 'published', 'updated']);
    const sourceName = textFromNode(node, ['source']) || source.name;
    const title = cleanWhitespace(rawTitle);
    const url = normalizeUrl(rawLink);
    const summary = summarizePlainText(stripHtml(rawDescription));
    const publishedAt = parsePublishedAt(rawPublished);
    const imageUrl = extractImageUrl(node, rawDescription);
    const category = getCategoryBadge(inferCategory(`${title} ${summary}`, source.category));

    return {
      id: '',
      title,
      summary,
      url,
      source_name: sourceName,
      image_url: imageUrl || null,
      published_at: publishedAt,
      category,
      is_ai_summary: false,
      source_id: source.id,
      source_priority: source.priority,
      tags: [],
    };
  }).map((article, index) => ({
    ...article,
    tags: normalizeTags(nodes[index], article),
  }));
}

export function dedupeArticles(articles = []) {
  const byUrl = new Set();
  const kept = [];
  const dropped = { duplicate_url: 0, duplicate_title: 0 };

  for (const article of articles) {
    if (byUrl.has(article.url)) {
      dropped.duplicate_url += 1;
      continue;
    }

    const existing = kept.find((entry) => jaccardSimilarity(entry.title, article.title) >= 0.6);
    if (existing) {
      dropped.duplicate_title += 1;
      continue;
    }

    byUrl.add(article.url);
    kept.push(article);
  }

  return { articles: kept, dropped };
}

function normalizeFeedResult(rawArticles, source) {
  const now = Date.now();
  const accepted = [];
  const dropped = {
    missing_title: 0,
    invalid_url: 0,
    invalid_date: 0,
    stale: 0,
    missing_summary: 0,
  };

  for (const article of rawArticles) {
    if (!article.title) {
      dropped.missing_title += 1;
      continue;
    }

    if (!article.url) {
      dropped.invalid_url += 1;
      continue;
    }

    if (!article.published_at) {
      dropped.invalid_date += 1;
      continue;
    }

    if (now - new Date(article.published_at).valueOf() > MAX_ARTICLE_AGE_MS) {
      dropped.stale += 1;
      continue;
    }

    accepted.push({
      ...article,
      id: buildArticleId(article),
      source_name: article.source_name || source.name,
      summary: article.summary || summarizePlainText(article.title),
    });
  }

  return { articles: accepted, dropped };
}

async function fetchFeedSource(source) {
  const xml = await fetchExternalText(source.url, {
    provider: `feed:${source.id}`,
    timeoutMs: 9000,
    headers: {
      'User-Agent': 'LifeOS/1.0 (+https://lifeos.app)',
      Accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml;q=0.9, */*;q=0.8',
    },
  });

  const parsed = parseFeedArticles(xml, source);
  const normalized = normalizeFeedResult(parsed, source);
  logNews('info', 'feed_loaded', {
    source: source.id,
    accepted: normalized.articles.length,
    dropped: normalized.dropped,
  });
  return normalized;
}

async function summarizeMissingArticles(userId, articles = []) {
  if (!hasAiProviderConfig() || !userId) return articles;

  const candidates = articles
    .map((article, index) => ({ article, index }))
    .filter(({ article }) => !article.summary || article.summary.length < 40)
    .slice(0, 3);

  if (!candidates.length) return articles;

  const next = [...articles];

  for (const candidate of candidates) {
    try {
      const result = await routeStructuredJson({
        taskType: 'generic.structured',
        userId,
        schema: SUMMARY_SCHEMA,
        policy: { tier: 'cheap', temperature: 0.2, maxTokens: 180 },
        metadata: { requestSummary: `news-summary:${candidate.article.source_id}` },
        prompt: [
          'Summarize this real news article in one crisp sentence.',
          'Do not invent facts. Keep it under 28 words.',
          `Title: ${candidate.article.title}`,
          `Source: ${candidate.article.source_name}`,
          `Published at: ${candidate.article.published_at}`,
          `Context: ${candidate.article.summary || ''}`,
        ].join('\n'),
      });

      next[candidate.index] = {
        ...candidate.article,
        summary: result.data.summary,
        is_ai_summary: true,
      };
    } catch (error) {
      logNews('warn', 'summary_failed', {
        source: candidate.article.source_id,
        message: error?.message || 'Unknown error',
      });
    }
  }

  return next;
}

async function gatherNewsArticles({ category = 'general', query = '', limit = DEFAULT_LIMIT, userId = null } = {}) {
  const requestedCategory = resolveRequestedCategory(category);
  const queryUsed = cleanWhitespace(query || CATEGORY_DEFAULTS[requestedCategory]);
  const queryTokens = tokenize(queryUsed);
  const applyQueryFilter = requestedCategory === 'general' && queryUsed && queryUsed !== CATEGORY_DEFAULTS.general;
  const sources = getCategorySources(requestedCategory);
  const results = await Promise.allSettled(sources.map((source) => fetchFeedSource(source)));

  const successes = [];
  const failures = [];
  const droppedAggregate = {
    missing_title: 0,
    invalid_url: 0,
    invalid_date: 0,
    stale: 0,
    missing_summary: 0,
    duplicate_url: 0,
    duplicate_title: 0,
  };

  results.forEach((result, index) => {
    const source = sources[index];
    if (result.status === 'fulfilled') {
      successes.push(...result.value.articles);
      Object.entries(result.value.dropped).forEach(([key, count]) => {
        droppedAggregate[key] += count;
      });
      return;
    }

    failures.push({
      source: source.id,
      message: result.reason?.message || 'Unknown feed error',
    });
    logNews('warn', 'feed_failed', {
      source: source.id,
      message: result.reason?.message || 'Unknown feed error',
    });
  });

  const filtered = successes
    .map((article) => ({
      ...article,
      score: scoreArticle(article, { queryTokens, requestedCategory }),
    }))
    .filter((article) => {
      if (!applyQueryFilter || !queryTokens.length) return true;
      return queryTokens.some((token) => `${article.title} ${article.summary} ${article.source_name}`.toLowerCase().includes(token));
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return new Date(right.published_at).valueOf() - new Date(left.published_at).valueOf();
    });

  const deduped = dedupeArticles(filtered);
  Object.entries(deduped.dropped).forEach(([key, count]) => {
    droppedAggregate[key] += count;
  });

  const sliced = deduped.articles.slice(0, limit);
  const enriched = await summarizeMissingArticles(userId, sliced);
  const sourceCount = new Set(enriched.map((article) => article.source_name)).size;
  const partial = failures.length > 0;
  const degraded = partial || enriched.length < Math.min(limit, 4);

  logNews('info', 'news_aggregated', {
    requestedCategory,
    queryUsed,
    articleCount: enriched.length,
    sourceCount,
    failures,
    dropped: droppedAggregate,
  });

  if (!enriched.length) {
    throw new HttpError(502, 'No validated news articles are available right now.', {
      query_used: queryUsed,
      category: requestedCategory,
      failures,
      partial,
      degraded: true,
    });
  }

  return {
    articles: enriched.map((article) => ({
      id: article.id,
      title: article.title,
      summary: article.summary,
      url: article.url,
      source_name: article.source_name,
      image_url: article.image_url,
      published_at: article.published_at,
      category: article.category,
      is_ai_summary: article.is_ai_summary,
    })),
    generated_at: new Date().toISOString(),
    query_used: queryUsed,
    source_count: sourceCount,
    partial,
    degraded,
    failures,
  };
}

function pickTopCategory(categoryCounts = {}) {
  return Object.entries(categoryCounts)
    .sort((left, right) => (right[1] - left[1]) || ((CATEGORY_PRIORITY[left[0]] || 99) - (CATEGORY_PRIORITY[right[0]] || 99)))[0]?.[0] || 'general';
}

export function buildTrendsFromArticles(articles = [], limit = 6) {
  const trendMap = new Map();

  for (const article of articles) {
    const tags = article.tags?.length ? article.tags : buildFallbackTags(article);
    for (const tag of tags.slice(0, 4)) {
      const key = tag.toLowerCase();
      if (!key || GENERIC_TREND_TAGS.has(key)) continue;
      const entry = trendMap.get(key) || {
        topic: key,
        articles: [],
        sourceBreakdown: {},
        categoryCounts: {},
        recencyScore: 0,
      };

      entry.articles.push(article);
      entry.sourceBreakdown[article.source_name] = (entry.sourceBreakdown[article.source_name] || 0) + 1;
      entry.categoryCounts[article.category] = (entry.categoryCounts[article.category] || 0) + 1;
      const ageHours = Math.max(0, (Date.now() - new Date(article.published_at).valueOf()) / (60 * 60 * 1000));
      entry.recencyScore += Math.max(0, 48 - Math.min(48, ageHours));
      trendMap.set(key, entry);
    }
  }

  return Array.from(trendMap.values())
    .sort((left, right) => {
      if (right.articles.length !== left.articles.length) return right.articles.length - left.articles.length;
      return right.recencyScore - left.recencyScore;
    })
    .slice(0, limit)
    .map((entry) => {
      const uniqueSources = Object.keys(entry.sourceBreakdown).length;
      const articleCount = entry.articles.length;
      const trendScore = Math.min(100, Math.round((articleCount * 18) + (uniqueSources * 8) + Math.min(24, entry.recencyScore / Math.max(1, articleCount))));
      const growthRate = Math.min(99, Math.max(8, Math.round((articleCount * 9) + (uniqueSources * 6))));
      return {
        topic: entry.topic.replace(/\b\w/g, (char) => char.toUpperCase()),
        category: pickTopCategory(entry.categoryCounts),
        trend_score: trendScore,
        growth_rate: growthRate,
        article_count: articleCount,
        source_breakdown: entry.sourceBreakdown,
        articles: entry.articles
          .sort((left, right) => new Date(right.published_at).valueOf() - new Date(left.published_at).valueOf())
          .slice(0, 5)
          .map((article) => ({
            title: article.title,
            url: article.url,
            source_name: article.source_name,
          })),
      };
    });
}

export async function getNewsFeed({ category = 'general', query = '', limit = DEFAULT_LIMIT, userId = null } = {}) {
  return gatherNewsArticles({
    category,
    query,
    limit: clampLimit(limit, DEFAULT_LIMIT),
    userId,
  });
}

export async function getTopNews({ limit = DEFAULT_TOP_LIMIT, userId = null } = {}) {
  return gatherNewsArticles({
    category: 'general',
    query: CATEGORY_DEFAULTS.general,
    limit: clampLimit(limit, DEFAULT_TOP_LIMIT),
    userId,
  });
}

export async function getNewsTrends({ limit = 6 } = {}) {
  const aggregated = await gatherNewsArticles({
    category: 'general',
    query: CATEGORY_DEFAULTS.general,
    limit: 18,
    userId: null,
  });

  return {
    trends: buildTrendsFromArticles(aggregated.articles, limit),
    generated_at: aggregated.generated_at,
    source_count: aggregated.source_count,
    partial: aggregated.partial,
    degraded: aggregated.degraded,
  };
}
