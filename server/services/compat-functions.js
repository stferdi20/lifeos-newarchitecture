import { z } from 'zod';
import { HttpError } from '../lib/http.js';
import { fetchExternalJson } from '../lib/external-api.js';
import { routeStructuredJson } from '../lib/llm-router.js';
import { createCompatEntity, updateCompatEntity } from './compat-store.js';
import { analyzeResource } from './resources.js';
import { parseCalendarText } from './calendar.js';
import {
  createCalendarEvents,
  deleteCalendarEvent,
  fetchCalendarEvents,
  updateCalendarEvent,
} from './google-calendar.js';
import { createGoogleWorkspaceDocument } from './google-drive-docs.js';
import {
  createLinkedGoogleTask,
  createReminderFromCard,
  createReminderFromChecklist,
  disconnectLinkedGoogleTask,
  fetchLinkedGoogleTask,
  syncLinkedGoogleTasks,
  updateLinkedGoogleTask,
} from './google-tasks.js';
import { getTaskForUser } from './tasks.js';
import { getCardForUser } from './boards.js';

const newsSchema = z.object({
  articles: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    url: z.string().default(''),
    source_name: z.string().default('Web'),
    image_url: z.string().default(''),
    published_at: z.string().default(''),
  })).default([]),
});

const trendsSchema = z.object({
  trends: z.array(z.object({
    topic: z.string(),
    category: z.enum(['ai', 'tech', 'startups', 'crypto']).default('tech'),
    trend_score: z.number().default(0),
    growth_rate: z.number().default(0),
    article_count: z.number().default(0),
    source_breakdown: z.record(z.number()).default({}),
    articles: z.array(z.object({
      title: z.string(),
      url: z.string().default(''),
      source_name: z.string().default('Web'),
    })).default([]),
  })).default([]),
});

const mediaSearchSchema = z.object({
  results: z.array(z.object({
    title: z.string(),
    external_id: z.string().default(''),
    poster_url: z.string().default(''),
    studio_author: z.string().default(''),
    year_released: z.number().nullable().default(null),
    genres: z.array(z.string()).default([]),
    plot: z.string().default(''),
    source_url: z.string().default(''),
    media_type: z.string().default(''),
  })).default([]),
  match: z.any().nullable().optional(),
  bestCandidate: z.any().nullable().optional(),
  decision: z.string().optional(),
  confidence: z.number().optional(),
  reason: z.string().optional(),
  queryUsed: z.string().optional(),
});

const mediaEnrichSchema = z.object({
  poster_url: z.string().default(''),
  studio_author: z.string().default(''),
  genres: z.array(z.string()).default([]),
  cast: z.array(z.string()).default([]),
  plot: z.string().default(''),
  duration: z.string().default(''),
  language: z.string().default(''),
  country: z.string().default(''),
  imdb_rating: z.number().nullable().default(null),
  awards: z.string().default(''),
  themes: z.array(z.string()).default([]),
  platforms: z.array(z.string()).default([]),
  page_count: z.number().nullable().default(null),
  seasons_total: z.number().nullable().default(null),
  episodes: z.number().nullable().default(null),
  chapters: z.number().nullable().default(null),
  volumes: z.number().nullable().default(null),
});

const creatorSchema = z.object({
  description: z.string().default(''),
  niche: z.string().default(''),
  content_style: z.string().default(''),
  tags: z.array(z.string()).default([]),
  profile_picture_url: z.string().default(''),
});

const stockSearchSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    name: z.string(),
    symbol: z.string(),
    set: z.string().default(''),
    image: z.string().default(''),
  })).default([]),
});

