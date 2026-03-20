import { fetchMediaHealthRaw, searchMedia } from '@/lib/media-api';
import { EXPECTED_MEDIA_BACKEND_VERSION } from './mediaBackendVersion';

function getMediaFunctionError(error, fallbackMessage) {
  const responseError =
    error?.response?.data?.error ||
    error?.data?.error ||
    error?.error;

  if (responseError) {
    return String(responseError);
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

export async function searchMediaByType(query, type) {
  if (!query?.trim() || !type) return [];

  try {
    const res = await searchMedia({ type, query });
    return res?.results || [];
  } catch (error) {
    throw new Error(getMediaFunctionError(error, 'Media search failed before provider results could load.'));
  }
}

export async function fetchMediaHealth() {
  try {
    const res = await fetchMediaHealthRaw();
    return {
      available: true,
      error: '',
      ...res,
    };
  } catch (error) {
    return {
      available: false,
      error: getMediaFunctionError(error, 'The remote media backend did not expose the health check.'),
      media_backend_version: null,
      providers: {},
      functions_version_header: null,
    };
  }
}

function getProviderKeyForType(type) {
  if (type === 'movie' || type === 'series') return 'tmdb';
  if (type === 'anime' || type === 'manga') return 'anilist';
  if (type === 'book') return 'openlibrary';
  if (type === 'game') return 'rawg';
  if (type === 'comic') return 'comicvine';
  return null;
}

function getProviderLabel(providerKey) {
  if (providerKey === 'tmdb') return 'TMDb';
  if (providerKey === 'anilist') return 'AniList';
  if (providerKey === 'openlibrary') return 'Open Library';
  if (providerKey === 'rawg') return 'RAWG';
  if (providerKey === 'comicvine') return 'ComicVine';
  return 'media provider';
}

export function getMediaBackendState(mediaHealth) {
  const backendVersion = mediaHealth?.media_backend_version || null;
  const versionMismatch = mediaHealth?.available && backendVersion !== EXPECTED_MEDIA_BACKEND_VERSION;

  return {
    available: Boolean(mediaHealth?.available),
    backendVersion,
    expectedVersion: EXPECTED_MEDIA_BACKEND_VERSION,
    versionMismatch,
    functionsVersionHeader: mediaHealth?.functions_version_header || null,
    error: mediaHealth?.error || '',
  };
}

export function getMediaTypeHealthMessage(type, mediaHealth) {
  const backendState = getMediaBackendState(mediaHealth);
  const providerKey = getProviderKeyForType(type);
  const providerStatus = providerKey ? mediaHealth?.providers?.[providerKey]?.status : null;

  if (!backendState.available) {
    return backendState.error || 'The remote media backend is unavailable or still on an older publish.';
  }

  if (backendState.versionMismatch) {
    return `The remote media backend is stale. Frontend expects ${backendState.expectedVersion}, but the backend reports ${backendState.backendVersion || 'unknown'}.`;
  }

  if (providerStatus === 'missing_config') {
    return `${getProviderLabel(providerKey)} is not configured in the remote Base44 backend for ${type} search.`;
  }

  return '';
}

function stripOuterQuotes(value) {
  return String(value || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

function stripTrailingYear(value) {
  return value.replace(/\s*\((?:19|20)\d{2}\)\s*$/i, '').replace(/\s+(?:19|20)\d{2}\s*$/i, '').trim();
}

function stripSeasonMarker(value) {
  return value
    .replace(/\s*[-:|]\s*(?:season|series|book|volume|vol\.?|part)\s+\d+\s*$/i, '')
    .replace(/\s+(?:season|series|book|volume|vol\.?|part)\s+\d+\s*$/i, '')
    .trim();
}

function stripSubtitle(value) {
  return value.split(/\s*[:\-|]\s*/)[0]?.trim() || value.trim();
}

function normalizeTitleForQuery(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFallbackQueries(title) {
  const original = String(title || '').trim();
  const variants = [original];
  const deQuoted = stripOuterQuotes(original);
  const noYear = stripTrailingYear(deQuoted);
  const noSeason = stripSeasonMarker(noYear);
  const noSubtitle = stripSubtitle(noSeason);
  const normalized = normalizeTitleForQuery(noSubtitle);

  variants.push(deQuoted, noYear, noSeason, noSubtitle, normalized);

  return variants.filter((variant, index) => {
    const trimmed = variant?.trim();
    return trimmed && variants.findIndex((item) => item?.trim() === trimmed) === index;
  });
}

export async function resolveBulkMediaMatch(title, type) {
  const queries = buildFallbackQueries(title);
  const query = queries[0] || String(title || '').trim();

  try {
    const resolution = await searchMedia({
      type,
      query,
      resolveMatch: true,
      originalTitle: title,
    });

    return {
      results: resolution.results || [],
      match: resolution.match || null,
      bestCandidate: resolution.bestCandidate || null,
      matched: Boolean(resolution.match),
      decision: resolution.decision || 'no_match',
      fallbackUsed: Boolean(resolution.queryUsed) && resolution.queryUsed !== query,
      confidence: resolution.confidence || 0,
      lookupFailed: false,
      reason: resolution.reason || 'Base44 AI could not confidently resolve this title from the API candidates.',
      queryUsed: resolution.queryUsed || query,
    };
  } catch (error) {
    return {
      results: [],
      match: null,
      bestCandidate: null,
      matched: false,
      decision: 'no_match',
      fallbackUsed: false,
      confidence: 0,
      lookupFailed: true,
      reason: getMediaFunctionError(error, 'Bulk match lookup failed before Base44 AI could resolve the title.'),
      queryUsed: query,
    };
  }
}
