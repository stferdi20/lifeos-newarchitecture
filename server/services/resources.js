import { parseHTML } from 'linkedom';
import { z } from 'zod';
import { routeStructuredJson } from '../lib/llm-router.js';

const resourceSchema = z.object({
  title: z.string().default(''),
  author: z.string().default(''),
  thumbnail: z.string().default(''),
  summary: z.string().default(''),
  why_it_matters: z.string().default(''),
  who_its_for: z.string().default(''),
  explanation_for_newbies: z.string().default(''),
  main_topic: z.string().default(''),
  score: z.number().min(1).max(10).default(5),
  tags: z.array(z.string()).default([]),
  key_points: z.array(z.string()).default([]),
  actionable_points: z.array(z.string()).default([]),
  use_cases: z.array(z.string()).default([]),
});

function stripText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLongText(value, limit = 32000) {
  return String(value || '')
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

function summarizeText(value, sentenceCount = 2) {
  return splitSentences(value, sentenceCount).join(' ');
}

function pickActionablePoints(value) {
  const candidates = splitSentences(value, 12).filter((sentence) =>
    /(?:how to|step|try|use|build|create|start|improve|avoid|remember|learn|focus|watch|read|practice|implement)/i.test(sentence),
  );
  return dedupeStrings(candidates, 4);
}

function pickKeyPoints(value) {
  const candidates = splitSentences(value, 10);
  return dedupeStrings(candidates, 5);
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

function buildHeuristicResourceData({ extracted, title, url }) {
  const combinedText = normalizeLongText([
    extracted.description || '',
    extracted.content || '',
  ].filter(Boolean).join('\n\n'), 16000);
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

  return {
    title: extracted.title || title || url,
    author: extracted.author || '',
    thumbnail: extracted.thumbnail || '',
    summary,
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
    key_points: keyPoints,
    actionable_points: actionablePoints,
    use_cases: deriveUseCases({ resourceType: extracted.resourceType, mainTopic, actionablePoints }),
  };
}

function inferResourceType(url = '') {
  const value = String(url || '').toLowerCase();
  if (value.includes('youtube.com') || value.includes('youtu.be')) return 'youtube';
  if (value.includes('reddit.com')) return 'reddit';
  if (value.includes('github.com')) return 'github_repo';
  if (value.endsWith('.pdf')) return 'pdf';
  if (value.includes('arxiv.org') || value.includes('scholar.google')) return 'research_paper';
  return 'article';
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
    .map((candidate) => normalizeLongText(candidate?.textContent || '', 20000))
    .sort((a, b) => b.length - a.length)[0] || '';
}

function extractYoutubeVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || '';
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

function extractTranscriptTextFromEvents(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const parts = [];
  for (const event of events) {
    const segs = Array.isArray(event?.segs) ? event.segs : [];
    const text = segs.map((seg) => String(seg?.utf8 || '')).join('').replace(/\n/g, ' ').trim();
    if (text) parts.push(text);
  }
  return normalizeLongText(parts.join(' '), 32000);
}

async function fetchYoutubeTranscript(normalizedUrl, html) {
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
  if (!baseUrl) {
    return { transcript: '', language: '' };
  }

  try {
    const response = await fetch(`${baseUrl}&fmt=json3`, {
      headers: { 'User-Agent': 'LifeOS/1.0 (+https://lifeos-self-hosted.vercel.app)' },
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

async function fetchYouTubeMetadata(normalizedUrl, html) {
  const videoId = extractYoutubeVideoId(normalizedUrl);
  const playerResponse = extractPlayerResponseFromHtml(html);
  const videoDetails = playerResponse?.videoDetails || {};
  let oembed = null;

  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`, {
      headers: { 'User-Agent': 'LifeOS/1.0 (+https://lifeos-self-hosted.vercel.app)' },
    });
    if (response.ok) {
      oembed = await response.json();
    }
  } catch {
    // ignore
  }

  const transcriptResult = await fetchYoutubeTranscript(normalizedUrl, html);

  return {
    title: stripText(oembed?.title || videoDetails?.title || ''),
    author: stripText(oembed?.author_name || videoDetails?.author || ''),
    thumbnail: oembed?.thumbnail_url || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : ''),
    description: normalizeLongText(videoDetails?.shortDescription || '', 12000),
    keywords: Array.isArray(videoDetails?.keywords) ? videoDetails.keywords.map((value) => stripText(value)) : [],
    transcript: transcriptResult.transcript,
    language: transcriptResult.language,
  };
}

async function fetchPageSummary(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'LifeOS/1.0 (+https://lifeos-self-hosted.vercel.app)',
    },
  });

  const html = await response.text();
  const { document } = parseHTML(html);
  const meta = extractMeta(document);
  const title = stripText(document.querySelector('title')?.textContent || '');
  const bodyText = extractMainText(document);
  const thumbnail = meta['og:image'] || meta['twitter:image'] || '';
  const author = meta['author'] || meta['article:author'] || '';
  const description = meta.description || meta['og:description'] || meta['twitter:description'] || '';
  const keywords = String(meta.keywords || '')
    .split(',')
    .map((value) => stripText(value))
    .filter(Boolean);

  const resourceType = inferResourceType(url);
  if (resourceType === 'youtube') {
    const youtube = await fetchYouTubeMetadata(url, html);
    return {
      title: youtube.title || title,
      author: youtube.author || author,
      thumbnail: youtube.thumbnail || thumbnail,
      description: youtube.description || description,
      keywords: youtube.keywords || keywords,
      content: youtube.transcript || youtube.description || bodyText,
      contentSource: youtube.transcript ? 'youtube_transcript' : (youtube.description ? 'youtube_description' : 'metadata_only'),
      contentLanguage: youtube.language || '',
      resourceType,
      meta,
    };
  }

  return {
    title,
    author,
    thumbnail,
    description,
    keywords,
    content: bodyText,
    contentSource: bodyText ? 'html_text' : 'metadata_only',
    contentLanguage: '',
    resourceType,
    meta,
  };
}

function buildPrompt({ url, extracted, pageTitle }) {
  return [
    'Analyze this saved resource and return structured JSON for a personal knowledge base.',
    `URL: ${url}`,
    `Detected resource type: ${extracted.resourceType}`,
    `Extracted content source: ${extracted.contentSource}`,
    extracted.contentLanguage ? `Extracted language: ${extracted.contentLanguage}` : '',
    `Title: ${extracted.title || pageTitle || 'Unknown'}`,
    extracted.author ? `Author/Creator: ${extracted.author}` : '',
    extracted.meta?.description ? `Meta description: ${extracted.meta.description}` : '',
    extracted.description ? `Extracted description: ${extracted.description.slice(0, 1500)}` : '',
    extracted.keywords?.length ? `Extracted keywords: ${extracted.keywords.join(', ')}` : '',
    extracted.meta?.['og:site_name'] ? `Site name: ${extracted.meta['og:site_name']}` : '',
    '',
    extracted.content ? `Primary extracted content:\n${extracted.content.slice(0, 16000)}` : 'Primary extracted content: none',
    '',
    'Return JSON with:',
    '- title',
    '- author',
    '- thumbnail',
    '- summary (2-3 sentences)',
    '- why_it_matters (1-2 sentences)',
    '- who_its_for (short audience description)',
    '- explanation_for_newbies (simple explanation when useful, otherwise empty)',
    '- main_topic',
    '- score (1-10)',
    '- tags (3-8 short lowercase tags)',
    '- key_points (3-6 concise takeaways)',
    '- actionable_points (2-5 practical next steps)',
    '- use_cases (2-4 concrete revisit scenarios)',
    'Return valid JSON only. Do not wrap the JSON in markdown fences.',
    extracted.resourceType === 'youtube'
      ? 'For YouTube, use transcript/content as the primary source and keep the creator/channel plus thumbnail if available.'
      : 'Use extracted content as the main source of truth and stay conservative.',
  ].filter(Boolean).join('\n');
}

export async function analyzeResource({ url, title = '', content = '', userId = null }) {
  const extracted = content
    ? {
      title,
      author: '',
      thumbnail: '',
      content: normalizeLongText(content, 20000),
      contentSource: 'manual_text',
      contentLanguage: '',
      resourceType: inferResourceType(url),
      meta: {},
    }
    : await fetchPageSummary(url);
  const heuristic = buildHeuristicResourceData({ extracted, title, url });

  const prompt = buildPrompt({ url, extracted, pageTitle: title });
  let result = null;

  try {
    result = await routeStructuredJson({
      taskType: 'resource.analyze',
      prompt,
      schema: resourceSchema,
      userId,
      metadata: {
        requestSummary: `resource:${url}`,
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
  };

  return {
    ...result,
    data: {
      ...mergedData,
      content_source: extracted.contentSource,
      content_language: extracted.contentLanguage,
      content: extracted.content || '',
      enrichment_status: extracted.content
        ? (result.provider === 'heuristic' ? 'partial' : 'rich')
        : 'metadata_only',
      analysis_version: result.provider === 'heuristic' ? 'resource-enrichment-v5-heuristic' : 'resource-enrichment-v5',
    },
  };
}
