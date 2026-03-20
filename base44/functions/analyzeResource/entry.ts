import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { parseHTML } from 'npm:linkedom@0.16.11';
import * as pdfjsLib from 'npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs';
import { fetchInstagramExtraction, isInstagramUrl, resolveInstagramCanonicalUrl, type InstagramExtraction, type InstagramMediaItem } from '../_shared/instagram/entry.ts';

const MAX_PROMPT_CONTENT_CHARS = 16000;
const MAX_STORED_CONTENT_CHARS = 60000;
const ANALYSIS_VERSION = 'resource-enrichment-v3';
const EXTRA_RESOURCE_FIELDS = [
  'content_source',
  'content_language',
  'content_extracted_at',
  'content_truncated',
  'analysis_version',
  'enrichment_status',
];

type ResourceType =
  | 'website'
  | 'github_repo'
  | 'youtube'
  | 'reddit'
  | 'research_paper'
  | 'pdf'
  | 'article'
  | 'instagram_reel'
  | 'instagram_carousel';
type ContentSource =
  | 'youtube_transcript'
  | 'html_text'
  | 'reddit_thread'
  | 'pdf_text'
  | 'instagram_caption'
  | 'instagram_caption_transcript'
  | 'metadata_only';

type RedditCommentSummary = {
  author: string;
  score: number | null;
  body: string;
};

type RedditThreadData = {
  title: string;
  subreddit: string;
  author: string;
  selfText: string;
  score: number | null;
  commentCount: number | null;
  thumbnail: string;
  flair: string;
  permalink: string;
  topComments: RedditCommentSummary[];
};

type PageExtraction = {
  html: string;
  meta: Record<string, string>;
  jsonLdItems: any[];
  jsonLdSummary: string;
  jsonLdImage: string;
  pageText: string;
  fetchedThumbnail: string;
};

type ExtractedContent = {
  content: string;
  content_source: ContentSource;
  content_language: string;
  content_extracted_at: string;
  content_truncated: boolean;
};

type AnalysisContext = {
  normalizedUrl: string;
  resource_type: ResourceType;
  isGitHub: boolean;
  isYoutube: boolean;
  isReddit: boolean;
  isInstagram: boolean;
  page: PageExtraction;
  redditThreadData: RedditThreadData | null;
  instagramExtraction: InstagramExtraction | null;
  githubStars: number | null;
  lastCommitDate: string | null;
  extractedContent: ExtractedContent;
};

function extractMetaTags(document: any): Record<string, string> {
  const meta: Record<string, string> = {};
  const metaTags = document.querySelectorAll('meta');
  for (const tag of metaTags) {
    const property = tag.getAttribute('property') || tag.getAttribute('name') || '';
    const content = tag.getAttribute('content') || '';
    if (property && content) meta[property.toLowerCase()] = content;
  }
  return meta;
}

function extractJsonLd(document: any): any[] {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const results = [];
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      if (Array.isArray(data)) results.push(...data);
      else results.push(data);
    } catch {
      // Skip malformed JSON-LD.
    }
  }
  return results;
}

