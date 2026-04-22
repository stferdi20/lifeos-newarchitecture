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
import {
  enrichMediaCatalog,
  getMediaCatalogHealth,
  searchMediaCatalog,
} from './media-catalog.js';

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

const mediaSearchFallbackSchema = z.object({
  results: z.array(z.object({
    title: z.string(),
    external_id: z.string().default(''),
    poster_url: z.string().default(''),
    studio_author: z.string().default(''),
    year_released: z.number().nullable().default(null),
    year_ended: z.number().nullable().default(null),
    release_status: z.string().default(''),
    genres: z.array(z.string()).default([]),
    plot: z.string().default(''),
    source_url: z.string().default(''),
    media_type: z.string().default(''),
  })).default([]),
});

const mediaEnrichFallbackSchema = z.object({
  poster_url: z.string().default(''),
  studio_author: z.string().default(''),
  genres: z.array(z.string()).default([]),
  cast: z.array(z.string()).default([]),
  plot: z.string().default(''),
  duration: z.string().default(''),
  language: z.string().default(''),
  country: z.string().default(''),
  imdb_rating: z.string().default(''),
  awards: z.string().default(''),
  themes: z.array(z.string()).default([]),
  platforms: z.array(z.string()).default([]),
  page_count: z.number().nullable().default(null),
  seasons_total: z.number().nullable().default(null),
  episodes: z.number().nullable().default(null),
  chapters: z.number().nullable().default(null),
  volumes: z.number().nullable().default(null),
  year_released: z.number().nullable().default(null),
  year_ended: z.number().nullable().default(null),
  release_status: z.string().default(''),
});

