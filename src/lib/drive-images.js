import { useEffect, useMemo, useRef, useState } from 'react';
import { runtimeConfig } from '@/lib/runtime-config';
import { apiPost } from '@/lib/api-client';
import { getSupabaseAccessToken } from '@/lib/supabase-browser';

const ACCESS_TOKEN_CACHE_MS = 60 * 1000;
const DRIVE_IMAGE_CACHE_NAME = 'lifeos-drive-images-v1';
const INSTAGRAM_THUMBNAIL_REPAIR_PREFIX = 'lifeos.instagram-thumbnail-repair';
const INSTAGRAM_THUMBNAIL_REPAIR_INTERVAL_MS = 24 * 60 * 60 * 1000;
const pendingInstagramThumbnailRepairs = new Set();

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

function isDriveProxyUrl(value = '') {
  const url = normalizeUrl(value);
  return /\/google\/drive-files\/[^/]+\/content(?:\?|$)/i.test(url);
}

function extractDriveProxyFileId(value = '') {
  const url = normalizeUrl(value);
  if (!url || typeof window === 'undefined') return '';

  try {
    const parsed = new URL(url, window.location.origin);
    const match = parsed.pathname.match(/\/google\/drive-files\/([^/]+)\/content$/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function buildDriveImageCacheRequest(fileId = '') {
  if (!fileId || typeof window === 'undefined') return null;
  return new Request(`${window.location.origin}/__lifeos_local_cache__/drive-images/${encodeURIComponent(fileId)}`);
}

function canUseBrowserImageCache() {
  return typeof window !== 'undefined'
    && typeof URL !== 'undefined'
    && typeof URL.createObjectURL === 'function'
    && 'caches' in window;
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

function isInstagramResourceType(value = '') {
  return ['instagram_reel', 'instagram_carousel', 'instagram_post'].includes(normalizeText(value));
}

function isStableImageCandidate(value = '') {
  return isDriveCandidate(value) || isSupabaseStorageUrl(value);
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

function getInstagramThumbnailRepairKey(resourceId = '') {
  return `${INSTAGRAM_THUMBNAIL_REPAIR_PREFIX}.${resourceId}`;
}

function hasRecentInstagramThumbnailRepairRequest(resourceId = '') {
  if (!resourceId || typeof window === 'undefined') return true;
  try {
    const requestedAt = Number(window.localStorage.getItem(getInstagramThumbnailRepairKey(resourceId)) || 0);
    return requestedAt > 0 && Date.now() - requestedAt < INSTAGRAM_THUMBNAIL_REPAIR_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markInstagramThumbnailRepairRequested(resourceId = '') {
  if (!resourceId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getInstagramThumbnailRepairKey(resourceId), String(Date.now()));
  } catch {
    // Ignore storage failures; the backend still protects duplicate queue rows.
  }
}

function shouldRequestInstagramThumbnailRepair(resource = {}, rawCandidates = []) {
  if (!resource?.id || !isInstagramResourceType(resource.resource_type)) return false;
  if (rawCandidates.some(isStableImageCandidate)) return false;
  if (hasRecentInstagramThumbnailRepairRequest(resource.id)) return false;

  const status = normalizeText(resource.download_status);
  if (['queued', 'processing', 'downloading', 'uploading'].includes(status)) return false;
  return true;
}

function requestInstagramThumbnailRepair(resource = {}) {
  const resourceId = String(resource?.id || '').trim();
  if (!resourceId || pendingInstagramThumbnailRepairs.has(resourceId)) return;

  pendingInstagramThumbnailRepairs.add(resourceId);
  markInstagramThumbnailRepairRequested(resourceId);
  apiPost(`/instagram-downloader/resources/${encodeURIComponent(resourceId)}/repair-thumbnail`, {})
    .catch(() => null)
    .finally(() => {
      pendingInstagramThumbnailRepairs.delete(resourceId);
    });
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
  const [cachedDriveImage, setCachedDriveImage] = useState({ sourceUrl: '', objectUrl: '', loading: false });
  const retriedDriveTokenRef = useRef(false);

  useEffect(() => {
    retriedDriveTokenRef.current = false;
  }, [rawCandidates]);

  useEffect(() => {
    if (!shouldRequestInstagramThumbnailRepair(resource, rawCandidates)) return;
    requestInstagramThumbnailRepair(resource);
  }, [rawCandidates, resource]);

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

  const candidateImageUrl = resolvedCandidates[candidateIndex] || '';

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    if (!isDriveProxyUrl(candidateImageUrl) || !canUseBrowserImageCache()) {
      setCachedDriveImage({ sourceUrl: '', objectUrl: '', loading: false });
      return () => {
        cancelled = true;
      };
    }

    const fileId = extractDriveProxyFileId(candidateImageUrl);
    const cacheRequest = buildDriveImageCacheRequest(fileId);
    if (!cacheRequest) {
      setCachedDriveImage({ sourceUrl: '', objectUrl: '', loading: false });
      return () => {
        cancelled = true;
      };
    }

    setCachedDriveImage({ sourceUrl: candidateImageUrl, objectUrl: '', loading: true });

    async function loadCachedDriveImage() {
      try {
        const cache = await window.caches.open(DRIVE_IMAGE_CACHE_NAME);
        const cached = await cache.match(cacheRequest);
        if (cached) {
          const blob = await cached.blob();
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) {
            setCachedDriveImage({ sourceUrl: candidateImageUrl, objectUrl, loading: false });
          }
          return;
        }

        const response = await fetch(candidateImageUrl, {
          credentials: 'same-origin',
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`Drive image request failed with ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType && !contentType.toLowerCase().startsWith('image/')) {
          throw new Error('Drive image response was not an image.');
        }

        const blob = await response.blob();
        await cache.put(cacheRequest, new Response(blob, {
          headers: {
            'Content-Type': contentType || blob.type || 'application/octet-stream',
            'Cache-Control': 'max-age=31536000',
          },
        }));
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setCachedDriveImage({ sourceUrl: candidateImageUrl, objectUrl, loading: false });
        }
      } catch {
        if (cancelled) return;
        setCachedDriveImage({ sourceUrl: candidateImageUrl, objectUrl: '', loading: false });
      }
    }

    loadCachedDriveImage();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [candidateImageUrl, resolvedCandidates.length]);

  const imageUrl = cachedDriveImage.objectUrl || candidateImageUrl;

  const onError = () => {
    if (isDriveProxyUrl(candidateImageUrl) && !retriedDriveTokenRef.current) {
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
