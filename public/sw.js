const IMAGE_CACHE_NAME = 'lifeos-resource-images-v2';
const IMAGE_CACHE_MAX_ENTRIES = 180;
const CACHEABLE_IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/i;
const UNSTABLE_IMAGE_HOSTS = /(cdninstagram|fbcdn|scontent|instagram\.com)/i;

function isCacheableImageRequest(request) {
  if (request.method !== 'GET') return false;
  if (request.destination !== 'image') return false;

  const url = new URL(request.url);
  if (!/^https?:$/.test(url.protocol)) return false;
  if (UNSTABLE_IMAGE_HOSTS.test(url.hostname)) return false;
  if (url.pathname.includes('/google/drive-files/') && url.pathname.endsWith('/content')) return false;
  return true;
}

function isLikelyImageResponse(request, response) {
  if (!response || !response.ok && response.type !== 'opaque') return false;
  if (response.type === 'opaque') return true;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().startsWith('image/')) return true;
  return CACHEABLE_IMAGE_EXTENSIONS.test(new URL(request.url).pathname);
}

async function trimImageCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= IMAGE_CACHE_MAX_ENTRIES) return;

  const staleKeys = keys.slice(0, keys.length - IMAGE_CACHE_MAX_ENTRIES);
  await Promise.all(staleKeys.map((key) => cache.delete(key)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isCacheableImageRequest(request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;

    const response = await fetch(request);
    if (isLikelyImageResponse(request, response)) {
      event.waitUntil(
        cache
          .put(request, response.clone())
          .then(() => trimImageCache(cache))
          .catch(() => null),
      );
    }
    return response;
  })());
});