function normalizeText(value: string, limit = MAX_STORED_CONTENT_CHARS) {
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

function extractMainContent(document: any): string {
  const removeTags = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe', 'svg'];
  for (const tag of removeTags) {
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
    .map((candidate) => normalizeText(candidate?.textContent || '', 25000))
    .sort((a, b) => b.length - a.length)[0] || '';
}

function summarizeJsonLd(jsonLdItems: any[]): string {
  if (jsonLdItems.length === 0) return '';
  const lines = [];
  for (const item of jsonLdItems.slice(0, 3)) {
    const type = item['@type'] || 'Unknown';
    lines.push(`Schema.org Type: ${Array.isArray(type) ? type.join(', ') : type}`);
    if (item.name) lines.push(`  Name: ${item.name}`);
    if (item.headline) lines.push(`  Headline: ${item.headline}`);
    if (item.description) lines.push(`  Description: ${String(item.description).slice(0, 300)}`);
    if (item.author) {
      const author = typeof item.author === 'string' ? item.author : (item.author?.name || JSON.stringify(item.author));
      lines.push(`  Author: ${author}`);
    }
    if (item.publisher?.name) lines.push(`  Publisher: ${item.publisher.name}`);
    if (item.datePublished) lines.push(`  Published: ${item.datePublished}`);
    if (item.dateModified) lines.push(`  Modified: ${item.dateModified}`);
    if (item.image) {
      const img = typeof item.image === 'string' ? item.image : (item.image?.url || item.image?.[0]?.url || item.image?.[0] || '');
      if (img) lines.push(`  Image: ${img}`);
    }
  }
  return lines.join('\n');
}

function extractJsonLdImage(jsonLdItems: any[]): string {
  for (const item of jsonLdItems) {
    if (item.image) {
      if (typeof item.image === 'string') return item.image;
      if (item.image?.url) return item.image.url;
      if (Array.isArray(item.image) && item.image[0]) {
        return typeof item.image[0] === 'string' ? item.image[0] : item.image[0]?.url || '';
      }
    }
    if (item.thumbnailUrl) return item.thumbnailUrl;
  }
  return '';
}

const HAS_SCHEME_RE = /^[a-z][a-z\d+\-.]*:\/\//i;
const DOMAIN_LIKE_RE = /^(localhost(?::\d+)?|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?:[/:?#].*)?$/iu;

function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeResourceUrl(input: string) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  if (isValidHttpUrl(trimmed)) return trimmed;
  if (HAS_SCHEME_RE.test(trimmed)) return trimmed;
  if (!DOMAIN_LIKE_RE.test(trimmed) || /\s/.test(trimmed)) return trimmed;
  const normalized = `https://${trimmed}`;
  return isValidHttpUrl(normalized) ? normalized : trimmed;
}

function truncateForPrompt(value: string, limit = MAX_PROMPT_CONTENT_CHARS) {
  return String(value || '').slice(0, limit);
}

function isSchemaIssue(error: unknown) {
  const message = String((error as Error)?.message || '');
  return /field|column|schema|unknown|invalid/i.test(message);
}

function stripUnsupportedFields<T extends Record<string, unknown>>(value: T) {
  const copy = { ...value };
  for (const field of EXTRA_RESOURCE_FIELDS) delete copy[field];
  return copy;
}

function detectResourceType(normalizedUrl: string): ResourceType {
  const lowerUrl = normalizedUrl.toLowerCase();
  if (/github\.com\/[^/]+\/[^/]/.test(lowerUrl)) return 'github_repo';
  if (/youtube\.com|youtu\.be/.test(lowerUrl)) return 'youtube';
  if (/reddit\.com/.test(lowerUrl)) return 'reddit';
  if (isInstagramUrl(lowerUrl)) return lowerUrl.includes('/reel/') ? 'instagram_reel' : 'instagram_carousel';
  if (/arxiv\.org|scholar\.google|doi\.org|pubmed|researchgate|semanticscholar/.test(lowerUrl)) return 'research_paper';
  if (/\.pdf(\?|$)/i.test(lowerUrl)) return 'pdf';
  if (/bbc\.|cnn\.|reuters\.|nytimes\.|theguardian\.|techcrunch\.|theverge\.|arstechnica\.|wired\.|bloomberg\.|washingtonpost\.|forbes\.|apnews\.|news\./i.test(lowerUrl)) return 'article';
  return 'website';
}

function buildDefaultExtraction(): ExtractedContent {
  return {
    content: '',
    content_source: 'metadata_only',
    content_language: '',
    content_extracted_at: new Date().toISOString(),
    content_truncated: false,
  };
}

function isRedditThreadUrl(url: string) {
  return /reddit\.com\/r\/[^/]+\/comments\/[^/]+/i.test(url);
}

function normalizeRedditText(value: string, limit = 800) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function pickRedditThumbnail(post: Record<string, unknown>) {
  const preview = post.preview as { images?: Array<{ source?: { url?: string } }> } | undefined;
  const candidate = preview?.images?.[0]?.source?.url;
  if (candidate) return normalizeRedditText(candidate, 1000);
  const thumb = String(post.thumbnail || '').trim();
  if (thumb && /^https?:\/\//i.test(thumb)) return thumb;
  return '';
}

async function fetchRedditThreadData(normalizedUrl: string): Promise<RedditThreadData | null> {
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
      .filter((entry: any) => entry?.kind === 't1' && entry?.data?.body)
      .slice(0, 8)
      .map((entry: any) => ({
        author: String(entry.data.author || ''),
        score: typeof entry.data.score === 'number' ? entry.data.score : null,
        body: normalizeRedditText(entry.data.body, 500),
      }))
      .filter((entry: RedditCommentSummary) => entry.body);

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
      topComments,
    };
  } catch {
    return null;
  }
}

async function fetchPageExtraction(normalizedUrl: string): Promise<PageExtraction> {
  const page: PageExtraction = {
    html: '',
    meta: {},
    jsonLdItems: [],
    jsonLdSummary: '',
    jsonLdImage: '',
    pageText: '',
    fetchedThumbnail: '',
  };

  try {
    const pageRes = await fetch(normalizedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!pageRes.ok) return page;
    const html = await pageRes.text();
    const { document } = parseHTML(html) as unknown as { document: any };
    const meta = extractMetaTags(document);
    const jsonLdItems = extractJsonLd(document);
    const jsonLdSummary = summarizeJsonLd(jsonLdItems);
    const jsonLdImage = extractJsonLdImage(jsonLdItems);
    const pageText = extractMainContent(document);
    let fetchedThumbnail = meta['og:image'] || meta['twitter:image'] || jsonLdImage || '';
    if (fetchedThumbnail && !fetchedThumbnail.startsWith('http')) {
      const origin = new URL(normalizedUrl).origin;
      fetchedThumbnail = fetchedThumbnail.startsWith('/') ? origin + fetchedThumbnail : origin + '/' + fetchedThumbnail;
    }
    return { html, meta, jsonLdItems, jsonLdSummary, jsonLdImage, pageText, fetchedThumbnail };
  } catch {
    return page;
  }
}

function extractYoutubeVideoId(normalizedUrl: string) {
  try {
    const url = new URL(normalizedUrl);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (url.searchParams.get('v')) return url.searchParams.get('v') || '';
    const shortMatch = url.pathname.match(/\/shorts\/([^/?]+)/);
    if (shortMatch) return shortMatch[1];
  } catch {
    // ignore
  }
  const match = normalizedUrl.match(/(?:v=|youtu\.be\/|\/shorts\/)([^&?/]+)/);
  return match?.[1] || '';
}

function extractPlayerResponseFromHtml(html: string) {
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
      // Continue.
    }
  }
  return null;
}

