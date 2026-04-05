import { z } from 'zod';
import { hasAiProviderConfig } from '../config/env.js';
import { HttpError } from '../lib/http.js';
import { routeStructuredJson } from '../lib/llm-router.js';
import { getServiceRoleClient } from '../lib/supabase.js';
import {
  CATEGORY_DEFAULTS,
  DIGEST_CATEGORY_KEYS,
  collectNewsArticles,
  mapNewsArticle,
  resolveRequestedCategory,
} from './news.js';

const DIGEST_TABLE = 'news_digests';
const DEFAULT_DIGEST_ARTICLE_LIMIT = 12;
const DEFAULT_SUPPORTING_LINK_LIMIT = 3;

const DIGEST_SCHEMA = z.object({
  headline_summary: z.string().min(40).max(420),
  key_points: z.array(z.string().min(12).max(180)).min(2).max(4),
});

function logDigest(level, event, details = {}) {
  console[level](`[news-digest] ${event}`, details);
}

export function normalizeDigestCategory(category = '') {
  const normalized = String(category || '').trim().toLowerCase();
  return DIGEST_CATEGORY_KEYS.includes(normalized) ? normalized : 'all';
}

export function normalizeDigestDateInput(date = '') {
  const normalized = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpError(400, 'Digest date must use YYYY-MM-DD.');
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) {
    throw new HttpError(400, 'Digest date is invalid.');
  }

  return normalized;
}

function getDateWindowUtc(digestDate) {
  const start = new Date(`${normalizeDigestDateInput(digestDate)}T00:00:00.000Z`);
  const end = new Date(start.valueOf() + (24 * 60 * 60 * 1000));
  return {
    publishedFrom: start.toISOString(),
    publishedTo: end.toISOString(),
  };
}

