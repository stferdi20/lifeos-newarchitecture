import { useEffect, useMemo, useRef, useState } from 'react';
import { runtimeConfig } from '@/lib/runtime-config';
import { getSupabaseAccessToken } from '@/lib/supabase-browser';

const ACCESS_TOKEN_CACHE_MS = 60 * 1000;
const IMAGE_CACHE_NAMES = ['lifeos-resource-images-v3', 'lifeos-resource-images-v2'];
const IMAGE_META_CACHE_NAME = 'lifeos-resource-image-meta-v3';

function normalizeUrl(value = '') {
  return String(value || '').trim();
}

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isDriveBackedUrl(value = '') {
  const url = normalizeUrl(value);
  return /drive\.google\.com|googleusercontent\.com/i.test(url);
}

function isDriveFileCandidate(value = '') {
  return normalizeUrl(value).startsWith('drive-file:');
}

function isDriveCandidate(value = '') {
  return isDriveFileCandidate(value) || isDriveBackedUrl(value);
}

function isResourceThumbnailStorageUrl(value = '') {
  const url = normalizeUrl(value);
  return /\/storage\/v1\/object\/public\/resource-thumbnails\//i.test(url);
}

function isSupabaseStorageUrl(value = '') {
  const url = normalizeUrl(value);
  return /\/storage\/v1\/object\/public\//i.test(url);
}

function isRawInstagramMediaUrl(value = '') {
  const url = normalizeUrl(value);
  return /(cdninstagram|fbcdn|scontent|instagram\.com)/i.test(url);
}

function isImageFileLike(file = {}) {
  const mime = normalizeText(file?.mime_type);
  if (mime.startsWith('image/')) return true;
  const name = normalizeText(file?.name);
  return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(name);
}

function extractDriveFileId(value = '') {
  const url = normalizeUrl(value);
  if (!url) return '';

  try {
    const parsed = new URL(url);
    const queryId = parsed.searchParams.get('id');
    if (queryId) return queryId;

    const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
    if (fileMatch?.[1]) return fileMatch[1];
  } catch {
    return '';
  }

  return '';
}

let accessTokenCache = {
  token: '',
  expiresAt: 0,
  promise: null,
};

async function getCachedAccessToken({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && accessTokenCache.token && accessTokenCache.expiresAt > now) {
    return accessTokenCache.token;
  }

  if (!accessTokenCache.promise || forceRefresh) {
    accessTokenCache.promise = getSupabaseAccessToken()
      .then((token) => {
        accessTokenCache = {
          token: token || '',
          expiresAt: Date.now() + ACCESS_TOKEN_CACHE_MS,
          promise: null,
        };
        return accessTokenCache.token;
      })
      .catch((error) => {
        accessTokenCache = {
          token: '',
          expiresAt: 0,
          promise: null,
        };
        throw error;
      });
  }

  return accessTokenCache.promise;
}

function buildDriveProxyUrl(fileId, accessToken) {
  if (!fileId || !accessToken) return '';
  const token = encodeURIComponent(accessToken);
  return `${runtimeConfig.apiBaseUrl}/google/drive-files/${encodeURIComponent(fileId)}/content?token=${token}`;
}

function buildImageMetaKey(url = '') {
  if (!url || typeof window === 'undefined') return null;
  return new Request(`${window.location.origin}/__lifeos_image_cache_meta__?url=${encodeURIComponent(url)}`);
}

function buildImageCacheKeys(value = '') {
  const url = normalizeUrl(value);
  if (!url || typeof window === 'undefined') return [];

  const keys = [url];
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.includes('/google/drive-files/') && parsed.pathname.endsWith('/content')) {
      parsed.search = '';
      keys.push(parsed.href);
    }
  } catch {
    return keys;
  }

  return [...new Set(keys)];
}

function purgeCachedImage(value = '') {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  const cacheKeys = buildImageCacheKeys(value);
  if (!cacheKeys.length) return;

  const purge = async () => {
    await Promise.all(IMAGE_CACHE_NAMES.map(async (cacheName) => {
      const cache = await window.caches.open(cacheName);
      await Promise.all(cacheKeys.map((key) => cache.delete(key, { ignoreVary: true })));
    }));

    const metaCache = await window.caches.open(IMAGE_META_CACHE_NAME);
    await Promise.all(cacheKeys.map((key) => {
      const metaKey = buildImageMetaKey(key);
      return metaKey ? metaCache.delete(metaKey, { ignoreVary: true }) : Promise.resolve(false);
    }));
  };

  purge().catch(() => null);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.controller?.postMessage({
      type: 'lifeos:delete-image-cache',
      url: value,
    });
  }
}

function dedupe(values = []) {
  return [...new Set(values.map((value) => normalizeUrl(value)).filter(Boolean))];
}