function extractTranscriptTextFromEvents(payload: any) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const parts = [];
  for (const event of events) {
    const segs = Array.isArray(event?.segs) ? event.segs : [];
    const text = segs.map((seg: any) => String(seg?.utf8 || '')).join('').replace(/\n/g, ' ').trim();
    if (text) parts.push(text);
  }
  return normalizeText(parts.join(' '), MAX_STORED_CONTENT_CHARS);
}

async function fetchYoutubeTranscriptFromWatchPage(normalizedUrl: string, html: string): Promise<ExtractedContent | null> {
  const playerResponse = extractPlayerResponseFromHtml(html);
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const selectedTrack = [...tracks].sort((a, b) => {
    const aGenerated = a?.kind === 'asr' ? 1 : 0;
    const bGenerated = b?.kind === 'asr' ? 1 : 0;
    return aGenerated - bGenerated;
  })[0];

  const baseUrl = String(selectedTrack?.baseUrl || '');
  if (!baseUrl) return null;

  try {
    const transcriptRes = await fetch(`${baseUrl}&fmt=json3`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!transcriptRes.ok) return null;
    const payload = await transcriptRes.json();
    const content = extractTranscriptTextFromEvents(payload);
    if (!content) return null;
    return {
      content,
      content_source: 'youtube_transcript',
      content_language: String(selectedTrack?.languageCode || ''),
      content_extracted_at: new Date().toISOString(),
      content_truncated: content.length >= MAX_STORED_CONTENT_CHARS,
    };
  } catch {
    return null;
  }
}