const mediaSearchSchema = z.object({
  results: z.array(z.object({
    title: z.string(),
    external_id: z.string().default(''),
    poster_url: z.string().default(''),
    studio_author: z.string().default(''),
    year_released: z.number().nullable().default(null),
    year_ended: z.number().nullable().default(null),
    release_status: z.string().default(''),
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
  year_released: z.number().nullable().default(null),
  year_ended: z.number().nullable().default(null),
  release_status: z.string().default(''),
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

const OUTBOUND_HEADERS = {
  'User-Agent': 'LifeOS/1.0 (+https://lifeos-self-hosted.vercel.app)',
};

const MATCH_CANDIDATE_LIMIT = 8;
const SEARCH_QUERY_LIMIT = 6;
const FALLBACK_AUTO_ACCEPT_THRESHOLD = 0.74;

export function inferResourceType(url = '') {
  const value = String(url || '').toLowerCase();
  if (/github\.com\/[^/]+\/[^/]/.test(value)) return 'github_repo';
  if (value.includes('youtube.com') || value.includes('youtu.be')) return 'youtube';
  if (value.includes('reddit.com')) return 'reddit';
  if (/instagram\.com\/(?:share\/)?(?:reel|tv)\//.test(value)) return 'instagram_reel';
  if (/instagram\.com\/(?:share\/)?p\//.test(value)) return 'instagram_carousel';
  if (/\.pdf(?:$|\?)/.test(value)) return 'pdf';
  if (/arxiv\.org|scholar\.google|doi\.org|pubmed|researchgate|semanticscholar/.test(value)) return 'research_paper';
  if (/bbc\.|cnn\.|reuters\.|nytimes\.|theguardian\.|techcrunch\.|theverge\.|arstechnica\.|wired\.|bloomberg\.|washingtonpost\.|forbes\.|apnews\.|news\./.test(value)) return 'article';
  return 'website';
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeTitle(value) {
  return normalizeTitle(value).split(' ').filter(Boolean);
}

function stripOuterQuotes(value) {
  return String(value || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

function stripTrailingYear(value) {
  return value.replace(/\s*\((?:19|20)\d{2}\)\s*$/i, '').replace(/\s+(?:19|20)\d{2}\s*$/i, '').trim();
}

function stripSeasonMarker(value) {
  return value
    .replace(/\s*[-:|]\s*(?:season|series|book|volume|vol\.?|part)\s+\d+\s*$/i, '')
    .replace(/\s+(?:season|series|book|volume|vol\.?|part)\s+\d+\s*$/i, '')
    .trim();
}

function stripSubtitle(value) {
  return value.split(/\s*[:\-|]\s*/)[0]?.trim() || value.trim();
}

function buildLooseSearchQueries(title) {
  const original = String(title || '').trim();
  const deQuoted = stripOuterQuotes(original);
  const noYear = stripTrailingYear(deQuoted);
  const noSeason = stripSeasonMarker(noYear);
  const noSubtitle = stripSubtitle(noSeason);
  const normalized = normalizeTitle(noSubtitle);
  const tokens = tokenizeTitle(noSubtitle).filter((token) => token !== 'the' && token !== 'a' && token !== 'an');
  const broadQueries = [];

  if (tokens.length >= 2) broadQueries.push(tokens.slice(0, 2).join(' '));
  if (tokens.length >= 1) broadQueries.push(tokens[0]);

  return uniqueNonEmpty([
    original,
    deQuoted,
    noYear,
    noSeason,
    noSubtitle,
    normalized,
    ...broadQueries,
  ]).slice(0, SEARCH_QUERY_LIMIT);
}

function levenshteinDistance(a, b) {
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const temp = previous[column];
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + cost);
      diagonal = temp;
    }
  }
  return previous[b.length];
}

function stringSimilarity(left, right) {
  const a = normalizeTitle(left).replace(/\s+/g, '');
  const b = normalizeTitle(right).replace(/\s+/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(0, 1 - (levenshteinDistance(a, b) / Math.max(a.length, b.length)));
}

function scoreCandidateTitle(inputTitle, candidateTitle) {
  const normalizedInput = normalizeTitle(inputTitle);
  const normalizedCandidate = normalizeTitle(candidateTitle);
  if (!normalizedInput || !normalizedCandidate) return 0;
  if (normalizedInput === normalizedCandidate) return 1;

  const inputTokens = [...new Set(tokenizeTitle(inputTitle))];
  const candidateTokens = [...new Set(tokenizeTitle(candidateTitle))];
  if (inputTokens.length === 0 || candidateTokens.length === 0) return 0;

  const tokenScore = inputTokens.reduce((sum, token) => {
    const best = candidateTokens.reduce((currentBest, candidateToken) => (
      Math.max(currentBest, stringSimilarity(token, candidateToken))
    ), 0);
    return sum + best;
  }, 0) / inputTokens.length;

  const fullScore = stringSimilarity(inputTitle, candidateTitle);
  const prefixBonus = normalizedCandidate.includes(normalizedInput) || normalizedInput.includes(normalizedCandidate) ? 0.12 : 0;

  return Math.min(0.995, (tokenScore * 0.55) + (fullScore * 0.33) + prefixBonus);
}

function chooseFallbackCandidate(inputTitle, candidates) {
  const scored = (candidates || [])
    .map((candidate) => ({
      candidate,
      confidence: scoreCandidateTitle(inputTitle, String(candidate.title || '')),
    }))
    .filter((item) => item.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  if (!best || best.confidence < FALLBACK_AUTO_ACCEPT_THRESHOLD) {
    return null;
  }

  return best;
}

function candidateKey(candidate) {
  return String(candidate.external_id || candidate.source_url || candidate.title || '').trim().toLowerCase();
}

function mergeCandidateResults(resultSets) {
  const merged = [];
  const seen = new Set();

  for (const resultSet of resultSets) {
    for (const candidate of resultSet || []) {
      const key = candidateKey(candidate);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
      if (merged.length >= MATCH_CANDIDATE_LIMIT) {
        return merged;
      }
    }
  }

  return merged;
}

async function inferSearchQueries(userId, params) {
  const prompt = `You are preparing a strict API search query for a media catalog lookup.

Media type: ${params.type}
User input title: "${params.originalTitle}"
Initial raw query: "${params.initialQuery}"

Rules:
- Correct obvious spelling mistakes and punctuation issues.
- Keep the query aligned to the requested media type only.
- Preserve the intended franchise/work title.
- Do not invent a different title if the user's intent is unclear.
- Prefer the most likely canonical title that a public media API would index.
- Return 1 primary search title and up to 2 fallback search titles.
- Keep each search title concise and suitable for an API search box.
- If the input is already good, keep it.

Return valid JSON only with:
- primary_query
- fallback_queries
- reasoning`;

  const result = await routeStructuredJson({
    taskType: 'generic.structured',
    prompt,
    schema: z.object({
      primary_query: z.string().default(params.initialQuery || params.originalTitle),
      fallback_queries: z.array(z.string()).default([]),
      reasoning: z.string().default(''),
    }),
    userId,
    policy: { tier: 'cheap', temperature: 0.1, maxTokens: 500 },
    metadata: { requestSummary: `media-search-plan:${params.type}:${params.originalTitle}` },
  });

  const primaryQuery = String(result.data?.primary_query || params.initialQuery || params.originalTitle || '').trim();
  const fallbackQueries = Array.isArray(result.data?.fallback_queries)
    ? result.data.fallback_queries.map((value) => String(value || '').trim())
    : [];
  const reasoning = String(result.data?.reasoning || '').trim();

  const queries = uniqueNonEmpty([
    primaryQuery,
    ...fallbackQueries,
    params.initialQuery,
    params.originalTitle,
  ]).slice(0, SEARCH_QUERY_LIMIT);

  return {
    primaryQuery: queries[0] || params.initialQuery || params.originalTitle,
    queries,
    reasoning,
  };
}

async function invokeMediaSearchFallback(userId, payload = {}) {
  const type = String(payload.type || 'movie').trim();
  const query = String(payload.query || '').trim();
  const prompt = [
    `Find up to 8 likely ${type} matches for: ${query}`,
    'Return metadata for a personal media tracker.',
    'Each result should include title, external_id, poster_url, studio_author, year_released, genres, plot, source_url, and media_type.',
    'Make external_id stable and prefixed by a provider key such as search:.',
  ].join('\n');

  const result = await routeStructuredJson({
    taskType: 'generic.structured',
    prompt,
    schema: mediaSearchFallbackSchema,
    userId,
    policy: { tier: 'cheap', temperature: 0.2, maxTokens: 1600 },
    metadata: { requestSummary: `media-search-fallback:${type}:${query}` },
    groundWithGoogleSearch: true,
  });

  return result.data;
}

async function invokeMediaEnrichFallback(userId, payload = {}) {
  const type = String(payload.type || 'movie').trim();
  const externalId = String(payload.externalId || '').trim();
  const prompt = [
    `Provide richer metadata for this ${type}: ${externalId}`,
    'Return poster_url, studio_author, genres, cast, plot, duration, language, country, imdb_rating, awards, themes, platforms, page_count, seasons_total, episodes, chapters, and volumes when applicable.',
  ].join('\n');

  const result = await routeStructuredJson({
    taskType: 'generic.structured',
    prompt,
    schema: mediaEnrichFallbackSchema,
    userId,
    policy: { tier: 'cheap', temperature: 0.2, maxTokens: 1400 },
    metadata: { requestSummary: `media-enrich-fallback:${type}:${externalId}` },
    groundWithGoogleSearch: true,
  });

  return result.data;
}

async function resolveMediaMatch(userId, params) {
  const candidates = (params.results || []).slice(0, MATCH_CANDIDATE_LIMIT);

  if (candidates.length === 0) {
    return {
      results: params.results,
      match: null,
      bestCandidate: null,
      matched: false,
      decision: 'no_match',
      confidence: 0,
      reason: params.searchReasoning
        ? `${params.searchReasoning} No API candidates were returned for this title.`
        : 'No API candidates were returned for this title.',
      queryUsed: params.query,
    };
  }

  try {
    const llmPrompt = `You are matching a user-typed media title to one candidate from an API search result list.

Media type: ${params.type}
Original user title: "${params.originalTitle}"
API query used: "${params.query}"
Search reasoning: "${params.searchReasoning || 'No extra search reasoning provided.'}"

Important rules:
- The user title may contain typos, missing punctuation, bad spacing, or small wording mistakes.
- You may only choose from the provided candidates. Never invent a title, id, or URL.
- Prefer exact franchise/title intent over loose semantic similarity, and honor the requested media type strictly.
- Return "no_match" if none of the candidates is clearly the same work for the requested media type.
- If one candidate is clearly the intended title despite minor typos, select it.
- Use the exact external_id from the chosen candidate.

Candidates:
${candidates.map((candidate, index) => (
`${index}: title="${candidate.title || ''}" | year=${candidate.year_released ?? 'unknown'} | external_id=${candidate.external_id || ''} | creator=${candidate.studio_author || ''} | genres=${(candidate.genres || []).join(', ')}`
)).join('\n')}

Return valid JSON only with:
- decision: auto_accept | needs_review | no_match
- selected_external_id
- confidence
- reason`;

    const llmResult = await routeStructuredJson({
      taskType: 'generic.structured',
      prompt: llmPrompt,
      schema: z.object({
        decision: z.enum(['auto_accept', 'needs_review', 'no_match']).default('no_match'),
        selected_external_id: z.string().default(''),
        confidence: z.number().default(0),
        reason: z.string().default(''),
      }),
      userId,
      policy: { tier: 'cheap', temperature: 0.1, maxTokens: 700 },
      metadata: { requestSummary: `media-match:${params.type}:${params.originalTitle}` },
    });

    const selectedExternalId = String(llmResult.data?.selected_external_id || '').trim();
    const selectedCandidate = candidates.find((candidate) => String(candidate.external_id || '').trim() === selectedExternalId) || null;
    const confidence = Number.isFinite(Number(llmResult.data?.confidence)) ? Number(llmResult.data.confidence) : 0;
    const reason = String(llmResult.data?.reason || '').trim() || 'Media AI did not return a usable explanation.';
    const combinedReason = params.searchReasoning ? `${params.searchReasoning} ${reason}`.trim() : reason;

    if (!selectedCandidate || llmResult.data?.decision === 'no_match') {
      const fallbackMatch = chooseFallbackCandidate(params.originalTitle, candidates);
      if (fallbackMatch) {
        return {
          results: params.results,
          match: fallbackMatch.candidate,
          bestCandidate: fallbackMatch.candidate,
          matched: true,
          decision: 'auto_accept',
          confidence: Math.max(confidence, fallbackMatch.confidence),
          reason: `${combinedReason} Deterministic title fallback matched this API candidate.`.trim(),
          queryUsed: params.query,
        };
      }

      return {
        results: params.results,
        match: null,
        bestCandidate: selectedCandidate,
        matched: false,
        decision: 'no_match',
        confidence,
        reason: combinedReason,
        queryUsed: params.query,
      };
    }

    return {
      results: params.results,
      match: selectedCandidate,
      bestCandidate: selectedCandidate,
      matched: true,
      decision: llmResult.data?.decision === 'needs_review' ? 'needs_review' : 'auto_accept',
      confidence,
      reason: combinedReason,
      queryUsed: params.query,
    };
  } catch (error) {
    const fallbackMatch = chooseFallbackCandidate(params.originalTitle, candidates);
    if (fallbackMatch) {
      return {
        results: params.results,
        match: fallbackMatch.candidate,
        bestCandidate: fallbackMatch.candidate,
        matched: true,
        decision: 'auto_accept',
        confidence: fallbackMatch.confidence,
        reason: `AI match resolution failed: ${error instanceof Error ? error.message : String(error)}. Deterministic title fallback matched this API candidate.`,
        queryUsed: params.query,
      };
    }

    return {
      results: params.results,
      match: null,
      bestCandidate: null,
      matched: false,
      decision: 'no_match',
      confidence: 0,
      reason: `AI match resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      queryUsed: params.query,
    };
  }
}

export function normalizeResourceRecord(url, analysis = {}) {
  const normalizedUrl = analysis.url || url;
  return {
    ...analysis,
    title: analysis.title || url,
    author: analysis.author || '',
    url: normalizedUrl,
    source_url: analysis.source_url || normalizedUrl,
    resource_type: analysis.resource_type || inferResourceType(normalizedUrl),
    thumbnail: analysis.thumbnail || '',
    published_date: analysis.published_date || '',
    summary: analysis.summary || '',
    why_it_matters: analysis.why_it_matters || '',
    who_its_for: analysis.who_its_for || '',
    explanation_for_newbies: analysis.explanation_for_newbies || '',
    main_topic: analysis.main_topic || '',
    resource_score: analysis.resource_score || analysis.score || 5,
    tags: analysis.tags || [],
    key_points: analysis.key_points || analysis.insights || [],
    actionable_points: analysis.actionable_points || analysis.actions || [],
    use_cases: analysis.use_cases || [],
    learning_outcomes: analysis.learning_outcomes || [],
    notable_quotes_or_moments: analysis.notable_quotes_or_moments || [],
    content: analysis.content || '',
    content_source: analysis.content_source || '',
    content_language: analysis.content_language || '',
    area_id: analysis.area_id || '',
    area_name: analysis.area_name || '',
    area_needs_review: Boolean(analysis.area_needs_review),
    analysis_version: analysis.analysis_version || '',
    enrichment_status: analysis.enrichment_status || '',
    is_archived: false,
  };
}

function normalizeYear(value) {
  const text = String(value || '');
  const match = text.match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return [];
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseExternalId(externalId = '') {
  return String(externalId || '').split(':');
}

function dedupeByExternalId(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = String(item?.external_id || item?.title || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function cleanWikiMarkup(value = '') {
  return String(value || '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?|''/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWikiInfoboxField(wikitext = '', fieldName) {
  const pattern = new RegExp(`\\|\\s*${fieldName}\\s*=([\\s\\S]*?)(?=\\n\\|\\s*[a-z_]+\\s*=|\\n\\}\\})`, 'i');
  const match = String(wikitext || '').match(pattern);
  return cleanWikiMarkup(match?.[1] || '');
}

async function searchMovieTitles(query) {
  const firstLetter = String(query || '').trim().charAt(0).toLowerCase() || 'a';
  const data = await fetchExternalJson(
    `https://v2.sg.media-imdb.com/suggestion/${encodeURIComponent(firstLetter)}/${encodeURIComponent(query)}.json`,
    { provider: 'IMDb Suggestion', headers: OUTBOUND_HEADERS },
  );

  return toArray(data?.d)
    .filter((entry) => entry?.qid === 'movie' || entry?.q === 'feature')
    .slice(0, 8)
    .map((entry) => ({
    title: entry.l || '',
    external_id: entry.id ? `imdb:movie:${entry.id}` : '',
    poster_url: entry.i?.imageUrl || '',
    studio_author: entry.s || '',
    year_released: Number(entry.y) || null,
    genres: [],
    plot: '',
    source_url: entry.id ? `https://www.imdb.com/title/${entry.id}/` : '',
    media_type: 'movie',
  })).filter((entry) => entry.title);
}

async function searchSeriesTitles(query) {
  const data = await fetchExternalJson(
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
    { provider: 'TVMaze', headers: OUTBOUND_HEADERS },
  );

  return toArray(data).map((entry) => {
    const show = entry?.show || {};
    return {
      title: show.name || '',
      external_id: show.id ? `tvmaze:series:${show.id}` : '',
      poster_url: show.image?.original || show.image?.medium || '',
      studio_author: show.network?.name || show.webChannel?.name || '',
      year_released: normalizeYear(show.premiered),
      year_ended: normalizeYear(show.ended),
      release_status: show.status || '',
      genres: toArray(show.genres),
      plot: String(show.summary || '').replace(/<[^>]+>/g, '').trim(),
      source_url: show.officialSite || show.url || '',
      media_type: 'series',
    };
  }).filter((entry) => entry.title);
}

async function searchJikanTitles(query, type) {
  const endpoint = type === 'anime' ? 'anime' : 'manga';
  const data = await fetchExternalJson(
    `https://api.jikan.moe/v4/${endpoint}?q=${encodeURIComponent(query)}&limit=8`,
    { provider: 'Jikan', headers: OUTBOUND_HEADERS },
  );

  return toArray(data?.data).map((entry) => ({
    title: entry.title || entry.title_english || '',
    external_id: entry.mal_id ? `jikan:${type}:${entry.mal_id}` : '',
    poster_url: entry.images?.jpg?.large_image_url || entry.images?.jpg?.image_url || '',
    studio_author: type === 'anime'
      ? toArray(entry.studios).map((studio) => studio?.name).filter(Boolean).join(', ')
      : toArray(entry.authors).map((author) => author?.name).filter(Boolean).join(', '),
    year_released: normalizeYear(entry.year || entry.published?.from || entry.aired?.from),
    year_ended: normalizeYear(entry.published?.to || entry.aired?.to),
    release_status: entry.status || '',
    genres: toArray(entry.genres).map((genre) => genre?.name).filter(Boolean),
    plot: entry.synopsis || '',
    source_url: entry.url || '',
    media_type: type,
  })).filter((entry) => entry.title);
}

async function searchOpenLibraryTitles(query, type) {
  const data = await fetchExternalJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=8`,
    { provider: 'Open Library', headers: OUTBOUND_HEADERS },
  );

  return toArray(data?.docs).map((entry) => ({
    title: entry.title || '',
    external_id: entry.key ? `openlibrary:${type}:${entry.key}` : '',
    poster_url: entry.cover_i ? `https://covers.openlibrary.org/b/id/${entry.cover_i}-L.jpg` : '',
    studio_author: toArray(entry.author_name).join(', '),
    year_released: Number(entry.first_publish_year) || null,
    genres: toArray(entry.subject).slice(0, 5),
    plot: entry.first_sentence?.[0] || '',
    source_url: entry.key ? `https://openlibrary.org${entry.key}` : '',
    media_type: type,
  })).filter((entry) => entry.title);
}

async function searchGameTitles(query) {
  const data = await fetchExternalJson(
    `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(query)}&limit=8`,
    { provider: 'CheapShark', headers: OUTBOUND_HEADERS },
  );

  const cheapSharkResults = toArray(data).map((entry) => ({
    title: entry.external || entry.internalName || '',
    external_id: entry.gameID ? `cheapshark:game:${entry.gameID}:${entry.steamAppID || ''}` : '',
    poster_url: entry.thumb || '',
    studio_author: '',
    year_released: null,
    genres: [],
    plot: '',
    source_url: entry.gameID ? `https://www.cheapshark.com/redirect?dealID=${entry.cheapestDealID || ''}` : '',
    media_type: 'game',
  })).filter((entry) => entry.title);

  if (cheapSharkResults.length >= 4) {
    return cheapSharkResults;
  }

  const wikiSearch = await fetchExternalJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${query} video game`)}&format=json&origin=*`,
    { provider: 'Wikipedia', headers: OUTBOUND_HEADERS },
  ).catch(() => ({ query: { search: [] } }));

  const wikiResults = await Promise.all(
    toArray(wikiSearch?.query?.search)
      .slice(0, 5)
      .map(async (entry) => {
        const title = String(entry?.title || '').trim();
        if (!title) return null;
        try {
          const summary = await fetchExternalJson(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
            { provider: 'Wikipedia', headers: OUTBOUND_HEADERS },
          );
          const description = String(summary?.description || '').toLowerCase();
          const looksLikeGame = /video game|digital collectible card game|turn-based strategy|action-adventure/i.test(description)
            || /video game|game/i.test(String(entry?.snippet || ''));
          if (!looksLikeGame) return null;
          return {
            title: summary?.title || title,
            external_id: `wikipedia:game:${encodeURIComponent(summary?.title || title)}`,
            poster_url: summary?.thumbnail?.source || '',
            studio_author: '',
            year_released: normalizeYear(summary?.description || summary?.extract || ''),
            genres: [],
            plot: summary?.extract || '',
            source_url: summary?.content_urls?.desktop?.page || '',
            media_type: 'game',
          };
        } catch {
          return null;
        }
      }),
  );

  return dedupeByExternalId([...cheapSharkResults, ...wikiResults.filter(Boolean)]).slice(0, 8);
}

async function searchDirectMediaTitles(type, query) {
  if (type === 'movie') return searchMovieTitles(query);
  if (type === 'series') return searchSeriesTitles(query);
  if (type === 'anime' || type === 'manga') return searchJikanTitles(query, type);
  if (type === 'book' || type === 'comic') return searchOpenLibraryTitles(query, type);
  if (type === 'game') return searchGameTitles(query);
  return [];
}

async function enrichCinemeta(imdbId, mediaType) {
  const resourceType = mediaType === 'series' ? 'series' : 'movie';
  const data = await fetchExternalJson(
    `https://v3-cinemeta.strem.io/meta/${resourceType}/${encodeURIComponent(imdbId)}.json`,
    { provider: 'Cinemeta', headers: OUTBOUND_HEADERS },
  );

  const meta = data?.meta;
  if (!meta) return {};

  return {
    poster_url: meta.poster || '',
    studio_author: toArray(meta.director).join(', '),
    genres: toArray(meta.genre),
    cast: toArray(meta.cast),
    plot: meta.description || '',
    duration: meta.runtime || '',
    language: meta.language || '',
    country: meta.country || '',
    imdb_rating: meta.imdbRating ? `${meta.imdbRating}/10` : '',
    awards: meta.awards || '',
    themes: toArray(meta.genre).slice(0, 6),
    seasons_total: mediaType === 'series' ? Number(meta.videos?.length || 0) || null : null,
    source_url: imdbId ? `https://www.imdb.com/title/${imdbId}/` : '',
    year_released: normalizeYear(meta.releaseInfo || meta.year),
  };
}

async function enrichTvMaze(seriesId) {
  const data = await fetchExternalJson(
    `https://api.tvmaze.com/shows/${encodeURIComponent(seriesId)}`,
    { provider: 'TVMaze', headers: OUTBOUND_HEADERS },
  );

  return {
    poster_url: data.image?.original || data.image?.medium || '',
    studio_author: data.network?.name || data.webChannel?.name || '',
    genres: toArray(data.genres),
    plot: stripHtml(data.summary || ''),
    language: data.language || '',
    country: data.network?.country?.name || data.webChannel?.country?.name || '',
    seasons_total: Number.isFinite(Number(data._embedded?.seasons?.length)) ? Number(data._embedded.seasons.length) : null,
    source_url: data.officialSite || data.url || '',
    year_released: normalizeYear(data.premiered),
    year_ended: normalizeYear(data.ended),
    release_status: data.status || '',
  };
}

async function enrichJikanDetail(id, mediaType) {
  const endpoint = mediaType === 'manga' ? 'manga' : 'anime';
  const data = await fetchExternalJson(
    `https://api.jikan.moe/v4/${endpoint}/${encodeURIComponent(id)}/full`,
    { provider: 'Jikan', headers: OUTBOUND_HEADERS },
  );
  const item = data?.data;
  if (!item) return {};

  return {
    poster_url: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '',
    studio_author: mediaType === 'anime'
      ? toArray(item.studios).map((entry) => entry?.name).filter(Boolean).join(', ')
      : toArray(item.authors).map((entry) => entry?.name).filter(Boolean).join(', '),
    genres: toArray(item.genres).map((entry) => entry?.name).filter(Boolean),
    cast: [],
    plot: item.synopsis || '',
    duration: mediaType === 'anime' ? (item.duration || '') : '',
    language: '',
    country: item.demographics?.[0]?.name || '',
    imdb_rating: item.score ? `${item.score}/10` : '',
    awards: '',
    themes: toArray(item.themes).map((entry) => entry?.name).filter(Boolean),
    episodes: mediaType === 'anime' ? item.episodes || null : null,
    chapters: mediaType === 'manga' ? item.chapters || null : null,
    volumes: mediaType === 'manga' ? item.volumes || null : null,
    source_url: item.url || '',
    year_released: normalizeYear(item.year || item.aired?.from || item.published?.from),
    year_ended: normalizeYear(item.aired?.to || item.published?.to),
    release_status: item.status || '',
  };
}

function pickPageCount(editions = []) {
  for (const edition of editions) {
    const pages = Number(edition?.number_of_pages || 0);
    if (pages > 0) return pages;
    const paginationMatch = String(edition?.pagination || '').match(/\d+/);
    if (paginationMatch) return Number(paginationMatch[0]);
  }
  return null;
}

async function enrichOpenLibraryDetail(externalId) {
  const [, , workKeyRaw] = parseExternalId(externalId);
  const workKey = String(workKeyRaw || '').trim();
  const workPath = workKey.startsWith('/works/') ? workKey : `/works/${workKey.replace(/^\/+/, '')}`;
  const work = await fetchExternalJson(
    `https://openlibrary.org${workPath}.json`,
    { provider: 'Open Library', headers: OUTBOUND_HEADERS },
  );
  const editions = await fetchExternalJson(
    `https://openlibrary.org${workPath}/editions.json?limit=10`,
    { provider: 'Open Library', headers: OUTBOUND_HEADERS },
  ).catch(() => ({ entries: [] }));

  const authorNames = await Promise.all(
    toArray(work?.authors)
      .map((entry) => String(entry?.author?.key || '').trim())
      .filter(Boolean)
      .slice(0, 4)
      .map(async (key) => {
        try {
          const author = await fetchExternalJson(`https://openlibrary.org${key}.json`, {
            provider: 'Open Library',
            headers: OUTBOUND_HEADERS,
          });
          return author?.name || null;
        } catch {
          return null;
        }
      }),
  );

  return {
    poster_url: toArray(work?.covers)[0] ? `https://covers.openlibrary.org/b/id/${work.covers[0]}-L.jpg` : '',
    studio_author: authorNames.filter(Boolean).join(', '),
    genres: toArray(work?.subjects).slice(0, 8),
    plot: typeof work?.description === 'string' ? work.description : work?.description?.value || '',
    page_count: pickPageCount(toArray(editions?.entries)),
    language: '',
    themes: toArray(work?.subject_places).slice(0, 6),
    source_url: `https://openlibrary.org${workPath}`,
    year_released: normalizeYear(work?.first_publish_date),
  };
}

async function enrichSteamGame(externalId) {
  const [, , , steamAppId] = parseExternalId(externalId);
  if (!steamAppId) return {};

  const data = await fetchExternalJson(
    `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(steamAppId)}`,
    { provider: 'Steam', headers: OUTBOUND_HEADERS },
  );
  const app = data?.[steamAppId]?.data;
  if (!app) return {};

  return {
    poster_url: app.header_image || '',
    studio_author: toArray(app.developers).join(', '),
    genres: toArray(app.genres).map((entry) => entry?.description).filter(Boolean),
    plot: stripHtml(app.short_description || app.detailed_description || ''),
    platforms: Object.entries(app.platforms || {})
      .filter(([, supported]) => supported)
      .map(([platform]) => platform),
    language: app.supported_languages ? stripHtml(app.supported_languages).slice(0, 200) : '',
    source_url: `https://store.steampowered.com/app/${steamAppId}`,
    year_released: normalizeYear(app.release_date?.date),
  };
}

async function enrichWikipediaGame(externalId) {
  const [, , encodedTitle] = parseExternalId(externalId);
  const pageTitle = decodeURIComponent(String(encodedTitle || '').trim());
  if (!pageTitle) return {};

  const [summary, parseData] = await Promise.all([
    fetchExternalJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`,
      { provider: 'Wikipedia', headers: OUTBOUND_HEADERS },
    ),
    fetchExternalJson(
      `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&format=json&origin=*`,
      { provider: 'Wikipedia', headers: OUTBOUND_HEADERS },
    ).catch(() => ({ parse: { wikitext: { '*': '' } } })),
  ]);

  const wikitext = String(parseData?.parse?.wikitext?.['*'] || '');
  const developer = parseWikiInfoboxField(wikitext, 'developer');
  const genre = parseWikiInfoboxField(wikitext, 'genre');
  const platforms = parseWikiInfoboxField(wikitext, 'platforms')
    .split(/\s*,\s*|\s*<br ?\/?>\s*/i)
    .map((value) => cleanWikiMarkup(value))
    .filter(Boolean);
  const release = parseWikiInfoboxField(wikitext, 'released');

  return {
    poster_url: summary?.thumbnail?.source || '',
    studio_author: developer || '',
    genres: genre
      .split(/\s*,\s*|\s*<br ?\/?>\s*/i)
      .map((value) => cleanWikiMarkup(value))
      .filter(Boolean),
    plot: summary?.extract || '',
    platforms,
    source_url: summary?.content_urls?.desktop?.page || '',
    year_released: normalizeYear(release || summary?.description || summary?.extract || ''),
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
  if (!payload.resolveMatch) {
    try {
      const providerResults = await searchMediaCatalog(query, type);
      if (providerResults.length) return { results: providerResults };
    } catch {
      // Fall through to legacy provider fallback below.
    }

    try {
      const directResults = await searchDirectMediaTitles(type, query);
      if (directResults.length) return { results: directResults };
    } catch {
      // Fall through to Gemini fallback below.
    }

    return { results: (await invokeMediaSearchFallback(userId, payload)).results || [] };
  }

  const originalTitle = String(payload.originalTitle || query || '').trim();

  try {
    const searchPlan = await inferSearchQueries(userId, {
      type,
      originalTitle,
      initialQuery: query,
    });
    const localFallbackQueries = buildLooseSearchQueries(originalTitle);
    const resultSets = await Promise.all(
      uniqueNonEmpty([...searchPlan.queries, ...localFallbackQueries])
        .slice(0, SEARCH_QUERY_LIMIT)
        .map(async (searchQuery) => {
          try {
            const providerResults = await searchMediaCatalog(searchQuery, type);
            if (providerResults.length) return providerResults;
          } catch {
            // Fall back to legacy direct provider helpers for this query.
          }

          try {
            return await searchDirectMediaTitles(type, searchQuery);
          } catch {
            return [];
          }
        }),
    );
    const results = mergeCandidateResults(resultSets);
    return resolveMediaMatch(userId, {
      type,
      query: searchPlan.primaryQuery,
      originalTitle,
      results,
      searchReasoning: searchPlan.reasoning,
    });
  } catch (error) {
    let results = [];
    try {
      results = await searchMediaCatalog(query, type);
    } catch {
      try {
        results = await searchDirectMediaTitles(type, query);
      } catch {
        results = (await invokeMediaSearchFallback(userId, payload)).results || [];
      }
    }
    return {
      results,
      match: null,
      bestCandidate: null,
      matched: false,
      decision: 'no_match',
      confidence: 0,
      reason: `Media match lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      queryUsed: query,
    };
  }
}

async function invokeMediaEnrich(userId, payload = {}) {
  const type = String(payload.type || 'movie').trim();
  const externalId = String(payload.externalId || '').trim();
  if (!externalId) return {};

  try {
    return await enrichMediaCatalog(externalId, type);
  } catch {
    // Fall through to legacy provider enrichers below.
  }
  try {
    if (externalId.startsWith('imdb:movie:')) {
      const [, , imdbId] = parseExternalId(externalId);
      return enrichCinemeta(imdbId, 'movie');
    }
    if (externalId.startsWith('tvmaze:series:')) {
      const [, , seriesId] = parseExternalId(externalId);
      return enrichTvMaze(seriesId);
    }
    if (externalId.startsWith('jikan:anime:')) {
      const [, , id] = parseExternalId(externalId);
      return enrichJikanDetail(id, 'anime');
    }
    if (externalId.startsWith('jikan:manga:')) {
      const [, , id] = parseExternalId(externalId);
      return enrichJikanDetail(id, 'manga');
    }
    if (externalId.startsWith('openlibrary:book:') || externalId.startsWith('openlibrary:comic:')) {
      return enrichOpenLibraryDetail(externalId);
    }
    if (externalId.startsWith('cheapshark:game:')) {
      return enrichSteamGame(externalId);
    }
    if (externalId.startsWith('wikipedia:game:')) {
      return enrichWikipediaGame(externalId);
    }
  } catch {
    // Fall through to Gemini fallback below.
  }

  return invokeMediaEnrichFallback(userId, payload);
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

  let analyzed;
  let fallbackError = null;

  try {
    analyzed = await analyzeResource({
      url,
      title: payload.title || '',
      content: payload.content || '',
      userId,
    });
  } catch (error) {
    fallbackError = error;
    analyzed = {
      data: {
        title: payload.title || url,
        summary: '',
        main_topic: '',
        score: 5,
        tags: [],
        insights: [],
        actions: [],
      },
      provider: 'metadata_fallback',
      model: null,
    };
  }

  const resource = await createCompatEntity(
    userId,
    'Resource',
    normalizeResourceRecord(url, analyzed.data),
  );

  let finalResource = resource;
  if (resource?.resource_type === 'youtube' && resource?.content_source !== 'youtube_transcript') {
    try {
      const { maybeQueueYouTubeTranscriptJobForResource } = await import('./instagram-download-queue.js');
      finalResource = await maybeQueueYouTubeTranscriptJobForResource(userId, resource);
    } catch {
      finalResource = resource;
    }
  }

  if (payload.project_id) {
    await createCompatEntity(userId, 'ProjectResource', {
      project_id: payload.project_id,
      resource_id: finalResource.id,
      created_date: new Date().toISOString(),
    });
  }

  return {
    resource: finalResource,
    analysis: analyzed.data,
    provider: analyzed.provider,
    model: analyzed.model,
    fallbackError: fallbackError?.message || null,
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
      return getMediaCatalogHealth();
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