function getFirstInstagramImageCandidate(resource = {}) {
  const items = Array.isArray(resource.instagram_media_items) ? resource.instagram_media_items : [];
  for (const item of items) {
    if (normalizeText(item?.type) !== 'image') continue;
    const thumbnail = normalizeUrl(item?.thumbnail_url);
    if (thumbnail) return thumbnail;
    const sourceUrl = normalizeUrl(item?.source_url);
    if (sourceUrl) return sourceUrl;
  }
  return '';
}

function getDriveImageCandidates(resource = {}) {
  const driveFiles = Array.isArray(resource.drive_files) ? resource.drive_files : [];
  return driveFiles
    .filter((file) => file?.id && isImageFileLike(file))
    .map((file) => `drive-file:${file.id}`);
}

function getRawResourceImageCandidates(resource = {}) {
  const resourceType = normalizeText(resource.resource_type);
  const firstImage = getFirstInstagramImageCandidate(resource);
  const driveImages = getDriveImageCandidates(resource);
  const mediaItems = Array.isArray(resource.instagram_media_items) ? resource.instagram_media_items : [];
  const itemImages = mediaItems.map((item) => item?.thumbnail_url || item?.source_url);

  if (['instagram_reel', 'instagram_carousel', 'instagram_post'].includes(resourceType)) {
    const candidates = dedupe([
      resource.thumbnail,
      ...driveImages,
      firstImage,
      ...itemImages,
    ]);
    const durableStorage = candidates.filter(isResourceThumbnailStorageUrl);
    const otherStorage = candidates.filter((candidate) => !isResourceThumbnailStorageUrl(candidate) && isSupabaseStorageUrl(candidate));
    const driveBacked = candidates.filter((candidate) => !isSupabaseStorageUrl(candidate) && isDriveCandidate(candidate));
    const externalNonInstagram = candidates.filter((candidate) => (
      !isSupabaseStorageUrl(candidate)
      && !isDriveCandidate(candidate)
      && !isRawInstagramMediaUrl(candidate)
    ));
    const rawInstagram = candidates.filter((candidate) => (
      !isSupabaseStorageUrl(candidate)
      && !isDriveCandidate(candidate)
      && isRawInstagramMediaUrl(candidate)
    ));

    return dedupe([
      ...driveBacked,
      ...durableStorage,
      ...otherStorage,
      ...externalNonInstagram,
      ...rawInstagram,
    ]);
  }

  return dedupe([
    resource.thumbnail,
    ...driveImages,
    firstImage,
    ...itemImages,
  ]);
}

export function useResourceImage(resource = {}) {
  const rawCandidates = useMemo(() => getRawResourceImageCandidates(resource), [
    resource?.id,
    resource?.resource_type,
    resource?.thumbnail,
    JSON.stringify(resource?.drive_files || []),
    JSON.stringify(resource?.instagram_media_items || []),
  ]);
  const [resolvedCandidates, setResolvedCandidates] = useState([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [tokenRefreshVersion, setTokenRefreshVersion] = useState(0);
  const retriedDriveTokenRef = useRef(false);

  useEffect(() => {
    retriedDriveTokenRef.current = false;
  }, [rawCandidates]);

  useEffect(() => {
    let cancelled = false;
    setCandidateIndex(0);

    const driveFileIds = rawCandidates
      .filter(isDriveFileCandidate)
      .map((candidate) => candidate.slice('drive-file:'.length))
      .filter(Boolean);

    if (driveFileIds.length === 0 && rawCandidates.every((candidate) => !isDriveBackedUrl(candidate))) {
      setResolvedCandidates(rawCandidates);
      return () => {
        cancelled = true;
      };
    }

    getCachedAccessToken({ forceRefresh: tokenRefreshVersion > 0 && retriedDriveTokenRef.current })
      .then((accessToken) => {
        if (cancelled) return;
        const next = rawCandidates.map((candidate) => {
          if (isDriveFileCandidate(candidate)) {
            return buildDriveProxyUrl(candidate.slice('drive-file:'.length), accessToken);
          }
          if (isDriveBackedUrl(candidate)) {
            return buildDriveProxyUrl(extractDriveFileId(candidate), accessToken);
          }
          return candidate;
        }).filter(Boolean);
        setResolvedCandidates(dedupe(next));
      })
      .catch(() => {
        if (cancelled) return;
        const next = rawCandidates.filter((candidate) => !isDriveFileCandidate(candidate));
        setResolvedCandidates(dedupe(next));
      });

    return () => {
      cancelled = true;
    };
  }, [rawCandidates, tokenRefreshVersion]);

  const imageUrl = resolvedCandidates[candidateIndex] || '';

  const onError = () => {
    purgeCachedImage(imageUrl);

    if (imageUrl.includes('/google/drive-files/') && !retriedDriveTokenRef.current) {
      retriedDriveTokenRef.current = true;
      setTokenRefreshVersion((current) => current + 1);
      return;
    }

    setCandidateIndex((current) => (
      current + 1 < resolvedCandidates.length
        ? current + 1
        : resolvedCandidates.length
    ));
  };

  return {
    imageUrl,
    onError,
  };
}
