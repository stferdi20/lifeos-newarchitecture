function normalizeDuplicateText(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/\b(?:season|series|book|volume|vol\.?|part)\s+\d+\b/gi, ' ')
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/g, '')
    .replace(/\s+(?:19|20)\d{2}\s*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDuplicateId(value = '') {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '');

  if (!raw) return '';

  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean);
  const idPart = parts.length > 1 ? parts[parts.length - 1] : raw;

  return idPart
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMediaDuplicateTitle(value = '') {
  return normalizeDuplicateText(value);
}

export function getMediaEntryCanonicalYear(entry = {}) {
  const candidates = [
    entry?.year_released,
    entry?.year_consumed,
  ];

  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;

    const numeric = typeof candidate === 'number'
      ? candidate
      : Number.parseInt(String(candidate).slice(0, 4), 10);

    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  return null;
}

export function getMediaDuplicateProviderKey(entry = {}) {
  const provider = normalizeDuplicateText(entry?.primary_provider || entry?.provider || '');
  const externalId = normalizeDuplicateId(entry?.external_id || '');

  if (!provider || !externalId) return '';
  return `${provider}:${externalId}`;
}

function getMediaDuplicateExternalIdKey(entry = {}) {
  const externalId = normalizeDuplicateId(entry?.external_id || '');
  if (!externalId) return '';

  const mediaType = normalizeDuplicateText(entry?.media_type || '');
  return mediaType ? `${mediaType}:${externalId}` : externalId;
}

function getMediaDuplicateTitleKey(entry = {}) {
  const mediaType = normalizeDuplicateText(entry?.media_type || '');
  const title = normalizeMediaDuplicateTitle(entry?.title || '');

  if (!mediaType || !title) return '';
  return `${mediaType}:${title}`;
}

export function getMediaDuplicateMatch(candidate, existingEntries = []) {
  if (!candidate || !Array.isArray(existingEntries)) return null;

  const candidateProviderKey = getMediaDuplicateProviderKey(candidate);
  if (candidateProviderKey) {
    const providerMatch = existingEntries.find((entry) => getMediaDuplicateProviderKey(entry) === candidateProviderKey);
    if (providerMatch) {
      return { entry: providerMatch, matchType: 'provider' };
    }
  }

  const candidateExternalKey = getMediaDuplicateExternalIdKey(candidate);
  if (candidateExternalKey) {
    const externalMatch = existingEntries.find((entry) => getMediaDuplicateExternalIdKey(entry) === candidateExternalKey);
    if (externalMatch) {
      return { entry: externalMatch, matchType: 'external_id' };
    }
  }

  const candidateTitleKey = getMediaDuplicateTitleKey(candidate);
  if (!candidateTitleKey) return null;

  const titleMatches = existingEntries.filter((entry) => getMediaDuplicateTitleKey(entry) === candidateTitleKey);
  if (!titleMatches.length) return null;

  const candidateYear = getMediaEntryCanonicalYear(candidate);
  if (candidateYear != null) {
    const yearMatch = titleMatches.find((entry) => {
      return getMediaEntryCanonicalYear(entry) === candidateYear;
    });
    if (yearMatch) {
      return { entry: yearMatch, matchType: 'title_year' };
    }
  }

  return { entry: titleMatches[0], matchType: 'title' };
}

export function getMediaDuplicateLabel(match) {
  if (!match) return '';
  return 'Already saved';
}
