const IMAGE_CACHE_NAME = 'lifeos-resource-images-v3';
const IMAGE_META_CACHE_NAME = 'lifeos-resource-image-meta-v3';
const LEGACY_IMAGE_CACHE_NAMES = ['lifeos-resource-images-v1', 'lifeos-resource-images-v2'];
const IMAGE_CACHE_MAX_ENTRIES = 300;
const IMAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_PURGE_TTL_MS = 60 * 1000;
const CACHEABLE_IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/i;
const recentlyPurgedImageUrls = new Map();

function buildCacheKey(request) {
  const url = new URL(request.url);
  if (url.pathname.includes('/google/drive-files/') && url.pathname.endsWith('/content')) {
    url.search = '';
  }
  return new Request(url.href, { method: 'GET' });
}

function buildMetaKey(cacheKey) {
  return new Request(`${self.location.origin}/__lifeos_image_cache_meta__?url=${encodeURIComponent(cacheKey.url)}`);
}

function isCacheableImageRequest(request) {
  if (request.method !== 'GET') return false;
  if (request.destination !== 'image') return false;

  const url = new URL(request.url);
  if (!/^https?:$/.test(url.protocol)) return false;
  return true;
}

function isLikelyImageResponse(request, response) {
  if (!response || !response.ok && response.type !== 'opaque') return false;
  if (response.type === 'opaque') return true;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().startsWith('image/')) return true;
  return CACHEABLE_IMAGE_EXTENSIONS.test(new URL(request.url).pathname);
}

async function getFreshCachedResponse(cache, metaCache, cacheKey) {
  const cached = await cache.match(cacheKey, { ignoreVary: true });
  if (!cached) return null;

  const meta = await metaCache.match(buildMetaKey(cacheKey), { ignoreVary: true });
  const metadata = await meta?.json().catch(() => null);
  const cachedAt = Number(metadata?.cachedAt || 0);
  if (cachedAt > 0 && Date.now() - cachedAt < IMAGE_CACHE_TTL_MS) {
    return cached;
  }

  await Promise.all([
    cache.delete(cacheKey, { ignoreVary: true }),
    metaCache.delete(buildMetaKey(cacheKey), { ignoreVary: true }),
  ]);
  return null;
}

async function putCachedResponse(cache, metaCache, cacheKey, response) {
  await Promise.all([
    cache.put(cacheKey, response),
    metaCache.put(buildMetaKey(cacheKey), new Response(JSON.stringify({ cachedAt: Date.now() }), {
      headers: { 'Content-Type': 'application/json' },
    })),
  ]);
}

async function trimImageCache(cache, metaCache) {
  const keys = await cache.keys();
  if (keys.length <= IMAGE_CACHE_MAX_ENTRIES) return;

  const staleKeys = keys.slice(0, keys.length - IMAGE_CACHE_MAX_ENTRIES);
  await Promise.all(staleKeys.flatMap((key) => [
    cache.delete(key),
    metaCache.delete(buildMetaKey(key), { ignoreVary: true }),
  ]));
}

async function deleteCachedImage(url) {
  if (!url) return;
  const cache = await caches.open(IMAGE_CACHE_NAME);
  const metaCache = await caches.open(IMAGE_META_CACHE_NAME);
  const request = new Request(url, { method: 'GET' });
  const cacheKey = buildCacheKey(request);
  const now = Date.now();
  recentlyPurgedImageUrls.set(request.url, now);
  recentlyPurgedImageUrls.set(cacheKey.url, now);
  await Promise.all([
    cache.delete(request, { ignoreVary: true }).catch(() => null),
    cache.delete(cacheKey, { ignoreVary: true }).catch(() => null),
    metaCache.delete(buildMetaKey(request), { ignoreVary: true }).catch(() => null),
    metaCache.delete(buildMetaKey(cacheKey), { ignoreVary: true }).catch(() => null),
  ]);
}

function wasRecentlyPurged(cacheKey) {
  const purgedAt = Number(recentlyPurgedImageUrls.get(cacheKey.url) || 0);
  if (!purgedAt) return false;
  if (Date.now() - purgedAt < RECENT_PURGE_TTL_MS) return true;
  recentlyPurgedImageUrls.delete(cacheKey.url);
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await Promise.all(LEGACY_IMAGE_CACHE_NAMES.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'lifeos:delete-image-cache') return;
  event.waitUntil(deleteCachedImage(event.data.url).catch(() => null));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isCacheableImageRequest(request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const metaCache = await caches.open(IMAGE_META_CACHE_NAME);
    const cacheKey = buildCacheKey(request);
    const cached = await getFreshCachedResponse(cache, metaCache, cacheKey);
    if (cached) return cached;

    const response = await fetch(request);
    if (isLikelyImageResponse(request, response) && !wasRecentlyPurged(cacheKey)) {
      event.waitUntil(
        putCachedResponse(cache, metaCache, cacheKey, response.clone())
          .then(() => trimImageCache(cache, metaCache))
          .catch(() => null),
      );
    }
    return response;
  })());
});
