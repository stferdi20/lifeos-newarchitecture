import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { z } from 'zod';
import { routeStructuredJson } from '../lib/llm-router.js';
import { listCompatEntities, updateCompatEntity } from './compat-store.js';
import { requestYouTubeTranscript } from './instagram-downloader.js';
import { shouldQueueYouTubeTranscriptBackfill } from './youtube-transcripts.js';
import {
  chooseHeuristicArea,
  isKnowledgeAreaName,
} from './resource-area-heuristics.js';

const ANALYSIS_VERSION = 'resource-enrichment-v6';
const USER_AGENT = 'LifeOS/1.0 (+https://lifeos-self-hosted.vercel.app)';
const MAX_STORED_CONTENT_CHARS = 60000;
const MAX_PROMPT_CONTENT_CHARS = 16000;
const MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
const DEFAULT_TRANSCRIPTION_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_YTDLP_BIN = 'yt-dlp';
const DEFAULT_YTDLP_TIMEOUT_MS = 20000;
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

function toArray(value) {
  return Array.isArray(value) ? value : [];
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

function normalizeTranscriptText(value, limit = MAX_STORED_CONTENT_CHARS) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

function normalizeContentForPrompt(value, limit = MAX_PROMPT_CONTENT_CHARS) {
  return normalizeLongText(value, limit);
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

function normalizeKeywordValues(values, limit = 12) {
  return dedupeStrings(
    toArray(values)
      .flatMap((value) => String(value || '').split(','))
      .map((value) => stripText(value))
      .filter(Boolean),
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

function normalizeTitleCandidate(title = '', siteName = '') {
  let cleaned = stripText(title);
  const site = stripText(siteName);
  if (!cleaned) return '';
  if (site) {
    const escapedSite = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned
      .replace(new RegExp(`\\s*[|:-]\\s*${escapedSite}$`, 'i'), '')
      .replace(new RegExp(`^${escapedSite}\\s*[|:-]\\s*`, 'i'), '')
      .trim();
  }
  return stripText(cleaned);
}

function normalizeInstagramHandle(value = '') {
  return stripText(value).replace(/^@+/, '').replace(/[^\w.]+/g, '').slice(0, 40);
}

function stripInstagramEmoji(value = '') {
  return String(value || '').replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, ' ');
}

function cleanInstagramTitleSource(value = '') {
  const lines = String(value || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => stripText(stripInstagramEmoji(line)))
    .filter(Boolean);

  const kept = [];
  for (const line of lines) {
    if (/^(?:[#@][\w.]+(?:\s+[#@][\w.]+)*)$/i.test(line)) continue;
    let cleaned = line
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/(?:^|\s)[#@][\w.]+/g, ' ')
      .replace(/\b(?:comment|dm)\s+the\s+word\s+\w+\b.*$/i, ' ')
      .replace(/^(?:video|post|reel|carousel)\s+by\s+[\w.]+\s*[:-]?\s*/i, ' ');
    cleaned = stripText(cleaned);
    if (!cleaned) continue;
    kept.push(cleaned);
    if (kept.length >= 2) break;
  }

  const sentence = kept.join(' ').split(/(?<=[.!?])\s+/)[0] || '';
  const words = stripText(sentence).split(/\s+/).filter(Boolean);
  return words.slice(0, 9).join(' ').slice(0, 80).trim().replace(/[.,:;!?\-]+$/g, '');
}

function getInstagramMediaTypeLabel(resourceType = '') {
  switch (resourceType) {
    case 'instagram_reel':
      return 'Reel';
    case 'instagram_carousel':
      return 'Carousel';
    case 'instagram_post':
      return 'Post';
    default:
      return 'Post';
  }
}

export function buildInstagramDisplayTitleFromData({
  resourceType = '',
  authorHandle = '',
  caption = '',
  transcript = '',
  publishedAt = '',
} = {}) {
  const handle = normalizeInstagramHandle(authorHandle);
  const creatorLabel = handle ? `@${handle}` : '';
  const topic = cleanInstagramTitleSource(caption) || cleanInstagramTitleSource(transcript);
  const mediaLabel = getInstagramMediaTypeLabel(resourceType);
  const dateLabel = stripText(publishedAt).slice(0, 10);

  if (creatorLabel && topic) return `${creatorLabel} - ${topic}`;
  if (creatorLabel) return `${creatorLabel} - ${mediaLabel}`;
  if (dateLabel) return `Instagram ${mediaLabel} - ${dateLabel}`;
  return `Instagram ${mediaLabel}`;
}

function normalizeMaybeNumber(value) {
  if (value == null || value === '') return null;
  const normalized = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeIsoDate(value = '') {
  const text = stripText(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function stripXmlTags(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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

function getJsonLdAuthorName(author) {
  if (!author) return '';
  if (typeof author === 'string') return stripText(author);
  if (Array.isArray(author)) {
    return dedupeStrings(author.map((entry) => (
      typeof entry === 'string' ? entry : entry?.name || ''
    )), 1)[0] || '';
  }
  return stripText(author?.name || author?.author?.name || '');
}

function extractJsonLdMetadata(jsonLdItems = []) {
  const titles = [];
  const descriptions = [];
  const articleBodies = [];
  const authors = [];
  const keywords = [];
  const publishedDates = [];
  const thumbnails = [];
  const siteNames = [];
  const dois = [];
  const publishers = [];

  for (const item of jsonLdItems) {
    const graphItems = Array.isArray(item?.['@graph']) ? item['@graph'] : [item];
    for (const entry of graphItems.filter(Boolean)) {
      titles.push(
        entry?.headline,
        entry?.name,
        entry?.alternativeHeadline,
      );
      descriptions.push(entry?.description, entry?.abstract);
      articleBodies.push(entry?.articleBody, entry?.text);
      authors.push(getJsonLdAuthorName(entry?.author), getJsonLdAuthorName(entry?.creator));
      keywords.push(entry?.keywords, entry?.about?.name, entry?.publisher?.name);
      publishedDates.push(entry?.datePublished, entry?.dateCreated, entry?.dateModified);
      dois.push(entry?.identifier, entry?.doi);
      publishers.push(entry?.publisher?.name);
      thumbnails.push(
        typeof entry?.image === 'string' ? entry.image : entry?.image?.url,
        entry?.thumbnailUrl,
      );
      siteNames.push(entry?.publisher?.name, entry?.isPartOf?.name);
    }
  }

  return {
    title: dedupeStrings(titles, 1)[0] || '',
    description: dedupeStrings(descriptions, 1)[0] || '',
    articleBody: normalizeLongText(dedupeStrings(articleBodies, 1)[0] || '', 20000),
    author: dedupeStrings(authors, 1)[0] || '',
    keywords: normalizeKeywordValues(keywords, 12),
    publishedDate: dedupeStrings(publishedDates, 1)[0] || '',
    thumbnail: dedupeStrings(thumbnails, 1)[0] || '',
    siteName: dedupeStrings(siteNames, 1)[0] || '',
    doi: dedupeStrings(dois, 1)[0] || '',
    publisher: dedupeStrings(publishers, 1)[0] || '',
  };
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

function extractCandidateText(candidate) {
  if (!candidate) return '';
  const blockSelectors = ['h1', 'h2', 'h3', 'p', 'blockquote', 'pre', 'figcaption', 'li'];
  const pieces = blockSelectors
    .flatMap((selector) => [...candidate.querySelectorAll(selector)])
    .map((node) => normalizeLongText(node?.textContent || '', 1200))
    .filter((text) => text.length >= 40)
    .slice(0, 160);

  if (pieces.length >= 4) {
    return normalizeLongText(dedupeStrings(pieces, 160).join('\n\n'), 25000);
  }

  return normalizeLongText(candidate.textContent || '', 25000);
}

function scoreTextCandidate(text = '') {
  const normalized = stripText(text);
  if (!normalized) return -Infinity;
  const paragraphishSegments = normalized
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 60);
  const sentenceCount = countMatches(normalized, /[.!?](?:\s|$)/g);
  const linkyNoise = countMatches(normalized, /\b(?:home|about|pricing|login|signup|contact|privacy|terms|cookie|download|share)\b/gi);
  return (
    Math.min(normalized.length, 12000)
    + (paragraphishSegments.length * 220)
    + (sentenceCount * 30)
    - (linkyNoise * 180)
  );
}

function extractMainText(document) {
  const removable = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe', 'svg', 'form', 'button'];
  for (const tag of removable) {
    const els = document.querySelectorAll(tag);
    for (const el of els) el.remove();
  }

  const candidates = [
    document.querySelector('main article'),
    document.querySelector('article'),
    document.querySelector('main'),
    document.querySelector('[role="main"]'),
    ...document.querySelectorAll('[itemprop="articleBody"], .post-content, .entry-content, .article-content, .content, .markdown-body'),
    document.querySelector('body'),
  ].filter(Boolean);

  return candidates
    .map((candidate) => extractCandidateText(candidate))
    .sort((a, b) => scoreTextCandidate(b) - scoreTextCandidate(a))[0] || '';
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

function buildWebsiteStructuredContent({
  title = '',
  description = '',
  author = '',
  publishedDate = '',
  jsonLdSummary = '',
  articleBody = '',
}) {
  return normalizeLongText([
    title ? `Title: ${title}` : '',
    description ? `Description: ${description}` : '',
    author ? `Author: ${author}` : '',
    publishedDate ? `Published: ${publishedDate}` : '',
    articleBody ? `Article body:\n${articleBody}` : '',
    jsonLdSummary ? `Structured data:\n${jsonLdSummary}` : '',
  ].filter(Boolean).join('\n\n'), 20000);
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

function parseGitHubRepo(url = '') {
  try {
    const parsed = new URL(url);
    if (!/github\.com$/i.test(parsed.hostname.replace(/^www\./, ''))) return null;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;
    return {
      owner,
      repo: repo.replace(/\.git$/i, ''),
    };
  } catch {
    return null;
  }
}

async function fetchGitHubRepoData(url, meta = {}, jsonLdMetadata = {}) {
  const parsedRepo = parseGitHubRepo(url);
  if (!parsedRepo) return null;

  const { owner, repo } = parsedRepo;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let repoPayload = null;
  let readmePayload = null;

  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers,
      signal: AbortSignal.timeout(12000),
    });
    if (response.ok) repoPayload = await response.json();
  } catch {
    // ignore
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`, {
      headers,
      signal: AbortSignal.timeout(12000),
    });
    if (response.ok) readmePayload = await response.json();
  } catch {
    // ignore
  }

  let readmeExcerpt = '';
  const encodedReadme = typeof readmePayload?.content === 'string' ? readmePayload.content.replace(/\n/g, '') : '';
  if (encodedReadme) {
    try {
      readmeExcerpt = normalizeLongText(Buffer.from(encodedReadme, 'base64').toString('utf8'), 10000);
    } catch {
      readmeExcerpt = '';
    }
  }

  const topics = normalizeKeywordValues(repoPayload?.topics || [], 12);
  const description = stripText(repoPayload?.description || meta.description || meta['og:description'] || jsonLdMetadata.description || '');
  const content = normalizeLongText([
    description ? `Repository description: ${description}` : '',
    topics.length ? `Topics: ${topics.join(', ')}` : '',
    readmeExcerpt ? `README excerpt:\n${readmeExcerpt}` : '',
  ].filter(Boolean).join('\n\n'), 24000);

  return {
    owner,
    repoName: repo,
    description,
    readmeExcerpt,
    primaryLanguage: stripText(repoPayload?.language || ''),
    topics,
    stars: normalizeMaybeNumber(repoPayload?.stargazers_count),
    forks: normalizeMaybeNumber(repoPayload?.forks_count),
    openIssues: normalizeMaybeNumber(repoPayload?.open_issues_count),
    lastPushAt: normalizeIsoDate(repoPayload?.pushed_at || ''),
    license: stripText(repoPayload?.license?.spdx_id || repoPayload?.license?.name || ''),
    status: repoPayload?.archived ? 'deprecated' : (repoPayload ? 'active' : 'unknown'),
    author: stripText(repoPayload?.owner?.login || owner),
    title: repo,
    thumbnail: stripText(repoPayload?.owner?.avatar_url || meta['og:image'] || ''),
    keywords: topics,
    content,
    publishedDate: normalizeIsoDate(repoPayload?.created_at || ''),
  };
}

function parseArxivId(url = '') {
  const match = String(url || '').match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+?)(?:\.pdf)?$/i);
  return match?.[1] || '';
}

function parseDoiValue(value = '') {
  const decoded = decodeURIComponent(String(value || ''));
  const doiMatch = decoded.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return doiMatch?.[0] || '';
}

function derivePaperIdentifiers(url = '', meta = {}, jsonLdMetadata = {}) {
  return {
    arxivId: parseArxivId(url) || stripText(meta['citation_arxiv_id'] || ''),
    doi: parseDoiValue(url)
      || parseDoiValue(meta['citation_doi'] || '')
      || parseDoiValue(meta['dc.identifier'] || '')
      || parseDoiValue(jsonLdMetadata?.doi || ''),
  };
}

async function fetchArxivPaperData(arxivId = '') {
  if (!arxivId) return null;
  try {
    const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    const xml = await response.text();
    const title = stripXmlTags(xml.match(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>/i)?.[1] || '');
    const abstract = stripXmlTags(xml.match(/<entry>[\s\S]*?<summary>([\s\S]*?)<\/summary>/i)?.[1] || '');
    const published = stripXmlTags(xml.match(/<entry>[\s\S]*?<published>([\s\S]*?)<\/published>/i)?.[1] || '');
    const authors = [...xml.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi)].map((entry) => stripXmlTags(entry[1]));
    return {
      title,
      abstract,
      authors: dedupeStrings(authors, 12),
      venue: 'arXiv',
      year: normalizeMaybeNumber((published.match(/\b(19|20)\d{2}\b/) || [])[0]),
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      publishedDate: normalizeIsoDate(published),
    };
  } catch {
    return null;
  }
}

async function fetchCrossrefPaperData(doi = '') {
  if (!doi) return null;
  try {
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const message = payload?.message || {};
    const authors = toArray(message.author).map((author) => stripText([author?.given, author?.family].filter(Boolean).join(' ')));
    const publishedParts = message['published-print']?.['date-parts']?.[0]
      || message['published-online']?.['date-parts']?.[0]
      || message.created?.['date-parts']?.[0]
      || [];
    const publishedDate = publishedParts.length ? normalizeIsoDate(new Date(...publishedParts.map((part, index) => (index === 1 ? part - 1 : part))).toISOString()) : '';
    return {
      title: stripText(toArray(message.title)[0] || ''),
      abstract: stripXmlTags(message.abstract || ''),
      authors: dedupeStrings(authors, 12),
      venue: stripText(toArray(message['container-title'])[0] || message.publisher || ''),
      year: normalizeMaybeNumber(publishedParts[0]),
      pdfUrl: stripText(toArray(message.link).find((entry) => /pdf/i.test(entry?.content_type || ''))?.URL || ''),
      publishedDate,
      keywords: normalizeKeywordValues(message.subject || [], 12),
    };
  } catch {
    return null;
  }
}

async function fetchResearchPaperData(url, meta = {}, jsonLdMetadata = {}) {
  const identifiers = derivePaperIdentifiers(url, meta, jsonLdMetadata);
  const [arxivData, crossrefData] = await Promise.all([
    fetchArxivPaperData(identifiers.arxivId),
    fetchCrossrefPaperData(identifiers.doi),
  ]);
  const authors = dedupeStrings([
    ...(crossrefData?.authors || []),
    ...(arxivData?.authors || []),
    stripText(meta['citation_author'] || ''),
    stripText(jsonLdMetadata.author || ''),
  ], 12);
  const abstract = stripText(crossrefData?.abstract || arxivData?.abstract || meta['citation_abstract'] || jsonLdMetadata.description || meta.description || '');
  const title = normalizeTitleCandidate(
    crossrefData?.title || arxivData?.title || meta['citation_title'] || jsonLdMetadata.title || meta['og:title'] || '',
    meta['og:site_name'] || jsonLdMetadata.siteName || '',
  );
  const keywords = normalizeKeywordValues([
    ...(crossrefData?.keywords || []),
    meta['citation_keywords'] || '',
    ...(jsonLdMetadata.keywords || []),
  ], 12);
  const sectionsExcerpt = normalizeLongText([
    abstract ? `Abstract: ${abstract}` : '',
    crossrefData?.venue ? `Venue: ${crossrefData.venue}` : (arxivData?.venue ? `Venue: ${arxivData.venue}` : ''),
  ].filter(Boolean).join('\n\n'), 12000);
  const content = normalizeLongText([
    title ? `Paper title: ${title}` : '',
    authors.length ? `Authors: ${authors.join(', ')}` : '',
    abstract ? `Abstract:\n${abstract}` : '',
    sectionsExcerpt && sectionsExcerpt !== abstract ? `Details:\n${sectionsExcerpt}` : '',
  ].filter(Boolean).join('\n\n'), 24000);

  return {
    title,
    authors,
    abstract,
    venue: stripText(crossrefData?.venue || arxivData?.venue || meta['citation_journal_title'] || jsonLdMetadata.publisher || ''),
    year: normalizeMaybeNumber(crossrefData?.year || arxivData?.year || (meta['citation_publication_date'] || '').match(/\b(19|20)\d{2}\b/)?.[0]),
    doi: identifiers.doi,
    arxivId: identifiers.arxivId,
    pdfUrl: stripText(crossrefData?.pdfUrl || arxivData?.pdfUrl || ''),
    keywords,
    sectionsExcerpt,
    publishedDate: normalizeIsoDate(crossrefData?.publishedDate || arxivData?.publishedDate || meta['citation_publication_date'] || ''),
    content,
  };
}

async function fetchPdfData(url, meta = {}, jsonLdMetadata = {}) {
  const details = {
    title: normalizeTitleCandidate(meta['og:title'] || jsonLdMetadata.title || '', meta['og:site_name'] || ''),
    author: stripText(meta.author || meta['dc.creator'] || jsonLdMetadata.author || ''),
    pageCount: null,
    textExcerpt: '',
    tableOfContents: [],
    keywords: normalizeKeywordValues([meta.keywords || '', ...(jsonLdMetadata.keywords || [])], 12),
    creationDate: normalizeIsoDate(meta['article:published_time'] || ''),
  };

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return details;
    const bytes = await response.arrayBuffer();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false });
    const pdf = await loadingTask.promise;
    details.pageCount = pdf.numPages || null;
    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 5); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      const pageText = normalizeLongText(
        toArray(text.items)
          .map((item) => String(item?.str || ''))
          .join(' '),
        5000,
      );
      if (pageText) pageTexts.push(pageText);
    }
    details.textExcerpt = normalizeLongText(pageTexts.join('\n\n'), 16000);
    if (!details.title) {
      details.title = stripText(pdf?._pdfInfo?.info?.Title || '');
    }
    if (!details.author) {
      details.author = stripText(pdf?._pdfInfo?.info?.Author || '');
    }
    if (!details.creationDate) {
      details.creationDate = stripText(pdf?._pdfInfo?.info?.CreationDate || '');
    }
  } catch {
    // keep metadata-only PDF details
  }

  return details;
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

function runExecFile(file, args, { timeoutMs = DEFAULT_YTDLP_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || 'Command failed.').trim()));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function rankSubtitleLanguage(language = '') {
  const normalized = String(language || '').toLowerCase();
  if (normalized === 'en') return 100;
  if (/^en[-_]/.test(normalized)) return 90;
  if (normalized.includes('orig')) return 40;
  if (normalized.includes('auto')) return 10;
  return 20;
}

function chooseBestSubtitleLanguage(subtitles = {}, automaticCaptions = {}) {
  const manualEntries = Object.entries(subtitles || {})
    .sort((left, right) => rankSubtitleLanguage(right[0]) - rankSubtitleLanguage(left[0]));
  const autoEntries = Object.entries(automaticCaptions || {})
    .sort((left, right) => rankSubtitleLanguage(right[0]) - rankSubtitleLanguage(left[0]));

  if (manualEntries.length > 0) {
    return {
      mode: 'manual',
      language: manualEntries[0][0],
      preferred: /^en(?:[-_].+)?$/i.test(manualEntries[0][0]),
    };
  }

  if (autoEntries.length > 0) {
    return {
      mode: 'auto',
      language: autoEntries[0][0],
      preferred: /^en(?:[-_].+)?$/i.test(autoEntries[0][0]),
    };
  }

  return null;
}

function pushTranscriptCue(cues, cueLines = []) {
  const uniqueLines = [];
  let previousLineKey = '';

  for (const line of cueLines) {
    const cleaned = stripText(line);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (key === previousLineKey) continue;
    previousLineKey = key;
    uniqueLines.push(cleaned);
  }

  if (!uniqueLines.length) return;

  const cue = normalizeTranscriptText(uniqueLines.join('\n'), 2000);
  if (!cue) return;

  const lastCue = cues[cues.length - 1];
  if (lastCue && lastCue.toLowerCase() === cue.toLowerCase()) return;
  cues.push(cue);
}

function parseVttTranscript(text = '') {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  const cues = [];
  let cueLines = [];
  let skipBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pushTranscriptCue(cues, cueLines);
      cueLines = [];
      skipBlock = false;
      continue;
    }
    if (/^WEBVTT/i.test(line)) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(line)) {
      pushTranscriptCue(cues, cueLines);
      cueLines = [];
      skipBlock = true;
      continue;
    }
    if (skipBlock) continue;
    if (/^\d+$/.test(line)) continue;
    if (/^\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?\.\d{3}/.test(line)) {
      pushTranscriptCue(cues, cueLines);
      cueLines = [];
      continue;
    }

    const cleaned = stripText(
      decodeHtmlEntities(
        line
          .replace(/<[^>]+>/g, ' ')
          .replace(/\{\\an\d+\}/g, ' ')
      ),
    );
    if (!cleaned) continue;
    cueLines.push(cleaned);
  }

  pushTranscriptCue(cues, cueLines);

  return normalizeTranscriptText(cues.join('\n\n'), MAX_STORED_CONTENT_CHARS);
}

async function fetchYoutubeTranscriptViaYtDlp(normalizedUrl) {
  const ytdlpBin = String(process.env.YTDLP_BIN || DEFAULT_YTDLP_BIN).trim() || DEFAULT_YTDLP_BIN;
  const timeoutMs = Number(process.env.YTDLP_TIMEOUT_MS || DEFAULT_YTDLP_TIMEOUT_MS);

  let tempDir = '';
  try {
    const metadataResult = await runExecFile(ytdlpBin, [
      '--dump-single-json',
      '--skip-download',
      '--no-warnings',
      normalizedUrl,
    ], { timeoutMs });
    const metadata = JSON.parse(metadataResult.stdout || '{}');
    const selected = chooseBestSubtitleLanguage(metadata.subtitles, metadata.automatic_captions);
    if (!selected?.language) {
      return { transcript: '', language: '', status: 'no_subtitles', error: 'yt-dlp found no subtitle tracks for this video.' };
    }

    tempDir = await mkdtemp(join(tmpdir(), 'lifeos-ytdlp-'));
    const outputTemplate = join(tempDir, 'transcript.%(ext)s');
    const subtitleArgs = [
      '--skip-download',
      '--no-warnings',
      '--output', outputTemplate,
      '--sub-langs', selected.language,
      '--sub-format', 'vtt',
    ];
    if (selected.mode === 'manual') subtitleArgs.push('--write-subs');
    else subtitleArgs.push('--write-auto-subs');
    subtitleArgs.push(normalizedUrl);

    await runExecFile(ytdlpBin, subtitleArgs, { timeoutMs });
    const files = await readdir(tempDir);
    const subtitleFile = files.find((file) => file.endsWith('.vtt'));
    if (!subtitleFile) {
      return {
        transcript: '',
        language: selected.language,
        status: 'subtitle_download_empty',
        error: `yt-dlp selected ${selected.mode} subtitles (${selected.language}) but no VTT subtitle file was created.`,
      };
    }

    const vtt = await readFile(join(tempDir, subtitleFile), 'utf8');
    const transcript = parseVttTranscript(vtt);
    return {
      transcript,
      language: selected.language,
      status: transcript ? 'ok' : 'subtitle_parse_empty',
      error: transcript ? '' : `yt-dlp downloaded ${selected.mode} subtitles (${selected.language}) but the parsed transcript was empty.`,
      selectedMode: selected.mode,
      preferredLanguage: Boolean(selected.preferred),
    };
  } catch (error) {
    const message = String(error?.message || '');
    if (/not found/i.test(message) || /enoent/i.test(message)) {
      return { transcript: '', language: '', status: 'missing_binary', error: `yt-dlp is not installed or not available at "${ytdlpBin}".` };
    }
    if (/timed out/i.test(message)) {
      return { transcript: '', language: '', status: 'timeout', error: `yt-dlp timed out after ${timeoutMs}ms.` };
    }
    return { transcript: '', language: '', status: 'error', error: message || 'yt-dlp transcript extraction failed.' };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function fetchYoutubeTranscriptViaWorker(normalizedUrl) {
  try {
    const result = await requestYouTubeTranscript({ url: normalizedUrl });
    return {
      transcript: normalizeLongText(result.transcript || '', MAX_STORED_CONTENT_CHARS),
      language: String(result.language || ''),
      status: String(result.status || (result.success ? 'ok' : 'error')),
      error: String(result.error || ''),
      transcriptSource: String(result.transcript_source || 'worker_youtube_transcript_api'),
      selectedMode: String(result.selected_mode || ''),
    };
  } catch (error) {
    return {
      transcript: '',
      language: '',
      status: 'worker_unavailable',
      error: error instanceof Error ? error.message : String(error),
      transcriptSource: 'worker_youtube_transcript_api',
      selectedMode: '',
    };
  }
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
  const workerTranscriptResult = await fetchYoutubeTranscriptViaWorker(normalizedUrl);
  const fromWatchPage = workerTranscriptResult.transcript
    ? { transcript: '', language: '' }
    : await fetchYoutubeTranscriptFromWatchPage(normalizedUrl, html);
  const innertubeResult = workerTranscriptResult.transcript || fromWatchPage.transcript
    ? { transcript: '', language: '', playerResponse: null }
    : await fetchYoutubeTranscriptFromInnertube(videoId, html);
  const ytdlpResult = workerTranscriptResult.transcript || fromWatchPage.transcript || innertubeResult.transcript
    ? { transcript: '', language: '', status: '', error: '', selectedMode: false }
    : await fetchYoutubeTranscriptViaYtDlp(normalizedUrl);
  const playerResponse = innertubeResult.playerResponse || initialPlayerResponse || {};
  const videoDetails = playerResponse?.videoDetails || {};
  const microformat = playerResponse?.microformat?.playerMicroformatRenderer || {};
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

  const transcriptCandidates = [
    { transcript: workerTranscriptResult.transcript, language: workerTranscriptResult.language, source: workerTranscriptResult.transcriptSource || 'worker_youtube_transcript_api' },
    { transcript: fromWatchPage.transcript, language: fromWatchPage.language, source: 'legacy_direct' },
    { transcript: innertubeResult.transcript, language: innertubeResult.language, source: 'legacy_direct' },
    { transcript: ytdlpResult.transcript, language: ytdlpResult.language, source: 'yt_dlp' },
  ];
  const bestDirectTranscript = transcriptCandidates.find((entry) => stripText(entry.transcript)) || { transcript: '', language: '', source: '' };
  const fallbackTranscript = bestDirectTranscript.transcript
    ? { transcript: '', language: '' }
    : await fetchYoutubeTranscriptViaSupadata(normalizedUrl);
  const transcript = bestDirectTranscript.transcript || fallbackTranscript.transcript;
  const language = bestDirectTranscript.language || fallbackTranscript.language;
  const transcriptStatus = workerTranscriptResult.transcript
    ? (workerTranscriptResult.status || 'ok')
    : (fromWatchPage.transcript
      ? 'ok'
      : (innertubeResult.transcript
        ? 'ok'
        : (ytdlpResult.transcript
          ? (ytdlpResult.status || 'ok')
          : (workerTranscriptResult.status || ytdlpResult.status || (bestDirectTranscript.transcript ? 'ok' : (fallbackTranscript.transcript ? 'ok' : ''))))));
  const transcriptError = workerTranscriptResult.transcript
    ? (workerTranscriptResult.error || '')
    : (fromWatchPage.transcript
      ? ''
      : (innertubeResult.transcript
        ? ''
        : (ytdlpResult.transcript ? (ytdlpResult.error || '') : (workerTranscriptResult.error || ytdlpResult.error || ''))));
  const transcriptSource = workerTranscriptResult.transcript
    ? (workerTranscriptResult.transcriptSource || 'worker_youtube_transcript_api')
    : (fromWatchPage.transcript
      ? 'legacy_direct'
      : (innertubeResult.transcript
        ? 'legacy_direct'
        : (ytdlpResult.transcript
          ? 'yt_dlp'
          : (workerTranscriptResult.status
            ? (workerTranscriptResult.transcriptSource || 'worker_youtube_transcript_api')
            : (bestDirectTranscript.source || (fallbackTranscript.transcript ? 'supadata' : ''))))));
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
    publishedDate: normalizeIsoDate(microformat?.publishDate || microformat?.uploadDate || ''),
    transcript,
    language,
    transcriptStatus,
    transcriptError,
    transcriptSource,
    youtubeAiSummary,
    videoId,
    channel: stripText(videoDetails?.author || oembed?.author_name || ''),
    durationSeconds: normalizeMaybeNumber(videoDetails?.lengthSeconds),
    viewCount: normalizeMaybeNumber(videoDetails?.viewCount),
    captionLanguage: language,
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
  const audioTitle = getString(root, 'audio_title', 'audioTitle', 'music_title', 'musicTitle', 'audio_name');
  const likeCount = getNumber(root, 'like_count', 'likeCount', 'likes');
  const commentCount = getNumber(root, 'comment_count', 'commentCount', 'comments');

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
    audioTitle,
    likeCount,
    commentCount,
    slideCount: mediaItems.length || null,
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
      audioTitle: '',
      likeCount: null,
      commentCount: null,
      slideCount: null,
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
  let jsonLdMetadata = {};
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
    jsonLdMetadata = extractJsonLdMetadata(jsonLdItems);
    title = normalizeTitleCandidate(
      meta['og:title']
      || meta['twitter:title']
      || jsonLdMetadata.title
      || document.querySelector('title')?.textContent
      || '',
      meta['og:site_name'] || jsonLdMetadata.siteName || '',
    );
    bodyText = extractMainText(document);
    thumbnail = meta['og:image'] || meta['twitter:image'] || jsonLdMetadata.thumbnail || extractJsonLdImage(jsonLdItems) || '';
    author = meta.author || meta['article:author'] || jsonLdMetadata.author || '';
    description = stripText(meta.description || meta['og:description'] || meta['twitter:description'] || jsonLdMetadata.description || '');
    keywords = normalizeKeywordValues([
      meta.keywords || '',
      meta['article:tag'] || '',
      ...(jsonLdMetadata.keywords || []),
    ], 12);
    publishedDate = meta['article:published_time'] || jsonLdMetadata.publishedDate || '';
  } catch {
    // keep partial metadata flow alive
  }

  const cleanedBodyText = looksLikeLowQualityHtmlText(bodyText) ? '' : bodyText;
  const structuredWebsiteContent = buildWebsiteStructuredContent({
    title,
    description,
    author,
    publishedDate,
    jsonLdSummary,
    articleBody: jsonLdMetadata.articleBody || '',
  });
  const metadataFallbackContent = buildMetadataFallbackContent({ title, description, jsonLdSummary });
  const githubData = resourceType === 'github_repo' ? await fetchGitHubRepoData(canonicalUrl, meta, jsonLdMetadata) : null;
  const researchPaperData = resourceType === 'research_paper' ? await fetchResearchPaperData(canonicalUrl, meta, jsonLdMetadata) : null;
  const pdfData = resourceType === 'pdf' ? await fetchPdfData(canonicalUrl, meta, jsonLdMetadata) : null;

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
      jsonLdMetadata,
      youtubeAiSummary: youtube.youtubeAiSummary || '',
      youtubeData: youtube,
      redditThreadData: null,
      instagramExtraction: null,
      githubData: null,
      researchPaperData: null,
      pdfData: null,
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
      content: redditContent || cleanedBodyText || metadataFallbackContent,
      contentSource: redditContent ? 'reddit_thread' : (cleanedBodyText ? 'html_text' : (metadataFallbackContent ? 'metadata_description' : 'metadata_only')),
      contentLanguage: redditContent ? 'en' : '',
      resourceType,
      meta,
      jsonLdSummary,
      jsonLdMetadata,
      redditThreadData,
      instagramExtraction: null,
      githubData: null,
      researchPaperData: null,
      pdfData: null,
      isRedditThread: Boolean(redditThreadData),
    };
  }

  if (resourceType === 'instagram_reel' || resourceType === 'instagram_carousel') {
    const instagramDisplayTitle = buildInstagramDisplayTitleFromData({
      resourceType: instagramExtraction?.resourceType || resourceType,
      authorHandle: instagramExtraction?.authorHandle || '',
      caption: instagramExtraction?.caption || '',
      transcript: instagramExtraction?.transcript || '',
      publishedAt: instagramExtraction?.publishedAt || '',
    });
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
      title: instagramDisplayTitle || title,
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
      jsonLdMetadata,
      redditThreadData: null,
      instagramExtraction,
      githubData: null,
      researchPaperData: null,
      pdfData: null,
      isRedditThread: false,
    };
  }

  if (resourceType === 'github_repo') {
    return {
      canonicalUrl,
      title: githubData?.title || title,
      author: githubData?.author || author,
      thumbnail: githubData?.thumbnail || thumbnail,
      description: githubData?.description || description,
      keywords: githubData?.keywords || keywords,
      publishedDate: githubData?.publishedDate || publishedDate,
      content: githubData?.content || cleanedBodyText || structuredWebsiteContent || metadataFallbackContent,
      contentSource: githubData?.content ? 'github_readme' : (cleanedBodyText ? 'html_text' : (structuredWebsiteContent ? 'structured_content' : 'metadata_description')),
      contentLanguage: '',
      resourceType,
      meta,
      jsonLdSummary,
      jsonLdMetadata,
      youtubeAiSummary: '',
      redditThreadData: null,
      instagramExtraction: null,
      githubData,
      researchPaperData: null,
      pdfData: null,
      isRedditThread: false,
    };
  }

  if (resourceType === 'research_paper') {
    return {
      canonicalUrl,
      title: researchPaperData?.title || title,
      author: researchPaperData?.authors?.join(', ') || author,
      thumbnail,
      description: researchPaperData?.abstract || description,
      keywords: researchPaperData?.keywords || keywords,
      publishedDate: researchPaperData?.publishedDate || publishedDate,
      content: researchPaperData?.content || structuredWebsiteContent || cleanedBodyText || metadataFallbackContent,
      contentSource: researchPaperData?.content ? 'research_metadata' : (cleanedBodyText ? 'html_text' : (structuredWebsiteContent ? 'structured_content' : 'metadata_description')),
      contentLanguage: '',
      resourceType,
      meta,
      jsonLdSummary,
      jsonLdMetadata,
      youtubeAiSummary: '',
      redditThreadData: null,
      instagramExtraction: null,
      githubData: null,
      researchPaperData,
      pdfData: null,
      isRedditThread: false,
    };
  }

  if (resourceType === 'pdf') {
    return {
      canonicalUrl,
      title: pdfData?.title || title,
      author: pdfData?.author || author,
      thumbnail,
      description: description || pdfData?.textExcerpt || '',
      keywords: pdfData?.keywords || keywords,
      publishedDate: pdfData?.creationDate || publishedDate,
      content: pdfData?.textExcerpt || structuredWebsiteContent || metadataFallbackContent,
      contentSource: pdfData?.textExcerpt ? 'pdf_text' : (structuredWebsiteContent ? 'structured_content' : (metadataFallbackContent ? 'metadata_description' : 'metadata_only')),
      contentLanguage: '',
      resourceType,
      meta,
      jsonLdSummary,
      jsonLdMetadata,
      youtubeAiSummary: '',
      redditThreadData: null,
      instagramExtraction: null,
      githubData: null,
      researchPaperData: null,
      pdfData,
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
    content: cleanedBodyText || structuredWebsiteContent || metadataFallbackContent,
    contentSource: cleanedBodyText ? 'html_text' : (structuredWebsiteContent ? 'structured_content' : (metadataFallbackContent ? 'metadata_description' : 'metadata_only')),
    contentLanguage: '',
    resourceType,
    meta,
    jsonLdSummary,
    jsonLdMetadata,
    youtubeAiSummary: '',
    redditThreadData: null,
    instagramExtraction: null,
    githubData: null,
    researchPaperData: null,
    pdfData: null,
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
    instagramExtraction.audioTitle ? `Audio Title: ${instagramExtraction.audioTitle}` : '',
    instagramExtraction.likeCount != null ? `Like Count: ${instagramExtraction.likeCount}` : '',
    instagramExtraction.commentCount != null ? `Comment Count: ${instagramExtraction.commentCount}` : '',
    instagramExtraction.caption ? `Caption Excerpt: ${instagramExtraction.caption.slice(0, 500)}` : '',
    instagramExtraction.transcript ? 'Transcript Available: yes' : '',
    instagramExtraction.transcript ? `Transcript Excerpt: ${instagramExtraction.transcript.slice(0, 500)}` : '',
    !instagramExtraction.transcript && instagramExtraction.transcriptError ? `Transcript Status: ${instagramExtraction.transcriptError}` : '',
  ].filter(Boolean).join('\n');
}

function buildYouTubeContext(youtubeData) {
  if (!youtubeData) return '';
  return [
    youtubeData.videoId ? `Video ID: ${youtubeData.videoId}` : '',
    youtubeData.channel ? `Channel: ${youtubeData.channel}` : '',
    youtubeData.durationSeconds != null ? `Duration Seconds: ${youtubeData.durationSeconds}` : '',
    youtubeData.viewCount != null ? `View Count: ${youtubeData.viewCount}` : '',
    youtubeData.publishedDate ? `Published At: ${youtubeData.publishedDate}` : '',
    youtubeData.captionLanguage ? `Caption Language: ${youtubeData.captionLanguage}` : '',
  ].filter(Boolean).join('\n');
}

function buildGitHubContext(githubData) {
  if (!githubData) return '';
  return [
    githubData.owner ? `Owner: ${githubData.owner}` : '',
    githubData.repoName ? `Repository: ${githubData.repoName}` : '',
    githubData.primaryLanguage ? `Primary Language: ${githubData.primaryLanguage}` : '',
    githubData.topics?.length ? `Topics: ${githubData.topics.join(', ')}` : '',
    githubData.stars != null ? `Stars: ${githubData.stars}` : '',
    githubData.forks != null ? `Forks: ${githubData.forks}` : '',
    githubData.openIssues != null ? `Open Issues: ${githubData.openIssues}` : '',
    githubData.lastPushAt ? `Last Push: ${githubData.lastPushAt}` : '',
    githubData.license ? `License: ${githubData.license}` : '',
  ].filter(Boolean).join('\n');
}

function buildPaperContext(researchPaperData) {
  if (!researchPaperData) return '';
  return [
    researchPaperData.authors?.length ? `Authors: ${researchPaperData.authors.join(', ')}` : '',
    researchPaperData.venue ? `Venue: ${researchPaperData.venue}` : '',
    researchPaperData.year != null ? `Year: ${researchPaperData.year}` : '',
    researchPaperData.doi ? `DOI: ${researchPaperData.doi}` : '',
    researchPaperData.arxivId ? `arXiv ID: ${researchPaperData.arxivId}` : '',
    researchPaperData.pdfUrl ? `PDF URL: ${researchPaperData.pdfUrl}` : '',
  ].filter(Boolean).join('\n');
}

function buildPdfContext(pdfData) {
  if (!pdfData) return '';
  return [
    pdfData.pageCount != null ? `Page Count: ${pdfData.pageCount}` : '',
    pdfData.creationDate ? `Creation Date: ${pdfData.creationDate}` : '',
    pdfData.keywords?.length ? `Keywords: ${pdfData.keywords.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function buildWebsiteTypeContext(extracted) {
  const lines = [];
  if (extracted.resourceType === 'article') {
    if (extracted.meta?.['article:section']) lines.push(`Article Section: ${extracted.meta['article:section']}`);
    if (extracted.meta?.['og:site_name']) lines.push(`Site Name: ${extracted.meta['og:site_name']}`);
  }
  if (extracted.resourceType === 'website' && extracted.jsonLdMetadata?.siteName) {
    lines.push(`Website Name: ${extracted.jsonLdMetadata.siteName}`);
  }
  return lines.join('\n');
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
    buildYouTubeContext(extracted.youtubeData) ? `YouTube context:\n${buildYouTubeContext(extracted.youtubeData)}` : '',
    buildRedditContext(extracted.redditThreadData) ? `Reddit context:\n${buildRedditContext(extracted.redditThreadData)}` : '',
    buildInstagramContext(extracted.instagramExtraction) ? `Instagram context:\n${buildInstagramContext(extracted.instagramExtraction)}` : '',
    buildGitHubContext(extracted.githubData) ? `GitHub context:\n${buildGitHubContext(extracted.githubData)}` : '',
    buildPaperContext(extracted.researchPaperData) ? `Paper context:\n${buildPaperContext(extracted.researchPaperData)}` : '',
    buildPdfContext(extracted.pdfData) ? `PDF context:\n${buildPdfContext(extracted.pdfData)}` : '',
    buildWebsiteTypeContext(extracted) ? `Type-specific context:\n${buildWebsiteTypeContext(extracted)}` : '',
    '',
    extracted.content ? `Primary extracted content:\n${normalizeContentForPrompt(extracted.content, MAX_PROMPT_CONTENT_CHARS)}` : 'Primary extracted content: none',
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
    extracted.content ? `Content excerpt:\n${normalizeContentForPrompt(extracted.content, 4000)}` : '',
    'Pick the most specific life area supported by the source.',
    'Use Knowledge only if the resource is truly broad, generic, or lacks a stronger fit.',
    'Return JSON with only area_name, using exactly one of the allowed life area names. If uncertain, still choose the closest fit.',
  ].filter(Boolean).join('\n');

  try {
    const result = await routeStructuredJson({
      taskType: 'generic.structured',
      prompt,
      schema: areaClassificationSchema,
      userId,
      policy: { tier: 'cheap', temperature: 0, maxTokens: 120 },
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

function isContentRichExtraction(extracted) {
  const minimumContentLength = extracted.resourceType === 'reddit' ? 600 : 900;
  return String(extracted.content || '').length >= minimumContentLength;
}

function isDetailModalReady(result, extracted) {
  return hasCoreFraming(result) && getStructuredSectionCount(result) >= 2;
}

function getRichSectionCount(result) {
  return [
    normalizeStringArray(result.key_points, 6).length > 0,
    normalizeStringArray(result.actionable_points, 5).length > 0,
    normalizeStringArray(result.use_cases, 5).length > 0,
    normalizeStringArray(result.learning_outcomes, 4).length > 0,
  ].filter(Boolean).length;
}

function getExtractionStrength(extracted) {
  const contentSource = String(extracted.contentSource || '');
  const contentLength = String(extracted.content || '').length;

  if (!contentLength || contentSource === 'metadata_only') return 'weak';

  switch (extracted.resourceType) {
    case 'youtube':
      if (contentSource === 'youtube_transcript') return 'strong';
      if (contentSource === 'youtube_description') return 'degraded';
      return 'weak';
    case 'instagram_reel':
    case 'instagram_carousel':
      if (contentSource === 'instagram_caption_transcript') return 'strong';
      if (contentSource === 'instagram_caption') return 'degraded';
      return 'weak';
    case 'reddit':
      if (contentSource === 'reddit_thread') return 'strong';
      if (contentSource === 'html_text') return 'degraded';
      return 'weak';
    case 'github_repo':
      if (contentSource === 'github_readme') return 'strong';
      if (contentSource === 'html_text' || contentSource === 'structured_content') return 'degraded';
      return 'weak';
    case 'research_paper':
      if (contentSource === 'research_metadata') return 'strong';
      if (contentSource === 'html_text' || contentSource === 'structured_content') return 'degraded';
      return 'weak';
    case 'pdf':
      if (contentSource === 'pdf_text') return 'strong';
      if (contentSource === 'structured_content') return 'degraded';
      return 'weak';
    case 'article':
    case 'website':
      if (contentSource === 'html_text') return 'strong';
      if (contentSource === 'structured_content') return 'degraded';
      return 'weak';
    default:
      if (contentLength >= 1800) return 'strong';
      if (contentLength >= 400) return 'degraded';
      return 'weak';
  }
}

function isRichEnrichment(result, extracted) {
  const hasSummary = Boolean(stripText(result.summary));
  const commentTakeaways = normalizeStringArray(result.reddit_top_comment_summaries, 5).length;

  if (extracted.resourceType === 'reddit') {
    return hasCoreFraming(result) && (getStructuredSectionCount(result) >= 1 || commentTakeaways > 0);
  }

  return hasSummary && hasCoreFraming(result) && getRichSectionCount(result) >= 2;
}

function shouldRepairAnalysis(result, extracted) {
  const extractionStrength = getExtractionStrength(extracted);
  if (extracted.resourceType === 'reddit') {
    return isContentRichExtraction(extracted) && !isRichEnrichment(result, extracted);
  }
  if (extractionStrength !== 'strong') {
    return !isRichEnrichment(result, extracted);
  }
  return isContentRichExtraction(extracted) && !isRichEnrichment(result, extracted);
}

function classifySpecificAreaHeuristically({ extracted, mergedData, areas }) {
  return chooseHeuristicArea({
    areas,
    title: mergedData.title,
    summary: mergedData.summary,
    whyItMatters: mergedData.why_it_matters,
    mainTopic: mergedData.main_topic,
    tags: mergedData.tags,
    description: extracted.description,
    content: extracted.content,
    resourceType: extracted.resourceType,
  }).areaName;
}

function getEnrichmentStatus(result, extracted) {
  const contentLength = String(extracted.content || '').length;
  const structuredSections = getRichSectionCount(result);
  const hasCommentTakeaways = normalizeStringArray(result.reddit_top_comment_summaries, 5).length > 0;
  if (!contentLength) return 'metadata_only';
  if (isRichEnrichment(result, extracted)) return 'rich';
  if (structuredSections >= 1 || hasCoreFraming(result) || hasCommentTakeaways) return 'partial';
  return 'sparse';
}

function buildEnrichmentWarning(mergedData, extracted) {
  const isRich = isRichEnrichment(mergedData, extracted);
  if (isRich) return '';

  switch (extracted.resourceType) {
    case 'youtube':
      if (extracted.contentSource === 'metadata_only') {
        return 'Saved with limited YouTube metadata only. A transcript or detailed description was unavailable, so this enrichment may be incomplete.';
      }
      if (extracted.contentSource === 'youtube_description') {
        return 'Saved using the YouTube description because a transcript was unavailable. Rich sections may be incomplete.';
      }
      return 'Saved from YouTube content, but the enrichment is still incomplete. Review the result before relying on it.';
    case 'instagram_reel':
    case 'instagram_carousel':
      if (extracted.contentSource === 'instagram_caption_transcript') {
        return 'Saved from Instagram content, but the enrichment is still incomplete. Review the result before relying on it.';
      }
      if (extracted.contentSource === 'instagram_caption') {
        return 'Saved using Instagram caption and media metadata because a transcript was unavailable. Rich sections may be incomplete.';
      }
      return 'Saved with limited Instagram metadata only. Caption or transcript extraction was unavailable.';
    case 'article':
    case 'website':
      if (extracted.contentSource === 'html_text') {
        return 'Saved from page text, but the enrichment is still incomplete. Review the result before relying on it.';
      }
      if (extracted.contentSource === 'structured_content') {
        return 'Saved using partial structured page content because full page text extraction was limited. Rich sections may be incomplete.';
      }
      return 'Saved using metadata because full page extraction was unavailable. Rich sections may be incomplete.';
    case 'github_repo':
      if (extracted.contentSource === 'github_readme') {
        return 'Saved from repository content, but the enrichment is still incomplete. Review the result before relying on it.';
      }
      if (extracted.contentSource === 'html_text' || extracted.contentSource === 'structured_content') {
        return 'Saved without a strong GitHub README extraction. Repository metadata or partial page content was used instead.';
      }
      return 'Saved using repository metadata only because README extraction was unavailable.';
    case 'research_paper':
      if (extracted.contentSource === 'research_metadata') {
        return 'Saved from research metadata, but the enrichment is still incomplete. Review the result before relying on it.';
      }
      if (extracted.contentSource === 'html_text' || extracted.contentSource === 'structured_content') {
        return 'Saved using partial paper content because full research extraction was limited. Rich sections may be incomplete.';
      }
      return 'Saved using paper metadata only because stronger research extraction was unavailable.';
    case 'pdf':
      if (extracted.contentSource === 'pdf_text') {
        return 'Saved from PDF text, but the enrichment is still incomplete. Review the result before relying on it.';
      }
      if (extracted.contentSource === 'structured_content') {
        return 'Saved using structured PDF metadata because direct PDF text extraction was limited. Rich sections may be incomplete.';
      }
      return 'Saved using PDF metadata only because text extraction was unavailable.';
    case 'reddit':
      if (extracted.contentSource === 'reddit_thread') {
        return 'Saved from Reddit thread content, but the enrichment is still incomplete. Review the result before relying on it.';
      }
      if (extracted.contentSource === 'html_text') {
        return 'Saved using partial Reddit page text because structured thread extraction was limited. Rich sections may be incomplete.';
      }
      return 'Saved using limited Reddit metadata because stronger thread extraction was unavailable.';
    default:
      if (extracted.contentSource === 'html_text' || extracted.contentSource === 'structured_content') {
        return 'Saved from partial extracted content, but the enrichment is still incomplete. Review the result before relying on it.';
      }
      return 'Saved using limited metadata because stronger extraction was unavailable.';
  }
}

export function resolveAreaAssignment(resultAreaName, areas, mergedData, extracted, { allowKnowledgeFallback = true } = {}) {
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

  if (!matchedArea && allowKnowledgeFallback) {
    matchedArea = areaMap.get('knowledge') || (areas || [])[0] || null;
    matchedByFallback = true;
  }

  if (!matchedArea) {
    return {
      area_id: '',
      area_name: '',
      area_needs_review: false,
    };
  }

  const lowConfidence = (
    matchedByFallback
    || !normalizedAreaName
    || isKnowledgeAreaName(matchedArea?.name || '')
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
  const isYouTube = extracted.resourceType === 'youtube';
  const isGitHub = extracted.resourceType === 'github_repo';
  const isResearchPaper = extracted.resourceType === 'research_paper';
  const isPdf = extracted.resourceType === 'pdf';
  const isArticle = extracted.resourceType === 'article';
  const isWebsite = extracted.resourceType === 'website';
  const instagramExtraction = extracted.instagramExtraction;
  const redditThreadData = extracted.redditThreadData;
  const youtubeData = extracted.youtubeData;
  const githubData = extracted.githubData;
  const researchPaperData = extracted.researchPaperData;
  const pdfData = extracted.pdfData;
  const siteName = stripText(extracted.meta?.['og:site_name'] || extracted.jsonLdMetadata?.siteName || '');
  const enrichmentWarning = buildEnrichmentWarning(mergedData, extracted);

  return {
    ...mergedData,
    score: mergedData.score || 5,
    resource_type: extracted.resourceType,
    url: extracted.canonicalUrl,
    area_id: areaAssignment.area_id,
    area_name: areaAssignment.area_name,
    area_needs_review: areaAssignment.area_needs_review,
    enrichment_status: getEnrichmentStatus(mergedData, extracted),
    enrichment_warning: enrichmentWarning,
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
          reddit_flair: redditThreadData?.flair || '',
          reddit_post_score: redditThreadData?.score ?? null,
          reddit_comment_count: redditThreadData?.commentCount ?? null,
          reddit_post_body: redditThreadData?.selfText || '',
          reddit_top_comments: redditThreadData?.topComments || [],
          reddit_permalink: redditThreadData?.permalink || '',
        }
      : {}),
    ...(isYouTube
      ? {
          youtube_video_id: youtubeData?.videoId || '',
          youtube_channel: youtubeData?.channel || '',
          youtube_duration_seconds: youtubeData?.durationSeconds ?? null,
          youtube_view_count: youtubeData?.viewCount ?? null,
          youtube_publish_date: youtubeData?.publishedDate || '',
          youtube_description: youtubeData?.description || extracted.description || '',
          youtube_transcript: youtubeData?.transcript || extracted.content || '',
          youtube_transcript_status: youtubeData?.transcriptStatus || '',
          youtube_transcript_error: youtubeData?.transcriptError || '',
          youtube_transcript_source: youtubeData?.transcriptSource || '',
          youtube_ai_summary: extracted.youtubeAiSummary || '',
          youtube_keywords: youtubeData?.keywords || extracted.keywords || [],
          youtube_caption_language: youtubeData?.captionLanguage || extracted.contentLanguage || '',
        }
      : {}),
    ...(isInstagram && instagramExtraction
      ? {
          instagram_display_title: buildInstagramDisplayTitleFromData({
            resourceType: instagramExtraction.resourceType,
            authorHandle: instagramExtraction.authorHandle,
            caption: instagramExtraction.caption,
            transcript: instagramExtraction.transcript,
            publishedAt: instagramExtraction.publishedAt,
          }),
          instagram_media_type_label: getInstagramMediaTypeLabel(instagramExtraction.resourceType),
          instagram_author_handle: instagramExtraction.authorHandle || '',
          instagram_caption: instagramExtraction.caption || '',
          instagram_transcript: instagramExtraction.transcript || '',
          instagram_media_items: instagramExtraction.mediaItems || [],
          instagram_audio_title: instagramExtraction.audioTitle || '',
          instagram_posted_at: instagramExtraction.publishedAt || '',
          instagram_like_count: instagramExtraction.likeCount ?? null,
          instagram_comment_count: instagramExtraction.commentCount ?? null,
          instagram_slide_count: instagramExtraction.slideCount ?? null,
          ingestion_source: instagramExtraction.ingestionSource || '',
          ingestion_error: instagramExtraction.transcriptError || '',
        }
      : {}),
    ...(isGitHub
      ? {
          github_owner: githubData?.owner || '',
          github_repo_name: githubData?.repoName || '',
          github_description: githubData?.description || extracted.description || '',
          github_readme_excerpt: githubData?.readmeExcerpt || '',
          github_primary_language: githubData?.primaryLanguage || '',
          github_topics: githubData?.topics || [],
          github_stars: githubData?.stars ?? null,
          github_forks: githubData?.forks ?? null,
          github_open_issues: githubData?.openIssues ?? null,
          github_last_push_at: githubData?.lastPushAt || '',
          github_license: githubData?.license || '',
          github_status: githubData?.status || mergedData.status || 'unknown',
        }
      : {}),
    ...(isResearchPaper
      ? {
          paper_title: researchPaperData?.title || mergedData.title || '',
          paper_authors: researchPaperData?.authors || [],
          paper_abstract: researchPaperData?.abstract || extracted.description || '',
          paper_venue: researchPaperData?.venue || '',
          paper_year: researchPaperData?.year ?? null,
          paper_doi: researchPaperData?.doi || '',
          paper_arxiv_id: researchPaperData?.arxivId || '',
          paper_pdf_url: researchPaperData?.pdfUrl || '',
          paper_keywords: researchPaperData?.keywords || extracted.keywords || [],
          paper_sections_excerpt: researchPaperData?.sectionsExcerpt || extracted.content || '',
        }
      : {}),
    ...(isPdf
      ? {
          pdf_title: pdfData?.title || mergedData.title || '',
          pdf_author: pdfData?.author || extracted.author || '',
          pdf_page_count: pdfData?.pageCount ?? null,
          pdf_text_excerpt: pdfData?.textExcerpt || extracted.content || '',
          pdf_table_of_contents: pdfData?.tableOfContents || [],
          pdf_keywords: pdfData?.keywords || extracted.keywords || [],
          pdf_creation_date: pdfData?.creationDate || extracted.publishedDate || '',
        }
      : {}),
    ...(isArticle
      ? {
          article_title: mergedData.title || extracted.title || '',
          article_author: extracted.author || '',
          article_site_name: siteName,
          article_section: stripText(extracted.meta?.['article:section'] || ''),
          article_published_date: extracted.publishedDate || '',
          article_updated_date: normalizeIsoDate(extracted.meta?.['article:modified_time'] || ''),
          article_description: extracted.description || '',
          article_keywords: extracted.keywords || [],
          article_body_excerpt: normalizeLongText(extracted.content || '', 6000),
        }
      : {}),
    ...(isWebsite
      ? {
          website_title: mergedData.title || extracted.title || '',
          website_site_name: siteName,
          website_description: extracted.description || '',
          website_author: extracted.author || '',
          website_keywords: extracted.keywords || [],
          website_content_kind: extracted.contentSource === 'structured_content' ? 'structured' : (extracted.contentSource === 'html_text' ? 'page_text' : 'metadata'),
          website_structured_summary: extracted.jsonLdSummary || '',
          website_main_text_excerpt: normalizeLongText(extracted.content || '', 6000),
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
        jsonLdMetadata: {},
        youtubeAiSummary: '',
        youtubeData: null,
        redditThreadData: null,
        instagramExtraction: null,
        githubData: null,
        researchPaperData: null,
        pdfData: null,
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
      groundWithGoogleSearch: false,
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

  if (shouldRepairAnalysis(result.data, extracted)) {
    try {
      result = await routeStructuredJson({
        taskType: 'resource.analyze',
        prompt: [
          prompt,
          '',
          'REPAIR PASS:',
          'The previous output was too sparse for a content-rich source.',
          'Rebuild the enrichment so it is detail-modal ready.',
          'Required minimum:',
          '- non-empty summary',
          '- non-empty why_it_matters',
          '- non-empty who_its_for',
          '- at least 2 of these 3 populated: key_points, actionable_points, use_cases',
          'Choose the most specific life area supported by the content. Do not default to Knowledge when a closer fit exists.',
          `Previous sparse output: ${JSON.stringify(result.data).slice(0, 3000)}`,
        ].join('\n'),
        schema: resourceSchema,
        userId,
        groundWithGoogleSearch: false,
        metadata: {
          requestSummary: `resource-repair:${normalizedInputUrl}`,
        },
      });
    } catch {
      // keep prior result
    }
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
  let areaAssignment = resolveAreaAssignment(resolvedAreaName, areas, mergedData, extracted, { allowKnowledgeFallback: false });
  if ((!resolvedAreaName || !areaAssignment.area_id || isKnowledgeAreaName(areaAssignment.area_name)) && areas.length) {
    const secondPassAreaName = await classifyAreaFromContent({
      extracted,
      mergedData,
      areas,
      userId,
    });
    if (secondPassAreaName) {
      resolvedAreaName = secondPassAreaName;
      areaAssignment = resolveAreaAssignment(secondPassAreaName, areas, mergedData, extracted, { allowKnowledgeFallback: false });
    }
  }
  if ((!areaAssignment.area_id || isKnowledgeAreaName(areaAssignment.area_name) || areaAssignment.area_needs_review)
    && areas.some((area) => !isKnowledgeAreaName(area.name))) {
    const heuristicAreaName = classifySpecificAreaHeuristically({ extracted, mergedData, areas });
    if (heuristicAreaName) {
      const heuristicAssignment = resolveAreaAssignment(heuristicAreaName, areas, mergedData, extracted, { allowKnowledgeFallback: false });
      if (heuristicAssignment.area_name && !isKnowledgeAreaName(heuristicAssignment.area_name)) {
        areaAssignment = {
          ...heuristicAssignment,
          area_needs_review: true,
        };
      }
    }
  }
  if (!areaAssignment.area_id && areas.length) {
    areaAssignment = resolveAreaAssignment('Knowledge', areas, mergedData, extracted, { allowKnowledgeFallback: true });
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

export function preserveStrongerExistingData(resource, analyzedData) {
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
    nextData.enrichment_warning = resource.enrichment_warning || nextData.enrichment_warning || '';
  }

  if (existingHasArea && !existingIsKnowledge && nextIsWeak) {
    return {
      ...nextData,
      area_id: resource.area_id || '',
      area_name: resource.area_name || '',
      area_needs_review: Boolean(resource.area_needs_review),
    };
  }

  if (
    existingHasArea
    && !existingIsKnowledge
    && stripText(resource.area_name) !== stripText(nextData.area_name)
    && Boolean(analyzedData.area_needs_review)
  ) {
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
    const isInstagramResource = ['instagram_reel', 'instagram_carousel'].includes(String(resource.resource_type || ''));
    if (!resourceUrl || !isValidHttpUrl(resourceUrl) || resource.resource_type === 'note' || isInstagramResource) {
      skipped += 1;
      items.push({
        id: resource.id,
        status: 'skipped',
        reason: isInstagramResource
          ? 'Instagram resources are excluded from backend re-enrichment.'
          : 'Resource does not have a re-enrichable URL.',
      });
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
      if (shouldQueueYouTubeTranscriptBackfill(nextData) || shouldQueueYouTubeTranscriptBackfill(resource)) {
        try {
          const { maybeQueueYouTubeTranscriptJobForResource } = await import('./instagram-download-queue.js');
          await maybeQueueYouTubeTranscriptJobForResource(userId, {
            ...resource,
            ...nextData,
            id: resource.id,
            source_url: resource.source_url || resource.url || '',
          });
        } catch {
          // Keep re-enrichment independent from transcript backfill.
        }
      }
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
