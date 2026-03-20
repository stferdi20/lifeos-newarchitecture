const DEFAULT_GRAPH_API_VERSION = 'v22.0';
const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
const DEFAULT_TRANSCRIPTION_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;

export type InstagramPostKind = 'reel' | 'carousel';
export type InstagramIngestionSource = 'official_api' | 'extractor_fallback';

export type InstagramMediaItem = {
  type: 'image' | 'video';
  index: number;
  source_url: string;
  thumbnail_url: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
};

export type InstagramExtraction = {
  canonicalUrl: string;
  shortcode: string;
  postKind: InstagramPostKind;
  authorHandle: string;
  caption: string;
  publishedAt: string;
  thumbnailUrl: string;
  mediaItems: InstagramMediaItem[];
  videoUrl: string;
  ingestionSource: InstagramIngestionSource;
  transcript: string;
  transcriptError: string;
};

function normalizeText(value: unknown, limit = 60000) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function getString(input: any, ...keys: string[]) {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getNumber(input: any, ...keys: string[]) {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function normalizeInstagramUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function extractCanonicalInstagramPostUrl(value: string) {
  const match = String(value || '').match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p)\/[^/?#]+/i);
  return match ? normalizeInstagramUrl(match[0]) : '';
}

export function isInstagramUrl(url: string) {
  return /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:(?:share\/)?(?:reel|p))\//i.test(url);
}

export function isInstagramShareUrl(url: string) {
  return /(?:https?:\/\/)?(?:www\.)?instagram\.com\/share\/(?:reel|p)\//i.test(url);
}

export function parseInstagramShortcode(url: string) {
  const match = String(url || '').match(/instagram\.com\/(?:(?:share\/)?(?:reel|p))\/([^/?#]+)/i);
  return match?.[1] || '';
}

export function detectInstagramPostKind(url: string): InstagramPostKind | null {
  if (/instagram\.com\/(?:share\/)?reel\//i.test(url)) return 'reel';
  if (/instagram\.com\/(?:share\/)?p\//i.test(url)) return 'carousel';
  return null;
}

export async function resolveInstagramCanonicalUrl(url: string): Promise<string> {
  const normalizedInput = normalizeInstagramUrl(url);
  if (!isInstagramUrl(normalizedInput)) return normalizedInput;
  if (!isInstagramShareUrl(normalizedInput)) return normalizedInput;

  try {
    const res = await fetch(normalizedInput, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    const redirectedUrl = extractCanonicalInstagramPostUrl(res.url);
    if (redirectedUrl) return redirectedUrl;

    const html = await res.text().catch(() => '');
    const canonicalFromHtml = extractCanonicalInstagramPostUrl(html);
    if (canonicalFromHtml) return canonicalFromHtml;

    return normalizedInput;
  } catch {
    return normalizedInput;
  }
}

async function fetchOfficialInstagramMetadata(url: string) {
  const accessToken = Deno.env.get('INSTAGRAM_GRAPH_ACCESS_TOKEN') || Deno.env.get('INSTAGRAM_OEMBED_ACCESS_TOKEN');
  if (!accessToken) return null;

  const version = Deno.env.get('INSTAGRAM_GRAPH_API_VERSION') || DEFAULT_GRAPH_API_VERSION;
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
      canonicalUrl: getString(payload, 'author_url') || url,
      authorHandle: getString(payload, 'author_name'),
      thumbnailUrl: getString(payload, 'thumbnail_url'),
      title: getString(payload, 'title'),
    };
  } catch {
    return null;
  }
}

function flattenExtractorMedia(payload: any): any[] {
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

function guessMediaType(item: any): 'image' | 'video' {
  const mediaType = String(item?.media_type || item?.type || item?.mime_type || item?.mimeType || '').toLowerCase();
  if (mediaType.includes('video') || mediaType === '2') return 'video';

  const sourceUrl = getString(item, 'video_url', 'videoUrl', 'url', 'src', 'display_url', 'displayUrl', 'image_url', 'imageUrl');
  if (/\.mp4(?:$|\?)/i.test(sourceUrl)) return 'video';
  return 'image';
}

function normalizeMediaItems(payload: any): InstagramMediaItem[] {
  const media = flattenExtractorMedia(payload);
  return media
    .map((item, index) => {
      const type = guessMediaType(item);
      const sourceUrl = getString(
        item,
        'video_url',
        'videoUrl',
        'display_url',
        'displayUrl',
        'image_url',
        'imageUrl',
        'url',
        'src',
      );
      const thumbnailUrl = getString(
        item,
        'thumbnail_url',
        'thumbnailUrl',
        'display_url',
        'displayUrl',
        'image_url',
        'imageUrl',
        'cover_url',
        'coverUrl',
      );

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

function normalizeExtractorPayload(url: string, payload: any, officialMetadata: any): InstagramExtraction | null {
  const root = payload?.data || payload?.post || payload?.item || payload;
  const shortcode = getString(root, 'shortcode', 'code') || parseInstagramShortcode(url);
  const postKind = (() => {
    const explicit = getString(root, 'post_kind', 'postKind', 'product_type', 'productType', 'media_type', 'mediaType').toLowerCase();
    if (explicit.includes('reel') || explicit === 'clips') return 'reel';
    if (explicit.includes('carousel') || explicit.includes('sidecar')) return 'carousel';
    return detectInstagramPostKind(url);
  })();

  if (!shortcode || !postKind) return null;

  const mediaItems = normalizeMediaItems(root);
  const thumbnailUrl = getString(root, 'thumbnail_url', 'thumbnailUrl', 'display_url', 'displayUrl') || officialMetadata?.thumbnailUrl || mediaItems[0]?.thumbnail_url || '';
  const caption = normalizeText(
    getString(root, 'caption', 'caption_text', 'captionText', 'title', 'description')
    || getString(root?.caption, 'text')
    || officialMetadata?.title,
  );
  const authorHandle = getString(root, 'author_handle', 'authorHandle', 'username', 'owner_username', 'ownerUsername')
    || officialMetadata?.authorHandle
    || '';
  const publishedAt = getString(root, 'published_at', 'publishedAt', 'taken_at', 'takenAt', 'timestamp');
  const videoUrl = getString(root, 'video_url', 'videoUrl') || mediaItems.find((item) => item.type === 'video')?.source_url || '';

  return {
    canonicalUrl: normalizeInstagramUrl(getString(root, 'url', 'canonical_url', 'canonicalUrl', 'permalink') || url),
    shortcode,
    postKind,
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

async function fetchExtractorInstagramMetadata(url: string, officialMetadata: any): Promise<InstagramExtraction | null> {
  const extractorUrl = Deno.env.get('INSTAGRAM_EXTRACTOR_URL');
  if (!extractorUrl) return null;

  const method = (Deno.env.get('INSTAGRAM_EXTRACTOR_METHOD') || 'POST').toUpperCase();
  const apiKey = Deno.env.get('INSTAGRAM_EXTRACTOR_API_KEY') || '';
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

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

    if (res.status === 401 || res.status === 403) {
      throw new Error('Instagram extractor rejected the request.');
    }

    if (res.status === 404) {
      throw new Error('Instagram post was not found.');
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(errorBody || `Instagram extractor failed (${res.status}).`);
    }

    const payload = await res.json();
    return normalizeExtractorPayload(url, payload, officialMetadata);
  } catch (error) {
    throw new Error((error as Error)?.message || 'Instagram extractor failed.');
  }
}

async function transcribeInstagramVideo(videoUrl: string): Promise<{ transcript: string; error: string }> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey || !videoUrl) {
    return { transcript: '', error: '' };
  }

  try {
    const mediaRes = await fetch(videoUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
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
    form.append('model', Deno.env.get('OPENAI_TRANSCRIPTION_MODEL') || DEFAULT_TRANSCRIPTION_MODEL);
    form.append('file', new Blob([bytes], { type: mimeType }), `instagram-reel.${extension}`);

    const endpoint = Deno.env.get('OPENAI_TRANSCRIPTION_ENDPOINT') || DEFAULT_TRANSCRIPTION_ENDPOINT;
    const transcriptRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(45000),
    });

    if (!transcriptRes.ok) {
      const body = await transcriptRes.text().catch(() => '');
      return { transcript: '', error: body || `Transcript request failed (${transcriptRes.status}).` };
    }

    const payload = await transcriptRes.json();
    const transcript = normalizeText(payload?.text || payload?.transcript || '');
    return { transcript, error: transcript ? '' : 'Transcript unavailable: provider returned no text.' };
  } catch {
    return { transcript: '', error: 'Transcript unavailable: transcription request failed.' };
  }
}

export async function fetchInstagramExtraction(url: string): Promise<InstagramExtraction> {
  if (!isInstagramUrl(url)) {
    throw new Error('Unsupported Instagram URL.');
  }

  const canonicalUrl = await resolveInstagramCanonicalUrl(url);
  const extractionUrl = canonicalUrl || url;

  const officialMetadata = await fetchOfficialInstagramMetadata(extractionUrl);
  let extraction = await fetchExtractorInstagramMetadata(extractionUrl, officialMetadata);

  if (!extraction) {
    const shortcode = parseInstagramShortcode(extractionUrl);
    const postKind = detectInstagramPostKind(extractionUrl);
    if (!shortcode || !postKind) {
      throw new Error('Unsupported Instagram URL.');
    }

    extraction = {
      canonicalUrl: normalizeInstagramUrl(extractionUrl),
      shortcode,
      postKind,
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

  if (extraction.postKind === 'reel' && extraction.videoUrl) {
    const transcriptResult = await transcribeInstagramVideo(extraction.videoUrl);
    extraction.transcript = transcriptResult.transcript;
    extraction.transcriptError = transcriptResult.error;
  }

  return extraction;
}