async function fetchYoutubeTranscriptViaSupadata(normalizedUrl: string): Promise<ExtractedContent | null> {
  const apiKey = Deno.env.get('SUPADATA_API_KEY');
  if (!apiKey) return null;
  try {
    const response = await fetch(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(normalizedUrl)}&text=true&mode=native`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload?.content) return null;
    const content = normalizeText(payload.content, MAX_STORED_CONTENT_CHARS);
    return {
      content,
      content_source: 'youtube_transcript',
      content_language: String(payload?.lang || ''),
      content_extracted_at: new Date().toISOString(),
      content_truncated: content.length >= MAX_STORED_CONTENT_CHARS,
    };
  } catch {
    return null;
  }
}

async function extractPdfText(normalizedUrl: string): Promise<ExtractedContent | null> {
  try {
    const res = await fetch(normalizedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer } as any).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => ('str' in item ? String(item.str || '') : '')).join(' ').trim();
      if (pageText) pages.push(pageText);
    }
    const content = normalizeText(pages.join('\n\n'), MAX_STORED_CONTENT_CHARS);
    if (!content) return null;
    return {
      content,
      content_source: 'pdf_text',
      content_language: '',
      content_extracted_at: new Date().toISOString(),
      content_truncated: content.length >= MAX_STORED_CONTENT_CHARS,
    };
  } catch {
    return null;
  }
}

function buildRedditContent(redditThreadData: RedditThreadData | null) {
  if (!redditThreadData) return '';
  return normalizeText([
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

function buildInstagramContent(instagramExtraction: InstagramExtraction | null): ExtractedContent {
  if (!instagramExtraction) return buildDefaultExtraction();

  const caption = normalizeText(instagramExtraction.caption || '', 12000);
  const transcript = normalizeText(instagramExtraction.transcript || '', 32000);
  const mediaSummary = instagramExtraction.mediaItems.length > 0
    ? `Media Items: ${instagramExtraction.mediaItems.map((item: InstagramMediaItem, index: number) => {
      const parts = [
        `${index + 1}. ${item.type}`,
        item.duration_seconds != null ? `${item.duration_seconds}s` : '',
        item.width && item.height ? `${item.width}x${item.height}` : '',
      ].filter(Boolean);
      return parts.join(' ');
    }).join(' | ')}`
    : '';

  const content = normalizeText([
    instagramExtraction.authorHandle ? `Author: @${instagramExtraction.authorHandle}` : '',
    caption ? `Caption:\n${caption}` : '',
    transcript ? `Transcript:\n${transcript}` : '',
    mediaSummary,
  ].filter(Boolean).join('\n\n'), MAX_STORED_CONTENT_CHARS);

  if (!content) return buildDefaultExtraction();

  return {
    content,
    content_source: transcript ? 'instagram_caption_transcript' : caption ? 'instagram_caption' : 'metadata_only',
    content_language: '',
    content_extracted_at: new Date().toISOString(),
    content_truncated: content.length >= MAX_STORED_CONTENT_CHARS,
  };
}

async function fetchGithubMetadata(normalizedUrl: string) {
  let githubStars = null;
  let lastCommitDate = null;
  try {
    const match = normalizedUrl.match(/github\.com\/([^/]+)\/([^/?\s#]+)/);
    if (!match) return { githubStars, lastCommitDate };
    const apiRes = await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!apiRes.ok) return { githubStars, lastCommitDate };
    const apiData = await apiRes.json();
    githubStars = apiData.stargazers_count || null;
    lastCommitDate = apiData.pushed_at || null;
  } catch {
    // ignore
  }
  return { githubStars, lastCommitDate };
}

async function extractResourceContent(
  normalizedUrl: string,
  resource_type: ResourceType,
  page: PageExtraction,
  redditThreadData: RedditThreadData | null,
  instagramExtraction: InstagramExtraction | null,
): Promise<ExtractedContent> {
  if (resource_type === 'youtube') {
    const fromPage = await fetchYoutubeTranscriptFromWatchPage(normalizedUrl, page.html);
    if (fromPage) return fromPage;
    const fromSupadata = await fetchYoutubeTranscriptViaSupadata(normalizedUrl);
    if (fromSupadata) return fromSupadata;
    return buildDefaultExtraction();
  }

  if (resource_type === 'reddit') {
    const content = buildRedditContent(redditThreadData);
    if (content) {
      return {
        content,
        content_source: 'reddit_thread',
        content_language: 'en',
        content_extracted_at: new Date().toISOString(),
        content_truncated: content.length >= MAX_STORED_CONTENT_CHARS,
      };
    }
    return buildDefaultExtraction();
  }

  if (resource_type === 'instagram_reel' || resource_type === 'instagram_carousel') {
    return buildInstagramContent(instagramExtraction);
  }

  if (resource_type === 'pdf') {
    const pdfExtraction = await extractPdfText(normalizedUrl);
    if (pdfExtraction) return pdfExtraction;
    return buildDefaultExtraction();
  }

  const htmlContent = normalizeText(page.pageText, MAX_STORED_CONTENT_CHARS);
  if (htmlContent) {
    return {
      content: htmlContent,
      content_source: 'html_text',
      content_language: '',
      content_extracted_at: new Date().toISOString(),
      content_truncated: htmlContent.length >= MAX_STORED_CONTENT_CHARS,
    };
  }
  return buildDefaultExtraction();
}

function buildMetadataContext(page: PageExtraction) {
  const { meta } = page;
  return [
    meta['og:title'] ? `Page Title: ${meta['og:title']}` : '',
    meta['og:site_name'] ? `Site Name: ${meta['og:site_name']}` : '',
    meta.description ? `Meta Description: ${meta.description}` : '',
    meta['og:description'] ? `OG Description: ${meta['og:description']}` : '',
    meta['og:type'] ? `OG Type: ${meta['og:type']}` : '',
    meta['article:published_time'] ? `Article Published: ${meta['article:published_time']}` : '',
    meta['article:author'] ? `Article Author: ${meta['article:author']}` : '',
    meta['article:section'] ? `Article Section: ${meta['article:section']}` : '',
  ].filter(Boolean).join('\n');
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength = 240) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

function normalizeAnalysisResult(result: Record<string, unknown>) {
  return {
    ...result,
    title: String(result.title || '').trim(),
    author: String(result.author || '').trim(),
    published_date: String(result.published_date || '').trim(),
    thumbnail: String(result.thumbnail || '').trim(),
    summary: String(result.summary || '').trim(),
    why_it_matters: String(result.why_it_matters || '').trim(),
    who_its_for: String(result.who_its_for || '').trim(),
    main_topic: String(result.main_topic || '').trim(),
    area_name: String(result.area_name || '').trim(),
    explanation_for_newbies: String(result.explanation_for_newbies || '').trim(),
    status: String(result.status || '').trim(),
    reddit_thread_type: String(result.reddit_thread_type || '').trim(),
    resource_score: Number(result.resource_score || 0) || 0,
    key_points: normalizeStringArray(result.key_points, 6),
    actionable_points: normalizeStringArray(result.actionable_points, 5),
    use_cases: normalizeStringArray(result.use_cases, 5),
    learning_outcomes: normalizeStringArray(result.learning_outcomes, 4),
    notable_quotes_or_moments: normalizeStringArray(result.notable_quotes_or_moments, 3),
    tags: normalizeStringArray(result.tags, 8, 40),
    reddit_top_comment_summaries: normalizeStringArray(result.reddit_top_comment_summaries, 5),
  };
}

function hasStructuredPreview(result: Record<string, unknown>) {
  return (
    normalizeStringArray(result.key_points, 1).length > 0 ||
    normalizeStringArray(result.actionable_points, 1).length > 0 ||
    normalizeStringArray(result.use_cases, 1).length > 0
  );
}

function hasCoreFraming(result: Record<string, unknown>) {
  return Boolean(String(result.why_it_matters || '').trim()) && Boolean(String(result.who_its_for || '').trim());
}

function hasSummary(result: Record<string, unknown>) {
  return Boolean(String(result.summary || '').trim());
}

function getStructuredSectionCount(result: Record<string, unknown>) {
  return [
    normalizeStringArray(result.key_points, 6).length > 0,
    normalizeStringArray(result.actionable_points, 5).length > 0,
    normalizeStringArray(result.use_cases, 5).length > 0,
  ].filter(Boolean).length;
}

function hasRequiredRedditTakeaways(result: Record<string, unknown>, context: AnalysisContext) {
  const neededCommentSummaries = Math.min(3, context.redditThreadData?.topComments?.length || 0);
  const commentSummaryCount = normalizeStringArray(result.reddit_top_comment_summaries, 5).length;
  if (!context.isReddit || neededCommentSummaries === 0) return true;
  return commentSummaryCount >= Math.min(2, neededCommentSummaries);
}

function isContentRichContext(context: AnalysisContext) {
  const contentLength = String(context.extractedContent.content || '').length;
  const minimumContentLength = context.resource_type === 'reddit' ? 600 : 900;
  return contentLength >= minimumContentLength;
}

function isDetailModalReady(result: Record<string, unknown>, context: AnalysisContext) {
  return (
    hasSummary(result) &&
    hasCoreFraming(result) &&
    getStructuredSectionCount(result) >= 2 &&
    hasRequiredRedditTakeaways(result, context)
  );
}

function getEnrichmentStatus(result: Record<string, unknown>, context: AnalysisContext) {
  const contentLength = String(context.extractedContent.content || '').length;
  const structuredSections = getStructuredSectionCount(result);
  const hasCommentTakeaways = normalizeStringArray(result.reddit_top_comment_summaries, 5).length > 0;
  const rich = isDetailModalReady(result, context);

  if (rich) return 'rich';
  if (!contentLength) return 'metadata_only';
  if (hasStructuredPreview(result) || hasCoreFraming(result) || hasCommentTakeaways) return 'partial';
  return 'sparse';
}

function shouldRepairAnalysis(result: Record<string, unknown>, context: AnalysisContext) {
  return isContentRichContext(context) && !isDetailModalReady(result, context);
}

function buildRedditContext(redditThreadData: RedditThreadData | null) {
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

function buildInstagramContext(instagramExtraction: InstagramExtraction | null) {
  if (!instagramExtraction) return '';
  return [
    instagramExtraction.postKind ? `Post Kind: ${instagramExtraction.postKind}` : '',
    instagramExtraction.authorHandle ? `Author Handle: @${instagramExtraction.authorHandle}` : '',
    instagramExtraction.publishedAt ? `Published At: ${instagramExtraction.publishedAt}` : '',
    instagramExtraction.mediaItems.length > 0 ? `Media Count: ${instagramExtraction.mediaItems.length}` : '',
    instagramExtraction.transcript ? 'Transcript Available: yes' : '',
    !instagramExtraction.transcript && instagramExtraction.transcriptError ? `Transcript Status: ${instagramExtraction.transcriptError}` : '',
  ].filter(Boolean).join('\n');
}

function buildInstagramFallbackTitle(resourceType: ResourceType, instagramExtraction: InstagramExtraction | null, normalizedUrl: string) {
  const captionTitle = normalizeText(instagramExtraction?.caption || '', 120);
  if (captionTitle) return captionTitle;
  if (instagramExtraction?.authorHandle) {
    return resourceType === 'instagram_reel'
      ? `Instagram Reel by @${instagramExtraction.authorHandle}`
      : `Instagram Carousel by @${instagramExtraction.authorHandle}`;
  }
  return normalizedUrl;
}

async function analyzeExtractedContent(base44: any, areas: any[], context: AnalysisContext) {
  const areaMap: Record<string, string> = {};
  const areaNames = [];
  for (const area of areas) {
    areaMap[area.name.toLowerCase()] = area.id;
    areaNames.push(area.name);
  }

  const { normalizedUrl, resource_type, isGitHub, isYoutube, isReddit, isInstagram, page, redditThreadData, instagramExtraction, extractedContent } = context;
  const isToolLike = isGitHub || resource_type === 'website';
  const metadataContext = buildMetadataContext(page);
  const redditContext = buildRedditContext(redditThreadData);
  const instagramContext = buildInstagramContext(instagramExtraction);
  const prompt = [
    'You are an expert web content analyst. Analyze the following saved resource thoroughly.',
    '',
    `URL: ${normalizedUrl}`,
    `Detected Resource Type: ${resource_type}`,
    `Extracted Content Source: ${extractedContent.content_source}`,
    extractedContent.content_language ? `Extracted Content Language: ${extractedContent.content_language}` : '',
    '',
    extractedContent.content ? `── PRIMARY EXTRACTED CONTENT ──\n${truncateForPrompt(extractedContent.content)}\n` : '',
    metadataContext ? `── Open Graph & Meta Tags ──\n${metadataContext}\n` : '',
    page.jsonLdSummary ? `── Structured Data (Schema.org / JSON-LD) ──\n${page.jsonLdSummary}\n` : '',
    redditContext ? `── Reddit Thread Context ──\n${redditContext}\n` : '',
    instagramContext ? `── Instagram Context ──\n${instagramContext}\n` : '',
    'ANALYSIS INSTRUCTIONS:',
    '1. If PRIMARY EXTRACTED CONTENT is present, treat it as the main source of truth.',
    '2. Use structured data and meta tags to validate title, author, date, and framing details.',
    '3. If extracted content and metadata conflict, prefer the extracted content for substance and metadata for canonical labels.',
    '4. If no extracted content exists, use the available metadata and internet context conservatively.',
    isReddit ? '5. For Reddit threads, analyze the original post separately from the comment discussion. Treat comments as community signals, not guaranteed facts.' : '5. NEVER hallucinate. If something is not supported by extracted content or metadata, leave it empty or conservative.',
    isYoutube ? '6. For YouTube, the transcript is the primary source when present. Do not invent timestamps, scenes, or quotes not supported by the transcript.' : '6. For notable quotes or moments, only include items directly supported by extracted content.',
    isInstagram ? '7. For Instagram reels and posts, use the saved caption and transcript as the main source. Do not invent visuals, hooks, narration, or lessons that are not in the extracted content.' : '',
    '',
    `You must assign this resource to exactly ONE of these life areas: ${areaNames.join(', ')}`,
    '',
    'Extract the following:',
    '- title',
    '- author',
    '- published_date',
    '- thumbnail',
    '- summary: concise 2-3 sentences',
    '- why_it_matters: 1-2 sentences',
    '- who_its_for: short audience description',
    '- key_points: 3-6 concise takeaways for normal content-rich sources; only empty for genuinely thin sources',
    '- actionable_points: 2-5 concrete next steps for normal content-rich sources; only empty for genuinely thin sources',
    '- use_cases: 2-4 revisit scenarios for normal content-rich sources; only empty for genuinely thin sources',
    '- learning_outcomes',
    '- notable_quotes_or_moments',
    '- main_topic',
    '- tags',
    '- resource_score',
    `- area_name: exactly one of ${areaNames.join(', ')}`,
    isReddit ? '- reddit_thread_type' : '',
    isReddit ? '- reddit_top_comment_summaries: 2-5 concise takeaways from the strongest top comments when comments are present' : '',
    isToolLike ? '- explanation_for_newbies' : '',
    isToolLike ? '- status: one of "active", "beta", "deprecated", "unknown"' : '',
    '',
    'If the source has substantial transcript/body content, do not return only a summary. Populate at least one of key_points, actionable_points, or use_cases, and usually all three.',
    isReddit ? 'For Reddit threads with meaningful post text or comments, usually return all of key_points, actionable_points, use_cases, and reddit_top_comment_summaries.' : '',
  ].filter(Boolean).join('\n');

  const responseSchema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      author: { type: 'string' },
      published_date: { type: 'string' },
      thumbnail: { type: 'string' },
      summary: { type: 'string' },
      why_it_matters: { type: 'string' },
      who_its_for: { type: 'string' },
      key_points: { type: 'array', items: { type: 'string' } },
      actionable_points: { type: 'array', items: { type: 'string' } },
      use_cases: { type: 'array', items: { type: 'string' } },
      learning_outcomes: { type: 'array', items: { type: 'string' } },
      notable_quotes_or_moments: { type: 'array', items: { type: 'string' } },
      main_topic: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      resource_score: { type: 'number' },
      area_name: { type: 'string' },
      ...(isReddit
        ? {
            reddit_thread_type: { type: 'string' },
            reddit_top_comment_summaries: { type: 'array', items: { type: 'string' } },
          }
        : {}),
      ...(isToolLike
        ? {
            explanation_for_newbies: { type: 'string' },
            status: { type: 'string' },
          }
        : {}),
    },
  };

  const initialResult = normalizeAnalysisResult(await base44.integrations.Core.InvokeLLM({
    prompt,
    add_context_from_internet: true,
    response_json_schema: responseSchema,
    model: 'gemini_3_pro',
  }));

  const repairedResult = shouldRepairAnalysis(initialResult, context)
    ? normalizeAnalysisResult(await base44.integrations.Core.InvokeLLM({
        prompt: [
          prompt,
          '',
          'REPAIR PASS:',
          'The previous output was too sparse for a content-rich source.',
          'Rebuild the structured enrichment so the resource is detail-modal ready.',
          'Required minimum for content-rich sources:',
          '- a non-empty summary',
          '- a non-empty why_it_matters',
          '- a non-empty who_its_for',
          '- at least 2 of these 3 populated: key_points, actionable_points, use_cases',
          isReddit ? '- reddit_top_comment_summaries when top comments exist' : '',
          'Do not leave fields empty if they can be inferred directly from the extracted content.',
          `Previous sparse output: ${JSON.stringify(initialResult)}`,
        ].filter(Boolean).join('\n'),
        add_context_from_internet: true,
        response_json_schema: responseSchema,
        model: 'gemini_3_pro',
      }))
    : initialResult;

  const result = shouldRepairAnalysis(repairedResult, context)
    ? normalizeAnalysisResult(await base44.integrations.Core.InvokeLLM({
        prompt: [
          prompt,
          '',
          'RECONSTRUCTION PASS:',
          'The previous attempts still failed the detail-modal ready threshold.',
          'Reconstruct the full enrichment from the extracted content with emphasis on completeness and direct support.',
          'Return a result that satisfies all of the following:',
          '- summary present',
          '- why_it_matters present',
          '- who_its_for present',
          '- at least 2 of key_points, actionable_points, use_cases populated',
          isReddit ? '- reddit_top_comment_summaries populated when top comments exist' : '',
          'Avoid generic filler. Use only information supported by the extracted content and metadata.',
          `Previous attempt: ${JSON.stringify(repairedResult)}`,
        ].filter(Boolean).join('\n'),
        add_context_from_internet: true,
        response_json_schema: responseSchema,
        model: 'gemini_3_pro',
      }))
    : repairedResult;

  const aiAreaName = String(result.area_name || '').toLowerCase();
  let area_id = areaMap[aiAreaName] || null;
  if (!area_id) {
    for (const [name, id] of Object.entries(areaMap)) {
      if (aiAreaName.includes(name) || name.includes(aiAreaName)) {
        area_id = id;
        break;
      }
    }
  }
  if (!area_id) area_id = areaMap.knowledge || areas[0]?.id || null;
  return { result, area_id };
}

function resolveThumbnail(normalizedUrl: string, context: AnalysisContext, llmResult: any) {
  const { resource_type, isGitHub, page, redditThreadData, instagramExtraction } = context;
  let thumbnail = instagramExtraction?.thumbnailUrl || redditThreadData?.thumbnail || page.fetchedThumbnail || llmResult.thumbnail || '';
  if (isGitHub && !thumbnail) {
    const match = normalizedUrl.match(/github\.com\/([^/]+)\/([^/?\s#]+)/);
    if (match) thumbnail = `https://opengraph.githubassets.com/1/${match[1]}/${match[2]}`;
  }
  if (resource_type === 'youtube' && !thumbnail) {
    const videoId = extractYoutubeVideoId(normalizedUrl);
    if (videoId) thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  }
  if (!thumbnail) {
    try {
      const origin = new URL(normalizedUrl).origin;
      thumbnail = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=128`;
    } catch {
      // ignore
    }
  }
  return thumbnail;
}

async function createResourceWithFallbacks(base44: any, payload: Record<string, unknown>) {
  try {
    return await base44.asServiceRole.entities.Resource.create(payload);
  } catch (error) {
    if (!isSchemaIssue(error)) throw error;
    return await base44.asServiceRole.entities.Resource.create(stripUnsupportedFields(payload));
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { url, project_id } = await req.json();
    const normalizedUrl = normalizeResourceUrl(url);
    if (!normalizedUrl) return Response.json({ error: 'URL is required' }, { status: 400 });
    if (!isValidHttpUrl(normalizedUrl)) {
      return Response.json({ error: 'Please provide a valid http(s) URL.' }, { status: 400 });
    }

    const canonicalInstagramUrl = isInstagramUrl(normalizedUrl)
      ? await resolveInstagramCanonicalUrl(normalizedUrl)
      : normalizedUrl;

    const resource_type = detectResourceType(canonicalInstagramUrl);
    const isGitHub = resource_type === 'github_repo';
    const isYoutube = resource_type === 'youtube';
    const isReddit = resource_type === 'reddit';
    const isInstagram = resource_type === 'instagram_reel' || resource_type === 'instagram_carousel';

    const [areas, page, redditThreadData, githubMeta, instagramExtraction] = await Promise.all([
      base44.asServiceRole.entities.LifeArea.filter({}),
      fetchPageExtraction(canonicalInstagramUrl),
      isReddit ? fetchRedditThreadData(canonicalInstagramUrl) : Promise.resolve(null),
      isGitHub ? fetchGithubMetadata(canonicalInstagramUrl) : Promise.resolve({ githubStars: null, lastCommitDate: null }),
      isInstagram ? fetchInstagramExtraction(canonicalInstagramUrl) : Promise.resolve(null),
    ]);

    const resourceUrl = instagramExtraction?.canonicalUrl || canonicalInstagramUrl;

    if (isInstagram && !instagramExtraction) {
      return Response.json({ error: 'Instagram link was detected, but Instagram extraction could not complete.' }, { status: 422 });
    }

    const extractedContent = await extractResourceContent(resourceUrl, resource_type, page, redditThreadData, instagramExtraction);
    const context: AnalysisContext = {
      normalizedUrl: resourceUrl,
      resource_type,
      isGitHub,
      isYoutube,
      isReddit,
      isInstagram,
      page,
      redditThreadData,
      instagramExtraction,
      githubStars: githubMeta.githubStars,
      lastCommitDate: githubMeta.lastCommitDate,
      extractedContent,
    };

    const { result, area_id } = await analyzeExtractedContent(base44, areas, context);
    const thumbnail = resolveThumbnail(resourceUrl, context, result);
    const enrichment_status = getEnrichmentStatus(result, context);

    const resourceData = {
      title: result.title || redditThreadData?.title || buildInstagramFallbackTitle(resource_type, instagramExtraction, resourceUrl),
      url: resourceUrl,
      resource_type,
      thumbnail,
      author: result.author
        || (isReddit && redditThreadData?.subreddit ? `r/${redditThreadData.subreddit}` : '')
        || (isInstagram && instagramExtraction?.authorHandle ? `@${instagramExtraction.authorHandle}` : ''),
      published_date: result.published_date || instagramExtraction?.publishedAt || '',
      summary: result.summary || '',
      why_it_matters: result.why_it_matters || '',
      who_its_for: result.who_its_for || '',
      key_points: result.key_points || [],
      actionable_points: result.actionable_points || [],
      use_cases: result.use_cases || [],
      learning_outcomes: result.learning_outcomes || [],
      notable_quotes_or_moments: result.notable_quotes_or_moments || [],
      main_topic: result.main_topic || '',
      tags: result.tags || [],
      resource_score: result.resource_score || 5,
      area_id,
      is_archived: false,
      processed_at: new Date().toISOString(),
      analysis_version: ANALYSIS_VERSION,
      enrichment_status,
      content: extractedContent.content || '',
      content_source: extractedContent.content_source,
      content_language: extractedContent.content_language || '',
      content_extracted_at: extractedContent.content_extracted_at,
      content_truncated: Boolean(extractedContent.content_truncated),
      ...(isGitHub || resource_type === 'website'
        ? {
            explanation_for_newbies: result.explanation_for_newbies || '',
            status: result.status || 'unknown',
          }
        : {}),
      ...(isGitHub
        ? {
            github_stars: githubMeta.githubStars,
            last_commit_date: githubMeta.lastCommitDate,
          }
        : {}),
      ...(isInstagram && instagramExtraction
        ? {
            instagram_author_handle: instagramExtraction.authorHandle || '',
            instagram_caption: instagramExtraction.caption || '',
            instagram_transcript: instagramExtraction.transcript || '',
            instagram_media_items: instagramExtraction.mediaItems || [],
            ingestion_source: instagramExtraction.ingestionSource,
            download_status: 'skipped',
            ingestion_error: instagramExtraction.transcriptError || '',
          }
        : {}),
      likes: 0,
    };

    const redditMetadata = isReddit
      ? {
          reddit_subreddit: redditThreadData?.subreddit || '',
          reddit_author: redditThreadData?.author || '',
          reddit_post_score: redditThreadData?.score,
          reddit_comment_count: redditThreadData?.commentCount,
          reddit_thread_type: result.reddit_thread_type || (isRedditThreadUrl(resourceUrl) ? 'discussion' : ''),
          reddit_top_comment_summaries:
            result.reddit_top_comment_summaries || redditThreadData?.topComments?.slice(0, 3).map((comment: RedditCommentSummary) => comment.body) || [],
        }
      : {};

    const created = await createResourceWithFallbacks(base44, {
      ...resourceData,
      ...redditMetadata,
    });

    if (project_id) {
      await base44.asServiceRole.entities.ProjectResource.create({
        project_id,
        resource_id: created.id,
      });
    }

    return Response.json({ resource: created });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
