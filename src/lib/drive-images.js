import { useEffect, useMemo, useState } from 'react';
import { runtimeConfig } from '@/lib/runtime-config';
import { getSupabaseAccessToken } from '@/lib/supabase-browser';

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

let accessTokenPromise = null;

async function getCachedAccessToken() {
  if (!accessTokenPromise) {
    accessTokenPromise = getSupabaseAccessToken().catch((error) => {
      accessTokenPromise = null;
      throw error;
    });
  }
  return accessTokenPromise;
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

  if (['instagram_carousel', 'instagram_post'].includes(resourceType)) {
    return dedupe([
      ...driveImages,
      firstImage,
      resource.thumbnail,
      ...(Array.isArray(resource.instagram_media_items) ? resource.instagram_media_items.map((item) => item?.thumbnail_url || item?.source_url) : []),
    ]);
  }

  return dedupe([
    resource.thumbnail,
    ...driveImages,
    firstImage,
    ...(Array.isArray(resource.instagram_media_items) ? resource.instagram_media_items.map((item) => item?.thumbnail_url || item?.source_url) : []),
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

  useEffect(() => {
    let cancelled = false;
    setCandidateIndex(0);

    const driveFileIds = rawCandidates
      .filter((candidate) => candidate.startsWith('drive-file:'))
      .map((candidate) => candidate.slice('drive-file:'.length))
      .filter(Boolean);

    if (driveFileIds.length === 0 && rawCandidates.every((candidate) => !isDriveBackedUrl(candidate))) {
      setResolvedCandidates(rawCandidates);
      return () => {
        cancelled = true;
      };
    }

    getCachedAccessToken()
      .then((accessToken) => {
        if (cancelled) return;
        const next = rawCandidates.map((candidate) => {
          if (candidate.startsWith('drive-file:')) {
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
        const next = rawCandidates.filter((candidate) => !candidate.startsWith('drive-file:'));
        setResolvedCandidates(dedupe(next));
      });

    return () => {
      cancelled = true;
    };
  }, [rawCandidates]);

  const imageUrl = resolvedCandidates[candidateIndex] || '';
  const onError = () => {
    setCandidateIndex((current) => (current + 1 < resolvedCandidates.length ? current + 1 : current));
  };

  return {
    imageUrl,
    onError,
  };
}