export function getDefaultDigestDateUtc(now = new Date()) {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(utcMidnight - (24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

export function buildFallbackDigestContent(articles = [], category = 'all') {
  const topArticles = articles.slice(0, DEFAULT_SUPPORTING_LINK_LIMIT);
  if (!topArticles.length) {
    return {
      headline_summary: `No validated ${category === 'all' ? 'news' : category.replace('_', ' ')} stories made it into this digest window.`,
      key_points: [
        'Feeds were checked, but no validated articles matched the date window.',
        'Try the full News page for the latest live feed once new stories land.',
      ],
      metadata: {
        used_ai_summary: false,
        summary_fallback: 'empty_window',
      },
    };
  }

  const lead = topArticles[0];
  const second = topArticles[1];
  const headlineSummary = second
    ? `${lead.source_name} led the day with ${lead.title.toLowerCase()}, while ${second.source_name} also highlighted ${second.title.toLowerCase()}.`
    : `${lead.source_name} led the day with ${lead.title.toLowerCase()}.`;

  const keyPoints = topArticles.map((article) => article.summary || article.title).slice(0, 3);

  return {
    headline_summary: headlineSummary,
    key_points: keyPoints,
    metadata: {
      used_ai_summary: false,
      summary_fallback: 'article_rollup',
    },
  };
}

async function summarizeDigestWithAi({ userId, digestDate, category, articles }) {
  if (!hasAiProviderConfig() || !articles.length) return null;

  const context = articles
    .slice(0, 6)
    .map((article, index) => [
      `${index + 1}. ${article.title}`,
      `Source: ${article.source_name}`,
      `Published: ${article.published_at}`,
      `Summary: ${article.summary}`,
    ].join('\n'))
    .join('\n\n');

  try {
    const result = await routeStructuredJson({
      taskType: 'generic.structured',
      userId,
      schema: DIGEST_SCHEMA,
      policy: { tier: 'cheap', temperature: 0.2, maxTokens: 320 },
      metadata: { requestSummary: `news-digest:${digestDate}:${category}` },
      prompt: [
        `Create a concise morning digest for ${digestDate}.`,
        `Category: ${category}`,
        'Use only the supplied real articles. Do not invent sources, dates, or facts.',
        'Headline summary: 1-2 sentences, calm and high-signal.',
        'Key points: 2-4 bullets, each one sentence.',
        '',
        context,
      ].join('\n'),
    });

    return {
      headline_summary: result.data.headline_summary,
      key_points: result.data.key_points,
      metadata: {
        used_ai_summary: true,
      },
    };
  } catch (error) {
    logDigest('warn', 'ai_summary_failed', {
      category,
      digestDate,
      message: error?.message || 'Unknown error',
    });
    return null;
  }
}

export async function deriveDigestContent({ userId = null, digestDate, category, articles }) {
  const aiResult = await summarizeDigestWithAi({ userId, digestDate, category, articles });
  if (aiResult) return aiResult;
  return buildFallbackDigestContent(articles, category);
}

function buildDigestRecord({
  digestDate,
  category,
  articles,
  aggregated,
  digestContent,
}) {
  const supportingArticles = articles.slice(0, DEFAULT_SUPPORTING_LINK_LIMIT).map(mapNewsArticle);
  return {
    digest_date: digestDate,
    category,
    headline_summary: digestContent.headline_summary,
    key_points: digestContent.key_points,
    article_refs: supportingArticles,
    source_count: aggregated.source_count,
    article_count: articles.length,
    generated_at: new Date().toISOString(),
    partial: aggregated.partial,
    degraded: aggregated.degraded || !articles.length,
    metadata: {
      query_used: aggregated.query_used,
      failures: aggregated.failures || [],
      ...digestContent.metadata,
    },
  };
}

async function upsertDigest(record) {
  const admin = getServiceRoleClient();
  const result = await admin
    .from(DIGEST_TABLE)
    .upsert(record, { onConflict: 'digest_date,category' })
    .select('*')
    .single();

  if (result.error) {
    throw new HttpError(500, result.error.message);
  }

  return result.data;
}

export function formatDigestRow(row) {
  if (!row) return null;
  return {
    digest_date: row.digest_date,
    category: row.category,
    headline_summary: row.headline_summary,
    key_points: Array.isArray(row.key_points) ? row.key_points : [],
    article_refs: Array.isArray(row.article_refs) ? row.article_refs : [],
    source_count: row.source_count || 0,
    article_count: row.article_count || 0,
    generated_at: row.generated_at,
    partial: Boolean(row.partial),
    degraded: Boolean(row.degraded),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

async function fetchDigestRow({ digestDate, category }) {
  const admin = getServiceRoleClient();
  const exactResult = await admin
    .from(DIGEST_TABLE)
    .select('*')
    .eq('digest_date', digestDate)
    .eq('category', category)
    .maybeSingle();

  if (exactResult.error) {
    throw new HttpError(500, exactResult.error.message);
  }

  if (exactResult.data) return exactResult.data;

  const fallbackResult = await admin
    .from(DIGEST_TABLE)
    .select('*')
    .lte('digest_date', digestDate)
    .eq('category', category)
    .order('digest_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackResult.error) {
    throw new HttpError(500, fallbackResult.error.message);
  }

  return fallbackResult.data || null;
}

export async function getNewsDigest({ digestDate, category = 'all' }) {
  const normalizedDate = normalizeDigestDateInput(digestDate);
  const normalizedCategory = normalizeDigestCategory(category);
  const row = await fetchDigestRow({
    digestDate: normalizedDate,
    category: normalizedCategory,
  });

  if (!row) {
    throw new HttpError(404, 'No digest is available for that date and category.', {
      digest_date: normalizedDate,
      category: normalizedCategory,
    });
  }

  return formatDigestRow(row);
}

async function collectDigestArticles({ userId, category, digestDate }) {
  const requestedCategory = category === 'all' ? 'general' : resolveRequestedCategory(category);
  const query = requestedCategory === 'general'
    ? CATEGORY_DEFAULTS.general
    : CATEGORY_DEFAULTS[requestedCategory];
  const { publishedFrom, publishedTo } = getDateWindowUtc(digestDate);

  return collectNewsArticles({
    category: requestedCategory,
    query,
    limit: requestedCategory === 'general' ? 18 : DEFAULT_DIGEST_ARTICLE_LIMIT,
    userId,
    publishedFrom,
    publishedTo,
    throwOnEmpty: false,
  });
}

export async function generateNewsDigest({ userId, digestDate, category }) {
  const normalizedDate = normalizeDigestDateInput(digestDate || getDefaultDigestDateUtc());
  const normalizedCategory = normalizeDigestCategory(category);
  const aggregated = await collectDigestArticles({
    userId,
    category: normalizedCategory,
    digestDate: normalizedDate,
  });
  const digestContent = await deriveDigestContent({
    userId,
    digestDate: normalizedDate,
    category: normalizedCategory,
    articles: aggregated.articles,
  });

  const record = buildDigestRecord({
    digestDate: normalizedDate,
    category: normalizedCategory,
    articles: aggregated.articles,
    aggregated,
    digestContent,
  });

  logDigest('info', 'digest_generated', {
    digestDate: normalizedDate,
    category: normalizedCategory,
    articleCount: record.article_count,
    sourceCount: record.source_count,
    partial: record.partial,
    degraded: record.degraded,
  });

  return formatDigestRow(await upsertDigest(record));
}

export async function runDailyNewsDigestJob({ userId = null, digestDate = getDefaultDigestDateUtc() } = {}) {
  const normalizedDate = normalizeDigestDateInput(digestDate);
  const results = [];

  for (const category of DIGEST_CATEGORY_KEYS) {
    results.push(await generateNewsDigest({
      userId,
      digestDate: normalizedDate,
      category,
    }));
  }

  return {
    digest_date: normalizedDate,
    digests: results,
    generated_count: results.length,
    generated_at: new Date().toISOString(),
  };
}