const cardSummarySchema = z.object({
  summary: z.string().default(''),
  nextSteps: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

function inferResourceType(url = '') {
  const value = String(url || '').toLowerCase();
  if (value.includes('youtube.com') || value.includes('youtu.be')) return 'youtube';
  if (value.includes('reddit.com')) return 'reddit';
  if (value.includes('github.com')) return 'github_repo';
  if (value.includes('instagram.com/reel')) return 'instagram_reel';
  if (value.includes('instagram.com/p/')) return 'instagram_carousel';
  if (value.endsWith('.pdf')) return 'pdf';
  if (value.includes('arxiv.org') || value.includes('scholar.google')) return 'research_paper';
  return 'article';
}

function normalizeResourceRecord(url, analysis = {}) {
  return {
    title: analysis.title || url,
    url,
    source_url: url,
    resource_type: inferResourceType(url),
    summary: analysis.summary || '',
    main_topic: analysis.main_topic || '',
    resource_score: analysis.score || 5,
    tags: analysis.tags || [],
    key_points: analysis.insights || [],
    actionable_points: analysis.actions || [],
    is_archived: false,
  };
}

async function fetchYahooSearch(query) {
  const data = await fetchExternalJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
    { provider: 'Yahoo Finance' },
  );
  return (data?.quotes || [])
    .filter((entry) => entry?.symbol && entry?.shortname)
    .map((entry) => ({
      id: entry.symbol,
      symbol: entry.symbol,
      name: entry.shortname,
      set: entry.exchange || entry.exchDisp || '',
      image: '',
    }));
}

async function fetchCoinGeckoPrices(ids = []) {
  if (!ids.length) return new Map();
  const data = await fetchExternalJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd,aud,idr`,
    { provider: 'CoinGecko' },
  );
  return new Map(
    Object.entries(data || {}).map(([id, price]) => [id, price?.usd || price?.aud || price?.idr || null]),
  );
}

async function fetchYahooQuotes(symbols = []) {
  if (!symbols.length) return new Map();
  const data = await fetchExternalJson(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`,
    { provider: 'Yahoo Finance' },
  );
  return new Map(
    (data?.quoteResponse?.result || []).map((entry) => [
      entry.symbol,
      entry.regularMarketPrice ?? null,
    ]),
  );
}

async function invokeFetchNews(userId, payload = {}) {
  const query = String(payload.query || 'technology').trim();
  const prompt = [
    'Find the latest real news articles.',
    `Topic: ${query}`,
    'Return 8 current articles with title, 1-sentence summary, url, source_name, image_url if known, and published_at if known.',
    'Only include real recent articles.',
  ].join('\n');

  return routeStructuredJson({
    taskType: 'generic.structured',
    prompt,
    schema: newsSchema,
    userId,
    policy: { tier: 'cheap', temperature: 0.2, maxTokens: 1400 },
    metadata: { requestSummary: `news:${query}` },
    groundWithGoogleSearch: true,
  });
}

async function invokeAggregateTrends(userId) {
  const prompt = [
    'Find 6 currently trending topics across AI, tech, startups, and crypto.',
    'For each topic, return a trend_score from 1-100, a rough growth_rate percentage, article_count, source_breakdown, and up to 5 article links.',
    'Be concise and grounded in current web results.',
  ].join('\n');

  return routeStructuredJson({
    taskType: 'generic.structured',
    prompt,
    schema: trendsSchema,
    userId,
    policy: { tier: 'standard', temperature: 0.2, maxTokens: 1800 },
    metadata: { requestSummary: 'trends' },
    groundWithGoogleSearch: true,
  });
}

async function invokeMediaSearch(userId, payload = {}) {
  const type = String(payload.type || 'movie').trim();
  const query = String(payload.query || '').trim();
  if (!query) return { results: [] };

  const prompt = [
    `Find up to 8 likely ${type} matches for: ${query}`,
    'Return metadata for a personal media tracker.',
    'Each result should include title, external_id, poster_url, studio_author, year_released, genres, plot, source_url, and media_type.',
    'Make external_id stable and prefixed by a provider key such as search:.',
    payload.resolveMatch ? 'Also choose the best single match if one is clearly stronger than the rest.' : '',
  ].filter(Boolean).join('\n');

  const result = await routeStructuredJson({
    taskType: 'generic.structured',
    prompt,
    schema: mediaSearchSchema,
    userId,
    policy: { tier: 'cheap', temperature: 0.2, maxTokens: 1600 },
    metadata: { requestSummary: `media-search:${type}:${query}` },
    groundWithGoogleSearch: true,
  });

  if (payload.resolveMatch) {
    const match = result.data?.results?.[0] || null;
    return {
      ...result.data,
      match,
      bestCandidate: match,
      decision: match ? 'matched' : 'no_match',
      confidence: match ? 0.72 : 0,
      reason: match ? 'Top grounded result selected.' : 'No grounded match found.',
      queryUsed: query,
    };
  }

  return result.data;
}

async function invokeMediaEnrich(userId, payload = {}) {
  const type = String(payload.type || 'movie').trim();
  const externalId = String(payload.externalId || '').trim();
  if (!externalId) return {};

  const prompt = [
    `Provide richer metadata for this ${type}: ${externalId}`,
    'Return poster_url, studio_author, genres, cast, plot, duration, language, country, imdb_rating, awards, themes, platforms, page_count, seasons_total, episodes, chapters, and volumes when applicable.',
  ].join('\n');

  const result = await routeStructuredJson({
    taskType: 'generic.structured',
    prompt,
    schema: mediaEnrichSchema,
    userId,
    policy: { tier: 'cheap', temperature: 0.2, maxTokens: 1400 },
    metadata: { requestSummary: `media-enrich:${type}:${externalId}` },
    groundWithGoogleSearch: true,
  });

  return result.data;
}

