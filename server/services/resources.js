import { parseHTML } from 'linkedom';
import { z } from 'zod';
import { routeStructuredJson } from '../lib/llm-router.js';
import { listCompatEntities, updateCompatEntity } from './compat-store.js';

const ANALYSIS_VERSION = 'resource-enrichment-v6';
const USER_AGENT = 'LifeOS/1.0 (+https://lifeos-self-hosted.vercel.app)';
const MAX_STORED_CONTENT_CHARS = 60000;
const MAX_PROMPT_CONTENT_CHARS = 16000;
const MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
const DEFAULT_TRANSCRIPTION_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const HAS_SCHEME_RE = /^[a-z][a-z\d+\-.]*:\/\//i;
const DOMAIN_LIKE_RE = /^(localhost(?::\d+)?|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?:[/:?#].*)?$/iu;

const resourceSchema = z.object({
  title: z.string().default(''),
  author: z.string().default(''),
  published_date: z.string().default(''),
  thumbnail: z.string().default(''),
  summary: z.string().default(''),
  why_it_matters: z.string().default(''),
  who_its_for: z.string().default(''),
  explanation_for_newbies: z.string().default(''),
  main_topic: z.string().default(''),
  area_name: z.string().default(''),
  score: z.number().min(1).max(10).default(5),
  tags: z.array(z.string()).default([]),
  key_points: z.array(z.string()).default([]),
  actionable_points: z.array(z.string()).default([]),
  use_cases: z.array(z.string()).default([]),
  learning_outcomes: z.array(z.string()).default([]),
  notable_quotes_or_moments: z.array(z.string()).default([]),
  reddit_thread_type: z.string().default(''),
  reddit_top_comment_summaries: z.array(z.string()).default([]),
  status: z.string().default('unknown'),
});

const areaClassificationSchema = z.object({
  area_name: z.string().default(''),
});

function stripText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLongText(value, limit = MAX_STORED_CONTENT_CHARS) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function splitSentences(value, limit = 10) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24)
    .slice(0, limit);
}

function dedupeStrings(values = [], limit = 8) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = stripText(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeStringArray(values, limit = 8, itemLimit = 280) {
  return dedupeStrings(
    Array.isArray(values)
      ? values.map((value) => String(value || '').slice(0, itemLimit))
      : [],
    limit,
  );
}

function summarizeText(value, sentenceCount = 2) {
  return splitSentences(value, sentenceCount).join(' ');
}

function countMatches(value, pattern) {
  return (String(value || '').match(pattern) || []).length;
}

function pickActionablePoints(value) {
  const candidates = splitSentences(value, 12).filter((sentence) =>
    /(?:how to|step|try|use|build|create|start|improve|avoid|remember|learn|focus|watch|read|practice|implement)/i.test(sentence),
  );
  return dedupeStrings(candidates, 4);
}

function pickKeyPoints(value) {
  return dedupeStrings(splitSentences(value, 10), 5);
}

function deriveTags({ title = '', author = '', keywords = [], metaKeywords = '', resourceType = '', text = '' }) {
  const pools = [
    ...keywords,
    ...String(metaKeywords || '').split(','),
    ...String(title || '').split(/[\s:|,-]+/),
    ...String(author || '').split(/[\s,]+/),
    ...String(text || '').split(/[\s:|,-]+/).slice(0, 80),
  ];

  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'about',
    'video', 'youtube', 'watch', 'official', 'feat', 'ft', 'how', 'what', 'why',
    'when', 'where', 'have', 'has', 'will', 'you', 'they', 'their', 'just',
  ]);

  const tags = [];
  const seen = new Set();

  if (resourceType) {
    tags.push(resourceType);
    seen.add(resourceType.toLowerCase());
  }

  for (const pool of pools) {
    const cleaned = String(pool || '')
      .toLowerCase()
      .replace(/[^a-z0-9+.#/-]+/g, ' ')
      .trim();
    if (!cleaned) continue;
    const normalized = cleaned.replace(/\s+/g, '-');
    if (normalized.length < 3 || normalized.length > 32) continue;
    if (stopWords.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(normalized);
    if (tags.length >= 8) break;
  }

  return tags;
}

function deriveMainTopic({ title = '', keywords = [], metaKeywords = '' }) {
  const firstKeyword = dedupeStrings([
    ...keywords,
    ...String(metaKeywords || '').split(','),
  ], 1)[0];
  if (firstKeyword) return firstKeyword;

  const cleanedTitle = stripText(title)
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*[-|:]\s*.*/g, '')
    .trim();
  return cleanedTitle.split(/\s+/).slice(0, 5).join(' ');
}

function deriveAudience({ resourceType = '', text = '' }) {
  if (resourceType === 'youtube') return 'People who prefer learning from video explanations or creator breakdowns.';
  if (resourceType === 'research_paper') return 'People doing deeper research who want stronger evidence before acting.';
  if (resourceType === 'github_repo') return 'Builders who want something practical they can explore or reuse.';
  if (/beginner|intro|basics|101/i.test(text)) return 'Beginners who want a practical introduction without too much jargon.';
  if (/advanced|deep dive|architecture|internals/i.test(text)) return 'Intermediate to advanced readers looking for deeper understanding.';
  return 'People collecting practical references they can revisit later.';
}

function deriveWhyItMatters({ summary = '', resourceType = '' }) {
  if (summary) {
    return resourceType === 'youtube'
      ? `Useful because it turns a video explanation into notes you can scan later. ${summary}`
      : `Useful because it compresses the source into fast, reusable notes. ${summary}`;
  }
  return resourceType === 'youtube'
    ? 'Useful because it preserves the main ideas from the video in a form that is easier to skim later.'
    : 'Useful because it captures the main ideas from the source in a format that is easier to revisit later.';
}

function deriveNewbieExplanation({ summary = '', resourceType = '', title = '' }) {
  if (/tutorial|guide|explained|beginner|basics/i.test(`${title} ${summary}`)) {
    return summary || '';
  }
  if (resourceType === 'research_paper') {
    return 'This is a deeper source, so the summary and key points are the easiest place to start if you are new to the topic.';
  }
  return '';
}

function deriveUseCases({ resourceType = '', mainTopic = '', actionablePoints = [] }) {
  const topic = mainTopic || 'this topic';
  const base = [
    `Revisit this when you need a quick refresher on ${topic}.`,
    `Use this as a reference before making a decision related to ${topic}.`,
  ];
  if (resourceType === 'youtube') {
    base.unshift('Revisit this when you want the video insights without rewatching the full clip.');
  }
  if (actionablePoints.length) {
    base.push('Use the action items as a shortlist for your next implementation or research session.');
  }
  return dedupeStrings(base, 4);
}

function isGenericYoutubePlaceholder(value = '') {
  const normalized = stripText(value).toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('enjoy the videos and music you love')
    || normalized.includes('share it all with friends, family, and the world on youtube')
    || normalized.includes('aboutpresscopyrightcontact uscreatorsadvertisedeveloperstermsprivacy')
    || normalized === 'youtube'
  );
}

