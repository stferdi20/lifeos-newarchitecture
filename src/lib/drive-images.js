import { useEffect, useState } from 'react';
import { runtimeConfig } from '@/lib/runtime-config';
import { getSupabaseAccessToken } from '@/lib/supabase-browser';

function normalizeUrl(value = '') {
  return String(value || '').trim();
}

function isDriveBackedUrl(value = '') {
  const url = normalizeUrl(value);
  return /drive\.google\.com|googleusercontent\.com/i.test(url);
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

export function useResourceImageUrl(sourceUrl = '') {
  const normalized = normalizeUrl(sourceUrl);
  const [resolvedUrl, setResolvedUrl] = useState(() => (isDriveBackedUrl(normalized) ? '' : normalized));

  useEffect(() => {
    let cancelled = false;

    if (!normalized) {
      setResolvedUrl('');
      return () => {
        cancelled = true;
      };
    }

    if (!isDriveBackedUrl(normalized)) {
      setResolvedUrl(normalized);
      return () => {
        cancelled = true;
      };
    }

    const fileId = extractDriveFileId(normalized);
    if (!fileId) {
      setResolvedUrl('');
      return () => {
        cancelled = true;
      };
    }

    getCachedAccessToken()
      .then((accessToken) => {
        if (cancelled) return;
        setResolvedUrl(buildDriveProxyUrl(fileId, accessToken));
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [normalized]);

  return resolvedUrl;
}
