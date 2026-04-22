function normalizeUrl(value = '') {
  return String(value || '').trim();
}

function dedupe(values = []) {
  return [...new Set(values.map(normalizeUrl).filter(Boolean))];
}

function isDriveLikeUrl(value = '') {
  const url = normalizeUrl(value);
  return url.startsWith('drive-file:') || /drive\.google\.com|googleusercontent\.com/i.test(url);
}

function isUnstableInstagramUrl(value = '') {
  const url = normalizeUrl(value);
  return /(cdninstagram|fbcdn|scontent|instagram\.com)/i.test(url);
}

function isCacheableImageUrl(value = '') {
  const url = normalizeUrl(value);
  if (!url || isDriveLikeUrl(url) || isUnstableInstagramUrl(url)) return false;

  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : undefined);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function imageCandidatesForResource(resource = {}) {
  const mediaItems = Array.isArray(resource.instagram_media_items) ? resource.instagram_media_items : [];
  return dedupe([
    resource.thumbnail,
    ...mediaItems.map((item) => item?.thumbnail_url || item?.source_url),
  ]).filter(isCacheableImageUrl);
}

export function getResourceImageCacheCandidates(resources = [], limit = 120) {
  return dedupe((resources || []).flatMap(imageCandidatesForResource)).slice(0, limit);
}

export function prewarmResourceImageCache(resources = [], options = {}) {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return () => {};

  const urls = getResourceImageCacheCandidates(resources, Number(options.limit || 120));
  const concurrency = Math.max(1, Number(options.concurrency || 4));
  let cancelled = false;
  let cursor = 0;
  let active = 0;

  const loadNext = () => {
    if (cancelled) return;
    while (active < concurrency && cursor < urls.length) {
      const url = urls[cursor];
      cursor += 1;
      active += 1;

      const image = new Image();
      image.decoding = 'async';
      image.loading = 'eager';
      image.onload = image.onerror = () => {
        active -= 1;
        loadNext();
      };
      image.src = url;
    }
  };

  let idleId = null;
  let timeoutId = null;
  if ('requestIdleCallback' in window) {
    idleId = window.requestIdleCallback(loadNext, { timeout: 3500 });
  } else {
    timeoutId = window.setTimeout(loadNext, 900);
  }

  return () => {
    cancelled = true;
    if (idleId !== null) window.cancelIdleCallback?.(idleId);
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };
}