function buildHeuristicResourceData({ extracted, title, url }) {
  const combinedText = normalizeLongText([
    extracted.description || '',
    extracted.content || '',
  ].filter(Boolean).join('\n\n'), 16000);
  const isYoutubeMetadataOnly = extracted.resourceType === 'youtube' && extracted.contentSource === 'metadata_only';
  const summary = summarizeText(combinedText, 2) || extracted.description || '';
  const keyPoints = pickKeyPoints(combinedText || extracted.description || '');
  const actionablePoints = pickActionablePoints(combinedText || extracted.description || '');
  const mainTopic = deriveMainTopic({
    title: extracted.title || title || url,
    keywords: extracted.keywords || [],
    metaKeywords: extracted.meta?.keywords || '',
  });
  const tags = deriveTags({
    title: extracted.title || title || url,
    author: extracted.author || '',
    keywords: extracted.keywords || [],
    metaKeywords: extracted.meta?.keywords || '',
    resourceType: extracted.resourceType,
    text: combinedText,
  });
  const score = extracted.content
    ? (extracted.content.length > 1500 ? 8 : 7)
    : extracted.description
      ? 6
      : 5;

  const redditCommentSummaries = normalizeStringArray(
    extracted.redditThreadData?.topComments?.map((comment) => comment.body) || [],
    5,
    240,
  );

  return {
    title: extracted.title || title || url,
    author: extracted.author || '',
    published_date: extracted.publishedDate || '',
    thumbnail: extracted.thumbnail || '',
    summary: isYoutubeMetadataOnly ? '' : summary,
    why_it_matters: deriveWhyItMatters({ summary, resourceType: extracted.resourceType }),
    who_its_for: deriveAudience({ resourceType: extracted.resourceType, text: combinedText || extracted.description || '' }),
    explanation_for_newbies: deriveNewbieExplanation({
      summary,
      resourceType: extracted.resourceType,
      title: extracted.title || title || url,
    }),
    main_topic: mainTopic,
    score,
    tags,
    key_points: isYoutubeMetadataOnly ? [] : keyPoints,
    actionable_points: isYoutubeMetadataOnly ? [] : actionablePoints,
    use_cases: isYoutubeMetadataOnly ? [] : deriveUseCases({ resourceType: extracted.resourceType, mainTopic, actionablePoints }),
    learning_outcomes: [],
    notable_quotes_or_moments: [],
    reddit_thread_type: extracted.isRedditThread ? 'discussion' : '',
    reddit_top_comment_summaries: redditCommentSummaries,
    status: extracted.resourceType === 'github_repo' || extracted.resourceType === 'website' ? 'unknown' : '',
    area_name: '',
  };
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeResourceUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  if (isValidHttpUrl(trimmed)) return trimmed;
  if (HAS_SCHEME_RE.test(trimmed)) return trimmed;
  if (!DOMAIN_LIKE_RE.test(trimmed) || /\s/.test(trimmed)) return trimmed;
  const normalized = `https://${trimmed}`;
  return isValidHttpUrl(normalized) ? normalized : trimmed;
}

function isInstagramUrl(url = '') {
  return /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:(?:share\/)?(?:reel|p|tv))\//i.test(url);
}

function isInstagramShareUrl(url = '') {
  return /(?:https?:\/\/)?(?:www\.)?instagram\.com\/share\/(?:reel|p)\//i.test(url);
}

function normalizeInstagramUrl(url = '') {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function extractCanonicalInstagramPostUrl(value = '') {
  const match = String(value || '').match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[^/?#]+/i);
  return match ? normalizeInstagramUrl(match[0]) : '';
}

function parseInstagramShortcode(url = '') {
  const match = String(url || '').match(/instagram\.com\/(?:(?:share\/)?(?:reel|p|tv))\/([^/?#]+)/i);
  return match?.[1] || '';
}

function detectInstagramPostKind(url = '') {
  if (/instagram\.com\/(?:share\/)?(?:reel|tv)\//i.test(url)) return 'instagram_reel';
  if (/instagram\.com\/(?:share\/)?p\//i.test(url)) return 'instagram_carousel';
  return null;
}

async function resolveInstagramCanonicalUrl(url) {
  const normalizedInput = normalizeInstagramUrl(url);
  if (!isInstagramUrl(normalizedInput)) return normalizedInput;
  if (!isInstagramShareUrl(normalizedInput)) return normalizedInput;

  try {
    const res = await fetch(normalizedInput, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const redirectedUrl = extractCanonicalInstagramPostUrl(res.url);
    if (redirectedUrl) return redirectedUrl;
    const html = await res.text().catch(() => '');
    return extractCanonicalInstagramPostUrl(html) || normalizedInput;
  } catch {
    return normalizedInput;
  }
}

export function inferResourceType(url = '') {
  const normalized = normalizeResourceUrl(url);
  const lowerUrl = String(normalized || '').toLowerCase();
  if (/github\.com\/[^/]+\/[^/]/.test(lowerUrl)) return 'github_repo';
  if (/youtube\.com|youtu\.be/.test(lowerUrl)) return 'youtube';
  if (/reddit\.com/.test(lowerUrl)) return 'reddit';
  const instagramType = detectInstagramPostKind(lowerUrl);
  if (instagramType) return instagramType;
  if (/arxiv\.org|scholar\.google|doi\.org|pubmed|researchgate|semanticscholar/.test(lowerUrl)) return 'research_paper';
  if (/\.pdf(?:$|\?)/i.test(lowerUrl)) return 'pdf';
  if (/bbc\.|cnn\.|reuters\.|nytimes\.|theguardian\.|techcrunch\.|theverge\.|arstechnica\.|wired\.|bloomberg\.|washingtonpost\.|forbes\.|apnews\.|news\./i.test(lowerUrl)) {
    return 'article';
  }
  return 'website';
}

function extractMeta(document) {
  const meta = {};
  const tags = document.querySelectorAll('meta');
  for (const tag of tags) {
    const key = tag.getAttribute('property') || tag.getAttribute('name') || '';
    const value = tag.getAttribute('content') || '';
    if (key && value) meta[String(key).toLowerCase()] = value;
  }
  return meta;
}

function extractJsonLd(document) {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const results = [];
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      if (Array.isArray(data)) results.push(...data);
      else results.push(data);
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return results;
}

function summarizeJsonLd(jsonLdItems = []) {
  if (!jsonLdItems.length) return '';
  const lines = [];
  for (const item of jsonLdItems.slice(0, 3)) {
    const type = item?.['@type'] || 'Unknown';
    lines.push(`Schema.org Type: ${Array.isArray(type) ? type.join(', ') : type}`);
    if (item?.name) lines.push(`Name: ${item.name}`);
    if (item?.headline) lines.push(`Headline: ${item.headline}`);
    if (item?.description) lines.push(`Description: ${String(item.description).slice(0, 280)}`);
    if (item?.author) {
      const author = typeof item.author === 'string' ? item.author : (item.author?.name || '');
      if (author) lines.push(`Author: ${author}`);
    }
    if (item?.publisher?.name) lines.push(`Publisher: ${item.publisher.name}`);
    if (item?.datePublished) lines.push(`Published: ${item.datePublished}`);
  }
  return lines.join('\n');
}

function extractJsonLdImage(jsonLdItems = []) {
  for (const item of jsonLdItems) {
    if (typeof item?.image === 'string') return item.image;
    if (item?.image?.url) return item.image.url;
    if (Array.isArray(item?.image) && item.image[0]) {
      return typeof item.image[0] === 'string' ? item.image[0] : item.image[0]?.url || '';
    }
    if (item?.thumbnailUrl) return item.thumbnailUrl;
  }
  return '';
}

function extractMainText(document) {
  const removable = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe', 'svg'];
  for (const tag of removable) {
    const els = document.querySelectorAll(tag);
    for (const el of els) el.remove();
  }

  const candidates = [
    document.querySelector('main article'),
    document.querySelector('article'),
    document.querySelector('main'),
    document.querySelector('[role="main"]'),
    document.querySelector('body'),
  ].filter(Boolean);

  return candidates
    .map((candidate) => normalizeLongText(candidate?.textContent || '', 25000))
    .sort((a, b) => b.length - a.length)[0] || '';
}

function buildMetadataFallbackContent({ title = '', description = '', jsonLdSummary = '' }) {
  return normalizeLongText(
    [
      title ? `Title: ${title}` : '',
      description ? `Description: ${description}` : '',
      jsonLdSummary ? `Structured data:\n${jsonLdSummary}` : '',
    ].filter(Boolean).join('\n\n'),
    12000,
  );
}

function looksLikeLowQualityHtmlText(text = '') {
  const normalized = stripText(text);
  if (!normalized) return true;

  const lower = normalized.toLowerCase();
  const boilerplateSignals = [
    /skip to main/,
    /privacy policy/,
    /terms of service/,
    /cookie policy/,
    /staff picks/,
    /top posts/,
    /trending categories/,
    /create a group/,
    /no posts found with the given criteria/,
    /sign in|log in|sign up/,
    /download app/,
  ].filter((pattern) => pattern.test(lower)).length;

  const camelCaseTransitions = countMatches(normalized, /[a-z][A-Z]/g);
  const punctuationCount = countMatches(normalized, /[.!?]/g);
  const sentenceLikeSegments = splitSentences(normalized, 20).length;
  const repeatedPromo = countMatches(lower, /generate|preview|staff picks|top posts|trending|groups for you/gi);

  if (boilerplateSignals >= 2) return true;
  if (camelCaseTransitions >= 10 && punctuationCount <= 4) return true;
  if (repeatedPromo >= 6 && punctuationCount <= 6) return true;
  if (normalized.length > 700 && sentenceLikeSegments <= 2) return true;

  return false;
}

function extractYoutubeVideoId(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    if (hostname === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (parsed.searchParams.get('v')) return parsed.searchParams.get('v') || '';
    const shorts = parsed.pathname.match(/\/shorts\/([^/?]+)/);
    if (shorts) return shorts[1];
  } catch {
    // ignore
  }
  const match = String(url).match(/(?:v=|youtu\.be\/|\/shorts\/)([^&?/]+)/);
  return match?.[1] || '';
}

function extractPlayerResponseFromHtml(html) {
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.*?\})\s*;/s,
    /"ytInitialPlayerResponse"\s*:\s*(\{.*?\})\s*,\s*"ytInitialData"/s,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      return JSON.parse(match[1]);
    } catch {
      // continue
    }
  }
  return null;
}

function extractInitialDataFromHtml(html) {
  const patterns = [
    /var\s+ytInitialData\s*=\s*(\{.*?\})\s*;/s,
    /"ytInitialData"\s*:\s*(\{.*?\})\s*,\s*"(?:responseContext|trackingParams)"/s,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      return JSON.parse(match[1]);
    } catch {
      // continue
    }
  }
  return null;
}

function findObjectsDeep(value, predicate, results = []) {
  if (!value || typeof value !== 'object') return results;
  if (predicate(value)) results.push(value);
  if (Array.isArray(value)) {
    for (const item of value) findObjectsDeep(item, predicate, results);
    return results;
  }
  for (const nested of Object.values(value)) {
    findObjectsDeep(nested, predicate, results);
  }
  return results;
}

function extractTextRuns(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value?.runs)) {
    return value.runs.map((run) => String(run?.text || '')).join('').trim();
  }
  if (typeof value?.simpleText === 'string') return value.simpleText.trim();
  return '';
}

function extractTranscriptTextFromEvents(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const parts = [];
  for (const event of events) {
    const segs = Array.isArray(event?.segs) ? event.segs : [];
    const text = segs.map((seg) => String(seg?.utf8 || '')).join('').replace(/\n/g, ' ').trim();
    if (text) parts.push(text);
  }
  return normalizeLongText(parts.join(' '), MAX_STORED_CONTENT_CHARS);
}

async function fetchYoutubeTranscriptFromWatchPage(normalizedUrl, html) {
  const playerResponse = extractPlayerResponseFromHtml(html);
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return { transcript: '', language: '' };
  }

  const selectedTrack = [...tracks].sort((a, b) => {
    const aGenerated = a?.kind === 'asr' ? 1 : 0;
    const bGenerated = b?.kind === 'asr' ? 1 : 0;
    return aGenerated - bGenerated;
  })[0];

  const baseUrl = String(selectedTrack?.baseUrl || '');
  if (!baseUrl) return { transcript: '', language: '' };

  try {
    const response = await fetch(`${baseUrl}&fmt=json3`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { transcript: '', language: '' };
    const payload = await response.json();
    return {
      transcript: extractTranscriptTextFromEvents(payload),
      language: String(selectedTrack?.languageCode || ''),
    };
  } catch {
    return { transcript: '', language: '' };
  }
}

async function fetchYoutubeTranscriptFromInnertube(videoId, html) {
  if (!videoId) return { transcript: '', language: '', playerResponse: null };

  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
    || html.match(/innertubeApiKey["']?\s*:\s*["']([^"']+)["']/i)?.[1]
    || '';
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || '2.20250101.00.00';
  if (!apiKey) return { transcript: '', language: '', playerResponse: null };

  try {
    const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion,
            hl: 'en',
            gl: 'US',
          },
        },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { transcript: '', language: '', playerResponse: null };
    const playerResponse = await response.json();
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return { transcript: '', language: '', playerResponse };
    }

    const selectedTrack = [...tracks].sort((a, b) => {
      const aGenerated = a?.kind === 'asr' ? 1 : 0;
      const bGenerated = b?.kind === 'asr' ? 1 : 0;
      return aGenerated - bGenerated;
    })[0];

    const baseUrl = String(selectedTrack?.baseUrl || '');
    if (!baseUrl) return { transcript: '', language: '', playerResponse };

    const transcriptResponse = await fetch(`${baseUrl}&fmt=json3`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(12000),
    });
    if (!transcriptResponse.ok) {
      return { transcript: '', language: '', playerResponse };
    }
    const transcriptPayload = await transcriptResponse.json();
    return {
      transcript: extractTranscriptTextFromEvents(transcriptPayload),
      language: String(selectedTrack?.languageCode || ''),
      playerResponse,
    };
  } catch {
    return { transcript: '', language: '', playerResponse: null };
  }
}