async function invokeFetchPrices(payload = {}) {
  const investments = Array.isArray(payload.investments) ? payload.investments : [];
  const stockSymbols = investments
    .filter((entry) => entry?.type === 'stock' && entry?.symbol)
    .map((entry) => String(entry.symbol).toUpperCase().endsWith('.JK') ? String(entry.symbol).toUpperCase() : `${String(entry.symbol).toUpperCase()}.JK`);
  const cryptoIds = investments
    .filter((entry) => entry?.type === 'crypto' && entry?.symbol)
    .map((entry) => String(entry.symbol).toLowerCase());

  const [stockPrices, cryptoPrices] = await Promise.all([
    fetchYahooQuotes(stockSymbols),
    fetchCoinGeckoPrices(cryptoIds),
  ]);

  return {
    results: investments.map((entry) => {
      if (entry?.type === 'stock' && entry?.symbol) {
        const ticker = String(entry.symbol).toUpperCase().endsWith('.JK') ? String(entry.symbol).toUpperCase() : `${String(entry.symbol).toUpperCase()}.JK`;
        return { id: entry.id, price: stockPrices.get(ticker) ?? null };
      }
      if (entry?.type === 'crypto' && entry?.symbol) {
        return { id: entry.id, price: cryptoPrices.get(String(entry.symbol).toLowerCase()) ?? null };
      }
      return { id: entry.id, price: null };
    }),
  };
}

async function invokeSearchStocks(userId, payload = {}) {
  const query = String(payload.query || '').trim();
  if (!query) return { results: [] };

  const yahooResults = await fetchYahooSearch(query);
  if (yahooResults.length) return { results: yahooResults };

  const prompt = [
    `Find up to 8 stock ticker matches for this query: ${query}`,
    'Focus on equities.',
    'Return id, name, symbol, and set (exchange).',
  ].join('\n');

  const result = await routeStructuredJson({
    taskType: 'generic.structured',
    prompt,
    schema: stockSearchSchema,
    userId,
    policy: { tier: 'cheap', temperature: 0.1, maxTokens: 700 },
    metadata: { requestSummary: `stocks:${query}` },
    groundWithGoogleSearch: true,
  });

  return result.data;
}

async function invokeGenerateTaskSummary(userId, payload = {}) {
  if (payload.taskId) {
    try {
      const task = await getTaskForUser(userId, payload.taskId);
      payload = { ...task, ...payload };
    } catch {
      // Fall back to provided payload if the task is not in the standalone table.
    }
  }

  const prompt = [
    'Summarize this project card or task.',
    `Title: ${payload.title || 'Untitled'}`,
    `Description: ${payload.description || ''}`,
    `Checklist: ${JSON.stringify(payload.checklist || [])}`,
    'Return JSON with summary, nextSteps (0-3), and risks (0-3).',
  ].join('\n');

  const result = await routeStructuredJson({
    taskType: 'card.summary',
    prompt,
    schema: cardSummarySchema,
    userId,
    policy: { tier: 'cheap', temperature: 0.2, maxTokens: 700 },
    metadata: { requestSummary: `card-summary:${payload.taskId || payload.title || 'task'}` },
  });

  return {
    aiInsights: result.data,
    ...result.data,
  };
}

async function invokeAnalyzeResource(userId, payload = {}) {
  const url = String(payload.url || '').trim();
  if (!url) throw new HttpError(400, 'Resource URL is required.');

  const analyzed = await analyzeResource({
    url,
    title: payload.title || '',
    content: payload.content || '',
    userId,
  });

  const resource = await createCompatEntity(
    userId,
    'Resource',
    normalizeResourceRecord(url, analyzed.data),
  );

  if (payload.project_id) {
    await createCompatEntity(userId, 'ProjectResource', {
      project_id: payload.project_id,
      resource_id: resource.id,
      created_date: new Date().toISOString(),
    });
  }

  return {
    resource,
    analysis: analyzed.data,
    provider: analyzed.provider,
    model: analyzed.model,
  };
}

async function invokeEnrichCreator(userId, payload = {}) {
  const handle = String(payload.handle || '').replace(/^@/, '').trim();
  if (!handle) throw new HttpError(400, 'Creator handle is required.');

  const prompt = [
    `Enrich a creator profile for ${handle}`,
    `Platform: ${payload.platform || 'other'}`,
    'Return a concise description, niche, content_style, 3-8 tags, and profile_picture_url if confidently available.',
  ].join('\n');

  const result = await routeStructuredJson({
    taskType: 'generic.structured',
    prompt,
    schema: creatorSchema,
    userId,
    policy: { tier: 'cheap', temperature: 0.2, maxTokens: 1000 },
    metadata: { requestSummary: `creator:${handle}` },
    groundWithGoogleSearch: true,
  });

  if (payload.creator_id) {
    try {
      await updateCompatEntity(userId, 'CreatorInspo', payload.creator_id, result.data);
    } catch {
      // Keep enrichment best-effort.
    }
  }

  return result.data;
}

export async function invokeCompatFunction(userId, functionName, payload = {}) {
  switch (functionName) {
    case 'analyzeResource':
      return invokeAnalyzeResource(userId, payload);
    case 'generateTaskSummary':
      return invokeGenerateTaskSummary(userId, payload);
    case 'createProjectDocument': {
      const card = payload.taskId ? await getCardForUser(userId, payload.taskId).catch(() => null) : null;
      const document = await createGoogleWorkspaceDocument(userId, {
        title: card?.title || payload.title || 'Untitled',
        fileType: payload.fileType || 'docs',
        templateKey: payload.templateKey || null,
        card: card ? {
          id: card.id,
          title: card.title,
          description: card.description || '',
        } : undefined,
      });
      return {
        success: true,
        fileName: document.title,
        fileUrl: document.url,
        documentId: document.documentId,
        provider: document.provider,
      };
    }
    case 'calendarManager': {
      const action = String(payload.action || '').trim();
      if (action === 'parseNL') {
        const parsed = await parseCalendarText({
          text: payload.text || '',
          timeZone: payload.timezone || payload.timeZone || 'Australia/Melbourne',
          userId,
        });
        return { parsed: parsed.data };
      }
      if (action === 'fetchEvents') {
        return fetchCalendarEvents(userId, payload);
      }
      if (action === 'createEvent') {
        return createCalendarEvents(userId, payload);
      }
      if (action === 'updateEvent') {
        return updateCalendarEvent(userId, {
          ...payload,
          eventId: payload.eventId,
        });
      }
      if (action === 'deleteEvent') {
        return deleteCalendarEvent(userId, payload);
      }
      throw new HttpError(400, `Unsupported calendarManager action "${action}".`);
    }
    case 'googleTasksManager': {
      const action = String(payload.action || '').trim();
      if (action === 'createLinkedTask') return createLinkedGoogleTask(userId, payload.taskId);
      if (action === 'updateLinkedTask') return updateLinkedGoogleTask(userId, payload.taskId);
      if (action === 'fetchLinkedTask') return fetchLinkedGoogleTask(userId, payload.taskId);
      if (action === 'disconnectLinkedTask') return disconnectLinkedGoogleTask(userId, payload.taskId);
      if (action === 'createFromCard') return { task: await createReminderFromCard(userId, payload.cardId) };
      if (action === 'createFromChecklist') return { task: await createReminderFromChecklist(userId, payload.cardId, payload.checklistItemId) };
      if (action === 'syncLinkedTasks') return { tasks: await syncLinkedGoogleTasks(userId, payload.taskIds || []) };
      throw new HttpError(400, `Unsupported googleTasksManager action "${action}".`);
    }
    case 'mediaSearch':
      return invokeMediaSearch(userId, payload);
    case 'mediaEnrich':
      return invokeMediaEnrich(userId, payload);
    case 'mediaHealth':
      return {
        media_backend_version: 'media-backend-2026-03-19-v1',
        providers: {
          llm: { status: 'available' },
        },
        functions_version_header: null,
        available: true,
      };
    case 'fetchNewsAPI': {
      const result = await invokeFetchNews(userId, payload);
      return result.data;
    }
    case 'aggregateTrends': {
      const result = await invokeAggregateTrends(userId);
      return result.data;
    }
    case 'fetchPrices':
      return invokeFetchPrices(payload);
    case 'searchStocks':
      return invokeSearchStocks(userId, payload);
    case 'bulkUpdateMediaEntries': {
      const ids = Array.isArray(payload.ids) ? payload.ids : [];
      const update = payload.update && typeof payload.update === 'object' ? payload.update : {};
      const updated = [];
      for (const id of ids) {
        updated.push(await updateCompatEntity(userId, 'MediaEntry', id, update));
      }
      return { updated };
    }
    case 'enrichCreator':
      return invokeEnrichCreator(userId, payload);
    default:
      throw new HttpError(404, `Compat function "${functionName}" is not implemented.`);
  }
}