async function fetchYoutubeTranscriptViaSupadata(normalizedUrl) {
  const apiKey = process.env.SUPADATA_API_KEY || '';
  if (!apiKey) return { transcript: '', language: '' };
  try {
    const response = await fetch(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(normalizedUrl)}&text=true&mode=native`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { transcript: '', language: '' };
    const payload = await response.json();
    return {
      transcript: normalizeLongText(payload?.content || '', MAX_STORED_CONTENT_CHARS),
      language: String(payload?.lang || ''),
    };
  } catch {
    return { transcript: '', language: '' };
  }
}

async function fetchYouTubeMetadata(normalizedUrl, html) {
  const videoId = extractYoutubeVideoId(normalizedUrl);
  const initialPlayerResponse = extractPlayerResponseFromHtml(html);
  const innertubeResult = await fetchYoutubeTranscriptFromInnertube(videoId, html);
  const playerResponse = innertubeResult.playerResponse || initialPlayerResponse || {};
  const videoDetails = playerResponse?.videoDetails || {};
  const initialData = extractInitialDataFromHtml(html);
  let oembed = null;

  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      oembed = await response.json();
    }
  } catch {
    // ignore
  }

  const fromWatchPage = await fetchYoutubeTranscriptFromWatchPage(normalizedUrl, html);
  const transcriptCandidates = [
    { transcript: fromWatchPage.transcript, language: fromWatchPage.language },
    { transcript: innertubeResult.transcript, language: innertubeResult.language },
  ];
  const bestDirectTranscript = transcriptCandidates.find((entry) => stripText(entry.transcript)) || { transcript: '', language: '' };
  const fallbackTranscript = bestDirectTranscript.transcript
    ? { transcript: '', language: '' }
    : await fetchYoutubeTranscriptViaSupadata(normalizedUrl);
  const transcript = bestDirectTranscript.transcript || fallbackTranscript.transcript;
  const language = bestDirectTranscript.language || fallbackTranscript.language;
  const aiSummaryCandidates = findObjectsDeep(initialData, (entry) => (
    Boolean(entry?.content)
    && /summary/i.test(extractTextRuns(entry?.title) || extractTextRuns(entry?.header))
  ));
  const youtubeAiSummary = normalizeLongText(
    aiSummaryCandidates
      .map((entry) => extractTextRuns(entry?.content) || extractTextRuns(entry?.description))
      .find((value) => stripText(value) && !/aboutpresscopyright|termsprivacy|test new features/i.test(value)) || '',
    4000,
  );
  const description = normalizeLongText(videoDetails?.shortDescription || '', 12000);
  const cleanedDescription = isGenericYoutubePlaceholder(description) ? '' : description;
  const cleanedTitle = isGenericYoutubePlaceholder(oembed?.title || videoDetails?.title || '') ? '' : stripText(oembed?.title || videoDetails?.title || '');
  const cleanedKeywords = Array.isArray(videoDetails?.keywords)
    ? videoDetails.keywords.map((value) => stripText(value)).filter((value) => !isGenericYoutubePlaceholder(value))
    : [];

  return {
    title: cleanedTitle,
    author: stripText(oembed?.author_name || videoDetails?.author || ''),
    thumbnail: oembed?.thumbnail_url || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : ''),
    description: cleanedDescription,
    keywords: cleanedKeywords,
    publishedDate: '',
    transcript,
    language,
    youtubeAiSummary,
  };
}

function isRedditThreadUrl(url = '') {
  return /reddit\.com\/r\/[^/]+\/comments\/[^/]+/i.test(url);
}

function normalizeRedditText(value, limit = 800) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function pickRedditThumbnail(post = {}) {
  const preview = post.preview;
  const candidate = preview?.images?.[0]?.source?.url;
  if (candidate) return normalizeRedditText(candidate, 1000);
  const thumb = String(post.thumbnail || '').trim();
  return thumb && /^https?:\/\//i.test(thumb) ? thumb : '';
}

async function fetchRedditThreadData(normalizedUrl) {
  if (!isRedditThreadUrl(normalizedUrl)) return null;
  try {
    const url = new URL(normalizedUrl);
    const jsonUrl = `${url.origin}${url.pathname.replace(/\/$/, '')}.json?raw_json=1&limit=12&sort=top`;
    const res = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LifeOSBot/1.0; +https://reddit.com)',
        Accept: 'application/json',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    if (!Array.isArray(payload) || !payload[0]?.data?.children?.[0]?.data) return null;
    const post = payload[0].data.children[0].data;
    const comments = Array.isArray(payload[1]?.data?.children) ? payload[1].data.children : [];
    const topComments = comments
      .filter((entry) => entry?.kind === 't1' && entry?.data?.body)
      .slice(0, 8)
      .map((entry) => ({
        author: String(entry.data.author || ''),
        score: typeof entry.data.score === 'number' ? entry.data.score : null,
        body: normalizeRedditText(entry.data.body, 500),
      }))
      .filter((entry) => entry.body);

    return {
      title: normalizeRedditText(post.title, 400),
      subreddit: String(post.subreddit || ''),
      author: String(post.author || ''),
      selfText: normalizeRedditText(post.selftext, 3000),
      score: typeof post.score === 'number' ? post.score : null,
      commentCount: typeof post.num_comments === 'number' ? post.num_comments : null,
      thumbnail: pickRedditThumbnail(post),
      flair: normalizeRedditText(post.link_flair_text, 120),
      permalink: String(post.permalink || ''),
      publishedDate: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : '',
      topComments,
    };
  } catch {
    return null;
  }
}

function buildRedditContent(redditThreadData) {
  if (!redditThreadData) return '';
  return normalizeLongText([
    redditThreadData.title ? `Thread Title: ${redditThreadData.title}` : '',
    redditThreadData.subreddit ? `Subreddit: r/${redditThreadData.subreddit}` : '',
    redditThreadData.author ? `Original Poster: u/${redditThreadData.author}` : '',
    redditThreadData.flair ? `Flair: ${redditThreadData.flair}` : '',
    redditThreadData.selfText ? `Original Post:\n${redditThreadData.selfText}` : '',
    redditThreadData.topComments.length > 0
      ? `Top Comments:\n${redditThreadData.topComments.map((comment, index) => `${index + 1}. u/${comment.author || 'unknown'}${comment.score != null ? ` (${comment.score})` : ''}: ${comment.body}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n'), MAX_STORED_CONTENT_CHARS);
}

async function fetchOfficialInstagramMetadata(url) {
  const accessToken = process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN || process.env.INSTAGRAM_OEMBED_ACCESS_TOKEN || '';
  if (!accessToken) return null;

  const version = process.env.INSTAGRAM_GRAPH_API_VERSION || 'v22.0';
  const endpoint = new URL(`https://graph.facebook.com/${version}/instagram_oembed`);
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('access_token', accessToken);
  endpoint.searchParams.set('omitscript', 'true');

  try {
    const res = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    return {
      canonicalUrl: stripText(payload?.author_url || url),
      authorHandle: stripText(payload?.author_name || ''),
      thumbnailUrl: stripText(payload?.thumbnail_url || ''),
      title: stripText(payload?.title || ''),
    };
  } catch {
    return null;
  }
}

function getString(input, ...keys) {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getNumber(input, ...keys) {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function flattenExtractorMedia(payload) {
  const directCandidates = [
    ...(Array.isArray(payload?.mediaItems) ? payload.mediaItems : []),
    ...(Array.isArray(payload?.media_items) ? payload.media_items : []),
    ...(Array.isArray(payload?.media) ? payload.media : []),
    ...(Array.isArray(payload?.items) ? payload.items : []),
    ...(Array.isArray(payload?.carousel_media) ? payload.carousel_media : []),
    ...(Array.isArray(payload?.children) ? payload.children : []),
  ];
  if (directCandidates.length > 0) return directCandidates;

  const item = payload?.item || payload?.data || payload?.post || payload;
  const nested = [
    ...(Array.isArray(item?.mediaItems) ? item.mediaItems : []),
    ...(Array.isArray(item?.media_items) ? item.media_items : []),
    ...(Array.isArray(item?.media) ? item.media : []),
    ...(Array.isArray(item?.carousel_media) ? item.carousel_media : []),
    ...(Array.isArray(item?.children) ? item.children : []),
  ];
  if (nested.length > 0) return nested;
  return item ? [item] : [];
}

function guessMediaType(item) {
  const mediaType = String(item?.media_type || item?.type || item?.mime_type || item?.mimeType || '').toLowerCase();
  if (mediaType.includes('video') || mediaType === '2') return 'video';
  const sourceUrl = getString(item, 'video_url', 'videoUrl', 'url', 'src', 'display_url', 'displayUrl', 'image_url', 'imageUrl');
  return /\.mp4(?:$|\?)/i.test(sourceUrl) ? 'video' : 'image';
}

function normalizeMediaItems(payload) {
  return flattenExtractorMedia(payload)
    .map((item, index) => {
      const type = guessMediaType(item);
      const sourceUrl = getString(item, 'video_url', 'videoUrl', 'display_url', 'displayUrl', 'image_url', 'imageUrl', 'url', 'src');
      const thumbnailUrl = getString(item, 'thumbnail_url', 'thumbnailUrl', 'display_url', 'displayUrl', 'image_url', 'imageUrl', 'cover_url', 'coverUrl');
      return {
        type,
        index: getNumber(item, 'index', 'position', 'order') ?? index,
        source_url: sourceUrl,
        thumbnail_url: thumbnailUrl || (type === 'image' ? sourceUrl : ''),
        duration_seconds: getNumber(item, 'duration', 'duration_seconds', 'video_duration'),
        width: getNumber(item, 'width', 'original_width'),
        height: getNumber(item, 'height', 'original_height'),
      };
    })
    .filter((item) => item.source_url);
}

function normalizeExtractorPayload(url, payload, officialMetadata) {
  const root = payload?.data || payload?.post || payload?.item || payload;
  const shortcode = getString(root, 'shortcode', 'code') || parseInstagramShortcode(url);
  const explicit = getString(root, 'post_kind', 'postKind', 'product_type', 'productType', 'media_type', 'mediaType').toLowerCase();
  const resourceType = explicit.includes('reel') || explicit === 'clips'
    ? 'instagram_reel'
    : explicit.includes('carousel') || explicit.includes('sidecar')
      ? 'instagram_carousel'
      : detectInstagramPostKind(url);

  if (!shortcode || !resourceType) return null;

  const mediaItems = normalizeMediaItems(root);
  const thumbnailUrl = getString(root, 'thumbnail_url', 'thumbnailUrl', 'display_url', 'displayUrl')
    || officialMetadata?.thumbnailUrl
    || mediaItems[0]?.thumbnail_url
    || '';
  const caption = normalizeLongText(
    getString(root, 'caption', 'caption_text', 'captionText', 'title', 'description')
      || getString(root?.caption, 'text')
      || officialMetadata?.title,
    12000,
  );
  const authorHandle = getString(root, 'author_handle', 'authorHandle', 'username', 'owner_username', 'ownerUsername')
    || officialMetadata?.authorHandle
    || '';
  const publishedAt = getString(root, 'published_at', 'publishedAt', 'taken_at', 'takenAt', 'timestamp');
  const videoUrl = getString(root, 'video_url', 'videoUrl') || mediaItems.find((item) => item.type === 'video')?.source_url || '';

  return {
    canonicalUrl: normalizeInstagramUrl(getString(root, 'url', 'canonical_url', 'canonicalUrl', 'permalink') || url),
    shortcode,
    resourceType,
    authorHandle: authorHandle.replace(/^@/, ''),
    caption,
    publishedAt,
    thumbnailUrl,
    mediaItems,
    videoUrl,
    ingestionSource: 'extractor_fallback',
    transcript: '',
    transcriptError: '',
  };
}

async function fetchExtractorInstagramMetadata(url, officialMetadata) {
  const extractorUrl = process.env.INSTAGRAM_EXTRACTOR_URL || '';
  if (!extractorUrl) return null;

  const method = (process.env.INSTAGRAM_EXTRACTOR_METHOD || 'POST').toUpperCase();
  const apiKey = process.env.INSTAGRAM_EXTRACTOR_API_KEY || '';
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (method !== 'GET') headers['Content-Type'] = 'application/json';

  try {
    const requestUrl = method === 'GET'
      ? `${extractorUrl}${extractorUrl.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`
      : extractorUrl;
    const res = await fetch(requestUrl, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify({ url }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Instagram extractor rejected the request.');
    if (res.status === 404) throw new Error('Instagram post was not found.');
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(errorBody || `Instagram extractor failed (${res.status}).`);
    }
    const payload = await res.json();
    return normalizeExtractorPayload(url, payload, officialMetadata);
  } catch (error) {
    throw new Error(error?.message || 'Instagram extractor failed.');
  }
}

async function transcribeInstagramVideo(videoUrl) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey || !videoUrl) return { transcript: '', error: '' };

  try {
    const mediaRes = await fetch(videoUrl, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!mediaRes.ok) {
      return { transcript: '', error: `Transcript unavailable: media download failed (${mediaRes.status}).` };
    }

    const contentLength = Number(mediaRes.headers.get('content-length') || '0');
    if (contentLength && contentLength > MAX_TRANSCRIPTION_BYTES) {
      return { transcript: '', error: 'Transcript unavailable: reel is too large to transcribe automatically.' };
    }

    const mimeType = mediaRes.headers.get('content-type') || 'video/mp4';
    const extension = mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('audio') ? 'm4a' : 'mp4';
    const bytes = await mediaRes.arrayBuffer();
    if (bytes.byteLength > MAX_TRANSCRIPTION_BYTES) {
      return { transcript: '', error: 'Transcript unavailable: reel is too large to transcribe automatically.' };
    }

    const form = new FormData();
    form.append('model', process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL);
    form.append('file', new Blob([bytes], { type: mimeType }), `instagram-reel.${extension}`);

    const endpoint = process.env.OPENAI_TRANSCRIPTION_ENDPOINT || DEFAULT_TRANSCRIPTION_ENDPOINT;
    const transcriptRes = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(45000),
    });
    if (!transcriptRes.ok) {
      const body = await transcriptRes.text().catch(() => '');
      return { transcript: '', error: body || `Transcript request failed (${transcriptRes.status}).` };
    }
    const payload = await transcriptRes.json();
    const transcript = normalizeLongText(payload?.text || payload?.transcript || '', 32000);
    return { transcript, error: transcript ? '' : 'Transcript unavailable: provider returned no text.' };
  } catch {
    return { transcript: '', error: 'Transcript unavailable: transcription request failed.' };
  }
}

async function fetchInstagramExtraction(url) {
  if (!isInstagramUrl(url)) throw new Error('Unsupported Instagram URL.');

  const canonicalUrl = await resolveInstagramCanonicalUrl(url);
  const extractionUrl = canonicalUrl || url;
  const officialMetadata = await fetchOfficialInstagramMetadata(extractionUrl);
  let extraction = await fetchExtractorInstagramMetadata(extractionUrl, officialMetadata).catch(() => null);

  if (!extraction) {
    const shortcode = parseInstagramShortcode(extractionUrl);
    const resourceType = detectInstagramPostKind(extractionUrl);
    if (!shortcode || !resourceType) throw new Error('Unsupported Instagram URL.');
    extraction = {
      canonicalUrl: normalizeInstagramUrl(extractionUrl),
      shortcode,
      resourceType,
      authorHandle: officialMetadata?.authorHandle || '',
      caption: officialMetadata?.title || '',
      publishedAt: '',
      thumbnailUrl: officialMetadata?.thumbnailUrl || '',
      mediaItems: [],
      videoUrl: '',
      ingestionSource: 'official_api',
      transcript: '',
      transcriptError: '',
    };
  }

  if (!extraction.mediaItems.length && !extraction.caption) {
    throw new Error('Instagram post is private, unavailable, or extractor-blocked.');
  }

  if (extraction.resourceType === 'instagram_reel' && extraction.videoUrl) {
    const transcriptResult = await transcribeInstagramVideo(extraction.videoUrl);
    extraction.transcript = transcriptResult.transcript;
    extraction.transcriptError = transcriptResult.error;
  }

  return extraction;
}

async function fetchPageSummary(inputUrl) {
  const normalizedUrl = normalizeResourceUrl(inputUrl);
  const canonicalUrl = isInstagramUrl(normalizedUrl)
    ? await resolveInstagramCanonicalUrl(normalizedUrl)
    : normalizedUrl;
  const resourceType = inferResourceType(canonicalUrl);
  const redditThreadData = resourceType === 'reddit' ? await fetchRedditThreadData(canonicalUrl) : null;
  const instagramExtraction = (resourceType === 'instagram_reel' || resourceType === 'instagram_carousel')
    ? await fetchInstagramExtraction(canonicalUrl)
    : null;

  let html = '';
  let meta = {};
  let jsonLdSummary = '';
  let title = '';
  let bodyText = '';
  let thumbnail = '';
  let author = '';
  let description = '';
  let keywords = [];
  let publishedDate = '';

  try {
    const response = await fetch(canonicalUrl, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    html = await response.text();
    const { document } = parseHTML(html);
    meta = extractMeta(document);
    const jsonLdItems = extractJsonLd(document);
    jsonLdSummary = summarizeJsonLd(jsonLdItems);
    title = stripText(document.querySelector('title')?.textContent || '');
    bodyText = extractMainText(document);
    thumbnail = meta['og:image'] || meta['twitter:image'] || extractJsonLdImage(jsonLdItems) || '';
    author = meta.author || meta['article:author'] || '';
    description = meta.description || meta['og:description'] || meta['twitter:description'] || '';
    keywords = String(meta.keywords || '')
      .split(',')
      .map((value) => stripText(value))
      .filter(Boolean);
    publishedDate = meta['article:published_time'] || '';
  } catch {
    // keep partial metadata flow alive
  }

  const metadataFallbackContent = buildMetadataFallbackContent({ title, description, jsonLdSummary });
  const cleanedBodyText = looksLikeLowQualityHtmlText(bodyText) ? '' : bodyText;

  if (resourceType === 'youtube') {
    const youtube = await fetchYouTubeMetadata(canonicalUrl, html);
    return {
      canonicalUrl,
      title: youtube.title || title,
      author: youtube.author || author,
      thumbnail: youtube.thumbnail || thumbnail,
      description: youtube.description || description,
      keywords: youtube.keywords || keywords,
      publishedDate: youtube.publishedDate || publishedDate,
      content: youtube.transcript || youtube.description || '',
      contentSource: youtube.transcript ? 'youtube_transcript' : (youtube.description ? 'youtube_description' : 'metadata_only'),
      contentLanguage: youtube.language || '',
      resourceType,
      meta,
      jsonLdSummary,
      youtubeAiSummary: youtube.youtubeAiSummary || '',
      redditThreadData: null,
      instagramExtraction: null,
      isRedditThread: false,
    };
  }

  if (resourceType === 'reddit') {
    const redditContent = buildRedditContent(redditThreadData);
    return {
      canonicalUrl,
      title: redditThreadData?.title || title,
      author: redditThreadData?.author ? `u/${redditThreadData.author}` : author,
      thumbnail: redditThreadData?.thumbnail || thumbnail,
      description: redditThreadData?.selfText || description,
      keywords,
      publishedDate: redditThreadData?.publishedDate || publishedDate,
      content: redditContent || bodyText,
      contentSource: redditContent ? 'reddit_thread' : (bodyText ? 'html_text' : 'metadata_only'),
      contentLanguage: redditContent ? 'en' : '',
      resourceType,
      meta,
      jsonLdSummary,
      redditThreadData,
      instagramExtraction: null,
      isRedditThread: Boolean(redditThreadData),
    };
  }

  if (resourceType === 'instagram_reel' || resourceType === 'instagram_carousel') {
    const instagramContent = normalizeLongText([
      instagramExtraction?.authorHandle ? `Author: @${instagramExtraction.authorHandle}` : '',
      instagramExtraction?.caption ? `Caption:\n${instagramExtraction.caption}` : '',
      instagramExtraction?.transcript ? `Transcript:\n${instagramExtraction.transcript}` : '',
      Array.isArray(instagramExtraction?.mediaItems) && instagramExtraction.mediaItems.length > 0
        ? `Media Items: ${instagramExtraction.mediaItems.map((item, index) => {
          const parts = [
            `${index + 1}. ${item.type}`,
            item.duration_seconds != null ? `${item.duration_seconds}s` : '',
            item.width && item.height ? `${item.width}x${item.height}` : '',
          ].filter(Boolean);
          return parts.join(' ');
        }).join(' | ')}`
        : '',
    ].filter(Boolean).join('\n\n'));

    return {
      canonicalUrl: instagramExtraction?.canonicalUrl || canonicalUrl,
      title: instagramExtraction?.caption?.slice(0, 120) || title,
      author: instagramExtraction?.authorHandle ? `@${instagramExtraction.authorHandle}` : author,
      thumbnail: instagramExtraction?.thumbnailUrl || thumbnail,
      description: instagramExtraction?.caption || description,
      keywords,
      publishedDate: instagramExtraction?.publishedAt || publishedDate,
      content: instagramContent,
      contentSource: instagramExtraction?.transcript
        ? 'instagram_caption_transcript'
        : instagramExtraction?.caption
          ? 'instagram_caption'
          : 'metadata_only',
      contentLanguage: '',
      resourceType,
      meta,
      jsonLdSummary,
      redditThreadData: null,
      instagramExtraction,
      isRedditThread: false,
    };
  }

  return {
    canonicalUrl,
    title,
    author,
    thumbnail,
    description,
    keywords,
    publishedDate,
    content: cleanedBodyText || metadataFallbackContent,
    contentSource: cleanedBodyText ? 'html_text' : (metadataFallbackContent ? 'metadata_description' : 'metadata_only'),
    contentLanguage: '',
    resourceType,
    meta,
    jsonLdSummary,
    youtubeAiSummary: '',
    redditThreadData: null,
    instagramExtraction: null,
    isRedditThread: false,
  };
}

function buildMetadataContext(extracted) {
  return [
    extracted.meta?.['og:title'] ? `Page Title: ${extracted.meta['og:title']}` : '',
    extracted.meta?.['og:site_name'] ? `Site Name: ${extracted.meta['og:site_name']}` : '',
    extracted.meta?.description ? `Meta Description: ${extracted.meta.description}` : '',
    extracted.meta?.['og:description'] ? `OG Description: ${extracted.meta['og:description']}` : '',
    extracted.meta?.['og:type'] ? `OG Type: ${extracted.meta['og:type']}` : '',
    extracted.publishedDate ? `Published: ${extracted.publishedDate}` : '',
    extracted.meta?.['article:author'] ? `Article Author: ${extracted.meta['article:author']}` : '',
  ].filter(Boolean).join('\n');
}

function buildRedditContext(redditThreadData) {
  if (!redditThreadData) return '';
  return [
    `Thread Title: ${redditThreadData.title || ''}`,
    redditThreadData.subreddit ? `Subreddit: r/${redditThreadData.subreddit}` : '',
    redditThreadData.author ? `Original Poster: u/${redditThreadData.author}` : '',
    redditThreadData.flair ? `Thread Flair: ${redditThreadData.flair}` : '',
    redditThreadData.score != null ? `Post Score: ${redditThreadData.score}` : '',
    redditThreadData.commentCount != null ? `Comment Count: ${redditThreadData.commentCount}` : '',
    redditThreadData.selfText ? `Original Post Body: ${redditThreadData.selfText}` : '',
  ].filter(Boolean).join('\n');
}

function buildInstagramContext(instagramExtraction) {
  if (!instagramExtraction) return '';
  return [
    instagramExtraction.resourceType ? `Post Kind: ${instagramExtraction.resourceType}` : '',
    instagramExtraction.authorHandle ? `Author Handle: @${instagramExtraction.authorHandle}` : '',
    instagramExtraction.publishedAt ? `Published At: ${instagramExtraction.publishedAt}` : '',
    instagramExtraction.mediaItems.length > 0 ? `Media Count: ${instagramExtraction.mediaItems.length}` : '',
    instagramExtraction.transcript ? 'Transcript Available: yes' : '',
    !instagramExtraction.transcript && instagramExtraction.transcriptError ? `Transcript Status: ${instagramExtraction.transcriptError}` : '',
  ].filter(Boolean).join('\n');
}

function buildPrompt({ url, extracted, heuristic, areaNames = [] }) {
  const isReddit = extracted.resourceType === 'reddit';
  const isInstagram = extracted.resourceType === 'instagram_reel' || extracted.resourceType === 'instagram_carousel';
  const isToolLike = extracted.resourceType === 'github_repo' || extracted.resourceType === 'website';

  return [
    'Analyze this saved resource and return structured JSON for a personal knowledge base.',
    `URL: ${url}`,
    `Detected resource type: ${extracted.resourceType}`,
    `Extracted content source: ${extracted.contentSource}`,
    extracted.contentLanguage ? `Extracted language: ${extracted.contentLanguage}` : '',
    `Title: ${extracted.title || url}`,
    extracted.author ? `Author/Creator: ${extracted.author}` : '',
    extracted.description ? `Extracted description: ${extracted.description.slice(0, 1500)}` : '',
    extracted.youtubeAiSummary ? `Supplemental YouTube AI summary: ${extracted.youtubeAiSummary.slice(0, 1500)}` : '',
    extracted.keywords?.length ? `Extracted keywords: ${extracted.keywords.join(', ')}` : '',
    buildMetadataContext(extracted) ? `Metadata:\n${buildMetadataContext(extracted)}` : '',
    extracted.jsonLdSummary ? `Structured data:\n${extracted.jsonLdSummary}` : '',
    buildRedditContext(extracted.redditThreadData) ? `Reddit context:\n${buildRedditContext(extracted.redditThreadData)}` : '',
    buildInstagramContext(extracted.instagramExtraction) ? `Instagram context:\n${buildInstagramContext(extracted.instagramExtraction)}` : '',
    '',
    extracted.content ? `Primary extracted content:\n${extracted.content.slice(0, MAX_PROMPT_CONTENT_CHARS)}` : 'Primary extracted content: none',
    '',
    areaNames.length ? `Assign exactly one life area from: ${areaNames.join(', ')}` : '',
    'Return JSON with:',
    '- title',
    '- author',
    '- published_date',
    '- thumbnail',
    '- summary (2-3 sentences)',
    '- why_it_matters (1-2 sentences)',
    '- who_its_for (short audience description)',
    '- explanation_for_newbies',
    '- main_topic',
    areaNames.length ? `- area_name (exactly one of: ${areaNames.join(', ')})` : '',
    '- score (1-10)',
    '- tags (3-8 short lowercase tags)',
    '- key_points (3-6 concise takeaways when content exists)',
    '- actionable_points (2-5 practical next steps when content exists)',
    '- use_cases (2-4 concrete revisit scenarios when content exists)',
    '- learning_outcomes',
    '- notable_quotes_or_moments',
    isReddit ? '- reddit_thread_type' : '',
    isReddit ? '- reddit_top_comment_summaries (2-5 concise takeaways from top comments when comments exist)' : '',
    isToolLike ? '- status: one of "active", "beta", "deprecated", "unknown"' : '',
    'Return valid JSON only. Do not wrap the JSON in markdown fences.',
    extracted.resourceType === 'youtube'
      ? 'For YouTube, use transcript/content as the primary source and keep the creator/channel plus thumbnail if available.'
      : 'Use extracted content as the main source of truth and stay conservative.',
    extracted.content
      ? 'If meaningful content exists, do not return only a summary. Populate key_points, actionable_points, and use_cases whenever reasonably supported.'
      : '',
    `Heuristic fallback summary: ${JSON.stringify(heuristic).slice(0, 1600)}`,
  ].filter(Boolean).join('\n');
}

async function classifyAreaFromContent({ extracted, mergedData, areas, userId }) {
  if (!areas.length) return '';
  const prompt = [
    'Choose exactly one life area for this resource.',
    `Allowed life areas: ${areas.map((area) => area.name).join(', ')}`,
    `Title: ${mergedData.title || extracted.title || ''}`,
    `Author: ${mergedData.author || extracted.author || ''}`,
    `Main topic: ${mergedData.main_topic || ''}`,
    `Summary: ${mergedData.summary || ''}`,
    mergedData.tags?.length ? `Tags: ${mergedData.tags.join(', ')}` : '',
    extracted.resourceType ? `Resource type: ${extracted.resourceType}` : '',
    extracted.youtubeAiSummary ? `Supplemental YouTube AI summary: ${extracted.youtubeAiSummary.slice(0, 1200)}` : '',
    extracted.content ? `Content excerpt:\n${String(extracted.content).slice(0, 4000)}` : '',
    'Return JSON with only area_name, using exactly one of the allowed life area names. If uncertain, still choose the closest fit.',
  ].filter(Boolean).join('\n');

  try {
    const result = await routeStructuredJson({
      taskType: 'generic.structured',
      prompt,
      schema: areaClassificationSchema,
      userId,
      policy: { tier: 'cheap', temperature: 0.1, maxTokens: 120 },
      metadata: {
        requestSummary: `resource-area:${extracted.canonicalUrl || extracted.title || 'resource'}`,
      },
      groundWithGoogleSearch: false,
    });
    return stripText(result.data.area_name);
  } catch {
    return '';
  }
}

function getStructuredSectionCount(result) {
  return [
    normalizeStringArray(result.key_points, 6).length > 0,
    normalizeStringArray(result.actionable_points, 5).length > 0,
    normalizeStringArray(result.use_cases, 5).length > 0,
  ].filter(Boolean).length;
}

function hasCoreFraming(result) {
  return Boolean(stripText(result.why_it_matters)) && Boolean(stripText(result.who_its_for));
}

function getEnrichmentStatus(result, extracted) {
  const contentLength = String(extracted.content || '').length;
  const structuredSections = getStructuredSectionCount(result);
  const hasCommentTakeaways = normalizeStringArray(result.reddit_top_comment_summaries, 5).length > 0;
  if (!contentLength) return 'metadata_only';
  if (structuredSections >= 2 && hasCoreFraming(result)) return 'rich';
  if (structuredSections >= 1 || hasCoreFraming(result) || hasCommentTakeaways) return 'partial';
  return 'sparse';
}

function resolveAreaAssignment(resultAreaName, areas, mergedData, extracted) {
  const normalizedAreaName = stripText(resultAreaName).toLowerCase();
  const areaMap = new Map((areas || []).map((area) => [String(area.name || '').toLowerCase(), area]));
  let matchedArea = areaMap.get(normalizedAreaName) || null;
  let matchedByFallback = false;

  if (!matchedArea && normalizedAreaName) {
    for (const area of areas || []) {
      const candidate = String(area.name || '').toLowerCase();
      if (!candidate) continue;
      if (normalizedAreaName.includes(candidate) || candidate.includes(normalizedAreaName)) {
        matchedArea = area;
        matchedByFallback = true;
        break;
      }
    }
  }

  if (!matchedArea) {
    matchedArea = areaMap.get('knowledge') || (areas || [])[0] || null;
    matchedByFallback = true;
  }

  const lowConfidence = (
    matchedByFallback
    || !normalizedAreaName
    || getEnrichmentStatus(mergedData, extracted) !== 'rich'
    || String(extracted.content || '').length < (extracted.resourceType === 'reddit' ? 600 : 900)
  );

  return {
    area_id: matchedArea?.id || '',
    area_name: matchedArea?.name || '',
    area_needs_review: Boolean(matchedArea) && lowConfidence,
  };
}

function buildAnalysisPayload({ mergedData, extracted, areaAssignment }) {
  const isReddit = extracted.resourceType === 'reddit';
  const isInstagram = extracted.resourceType === 'instagram_reel' || extracted.resourceType === 'instagram_carousel';
  const instagramExtraction = extracted.instagramExtraction;
  const redditThreadData = extracted.redditThreadData;

  return {
    ...mergedData,
    score: mergedData.score || 5,
    resource_type: extracted.resourceType,
    url: extracted.canonicalUrl,
    area_id: areaAssignment.area_id,
    area_name: areaAssignment.area_name,
    area_needs_review: areaAssignment.area_needs_review,
    enrichment_status: getEnrichmentStatus(mergedData, extracted),
    analysis_version: ANALYSIS_VERSION,
    content_source: extracted.contentSource,
    content_language: extracted.contentLanguage || '',
    content: extracted.content || '',
    published_date: mergedData.published_date || extracted.publishedDate || '',
    reddit_thread_type: mergedData.reddit_thread_type || (isReddit && extracted.isRedditThread ? 'discussion' : ''),
    reddit_top_comment_summaries: normalizeStringArray(
      mergedData.reddit_top_comment_summaries?.length
        ? mergedData.reddit_top_comment_summaries
        : redditThreadData?.topComments?.slice(0, 3).map((comment) => comment.body) || [],
      5,
      240,
    ),
    ...(isReddit
      ? {
          reddit_subreddit: redditThreadData?.subreddit || '',
          reddit_author: redditThreadData?.author || '',
          reddit_post_score: redditThreadData?.score ?? null,
          reddit_comment_count: redditThreadData?.commentCount ?? null,
        }
      : {}),
    ...(isInstagram && instagramExtraction
      ? {
          instagram_author_handle: instagramExtraction.authorHandle || '',
          instagram_caption: instagramExtraction.caption || '',
          instagram_transcript: instagramExtraction.transcript || '',
          instagram_media_items: instagramExtraction.mediaItems || [],
          ingestion_source: instagramExtraction.ingestionSource || '',
          ingestion_error: instagramExtraction.transcriptError || '',
        }
      : {}),
  };
}

export async function analyzeResource({ url, title = '', content = '', userId = null }) {
  const normalizedInputUrl = normalizeResourceUrl(url);
  const extracted = content
    ? {
        canonicalUrl: normalizedInputUrl,
        title,
        author: '',
        thumbnail: '',
        description: '',
        keywords: [],
        publishedDate: '',
        content: normalizeLongText(content, 20000),
        contentSource: 'manual_text',
        contentLanguage: '',
        resourceType: inferResourceType(normalizedInputUrl),
        meta: {},
        jsonLdSummary: '',
        youtubeAiSummary: '',
        redditThreadData: null,
        instagramExtraction: null,
        isRedditThread: false,
      }
    : await fetchPageSummary(normalizedInputUrl);

  const areas = userId ? await listCompatEntities(userId, 'LifeArea', { sort: 'name', limit: 500 }) : [];
  const heuristic = buildHeuristicResourceData({ extracted, title, url: extracted.canonicalUrl || normalizedInputUrl });
  const prompt = buildPrompt({
    url: extracted.canonicalUrl || normalizedInputUrl,
    extracted,
    heuristic,
    areaNames: areas.map((area) => area.name).filter(Boolean),
  });

  let result = null;
  try {
    result = await routeStructuredJson({
      taskType: 'resource.analyze',
      prompt,
      schema: resourceSchema,
      userId,
      groundWithGoogleSearch: true,
      metadata: {
        requestSummary: `resource:${normalizedInputUrl}`,
      },
    });
  } catch {
    result = {
      data: heuristic,
      provider: 'heuristic',
      model: null,
    };
  }

  const mergedData = {
    ...heuristic,
    ...result.data,
    title: result.data.title || heuristic.title,
    author: result.data.author || heuristic.author,
    published_date: result.data.published_date || heuristic.published_date,
    thumbnail: result.data.thumbnail || heuristic.thumbnail,
    summary: result.data.summary || heuristic.summary,
    why_it_matters: result.data.why_it_matters || heuristic.why_it_matters,
    who_its_for: result.data.who_its_for || heuristic.who_its_for,
    explanation_for_newbies: result.data.explanation_for_newbies || heuristic.explanation_for_newbies,
    main_topic: result.data.main_topic || heuristic.main_topic,
    score: result.data.score || heuristic.score,
    tags: dedupeStrings([...(result.data.tags || []), ...heuristic.tags], 8),
    key_points: dedupeStrings([...(result.data.key_points || []), ...heuristic.key_points], 6),
    actionable_points: dedupeStrings([...(result.data.actionable_points || []), ...heuristic.actionable_points], 5),
    use_cases: dedupeStrings([...(result.data.use_cases || []), ...heuristic.use_cases], 4),
    learning_outcomes: dedupeStrings([...(result.data.learning_outcomes || []), ...heuristic.learning_outcomes], 4),
    notable_quotes_or_moments: dedupeStrings([...(result.data.notable_quotes_or_moments || []), ...heuristic.notable_quotes_or_moments], 3),
    reddit_thread_type: result.data.reddit_thread_type || heuristic.reddit_thread_type,
    reddit_top_comment_summaries: normalizeStringArray(
      [...(result.data.reddit_top_comment_summaries || []), ...(heuristic.reddit_top_comment_summaries || [])],
      5,
      240,
    ),
    status: result.data.status || heuristic.status || 'unknown',
  };

  let resolvedAreaName = stripText(result.data.area_name || heuristic.area_name);
  let areaAssignment = resolveAreaAssignment(resolvedAreaName, areas, mergedData, extracted);
  if ((!resolvedAreaName || !areaAssignment.area_id || areaAssignment.area_name === 'Knowledge') && areas.length) {
    const secondPassAreaName = await classifyAreaFromContent({
      extracted,
      mergedData,
      areas,
      userId,
    });
    if (secondPassAreaName) {
      resolvedAreaName = secondPassAreaName;
      areaAssignment = resolveAreaAssignment(secondPassAreaName, areas, mergedData, extracted);
    }
  }
  const data = buildAnalysisPayload({ mergedData, extracted, areaAssignment });
  if (extracted.youtubeAiSummary) {
    data.youtube_ai_summary = extracted.youtubeAiSummary;
  }

  return {
    ...result,
    data,
  };
}

function matchesReenrichSearch(resource, search = '') {
  const searchTerms = String(search || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!searchTerms.length) return true;
  const searchable = [
    resource.title,
    resource.summary,
    resource.why_it_matters,
    resource.who_its_for,
    resource.content,
    resource.main_topic,
    resource.author,
    ...(Array.isArray(resource.tags) ? resource.tags : []),
    ...(Array.isArray(resource.key_points) ? resource.key_points : []),
    ...(Array.isArray(resource.actionable_points) ? resource.actionable_points : []),
    ...(Array.isArray(resource.use_cases) ? resource.use_cases : []),
    ...(Array.isArray(resource.learning_outcomes) ? resource.learning_outcomes : []),
    ...(Array.isArray(resource.notable_quotes_or_moments) ? resource.notable_quotes_or_moments : []),
  ].filter(Boolean).join(' ').toLowerCase();
  return searchTerms.every((term) => searchable.includes(term));
}

function matchesReenrichFilters(resource, filters = {}, projectResourceIds = null) {
  const typeFilter = String(filters.type || 'all');
  const areaFilter = String(filters.area_id || 'all');
  const archivedFilter = String(filters.archived || 'all');
  const tagFilter = String(filters.tag || '').trim();

  if (typeFilter !== 'all' && resource.resource_type !== typeFilter) return false;
  if (areaFilter !== 'all' && resource.area_id !== areaFilter) return false;
  if (archivedFilter === 'active' && resource.is_archived) return false;
  if (archivedFilter === 'archived' && !resource.is_archived) return false;
  if (projectResourceIds && !projectResourceIds.has(resource.id)) return false;
  if (tagFilter && !(Array.isArray(resource.tags) ? resource.tags : []).includes(tagFilter)) return false;
  return matchesReenrichSearch(resource, filters.search || '');
}

function isKnowledgeAreaName(value = '') {
  return stripText(value).toLowerCase() === 'knowledge';
}

function getEnrichmentRank(status = '') {
  switch (String(status || '').toLowerCase()) {
    case 'rich':
      return 4;
    case 'partial':
      return 3;
    case 'sparse':
      return 2;
    case 'metadata_only':
      return 1;
    default:
      return 0;
  }
}

function preserveStrongerExistingData(resource, analyzedData) {
  const existingRank = getEnrichmentRank(resource.enrichment_status);
  const nextRank = getEnrichmentRank(analyzedData.enrichment_status);
  const shouldPreserveExistingEnrichment = existingRank > nextRank;
  const existingHasArea = Boolean(stripText(resource.area_id) || stripText(resource.area_name));
  const existingIsKnowledge = isKnowledgeAreaName(resource.area_name);
  const nextHasArea = Boolean(stripText(analyzedData.area_id) || stripText(analyzedData.area_name));
  const nextIsKnowledge = isKnowledgeAreaName(analyzedData.area_name);
  const nextIsWeak = !nextHasArea || nextIsKnowledge || Boolean(analyzedData.area_needs_review);
  const nextData = { ...analyzedData };

  if (shouldPreserveExistingEnrichment) {
    nextData.summary = resource.summary || nextData.summary || '';
    nextData.why_it_matters = resource.why_it_matters || nextData.why_it_matters || '';
    nextData.who_its_for = resource.who_its_for || nextData.who_its_for || '';
    nextData.explanation_for_newbies = resource.explanation_for_newbies || nextData.explanation_for_newbies || '';
    nextData.main_topic = resource.main_topic || nextData.main_topic || '';
    nextData.tags = Array.isArray(resource.tags) && resource.tags.length ? resource.tags : nextData.tags;
    nextData.key_points = Array.isArray(resource.key_points) && resource.key_points.length ? resource.key_points : nextData.key_points;
    nextData.actionable_points = Array.isArray(resource.actionable_points) && resource.actionable_points.length ? resource.actionable_points : nextData.actionable_points;
    nextData.use_cases = Array.isArray(resource.use_cases) && resource.use_cases.length ? resource.use_cases : nextData.use_cases;
    nextData.learning_outcomes = Array.isArray(resource.learning_outcomes) && resource.learning_outcomes.length ? resource.learning_outcomes : nextData.learning_outcomes;
    nextData.notable_quotes_or_moments = Array.isArray(resource.notable_quotes_or_moments) && resource.notable_quotes_or_moments.length
      ? resource.notable_quotes_or_moments
      : nextData.notable_quotes_or_moments;
    nextData.content = resource.content || nextData.content || '';
    nextData.content_source = resource.content_source || nextData.content_source || '';
    nextData.content_language = resource.content_language || nextData.content_language || '';
    nextData.enrichment_status = resource.enrichment_status || nextData.enrichment_status || '';
  }

  if (existingHasArea && !existingIsKnowledge && nextIsWeak) {
    return {
      ...nextData,
      area_id: resource.area_id || '',
      area_name: resource.area_name || '',
      area_needs_review: Boolean(resource.area_needs_review),
    };
  }

  return nextData;
}

export async function reEnrichResourcesForUser(userId, { resourceIds = [], filters = {}, batchSize = 25 } = {}) {
  const resources = await listCompatEntities(userId, 'Resource', { sort: '-created_date', limit: 5000 });
  const selectedIds = new Set((resourceIds || []).filter(Boolean));
  const projectId = String(filters.project_id || '').trim();
  let projectResourceIds = null;

  if (!selectedIds.size && projectId) {
    const projectResources = await listCompatEntities(userId, 'ProjectResource', { sort: '-created_date', limit: 5000 });
    projectResourceIds = new Set(
      projectResources
        .filter((entry) => entry.project_id === projectId)
        .map((entry) => entry.resource_id || entry.note_id)
        .filter(Boolean),
    );
  }

  const targets = resources
    .filter((resource) => (
      selectedIds.size
        ? selectedIds.has(resource.id)
        : matchesReenrichFilters(resource, filters, projectResourceIds)
    ))
    .slice(0, Math.max(Number(batchSize) || 25, 1));

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items = [];

  for (const resource of targets) {
    const resourceUrl = normalizeResourceUrl(resource.source_url || resource.url || '');
    if (!resourceUrl || !isValidHttpUrl(resourceUrl) || resource.resource_type === 'note') {
      skipped += 1;
      items.push({ id: resource.id, status: 'skipped', reason: 'Resource does not have a re-enrichable URL.' });
      continue;
    }

    try {
      const analyzed = await analyzeResource({
        url: resourceUrl,
        title: resource.title || '',
        content: '',
        userId,
      });
      const nextData = preserveStrongerExistingData(resource, analyzed.data);
      await updateCompatEntity(userId, 'Resource', resource.id, {
        ...resource,
        ...nextData,
        id: resource.id,
        created_date: resource.created_date,
      });
      updated += 1;
      items.push({ id: resource.id, status: 'updated' });
    } catch (error) {
      failed += 1;
      items.push({ id: resource.id, status: 'failed', reason: error?.message || 'Re-enrichment failed.' });
    }
  }

  return {
    total: targets.length,
    updated,
    skipped,
    failed,
    items,
  };
}
